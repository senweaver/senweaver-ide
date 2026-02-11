/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IPythonRuntimeService } from '../common/pythonRuntimeService.js';
import { PythonRuntimeService } from './pythonRuntimeService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPythonRuntimeService as IPythonRuntimeServiceInterface } from '../common/pythonRuntimeService.js';
import { localize2 } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { DEFAULT_PYTHON_VERSION, SUPPORTED_PYTHON_VERSIONS } from '../common/pythonRuntimeTypes.js';

// Register service
registerSingleton(IPythonRuntimeService, PythonRuntimeService, InstantiationType.Delayed);

/**
 * Python Runtime Workbench Contribution
 */
class PythonRuntimeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.pythonRuntime';

	constructor(
		@IPythonRuntimeServiceInterface private readonly pythonRuntimeService: IPythonRuntimeServiceInterface,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this._registerListeners();
	}

	private _registerListeners(): void {
		// Listen to configuration changes
		this._register(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('python.runtime')) {
					// Re-initialize on configuration change
					// Can add re-check logic here
				}
			})
		);

		// Listen to status changes
		this._register(
			this.pythonRuntimeService.onDidChangeStatus(status => {
				// Can update UI or notify user here
			})
		);
	}
}

registerWorkbenchContribution2(PythonRuntimeContribution.ID, PythonRuntimeContribution, WorkbenchPhase.Eventually);

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Download Python Runtime Command
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'python.runtime.download',
			title: localize2('pythonRuntime.download', 'Download Python Runtime'),
			category: localize2('pythonRuntime.category', 'Python'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const pythonRuntimeService = accessor.get(IPythonRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);

		// Let user select version
		const items = SUPPORTED_PYTHON_VERSIONS.map(version => ({
			label: `Python ${version}`,
			description: version === DEFAULT_PYTHON_VERSION ? 'Recommended' : undefined,
			version
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: 'Select Python version to download'
		});

		if (!selected) {
			return;
		}

		try {
			await pythonRuntimeService.downloadAndInstall({
				version: selected.version,
				showProgress: true
			});
		} catch (error) {
			// Error already handled in service
		}
	}
});

/**
 * Switch Python Version Command
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'python.runtime.switchVersion',
			title: localize2('pythonRuntime.switchVersion', 'Switch Python Version'),
			category: localize2('pythonRuntime.category', 'Python'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const pythonRuntimeService = accessor.get(IPythonRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);

		// Get installed versions
		const installedVersions = await pythonRuntimeService.getInstalledVersions();
		
		if (installedVersions.length === 0) {
			await quickInputService.input({
				prompt: 'No Python versions installed, please download first'
			});
			return;
		}

		const items = installedVersions.map(version => ({
			label: `Python ${version}`,
			version
		}));

		const selected = await quickInputService.pick(items, {
			placeHolder: 'Select Python version'
		});

		if (selected) {
			await pythonRuntimeService.setPreferredVersion(selected.version);
		}
	}
});
