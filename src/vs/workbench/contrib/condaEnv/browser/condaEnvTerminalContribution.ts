/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ICondaEnvService } from '../common/condaEnvService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';

export class CondaEnvTerminalContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.condaEnvTerminal';

	constructor(
		@ICondaEnvService private readonly condaEnvService: ICondaEnvService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();

		// Listen for new terminal instances
		this._register(this.terminalService.onDidCreateInstance(async (instance) => {
			const activeEnv = this.condaEnvService.getActiveEnvironment();
			
			// Only activate if there's an active environment and it's not 'base'
			if (!activeEnv || activeEnv === 'base') {
				return;
			}

			// Check if conda is available
			const available = await this.condaEnvService.isCondaAvailable();
			if (!available) {
				return;
			}

			// Wait a bit for the terminal to be ready
			setTimeout(() => {
				// Send conda activate command to the terminal
				const activateCommand = this.getActivateCommand(activeEnv);
				console.log(`[Conda] Sending activation command: "${activateCommand}"`);
				// Send with addNewLine=true to execute the command
				instance.sendText(activateCommand, true);
			}, 1000); // Increase delay to ensure terminal is fully ready
		}));
	}

	private getActivateCommand(envName: string): string {
		// Add a leading space to prevent the first character from being truncated
		// This happens when the terminal is just initialized after app restart
		const command = ' conda activate ' + envName;
		console.log(`[Conda] Generated command: "${command}" (length: ${command.length})`);
		return command;
	}
}

registerWorkbenchContribution2(CondaEnvTerminalContribution.ID, CondaEnvTerminalContribution, WorkbenchPhase.BlockRestore);
