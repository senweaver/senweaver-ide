/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isLinux, isMacintosh, isWindows } from '../../../../../base/common/platform.js';

// import { OS, OperatingSystem } from '../../../../../base/common/platform.js';
// alternatively could use ^ and OS === OperatingSystem.Windows ? ...



export const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null

/**
 * 获取当前系统时间的格式化字符串
 * 用于让 AI 知道当前的日期和时间
 */
export function getCurrentDateTime(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const day = now.getDate();
	const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
	const weekday = weekdays[now.getDay()];
	const hours = now.getHours().toString().padStart(2, '0');
	const minutes = now.getMinutes().toString().padStart(2, '0');

	return `${year}年${month}月${day}日 星期${weekday} ${hours}:${minutes}`;
}

