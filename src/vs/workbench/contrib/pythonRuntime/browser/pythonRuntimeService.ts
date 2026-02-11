/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IPythonRuntimeService as IPythonRuntimeServiceInterface } from '../common/pythonRuntimeService.js';
import { PythonRuntimeInfo, PythonRuntimeStatusInfo, PythonDownloadOptions, PythonVersion, DEFAULT_PYTHON_VERSION, parsePythonVersion, PythonRuntimeStatus } from '../common/pythonRuntimeTypes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { join } from '../../../../base/common/path.js';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Python Runtime Service Implementation (Browser Side)
 */
export class PythonRuntimeService extends Disposable implements IPythonRuntimeServiceInterface {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<PythonRuntimeStatusInfo>());
	readonly onDidChangeStatus: Event<PythonRuntimeStatusInfo> = this._onDidChangeStatus.event;

	private _status: PythonRuntimeStatusInfo = { status: PythonRuntimeStatus.NotInstalled };
	private _runtimeCache: Map<string, PythonRuntimeInfo> = new Map();

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		// Check if builtin Python is enabled in configuration
		const useBuiltin = this.configurationService.getValue<boolean>('python.runtime.useBuiltin') ?? true;
		if (!useBuiltin) {
			return;
		}

		// Check if installed
		const preferredVersion = await this.getPreferredVersion();
		const version = preferredVersion || DEFAULT_PYTHON_VERSION;
		
		if (await this.isInstalled(version)) {
			this._status = { status: PythonRuntimeStatus.Installed, version };
			this._onDidChangeStatus.fire(this._status);
		}
	}

	async getPythonPath(preferredVersion?: string): Promise<string | undefined> {
		const useBuiltin = this.configurationService.getValue<boolean>('python.runtime.useBuiltin') ?? true;
		if (!useBuiltin) {
			return undefined;
		}

		const version = preferredVersion || await this.getPreferredVersion() || DEFAULT_PYTHON_VERSION;
		const runtimeInfo = await this.getRuntimeInfo(version);

		if (runtimeInfo) {
			return runtimeInfo.executablePath;
		}

		// If not exists and auto-download is enabled
		const autoDownload = this.configurationService.getValue<boolean>('python.runtime.autoDownload') ?? true;
		if (autoDownload) {
			// Trigger download (async, non-blocking)
			this.downloadAndInstall({ version, showProgress: true }).catch(err => {
				this.logService.error(`[PythonRuntime] Failed to auto-download: ${err}`);
			});
		}

		// Fallback to system Python
		const fallbackToSystem = this.configurationService.getValue<boolean>('python.runtime.fallbackToSystem') ?? true;
		if (fallbackToSystem) {
			return this._getSystemPythonPath();
		}

		return undefined;
	}

	async getRuntimeInfo(version?: string): Promise<PythonRuntimeInfo | undefined> {
		const targetVersion = version || await this.getPreferredVersion() || DEFAULT_PYTHON_VERSION;
		
		// Check cache
		if (this._runtimeCache.has(targetVersion)) {
			return this._runtimeCache.get(targetVersion);
		}

		// Check if installed
		if (!(await this.isInstalled(targetVersion))) {
			return undefined;
		}

		// Build runtime info
		const runtimeInfo = await this._buildRuntimeInfo(targetVersion);
		if (runtimeInfo) {
			this._runtimeCache.set(targetVersion, runtimeInfo);
		}

		return runtimeInfo;
	}

	async isInstalled(version?: string): Promise<boolean> {
		const targetVersion = version || await this.getPreferredVersion() || DEFAULT_PYTHON_VERSION;
		const installPath = this._getInstallPath(targetVersion);
		
		if (!existsSync(installPath)) {
			return false;
		}

		// Verify Python executable exists
		const pythonPath = this._getPythonExecutablePath(installPath);
		return existsSync(pythonPath);
	}

	async downloadAndInstall(options: PythonDownloadOptions): Promise<PythonRuntimeInfo> {
		this._status = { status: PythonRuntimeStatus.Downloading, version: options.version };
		this._onDidChangeStatus.fire(this._status);

		try {
			// Call main process download service via IPC
			const channel = this.mainProcessService.getChannel('python-runtime');
			const downloader = ProxyChannel.toService<{
				downloadAndInstall(options: PythonDownloadOptions): Promise<PythonRuntimeInfo>;
			}>(channel);

			const runtimeInfo = await downloader.downloadAndInstall({
				...options,
				onProgress: (progress) => {
					this._status = {
						status: PythonRuntimeStatus.Downloading,
						version: options.version,
						progress
					};
					this._onDidChangeStatus.fire(this._status);
					options.onProgress?.(progress);
				}
			});

			this._status = { status: PythonRuntimeStatus.Installed, version: options.version };
			this._onDidChangeStatus.fire(this._status);
			this._runtimeCache.set(options.version, runtimeInfo);

			this.notificationService.info(`Python ${options.version} installed successfully`);

			return runtimeInfo;
		} catch (error) {
			this._status = {
				status: PythonRuntimeStatus.Error,
				version: options.version,
				error: error instanceof Error ? error.message : String(error)
			};
			this._onDidChangeStatus.fire(this._status);
			throw error;
		}
	}

	async getInstalledVersions(): Promise<string[]> {
		const storagePath = this._getStoragePath();
		if (!existsSync(storagePath)) {
			return [];
		}

		const { readdirSync } = await import('fs');
		const entries = readdirSync(storagePath, { withFileTypes: true });
		
		return entries
			.filter(entry => entry.isDirectory() && entry.name.startsWith('python-'))
			.map(entry => {
				const match = entry.name.match(/^python-(\d+\.\d+\.\d+)-/);
				return match ? match[1] : null;
			})
			.filter((v): v is string => v !== null);
	}

	async getStatus(): Promise<PythonRuntimeStatusInfo> {
		return { ...this._status };
	}

	async validateInstallation(version: string): Promise<boolean> {
		const runtimeInfo = await this.getRuntimeInfo(version);
		if (!runtimeInfo) {
			return false;
		}

		try {
			const { stdout } = await execAsync(`"${runtimeInfo.executablePath}" --version`);
			return stdout.includes(version);
		} catch {
			return false;
		}
	}

	async getPythonVersion(pythonPath: string): Promise<PythonVersion | undefined> {
		try {
			const { stdout } = await execAsync(`"${pythonPath}" --version`);
			const match = stdout.match(/Python (\d+\.\d+\.\d+)/);
			if (match) {
				const version = parsePythonVersion(match[1]);
				return version ?? undefined;
			}
		} catch {
			// Ignore errors
		}
		return undefined;
	}

	async setPreferredVersion(version: string): Promise<void> {
		await this.configurationService.updateValue('python.runtime.preferredVersion', version);
	}

	async getPreferredVersion(): Promise<string | undefined> {
		return this.configurationService.getValue<string>('python.runtime.preferredVersion');
	}

	/**
	 * Get storage path
	 * Note: In browser side, actual file operations need to be done via IPC in main process
	 * This returns path for display and configuration, actual storage path is managed by main process PythonRuntimeMainService
	 */
	private _getStoragePath(): string {
		const customPath = this.configurationService.getValue<string>('python.runtime.downloadPath');
		if (customPath) {
			return customPath;
		}
		// userDataPath is defined in IEnvironmentService interface
		// In Electron environment, actual download happens in main process, this only returns path for display
		// If userDataPath is not available, return default path
		const userDataPath = (this.environmentService as any).userDataPath;
		if (userDataPath && typeof userDataPath === 'string') {
			return join(userDataPath, 'python-runtime');
		}
		// Default path (actual path will be obtained via IPC from main process when used)
		return 'python-runtime';
	}

	/**
	 * Get installation path
	 */
	private _getInstallPath(version: string): string {
		const platform = process.platform;
		const arch = process.arch;
		return join(this._getStoragePath(), `python-${version}-${platform}-${arch}`);
	}

	/**
	 * Get Python executable file path
	 */
	private _getPythonExecutablePath(installPath: string): string {
		if (process.platform === 'win32') {
			return join(installPath, 'python.exe');
		} else {
			return join(installPath, 'bin', 'python3');
		}
	}

	/**
	 * Build runtime information
	 */
	private async _buildRuntimeInfo(version: string): Promise<PythonRuntimeInfo | undefined> {
		const installPath = this._getInstallPath(version);
		const pythonPath = this._getPythonExecutablePath(installPath);

		if (!existsSync(pythonPath)) {
			return undefined;
		}

		const versionInfo = await this.getPythonVersion(pythonPath);
		if (!versionInfo) {
			return undefined;
		}

		return {
			version: versionInfo,
			executablePath: pythonPath,
			rootPath: installPath,
			platform: process.platform as 'win32' | 'darwin' | 'linux',
			arch: process.arch === 'x64' ? 'x64' : 'arm64',
			isBuiltin: true
		};
	}

	/**
	 * Get system Python path
	 */
	private async _getSystemPythonPath(): Promise<string | undefined> {
		const commands = process.platform === 'win32'
			? ['python', 'python3', 'py']
			: ['python3', 'python'];

		for (const cmd of commands) {
			try {
				const { stdout } = await execAsync(`${cmd} -c "import sys; print(sys.executable)"`);
				const path = stdout.trim();
				if (path && existsSync(path)) {
					return path;
				}
			} catch {
				// Continue to next command
			}
		}

		return undefined;
	}
}
