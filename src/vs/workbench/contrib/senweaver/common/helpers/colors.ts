/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';

// editCodeService colors
const sweepBG = new Color(new RGBA(100, 100, 100, .2));
const highlightBG = new Color(new RGBA(100, 100, 100, .1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));

const acceptBG = new Color(new RGBA(155, 185, 85, .1)); // default is RGBA(155, 185, 85, .2)
const rejectBG = new Color(new RGBA(255, 0, 0, .1)); // default is RGBA(255, 0, 0, .2)

// Widget colors
export const acceptAllBg = 'rgb(30, 133, 56)'
export const acceptBg = '#2d2d30'
export const acceptBorder = 'none'
export const acceptTextColor = '#4ade80' // green-400

export const rejectAllBg = 'rgb(207, 40, 56)'
export const rejectBg = '#2d2d30'
export const rejectBorder = 'none'
export const rejectTextColor = '#9ca3af' // gray-400

export const buttonFontSize = '11px'
export const buttonTextColor = 'white'



const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}

// gets converted to --vscode-senweaver-greenBG, see senweaver.css, asCssVariable
registerColor('senweaver.greenBG', configOfBG(acceptBG), '', true);
registerColor('senweaver.redBG', configOfBG(rejectBG), '', true);
registerColor('senweaver.sweepBG', configOfBG(sweepBG), '', true);
registerColor('senweaver.highlightBG', configOfBG(highlightBG), '', true);
registerColor('senweaver.sweepIdxBG', configOfBG(sweepIdxBG), '', true);
