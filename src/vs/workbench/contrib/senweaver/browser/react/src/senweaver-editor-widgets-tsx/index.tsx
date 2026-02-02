/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { SenweaverCommandBarMain } from './SenweaverCommandBar.js'
import { SenweaverSelectionHelperMain } from './SenweaverSelectionHelper.js'
import { EditPredictionWidgetMain } from './EditPredictionWidget.js'

export const mountSenweaverCommandBar = mountFnGenerator(SenweaverCommandBarMain)

export const mountSenweaverSelectionHelper = mountFnGenerator(SenweaverSelectionHelperMain)

export const mountEditPredictionWidget = mountFnGenerator(EditPredictionWidgetMain)

