/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { DesignData } from '../../../senweaverDesignerPreviewEditor.js';

/**
 * 预览面板事件总线 - 用于模块间通信
 * 提供发布-订阅模式的事件通信机制
 */
export class PreviewEventBus {
	private listeners: Map<string, Set<(data: any) => void>> = new Map();

	/**
	 * 订阅事件
	 */
	on(eventType: string, handler: (data: any) => void): void {
		if (!this.listeners.has(eventType)) {
			this.listeners.set(eventType, new Set());
		}
		this.listeners.get(eventType)!.add(handler);
	}

	/**
	 * 取消订阅事件
	 */
	off(eventType: string, handler: (data: any) => void): void {
		const handlers = this.listeners.get(eventType);
		if (handlers) {
			handlers.delete(handler);
		}
	}

	/**
	 * 发布事件
	 */
	emit(eventType: string, data?: any): void {
		const handlers = this.listeners.get(eventType);
		if (handlers) {
			handlers.forEach(handler => {
				try {
					handler(data);
				} catch (error) {
					console.error(`[PreviewEventBus] Error in event handler for ${eventType}:`, error);
				}
			});
		}
	}

	/**
	 * 清空所有监听器
	 */
	clear(): void {
		this.listeners.clear();
	}

	/**
	 * 销毁事件总线
	 */
	dispose(): void {
		this.clear();
	}
}

/**
 * 预览面板事件类型定义
 */
export interface PreviewEvents {
	// 工具栏事件
	'toolbar:editDesign': { index: number };
	'toolbar:forkDesign': { index: number };
	'toolbar:exportDesign': { index: number };
	'toolbar:clearAllDesigns': void;

	// 流程项事件
	'flow:selectDesign': { index: number };
	'flow:deleteDesign': { index: number };
	'flow:updateItems': { items: any[]; count: number };

	// 内容展示事件
	'content:updateDesign': { index: number; html: string; css: string };
	'content:navigationTriggered': { sourceIndex: number; targetIndex: number };

	// 全局事件
	'preview:updateFlowAndContent': {
		flowItems: any[];
		designCount: number;
		selectedIndex: number;
		designs: DesignData[];
		content: { html: string; css: string } | null;
	};
	'preview:designsUpdated': { designs: DesignData[] };
}
