/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IFileSnapshotService, IFileSnapshot } from '../common/fileSnapshotTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';

// ========== 显示快照列表命令（编辑器标题栏按钮） ==========
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.fileSnapshot.showList',
			title: localize2('showSnapshotList', '文件快照历史'),
			f1: true,
			icon: Codicon.history,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileSnapshotService = accessor.get(IFileSnapshotService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const activeEditor = editorService.activeEditor;
		if (!activeEditor?.resource) {
			notificationService.notify({
				severity: Severity.Warning,
				message: '请先打开一个文件'
			});
			return;
		}

		const uri = activeEditor.resource;
		const history = fileSnapshotService.getSnapshotHistory(uri);

		if (!history || history.snapshots.length === 0) {
			notificationService.notify({
				severity: Severity.Info,
				message: '该文件暂无快照记录'
			});
			return;
		}

		// 构建QuickPick选项
		const items: (IQuickPickItem & { snapshot: IFileSnapshot })[] = history.snapshots.map(snapshot => {
			const time = new Date(snapshot.timestamp);
			const timeStr = time.toLocaleString('zh-CN', {
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});

			// 构建描述信息
			let description = timeStr;
			if (snapshot.source) {
				description = `${snapshot.source} · ${timeStr}`;
			}

			// 构建详情信息
			let detail = '';
			if (snapshot.sessionId) {
				detail += `会话: ${snapshot.sessionId.substring(0, 8)}... `;
			}
			if (snapshot.changeLocations && snapshot.changeLocations.length > 0) {
				const locations = snapshot.changeLocations.slice(0, 3).map(loc => {
					return `${loc.type === 'insert' ? '+' : loc.type === 'delete' ? '-' : '~'}L${loc.startLine}-${loc.endLine}`;
				}).join(', ');
				detail += `修改: ${locations}`;
				if (snapshot.changeLocations.length > 3) {
					detail += ` 等${snapshot.changeLocations.length}处`;
				}
			}
			if (!detail) {
				detail = `大小: ${formatSize(snapshot.size)}`;
			}

			return {
				label: `$(history) ${snapshot.label || '快照'}`,
				description,
				detail,
				snapshot
			};
		});

		// 添加操作选项
		items.push({
			label: '$(trash) 清空该文件所有快照',
			description: '',
			detail: '',
			snapshot: null as any
		});

		const selected = await quickInputService.pick(items, {
			placeHolder: `${history.fileName} - 选择要恢复的快照`,
			canPickMany: false
		});

		if (selected) {
			if (!selected.snapshot) {
				// 清空快照
				fileSnapshotService.deleteAllSnapshots(uri);
				notificationService.notify({
					severity: Severity.Info,
					message: '已清空该文件的所有快照'
				});
			} else {
				// 恢复快照
				const success = await fileSnapshotService.restoreSnapshot(selected.snapshot.id);
				if (success) {
					notificationService.notify({
						severity: Severity.Info,
						message: `已恢复到快照: ${selected.snapshot.label || timeFormat(selected.snapshot.timestamp)}`
					});
				} else {
					notificationService.notify({
						severity: Severity.Error,
						message: '恢复快照失败'
					});
				}
			}
		}
	}
});

// 清空所有快照命令
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.fileSnapshot.clearAll',
			title: localize2('clearAllSnapshots', '清空所有文件快照'),
			f1: true,
			icon: Codicon.trash,
		});
	}

	run(accessor: ServicesAccessor): void {
		const fileSnapshotService = accessor.get(IFileSnapshotService);
		const notificationService = accessor.get(INotificationService);

		fileSnapshotService.clearAllSnapshots();
		notificationService.notify({
			severity: Severity.Info,
			message: '已清空所有快照'
		});
	}
});

// ========== 编辑器标题菜单 - 显示快照列表按钮 ==========
MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'senweaver.fileSnapshot.showList',
		title: localize('showSnapshotList', '快照历史'),
		icon: Codicon.history,
	},
	group: 'navigation',
	order: 100,
	when: ContextKeyExpr.has('resourceScheme')
});

// ========== 辅助函数 ==========
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeFormat(timestamp: number): string {
	return new Date(timestamp).toLocaleString('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});
}
