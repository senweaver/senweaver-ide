/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IDecorationsProvider, IDecorationData, IDecorationsService } from '../../../services/decorations/common/decorations.js';
import { IFileSnapshotService } from '../common/fileSnapshotTypes.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';

/**
 * 文件快照装饰器提供者
 * 在有快照的文件旁边显示一个时钟图标
 */
class FileSnapshotDecorationsProvider implements IDecorationsProvider, IDisposable {
	readonly label = 'File Snapshots';

	private readonly _onDidChange = new Emitter<readonly URI[]>();
	readonly onDidChange: Event<readonly URI[]> = this._onDidChange.event;
	private readonly _disposable: IDisposable;

	constructor(
		private readonly _fileSnapshotService: IFileSnapshotService
	) {
		// 监听快照变化事件
		this._disposable = this._fileSnapshotService.onDidChangeSnapshots(uri => {
			if (uri) {
				this._onDidChange.fire([uri]);
			} else {
				// 所有文件都可能变化
				const allFiles = this._fileSnapshotService.getAllFilesWithSnapshots();
				this._onDidChange.fire(allFiles.map(h => h.uri));
			}
		});
	}

	provideDecorations(uri: URI, _token: CancellationToken): IDecorationData | undefined {
		const history = this._fileSnapshotService.getSnapshotHistory(uri);
		if (!history || history.snapshots.length === 0) {
			return undefined;
		}

		const count = history.snapshots.length;
		return {
			letter: Codicon.history,
			tooltip: `${count} 个快照 - 点击编辑器标题栏的时钟图标查看`,
			weight: -1, // 低优先级，不覆盖其他装饰器
			bubble: false
		};
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._disposable.dispose();
	}
}

/**
 * 工作台贡献 - 注册文件快照装饰器
 */
export class FileSnapshotDecorationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.fileSnapshotDecoration';

	constructor(
		@IDecorationsService decorationsService: IDecorationsService,
		@IFileSnapshotService fileSnapshotService: IFileSnapshotService
	) {
		super();

		const provider = new FileSnapshotDecorationsProvider(fileSnapshotService);
		this._register(decorationsService.registerDecorationsProvider(provider));
		this._register(provider);
	}
}

registerWorkbenchContribution2(
	FileSnapshotDecorationContribution.ID,
	FileSnapshotDecorationContribution,
	WorkbenchPhase.AfterRestored
);
