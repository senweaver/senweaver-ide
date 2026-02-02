/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { SenweaverCheckUpdateResponse } from './senweaverUpdateServiceTypes.js';



export interface ISenweaverUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<SenweaverCheckUpdateResponse>;
	download: (url: string, targetPath: string) => Promise<{ filePath: string }>;
}


export const ISenweaverUpdateService = createDecorator<ISenweaverUpdateService>('SenweaverUpdateService');


// implemented by calling channel
export class SenweaverUpdateService implements ISenweaverUpdateService {

	readonly _serviceBrand: undefined;
	private readonly updateService: ISenweaverUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use senweaverUpdateMainService.ts
		this.updateService = ProxyChannel.toService<ISenweaverUpdateService>(mainProcessService.getChannel('senweaver-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: ISenweaverUpdateService['check'] = async (explicit) => {
		const res = await this.updateService.check(explicit)
		return res
	}

	download: ISenweaverUpdateService['download'] = async (url, targetPath) => {
		const res = await this.updateService.download(url, targetPath)
		return res
	}
}

registerSingleton(ISenweaverUpdateService, SenweaverUpdateService, InstantiationType.Eager);


