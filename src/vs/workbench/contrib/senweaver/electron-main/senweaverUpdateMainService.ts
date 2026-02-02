/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { ISenweaverUpdateService } from '../common/senweaverUpdateService.js';
import { SenweaverCheckUpdateResponse } from '../common/senweaverUpdateServiceTypes.js';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';



export class SenweaverMainUpdateService extends Disposable implements ISenweaverUpdateService {
	_serviceBrand: undefined;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService,
	) {
		super()
	}

	async download(url: string, targetPath: string): Promise<{ filePath: string }> {
		const maxRedirects = 10;
		const normalizeRedirect = (u: string): string => {
			// 对 download.senweaver.com 保持 http（该域证书不匹配，强升 https 会报 ERR_TLS_CERT_ALTNAME_INVALID）
			try {
				const parsed = new URL(u);
				if (parsed.hostname === 'download.senweaver.com') {
					console.warn('[SenweaverUpdateMain] WARNING: using http download for download.senweaver.com due to cert mismatch');
					return parsed.toString().replace(/^https:/, 'http:'); // 确保是 http
				}
			} catch {
				// ignore parse errors, fallback to old logic
			}
			if (u.startsWith('http://')) {
				return 'https://' + u.slice('http://'.length);
			}
			return u;
		};

		const downloadOnce = (u: string, redirectLeft: number): Promise<void> => {
			return new Promise((resolve, reject) => {
				const normalizedUrl = normalizeRedirect(u);
				const parsed = new URL(normalizedUrl);
				const client = parsed.protocol === 'https:' ? https : http;
				const req = client.request(
					{
						method: 'GET',
						host: parsed.hostname,
						path: parsed.pathname + parsed.search,
						headers: {
							'User-Agent': 'SenWeaver-Update-Downloader',
							'Accept': '*/*'
						}
					},
					(res) => {
						const status = res.statusCode ?? 0;
						if (status >= 300 && status < 400) {
							const location = res.headers.location;
							res.resume();
							if (!location) {
								reject(new Error('重定向响应缺少 Location 头'));
								return;
							}
							if (redirectLeft <= 0) {
								reject(new Error('重定向次数过多'));
								return;
							}
							const nextUrl = new URL(location, normalizedUrl).toString();
							downloadOnce(nextUrl, redirectLeft - 1).then(resolve, reject);
							return;
						}

						if (status >= 400) {
							res.resume();
							reject(new Error(`Server returned ${status}`));
							return;
						}

						const fileStream = fs.createWriteStream(targetPath);
						const onError = (e: unknown) => {
							try { fileStream.close(); } catch { }
							console.error('[SenweaverUpdateMain] stream error:', e);
							reject(e instanceof Error ? e : new Error(String(e)));
						};

						fileStream.on('error', onError);
						res.on('error', onError);
						res.pipe(fileStream);
						fileStream.on('finish', () => {
							fileStream.close();
							resolve();
						});
					}
				);
				req.on('error', (e) => {
					console.error('[SenweaverUpdateMain] request error:', e);
					reject(e);
				});
				req.end();
			});
		};

		await downloadOnce(url, maxRedirects);
		return { filePath: targetPath };
	}


	async check(explicit: boolean): Promise<SenweaverCheckUpdateResponse> {

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

		if (isDevMode) {
			return { message: null } as const
		}

		// if disabled and not explicitly checking, return early
		if (this._updateService.state.type === StateType.Disabled) {
			if (!explicit)
				return { message: null } as const
		}

		this._updateService.checkForUpdates(false) // implicity check, then handle result ourselves

		if (this._updateService.state.type === StateType.Uninitialized) {
			// The update service hasn't been initialized yet
			return { message: explicit ? 'Checking for updates soon...' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.Idle) {
			// No updates currently available
			return { message: explicit ? 'No updates found!' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.CheckingForUpdates) {
			// Currently checking for updates
			return { message: explicit ? 'Checking for updates...' : null } as const
		}

		if (this._updateService.state.type === StateType.AvailableForDownload) {
			// Update available but requires manual download (mainly for Linux)
			return { message: 'A new update is available!', action: 'download', } as const
		}

		if (this._updateService.state.type === StateType.Downloading) {
			// Update is currently being downloaded
			return { message: explicit ? 'Currently downloading update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Downloaded) {
			// Update has been downloaded but not yet ready
			return { message: explicit ? 'An update is ready to be applied!' : null, action: 'apply' } as const
		}

		if (this._updateService.state.type === StateType.Updating) {
			// Update is being applied
			return { message: explicit ? 'Applying update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Ready) {
			// Update is ready
			return { message: 'Restart SenWeaver to update!', action: 'restart' } as const
		}

		if (this._updateService.state.type === StateType.Disabled) {
			return await this._manualCheckGHTagIfDisabled(explicit)
		}
		return null
	}






	private async _manualCheckGHTagIfDisabled(explicit: boolean): Promise<SenweaverCheckUpdateResponse> {
		try {
			const response = await fetch('https://api.github.com/repos/SenweaverEditor/binaries/releases/latest');

			const data = await response.json();
			const version = data.tag_name;

			const myVersion = this._productService.version
			const latestVersion = version

			const isUpToDate = myVersion === latestVersion // only makes sense if response.ok

			let message: string | null
			let action: 'reinstall' | undefined

			// explicit
			if (explicit) {
				if (response.ok) {
					if (!isUpToDate) {
						message = 'A new version of SenWeaver is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!'
						action = 'reinstall'
					}
					else {
						message = 'SenWeaver is up-to-date!'
					}
				}
				else {
					message = `An error occurred when fetching the latest GitHub release tag. Please try again in ~5 minutes, or reinstall.`
					action = 'reinstall'
				}
			}
			// not explicit
			else {
				if (response.ok && !isUpToDate) {
					message = 'A new version of SenWeaver is available! Please reinstall (auto-updates are disabled on this OS) - it only takes a second!'
					action = 'reinstall'
				}
				else {
					message = null
				}
			}
			return { message, action } as const
		}
		catch (e) {
			if (explicit) {
				return {
					message: `An error occurred when fetching the latest GitHub release tag: ${e}. Please try again in ~5 minutes.`,
					action: 'reinstall',
				}
			}
			else {
				return { message: null } as const
			}
		}
	}
}
