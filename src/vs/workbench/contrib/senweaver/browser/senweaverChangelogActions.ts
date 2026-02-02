/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { SenweaverChangelogInput } from './senweaverChangelogEditor.js';

/**
 * Action to manually show the changelog
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'senweaver.showChangelog',
			title: localize2('senweaverShowChangelog', 'SenWeaver: 显示更新日志'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const productService = accessor.get(IProductService);

		const currentVersion = productService.SenWeaverVersion || '2.7.4';
		const input = new SenweaverChangelogInput(currentVersion);
		await editorService.openEditor(input, { pinned: true });
	}
});
