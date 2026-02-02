/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { SenweaverChangelogInput } from './senweaverChangelogEditor.js';

/**
 * Contribution that shows the changelog after a version update
 */
export class SenweaverChangelogContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.senweaver.changelog';
	private static readonly LAST_SHOWN_VERSION_KEY = 'senweaver.changelog.lastShownVersion';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();

		// Check if we should show the changelog
		this.checkAndShowChangelog();
	}

	private async checkAndShowChangelog(): Promise<void> {
		const currentVersion = this.productService.SenWeaverVersion;
		if (!currentVersion) {
			return;
		}

		// Get the last shown version from storage
		const lastShownVersion = this.storageService.get(
			SenweaverChangelogContribution.LAST_SHOWN_VERSION_KEY,
			StorageScope.APPLICATION
		);

		// If this is a new version, show the changelog
		if (lastShownVersion !== currentVersion) {
			console.log(`Version updated from ${lastShownVersion || 'unknown'} to ${currentVersion}, showing changelog`);

			// Wait a bit for the workbench to fully initialize
			const { window } = globalThis;
			window.setTimeout(() => {
				this.showChangelog(currentVersion);
			}, 2000);

			// Update the last shown version
			this.storageService.store(
				SenweaverChangelogContribution.LAST_SHOWN_VERSION_KEY,
				currentVersion,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} else {
			console.log(`Version ${currentVersion} changelog already shown`);
		}
	}

	private async showChangelog(version: string): Promise<void> {
		try {
			const input = new SenweaverChangelogInput(version);
			await this.editorService.openEditor(input, { pinned: true });
		} catch (error) {
			console.error('Failed to show changelog:', error);
		}
	}
}

// Register the contribution to run after the workbench is restored
registerWorkbenchContribution2(
	SenweaverChangelogContribution.ID,
	SenweaverChangelogContribution,
	WorkbenchPhase.AfterRestored
);
