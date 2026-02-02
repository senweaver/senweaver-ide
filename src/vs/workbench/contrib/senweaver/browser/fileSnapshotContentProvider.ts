/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IFileSnapshotService } from '../common/fileSnapshotTypes.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/**
 * 快照内容 Scheme
 */
export const SNAPSHOT_SCHEME = 'senweaver-snapshot';

/**
 * 快照内容提供者 - 用于在对比编辑器中显示快照内容
 */
class FileSnapshotContentProvider extends Disposable implements ITextModelContentProvider {

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IFileSnapshotService private readonly _fileSnapshotService: IFileSnapshotService,
	) {
		super();

		// 注册内容提供者
		this._register(textModelService.registerTextModelContentProvider(SNAPSHOT_SCHEME, this));
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		if (resource.scheme !== SNAPSHOT_SCHEME) {
			return null;
		}

		try {
			// 从 query 中解析快照ID
			const query = JSON.parse(resource.query);
			const snapshotId = query.snapshotId;

			if (!snapshotId) {
				return null;
			}

			// 获取快照内容
			const snapshot = (this._fileSnapshotService as any).getSnapshotById?.(snapshotId);
			if (!snapshot) {
				return null;
			}

			// 获取或创建模型
			let model = this._modelService.getModel(resource);
			if (model) {
				// 更新现有模型
				model.setValue(snapshot.content);
				return model;
			}

			// 创建新模型
			const languageSelection = this._languageService.createByFilepathOrFirstLine(URI.file(snapshot.fsPath));
			model = this._modelService.createModel(snapshot.content, languageSelection, resource);

			return model;
		} catch (e) {
			console.error('[FileSnapshotContentProvider] Failed to provide content:', e);
			return null;
		}
	}
}

/**
 * 工作台贡献 - 注册内容提供者
 */
export class FileSnapshotContentProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.fileSnapshotContentProvider';

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IFileSnapshotService fileSnapshotService: IFileSnapshotService,
	) {
		// 创建内容提供者实例
		new FileSnapshotContentProvider(textModelService, modelService, languageService, fileSnapshotService);
	}
}

registerWorkbenchContribution2(FileSnapshotContentProviderContribution.ID, FileSnapshotContentProviderContribution, WorkbenchPhase.BlockStartup);
