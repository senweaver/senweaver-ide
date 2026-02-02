/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
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
import { IInstantiationService, createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

// Browser state for AI interaction
export interface BrowserState {
	url: string;
	title: string;
	html?: string;
	consoleMessages: string[];
	networkRequests: Array<{ url: string; method: string; status: number; type: string }>;
	cookies: Array<{ name: string; value: string; domain: string }>;
	localStorage: Record<string, string>;
	selectedElement?: {
		tagName: string;
		id: string;
		className: string;
		textContent: string;
		attributes: Record<string, string>;
	};
}

// Service interface for browser communication
export const ISenweaverBrowserService = createDecorator<ISenweaverBrowserService>('senweaverBrowserService');

export interface ISenweaverBrowserService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onStateChange: Event<BrowserState>;
	readonly onNavigate: Event<string>;

	// Methods
	getCurrentState(): BrowserState | undefined;
	navigate(url: string): void;
	executeScript(script: string): Promise<any>;
	getPageContent(): Promise<string>;
	captureScreenshot(): Promise<string>;
	selectElement(selector: string): Promise<any>;
	sendToChat(data: any): void;
	openBrowser(url?: string): Promise<void>;
}

// Service implementation
class SenweaverBrowserService extends Disposable implements ISenweaverBrowserService {
	readonly _serviceBrand: undefined;

	private _currentState: BrowserState | undefined;
	private _webview: IWebviewElement | undefined;
	private _browserInput: SenweaverBrowserInput | undefined;

	private readonly _onStateChange = this._register(new Emitter<BrowserState>());
	readonly onStateChange = this._onStateChange.event;

	private readonly _onNavigate = this._register(new Emitter<string>());
	readonly onNavigate = this._onNavigate.event;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	getCurrentState(): BrowserState | undefined {
		return this._currentState;
	}

	updateState(state: Partial<BrowserState>): void {
		this._currentState = { ...this._currentState, ...state } as BrowserState;
		this._onStateChange.fire(this._currentState);
	}

	setWebview(webview: IWebviewElement): void {
		this._webview = webview;
	}

	navigate(url: string): void {
		this._onNavigate.fire(url);
	}

	async executeScript(script: string): Promise<any> {
		if (this._webview) {
			this._webview.postMessage({ type: 'executeScript', script });
		}
		return null;
	}

	async getPageContent(): Promise<string> {
		return this._currentState?.html || '';
	}

	async captureScreenshot(): Promise<string> {
		// Screenshot will be handled by webview
		return '';
	}

	async selectElement(selector: string): Promise<any> {
		if (this._webview) {
			this._webview.postMessage({ type: 'selectElement', selector });
		}
		return null;
	}

	sendToChat(data: any): void {
		// This will be implemented to send data to the chat
		console.log('[SenweaverBrowser] Sending to chat:', data);
	}

	async openBrowser(url?: string): Promise<void> {
		// Always create a fresh browser instance
		this._browserInput = this.instantiationService.createInstance(SenweaverBrowserInput, url || 'about:blank');
		// Force replace to ensure fresh editor
		await this.editorService.openEditor(this._browserInput, { pinned: true, forceReload: true });
		// Navigate after editor is open if URL is provided
		if (url && url !== 'about:blank') {
			this._onNavigate.fire(url);
		}
	}
}

registerSingleton(ISenweaverBrowserService, SenweaverBrowserService, InstantiationType.Delayed);

// Editor Input
export class SenweaverBrowserInput extends EditorInput {
	static readonly ID = 'workbench.input.senweaverBrowser';

	static readonly RESOURCE = URI.from({
		scheme: 'senweaver',
		path: 'browser'
	});

	readonly resource = SenweaverBrowserInput.RESOURCE;

	private _url: string;

	constructor(url: string = 'about:blank') {
		super();
		this._url = url;
	}

	get url(): string {
		return this._url;
	}

	setUrl(url: string): void {
		this._url = url;
	}

	override get typeId(): string {
		return SenweaverBrowserInput.ID;
	}

	override getName(): string {
		return localize('senweaverBrowser', '内置浏览器');
	}


	override matches(other: EditorInput): boolean {
		return other instanceof SenweaverBrowserInput;
	}
}

// Editor Pane
export class SenweaverBrowserEditor extends EditorPane {
	static readonly ID = 'workbench.editor.senweaverBrowser';

	private webview: IWebviewElement | undefined;
	private container: HTMLElement | undefined;
	private toolbar: HTMLElement | undefined;
	private urlInput: HTMLInputElement | undefined;
	private _currentUrl: string = 'about:blank';
	private history: string[] = [];
	private historyIndex: number = -1;
	private consoleMessages: string[] = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@ISenweaverBrowserService private readonly browserService: ISenweaverBrowserService,
		@INotificationService private readonly notificationService: INotificationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super(SenweaverBrowserEditor.ID, group, telemetryService, themeService, storageService);

		// Listen for navigation events
		this._register(browserService.onNavigate(url => {
			this.navigateTo(url);
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'senweaver-browser-container';
		this.container.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			width: 100%;
			background: var(--vscode-editor-background);
		`;
		parent.appendChild(this.container);

		// Create toolbar
		this.createToolbar();

		// Create webview container
		const webviewContainer = document.createElement('div');
		webviewContainer.className = 'senweaver-browser-webview';
		webviewContainer.style.cssText = `
			flex: 1;
			overflow: hidden;
			position: relative;
		`;
		this.container.appendChild(webviewContainer);

		// Create webview
		this.webview = this.webviewService.createWebviewElement({
			providedViewType: 'senweaver.browser',
			title: '内置浏览器',
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true,
				// 禁用 ServiceWorker 以避免在某些环境中的注册错误
				disableServiceWorker: true,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [],
				// 禁用不需要的功能以避免 webview 环境中的错误
				enableCommandUris: false,
			},
			extension: undefined
		});

		this.webview.mountTo(webviewContainer, this.window);
		(this.browserService as SenweaverBrowserService).setWebview(this.webview);

		// Handle messages from webview
		this._register(this.webview.onMessage(e => {
			this.handleWebviewMessage(e.message);
		}));

		// Load initial content
		this.loadBrowserFrame();
	}

	private createToolbar(): void {
		this.toolbar = document.createElement('div');
		this.toolbar.className = 'senweaver-browser-toolbar';
		this.toolbar.style.cssText = `
			display: flex;
			align-items: center;
			padding: 6px 10px;
			background: var(--vscode-titleBar-activeBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			gap: 6px;
			flex-shrink: 0;
		`;

		// Back button
		const backBtn = this.createToolbarButton('←', '后退', () => this.goBack());
		this.toolbar.appendChild(backBtn);

		// Forward button
		const forwardBtn = this.createToolbarButton('→', '前进', () => this.goForward());
		this.toolbar.appendChild(forwardBtn);

		// Refresh button
		const refreshBtn = this.createToolbarButton('↻', '刷新', () => this.refresh());
		this.toolbar.appendChild(refreshBtn);

		// Home button
		const homeBtn = this.createToolbarButton('⌂', '主页', () => this.goHome());
		this.toolbar.appendChild(homeBtn);

		// URL input
		this.urlInput = document.createElement('input');
		this.urlInput.type = 'text';
		this.urlInput.placeholder = '输入网址...';
		this.urlInput.style.cssText = `
			flex: 1;
			padding: 6px 12px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 4px;
			font-size: 13px;
			outline: none;
		`;
		this.urlInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				let url = this.urlInput!.value.trim();
				if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
					url = 'https://' + url;
				}
				this.navigateTo(url);
			}
		});
		this.toolbar.appendChild(this.urlInput);

		// Developer Tools button
		const devToolsBtn = this.createToolbarButton('🔧', '开发者工具', () => this.toggleDevTools());
		this.toolbar.appendChild(devToolsBtn);

		// Send to Chat button
		const chatBtn = this.createToolbarButton('💬', '发送到助手', () => this.sendPageToChat());
		chatBtn.style.background = 'var(--vscode-button-background)';
		chatBtn.style.color = 'var(--vscode-button-foreground)';
		this.toolbar.appendChild(chatBtn);

		// Screenshot button
		const screenshotBtn = this.createToolbarButton('📷', '截图', () => this.captureScreenshot());
		this.toolbar.appendChild(screenshotBtn);

		this.container!.appendChild(this.toolbar);
	}

	private createToolbarButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.textContent = icon;
		btn.title = title;
		btn.style.cssText = `
			padding: 4px 8px;
			border: none;
			background: transparent;
			color: var(--vscode-foreground);
			cursor: pointer;
			border-radius: 4px;
			font-size: 14px;
			min-width: 28px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
		`;
		btn.addEventListener('mouseenter', () => {
			btn.style.background = 'var(--vscode-toolbar-hoverBackground)';
		});
		btn.addEventListener('mouseleave', () => {
			btn.style.background = 'transparent';
		});
		btn.addEventListener('click', onClick);
		return btn;
	}

	private loadBrowserFrame(): void {
		if (!this.webview) return;

		const html = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; worker-src 'none';">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; overflow: hidden; }

		#browser-frame {
			width: 100%;
			height: calc(100% - 30px);
			border: none;
		}

		#status-bar {
			height: 30px;
			background: var(--vscode-statusBar-background, #007acc);
			color: var(--vscode-statusBar-foreground, #fff);
			display: flex;
			align-items: center;
			padding: 0 10px;
			font-size: 12px;
			gap: 15px;
		}

		.status-item {
			display: flex;
			align-items: center;
			gap: 5px;
		}

		#loading-indicator {
			display: none;
			width: 100%;
			height: 3px;
			background: linear-gradient(90deg, #007acc 0%, #007acc 50%, transparent 50%);
			background-size: 200% 100%;
			animation: loading 1s infinite linear;
			position: absolute;
			top: 0;
		}

		#loading-indicator.active {
			display: block;
		}

		@keyframes loading {
			0% { background-position: 200% 0; }
			100% { background-position: -200% 0; }
		}

		#welcome-page {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			height: calc(100% - 30px);
			background: var(--vscode-editor-background, #1e1e1e);
			color: var(--vscode-foreground, #ccc);
		}

		#welcome-page h1 {
			font-size: 24px;
			margin-bottom: 20px;
			color: var(--vscode-foreground, #ccc);
		}

		#welcome-page p {
			font-size: 14px;
			color: var(--vscode-descriptionForeground, #888);
			margin-bottom: 30px;
		}

		.quick-links {
			display: flex;
			gap: 15px;
			flex-wrap: wrap;
			justify-content: center;
			max-width: 600px;
		}

		.quick-link {
			padding: 12px 20px;
			background: var(--vscode-button-secondaryBackground, #3a3d41);
			color: var(--vscode-button-secondaryForeground, #fff);
			border: none;
			border-radius: 6px;
			cursor: pointer;
			font-size: 13px;
			transition: background 0.2s;
		}

		.quick-link:hover {
			background: var(--vscode-button-secondaryHoverBackground, #45494e);
		}

		/* DevTools Panel Styles */
		#devtools-panel {
			display: none;
			position: absolute;
			bottom: 30px;
			left: 0;
			right: 0;
			height: 300px;
			background: var(--vscode-panel-background, #1e1e1e);
			border-top: 2px solid var(--vscode-panel-border, #454545);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			font-size: 12px;
			flex-direction: column;
			z-index: 1000;
			overflow: hidden;
		}

		#devtools-panel.active {
			display: flex;
		}

		#devtools-resize-handle {
			height: 4px;
			background: transparent;
			cursor: ns-resize;
			position: absolute;
			top: -2px;
			left: 0;
			right: 0;
		}

		#devtools-resize-handle:hover {
			background: var(--vscode-focusBorder, #007acc);
		}

		#devtools-tabs {
			display: flex;
			background: var(--vscode-titleBar-activeBackground, #3c3c3c);
			border-bottom: 1px solid var(--vscode-panel-border, #454545);
			padding: 0 5px;
			gap: 2px;
		}

		.devtools-tab {
			padding: 8px 16px;
			background: transparent;
			border: none;
			color: var(--vscode-foreground, #888);
			cursor: pointer;
			font-size: 12px;
			border-bottom: 2px solid transparent;
			transition: all 0.2s;
		}

		.devtools-tab:hover {
			color: var(--vscode-foreground, #ccc);
			background: var(--vscode-toolbar-hoverBackground);
		}

		.devtools-tab.active {
			color: var(--vscode-foreground, #fff);
			border-bottom-color: var(--vscode-focusBorder, #007acc);
		}

		.devtools-close {
			margin-left: auto;
			padding: 8px 12px;
			background: transparent;
			border: none;
			color: var(--vscode-foreground, #888);
			cursor: pointer;
			font-size: 16px;
		}

		.devtools-close:hover {
			color: #f14c4c;
		}

		#devtools-content {
			flex: 1;
			overflow: hidden;
			display: flex;
			min-height: 0;
		}

		.devtools-pane {
			display: none;
			flex: 1;
			flex-direction: column;
			overflow: hidden;
			min-height: 0;
		}

		.devtools-pane.active {
			display: flex;
		}

		/* Elements Panel */
		#elements-panel {
			display: flex;
			flex-direction: row;
			min-height: 0;
			overflow: hidden;
		}

		#elements-tree {
			flex: 1;
			overflow: auto;
			padding: 8px;
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 12px;
			min-height: 0;
		}

		.element-node {
			padding: 2px 0;
			cursor: pointer;
		}

		.element-node:hover {
			background: var(--vscode-list-hoverBackground, #2a2d2e);
		}

		.element-node.selected {
			background: var(--vscode-list-activeSelectionBackground, #094771);
		}

		.element-tag { color: #569cd6; }
		.element-attr-name { color: #9cdcfe; }
		.element-attr-value { color: #ce9178; }
		.element-text { color: #d4d4d4; }
		.element-comment { color: #6a9955; }
		.element-toggle {
			display: inline-block;
			width: 16px;
			color: #888;
			cursor: pointer;
		}

		#element-styles {
			width: 300px;
			border-left: 1px solid var(--vscode-panel-border, #454545);
			overflow: auto;
			padding: 8px;
			min-height: 0;
		}

		#element-styles h4 {
			color: var(--vscode-foreground, #ccc);
			margin-bottom: 8px;
			padding-bottom: 4px;
			border-bottom: 1px solid var(--vscode-panel-border, #454545);
		}

		.style-rule {
			margin-bottom: 8px;
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 11px;
		}

		.style-selector {
			color: #569cd6;
		}

		.style-property {
			margin-left: 16px;
			color: #9cdcfe;
		}

		.style-value {
			color: #ce9178;
		}

		/* Console Panel */
		#console-pane {
			flex-direction: column;
			min-height: 0;
		}

		#console-toolbar {
			display: flex;
			padding: 4px 8px;
			gap: 8px;
			background: var(--vscode-titleBar-activeBackground, #3c3c3c);
			border-bottom: 1px solid var(--vscode-panel-border, #454545);
		}

		.console-toolbar-btn {
			padding: 4px 8px;
			background: transparent;
			border: 1px solid var(--vscode-input-border, #454545);
			color: var(--vscode-foreground, #ccc);
			cursor: pointer;
			border-radius: 3px;
			font-size: 11px;
		}

		.console-toolbar-btn:hover {
			background: var(--vscode-toolbar-hoverBackground);
		}

		#console-filter {
			padding: 4px 8px;
			background: var(--vscode-input-background, #3c3c3c);
			border: 1px solid var(--vscode-input-border, #454545);
			color: var(--vscode-input-foreground, #ccc);
			border-radius: 3px;
			font-size: 11px;
			width: 150px;
		}

		#console-messages {
			flex: 1;
			overflow: auto;
			padding: 4px 8px;
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 12px;
			min-height: 0;
		}

		.console-message {
			padding: 4px 8px;
			border-bottom: 1px solid var(--vscode-panel-border, #333);
			display: flex;
			align-items: flex-start;
			gap: 8px;
		}

		.console-message-icon {
			flex-shrink: 0;
			width: 16px;
		}

		.console-message-content {
			flex: 1;
			word-break: break-all;
		}

		.console-message-source {
			color: #888;
			font-size: 10px;
			flex-shrink: 0;
		}

		.console-log { color: var(--vscode-foreground, #ccc); }
		.console-warn { color: #ddb700; background: rgba(221, 183, 0, 0.1); }
		.console-error { color: #f14c4c; background: rgba(241, 76, 76, 0.1); }
		.console-info { color: #3794ff; }

		#console-input-container {
			display: flex;
			padding: 8px;
			background: var(--vscode-input-background, #3c3c3c);
			border-top: 1px solid var(--vscode-panel-border, #454545);
		}

		#console-input-prompt {
			color: #569cd6;
			padding-right: 8px;
			font-family: 'Consolas', 'Monaco', monospace;
		}

		#console-input {
			flex: 1;
			background: transparent;
			border: none;
			color: var(--vscode-input-foreground, #ccc);
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 12px;
			outline: none;
		}

		/* Network Panel */
		#network-pane {
			flex-direction: column;
			min-height: 0;
		}

		#network-toolbar {
			display: flex;
			padding: 4px 8px;
			gap: 8px;
			background: var(--vscode-titleBar-activeBackground, #3c3c3c);
			border-bottom: 1px solid var(--vscode-panel-border, #454545);
			align-items: center;
		}

		#network-table-container {
			flex: 1;
			overflow: auto;
			min-height: 0;
		}

		#network-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 11px;
		}

		#network-table th {
			background: var(--vscode-titleBar-activeBackground, #3c3c3c);
			color: var(--vscode-foreground, #ccc);
			padding: 6px 8px;
			text-align: left;
			font-weight: normal;
			border-bottom: 1px solid var(--vscode-panel-border, #454545);
			position: sticky;
			top: 0;
		}

		#network-table td {
			padding: 4px 8px;
			border-bottom: 1px solid var(--vscode-panel-border, #333);
			color: var(--vscode-foreground, #ccc);
		}

		#network-table tr:hover {
			background: var(--vscode-list-hoverBackground, #2a2d2e);
		}

		#network-table tr.selected {
			background: var(--vscode-list-activeSelectionBackground, #094771);
		}

		.network-status-2xx { color: #4ec9b0; }
		.network-status-3xx { color: #ddb700; }
		.network-status-4xx { color: #f14c4c; }
		.network-status-5xx { color: #f14c4c; }

		#network-details {
			height: 150px;
			border-top: 1px solid var(--vscode-panel-border, #454545);
			display: none;
			overflow: auto;
			padding: 8px;
		}

		#network-details.active {
			display: block;
		}

		/* Sources Panel */
		#sources-pane {
			flex-direction: row;
			min-height: 0;
		}

		#sources-sidebar {
			width: 200px;
			border-right: 1px solid var(--vscode-panel-border, #454545);
			overflow: auto;
			padding: 8px;
			min-height: 0;
		}

		.source-file {
			padding: 4px 8px;
			cursor: pointer;
			color: var(--vscode-foreground, #ccc);
			font-size: 11px;
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.source-file:hover {
			background: var(--vscode-list-hoverBackground, #2a2d2e);
		}

		.source-file.selected {
			background: var(--vscode-list-activeSelectionBackground, #094771);
		}

		.source-file-icon {
			font-size: 14px;
		}

		#sources-content {
			flex: 1;
			overflow: auto;
			padding: 8px;
			font-family: 'Consolas', 'Monaco', monospace;
			font-size: 12px;
			white-space: pre-wrap;
			color: var(--vscode-foreground, #ccc);
			min-height: 0;
		}

		.source-line {
			display: flex;
		}

		.source-line-number {
			width: 40px;
			text-align: right;
			padding-right: 8px;
			color: #888;
			user-select: none;
			flex-shrink: 0;
		}

		.source-line-content {
			flex: 1;
		}

		/* Syntax highlighting */
		.syntax-keyword { color: #569cd6; }
		.syntax-string { color: #ce9178; }
		.syntax-number { color: #b5cea8; }
		.syntax-comment { color: #6a9955; }
		.syntax-tag { color: #569cd6; }
		.syntax-attr { color: #9cdcfe; }

	</style>
</head>
<body>
	<div id="loading-indicator"></div>

	<div id="welcome-page">
		<h1>🌐 内置浏览器</h1>
		<p>专业的前后端开发浏览器，支持与AI助手数据交互</p>
		<div class="quick-links">
			<button class="quick-link" onclick="navigateTo('http://localhost:3000')">localhost:3000</button>
			<button class="quick-link" onclick="navigateTo('http://localhost:5173')">localhost:5173</button>
			<button class="quick-link" onclick="navigateTo('http://localhost:8080')">localhost:8080</button>
			<button class="quick-link" onclick="navigateTo('https://www.baidu.com')">百度</button>
			<button class="quick-link" onclick="navigateTo('https://www.google.com')">Google</button>
			<button class="quick-link" onclick="navigateTo('https://github.com')">GitHub</button>
		</div>
	</div>

	<iframe id="browser-frame" style="display:none;" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-top-navigation-by-user-activation allow-modals"></iframe>

	<!-- DevTools Panel -->
	<div id="devtools-panel">
		<div id="devtools-resize-handle"></div>
		<div id="devtools-tabs">
			<button class="devtools-tab active" data-pane="elements">元素</button>
			<button class="devtools-tab" data-pane="console">控制台</button>
			<button class="devtools-tab" data-pane="network">网络</button>
			<button class="devtools-tab" data-pane="sources">源代码</button>
			<button class="devtools-close" onclick="toggleDevTools()">×</button>
		</div>
		<div id="devtools-content">
			<!-- Elements Panel -->
			<div id="elements-pane" class="devtools-pane active">
				<div id="elements-panel">
					<div id="elements-tree">
						<div class="element-node" style="color: #888;">加载页面后查看 DOM 元素...</div>
					</div>
					<div id="element-styles">
						<h4>样式</h4>
						<div id="computed-styles">选择一个元素查看样式</div>
					</div>
				</div>
			</div>

			<!-- Console Panel -->
			<div id="console-pane" class="devtools-pane">
				<div id="console-toolbar">
					<button class="console-toolbar-btn" onclick="clearConsole()">🗑️ 清除</button>
					<button class="console-toolbar-btn" onclick="togglePreserveLog()">📌 保留日志</button>
					<input type="text" id="console-filter" placeholder="过滤..." oninput="filterConsole(this.value)">
					<span id="console-count" style="margin-left: auto; color: #888;">0 条消息</span>
				</div>
				<div id="console-messages"></div>
				<div id="console-input-container">
					<span id="console-input-prompt">&gt;</span>
					<input type="text" id="console-input" placeholder="在此输入 JavaScript 表达式..." onkeydown="handleConsoleInput(event)">
				</div>
			</div>

			<!-- Network Panel -->
			<div id="network-pane" class="devtools-pane">
				<div id="network-toolbar">
					<button class="console-toolbar-btn" onclick="clearNetwork()">🗑️ 清除</button>
					<button class="console-toolbar-btn" id="network-record-btn" onclick="toggleNetworkRecording()">⏺️ 录制</button>
					<span id="network-summary" style="margin-left: auto; color: #888;">0 个请求</span>
				</div>
				<div id="network-table-container">
					<table id="network-table">
						<thead>
							<tr>
								<th style="width: 40%;">名称</th>
								<th style="width: 15%;">状态</th>
								<th style="width: 15%;">类型</th>
								<th style="width: 15%;">大小</th>
								<th style="width: 15%;">时间</th>
							</tr>
						</thead>
						<tbody id="network-table-body">
						</tbody>
					</table>
				</div>
				<div id="network-details">
					<h4>请求详情</h4>
					<pre id="network-detail-content"></pre>
				</div>
			</div>

			<!-- Sources Panel -->
			<div id="sources-pane" class="devtools-pane">
				<div id="sources-sidebar">
					<div class="source-file" onclick="loadPageSource()">
						<span class="source-file-icon">📄</span>
						<span>document (HTML)</span>
					</div>
				</div>
				<div id="sources-content">
					<div style="color: #888; padding: 20px;">点击左侧文件查看源代码</div>
				</div>
			</div>
		</div>
	</div>

	<div id="status-bar">
		<span class="status-item" id="status-url">就绪</span>
		<span class="status-item" id="status-requests">请求: 0</span>
		<span class="status-item" id="status-console">控制台: 0</span>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		let consoleMessages = [];
		let networkRequests = [];
		let currentUrl = 'about:blank';
		let lastKnownUrl = '';
		let urlCheckInterval = null;
		let preserveLog = false;
		let networkRecording = true;
		let consoleFilter = '';
		let selectedElement = null;
		let commandHistory = [];
		let historyIndex = -1;

		// ==================== 代理模式变量 ====================
		let isProxyMode = true;  // 始终使用代理模式

		// 禁用 ServiceWorker 以避免 webview 环境中的错误
		if ('serviceWorker' in navigator) {
			// 阻止新的 ServiceWorker 注册
			const originalRegister = navigator.serviceWorker.register;
			navigator.serviceWorker.register = function() {
				console.log('[SenweaverBrowser] ServiceWorker registration blocked in webview environment');
				return Promise.resolve({ installing: null, waiting: null, active: null });
			};
			// 注销现有的 ServiceWorker
			navigator.serviceWorker.getRegistrations().then(function(registrations) {
				for (let registration of registrations) {
					registration.unregister();
				}
			}).catch(function(err) {
				// 忽略错误
			});
		}

		// ==================== Navigation Functions ====================
		// 始终使用代理模式，确保兼容性
		async function navigateTo(url) {
			currentUrl = url;
			lastKnownUrl = url;
			isProxyMode = true;

			// 隐藏欢迎页
			document.getElementById('welcome-page').style.display = 'none';

			// 确保已检测到后端端口
			if (!backendPortDetected) {
				await detectBackendPort();
			}

			// 直接使用代理模式加载
			const proxyUrl = 'http://localhost:' + BACKEND_PORT + '/proxy?url=' + encodeURIComponent(url);
			document.getElementById('browser-frame').style.display = 'block';
			document.getElementById('browser-frame').src = proxyUrl;
			document.getElementById('loading-indicator').classList.add('active');
			document.getElementById('status-url').textContent = url;
			var urlInput = document.getElementById('url-input');
			if (urlInput) urlInput.value = url;

			vscode.postMessage({ type: 'navigate', url: url });
			startUrlMonitoring();

			// Clear devtools data on navigation (unless preserve log)
			if (!preserveLog) {
				clearConsole();
			}
			clearNetwork();
		}

		// 在外部浏览器打开
		function openInExternal() {
			vscode.postMessage({ type: 'openExternal', url: currentUrl });
			showWelcomePage();
		}

		function showWelcomePage() {
			currentUrl = 'about:blank';
			lastKnownUrl = '';

			// 退出代理模式
			if (isProxyMode) {
				isProxyMode = false;
			}

			document.getElementById('welcome-page').style.display = 'flex';
			document.getElementById('browser-frame').style.display = 'none';
			document.getElementById('browser-frame').src = 'about:blank';
			document.getElementById('status-url').textContent = '就绪';
			stopUrlMonitoring();
			vscode.postMessage({ type: 'urlChanged', url: 'about:blank', title: '内置浏览器' });
		}

		function startUrlMonitoring() {
			stopUrlMonitoring();
			urlCheckInterval = setInterval(checkUrlChange, 500);
		}

		function stopUrlMonitoring() {
			if (urlCheckInterval) {
				clearInterval(urlCheckInterval);
				urlCheckInterval = null;
			}
		}

		function checkUrlChange() {
			const frame = document.getElementById('browser-frame');
			try {
				let frameUrl = frame.contentWindow?.location?.href;
				if (frameUrl && frameUrl !== 'about:blank' && frameUrl !== lastKnownUrl) {
					lastKnownUrl = frameUrl;

					// 在代理模式下，从代理 URL 中提取真实 URL
					let displayUrl = frameUrl;
					if (isProxyMode && frameUrl.includes('/proxy?url=')) {
						try {
							const urlObj = new URL(frameUrl);
							const realUrl = urlObj.searchParams.get('url');
							if (realUrl) {
								displayUrl = decodeURIComponent(realUrl);
								currentUrl = displayUrl;
							}
						} catch(e) {}
					} else {
						currentUrl = frameUrl;
					}

					document.getElementById('status-url').textContent = displayUrl;
					var urlInputEl = document.getElementById('url-input');
					if (urlInputEl) urlInputEl.value = displayUrl;
					const title = frame.contentDocument?.title || displayUrl;
					vscode.postMessage({ type: 'urlChanged', url: displayUrl, title: title });
				}
			} catch(e) { /* Cross-origin */ }
		}

		// ==================== DevTools Panel Functions ====================
		function toggleDevTools() {
			document.getElementById('devtools-panel').classList.toggle('active');
			if (document.getElementById('devtools-panel').classList.contains('active')) {
				refreshElementsPanel();
			}
		}

		// Tab switching
		document.querySelectorAll('.devtools-tab').forEach(tab => {
			tab.addEventListener('click', function() {
				const pane = this.dataset.pane;
				if (!pane) return;

				document.querySelectorAll('.devtools-tab').forEach(t => t.classList.remove('active'));
				document.querySelectorAll('.devtools-pane').forEach(p => p.classList.remove('active'));

				this.classList.add('active');
				document.getElementById(pane + '-pane').classList.add('active');

				// Refresh data when switching tabs
				if (pane === 'elements') {
					refreshElementsPanel();
					stopNetworkRefresh();
					stopConsoleRefresh();
				} else if (pane === 'sources') {
					loadPageSource();
					stopNetworkRefresh();
					stopConsoleRefresh();
				} else if (pane === 'network') {
					refreshNetworkPanel();
					startNetworkRefresh();
					stopConsoleRefresh();
				} else if (pane === 'console') {
					refreshConsolePanel();
					startConsoleRefresh();
					stopNetworkRefresh();
				}
			});
		});

		// Resize handle
		const resizeHandle = document.getElementById('devtools-resize-handle');
		let isResizing = false;
		let startY = 0;
		let startHeight = 0;

		resizeHandle.addEventListener('mousedown', (e) => {
			isResizing = true;
			startY = e.clientY;
			startHeight = document.getElementById('devtools-panel').offsetHeight;
			document.body.style.cursor = 'ns-resize';
			e.preventDefault();
		});

		document.addEventListener('mousemove', (e) => {
			if (!isResizing) return;
			const delta = startY - e.clientY;
			const newHeight = Math.max(100, Math.min(window.innerHeight - 100, startHeight + delta));
			document.getElementById('devtools-panel').style.height = newHeight + 'px';
		});

		document.addEventListener('mouseup', () => {
			isResizing = false;
			document.body.style.cursor = '';
		});

		// ==================== Backend Service (Playwright) ====================
		const DEFAULT_BACKEND_PORT = 3006;
		let BACKEND_PORT = DEFAULT_BACKEND_PORT;
		let backendPortDetected = false;
		let isCrossOrigin = false;
		let backendSessionId = 'devtools-' + Date.now();

		// Detect actual backend port by trying multiple ports
		async function detectBackendPort() {
			if (backendPortDetected) return BACKEND_PORT;

			const startPort = DEFAULT_BACKEND_PORT;
			const maxAttempts = 20;

			for (let i = 0; i < maxAttempts; i++) {
				const port = startPort + i;
				try {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 1000);

					const response = await fetch('http://localhost:' + port + '/', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'listSessions' }),
						signal: controller.signal
					});

					clearTimeout(timeoutId);

					if (response.ok) {
						BACKEND_PORT = port;
						backendPortDetected = true;
						console.log('[DevTools] ✅ Backend detected on port ' + port);
						return port;
					}
				} catch(e) {
					// Port not available, try next
				}
			}

			console.warn('[DevTools] ⚠️ Backend not detected, using default port ' + DEFAULT_BACKEND_PORT);
			return DEFAULT_BACKEND_PORT;
		}

		async function callBackend(action, params = {}) {
			try {
				// Ensure we have the correct port
				if (!backendPortDetected) {
					await detectBackendPort();
				}

				const response = await fetch('http://localhost:' + BACKEND_PORT + '/', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action, sessionId: backendSessionId, ...params })
				});
				if (!response.ok) throw new Error('Backend request failed: ' + response.status);
				return await response.json();
			} catch(e) {
				console.error('[DevTools] Backend error:', e);
				// Reset port detection to retry
				backendPortDetected = false;
				return null;
			}
		}

		async function initBackendSession() {
			if (!currentUrl || currentUrl === 'about:blank') return false;
			try {
				const result = await callBackend('navigate', { url: currentUrl, headless: true });
				return result && result.success;
			} catch(e) {
				return false;
			}
		}

		// ==================== Elements Panel ====================
		async function refreshElementsPanel() {
			const frame = document.getElementById('browser-frame');
			const tree = document.getElementById('elements-tree');

			// First try direct access (same-origin)
			try {
				const doc = frame.contentDocument;
				if (!doc || !doc.documentElement) throw new Error('Cannot access document');

				isCrossOrigin = false;
				tree.innerHTML = '';
				renderDOMTree(doc.documentElement, tree, 0);
				return;
			} catch(e) {
				isCrossOrigin = true;
			}

			// Cross-origin: Use backend service
			tree.innerHTML = '<div class="element-node" style="color: #888;">⏳ 正在加载...</div>';

			try {
				// Initialize backend session if needed
				await initBackendSession();

				// Get DOM via backend
				const result = await callBackend('getContent');
				if (result && result.success && result.result.html) {
					// Parse HTML string and render
					const parser = new DOMParser();
					const doc = parser.parseFromString(result.result.html, 'text/html');
					tree.innerHTML = '';
					renderDOMTree(doc.documentElement, tree, 0);
				} else {
					throw new Error('无法获取页面内容');
				}
			} catch(e) {
				tree.innerHTML = '<div class="element-node" style="color: #f14c4c;">⚠️ 无法获取页面 DOM</div>' +
					'<div class="element-node" style="color: #888; margin-top: 10px;">请检查网络连接或刷新页面重试</div>';
			}
		}

		function renderDOMTree(node, container, depth) {
			if (!node || node.nodeType === 10) return; // Skip doctype

			const div = document.createElement('div');
			div.className = 'element-node';
			div.style.paddingLeft = (depth * 16) + 'px';

			if (node.nodeType === 1) { // Element
				const hasChildren = node.childNodes.length > 0;
				let html = '';

				if (hasChildren) {
					html += '<span class="element-toggle">▶</span>';
				} else {
					html += '<span class="element-toggle"></span>';
				}

				html += '<span class="element-tag">&lt;' + node.tagName.toLowerCase();

				// Attributes
				Array.from(node.attributes || []).slice(0, 3).forEach(attr => {
					html += ' <span class="element-attr-name">' + attr.name + '</span>=<span class="element-attr-value">"' +
						escapeHtml(attr.value.substring(0, 50)) + (attr.value.length > 50 ? '...' : '') + '"</span>';
				});
				if (node.attributes && node.attributes.length > 3) {
					html += ' <span style="color:#888">...</span>';
				}

				html += '<span class="element-tag">&gt;</span>';

				// Inline text content preview
				if (node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
					const text = node.childNodes[0].textContent.trim();
					if (text.length > 0 && text.length < 50) {
						html += '<span class="element-text">' + escapeHtml(text) + '</span>';
						html += '<span class="element-tag">&lt;/' + node.tagName.toLowerCase() + '&gt;</span>';
					}
				}

				div.innerHTML = html;
				div.dataset.expanded = 'false';

				div.addEventListener('click', function(e) {
					e.stopPropagation();

					// Select element
					document.querySelectorAll('.element-node.selected').forEach(el => el.classList.remove('selected'));
					this.classList.add('selected');
					selectedElement = node;
					showElementStyles(node);

					// Toggle children
					if (hasChildren) {
						const isExpanded = this.dataset.expanded === 'true';
						this.dataset.expanded = !isExpanded;
						this.querySelector('.element-toggle').textContent = isExpanded ? '▶' : '▼';

						// Find or create children container
						let childContainer = this.nextElementSibling;
						if (childContainer && childContainer.classList.contains('element-children')) {
							childContainer.style.display = isExpanded ? 'none' : 'block';
						} else if (!isExpanded) {
							childContainer = document.createElement('div');
							childContainer.className = 'element-children';
							node.childNodes.forEach(child => renderDOMTree(child, childContainer, depth + 1));
							this.after(childContainer);
						}
					}
				});

				container.appendChild(div);

			} else if (node.nodeType === 3) { // Text
				const text = node.textContent.trim();
				if (text) {
					div.innerHTML = '<span class="element-text">"' + escapeHtml(text.substring(0, 100)) +
						(text.length > 100 ? '..."' : '"') + '</span>';
					container.appendChild(div);
				}
			} else if (node.nodeType === 8) { // Comment
				div.innerHTML = '<span class="element-comment">&lt;!-- ' +
					escapeHtml(node.textContent.substring(0, 50)) + ' --&gt;</span>';
				container.appendChild(div);
			}
		}

		function showElementStyles(element) {
			const stylesDiv = document.getElementById('computed-styles');

			let html = '<div class="style-rule"><div class="style-selector">element.style {</div>';

			// Inline styles (works for both same-origin and cross-origin parsed elements)
			const inlineStyle = element.getAttribute ? element.getAttribute('style') : (element.style?.cssText || '');
			if (inlineStyle) {
				inlineStyle.split(';').filter(s => s.trim()).forEach(style => {
					const parts = style.split(':');
					if (parts.length >= 2) {
						const prop = parts[0].trim();
						const val = parts.slice(1).join(':').trim();
						html += '<div class="style-property">' + escapeHtml(prop) + ': <span class="style-value">' + escapeHtml(val) + '</span>;</div>';
					}
				});
			} else {
				html += '<div class="style-property" style="color:#888">/* 无内联样式 */</div>';
			}
			html += '</div>';

			// Try to get computed styles (only works for same-origin)
			if (!isCrossOrigin) {
				try {
					const frame = document.getElementById('browser-frame');
					const computed = frame.contentWindow.getComputedStyle(element);

					const importantProps = ['display', 'position', 'width', 'height', 'margin', 'padding',
						'color', 'background', 'font-size', 'font-family', 'border', 'flex', 'grid'];

					html += '<div class="style-rule"><div class="style-selector">计算样式 {</div>';
					importantProps.forEach(prop => {
						const value = computed.getPropertyValue(prop);
						if (value) {
							html += '<div class="style-property">' + prop + ': <span class="style-value">' + value + '</span>;</div>';
						}
					});
					html += '<div class="style-property" style="color:#888">/* ... 更多样式 */</div></div>';
				} catch(e) {
					// Computed styles not available
				}
			} else {
				// Show element attributes as additional info
				if (element.attributes && element.attributes.length > 0) {
					html += '<div class="style-rule"><div class="style-selector">属性 {</div>';
					Array.from(element.attributes).forEach(attr => {
						if (attr.name !== 'style') {
							html += '<div class="style-property">' + escapeHtml(attr.name) + ': <span class="style-value">"' + escapeHtml(attr.value.substring(0, 100)) + '"</span></div>';
						}
					});
					html += '</div>';
				}
			}

			stylesDiv.innerHTML = html;
		}

		// ==================== Console Panel ====================
		function updateStatus() {
			document.getElementById('status-requests').textContent = '请求: ' + networkRequests.length;
			document.getElementById('status-console').textContent = '控制台: ' + consoleMessages.length;
			document.getElementById('console-count').textContent = consoleMessages.length + ' 条消息';
			document.getElementById('network-summary').textContent = networkRequests.length + ' 个请求';
		}

		function addConsoleMessage(level, message, source = '') {
			const msg = { level, message, source, time: new Date() };
			consoleMessages.push(msg);
			renderConsoleMessage(msg);
			updateStatus();
			vscode.postMessage({ type: 'console', level, message });
		}

		function renderConsoleMessage(msg) {
			if (consoleFilter && !msg.message.toLowerCase().includes(consoleFilter.toLowerCase())) return;

			const panel = document.getElementById('console-messages');
			const div = document.createElement('div');
			div.className = 'console-message console-' + msg.level;

			const icons = { log: '📝', warn: '⚠️', error: '❌', info: 'ℹ️' };
			div.innerHTML =
				'<span class="console-message-icon">' + (icons[msg.level] || '📝') + '</span>' +
				'<span class="console-message-content">' + escapeHtml(String(msg.message)) + '</span>' +
				'<span class="console-message-source">' + msg.time.toLocaleTimeString() + '</span>';

			panel.appendChild(div);
			panel.scrollTop = panel.scrollHeight;
		}

		function clearConsole() {
			consoleMessages = [];
			document.getElementById('console-messages').innerHTML = '';
			updateStatus();
			// Also clear backend console messages
			if (isCrossOrigin) {
				callBackend('clearConsoleMessages');
			}
		}

		function filterConsole(filter) {
			consoleFilter = filter;
			document.getElementById('console-messages').innerHTML = '';
			consoleMessages.forEach(msg => renderConsoleMessage(msg));
		}

		// Refresh console from backend for cross-origin pages
		let consoleRefreshTimer = null;

		async function refreshConsolePanel() {
			if (!isCrossOrigin || !currentUrl || currentUrl === 'about:blank') return;

			try {
				const result = await callBackend('getConsoleMessages');
				if (result && result.success && Array.isArray(result.result)) {
					result.result.forEach(msg => {
						// Check if message already exists
						const exists = consoleMessages.some(m =>
							m.message === msg.message && m.level === msg.level && m.time === msg.time
						);
						if (!exists) {
							const newMsg = {
								level: msg.level,
								message: msg.message,
								source: 'backend',
								time: new Date(msg.time)
							};
							consoleMessages.push(newMsg);
							renderConsoleMessage(newMsg);
						}
					});
					updateStatus();
				}
			} catch(e) {
				// Ignore errors
			}
		}

		function startConsoleRefresh() {
			if (consoleRefreshTimer) return;
			consoleRefreshTimer = setInterval(() => {
				if (document.getElementById('console-pane').classList.contains('active')) {
					refreshConsolePanel();
				}
			}, 1000);
		}

		function stopConsoleRefresh() {
			if (consoleRefreshTimer) {
				clearInterval(consoleRefreshTimer);
				consoleRefreshTimer = null;
			}
		}

		function togglePreserveLog() {
			preserveLog = !preserveLog;
			const btn = document.querySelector('[onclick="togglePreserveLog()"]');
			btn.style.background = preserveLog ? 'var(--vscode-button-background)' : 'transparent';
		}

		async function handleConsoleInput(event) {
			const input = document.getElementById('console-input');

			if (event.key === 'Enter') {
				const script = input.value.trim();
				if (!script) return;

				commandHistory.push(script);
				historyIndex = commandHistory.length;

				addConsoleMessage('info', '> ' + script);

				// First try direct execution (same-origin)
				let executed = false;
				try {
					const frame = document.getElementById('browser-frame');
					if (frame.contentWindow) {
						const result = frame.contentWindow.eval(script);
						addConsoleMessage('log', formatValue(result));
						executed = true;
					}
				} catch(e) {
					if (e.message.includes('cross-origin') || e.message.includes('Blocked')) {
						// Cross-origin, try backend
					} else {
						addConsoleMessage('error', e.message);
						executed = true;
					}
				}

				// If cross-origin, try backend
				if (!executed && currentUrl && currentUrl !== 'about:blank') {
					try {
						await initBackendSession();
						const result = await callBackend('evaluate', { script: script });
						if (result && result.success) {
							addConsoleMessage('log', formatValue(result.result));
						} else {
							addConsoleMessage('error', result?.error || '执行失败');
						}
					} catch(e) {
						addConsoleMessage('error', '执行失败: ' + e.message);
					}
				}

				input.value = '';
			} else if (event.key === 'ArrowUp') {
				if (historyIndex > 0) {
					historyIndex--;
					input.value = commandHistory[historyIndex];
				}
				event.preventDefault();
			} else if (event.key === 'ArrowDown') {
				if (historyIndex < commandHistory.length - 1) {
					historyIndex++;
					input.value = commandHistory[historyIndex];
				} else {
					historyIndex = commandHistory.length;
					input.value = '';
				}
				event.preventDefault();
			}
		}

		function formatValue(value) {
			if (value === undefined) return 'undefined';
			if (value === null) return 'null';
			if (typeof value === 'object') {
				try {
					return JSON.stringify(value, null, 2);
				} catch(e) {
					return Object.prototype.toString.call(value);
				}
			}
			return String(value);
		}

		// ==================== Network Panel ====================
		let networkRefreshTimer = null;

		function clearNetwork() {
			networkRequests = [];
			document.getElementById('network-table-body').innerHTML = '';
			document.getElementById('network-details').classList.remove('active');
			updateStatus();
			// Also clear backend network requests
			if (isCrossOrigin) {
				callBackend('clearNetworkRequests');
			}
		}

		function toggleNetworkRecording() {
			networkRecording = !networkRecording;
			const btn = document.getElementById('network-record-btn');
			btn.textContent = networkRecording ? '⏺️ 录制' : '⏸️ 暂停';
			btn.style.color = networkRecording ? '#f14c4c' : '#888';
			// Sync with backend
			if (isCrossOrigin) {
				callBackend('setNetworkRecording', { enabled: networkRecording });
			}
		}

		async function refreshNetworkPanel() {
			if (!isCrossOrigin || !currentUrl || currentUrl === 'about:blank') return;

			try {
				const result = await callBackend('getNetworkRequests');
				if (result && result.success && Array.isArray(result.result)) {
					const tbody = document.getElementById('network-table-body');

					// Only add new requests
					result.result.forEach(req => {
						const existingReq = networkRequests.find(r => r.id === req.id);
						if (!existingReq) {
							networkRequests.push(req);
							renderNetworkRow(req);
						}
					});

					updateStatus();
				}
			} catch(e) {
				// Ignore errors
			}
		}

		function renderNetworkRow(request) {
			const tbody = document.getElementById('network-table-body');
			const tr = document.createElement('tr');
			tr.dataset.index = networkRequests.length - 1;

			const statusClass = request.status >= 200 && request.status < 300 ? 'network-status-2xx' :
				request.status >= 300 && request.status < 400 ? 'network-status-3xx' :
				request.status >= 400 && request.status < 500 ? 'network-status-4xx' : 'network-status-5xx';

			tr.innerHTML =
				'<td title="' + escapeHtml(request.url) + '">' + escapeHtml(request.name || getFileName(request.url)) + '</td>' +
				'<td class="' + statusClass + '">' + (request.status || '-') + '</td>' +
				'<td>' + (request.type || 'other') + '</td>' +
				'<td>' + formatSize(request.size) + '</td>' +
				'<td>' + (request.time ? request.time + 'ms' : '-') + '</td>';

			tr.addEventListener('click', () => showNetworkDetails(request));
			tbody.appendChild(tr);
		}

		function startNetworkRefresh() {
			if (networkRefreshTimer) return;
			networkRefreshTimer = setInterval(() => {
				if (document.getElementById('network-pane').classList.contains('active')) {
					refreshNetworkPanel();
				}
			}, 1000);
		}

		function stopNetworkRefresh() {
			if (networkRefreshTimer) {
				clearInterval(networkRefreshTimer);
				networkRefreshTimer = null;
			}
		}

		function addNetworkRequest(request) {
			if (!networkRecording) return;

			// Add unique ID if not present
			if (!request.id) {
				request.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
			}

			networkRequests.push(request);
			renderNetworkRow(request);
			updateStatus();
		}

		function showNetworkDetails(request) {
			const details = document.getElementById('network-details');
			const content = document.getElementById('network-detail-content');

			document.querySelectorAll('#network-table-body tr').forEach(tr => tr.classList.remove('selected'));
			event.target.closest('tr')?.classList.add('selected');

			content.textContent = JSON.stringify(request, null, 2);
			details.classList.add('active');
		}

		function getFileName(url) {
			try {
				const u = new URL(url);
				return u.pathname.split('/').pop() || u.hostname;
			} catch(e) {
				return url.substring(0, 30);
			}
		}

		function formatSize(bytes) {
			if (!bytes) return '-';
			if (bytes < 1024) return bytes + ' B';
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
			return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
		}

		// ==================== Sources Panel ====================
		async function loadPageSource() {
			const frame = document.getElementById('browser-frame');
			const content = document.getElementById('sources-content');

			let html = null;

			// First try direct access (same-origin)
			try {
				const doc = frame.contentDocument;
				if (doc && doc.documentElement) {
					html = doc.documentElement.outerHTML;
				}
			} catch(e) {
				// Cross-origin
			}

			// If direct access failed, try backend
			if (!html && currentUrl && currentUrl !== 'about:blank') {
				content.innerHTML = '<div style="color: #888; padding: 20px;">⏳ 正在加载源代码...</div>';

				try {
					await initBackendSession();
					const result = await callBackend('getContent');
					if (result && result.success && result.result.html) {
						html = result.result.html;
					}
				} catch(e) {
					// Backend failed
				}
			}

			if (html) {
				const lines = html.split('\\n');
				let output = '';

				lines.forEach((line, i) => {
					output += '<div class="source-line">' +
						'<span class="source-line-number">' + (i + 1) + '</span>' +
						'<span class="source-line-content">' + highlightHTML(escapeHtml(line)) + '</span>' +
						'</div>';
				});

				content.innerHTML = output;
			} else {
				content.innerHTML = '<div style="color: #f14c4c; padding: 20px;">⚠️ 无法获取页面源代码</div>' +
					'<div style="color: #888; padding: 0 20px;">请检查网络连接或刷新页面重试</div>';
			}
		}

		function highlightHTML(html) {
			// Simple syntax highlighting
			return html
				.replace(/(&lt;\\/?)(\\w+)/g, '$1<span class="syntax-tag">$2</span>')
				.replace(/(\\s)(\\w+)(=)/g, '$1<span class="syntax-attr">$2</span>$3')
				.replace(/(&quot;[^&]*&quot;)/g, '<span class="syntax-string">$1</span>')
				.replace(/(&lt;!--.*?--&gt;)/g, '<span class="syntax-comment">$1</span>');
		}

		// ==================== Utility Functions ====================
		function escapeHtml(str) {
			const div = document.createElement('div');
			div.textContent = str;
			return div.innerHTML;
		}

		// ==================== Iframe Console/Network Interception ====================
		function setupFrameInterception() {
			const frame = document.getElementById('browser-frame');
			try {
				const frameWindow = frame.contentWindow;
				if (!frameWindow) return;

				// Intercept console
				['log', 'warn', 'error', 'info'].forEach(method => {
					const original = frameWindow.console[method];
					frameWindow.console[method] = function(...args) {
						addConsoleMessage(method, args.map(a => formatValue(a)).join(' '), 'iframe');
						original.apply(frameWindow.console, args);
					};
				});

				// Intercept fetch
				const originalFetch = frameWindow.fetch;
				frameWindow.fetch = async function(url, options = {}) {
					const startTime = Date.now();
					try {
						const response = await originalFetch.apply(this, arguments);
						addNetworkRequest({
							url: String(url),
							method: options.method || 'GET',
							status: response.status,
							type: 'fetch',
							time: Date.now() - startTime
						});
						return response;
					} catch(e) {
						addNetworkRequest({
							url: String(url),
							method: options.method || 'GET',
							status: 0,
							type: 'fetch',
							error: e.message
						});
						throw e;
					}
				};

				// Intercept XMLHttpRequest
				const originalXHR = frameWindow.XMLHttpRequest;
				frameWindow.XMLHttpRequest = function() {
					const xhr = new originalXHR();
					const startTime = Date.now();
					let requestUrl = '';
					let requestMethod = 'GET';

					const originalOpen = xhr.open;
					xhr.open = function(method, url) {
						requestMethod = method;
						requestUrl = url;
						return originalOpen.apply(this, arguments);
					};

					xhr.addEventListener('loadend', () => {
						addNetworkRequest({
							url: requestUrl,
							method: requestMethod,
							status: xhr.status,
							type: 'xhr',
							size: xhr.response?.length,
							time: Date.now() - startTime
						});
					});

					return xhr;
				};

				// Intercept errors
				frameWindow.addEventListener('error', (e) => {
					addConsoleMessage('error', e.message + ' at ' + e.filename + ':' + e.lineno);
				});

				frameWindow.addEventListener('unhandledrejection', (e) => {
					addConsoleMessage('error', 'Unhandled Promise rejection: ' + e.reason);
				});

			} catch(e) {
				// Cross-origin - cannot intercept
			}
		}

		// ==================== Event Handlers ====================
		document.getElementById('browser-frame').addEventListener('load', function() {
			document.getElementById('loading-indicator').classList.remove('active');

			try {
				const frameUrl = this.contentWindow?.location?.href;
				const title = this.contentDocument?.title || currentUrl;

				if (frameUrl && frameUrl !== 'about:blank') {
					currentUrl = frameUrl;
					lastKnownUrl = frameUrl;
					document.getElementById('status-url').textContent = frameUrl;

					// Setup console/network interception for same-origin pages
					setupFrameInterception();

					// Refresh elements panel if open
					if (document.getElementById('elements-pane').classList.contains('active')) {
						refreshElementsPanel();
					}
				}

				vscode.postMessage({ type: 'loaded', url: frameUrl || currentUrl, title: title });
			} catch(e) {
				vscode.postMessage({ type: 'loaded', url: currentUrl, title: currentUrl });
			}
		});

		// Handle messages from extension
		window.addEventListener('message', function(event) {
			const message = event.data;
			switch(message.type) {
				case 'navigate':
					if (message.url === 'about:blank') {
						showWelcomePage();
					} else {
						navigateTo(message.url);
					}
					break;
				case 'refresh':
					if (currentUrl && currentUrl !== 'about:blank') {
						document.getElementById('loading-indicator').classList.add('active');
						const frame = document.getElementById('browser-frame');
						const url = currentUrl;
						frame.src = 'about:blank';
						setTimeout(() => { frame.src = url; }, 50);
					}
					break;
				case 'goHome':
					showWelcomePage();
					break;
				case 'getState':
					vscode.postMessage({
						type: 'state',
						url: currentUrl,
						consoleMessages: consoleMessages,
						networkRequests: networkRequests
					});
					break;
				case 'toggleDevTools':
					toggleDevTools();
					break;
				case 'executeScript':
					try {
						const frame = document.getElementById('browser-frame');
						const result = frame.contentWindow?.eval(message.script);
						vscode.postMessage({ type: 'scriptResult', result: result });
					} catch(e) {
						vscode.postMessage({ type: 'scriptError', error: e.message });
					}
					break;
				case 'captureScreenshot':
					captureScreenshot();
					break;
			}
		});

		// Screenshot capture function
		async function captureScreenshot() {
			try {
				const welcomePage = document.getElementById('welcome-page');
				const isWelcome = welcomePage.style.display !== 'none';
				const canvas = document.createElement('canvas');
				const ctx = canvas.getContext('2d');
				const width = window.innerWidth;
				const height = window.innerHeight - 30;
				canvas.width = width;
				canvas.height = height;

				if (isWelcome) {
					ctx.fillStyle = '#1e1e1e';
					ctx.fillRect(0, 0, width, height);
					ctx.fillStyle = '#ffffff';
					ctx.font = '24px sans-serif';
					ctx.textAlign = 'center';
					ctx.fillText('🌐 内置浏览器', width/2, height/2 - 30);
					ctx.font = '14px sans-serif';
					ctx.fillStyle = '#888888';
					ctx.fillText('专业的前后端开发浏览器', width/2, height/2 + 10);
				} else {
					ctx.fillStyle = '#1e1e1e';
					ctx.fillRect(0, 0, width, height);
					ctx.fillStyle = '#007acc';
					ctx.fillRect(0, 0, width, 40);
					ctx.fillStyle = '#ffffff';
					ctx.font = '14px sans-serif';
					ctx.fillText('🌐 ' + currentUrl, 10, 26);
					ctx.fillStyle = '#333333';
					ctx.fillRect(0, 40, width, height - 40);
					ctx.fillStyle = '#888888';
					ctx.font = '16px sans-serif';
					ctx.textAlign = 'center';
					ctx.fillText('浏览器截图 - ' + new Date().toLocaleString(), width/2, height/2);
				}

				const dataUrl = canvas.toDataURL('image/png');
				vscode.postMessage({ type: 'screenshotData', dataUrl: dataUrl, url: currentUrl });
			} catch(e) {
				vscode.postMessage({ type: 'screenshotError', error: e.message });
			}
		}

		// Expose functions globally
		window.navigateTo = navigateTo;
		window.toggleDevTools = toggleDevTools;
	</script>
</body>
</html>
		`;

		this.webview.setHtml(html);
	}

	private handleWebviewMessage(message: any): void {
		switch (message.type) {
			case 'navigate':
				this._currentUrl = message.url;
				if (this.urlInput) {
					this.urlInput.value = message.url === 'about:blank' ? '' : message.url;
				}
				this.addToHistory(message.url);
				break;

			case 'urlChanged':
				// URL changed within iframe (same-origin navigation)
				this._currentUrl = message.url;
				if (this.urlInput) {
					this.urlInput.value = message.url === 'about:blank' ? '' : message.url;
				}
				// Add to history for in-page navigation
				if (message.url !== 'about:blank') {
					this.addToHistory(message.url);
				}
				this.updateBrowserState({
					url: message.url,
					title: message.title,
				});
				break;

			case 'loaded':
				// Page finished loading - update URL if available
				if (message.url && message.url !== 'about:blank') {
					this._currentUrl = message.url;
					if (this.urlInput) {
						this.urlInput.value = message.url;
					}
				}
				this.updateBrowserState({
					url: message.url,
					title: message.title,
				});
				break;

			case 'console':
				this.consoleMessages.push({
					level: message.level,
					message: message.message,
					time: new Date().toISOString()
				} as any);
				this.updateBrowserState({
					consoleMessages: this.consoleMessages.map(m => `[${(m as any).level}] ${(m as any).message}`)
				});
				break;

			case 'state':
				this.updateBrowserState({
					url: message.url,
					consoleMessages: message.consoleMessages.map((m: any) => `[${m.level}] ${m.message}`),
					networkRequests: message.networkRequests
				});
				break;

			case 'screenshotData':
				this.handleScreenshotData(message.dataUrl, message.url);
				break;

			case 'screenshotSuccess':
				this.notificationService.info(message.message || '截图已复制到剪贴板');
				break;

			case 'screenshotError':
				this.notificationService.error(message.error || '截图失败');
				break;

			case 'openExternal':
				// 在外部浏览器中打开 URL
				if (message.url) {
					this.nativeHostService.openExternal(message.url);
				}
				break;
		}
	}

	private async handleScreenshotData(dataUrl: string, pageUrl: string): Promise<void> {
		try {
			// Convert base64 data URL to binary
			const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
			const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

			// Use native Electron clipboard to write image (no focus required)
			try {
				const buffer = VSBuffer.wrap(binaryData);
				await this.nativeHostService.writeClipboardImage(buffer);
				this.notificationService.info('截图已复制到剪贴板，可使用 Ctrl+V 粘贴到对话框');
			} catch (e) {
				console.error('[SenweaverBrowser] Native clipboard write failed:', e);
				this.notificationService.error('截图复制失败: ' + (e as Error).message);
			}
		} catch (e) {
			console.error('[SenweaverBrowser] Screenshot processing failed:', e);
			this.notificationService.error('截图处理失败: ' + (e as Error).message);
		}
	}

	private updateBrowserState(state: Partial<BrowserState>): void {
		(this.browserService as SenweaverBrowserService).updateState(state);
	}

	private addToHistory(url: string): void {
		if (this.historyIndex < this.history.length - 1) {
			this.history = this.history.slice(0, this.historyIndex + 1);
		}
		this.history.push(url);
		this.historyIndex = this.history.length - 1;
	}

	navigateTo(url: string): void {
		this._currentUrl = url;
		if (this.urlInput) {
			this.urlInput.value = url === 'about:blank' ? '' : url;
		}
		// Add to history
		this.addToHistory(url);
		if (this.webview) {
			this.webview.postMessage({ type: 'navigate', url });
		}
	}

	private goBack(): void {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.navigateWithoutHistory(this.history[this.historyIndex]);
		}
	}

	private goForward(): void {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.navigateWithoutHistory(this.history[this.historyIndex]);
		}
	}

	private navigateWithoutHistory(url: string): void {
		this._currentUrl = url;
		if (this.urlInput) {
			this.urlInput.value = url === 'about:blank' ? '' : url;
		}
		if (this.webview) {
			this.webview.postMessage({ type: 'navigate', url });
		}
	}

	private refresh(): void {
		if (this._currentUrl && this._currentUrl !== 'about:blank') {
			// Refresh current page
			if (this.webview) {
				this.webview.postMessage({ type: 'refresh' });
			}
		} else {
			// Refresh welcome page
			this.loadBrowserFrame();
		}
	}

	private goHome(): void {
		// Reset to welcome page
		this._currentUrl = 'about:blank';
		this.history = [];
		this.historyIndex = -1;
		if (this.urlInput) {
			this.urlInput.value = '';
		}
		// Send goHome message to webview to show welcome page
		if (this.webview) {
			this.webview.postMessage({ type: 'goHome' });
		}
		this.updateBrowserState({
			url: 'about:blank',
			title: '内置浏览器',
		});
	}

	private toggleDevTools(): void {
		if (this.webview) {
			this.webview.postMessage({ type: 'toggleDevTools' });
		}
	}

	private async sendPageToChat(): Promise<void> {
		const state = this.browserService.getCurrentState();
		if (state) {
			// Send current page info to chat
			const message = `当前页面信息:\nURL: ${state.url}\n标题: ${state.title}\n控制台消息: ${state.consoleMessages?.length || 0}条\n网络请求: ${state.networkRequests?.length || 0}个`;

			// Copy to clipboard so user can paste
			try {
				await navigator.clipboard.writeText(message);
				this.notificationService.info('页面信息已复制到剪贴板，可在对话框中粘贴');
			} catch (e) {
				console.error('[SenweaverBrowser] Failed to copy to clipboard:', e);
				this.notificationService.error('复制失败');
			}
		} else {
			this.notificationService.warn('暂无页面信息');
		}
	}

	// Dynamic port detection for backend service
	private _backendPort: number = 3006;
	private _backendPortDetected: boolean = false;

	private async detectBackendPort(): Promise<number> {
		if (this._backendPortDetected) return this._backendPort;

		const startPort = 3006;
		const maxAttempts = 20;

		for (let i = 0; i < maxAttempts; i++) {
			const port = startPort + i;
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 1000);

				const response = await fetch(`http://localhost:${port}/`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'listSessions' }),
					signal: controller.signal
				});

				clearTimeout(timeoutId);

				if (response.ok) {
					this._backendPort = port;
					this._backendPortDetected = true;
					return port;
				}
			} catch (e) {
				// Port not available, try next
			}
		}

		console.warn(`[SenweaverBrowser] ⚠️ Backend not detected, using default port ${startPort}`);
		return startPort;
	}

	private async captureScreenshot(): Promise<void> {
		const currentUrl = this._currentUrl;
		if (!currentUrl || currentUrl === 'about:blank') {
			this.notificationService.notify({ severity: Severity.Warning, message: '请先访问一个网页', sticky: false });
			return;
		}

		// Show progress notification (auto-dismiss)
		const progressHandle = this.notificationService.notify({
			severity: Severity.Info,
			message: '正在截取完整页面...',
			sticky: false
		});

		try {
			// Detect backend port dynamically
			const port = await this.detectBackendPort();

			// Use Playwright backend for full page screenshot (including scrolled content)
			const response = await fetch(`http://localhost:${port}/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'screenshot',
					sessionId: 'builtin-browser',
					url: currentUrl,
					fullPage: true  // Capture entire page including scrolled content
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`截图失败: ${response.status} - ${errorText}`);
			}

			// Get image as ArrayBuffer
			const imageBuffer = await response.arrayBuffer();
			const imageData = new Uint8Array(imageBuffer);

			// Write to clipboard using native API
			const buffer = VSBuffer.wrap(imageData);
			await this.nativeHostService.writeClipboardImage(buffer);

			// Close progress notification and show success
			progressHandle.close();
			this.notificationService.notify({
				severity: Severity.Info,
				message: '完整页面截图已复制到剪贴板',
				sticky: false
			});
		} catch (e) {
			console.error('[SenweaverBrowser] Screenshot failed:', e);
			progressHandle.close();
			this.notificationService.notify({
				severity: Severity.Error,
				message: '截图失败: ' + (e as Error).message,
				sticky: false
			});
		}
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		// Always dispose existing webview and create fresh one for new input
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}

		// Reset state for fresh browser
		this._currentUrl = 'about:blank';
		this.history = [];
		this.historyIndex = -1;
		if (this.urlInput) {
			this.urlInput.value = '';
		}

		// Reinitialize webview
		if (this.container) {
			let webviewContainer = this.container.querySelector('.senweaver-browser-webview') as HTMLElement;
			if (webviewContainer) {
				// Clear any stale content using DOM API (Trusted Types safe)
				while (webviewContainer.firstChild) {
					webviewContainer.removeChild(webviewContainer.firstChild);
				}

				this.webview = this.webviewService.createWebviewElement({
					providedViewType: 'senweaver.browser',
					title: '内置浏览器',
					options: {
						enableFindWidget: true,
						retainContextWhenHidden: true,
					},
					contentOptions: {
						allowScripts: true,
						localResourceRoots: [],
					},
					extension: undefined
				});
				this.webview.mountTo(webviewContainer, this.window);
				(this.browserService as SenweaverBrowserService).setWebview(this.webview);
				this._register(this.webview.onMessage(e => {
					this.handleWebviewMessage(e.message);
				}));
				this.loadBrowserFrame();
			}
		}

		// Navigate if URL provided
		if (input instanceof SenweaverBrowserInput) {
			const url = input.url;
			if (url && url !== 'about:blank') {
				this.navigateTo(url);
			}
		}
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	override dispose(): void {
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}
		super.dispose();
	}
}

// Register editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		SenweaverBrowserEditor,
		SenweaverBrowserEditor.ID,
		localize('senweaverBrowser', '内置浏览器')
	),
	[new SyncDescriptor(SenweaverBrowserInput)]
);

// Register action to open browser
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.openBrowser',
			title: { value: localize('openBrowser', '打开内置浏览器'), original: 'Open Built-in Browser' },
			f1: true,
			icon: Codicon.globe,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyB,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const browserService = accessor.get(ISenweaverBrowserService);
		await browserService.openBrowser();
	}
});

// Register action to open browser with URL
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.openBrowserWithUrl',
			title: { value: localize('openBrowserWithUrl', '在内置浏览器中打开URL'), original: 'Open URL in Built-in Browser' },
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, url?: string): Promise<void> {
		const browserService = accessor.get(ISenweaverBrowserService);
		await browserService.openBrowser(url);
	}
});
