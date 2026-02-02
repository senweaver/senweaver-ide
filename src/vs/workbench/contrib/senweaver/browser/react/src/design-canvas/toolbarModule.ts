/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PreviewEventBus } from './previewEventBus.js';

/**
 * 工具栏模块 - 管理预览面板的工具栏区域
 * 包括编辑、Fork、导出、清空等操作按钮
 */
export class ToolbarModule {
	private eventBus: PreviewEventBus;
	private currentSelectedIndex: number = 0;

	constructor(eventBus: PreviewEventBus) {
		this.eventBus = eventBus;
	}

	/**
	 * 获取工具栏HTML
	 */
	getToolbarHTML(): string {
		return `
	<!-- 工具栏 -->
	<div class="preview-header">
		<div>
			<span class="preview-title">设计画布</span>
			<span class="design-count" id="design-count">0 个UI单元</span>
		</div>
		<div class="toolbar-actions">
			<button class="toolbar-btn" onclick="editCurrentDesign()" title="编辑当前UI">
				✏️ 编辑
			</button>
			<button class="toolbar-btn" onclick="forkCurrentDesign()" title="复制并迭代">
				🔄 Fork
			</button>
			<button class="toolbar-btn" onclick="exportAllDesigns()" title="选择前端框架，借助AI优化并导出为本地项目">
				🚀 导出项目
			</button>
			<button class="toolbar-btn" onclick="clearAllDesigns()" title="清除所有设计">
				🗑️ 清空
			</button>
		</div>
	</div>
		`;
	}

	/**
	 * 获取工具栏样式
	 */
	getToolbarStyles(): string {
		return `
		/* 工具栏 */
		.preview-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 10px 16px;
			background: var(--vscode-editor-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			flex-shrink: 0;
			min-height: 40px;
			width: 100%;
			position: relative;
			z-index: 10;
		}

		.preview-title {
			font-size: 14px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.design-count {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			margin-left: 8px;
		}

		.toolbar-actions {
			display: flex;
			gap: 8px;
			align-items: center;
		}

		.toolbar-btn {
			background: transparent;
			color: var(--vscode-foreground);
			border: 1px solid var(--vscode-panel-border);
			padding: 4px 12px;
			font-size: 11px;
			cursor: pointer;
			transition: all 0.2s ease;
			border-radius: 4px;
		}

		.toolbar-btn:hover {
			background: var(--vscode-toolbar-hoverBackground);
			border-color: var(--vscode-focusBorder);
		}
		`;
	}

	/**
	 * 更新设计计数
	 */
	updateDesignCount(count: number): void {
		const countSpan = document.getElementById('design-count');
		if (countSpan) {
			countSpan.textContent = count + ' 个UI单元';
		}
	}

	/**
	 * 更新当前选中的设计索引
	 */
	setCurrentSelectedIndex(index: number): void {
		this.currentSelectedIndex = index;
	}

	/**
	 * 编辑当前设计
	 */
	editCurrentDesign(): void {
		this.eventBus.emit('toolbar:editDesign', { index: this.currentSelectedIndex });
	}

	/**
	 * Fork当前设计
	 */
	forkCurrentDesign(): void {
		this.eventBus.emit('toolbar:forkDesign', { index: this.currentSelectedIndex });
	}

	/**
	 * 导出所有设计代码（显示框架选择对话框，借助AI优化并导出为本地项目）
	 */
	exportAllDesigns(): void {
		this.eventBus.emit('toolbar:exportAllDesigns');
	}

	/**
	 * 清空所有设计
	 */
	clearAllDesigns(): void {
		this.eventBus.emit('toolbar:clearAllDesigns');
	}

	/**
	 * 销毁模块
	 */
	dispose(): void {
		// 清理资源
	}
}
