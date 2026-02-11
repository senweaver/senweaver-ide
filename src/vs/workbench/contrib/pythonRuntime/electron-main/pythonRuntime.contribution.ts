/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PythonRuntimeMainService } from './pythonRuntimeMainService.js';
import { PythonRuntimeChannel } from './pythonRuntimeChannel.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Server as ElectronIPCServer } from '../../../../base/parts/ipc/electron-main/ipc.electron.js';

/**
 * Register Python Runtime IPC Channel
 */
export function registerPythonRuntimeChannel(
	mainProcessElectronServer: ElectronIPCServer,
	instantiationService: IInstantiationService
): void {
	const service = instantiationService.createInstance(PythonRuntimeMainService);
	const channel = new PythonRuntimeChannel(service);
	mainProcessElectronServer.registerChannel('python-runtime', channel);
}
