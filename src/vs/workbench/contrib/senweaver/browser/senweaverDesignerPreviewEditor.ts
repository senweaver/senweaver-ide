/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { assertIsDefined } from '../../../../base/common/types.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IWebviewElement } from '../../../contrib/webview/browser/webview.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { URI } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import Severity from '../../../../base/common/severity.js';
import { IChatThreadService } from './chatThreadService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { PreviewEventBus } from './react/src/design-canvas/previewEventBus.js';
import { ToolbarModule } from './react/src/design-canvas/toolbarModule.js';
import { FlowModule } from './react/src/design-canvas/flowModule.js';
import { ContentModule } from './react/src/design-canvas/contentModule.js';

// Define navigation link for interactive UI elements
export interface NavigationLink {
	// Selector or text content to match the clickable element
	elementSelector?: string;
	elementText?: string;
	// Target design ID to navigate to
	targetDesignId: string;
}

// Define DesignData type locally to avoid importing from React component
export interface DesignData {
	id: string;
	type: 'mockup' | 'component' | 'wireframe';
	html: string;
	css: string;
	title: string;
	timestamp: number;
	// Navigation links for interactive elements
	navigationLinks?: NavigationLink[];
}

export class SenweaverDesignerPreviewInput extends EditorInput {
	static readonly ID = 'workbench.input.senweaverDesignerPreview';

	static readonly RESOURCE = URI.from({
		scheme: 'senweaver',
		path: 'designer-preview'
	});

	readonly resource = SenweaverDesignerPreviewInput.RESOURCE;

	constructor(
		public designs: DesignData[]
	) {
		super();
	}

	override get typeId(): string {
		return SenweaverDesignerPreviewInput.ID;
	}

	override getName(): string {
		return localize('SenweaverDesignerPreview', '设计预览');
	}

	override matches(other: EditorInput): boolean {
		return other instanceof SenweaverDesignerPreviewInput;
	}

	// Method to update designs
	updateDesigns(newDesigns: DesignData[]): void {
		this.designs = newDesigns;
	}
}

export class SenweaverDesignerPreviewEditor extends EditorPane {
	static readonly ID = 'workbench.editor.SenweaverDesignerPreview';

	private webview: IWebviewElement | undefined;
	private designs: DesignData[] = [];
	private selectedDesignIndex: number = 0;

	// 模块化组件
	private eventBus: PreviewEventBus | undefined;
	private toolbarModule: ToolbarModule | undefined;
	private flowModule: FlowModule | undefined;
	private contentModule: ContentModule | undefined;

	// 渲染刷新频率控制
	private static readonly RENDER_THROTTLE_MS = 100; // 最小刷新间隔 100ms
	private renderThrottleTimer: ReturnType<typeof setTimeout> | undefined;
	private lastRenderTime: number = 0;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IChatThreadService private readonly chatThreadService: IChatThreadService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(SenweaverDesignerPreviewEditor.ID, group, telemetryService, themeService, storageService);

		// Listen for drag-drop events from chat
		window.addEventListener('message', (event) => {
			if (event.data && event.data.type === 'editDesignFromDrag') {
				const index = event.data.index;
				const design = this.designs[index];
				if (design) {
					this.addDesignToSelections(design).catch(err => {
						console.error('[SenweaverDesignerPreviewEditor] Error adding design from drag:', err);
					});
				}
			}
		});
	}

	protected createEditor(parent: HTMLElement): void {
		// Webview will be created in setInput
	}

	override async setInput(input: SenweaverDesignerPreviewInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this.designs = input.designs;
		if (this.designs.length > 0) {
			this.selectedDesignIndex = this.designs.length - 1; // Select latest design
		}

		this.renderPreview();
	}

	// Public method to update designs from outside
	public updateDesigns(newDesigns: DesignData[]): void {
		// 防回退保护：若外部传入的设计数量少于当前数量，则忽略此次更新
		// 这个保护在设计阶段和设计刚完成的短期窗口内都生效
		if (newDesigns && this.designs && newDesigns.length < this.designs.length && newDesigns.length !== 0) {
			return;
		}

		const hadDesigns = this.designs.length > 0;
		this.designs = newDesigns;
		const hasDesigns = this.designs.length > 0;

		if (this.designs.length > 0 && this.selectedDesignIndex >= this.designs.length) {
			this.selectedDesignIndex = this.designs.length - 1;
		}

		// Update the input's designs array
		const input = this.input as SenweaverDesignerPreviewInput;
		if (input) {
			input.updateDesigns(newDesigns);
		}

		// Re-render or update the preview
		if (this.webview) {
			// If transitioning from empty to having designs, reload framework
			if (!hadDesigns && hasDesigns) {
				this.webview.setHtml(this.getFrameworkHTML());
				// Wait for webview to be ready, then send design data
				setTimeout(() => {
					this.updateFlowAndContent();
				}, 100);
			} else if (hasDesigns) {
				// Update flow and content
				this.updateFlowAndContent();
			} else {
				// Show empty state
				this.webview.setHtml(this.getFrameworkHTML());
			}
		} else {
			// If webview doesn't exist yet, render from scratch
			this.renderPreview();
		}
	}

	private async renderPreview(): Promise<void> {
		const container = assertIsDefined(this.getContainer());

		if (!this.webview) {
			this.webview = this.webviewService.createWebviewElement({
				providedViewType: 'SenweaverDesignerPreview',
				title: localize('SenweaverDesignerPreview', '设计预览'),
				options: {
					enableFindWidget: false
				},
				contentOptions: {
					enableCommandUris: false,
					localResourceRoots: [],
					allowScripts: true // Allow scripts for interactive designs
				},
				extension: undefined
			});

			this.webview.mountTo(container, this.window);

			// Listen for messages from webview
			this.webview.onMessage((event) => {
				const message = event.message;
				if (message.type === 'selectDesign') {
					this.selectedDesignIndex = message.index;
					this.updatePreviewContent();
				} else if (message.type === 'deleteDesign') {
					// Show confirmation dialog
					this.dialogService.confirm({
						type: Severity.Warning,
						message: localize('confirmDelete', '确定要删除这个UI单元吗？'),
						primaryButton: localize('delete', '删除'),
						cancelButton: localize('cancel', '取消')
					}).then(result => {
						if (result.confirmed) {
							// Remove the design at the specified index
							this.designs.splice(message.index, 1);

							// Adjust selected index if necessary
							if (this.designs.length === 0) {
								this.selectedDesignIndex = 0;
							} else if (this.selectedDesignIndex >= this.designs.length) {
								this.selectedDesignIndex = this.designs.length - 1;
							}

							// Update the input's designs array
							const input = this.input as SenweaverDesignerPreviewInput;
							if (input) {
								input.updateDesigns(this.designs);
							}

							this.renderPreview();
						} else {
						}
					});
				} else if (message.type === 'clearAllDesigns') {

					// Show confirmation dialog
					this.dialogService.confirm({
						type: Severity.Warning,
						message: localize('confirmClearAll', '确定要清除所有UI单元吗？此操作不可撤销。'),
						primaryButton: localize('clearAll', '清空'),
						cancelButton: localize('cancel', '取消')
					}).then(result => {
						if (result.confirmed) {
							// Clear all designs
							this.designs = [];
							this.selectedDesignIndex = 0;

							// Update the input's designs array
							const input = this.input as SenweaverDesignerPreviewInput;
							if (input) {
								input.updateDesigns(this.designs);
							}

							this.renderPreview();
						} else {
						}
					});
				} else if (message.type === 'editDesign') {

					// Get the design to edit
					const design = this.designs[message.index];
					if (!design) {
						return;
					}

					// Add design as a selection item instead of setting text prompt
					this.addDesignToSelections(design).catch(err => {
						console.error('[SenweaverDesignerPreviewEditor] Error adding design to selections:', err);
					});
				} else if (message.type === 'forkDesign') {
					// Fork (duplicate) the design and add it to the list
					const designToFork = this.designs[message.index];
					if (designToFork) {
						const forkedDesign: DesignData = {
							...designToFork,
							id: `${designToFork.id}-fork-${Date.now()}`,
							title: `${designToFork.title} (Fork)`,
							timestamp: Date.now()
						};
						this.designs.push(forkedDesign);
						this.selectedDesignIndex = this.designs.length - 1;

						// Update the input's designs array
						const input = this.input as SenweaverDesignerPreviewInput;
						if (input) {
							input.updateDesigns(this.designs);
						}

						this.renderPreview();
					}
				} else if (message.type === 'exportAllDesigns') {
					// 导出所有UI单元代码 - 显示框架选择对话框
					if (this.designs.length === 0) {
						this.dialogService.info(
							localize('noDesignsToExport', '没有UI单元可导出'),
							localize('noDesignsHint', '请先在Designer模式下创建一些UI设计')
						);
						return;
					}
					this.showExportFrameworkDialog();
				} else if (message.type === 'updateDesign') {
					// Update design HTML/CSS
					const design = this.designs[message.index];
					if (design) {
						design.html = message.html || design.html;
						design.css = message.css || design.css;

						// Update the input's designs array
						const input = this.input as SenweaverDesignerPreviewInput;
						if (input) {
							input.updateDesigns(this.designs);
						}

						this.updatePreviewContent();
					}
				}
			});

			// Set initial webview HTML (framework only)
			this.webview.setHtml(this.getFrameworkHTML());
		} else {
			if (this.designs.length === 0) {
				this.webview.setHtml(this.getFrameworkHTML());
			} else {
				// Update only the flow and content, not the entire framework
				this.updateFlowAndContent();
			}
		}
	}

	// Update only the preview content without reloading the entire page
	private updatePreviewContent(): void {
		if (!this.webview || this.designs.length === 0) {
			return;
		}

		// Update both flow items and content to ensure highlight is correct
		this.updateFlowAndContent();
	}

	// Update flow items and content (with throttling)
	private updateFlowAndContent(): void {
		if (!this.webview) {
			return;
		}

		const now = Date.now();
		const timeSinceLastRender = now - this.lastRenderTime;

		// 如果距离上次渲染时间不足，则延迟执行
		if (timeSinceLastRender < SenweaverDesignerPreviewEditor.RENDER_THROTTLE_MS) {
			// 清除之前的定时器
			if (this.renderThrottleTimer) {
				clearTimeout(this.renderThrottleTimer);
			}
			// 设置新的定时器
			this.renderThrottleTimer = setTimeout(() => {
				this.doUpdateFlowAndContent();
			}, SenweaverDesignerPreviewEditor.RENDER_THROTTLE_MS - timeSinceLastRender);
			return;
		}

		this.doUpdateFlowAndContent();
	}

	// 实际执行更新
	private doUpdateFlowAndContent(): void {
		if (!this.webview) {
			return;
		}

		this.lastRenderTime = Date.now();

		const flowItemsData = this.designs.map((design, index) => ({
			index,
			id: design.id,
			type: design.type,
			title: design.title,
			timestamp: design.timestamp,
			isActive: index === this.selectedDesignIndex
		}));

		const selectedDesign = this.designs.length > 0 ? this.designs[this.selectedDesignIndex] : null;

		this.webview.postMessage({
			type: 'updateFlowAndContent',
			flowItems: flowItemsData,
			designCount: this.designs.length,
			selectedIndex: this.selectedDesignIndex,
			designs: this.designs, // Pass full designs data including navigationLinks
			content: selectedDesign ? {
				html: selectedDesign.html,
				css: selectedDesign.css
			} : null
		});
	}

	// Get the framework HTML (fixed structure, loaded once)
	private getFrameworkHTML(): string {
		if (this.designs.length === 0) {
			return this.getEmptyStateHtml();
		}

		// 初始化模块（如果还没有初始化）
		if (!this.eventBus) {
			this.eventBus = new PreviewEventBus();
			this.toolbarModule = new ToolbarModule(this.eventBus);
			this.flowModule = new FlowModule(this.eventBus);
			this.contentModule = new ContentModule(this.eventBus);
			this.setupEventBusListeners();
		}

		// 获取各模块的HTML和样式
		const toolbarHTML = this.toolbarModule!.getToolbarHTML();
		const toolbarStyles = this.toolbarModule!.getToolbarStyles();
		const flowHTML = this.flowModule!.getFlowHTML();
		const flowStyles = this.flowModule!.getFlowStyles();
		const contentHTML = this.contentModule!.getContentHTML();
		const contentStyles = this.contentModule!.getContentStyles();

		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		/* Preview Panel Styles */
		* {
			box-sizing: border-box;
		}

		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			display: flex;
			flex-direction: column;
		}

		${toolbarStyles}
		${flowStyles}
		${contentStyles}
	</style>
</head>
<body>
	${toolbarHTML}
	${flowHTML}
	${contentHTML}

	<script>
		const vscode = acquireVsCodeApi();

		// 全局变量
		let designsData = [];
		let currentSelectedIndex = 0;

		// ============ FlowModule 功能 ============
		let zoomLevel = 1.0;
		let panX = 0;
		let panY = 0;
		let isDragging = false;
		let dragStartX = 0;
		let dragStartY = 0;
		let dragStartPanX = 0;
		let dragStartPanY = 0;

		function setZoom(newZoom) {
			zoomLevel = newZoom;
			applyTransform();
			updateZoomIndicator();
		}

		function applyTransform() {
			const container = document.getElementById('flow-items-container');
			const svg = document.getElementById('flow-connections-svg');
			if (container) {
				container.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoomLevel})\`;
			}
			if (svg) {
				svg.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoomLevel})\`;
			}
		}

		function updateZoomIndicator() {
			const indicator = document.getElementById('zoom-indicator');
			if (indicator) {
				indicator.textContent = Math.round(zoomLevel * 100) + '%';
			}
		}

		function zoomIn() {
			setZoom(Math.min(zoomLevel + 0.1, 2.0));
		}

		function zoomOut() {
			setZoom(Math.max(zoomLevel - 0.1, 0.5));
		}

		function zoomReset() {
			setZoom(1.0);
			panX = 0;
			panY = 0;
			applyTransform();
		}

		function initZoomAndPan() {
			const flowContainer = document.getElementById('ui-flow-container');
			if (!flowContainer) return;

			flowContainer.addEventListener('wheel', (e) => {
				if (e.ctrlKey) {
					e.preventDefault();
					const delta = e.deltaY > 0 ? -0.1 : 0.1;
					setZoom(Math.max(0.5, Math.min(2.0, zoomLevel + delta)));
				}
			}, { passive: false });

			flowContainer.addEventListener('mousedown', (e) => {
				if (e.target === flowContainer || e.target.classList.contains('flow-connections-svg')) {
					isDragging = true;
					dragStartX = e.clientX;
					dragStartY = e.clientY;
					dragStartPanX = panX;
					dragStartPanY = panY;
					flowContainer.classList.add('dragging');
					e.preventDefault();
				}
			});

			document.addEventListener('mousemove', (e) => {
				if (isDragging) {
					panX = dragStartPanX + (e.clientX - dragStartX);
					panY = dragStartPanY + (e.clientY - dragStartY);
					applyTransform();
				}
			});

			document.addEventListener('mouseup', () => {
				if (isDragging) {
					isDragging = false;
					const flowContainer = document.getElementById('ui-flow-container');
					if (flowContainer) {
						flowContainer.classList.remove('dragging');
					}
				}
			});

			document.addEventListener('keydown', (e) => {
				if (e.ctrlKey && e.key === '0') {
					e.preventDefault();
					zoomReset();
				} else if (e.ctrlKey && e.key === '+') {
					e.preventDefault();
					zoomIn();
				} else if (e.ctrlKey && e.key === '-') {
					e.preventDefault();
					zoomOut();
				}
			});
		}

		function updateFlowItems(flowItems, designCount) {
			const flowContainer = document.getElementById('flow-items-container');
			const countSpan = document.getElementById('design-count');

			if (countSpan) {
				countSpan.textContent = designCount + ' 个UI单元';
			}

			if (!flowContainer) return;

			flowContainer.innerHTML = '';

			flowItems.forEach((item, idx) => {
				const hasNext = idx < flowItems.length - 1;
				const wrapper = document.createElement('div');
				wrapper.className = 'flow-item-wrapper';

				const flowItem = document.createElement('div');
				flowItem.className = 'flow-item' + (item.isActive ? ' active' : '');
				flowItem.title = item.title;
				flowItem.onclick = () => selectDesign(item.index);

				flowItem.draggable = true;
				flowItem.ondragstart = (e) => {
					const designData = JSON.stringify({
						type: 'designUnit',
						index: item.index
					});
					e.dataTransfer.setData('application/json', designData);
					e.dataTransfer.effectAllowed = 'copy';
				};

				const preview = document.createElement('div');
				preview.className = 'flow-item-preview';

				let displayTitle = item.title || 'UI ' + (item.index + 1);
				if (displayTitle.length > 15) {
					displayTitle = displayTitle.substring(0, 15) + '...';
				}

				const isNew = (Date.now() - item.timestamp) < 5000;

				preview.innerHTML = \`
					\${isNew ? '<div class="flow-item-new-badge"></div>' : ''}
					<div class="flow-item-title" title="\${item.title || 'UI ' + (item.index + 1)}">\${displayTitle}</div>
					<div class="flow-item-time">\${new Date(item.timestamp).toLocaleTimeString()}</div>
				\`;

				if (isNew) {
					const timeRemaining = 5000 - (Date.now() - item.timestamp);
					if (timeRemaining > 0) {
						setTimeout(() => {
							const badge = preview.querySelector('.flow-item-new-badge');
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
					deleteDesign(item.index);
				};

				flowItem.appendChild(preview);
				flowItem.appendChild(deleteBtn);
				wrapper.appendChild(flowItem);

				if (hasNext) {
					const connector = document.createElement('div');
					connector.className = 'flow-connector';
					wrapper.appendChild(connector);
				}

				flowContainer.appendChild(wrapper);
			});

			setTimeout(() => drawNavigationConnections(), 100);
		}

		// ============ ContentModule 功能 ============
		function updateUserContent(html, css) {
			const iframe = document.getElementById('user-content-frame');
			if (!iframe) return;

			const doc = iframe.contentDocument || iframe.contentWindow.document;
			const fullHTML = \`<!DOCTYPE html>
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
		\${css || ''}
	</style>
</head>
<body>
	\${html || ''}
</body>
</html>\`;

			doc.open();
			doc.write(fullHTML);
			doc.close();

			setupNavigationListeners(iframe);
		}

		function setupNavigationListeners(iframe) {
			const iframeWindow = iframe.contentWindow;
			const iframeDoc = iframe.contentDocument || iframeWindow.document;

			if (iframe._navigationListener) {
				iframeDoc.removeEventListener('click', iframe._navigationListener);
			}

			iframe._navigationListener = function(e) {
				let clickedElement = e.target;

				if (clickedElement.tagName === 'svg' || clickedElement.tagName === 'path' ||
				    clickedElement.tagName === 'circle' || clickedElement.tagName === 'rect' ||
				    clickedElement.tagName === 'I') {
					const parent = clickedElement.closest('button, a, [onclick], [role="button"]');
					if (parent) {
						clickedElement = parent;
					}
				}

				const clickedText = clickedElement.textContent?.trim();
				const clickedHTML = clickedElement.outerHTML || '';

				const currentDesign = designsData[currentSelectedIndex];
				if (!currentDesign) {
					return;
				}

				if (currentDesign.navigationLinks && currentDesign.navigationLinks.length > 0) {
					for (const link of currentDesign.navigationLinks) {
						let matched = false;

						if (link.elementText) {
							if (clickedText && link.elementText) {
								const normalizedClicked = clickedText.replace(/\s+/g, ' ').trim();
								const normalizedLink = link.elementText.replace(/\s+/g, ' ').trim();

								if (normalizedClicked === normalizedLink ||
								    normalizedClicked.includes(normalizedLink) ||
								    normalizedLink.includes(normalizedClicked)) {
									matched = true;
								}
							}
						}

						if (link.elementSelector && !matched) {
							if (clickedElement.matches(link.elementSelector) ||
							    clickedElement.closest(link.elementSelector)) {
								matched = true;
							}
						}

						if (matched) {
							const targetIndex = designsData.findIndex(d => d.id === link.targetDesignId);
							if (targetIndex !== -1) {
								e.preventDefault();
								e.stopPropagation();
								selectDesign(targetIndex);
								return;
							}
						}
					}
				}
			};

			iframeDoc.addEventListener('click', iframe._navigationListener, true);
		}

		function drawNavigationConnections() {
			const svg = document.getElementById('flow-connections-svg');
			const flowContainer = document.getElementById('flow-items-container');

			if (!svg || !flowContainer || !designsData || designsData.length === 0) {
				return;
			}

			svg.innerHTML = '';

			const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
			const colors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];

			colors.forEach((color, idx) => {
				const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
				marker.setAttribute('id', \`arrowhead-\${idx}\`);
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

			designsData.forEach((design, sourceIdx) => {
				if (!design.navigationLinks || design.navigationLinks.length === 0) {
					return;
				}

				const sourceElement = flowItems[sourceIdx];
				if (!sourceElement) return;

				const sourceRect = sourceElement.getBoundingClientRect();
				const containerRect = flowContainer.parentElement.getBoundingClientRect();

				design.navigationLinks.forEach(link => {
					const targetIdx = designsData.findIndex(d => d.id === link.targetDesignId);
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

					const startX = sourceRect.right - containerRect.left;
					const startY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
					const endX = targetRect.left - containerRect.left;
					const endY = targetRect.top + targetRect.height / 2 - containerRect.top;

					const midX = (startX + endX) / 2;
					const curveOffset = Math.abs(endX - startX) * 0.3;

					const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
					const pathData = \`M \${startX} \${startY} Q \${midX} \${startY - curveOffset}, \${endX} \${endY}\`;

					path.setAttribute('d', pathData);
					path.setAttribute('stroke', color);
					path.setAttribute('stroke-width', '2');
					path.setAttribute('fill', 'none');
					path.setAttribute('marker-end', \`url(#arrowhead-\${connectionMap.get(connKey)})\`);
					path.setAttribute('opacity', '0.6');

					path.setAttribute('data-source', sourceIdx);
					path.setAttribute('data-target', targetIdx);
					path.setAttribute('data-label', link.elementText || '');

					const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
					title.textContent = \`\${design.title} → \${designsData[targetIdx].title}\${link.elementText ? ' (' + link.elementText + ')' : ''}\`;
					path.appendChild(title);

					svg.appendChild(path);
				});
			});
		}

		// ============ 消息监听 ============
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'updateFlowAndContent') {
				designsData = message.designs || [];
				currentSelectedIndex = message.selectedIndex || 0;
				updateFlowItems(message.flowItems, message.designCount);
				if (message.content) {
					updateUserContent(message.content.html, message.content.css);
				}
			} else if (message.type === 'updateContent') {
				updateUserContent(message.html, message.css);
			}
		});

		// ============ 初始化 ============
		setTimeout(() => {
			initZoomAndPan();
		}, 100);

		// ============ 全局函数 ============
		function editCurrentDesign() {
			vscode.postMessage({ type: 'editDesign', index: currentSelectedIndex });
		}

		function forkCurrentDesign() {
			vscode.postMessage({ type: 'forkDesign', index: currentSelectedIndex });
		}

		function clearAllDesigns() {
			vscode.postMessage({ type: 'clearAllDesigns' });
		}

		function selectDesign(index) {
			vscode.postMessage({ type: 'selectDesign', index: index });
		}

		function deleteDesign(index) {
			vscode.postMessage({ type: 'deleteDesign', index: index });
		}

		function exportAllDesigns() {
			vscode.postMessage({ type: 'exportAllDesigns' });
		}
	</script>
</body>
</html>
		`;
	}

	/**
	 * 设置事件总线监听器
	 */
	private setupEventBusListeners(): void {
		if (!this.eventBus) return;

		// 工具栏事件
		this.eventBus.on('toolbar:editDesign', (data: any) => {
			const design = this.designs[data.index];
			if (design) {
				this.addDesignToSelections(design).catch((err: any) => {
					console.error('[SenweaverDesignerPreviewEditor] Error:', err);
				});
			}
		});

		this.eventBus.on('toolbar:forkDesign', (data: any) => {
			const designToFork = this.designs[data.index];
			if (designToFork) {
				const forkedDesign: DesignData = {
					...designToFork,
					id: `${designToFork.id}-fork-${Date.now()}`,
					title: `${designToFork.title} (Fork)`,
					timestamp: Date.now()
				};
				this.designs.push(forkedDesign);
				this.selectedDesignIndex = this.designs.length - 1;
				const input = this.input as SenweaverDesignerPreviewInput;
				if (input) {
					input.updateDesigns(this.designs);
				}
				this.renderPreview();
			}
		});

		this.eventBus.on('toolbar:exportAllDesigns', () => {
			if (this.designs.length === 0) {
				this.dialogService.info(
					localize('noDesignsToExport', '没有UI单元可导出'),
					localize('noDesignsHint', '请先在Designer模式下创建一些UI设计')
				);
				return;
			}
			// 显示框架选择对话框
			this.showExportFrameworkDialog();
		});

		this.eventBus.on('toolbar:clearAllDesigns', () => {
			this.dialogService.confirm({
				type: Severity.Warning,
				message: localize('confirmClearAll', '确定要清除所有UI单元吗？此操作不可撤销。'),
				primaryButton: localize('clearAll', '清空'),
				cancelButton: localize('cancel', '取消')
			}).then(result => {
				if (result.confirmed) {
					this.designs = [];
					this.selectedDesignIndex = 0;
					const input = this.input as SenweaverDesignerPreviewInput;
					if (input) {
						input.updateDesigns(this.designs);
					}
					this.renderPreview();
				}
			});
		});

		// 流程项事件
		this.eventBus.on('flow:selectDesign', (data: any) => {
			this.selectedDesignIndex = data.index;
			this.updatePreviewContent();
		});

		this.eventBus.on('flow:deleteDesign', (data: any) => {
			this.dialogService.confirm({
				type: Severity.Warning,
				message: localize('confirmDelete', '确定要删除这个UI单元吗？'),
				primaryButton: localize('delete', '删除'),
				cancelButton: localize('cancel', '取消')
			}).then(result => {
				if (result.confirmed) {
					this.designs.splice(data.index, 1);
					if (this.designs.length === 0) {
						this.selectedDesignIndex = 0;
					} else if (this.selectedDesignIndex >= this.designs.length) {
						this.selectedDesignIndex = this.designs.length - 1;
					}
					const input = this.input as SenweaverDesignerPreviewInput;
					if (input) {
						input.updateDesigns(this.designs);
					}
					this.renderPreview();
				}
			});
		});

		// 内容导航事件
		this.eventBus.on('content:navigationTriggered', (data: any) => {
			this.selectedDesignIndex = data.targetIndex;
			this.updatePreviewContent();
		});
	}

	private getEmptyStateHtml(): string {
		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			padding: 0;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			display: flex;
			flex-direction: column;
			height: 100vh;
		}

		.preview-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 10px 16px;
			background: var(--vscode-editor-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			flex-shrink: 0;
			min-height: 40px;
		}

		.preview-title {
			font-size: 14px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.empty-container {
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.empty-state {
			text-align: center;
			max-width: 400px;
			padding: 40px;
		}

		.empty-icon {
			margin-bottom: 20px;
			opacity: 0.9;
		}

		.empty-icon img {
			width: 260px;
			height: 260px;
			object-fit: contain;
		}

		.empty-text {
			font-size: 18px;
			font-weight: 500;
			margin-bottom: 12px;
			color: var(--vscode-foreground);
		}

		.empty-hint {
			font-size: 14px;
			color: var(--vscode-descriptionForeground);
			line-height: 1.6;
			margin-bottom: 8px;
		}

		.empty-steps {
			text-align: left;
			margin-top: 24px;
			padding: 16px;
			background: var(--vscode-sideBar-background);
			border-radius: 8px;
			border: 1px solid var(--vscode-panel-border);
		}

		.empty-steps-title {
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-foreground);
			margin-bottom: 12px;
		}

		.empty-step {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 8px;
			padding-left: 20px;
			position: relative;
		}

		.empty-step::before {
			content: '→';
			position: absolute;
			left: 0;
			color: var(--vscode-focusBorder);
		}
	</style>
</head>
<body>
	<div class="preview-header">
		<span class="preview-title">设计画布</span>
	</div>
	<div class="empty-container">
		<div class="empty-state">
			<div class="empty-icon">
				<svg width="80" height="80" viewBox="0 0 320.315 320.315" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
					<defs>
						<linearGradient id="grad1" x1="0%" y1="100%" x2="0%" y2="0%">
							<stop offset="0%" style="stop-color:#1D2088"/>
							<stop offset="100%" style="stop-color:#00A0E9"/>
						</linearGradient>
						<linearGradient id="grad2" x1="0%" y1="0%" x2="0%" y2="100%">
							<stop offset="0%" style="stop-color:#00A0E9"/>
							<stop offset="100%" style="stop-color:#1D2088"/>
						</linearGradient>
					</defs>
					<polygon fill="url(#grad1)" points="216.196,245.194 216.196,111.275 250.973,93.053 250.973,232.321 272.298,220.41 272.298,81.879 304.193,65.168 304.193,245.194 165.22,318.013 165.22,271.472 165.22,245.726 165.22,137.985 194.87,122.449 194.87,257.107"/>
					<polygon fill="url(#grad1)" points="133.321,118.026 156.405,130.2 156.405,104.996"/>
					<polygon fill="url(#grad2)" points="164.233,2.302 164.233,130.202 303.162,56.933"/>
					<polygon fill="url(#grad1)" points="156.405,28.766 156.405,2.303 53.335,42.834 48.946,44.559 17.48,56.933 48.946,73.528 51.915,75.093"/>
					<polygon fill="url(#grad1)" points="108.649,105.014 156.405,80.09 156.405,53.548 77.377,88.522 105.048,103.116"/>
					<polygon fill="url(#grad1)" points="156.024,183.251 156.024,137.985 17.052,65.168 17.052,90.125 17.052,109.633 17.052,135.379 17.052,163.464 17.052,167.236 112.134,217.605 112.134,243.35 17.052,192.982 17.052,245.194 156.024,318.013 156.024,294.748 156.024,266.6 156.024,240.854 156.024,221.408 156.024,208.996 60.942,158.628 60.942,132.883"/>
				</svg>
			</div>
			<p class="empty-text">开始创建您的 UI 设计</p>
			<p class="empty-hint">在 Designer 模式下与 AI 对话，生成精美的 UI 界面</p>
			<div class="empty-steps">
				<div class="empty-steps-title">快速开始：</div>
				<div class="empty-step">切换到 Designer 聊天模式</div>
				<div class="empty-step">描述您想要的 UI（例如："设计一个登录页面"）</div>
				<div class="empty-step">AI 将生成可交互的 UI 预览</div>
				<div class="empty-step">在画布中查看、编辑和导出您的设计</div>
				<div class="empty-step">在流程项中可以拖拽单个ui单元到输入框进行修改</div>
			</div>
		</div>
	</div>
</body>
</html>
		`;
	}

	override layout(dimension: Dimension): void {
		// Webview layout is handled automatically
	}

	override clearInput(): void {
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}
		super.clearInput();
	}

	override dispose(): void {
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}
		super.dispose();
	}

	// 显示框架选择下拉列表并导出代码
	private async showExportFrameworkDialog(): Promise<void> {
		// 定义支持的前端框架
		const frameworks = [
			{ id: 'react', name: 'React', description: '使用 React + TypeScript + TailwindCSS' },
			{ id: 'vue', name: 'Vue 3', description: '使用 Vue 3 + TypeScript + TailwindCSS' },
			{ id: 'nextjs', name: 'Next.js', description: '使用 Next.js 14 + React + TailwindCSS' },
			{ id: 'nuxt', name: 'Nuxt 3', description: '使用 Nuxt 3 + Vue 3 + TailwindCSS' },
			{ id: 'svelte', name: 'Svelte', description: '使用 SvelteKit + TypeScript + TailwindCSS' },
			{ id: 'angular', name: 'Angular', description: '使用 Angular 17+ + TypeScript' },
			{ id: 'html', name: '纯 HTML/CSS/JS', description: '不使用框架，纯原生代码' },
		];

		// 构建下拉选项
		const picks: IQuickPickItem[] = frameworks.map(f => ({
			label: f.name,
			description: f.description,
			id: f.id
		}));

		// 显示下拉选择列表
		const selected = await this.quickInputService.pick(picks, {
			placeHolder: localize('selectFramework', '选择要导出的前端框架'),
			title: localize('exportProjectTitle', '🚀 导出项目 - 选择前端框架'),
		});

		if (!selected) {
			return; // 用户取消
		}

		// 找到选中的框架
		const selectedFramework = frameworks.find(f => f.id === (selected as any).id) || frameworks[0];

		// 执行导出
		await this.exportDesignsWithFramework(selectedFramework);
	}

	// 使用选定框架导出设计
	private async exportDesignsWithFramework(framework: { id: string; name: string; description: string }): Promise<void> {
		// Collect code from all UI units
		const designsCode = this.designs.map((design, index) => {
			return `### UI Unit ${index + 1}: ${design.title}\n\n#### HTML:\n\`\`\`html\n${design.html}\n\`\`\`\n\n#### CSS:\n\`\`\`css\n${design.css}\n\`\`\``;
		}).join('\n\n---\n\n');

		// Build the export message for AI
		const exportMessage = `Export the following UI designs to a **${framework.name}** project.

## 🌐 LANGUAGE REQUIREMENT
**You MUST respond in Chinese (中文).** All your messages, explanations, and summaries must be in Chinese.

## ⚠️ CRITICAL WARNING

**This is the CODE EXPORT phase. DO NOT add new UI units to the design preview panel!** Your task is:
- ONLY convert the ${this.designs.length} UI units provided below into ${framework.name} code
- DO NOT output new \`\`\`html and \`\`\`css code blocks that would add new UI units to the design preview
- DO NOT call screenshot_to_code tool (this would add new UI units to the preview)
- FOCUS ONLY on converting existing UI units to ${framework.name} project code and creating project files

## Export Requirements

**⚠️ CRITICAL: You MUST use tools to CREATE ACTUAL FILES on disk. Do NOT just display code in chat!**

1. **First use web_search tool** to search "${framework.name} latest project structure best practices 2024" to understand the latest framework structure and best practices

2. **Use create_file_or_folder tool** to create project directory structure:
   - Create \`frontend\` directory in the current workspace for frontend code
   - Create necessary subdirectories (src, components, views, etc.)
   - Create \`backend\` directory (leave empty for now, backend code will be generated later)

3. **Use rewrite_file tool** to create EACH file:
   - **YOU MUST call rewrite_file for EVERY file you want to create**
   - Do NOT just show code in markdown blocks - that does NOT create files!
   - Each file must be created using rewrite_file tool with the full file path
   - **⚠️ CRITICAL: The new_content parameter must contain ONLY pure code, NO explanations, NO comments about what the code does, NO Chinese descriptions at the beginning!**
   - Example WRONG: "这是登录页面组件\\n<template>..."
   - Example CORRECT: "<template>..."

4. **Convert each UI unit** (CONVERT ONLY, DO NOT ADD NEW):
   - Optimize the original HTML/CSS code for each UI unit
   - Convert to ${framework.name} component format with COMPLETE and VALID syntax
   - Use rewrite_file to save each component to disk
   - DO NOT miss any UI unit
   - Maintain consistent visual design
   - **FORBIDDEN: Adding any UI components not in the list below**

5. **Generate complete runnable code**:
   - Use rewrite_file to create all config files (package.json, tsconfig.json, etc.)
   - Include all required dependencies
   - Code must be directly runnable
   - **EVERY file must be created using rewrite_file tool**
   - **File content must be PURE CODE ONLY - no descriptions or explanations!**

## UI Designs to Export (Total: ${this.designs.length} - Process ONLY these, DO NOT add new ones)

${designsCode}

Start the export process now. First search for latest framework info, then create project structure and convert code step by step. REMEMBER: ONLY convert the UI units above, DO NOT generate new UI!

## 🔔 Response Structure

Your response MUST follow this order:
1. Complete ALL frontend code generation (search framework, create files, convert all UI units)
2. Show the project summary with file structure and run instructions
3. End with "下一步建议" section (ask if user needs backend code generation)`;

		try {
			// 获取当前线程ID
			const currentThread = this.chatThreadService.getCurrentThread();
			if (!currentThread) {
				this.dialogService.error(
					localize('exportError', '导出失败'),
					localize('noActiveThread', '没有活动的聊天线程')
				);
				return;
			}

			// 发送消息到AI聊天
			await this.chatThreadService.addUserMessageAndStreamResponse({
				userMessage: exportMessage,
				displayMessage: `🚀 导出UI设计到 ${framework.name} 项目`,
				threadId: currentThread.id
			});

			// 聚焦到聊天面板，用户可以直接查看进度
			await this.chatThreadService.focusCurrentChat();

		} catch (error) {
			console.error('[SenweaverDesignerPreviewEditor] Export error:', error);
			this.dialogService.error(
				localize('exportError', '导出失败'),
				localize('exportErrorDetail', '导出过程中发生错误，请重试')
			);
		}
	}

	// Add design to chat selections
	private async addDesignToSelections(design: DesignData): Promise<void> {
		try {
			// Add design as a selection item
			this.chatThreadService.addNewStagingSelection({
				type: 'DesignUnit',
				designId: design.id,
				designTitle: design.title,
				designTimestamp: design.timestamp,
				html: design.html,
				css: design.css
			});

			// Focus the chat input
			await this.chatThreadService.focusCurrentChat();

		} catch (error) {
			console.error('[SenweaverDesignerPreviewEditor] Error in addDesignToSelections:', error);
		}
	}
}

// Register the designer preview editor pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(SenweaverDesignerPreviewEditor, SenweaverDesignerPreviewEditor.ID, "设计预览"),
	[new SyncDescriptor(SenweaverDesignerPreviewInput)]
);

// Register action to open design canvas
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.openDesignCanvas',
			title: { value: localize('openDesignCanvas', '打开设计画布'), original: 'Open Design Canvas' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, options?: { isDesignerMode?: boolean }): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const senweaverSettingsService = accessor.get(ISenweaverSettingsService);

		// 检查当前是否在designer模式
		const isDesignerMode = options?.isDesignerMode ?? (senweaverSettingsService.state.globalSettings.chatMode === 'designer');

		// 查找已经打开的设计预览编辑器
		const allEditors = editorService.visibleEditorPanes;
		const existingDesignerPane = allEditors.find(pane => pane instanceof SenweaverDesignerPreviewEditor) as SenweaverDesignerPreviewEditor | undefined;

		if (isDesignerMode && existingDesignerPane) {
			// 在designer模式下，如果已经有设计预览编辑器，直接激活它（保留历史设计）
			const existingInput = existingDesignerPane.input;
			if (existingInput) {
				await editorService.openEditor(existingInput, { pinned: true });
			}
		} else {
			// 非designer模式或没有现有编辑器：创建新的空白设计预览编辑器
			const input = new SenweaverDesignerPreviewInput([]);
			await editorService.openEditor(input, { pinned: true });
		}
	}
});
