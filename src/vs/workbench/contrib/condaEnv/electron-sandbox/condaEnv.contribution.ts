/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ICondaEnvDetectorService } from '../common/condaEnvDetector.js';
import { CondaEnvDetectorService } from './condaEnvDetectorService.js';

// Override the browser registration with the electron-sandbox version
registerSingleton(ICondaEnvDetectorService, CondaEnvDetectorService, InstantiationType.Delayed);
