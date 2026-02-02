/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICondaEnvDetectorService, ICondaEnvironmentInfo } from '../common/condaEnvDetector.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-sandbox/services.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';

/**
 * Electron-sandbox proxy for the conda environment detector service.
 * This communicates with the Node.js backend via IPC.
 */
export class CondaEnvDetectorService extends Disposable implements ICondaEnvDetectorService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: ICondaEnvDetectorService;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService
	) {
		super();
		
		// Create a proxy channel to the shared process
		this.channel = ProxyChannel.toService<ICondaEnvDetectorService>(
			sharedProcessService.getChannel('condaEnvDetector')
		);
	}

	async isCondaAvailable(): Promise<boolean> {
		try {
			return await this.channel.isCondaAvailable();
		} catch (error) {
			console.error('[Conda] Failed to check availability:', error);
			return false;
		}
	}

	async getEnvironments(): Promise<ICondaEnvironmentInfo[]> {
		try {
			return await this.channel.getEnvironments();
		} catch (error) {
			console.error('[Conda] Failed to get environments:', error);
			return [];
		}
	}

	clearCache(): void {
		try {
			this.channel.clearCache();
		} catch (error) {
			console.error('[Conda] Failed to clear cache:', error);
		}
	}
}
