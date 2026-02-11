/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { PythonRuntimeInfo, PythonRuntimeStatusInfo, PythonDownloadOptions, PythonVersion } from './pythonRuntimeTypes.js';

/**
 * Python Runtime Service Interface
 */
export const IPythonRuntimeService = createDecorator<IPythonRuntimeService>('pythonRuntimeService');

export interface IPythonRuntimeService {
	readonly _serviceBrand: undefined;

	/**
	 * Event: Runtime status changes
	 */
	readonly onDidChangeStatus: Event<PythonRuntimeStatusInfo>;

	/**
	 * Get current Python runtime path
	 * @param preferredVersion Preferred version (optional)
	 * @returns Python executable file path, or undefined if not available
	 */
	getPythonPath(preferredVersion?: string): Promise<string | undefined>;

	/**
	 * Get Python runtime information
	 * @param version Version number (optional, defaults to configured version)
	 */
	getRuntimeInfo(version?: string): Promise<PythonRuntimeInfo | undefined>;

	/**
	 * Check if specified version of Python is installed
	 */
	isInstalled(version?: string): Promise<boolean>;

	/**
	 * Download and install Python runtime
	 * @param options Download options
	 */
	downloadAndInstall(options: PythonDownloadOptions): Promise<PythonRuntimeInfo>;

	/**
	 * Get all installed Python versions
	 */
	getInstalledVersions(): Promise<string[]>;

	/**
	 * Get current runtime status
	 */
	getStatus(): Promise<PythonRuntimeStatusInfo>;

	/**
	 * Validate Python installation
	 */
	validateInstallation(version: string): Promise<boolean>;

	/**
	 * Get Python version information
	 */
	getPythonVersion(pythonPath: string): Promise<PythonVersion | undefined>;

	/**
	 * Set preferred Python version
	 */
	setPreferredVersion(version: string): Promise<void>;

	/**
	 * Get preferred Python version
	 */
	getPreferredVersion(): Promise<string | undefined>;
}
