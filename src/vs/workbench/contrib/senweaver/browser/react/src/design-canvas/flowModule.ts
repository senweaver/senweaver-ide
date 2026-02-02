/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PreviewEventBus } from './previewEventBus.js';

/**
 * 流程项模块 - 管理UI流程项区域
 * 包括流程项的渲染、缩放、拖拽、连线等功能
 */
export class FlowModule {
	private eventBus: PreviewEventBus;
	private designsData: any[] = [];
	private zoomLevel = 1.0;
	private panX = 0;
	private panY = 0;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private dragStartPanX = 0;
	private dragStartPanY = 0;
	private redrawTimeout: any = null;

	constructor(eventBus: PreviewEventBus) {
		this.eventBus = eventBus;
	}

	/**
	 * 获取流程区域HTML
	 */
	getFlowHTML(): string {
		return `
	<!-- UI流程区域 -->
	<div class="ui-flow-container" id="ui-flow-container">
		<!-- 缩放控制 -->
		<div class="zoom-controls">
			<button class="zoom-btn" onclick="zoomOut()" title="缩小 (Ctrl + 滚轮向下)">−</button>
			<div class="zoom-indicator" id="zoom-indicator">100%</div>
			<button class="zoom-btn" onclick="zoomIn()" title="放大 (Ctrl + 滚轮向上)">+</button>
			<button class="zoom-btn" onclick="zoomReset()" title="还原 (Ctrl + 0)">⊙</button>
		</div>
		<!-- 流程项滚动容器 -->
		<div class="flow-scroll-wrapper" id="flow-scroll-wrapper">
			<!-- SVG连线层 -->
			<svg class="flow-connections-svg" id="flow-connections-svg"></svg>
			<!-- 流程项容器 -->
			<div class="flow-items-container" id="flow-items-container"></div>
		</div>
	</div>
		`;
	}

	/**
	 * 获取流程区域样式
	 */
	getFlowStyles(): string {
		return `
		/* UI流程区域 */
		.ui-flow-container {
			display: flex;
			flex-direction: column;
			gap: 0;
			padding: 12px 16px;
			background: var(--vscode-sideBar-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			flex-shrink: 0;
			min-height: 120px;
			max-height: 300px;
			width: 100%;
			position: relative;
			z-index: 9;
			cursor: grab;
		}

		.ui-flow-container.dragging {
			cursor: grabbing;
		}

		/* 缩放控制按钮 */
		.zoom-controls {
			position: absolute;
			top: 8px;
			right: 8px;
			display: flex;
			gap: 4px;
			z-index: 10;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 4px;
		}

		.zoom-btn {
			background: transparent;
			color: var(--vscode-foreground);
			border: none;
			width: 24px;
			height: 24px;
			font-size: 14px;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: 2px;
			transition: background 0.2s;
		}

		.zoom-btn:hover {
			background: var(--vscode-toolbar-hoverBackground);
		}

		.zoom-indicator {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 0 6px;
			min-width: 40px;
			text-align: center;
			line-height: 24px;
		}

		/* 流程项滚动容器 */
		.flow-scroll-wrapper {
			display: flex;
			flex-direction: column;
			flex: 1;
			overflow-y: auto;
			overflow-x: hidden;
			position: relative;
			min-height: 0;
		}

		.flow-scroll-wrapper::-webkit-scrollbar {
			width: 6px;
		}

		.flow-scroll-wrapper::-webkit-scrollbar-track {
			background: transparent;
		}

		.flow-scroll-wrapper::-webkit-scrollbar-thumb {
			background: var(--vscode-scrollbarSlider-background);
			border-radius: 3px;
		}

		.flow-scroll-wrapper::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
		}

		/* SVG连线层 */
		.flow-connections-svg {
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: auto;
			min-height: 100%;
			pointer-events: none;
			z-index: 1;
			transform-origin: 0 0;
			transition: transform 0.2s ease;
			overflow: visible;
		}

		/* 流程项容器 */
		.flow-items-container {
			display: flex;
			flex-wrap: wrap;
			gap: 0;
			position: relative;
			z-index: 2;
			transform-origin: 0 0;
			transition: transform 0.2s ease;
			align-content: flex-start;
		}

		.flow-item-wrapper {
			display: flex;
			align-items: center;
			flex-shrink: 0;
			width: 20%;
			padding: 8px 4px;
			box-sizing: border-box;
		}

		.flow-item {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			background: var(--vscode-editor-background);
			padding: 12px;
			cursor: pointer;
			transition: all 0.2s ease;
			border: 2px solid var(--vscode-panel-border);
			border-radius: 8px;
			width: 100%;
			position: relative;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		}

		.flow-item:active {
			opacity: 0.6;
			cursor: grabbing;
		}

		.flow-item:hover {
			border-color: var(--vscode-focusBorder);
			transform: translateY(-2px);
			box-shadow: 0 4px 8px rgba(0,0,0,0.15);
		}

		.flow-item.active {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
			box-shadow: 0 4px 12px rgba(0,0,0,0.2);
		}

		.flow-item-preview {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.flow-item-type {
			font-size: 9px;
			text-transform: uppercase;
			font-weight: 600;
			color: var(--vscode-descriptionForeground);
			letter-spacing: 0.5px;
		}

		.flow-item.active .flow-item-type {
			color: var(--vscode-list-activeSelectionForeground);
		}

		.flow-item-title {
			font-size: 11px;
			color: var(--vscode-foreground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: 500;
		}

		.flow-item.active .flow-item-title {
			color: var(--vscode-list-activeSelectionForeground);
		}

		.flow-item-time {
			font-size: 9px;
			color: var(--vscode-descriptionForeground);
		}

		.flow-item-new-badge {
			position: absolute;
			top: 8px;
			left: 8px;
			width: 8px;
			height: 8px;
			background: #ff4444;
			border-radius: 50%;
			animation: pulse 2s ease-in-out infinite;
		}

		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.6; }
		}

		.flow-delete-btn {
			position: absolute;
			top: 4px;
			right: 4px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			color: var(--vscode-icon-foreground);
			font-size: 14px;
			line-height: 1;
			cursor: pointer;
			padding: 2px 4px;
			opacity: 0;
			transition: opacity 0.2s ease;
			border-radius: 3px;
			width: 18px;
			height: 18px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.flow-item:hover .flow-delete-btn {
			opacity: 0.8;
		}

		.flow-delete-btn:hover {
			opacity: 1 !important;
			background: var(--vscode-inputValidation-errorBackground);
			border-color: var(--vscode-inputValidation-errorBorder);
		}

		.flow-connector {
			display: none;
		}
		`;
	}

	/**
	 * 初始化缩放和拖拽功能
	 */
	initZoomAndPan(): void {
		const flowContainer = document.getElementById('ui-flow-container');
		const scrollWrapper = document.getElementById('flow-scroll-wrapper');
		if (!flowContainer) return;

		// 鼠标滚轮缩放 (Ctrl键)
		flowContainer.addEventListener('wheel', (e) => {
			if (e.ctrlKey) {
				e.preventDefault();
				const delta = e.deltaY > 0 ? -0.1 : 0.1;
				this.setZoom(Math.max(0.5, Math.min(2.0, this.zoomLevel + delta)));
			}
		}, { passive: false });

		// 鼠标拖拽平移
		flowContainer.addEventListener('mousedown', (e) => {
			if (e.target === flowContainer || (e.target as any).classList.contains('flow-connections-svg')) {
				this.isDragging = true;
				this.dragStartX = e.clientX;
				this.dragStartY = e.clientY;
				this.dragStartPanX = this.panX;
				this.dragStartPanY = this.panY;
				flowContainer.classList.add('dragging');
				e.preventDefault();
			}
		});

		document.addEventListener('mousemove', (e) => {
			if (this.isDragging) {
				this.panX = this.dragStartPanX + (e.clientX - this.dragStartX);
				this.panY = this.dragStartPanY + (e.clientY - this.dragStartY);
				this.applyTransform();
			}
		});

		document.addEventListener('mouseup', () => {
			if (this.isDragging) {
				this.isDragging = false;
				const flowContainer = document.getElementById('ui-flow-container');
				if (flowContainer) {
					flowContainer.classList.remove('dragging');
				}
			}
		});

		// 滚动事件监听 - 当用户滚动流程项时，重新绘制连接线（使用防抖）
		if (scrollWrapper) {
			scrollWrapper.addEventListener('scroll', () => {
				this.scheduleRedraw();
			});
		}

		// 键盘快捷键
		document.addEventListener('keydown', (e) => {
			if (e.ctrlKey && e.key === '0') {
				e.preventDefault();
				this.zoomReset();
			} else if (e.ctrlKey && e.key === '+') {
				e.preventDefault();
				this.zoomIn();
			} else if (e.ctrlKey && e.key === '-') {
				e.preventDefault();
				this.zoomOut();
			}
		});
	}

	/**
	 * 缩放功能
	 */
	zoomIn(): void {
		this.setZoom(Math.min(this.zoomLevel + 0.1, 2.0));
	}

	zoomOut(): void {
		this.setZoom(Math.max(this.zoomLevel - 0.1, 0.5));
	}

	zoomReset(): void {
		this.setZoom(1.0);
		this.panX = 0;
		this.panY = 0;
		this.applyTransform();
	}

	private setZoom(newZoom: number): void {
		this.zoomLevel = newZoom;
		this.applyTransform();
		this.updateZoomIndicator();
	}

	/**
	 * 应用缩放和平移变换
	 */
	private applyTransform(): void {
		const flowItemsContainer = document.getElementById('flow-items-container');
		const svg = document.getElementById('flow-connections-svg');
		if (flowItemsContainer && svg) {
			flowItemsContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
			svg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
			// 缩放时重新绘制连接线（使用防抖）
			this.scheduleRedraw();
		}
	}

	/**
	 * 防抖重绘连接线
	 */
	private scheduleRedraw(): void {
		if (this.redrawTimeout) {
			clearTimeout(this.redrawTimeout);
		}
		this.redrawTimeout = setTimeout(() => {
			this.drawNavigationConnections();
		}, 50);
	}

	private updateZoomIndicator(): void {
		const indicator = document.getElementById('zoom-indicator');
		if (indicator) {
			indicator.textContent = Math.round(this.zoomLevel * 100) + '%';
		}
	}

	/**
	 * 更新流程项
	 */
	updateFlowItems(flowItems: any[], designCount: number): void {
		const flowContainer = document.getElementById('flow-items-container');
		if (!flowContainer) return;

		flowContainer.innerHTML = '';

		flowItems.forEach((item, idx) => {
			const wrapper = document.createElement('div');
			wrapper.className = 'flow-item-wrapper';

			const flowItem = document.createElement('div');
			flowItem.className = 'flow-item' + (item.isActive ? ' active' : '');
			flowItem.title = item.title;
			flowItem.onclick = () => this.selectDesign(item.index);

			flowItem.draggable = true;
			flowItem.ondragstart = (e) => {
				const designData = JSON.stringify({
					type: 'designUnit',
					index: item.index
				});
				(e.dataTransfer as any).setData('application/json', designData);
				(e.dataTransfer as any).effectAllowed = 'copy';
			};

			const preview = document.createElement('div');
			preview.className = 'flow-item-preview';

			const maxTitleLength = 15;
			let displayTitle = item.title || 'UI ' + (item.index + 1);
			if (displayTitle.length > maxTitleLength) {
				displayTitle = displayTitle.substring(0, maxTitleLength) + '...';
			}

			const isNew = (Date.now() - item.timestamp) < 5000;

			preview.innerHTML = `
				${isNew ? '<div class="flow-item-new-badge"></div>' : ''}
				<div class="flow-item-title" title="${item.title || 'UI ' + (item.index + 1)}">${displayTitle}</div>
				<div class="flow-item-time">${new Date(item.timestamp).toLocaleTimeString()}</div>
			`;

			if (isNew) {
				const timeRemaining = 5000 - (Date.now() - item.timestamp);
				if (timeRemaining > 0) {
					setTimeout(() => {
						const badge = preview.querySelector('.flow-item-new-badge') as HTMLElement;
						if (badge) {
							badge.style.transition = 'opacity 0.3s ease-out';
							badge.style.opacity = '0';
							setTimeout(() => badge.remove(), 300);
						}
					}, timeRemaining);
				}
			}

			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'flow-delete-btn';
			deleteBtn.title = '删除';
			deleteBtn.textContent = '×';
			deleteBtn.onclick = (e) => {
				e.stopPropagation();
				this.deleteDesign(item.index);
			};

			flowItem.appendChild(preview);
			flowItem.appendChild(deleteBtn);
			wrapper.appendChild(flowItem);

			flowContainer.appendChild(wrapper);
		});

		setTimeout(() => this.drawNavigationConnections(), 100);
	}

	/**
	 * 更新设计数据
	 */
	updateDesignsData(designs: any[], _selectedIndex: number): void {
		this.designsData = designs;
	}

	/**
	 * 绘制导航连接线
	 */
	private drawNavigationConnections(): void {
		const svg = document.getElementById('flow-connections-svg');
		const flowContainer = document.getElementById('flow-items-container');
		const scrollWrapper = document.getElementById('flow-scroll-wrapper');

		if (!svg || !flowContainer || !scrollWrapper || !this.designsData || this.designsData.length === 0) {
			return;
		}

		svg.innerHTML = '';

		const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		const colors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];

		colors.forEach((color, idx) => {
			const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
			marker.setAttribute('id', `arrowhead-${idx}`);
			marker.setAttribute('markerWidth', '10');
			marker.setAttribute('markerHeight', '10');
			marker.setAttribute('refX', '9');
			marker.setAttribute('refY', '3');
			marker.setAttribute('orient', 'auto');

			const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
			polygon.setAttribute('points', '0 0, 10 3, 0 6');
			polygon.setAttribute('fill', color);

			marker.appendChild(polygon);
			defs.appendChild(marker);
		});

		svg.appendChild(defs);

		const flowItems = flowContainer.querySelectorAll('.flow-item');
		const connectionMap = new Map();
		let colorIndex = 0;

		this.designsData.forEach((design, sourceIdx) => {
			if (!design.navigationLinks || design.navigationLinks.length === 0) {
				return;
			}

			const sourceElement = flowItems[sourceIdx];
			if (!sourceElement) return;

			// 获取元素相对于 flowContainer 的位置
			const sourceRect = sourceElement.getBoundingClientRect();
			const flowContainerRect = flowContainer.getBoundingClientRect();

			design.navigationLinks.forEach((link: any) => {
				const targetIdx = this.designsData.findIndex(d => d.id === link.targetDesignId);
				if (targetIdx === -1 || targetIdx === sourceIdx) return;

				const targetElement = flowItems[targetIdx];
				if (!targetElement) return;

				const targetRect = targetElement.getBoundingClientRect();

				const connKey = [sourceIdx, targetIdx].sort().join('-');
				if (!connectionMap.has(connKey)) {
					connectionMap.set(connKey, colorIndex % colors.length);
					colorIndex++;
				}
				const color = colors[connectionMap.get(connKey)];

				// 计算相对于 flowContainer 的坐标，从流程单元中心开始和结束
				// 注意：不减去scrollTop/scrollLeft，因为SVG会随容器滚动
				const startX = sourceRect.left - flowContainerRect.left + sourceRect.width / 2;
				const startY = sourceRect.top - flowContainerRect.top + sourceRect.height / 2;
				const endX = targetRect.left - flowContainerRect.left + targetRect.width / 2;
				const endY = targetRect.top - flowContainerRect.top + targetRect.height / 2;

				const midX = (startX + endX) / 2;
				const curveOffset = Math.abs(endX - startX) * 0.3;

				const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				const pathData = `M ${startX} ${startY} Q ${midX} ${startY - curveOffset}, ${endX} ${endY}`;

				path.setAttribute('d', pathData);
				path.setAttribute('stroke', color);
				path.setAttribute('stroke-width', '2');
				path.setAttribute('fill', 'none');
				path.setAttribute('marker-end', `url(#arrowhead-${connectionMap.get(connKey)})`);
				path.setAttribute('opacity', '0.6');

				path.setAttribute('data-source', sourceIdx.toString());
				path.setAttribute('data-target', targetIdx.toString());
				path.setAttribute('data-label', link.elementText || '');

				const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
				title.textContent = `${design.title} → ${this.designsData[targetIdx].title}${link.elementText ? ' (' + link.elementText + ')' : ''}`;
				path.appendChild(title);

				svg.appendChild(path);
			});
		});

		// 设置SVG的viewBox和高度以包含所有内容
		const svgHeight = flowContainer.scrollHeight || flowContainer.offsetHeight;
		const svgWidth = flowContainer.scrollWidth || flowContainer.offsetWidth;
		svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
		svg.setAttribute('width', svgWidth.toString());
		svg.setAttribute('height', svgHeight.toString());
	}

	/**
	 * 选择设计
	 */
	private selectDesign(index: number): void {
		this.eventBus.emit('flow:selectDesign', { index });
	}

	/**
	 * 删除设计
	 */
	private deleteDesign(index: number): void {
		this.eventBus.emit('flow:deleteDesign', { index });
	}

	/**
	 * 销毁模块
	 */
	dispose(): void {
		this.designsData = [];
	}
}
