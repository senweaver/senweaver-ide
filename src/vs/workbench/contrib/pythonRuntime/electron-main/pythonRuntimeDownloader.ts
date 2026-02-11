/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createWriteStream, existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { createGunzip } from 'zlib';
import { createReadStream } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { platform, arch } from 'os';
import { DownloadProgress, PythonDownloadOptions, PythonRuntimeInfo, getPythonDownloadUrl, parsePythonVersion } from '../common/pythonRuntimeTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { extract } from '../../../../base/node/zip.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
// @ts-ignore - tar-stream doesn't have type definitions
import * as tar from 'tar-stream';

const execAsync = promisify(exec);

/**
 * Python Runtime Downloader
 * Responsible for downloading and installing Python runtime from python.org
 */
export class PythonRuntimeDownloader {
	constructor(
		private readonly storagePath: string,
		private readonly logService: ILogService,
		private readonly notificationService?: INotificationService
	) {
		// Ensure storage directory exists
		if (!existsSync(storagePath)) {
			mkdirSync(storagePath, { recursive: true });
		}
	}

	/**
	 * Download and install Python
	 */
	async downloadAndInstall(options: PythonDownloadOptions): Promise<PythonRuntimeInfo> {
		const { version, onProgress, showProgress } = options;
		const platformName = platform();
		const archName = arch();

		// Get download URL
		const downloadUrl = getPythonDownloadUrl(version, platformName as NodeJS.Platform, archName);
		this.logService.info(`[PythonRuntime] Downloading Python ${version} from ${downloadUrl}`);

		// Show download notification
		if (showProgress && this.notificationService) {
			this.notificationService.info(`Starting download of Python ${version}...`);
		}

		// Download file
		const downloadPath = join(this.storagePath, `python-${version}-${platformName}-${archName}.tmp`);
		await this.downloadFile(downloadUrl, downloadPath, onProgress);

		// Extract/install
		const installPath = join(this.storagePath, `python-${version}-${platformName}-${archName}`);
		await this.extractAndInstall(downloadPath, installPath, platformName, archName);

		// Verify installation
		const pythonPath = this.getPythonExecutablePath(installPath, platformName, archName);
		if (!existsSync(pythonPath)) {
			throw new Error(`Python executable not found at ${pythonPath}`);
		}

		// Verify version
		const versionInfo = await this.verifyVersion(pythonPath, version);
		if (!versionInfo) {
			throw new Error(`Failed to verify Python version`);
		}

		// Save metadata
		await this.saveMetadata(installPath, version, platformName, archName);

		this.logService.info(`[PythonRuntime] Python ${version} installed successfully at ${installPath}`);

		return {
			version: versionInfo,
			executablePath: pythonPath,
			rootPath: installPath,
			platform: platformName as 'win32' | 'darwin' | 'linux',
			arch: archName === 'x64' ? 'x64' : 'arm64',
			isBuiltin: true,
			installedAt: Date.now()
		};
	}

	/**
	 * Download file
	 */
	private async downloadFile(url: string, destination: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
		const https = await import('https');
		const http = await import('http');
		const urlObj = new URL(url);
		const client = urlObj.protocol === 'https:' ? https : http;

		return new Promise((resolve, reject) => {
			const request = client.get(url, (response) => {
				if (response.statusCode !== 200) {
					reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
					return;
				}

				const totalSize = parseInt(response.headers['content-length'] || '0', 10);
				let downloaded = 0;
				const startTime = Date.now();

				const fileStream = createWriteStream(destination);
				
				response.on('data', (chunk: Buffer) => {
					downloaded += chunk.length;
					const elapsed = (Date.now() - startTime) / 1000;
					const speed = elapsed > 0 ? downloaded / elapsed : 0;

					if (onProgress) {
						onProgress({
							downloaded,
							total: totalSize,
							speed,
							percentage: totalSize > 0 ? (downloaded / totalSize) * 100 : 0
						});
					}
				});

				response.on('end', () => {
					fileStream.end();
					resolve();
				});

				response.on('error', (error: Error) => {
					fileStream.destroy();
					reject(error);
				});

				response.pipe(fileStream);
			});

			request.on('error', reject);
		});
	}

	/**
	 * Extract and install
	 */
	private async extractAndInstall(archivePath: string, installPath: string, platformName: string, archName: string): Promise<void> {
		if (existsSync(installPath)) {
			// If already exists, remove it first
			rmSync(installPath, { recursive: true, force: true });
		}

		mkdirSync(installPath, { recursive: true });

		if (platformName === 'win32') {
			// Windows: ZIP file - use existing extract function
			await extract(archivePath, installPath, { overwrite: true }, CancellationToken.None);
		} else {
			// macOS/Linux: tar.gz file
			await this.extractTarGz(archivePath, installPath);
		}

		// Clean up temporary file
		if (existsSync(archivePath)) {
			unlinkSync(archivePath);
		}
	}

	/**
	 * Extract tar.gz file (macOS/Linux)
	 */
	private async extractTarGz(tarGzPath: string, extractTo: string): Promise<void> {
		const extractStream = tar.extract();
		const gunzip = createGunzip();
		const readStream = createReadStream(tarGzPath);

		return new Promise((resolve, reject) => {
			extractStream.on('entry', (header: any, stream: any, next: () => void) => {
				const filePath = join(extractTo, header.name);
				const fileDir = dirname(filePath);

				if (header.type === 'directory') {
					mkdirSync(filePath, { recursive: true });
					stream.resume();
					next();
					return;
				}

				mkdirSync(fileDir, { recursive: true });
				const writeStream = createWriteStream(filePath);
				stream.pipe(writeStream);
				writeStream.on('finish', next);
			});

			extractStream.on('finish', resolve);
			extractStream.on('error', reject);

			readStream.pipe(gunzip).pipe(extractStream);
		});
	}

	/**
	 * Get Python executable file path
	 */
	private getPythonExecutablePath(rootPath: string, platformName: string, archName: string): string {
		if (platformName === 'win32') {
			return join(rootPath, 'python.exe');
		} else {
			return join(rootPath, 'bin', 'python3');
		}
	}

	/**
	 * Verify Python version
	 */
	private async verifyVersion(pythonPath: string, expectedVersion: string): Promise<ReturnType<typeof parsePythonVersion> | null> {
		try {
			const { stdout } = await execAsync(`"${pythonPath}" --version`);
			const versionMatch = stdout.match(/Python (\d+\.\d+\.\d+)/);
			if (versionMatch) {
				return parsePythonVersion(versionMatch[1]);
			}
		} catch (error) {
			this.logService.error(`[PythonRuntime] Failed to verify version: ${error}`);
		}
		return null;
	}

	/**
	 * Save metadata
	 */
	private async saveMetadata(installPath: string, version: string, platformName: string, archName: string): Promise<void> {
		const metadataPath = join(installPath, '.metadata.json');
		const metadata = {
			version,
			platform: platformName,
			arch: archName,
			installedAt: Date.now()
		};
		writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
	}
}
