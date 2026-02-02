/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import { isWindows } from '../../../../base/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';

const execAsync = promisify(exec);

export interface ICondaEnvironmentInfo {
	name: string;
	path: string;
	isActive: boolean;
}

export interface ICondaEnvDetectorService {
	readonly _serviceBrand: undefined;
	isCondaAvailable(): Promise<boolean>;
	getEnvironments(): Promise<ICondaEnvironmentInfo[]>;
}

export class CondaEnvDetectorService extends Disposable implements ICondaEnvDetectorService {
	declare readonly _serviceBrand: undefined;
	
	private _condaAvailable: boolean | undefined;
	private _environmentsCache: ICondaEnvironmentInfo[] | undefined;
	private _lastCheckTime: number = 0;
	private readonly _cacheDuration = 30000; // 30 seconds cache
	
	private readonly _onDidChangeEnvironments = this._register(new Emitter<ICondaEnvironmentInfo[]>());
	readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;
	
	async isCondaAvailable(): Promise<boolean> {
		if (this._condaAvailable !== undefined) {
			return this._condaAvailable;
		}

		try {
			const command = isWindows ? 'where conda' : 'which conda';
			await execAsync(command, { timeout: 5000 });
			this._condaAvailable = true;
			return true;
		} catch {
			this._condaAvailable = false;
			return false;
		}
	}

	async getEnvironments(): Promise<ICondaEnvironmentInfo[]> {
		// Use cache if available and fresh
		const now = Date.now();
		if (this._environmentsCache && (now - this._lastCheckTime) < this._cacheDuration) {
			return this._environmentsCache;
		}

		const available = await this.isCondaAvailable();
		if (!available) {
			return [];
		}

		try {
			const { stdout } = await execAsync('conda env list', { timeout: 10000 });
			const lines = stdout.split('\n');
			const environments: ICondaEnvironmentInfo[] = [];

			for (const line of lines) {
				// Skip comments and empty lines
				if (line.trim().startsWith('#') || !line.trim()) {
					continue;
				}

				// Parse environment name and path
				const parts = line.trim().split(/\s+/);
				if (parts.length >= 2) {
					const name = parts[0];
					const isActive = line.includes('*');
					const path = parts[parts.length - 1];

					// Validate this looks like a real environment
					if (name && path && !name.startsWith('$') && !name.startsWith('>')) {
						environments.push({
							name,
							path,
							isActive
						});
					}
				}
			}

			// Update cache
			this._environmentsCache = environments;
			this._lastCheckTime = now;
			this._onDidChangeEnvironments.fire(environments);

			return environments;
		} catch (error) {
			console.error('Failed to get conda environments:', error);
			return [];
		}
	}

	clearCache(): void {
		this._environmentsCache = undefined;
		this._lastCheckTime = 0;
	}
}
