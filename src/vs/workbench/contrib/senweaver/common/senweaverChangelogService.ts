/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

export interface IChangelogData {
	success: boolean;
	data?: {
		version: string;
		changelog: string;
		file_path: string;
	};
}

export interface ISenweaverChangelogService {
	readonly _serviceBrand: undefined;
	fetchChangelog(version: string): Promise<IChangelogData | null>;
}

export const ISenweaverChangelogService = createDecorator<ISenweaverChangelogService>('SenweaverChangelogService');

export class SenweaverChangelogService implements ISenweaverChangelogService {
	readonly _serviceBrand: undefined;

	private readonly apiBaseUrl: string;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IProductService private readonly productService: IProductService
	) {
		// 从 product.json 获取 API 配置
		this.apiBaseUrl = this.productService.senweaverApiConfig?.apiBaseUrl || 'https://ide-api.senweaver.com';
	}

	async fetchChangelog(version: string): Promise<IChangelogData | null> {
		try {
			const url = `${this.apiBaseUrl}/api/version/${version}/changelog`;

			const response = await this.requestService.request({
				type: 'GET',
				url: url,
				headers: {
					'accept': 'application/json'
				}
			}, CancellationToken.None);

			if (response.res.statusCode === 200) {
				const data = await asJson<IChangelogData>(response);
				return data;
			} else {
				return null;
			}
		} catch (error) {
			return null;
		}
	}
}

registerSingleton(ISenweaverChangelogService, SenweaverChangelogService, InstantiationType.Delayed);
