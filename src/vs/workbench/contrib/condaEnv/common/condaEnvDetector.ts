/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ICondaEnvDetectorService = createDecorator<ICondaEnvDetectorService>('condaEnvDetectorService');

export interface ICondaEnvironmentInfo {
	name: string;
	path: string;
	isActive: boolean;
}

export interface ICondaEnvDetectorService {
	readonly _serviceBrand: undefined;
	
	/**
	 * Check if conda is available on the system
	 */
	isCondaAvailable(): Promise<boolean>;
	
	/**
	 * Get all available conda environments from the system
	 */
	getEnvironments(): Promise<ICondaEnvironmentInfo[]>;
	
	/**
	 * Clear the environment cache and force a refresh
	 */
	clearCache(): void;
}
