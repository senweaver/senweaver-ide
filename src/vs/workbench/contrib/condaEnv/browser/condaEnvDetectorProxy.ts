/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICondaEnvDetectorService, ICondaEnvironmentInfo } from '../common/condaEnvDetector.js';

/**
 * Browser-side proxy for the conda environment detector service.
 * This is a stub implementation that will be replaced with proper IPC in electron builds.
 */
export class CondaEnvDetectorProxyService extends Disposable implements ICondaEnvDetectorService {
	declare readonly _serviceBrand: undefined;

	async isCondaAvailable(): Promise<boolean> {
		// In pure browser environment, conda is not available
		// This will be overridden in electron builds
		return false;
	}

	async getEnvironments(): Promise<ICondaEnvironmentInfo[]> {
		// In pure browser environment, return empty array
		// This will be overridden in electron builds
		return [];
	}

	clearCache(): void {
		// No-op in browser environment
	}
}
