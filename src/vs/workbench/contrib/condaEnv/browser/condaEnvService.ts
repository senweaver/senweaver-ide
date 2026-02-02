/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ICondaEnvService, ICondaEnvironment } from '../common/condaEnvService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ICondaEnvDetectorService } from '../common/condaEnvDetector.js';

const ACTIVE_CONDA_ENV_KEY = 'condaEnv.activeEnvironment';

export class CondaEnvService extends Disposable implements ICondaEnvService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveEnvironment = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveEnvironment: Event<string | undefined> = this._onDidChangeActiveEnvironment.event;

	private _activeEnvironment: string | undefined;
	private _condaAvailable: boolean | undefined;
	private _environments: ICondaEnvironment[] | undefined;

	private _detectPromise: Promise<void> | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ICondaEnvDetectorService private readonly detectorService: ICondaEnvDetectorService
	) {
		super();

		// Load saved active environment
		this._activeEnvironment = this.storageService.get(ACTIVE_CONDA_ENV_KEY, StorageScope.WORKSPACE);
		
		// Check if user has configured conda environments in storage
		const envList = this.storageService.get('condaEnv.environmentList', StorageScope.APPLICATION);
		if (envList) {
			try {
				this._environments = JSON.parse(envList);
				this._condaAvailable = true;
			} catch {
				// Ignore parse errors
			}
		}
		
		// Start automatic detection in background
		this.detectCondaEnvironments();
	}

	async isCondaAvailable(): Promise<boolean> {
		// Wait for detection to complete
		if (this._detectPromise) {
			await this._detectPromise;
		}
		return this._condaAvailable ?? false;
	}

	private async detectCondaEnvironments(): Promise<void> {
		if (this._detectPromise) {
			return this._detectPromise;
		}

		this._detectPromise = this._doDetectCondaEnvironments();
		return this._detectPromise;
	}

	private async _doDetectCondaEnvironments(): Promise<void> {
		try {
			// Check if conda is available
			const available = await this.detectorService.isCondaAvailable();
			this._condaAvailable = available;

			if (!available) {
				// If conda is not available, keep any manually added environments
				if (!this._environments || this._environments.length === 0) {
					this._environments = [];
				}
				return;
			}

			// Get environments from system
			const detectedEnvs = await this.detectorService.getEnvironments();
			
			if (detectedEnvs.length > 0) {
				// Convert to our format
				this._environments = detectedEnvs.map(env => ({
					name: env.name,
					path: env.path,
					isActive: env.isActive
				}));
				
				// Save to storage for offline use
				this.saveEnvironments();
				
				console.log(`[Conda] Detected ${detectedEnvs.length} environments:`, detectedEnvs.map(e => e.name).join(', '));
			} else if (!this._environments || this._environments.length === 0) {
				// No environments detected and none cached, add base as fallback
				this._environments = [
					{ name: 'base', path: '', isActive: false }
				];
			}
		} catch (error) {
			console.error('[Conda] Failed to detect environments:', error);
			this._condaAvailable = false;
			
			// Keep cached environments if detection fails
			if (!this._environments || this._environments.length === 0) {
				this._environments = [];
			}
		}
	}

	/**
	 * Refresh conda environments by re-detecting from system
	 */
	async refreshEnvironments(): Promise<void> {
		try {
			// Clear cache in detector service
			this.detectorService.clearCache();
			
			// Clear local cache
			this._detectPromise = undefined;
			this._condaAvailable = undefined;
			
			// Re-detect
			await this.detectCondaEnvironments();
			
			// Fire change event to update UI
			this._onDidChangeActiveEnvironment.fire(this._activeEnvironment);
			
			console.log('[Conda] Environments refreshed');
		} catch (error) {
			console.error('[Conda] Failed to refresh environments:', error);
		}
	}

	async getEnvironments(): Promise<ICondaEnvironment[]> {
		// Wait for detection to complete
		if (this._detectPromise) {
			await this._detectPromise;
		}
		return this._environments || [];
	}

	addEnvironment(name: string, path: string): void {
		if (!this._environments) {
			this._environments = [];
		}
		
		// Check if environment already exists
		const exists = this._environments.some(env => env.name === name);
		if (!exists) {
			this._environments.push({ name, path, isActive: false });
			this.saveEnvironments();
		}
	}

	private saveEnvironments(): void {
		if (this._environments) {
			this.storageService.store('condaEnv.environmentList', JSON.stringify(this._environments), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}

	getActiveEnvironment(): string | undefined {
		return this._activeEnvironment;
	}

	async setActiveEnvironment(envName: string | undefined): Promise<void> {
		this._activeEnvironment = envName;

		// Save to storage
		if (envName) {
			this.storageService.store(ACTIVE_CONDA_ENV_KEY, envName, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(ACTIVE_CONDA_ENV_KEY, StorageScope.WORKSPACE);
		}

		this._onDidChangeActiveEnvironment.fire(envName);
	}
}
