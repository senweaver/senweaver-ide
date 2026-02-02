/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ICondaEnvService } from '../common/condaEnvService.js';
import { CONDA_ENV_SELECT_COMMAND_ID } from './condaEnvStatusbarItem.js';

interface CondaEnvQuickPickItem extends IQuickPickItem {
	envName: string;
}

export function registerCondaEnvCommands(): void {
	
	// Command to refresh conda environments
	registerAction2(class RefreshCondaEnvironmentsAction extends Action2 {
		constructor() {
			super({
				id: 'condaEnv.refreshEnvironments',
				title: nls.localize2('condaEnv.refresh', "Refresh Conda Environments"),
				f1: true
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const condaEnvService = accessor.get(ICondaEnvService);
			if ('refreshEnvironments' in condaEnvService) {
				await (condaEnvService as any).refreshEnvironments();
			}
		}
	});

	// Command to select conda environment
	registerAction2(class SelectCondaEnvironmentAction extends Action2 {
		constructor() {
			super({
				id: CONDA_ENV_SELECT_COMMAND_ID,
				title: nls.localize2('condaEnv.selectEnvironment', "Select Conda Environment"),
				f1: true
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const condaEnvService = accessor.get(ICondaEnvService);
			const quickInputService = accessor.get(IQuickInputService);

			// Get all environments
			const environments = await condaEnvService.getEnvironments();
			
			// Get current active environment
			const activeEnv = condaEnvService.getActiveEnvironment();

			// Create quick pick items
			const picks: CondaEnvQuickPickItem[] = environments.map(env => ({
				label: env.name,
				description: env.path || undefined,
				detail: env.name === activeEnv ? nls.localize('condaEnv.current', "Current environment") : undefined,
				picked: env.name === activeEnv,
				envName: env.name
			}));

			// Add option to add new environment
			picks.push({
				label: '$(add) ' + nls.localize('condaEnv.addNew', "Add New Environment..."),
				envName: '__add_new__'
			});

			// Show quick pick
			const selected = await quickInputService.pick(picks, {
				placeHolder: nls.localize('condaEnv.selectPlaceholder', "Select a conda environment to activate in new terminals"),
				matchOnDescription: true
			});

			if (selected && 'envName' in selected) {
				if (selected.envName === '__add_new__') {
					// Prompt for new environment name
					const newEnvName = await quickInputService.input({
						prompt: nls.localize('condaEnv.enterName', "Enter conda environment name"),
						placeHolder: 'my-env'
					});

					if (newEnvName) {
						condaEnvService.addEnvironment(newEnvName, '');
						await condaEnvService.setActiveEnvironment(newEnvName);
					}
				} else {
					await condaEnvService.setActiveEnvironment(selected.envName);
				}
			}
		}
	});
}
