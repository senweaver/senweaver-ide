/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ICondaEnvService } from '../common/condaEnvService.js';
import { CondaEnvService } from './condaEnvService.js';
import { registerCondaEnvCommands } from './condaEnvCommands.js';
import { ICondaEnvDetectorService } from '../common/condaEnvDetector.js';
import { CondaEnvDetectorProxyService } from './condaEnvDetectorProxy.js';

// Register the conda environment detector service (browser stub)
registerSingleton(ICondaEnvDetectorService, CondaEnvDetectorProxyService, InstantiationType.Delayed);

// Register the conda environment service
registerSingleton(ICondaEnvService, CondaEnvService, InstantiationType.Delayed);

// Register commands
registerCondaEnvCommands();

// Import contributions to ensure they are registered
import './condaEnvStatusbarItem.js';
import './condaEnvTerminalContribution.js';
