/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ICondaEnvService } from '../common/condaEnvService.js';
import { Codicon } from '../../../../base/common/codicons.js';

export const CONDA_ENV_SELECT_COMMAND_ID = 'condaEnv.selectEnvironment';

export class CondaEnvStatusbarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.condaEnvStatusbar';

	private readonly statusbarEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@ICondaEnvService private readonly condaEnvService: ICondaEnvService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();

		// Initialize statusbar entry
		this.updateStatusbarEntry();

		// Listen for environment changes
		this._register(this.condaEnvService.onDidChangeActiveEnvironment(() => {
			this.updateStatusbarEntry();
		}));

		// Check if conda is available and update accordingly
		this.checkCondaAvailability();
	}

	private async checkCondaAvailability(): Promise<void> {
		const available = await this.condaEnvService.isCondaAvailable();
		if (available) {
			this.updateStatusbarEntry();
		}
	}

	private async updateStatusbarEntry(): Promise<void> {
		const available = await this.condaEnvService.isCondaAvailable();
		
		if (!available) {
			// Remove statusbar entry if conda is not available
			this.statusbarEntry.clear();
			return;
		}

		const activeEnv = this.condaEnvService.getActiveEnvironment() || 'base';
		const name = nls.localize('status.condaEnv', "Conda Environment");
		const text = `$(${Codicon.package.id}) ${activeEnv}`;
		const tooltip = nls.localize('condaEnv.tooltip', "Select Conda Environment (Current: {0})", activeEnv);

		if (this.statusbarEntry.value) {
			this.statusbarEntry.value.update({
				name,
				text,
				ariaLabel: tooltip,
				tooltip,
				command: CONDA_ENV_SELECT_COMMAND_ID
			});
		} else {
			this.statusbarEntry.value = this.statusbarService.addEntry(
				{
					name,
					text,
					ariaLabel: tooltip,
					tooltip,
					command: CONDA_ENV_SELECT_COMMAND_ID
				},
				'status.condaEnv',
				StatusbarAlignment.RIGHT,
				100 // Priority: place it near other environment indicators
			);
		}
	}
}

registerWorkbenchContribution2(CondaEnvStatusbarContribution.ID, CondaEnvStatusbarContribution, WorkbenchPhase.BlockRestore);
