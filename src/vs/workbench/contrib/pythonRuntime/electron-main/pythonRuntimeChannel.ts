/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { PythonDownloadOptions } from '../common/pythonRuntimeTypes.js';
import { PythonRuntimeMainService } from './pythonRuntimeMainService.js';

/**
 * Python Runtime IPC Channel
 */
export class PythonRuntimeChannel implements IServerChannel {
	constructor(private readonly service: PythonRuntimeMainService) {}

	listen(_: unknown, event: string): Event<any> {
		// No events to listen to currently
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, args?: any[]): Promise<any> {
		switch (command) {
			case 'downloadAndInstall':
				return this.service.downloadAndInstall(args![0] as PythonDownloadOptions);
			default:
				throw new Error(`Command not found: ${command}`);
		}
	}
}
