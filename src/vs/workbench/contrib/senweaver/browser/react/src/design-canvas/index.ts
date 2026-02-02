/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Design Canvas 模块 - 预览面板的模块化组件
 *
 * 导出所有模块和接口，方便统一导入
 */

// 事件总线
export { PreviewEventBus, PreviewEvents } from './previewEventBus.js';

// 工具栏模块
export { ToolbarModule } from './toolbarModule.js';

// 流程项模块
export { FlowModule } from './flowModule.js';

// 内容展示模块
export { ContentModule } from './contentModule.js';
