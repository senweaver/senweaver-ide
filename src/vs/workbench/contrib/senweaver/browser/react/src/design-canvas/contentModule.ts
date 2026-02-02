/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { PreviewEventBus } from './previewEventBus.js';
import { DesignData, NavigationLink } from '../../../senweaverDesignerPreviewEditor.js';

/**
 * 内容展示模块 - 管理UI实时展示区域
 * 包括iframe内容渲染、导航交互等功能
 */
export class ContentModule {
	private eventBus: PreviewEventBus;
	private designsData: DesignData[] = [];
	private currentSelectedIndex: number = 0;
	private iframe: HTMLIFrameElement | null = null;

	constructor(eventBus: PreviewEventBus) {
		this.eventBus = eventBus;
	}

	/**
	 * 获取内容展示区域HTML
	 */
	getContentHTML(): string {
		return `
	<!-- UI界面展示区域 -->
	<div class="preview-content">
		<!-- User content iframe for isolation -->
		<iframe id="user-content-frame" class="user-content-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
	</div>
		`;
	}

	/**
	 * 获取内容展示区域样式
	 */
	getContentStyles(): string {
		return `
		.preview-content {
			flex: 1;
			overflow: hidden;
			background: var(--vscode-editor-background);
			position: relative;
		}

		.user-content-iframe {
			width: 100%;
			height: 100%;
			border: none;
			display: block;
			background: white;
		}
		`;
	}

	/**
	 * 初始化内容模块
	 */
	init(): void {
		this.iframe = document.getElementById('user-content-frame') as HTMLIFrameElement;
	}

	/**
	 * 更新用户内容
	 */
	updateUserContent(html: string, css: string): void {
		if (!this.iframe) {
			this.init();
		}

		if (!this.iframe) return;

		const doc = this.iframe.contentDocument || this.iframe.contentWindow!.document;
		const fullHTML = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		}
		${css || ''}
	</style>
</head>
<body>
	${html || ''}
</body>
</html>`;

		doc.open();
		doc.write(fullHTML);
		doc.close();

		this.setupNavigationListeners();
	}

	/**
	 * 更新设计数据
	 */
	updateDesignsData(designs: DesignData[], selectedIndex: number): void {
		this.designsData = designs;
		this.currentSelectedIndex = selectedIndex;
	}

	/**
	 * 设置导航监听器
	 */
	private setupNavigationListeners(): void {
		if (!this.iframe) return;

		const iframeWindow = this.iframe.contentWindow;
		const iframeDoc = this.iframe.contentDocument || iframeWindow!.document;

		// 移除旧的监听器
		if ((this.iframe as any)._navigationListener) {
			iframeDoc.removeEventListener('click', (this.iframe as any)._navigationListener);
		}

		// 创建新的监听器
		(this.iframe as any)._navigationListener = (e: MouseEvent) => {
			let clickedElement = e.target as HTMLElement;

			// 如果点击的是SVG或其子元素，找到父按钮/链接
			if (clickedElement.tagName === 'svg' || clickedElement.tagName === 'path' ||
				clickedElement.tagName === 'circle' || clickedElement.tagName === 'rect' ||
				clickedElement.tagName === 'I') {
				const parent = clickedElement.closest('button, a, [onclick], [role="button"]');
				if (parent) {
					clickedElement = parent as HTMLElement;
				}
			}

			const clickedText = clickedElement.textContent?.trim();
			const clickedHTML = clickedElement.outerHTML || '';

			this.handleNavigation(clickedElement, clickedText, clickedHTML, e);
		};

		iframeDoc.addEventListener('click', (this.iframe as any)._navigationListener, true);
	}

	/**
	 * 处理导航逻辑
	 */
	private handleNavigation(clickedElement: HTMLElement, clickedText: string | undefined, clickedHTML: string, e: MouseEvent): void {
		const currentDesign = this.designsData[this.currentSelectedIndex];
		if (!currentDesign) {
			return;
		}

		// 策略1：检查当前设计的导航链接
		if (currentDesign.navigationLinks && currentDesign.navigationLinks.length > 0) {
			for (const link of currentDesign.navigationLinks) {
				if (this.matchesLink(link, clickedElement, clickedText, clickedHTML)) {
					const targetIndex = this.designsData.findIndex(d => d.id === link.targetDesignId);
					if (targetIndex !== -1) {
						e.preventDefault();
						e.stopPropagation();
						this.selectDesign(targetIndex);
						return;
					}
				}
			}
		}

		// 策略2：检查反向导航
		for (let i = 0; i < this.designsData.length; i++) {
			if (i === this.currentSelectedIndex) continue;

			const otherDesign = this.designsData[i];
			if (!otherDesign.navigationLinks) continue;

			for (const link of otherDesign.navigationLinks) {
				if (link.targetDesignId === currentDesign.id) {
					if (this.matchesLink(link, clickedElement, clickedText, clickedHTML)) {
						e.preventDefault();
						e.stopPropagation();
						this.selectDesign(i);
						return;
					}
				}
			}
		}
	}

	/**
	 * 检查元素是否匹配链接
	 */
	private matchesLink(link: NavigationLink, clickedElement: HTMLElement, clickedText: string | undefined, clickedHTML: string): boolean {
		// 按文本匹配
		if (link.elementText) {
			if (this.matchesIconDescription(clickedHTML, link.elementText)) {
				return true;
			}

			if (clickedText && link.elementText) {
				const normalizedClicked = clickedText.replace(/\s+/g, ' ').trim();
				const normalizedLink = link.elementText.replace(/\s+/g, ' ').trim();

				if (normalizedClicked === normalizedLink ||
					normalizedClicked.includes(normalizedLink) ||
					normalizedLink.includes(normalizedClicked)) {
					return true;
				}
			}
		}

		// 按选择器匹配
		if (link.elementSelector) {
			if (clickedElement.matches(link.elementSelector) ||
				clickedElement.closest(link.elementSelector)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 检查是否匹配图标描述
	 */
	private matchesIconDescription(html: string, iconDesc: string): boolean {
		if (!iconDesc || !iconDesc.startsWith('[') || !iconDesc.endsWith(']')) {
			return false;
		}

		const lowerHTML = html.toLowerCase();

		// 检查登出/退出图标
		if (iconDesc.includes('退出') || iconDesc.includes('登出')) {
			return lowerHTML.includes('logout') || lowerHTML.includes('exit') ||
				lowerHTML.includes('sign-out') || lowerHTML.includes('log-out');
		}

		// 检查登录图标
		if (iconDesc.includes('登录')) {
			return lowerHTML.includes('login') || lowerHTML.includes('sign-in') ||
				lowerHTML.includes('log-in');
		}

		// 检查用户图标
		if (iconDesc.includes('用户')) {
			return lowerHTML.includes('user') || lowerHTML.includes('person') ||
				lowerHTML.includes('account');
		}

		// 检查设置图标
		if (iconDesc.includes('设置')) {
			return lowerHTML.includes('setting') || lowerHTML.includes('gear') ||
				lowerHTML.includes('config');
		}

		// 检查仪表盘图标
		if (iconDesc.includes('仪表盘')) {
			return lowerHTML.includes('dashboard') || lowerHTML.includes('home') ||
				lowerHTML.includes('index');
		}

		return false;
	}

	/**
	 * 选择设计
	 */
	private selectDesign(index: number): void {
		this.eventBus.emit('content:navigationTriggered', { sourceIndex: this.currentSelectedIndex, targetIndex: index });
	}

	/**
	 * 销毁模块
	 */
	dispose(): void {
		if (this.iframe && (this.iframe as any)._navigationListener) {
			const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow!.document;
			iframeDoc.removeEventListener('click', (this.iframe as any)._navigationListener);
		}
		this.designsData = [];
		this.iframe = null;
	}
}
