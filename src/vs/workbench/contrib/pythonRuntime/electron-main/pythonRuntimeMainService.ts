/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PythonRuntimeDownloader } from './pythonRuntimeDownloader.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { join } from '../../../../base/common/path.js';
import { PythonDownloadOptions, PythonRuntimeInfo } from '../common/pythonRuntimeTypes.js';

/**
 * Python Runtime Main Process Service
 * Handles download and installation in the main process
 */
export class PythonRuntimeMainService {
	private downloader: PythonRuntimeDownloader;

	constructor(
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILogService logService: ILogService
	) {
		const storagePath = join(this.environmentService.userDataPath, 'python-runtime');
		// Notification service is not available in main process, pass undefined
		this.downloader = new PythonRuntimeDownloader(storagePath, logService, undefined);
	}

	/**
	 * Download and install Python
	 */
	async downloadAndInstall(options: PythonDownloadOptions): Promise<PythonRuntimeInfo> {
		return this.downloader.downloadAndInstall(options);
	}
}
