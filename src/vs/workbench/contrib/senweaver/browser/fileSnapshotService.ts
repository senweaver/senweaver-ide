/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	IFileSnapshot,
	IFileSnapshotHistory,
	IFileSnapshotService,
	IFileSnapshotServiceState
} from '../common/fileSnapshotTypes.js';

const STORAGE_KEY = 'senweaver.fileSnapshots';
const DEFAULT_MAX_SNAPSHOTS_PER_FILE = 50;
const SAVE_DEBOUNCE_MS = 500; // 防抖延迟

class FileSnapshotService extends Disposable implements IFileSnapshotService {
	declare readonly _serviceBrand: undefined;

	private _state: IFileSnapshotServiceState;
	private readonly _onDidChangeSnapshots = this._register(new Emitter<URI | undefined>());
	readonly onDidChangeSnapshots: Event<URI | undefined> = this._onDidChangeSnapshots.event;
	private _saveTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IStorageService private readonly _storageService: IStorageService,
		@IEditorService private readonly _editorService: IEditorService,
		@ITextFileService private readonly _textFileService: ITextFileService,
	) {
		super();

		// 加载存储的状态
		this._state = this._loadState();

		// 监听文件保存事件，自动创建快照（异步执行，不阻塞保存操作）
		this._register(this._textFileService.files.onDidSave(e => {
			if (this._state.autoSnapshotEnabled) {
				// 使用 queueMicrotask 确保不阻塞当前事件循环
				queueMicrotask(() => {
					this._createAutoSnapshot(e.model.resource).catch(err => {
						console.error('[FileSnapshotService] Auto snapshot failed:', err);
					});
				});
			}
		}));
	}

	get state(): IFileSnapshotServiceState {
		return this._state;
	}

	private _loadState(): IFileSnapshotServiceState {
		const stored = this._storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (stored) {
			try {
				const parsed = JSON.parse(stored);
				// 重建 URI 对象
				const snapshotsByFile: { [fsPath: string]: IFileSnapshotHistory } = {};
				for (const fsPath in parsed.snapshotsByFile) {
					const history = parsed.snapshotsByFile[fsPath];
					snapshotsByFile[fsPath] = {
						...history,
						uri: URI.file(fsPath),
						snapshots: history.snapshots.map((s: any) => ({
							...s,
							uri: URI.file(s.fsPath)
						}))
					};
				}
				return {
					snapshotsByFile,
					autoSnapshotEnabled: parsed.autoSnapshotEnabled ?? true,
					maxSnapshotsPerFile: parsed.maxSnapshotsPerFile ?? DEFAULT_MAX_SNAPSHOTS_PER_FILE
				};
			} catch (e) {
				console.error('[FileSnapshotService] Failed to parse stored state:', e);
			}
		}
		return {
			snapshotsByFile: {},
			autoSnapshotEnabled: true,
			maxSnapshotsPerFile: DEFAULT_MAX_SNAPSHOTS_PER_FILE
		};
	}

	private _saveState(): void {
		// 使用防抖来避免频繁保存
		if (this._saveTimeout) {
			clearTimeout(this._saveTimeout);
		}
		this._saveTimeout = setTimeout(() => {
			this._doSaveState();
			this._saveTimeout = null;
		}, SAVE_DEBOUNCE_MS);
	}

	private _doSaveState(): void {
		// 异步执行序列化和存储，不阻塞主线程
		Promise.resolve().then(() => {
			// 序列化时移除 URI 对象，只保留 fsPath
			const toStore = {
				...this._state,
				snapshotsByFile: Object.fromEntries(
					Object.entries(this._state.snapshotsByFile).map(([fsPath, history]) => [
						fsPath,
						{
							...history,
							uri: undefined,
							snapshots: history.snapshots.map(s => ({
								...s,
								uri: undefined
							}))
						}
					])
				)
			};
			try {
				this._storageService.store(STORAGE_KEY, JSON.stringify(toStore), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			} catch (e) {
				console.error('[FileSnapshotService] Failed to save state:', e);
			}
		}).catch(err => {
			console.error('[FileSnapshotService] Async save failed:', err);
		});
	}

	private _generateSnapshotId(): string {
		return `snapshot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	private async _createAutoSnapshot(uri: URI, source?: string): Promise<void> {
		await this.createSnapshot(uri, { isAuto: true, source: source || '自动保存' });
	}

	async createSnapshot(uri: URI, options?: {
		label?: string;
		isAuto?: boolean;
		sessionId?: string;
		source?: string;
		changeLocations?: import('../common/fileSnapshotTypes.js').IChangeLocation[];
	}): Promise<IFileSnapshot | null> {
		const { label, isAuto = false, sessionId, source, changeLocations } = options || {};
		try {
			// 读取文件内容
			const content = await this._fileService.readFile(uri);
			const contentStr = content.value.toString();
			const fsPath = uri.fsPath;
			const fileName = uri.path.split('/').pop() || fsPath;

			// 检查是否与上一个快照内容相同
			const existingHistory = this._state.snapshotsByFile[fsPath];
			if (existingHistory && existingHistory.snapshots.length > 0) {
				const lastSnapshot = existingHistory.snapshots[0];
				if (lastSnapshot.content === contentStr) {
					// 内容相同，不创建新快照
					return null;
				}
			}

			const snapshot: IFileSnapshot = {
				id: this._generateSnapshotId(),
				uri,
				fsPath,
				fileName,
				content: contentStr,
				timestamp: Date.now(),
				label: label || this._generateAutoLabel(isAuto, source),
				size: content.value.byteLength,
				isAutoSnapshot: isAuto,
				sessionId,
				source,
				changeLocations
			};

			// 添加到历史记录
			if (!this._state.snapshotsByFile[fsPath]) {
				this._state.snapshotsByFile[fsPath] = {
					uri,
					fsPath,
					fileName,
					snapshots: [],
					lastModified: Date.now()
				};
			}

			// 在开头插入新快照
			this._state.snapshotsByFile[fsPath].snapshots.unshift(snapshot);
			this._state.snapshotsByFile[fsPath].lastModified = Date.now();

			// 限制快照数量
			this._trimSnapshots(fsPath);

			// 保存状态
			this._saveState();

			// 触发事件
			this._onDidChangeSnapshots.fire(uri);

			return snapshot;
		} catch (e) {
			console.error('[FileSnapshotService] Failed to create snapshot:', e);
			return null;
		}
	}

	private _generateAutoLabel(isAuto: boolean, source?: string): string {
		const now = new Date();
		const timeStr = now.toLocaleTimeString('zh-CN', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		if (source) {
			return `${source} ${timeStr}`;
		}
		return isAuto ? `自动保存 ${timeStr}` : `手动快照 ${timeStr}`;
	}

	private _trimSnapshots(fsPath: string): void {
		const history = this._state.snapshotsByFile[fsPath];
		if (history && history.snapshots.length > this._state.maxSnapshotsPerFile) {
			history.snapshots = history.snapshots.slice(0, this._state.maxSnapshotsPerFile);
		}
	}

	getSnapshotHistory(uri: URI): IFileSnapshotHistory | undefined {
		return this._state.snapshotsByFile[uri.fsPath];
	}

	getAllFilesWithSnapshots(): IFileSnapshotHistory[] {
		return Object.values(this._state.snapshotsByFile)
			.filter(h => h.snapshots.length > 0)
			.sort((a, b) => b.lastModified - a.lastModified);
	}

	async restoreSnapshot(snapshotId: string): Promise<boolean> {
		// 查找快照
		for (const fsPath in this._state.snapshotsByFile) {
			const history = this._state.snapshotsByFile[fsPath];
			const snapshot = history.snapshots.find(s => s.id === snapshotId);
			if (snapshot) {
				try {
					const uri = URI.file(fsPath);

					// 直接写入快照内容，不创建新快照（避免重复）
					await this._fileService.writeFile(uri, VSBuffer.fromString(snapshot.content));

					// 触发事件
					this._onDidChangeSnapshots.fire(uri);

					return true;
				} catch (e) {
					console.error('[FileSnapshotService] Failed to restore snapshot:', e);
					return false;
				}
			}
		}
		return false;
	}

	deleteSnapshot(snapshotId: string): void {
		for (const fsPath in this._state.snapshotsByFile) {
			const history = this._state.snapshotsByFile[fsPath];
			const idx = history.snapshots.findIndex(s => s.id === snapshotId);
			if (idx !== -1) {
				history.snapshots.splice(idx, 1);
				this._saveState();
				this._onDidChangeSnapshots.fire(URI.file(fsPath));
				return;
			}
		}
	}

	deleteAllSnapshots(uri: URI): void {
		const fsPath = uri.fsPath;
		if (this._state.snapshotsByFile[fsPath]) {
			delete this._state.snapshotsByFile[fsPath];
			this._saveState();
			this._onDidChangeSnapshots.fire(uri);
		}
	}

	clearAllSnapshots(): void {
		this._state.snapshotsByFile = {};
		this._saveState();
		this._onDidChangeSnapshots.fire(undefined);
	}

	async compareWithCurrent(snapshotId: string): Promise<void> {
		// 查找快照
		for (const fsPath in this._state.snapshotsByFile) {
			const history = this._state.snapshotsByFile[fsPath];
			const snapshot = history.snapshots.find(s => s.id === snapshotId);
			if (snapshot) {
				const uri = URI.file(fsPath);
				// 创建一个虚拟的快照URI用于对比
				const snapshotUri = uri.with({
					scheme: 'senweaver-snapshot',
					query: JSON.stringify({ snapshotId, originalScheme: uri.scheme })
				});

				// 打开对比编辑器
				await this._editorService.openEditor({
					original: { resource: snapshotUri },
					modified: { resource: uri },
					label: `${snapshot.fileName} (快照 vs 当前)`
				});
				return;
			}
		}
	}

	async compareTwoSnapshots(snapshotId1: string, snapshotId2: string): Promise<void> {
		let snapshot1: IFileSnapshot | undefined;
		let snapshot2: IFileSnapshot | undefined;

		for (const fsPath in this._state.snapshotsByFile) {
			const history = this._state.snapshotsByFile[fsPath];
			for (const s of history.snapshots) {
				if (s.id === snapshotId1) snapshot1 = s;
				if (s.id === snapshotId2) snapshot2 = s;
			}
		}

		if (snapshot1 && snapshot2) {
			const uri1 = URI.file(snapshot1.fsPath).with({
				scheme: 'senweaver-snapshot',
				query: JSON.stringify({ snapshotId: snapshotId1, originalScheme: 'file' })
			});
			const uri2 = URI.file(snapshot2.fsPath).with({
				scheme: 'senweaver-snapshot',
				query: JSON.stringify({ snapshotId: snapshotId2, originalScheme: 'file' })
			});

			await this._editorService.openEditor({
				original: { resource: uri1 },
				modified: { resource: uri2 },
				label: `${snapshot1.fileName} (对比快照)`
			});
		}
	}

	setAutoSnapshotEnabled(enabled: boolean): void {
		this._state.autoSnapshotEnabled = enabled;
		this._saveState();
	}

	setMaxSnapshotsPerFile(max: number): void {
		this._state.maxSnapshotsPerFile = Math.max(1, max);
		// 修剪现有快照
		for (const fsPath in this._state.snapshotsByFile) {
			this._trimSnapshots(fsPath);
		}
		this._saveState();
	}

	/**
	 * 根据快照ID获取快照内容（用于内容提供者）
	 */
	getSnapshotById(snapshotId: string): IFileSnapshot | undefined {
		for (const fsPath in this._state.snapshotsByFile) {
			const history = this._state.snapshotsByFile[fsPath];
			const snapshot = history.snapshots.find(s => s.id === snapshotId);
			if (snapshot) {
				return snapshot;
			}
		}
		return undefined;
	}

	override dispose(): void {
		// 清理防抖定时器
		if (this._saveTimeout) {
			clearTimeout(this._saveTimeout);
			this._saveTimeout = null;
			// 异步保存未保存的状态，不阻塞 dispose
			this._doSaveState();
		}
		super.dispose();
	}
}

// 注册服务
registerSingleton(IFileSnapshotService, FileSnapshotService, InstantiationType.Delayed);

// 导出服务类以便其他地方使用
export { FileSnapshotService };

/**
 * 工作台贡献 - 确保服务被初始化
 */
export class FileSnapshotServiceContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.fileSnapshotService';

	constructor(
		@IFileSnapshotService _fileSnapshotService: IFileSnapshotService
	) {
		// 服务会在这里被实例化
	}
}

registerWorkbenchContribution2(FileSnapshotServiceContribution.ID, FileSnapshotServiceContribution, WorkbenchPhase.AfterRestored);
