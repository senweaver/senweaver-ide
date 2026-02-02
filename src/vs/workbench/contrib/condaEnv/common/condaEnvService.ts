/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const ICondaEnvService = createDecorator<ICondaEnvService>('condaEnvService');

export interface ICondaEnvironment {
	name: string;
	path: string;
	isActive: boolean;
}

export interface ICondaEnvService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when the active conda environment changes
	 */
	readonly onDidChangeActiveEnvironment: Event<string | undefined>;

	/**
	 * Get all available conda environments
	 */
	getEnvironments(): Promise<ICondaEnvironment[]>;

	/**
	 * Get the currently active conda environment
	 */
	getActiveEnvironment(): string | undefined;

	/**
	 * Set the active conda environment
	 */
	setActiveEnvironment(envName: string | undefined): Promise<void>;

	/**
	 * Check if conda is available on the system
	 */
	isCondaAvailable(): Promise<boolean>;

	/**
	 * Add a new conda environment
	 */
	addEnvironment(name: string, path: string): void;
}
