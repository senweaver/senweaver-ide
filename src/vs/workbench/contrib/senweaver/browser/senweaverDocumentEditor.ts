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
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';

// Document state for AI interaction
export interface DocumentState {
	filePath: string;
	fileName: string;
	fileType: string;
	content: string;
	contentLength: number;
	pages: number;
	isModified: boolean;
	lastSaved?: Date;
	pdfData?: string;  // Base64 encoded PDF data for native rendering
	pdfId?: string;    // PDF ID for HTTP serving
	htmlData?: string; // HTML content for Word/Excel native rendering
	docxData?: string; // Base64 encoded DOCX data for docx-preview rendering
	xlsxData?: string; // Base64 encoded XLSX data for xlsx rendering
	pptxData?: string; // Base64 encoded PPTX data for pptx rendering
	metadata?: {
		format: string;
		extractedAs: string;
		sheets?: string[];
		info?: any;
	};
}

// Service interface for document communication
export interface ISenweaverDocumentService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onStateChange: Event<DocumentState>;
	readonly onContentChange: Event<string>;
	readonly onDocumentModified: Event<string>; // Event fired when document is modified externally

	// Methods
	getCurrentState(): DocumentState | undefined;
	openDocument(filePath: string): Promise<void>;
	updateContent(content: string): void;
	saveDocument(): Promise<boolean>;
	getContent(): string;
	sendToChat(data: any): void;
	refreshDocument(filePath: string): Promise<void>; // Refresh document after external modification
	notifyDocumentModified(filePath: string): void; // Notify that document was modified
}

export const ISenweaverDocumentService = createDecorator<ISenweaverDocumentService>('senweaverDocumentService');

// Port detection for document reader service
const DEFAULT_DOCUMENT_READER_PORT = 3008;
let _documentReaderPort: number | null = null;

async function getDocumentReaderPort(): Promise<number> {
	if (_documentReaderPort !== null) return _documentReaderPort;

	const startPort = DEFAULT_DOCUMENT_READER_PORT;
	const maxAttempts = 20;

	for (let i = 0; i < maxAttempts; i++) {
		const port = startPort + i;
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 1000);

			const response = await fetch(`http://localhost:${port}/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ file_path: '' }),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (response.status === 400 || response.status === 200) {
				_documentReaderPort = port;
				return port;
			}
		} catch (e) {
			// Port not available, try next
		}
	}

	_documentReaderPort = startPort;
	return startPort;
}

// Service implementation
class SenweaverDocumentService extends Disposable implements ISenweaverDocumentService {
	readonly _serviceBrand: undefined;

	private _currentState: DocumentState | undefined;
	private _documentInput: SenweaverDocumentInput | undefined;
	public _serverPort: number = 3008;  // Dynamic port for document reader server

	private readonly _onStateChange = this._register(new Emitter<DocumentState>());
	readonly onStateChange = this._onStateChange.event;

	private readonly _onContentChange = this._register(new Emitter<string>());
	readonly onContentChange = this._onContentChange.event;

	private readonly _onDocumentModified = this._register(new Emitter<string>());
	readonly onDocumentModified = this._onDocumentModified.event;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
	}

	getCurrentState(): DocumentState | undefined {
		return this._currentState;
	}

	updateState(state: Partial<DocumentState>): void {
		this._currentState = { ...this._currentState, ...state } as DocumentState;
		this._onStateChange.fire(this._currentState);
	}

	async openDocument(filePath: string): Promise<void> {
		try {
			const port = await getDocumentReaderPort();
			this._serverPort = port;  // Store the dynamic port
			const response = await fetch(`http://localhost:${port}/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					file_path: filePath,
					start_index: 0,
					max_length: 100000
				})
			});

			if (!response.ok) {
				throw new Error(`Failed to read document: ${response.status}`);
			}

			const result = await response.json();

			const fileName = filePath.split(/[/\\]/).pop() || 'document';
			this._currentState = {
				filePath,
				fileName,
				fileType: result.fileType,
				content: result.content,
				contentLength: result.contentLength,
				pages: result.pages,
				isModified: false,
				pdfData: result.pdfData,  // Store PDF base64 data for native rendering
				htmlData: result.htmlData,  // Store HTML data for Word/Excel native rendering
				docxData: result.docxData,  // Store DOCX base64 data for docx-preview rendering
				xlsxData: result.xlsxData,  // Store XLSX base64 data for xlsx rendering
				pptxData: result.pptxData,  // Store PPTX base64 data for pptx rendering
				metadata: result.metadata
			};

			this._documentInput = this.instantiationService.createInstance(SenweaverDocumentInput, filePath, this._currentState);
			await this.editorService.openEditor(this._documentInput, { pinned: true });

			this._onStateChange.fire(this._currentState);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.notify({
				severity: Severity.Error,
				message: `Failed to open document: ${errorMessage}`
			});
		}
	}

	updateContent(content: string): void {
		if (this._currentState) {
			this._currentState.content = content;
			this._currentState.isModified = true;
			this._onContentChange.fire(content);
			this._onStateChange.fire(this._currentState);
		}
	}

	async saveDocument(): Promise<boolean> {
		if (!this._currentState) return false;

		try {
			const port = await getDocumentReaderPort();
			const response = await fetch(`http://localhost:${port}/write`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					file_path: this._currentState.filePath,
					content: this._currentState.content,
					options: { backup: true }
				})
			});

			if (!response.ok) {
				throw new Error(`Failed to save document: ${response.status}`);
			}

			this._currentState.isModified = false;
			this._currentState.lastSaved = new Date();
			this._onStateChange.fire(this._currentState);

			this.notificationService.notify({
				severity: Severity.Info,
				message: `Document saved: ${this._currentState.fileName}`
			});

			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.notify({
				severity: Severity.Error,
				message: `Failed to save document: ${errorMessage}`
			});
			return false;
		}
	}

	getContent(): string {
		return this._currentState?.content || '';
	}

	sendToChat(data: any): void {
		console.log('[SenweaverDocument] Sending to chat:', data);
	}

	async refreshDocument(filePath: string): Promise<void> {
		// If current document matches, reload it
		if (this._currentState?.filePath === filePath ||
			this._currentState?.filePath.replace(/\\/g, '/') === filePath.replace(/\\/g, '/')) {
			await this.openDocument(filePath);
		}
		// Fire the modified event to notify any listeners
		this._onDocumentModified.fire(filePath);
	}

	notifyDocumentModified(filePath: string): void {
		this._onDocumentModified.fire(filePath);
		// Auto-refresh if it's the current document
		if (this._currentState?.filePath === filePath ||
			this._currentState?.filePath.replace(/\\/g, '/') === filePath.replace(/\\/g, '/')) {
			this.refreshDocument(filePath).catch(err => {
				console.error('[SenweaverDocument] Failed to auto-refresh:', err);
			});
		}
	}
}

// Register the service
registerSingleton(ISenweaverDocumentService, SenweaverDocumentService, InstantiationType.Delayed);

// Editor Input
export class SenweaverDocumentInput extends EditorInput {
	static readonly ID = 'workbench.input.SenweaverDocument';

	readonly resource: URI;

	constructor(
		public readonly filePath: string,
		public documentState: DocumentState
	) {
		super();
		this.resource = URI.file(filePath);
	}

	override get typeId(): string {
		return SenweaverDocumentInput.ID;
	}

	override getName(): string {
		const modified = this.documentState.isModified ? '• ' : '';
		return `${modified}${this.documentState.fileName}`;
	}

	override getDescription(): string {
		return this.filePath;
	}

	override matches(other: EditorInput): boolean {
		return other instanceof SenweaverDocumentInput && other.filePath === this.filePath;
	}

	updateDocumentState(state: DocumentState): void {
		this.documentState = state;
	}
}

// Editor Pane
export class SenweaverDocumentEditor extends EditorPane {
	static readonly ID = 'workbench.editor.SenweaverDocument';

	private container: HTMLElement | undefined;
	private toolbar: HTMLElement | undefined;
	private contentArea: HTMLElement | undefined;
	private statusBar: HTMLElement | undefined;
	private currentInput: SenweaverDocumentInput | undefined;
	private webview: IWebviewElement | undefined;
	private webviewContainer: HTMLElement | undefined;
	private cachedPdfjsDataUri: string = '';
	private cachedWorkerDataUri: string = '';
	private cachedDocxPreviewDataUri: string = '';
	private cachedXlsxDataUri: string = '';
	private cachedJszipDataUri: string = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ISenweaverDocumentService private readonly documentService: ISenweaverDocumentService,
		@IWebviewService private readonly webviewService: IWebviewService,
	) {
		super(SenweaverDocumentEditor.ID, group, telemetryService, themeService, storageService);

		// Listen for content changes
		this._register(this.documentService.onStateChange(state => {
			// Update currentInput's documentState
			if (this.currentInput && state.filePath === this.currentInput.filePath) {
				this.currentInput.updateDocumentState(state);
			}
			this.updateUI(state);
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = document.createElement('div');
		this.container.className = 'senweaver-document-editor';
		this.container.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		`;

		// Create toolbar
		this.toolbar = document.createElement('div');
		this.toolbar.className = 'senweaver-document-toolbar';
		this.toolbar.style.cssText = `
			display: flex;
			align-items: center;
			padding: 10px 16px;
			background: linear-gradient(180deg, var(--vscode-editorWidget-background) 0%, var(--vscode-editor-background) 100%);
			border-bottom: 1px solid var(--vscode-editorWidget-border);
			gap: 8px;
			flex-wrap: wrap;
		`;

		// Document type icon
		const docIcon = document.createElement('span');
		docIcon.id = 'document-type-icon';
		docIcon.style.cssText = `font-size: 20px; margin-right: 8px;`;
		docIcon.textContent = '📄';
		this.toolbar.appendChild(docIcon);

		// Action buttons group
		const actionsGroup = document.createElement('div');
		actionsGroup.style.cssText = `display: flex; gap: 6px;`;

		// Refresh button
		const refreshBtn = this.createButton('🔄 刷新', () => this.refreshDocument());
		actionsGroup.appendChild(refreshBtn);

		this.toolbar.appendChild(actionsGroup);

		// File info
		const fileInfo = document.createElement('div');
		fileInfo.id = 'document-file-info';
		fileInfo.style.cssText = `
			margin-left: auto;
			display: flex;
			align-items: center;
			gap: 12px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		`;
		this.toolbar.appendChild(fileInfo);

		this.container.appendChild(this.toolbar);

		// Create content area
		this.contentArea = document.createElement('div');
		this.contentArea.className = 'senweaver-document-content';
		this.contentArea.style.cssText = `
			flex: 1;
			overflow: auto;
			padding: 0;
			display: flex;
			flex-direction: column;
		`;

		// Create webview container for native document rendering (PDF, Word, Excel)
		this.webviewContainer = document.createElement('div');
		this.webviewContainer.id = 'webview-viewer-container';
		this.webviewContainer.style.cssText = `
			width: 100%;
			height: 100%;
			display: none;
			position: relative;
		`;
		this.contentArea.appendChild(this.webviewContainer);

		// Create webview for native rendering
		this.webview = this.webviewService.createWebviewElement({
			providedViewType: 'senweaver.documentViewer',
			title: '文档查看器',
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: true,
				disableServiceWorker: true,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [],
				enableCommandUris: false,
				allowForms: true,
			},
			extension: undefined
		});
		this.webview.mountTo(this.webviewContainer, this.window);
		this._register(this.webview);

		// Create textarea for editing (for non-PDF documents)
		const textarea = document.createElement('textarea');
		textarea.id = 'document-content-textarea';
		textarea.style.cssText = `
			width: 100%;
			height: 100%;
			min-height: 500px;
			padding: 16px;
			border: none;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			line-height: 1.6;
			resize: none;
			display: none;
		`;
		textarea.addEventListener('input', () => {
			this.documentService.updateContent(textarea.value);
		});
		this.contentArea.appendChild(textarea);

		this.container.appendChild(this.contentArea);

		// Create status bar
		this.statusBar = document.createElement('div');
		this.statusBar.className = 'senweaver-document-statusbar';
		this.statusBar.style.cssText = `
			display: flex;
			align-items: center;
			padding: 4px 16px;
			background: var(--vscode-statusBar-background);
			color: var(--vscode-statusBar-foreground);
			font-size: 12px;
			gap: 16px;
		`;
		this.container.appendChild(this.statusBar);

		parent.appendChild(this.container);
	}

	private createButton(text: string, onClick: () => void, style?: string): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.textContent = text;

		let bgColor = 'var(--vscode-button-background)';
		let hoverColor = 'var(--vscode-button-hoverBackground)';

		if (style === 'primary') {
			bgColor = 'var(--vscode-button-background)';
		} else if (style === 'secondary') {
			bgColor = 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))';
			hoverColor = 'var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground))';
		} else if (style === 'toggle' || style === 'toggle-active') {
			bgColor = style === 'toggle-active' ? 'var(--vscode-button-background)' : 'transparent';
			hoverColor = 'var(--vscode-button-hoverBackground)';
		}

		btn.style.cssText = `
			padding: 4px 12px;
			background: ${bgColor};
			color: var(--vscode-button-foreground);
			border: ${style?.startsWith('toggle') ? '1px solid var(--vscode-button-border, transparent)' : 'none'};
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
			transition: background 0.15s ease;
		`;
		btn.dataset.style = style || 'default';
		btn.addEventListener('click', onClick);
		btn.addEventListener('mouseenter', () => {
			btn.style.background = hoverColor;
		});
		btn.addEventListener('mouseleave', () => {
			btn.style.background = bgColor;
		});
		return btn;
	}

	override async setInput(input: SenweaverDocumentInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this.currentInput = input;

		// Check if we have a current state from the service that matches this file
		const serviceState = this.documentService.getCurrentState();
		if (serviceState && serviceState.filePath === input.filePath && (serviceState.content || serviceState.pdfData || serviceState.pdfId || serviceState.htmlData)) {
			input.updateDocumentState(serviceState);
			this.updateUI(serviceState);
		} else if (input.documentState.pdfData || input.documentState.pdfId || input.documentState.htmlData || input.documentState.content) {
			// Use input's document state if it has data
			this.updateUI(input.documentState);
		} else {
			// Reload document if no data available
			this.documentService.openDocument(input.filePath).then(() => {
				const newState = this.documentService.getCurrentState();
				if (newState) {
					input.updateDocumentState(newState);
					this.updateUI(newState);
				}
			});
		}
	}

	private updateUI(state: DocumentState): void {
		if (!this.container) return;

		// Update file info
		const fileInfo = this.container.querySelector('#document-file-info');
		if (fileInfo) {
			const typeEmoji = this.getTypeEmoji(state.fileType);
			fileInfo.textContent = `${typeEmoji} ${state.fileType.toUpperCase()} | ${state.pages} 页 | ${state.contentLength} 字符`;
		}

		// Get content elements
		const textarea = this.container.querySelector('#document-content-textarea') as HTMLTextAreaElement;

		// Hide all viewers first
		if (this.webviewContainer) this.webviewContainer.style.display = 'none';
		if (textarea) textarea.style.display = 'none';

		// Handle documents with PDF data (native rendering via webview)
		if (state.pdfData || state.pdfId) {
			if (this.webviewContainer && this.webview) {
				this.webviewContainer.style.display = 'block';
				// Fire-and-forget async call with error handling
				this.renderPdfInWebview(state.pdfData || '', state.pdfId).catch(e => console.error('PDF render failed:', e));
			} else {
				console.error('[SenweaverDocument] updateUI: webview or container missing!');
			}
		}
		// Handle Word files with docx-preview rendering (native rendering via webview)
		else if (state.fileType === 'word' && state.docxData) {
			if (this.webviewContainer && this.webview) {
				this.webviewContainer.style.display = 'block';
				this.renderDocxInWebview(state.docxData).catch(e => console.error('DOCX render failed:', e));
			}
		}
		// Handle Excel files with xlsx rendering (native rendering via webview)
		else if (state.fileType === 'excel' && state.xlsxData) {
			if (this.webviewContainer && this.webview) {
				this.webviewContainer.style.display = 'block';
				this.renderXlsxInWebview(state.xlsxData, state.metadata?.sheets).catch(e => console.error('XLSX render failed:', e));
			}
		}
		// Handle PowerPoint files with pptx rendering (native rendering via webview)
		else if (state.fileType === 'powerpoint' && state.pptxData) {
			if (this.webviewContainer && this.webview) {
				this.webviewContainer.style.display = 'block';
				this.renderPptxInWebview(state.pptxData).catch(e => console.error('PPTX render failed:', e));
			}
		}
		// Handle Word/Excel/PPT files with HTML rendering (via webview)
		else if ((state.fileType === 'word' || state.fileType === 'excel' || state.fileType === 'powerpoint') && state.htmlData) {
			if (this.webviewContainer && this.webview) {
				this.webviewContainer.style.display = 'block';
				this.renderHtmlInWebview(state.htmlData);
			}
		}
		// Fallback to textarea for other documents or when no native data
		else {
			if (textarea) {
				textarea.style.display = 'block';
				if (textarea.value !== state.content) {
					textarea.value = state.content;
				}
			}
		}

		// Update status bar - use DOM API instead of innerHTML for TrustedHTML policy
		if (this.statusBar) {
			const modifiedStatus = state.isModified ? '• 已修改' : '✓ 已保存';
			const lastSaved = state.lastSaved ? `上次保存: ${state.lastSaved.toLocaleTimeString()}` : '';

			// Clear existing content
			while (this.statusBar.firstChild) {
				this.statusBar.removeChild(this.statusBar.firstChild);
			}

			// Create spans using DOM API
			const fileNameSpan = document.createElement('span');
			fileNameSpan.textContent = `📄 ${state.fileName}`;
			this.statusBar.appendChild(fileNameSpan);

			const statusSpan = document.createElement('span');
			statusSpan.textContent = modifiedStatus;
			this.statusBar.appendChild(statusSpan);

			const savedSpan = document.createElement('span');
			savedSpan.textContent = lastSaved;
			this.statusBar.appendChild(savedSpan);

			const formatSpan = document.createElement('span');
			formatSpan.style.marginLeft = 'auto';
			formatSpan.textContent = `格式: ${state.metadata?.format || state.fileType}`;
			this.statusBar.appendChild(formatSpan);
		}
	}

	private recreateWebview(): void {
		if (!this.webviewContainer) {
			console.error('[SenweaverDocument] webviewContainer is undefined!');
			return;
		}

		// Dispose old webview if exists
		if (this.webview) {
			this.webview.dispose();
			this.webview = undefined;
		}

		// Create new webview
		this.webview = this.webviewService.createWebviewElement({
			providedViewType: 'senweaver.documentViewer',
			title: '文档查看器',
			options: {
				enableFindWidget: true,
				retainContextWhenHidden: false, // Don't retain context to force fresh render
				disableServiceWorker: true,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: [],
				enableCommandUris: false,
				allowForms: true,
			},
			extension: undefined
		});
		this.webview.mountTo(this.webviewContainer, this.window);
		this._register(this.webview);
	}

	private async renderPdfInWebview(base64Data: string, pdfId?: string): Promise<void> {
		// Recreate webview to ensure it's in active state after tab switch
		this.recreateWebview();

		if (!this.webview) {
			console.error('[SenweaverDocument] webview is undefined!');
			return;
		}

		// Get the document reader server port
		const port = (this.documentService as any)._serverPort || 3008;
		const pdfUrl = pdfId ? `http://localhost:${port}/pdf/${pdfId}` : '';

		// Use cached PDF.js or fetch from local server
		let pdfjsDataUri = this.cachedPdfjsDataUri;
		let workerDataUri = this.cachedWorkerDataUri;

		if (!pdfjsDataUri || !workerDataUri) {
			try {
				const [pdfjsResponse, workerResponse] = await Promise.all([
					fetch(`http://localhost:${port}/pdfjs/pdf.min.js`),
					fetch(`http://localhost:${port}/pdfjs/pdf.worker.min.js`)
				]);
				if (pdfjsResponse.ok) {
					const pdfjsCode = await pdfjsResponse.text();
					pdfjsDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(pdfjsCode)));
					this.cachedPdfjsDataUri = pdfjsDataUri;
				}
				if (workerResponse.ok) {
					const workerCode = await workerResponse.text();
					workerDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(workerCode)));
					this.cachedWorkerDataUri = workerDataUri;
				}
			} catch (e) {
				console.error('[SenweaverDocument] Failed to fetch PDF.js:', e);
			}
		} else {

		}

		if (!pdfjsDataUri) {
			console.error('[SenweaverDocument] PDF.js not available');
			return;
		}

		// Render PDF using canvas with PDF.js embedded as data URI (offline mode)
		// Add timestamp to force webview refresh on tab switch
		const timestamp = Date.now();
		const html = `
		<!DOCTYPE html>
		<!-- refresh: ${timestamp} -->
		<html>
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; connect-src http://localhost:*; worker-src data: blob:;">
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				html, body { width: 100%; height: 100%; overflow: hidden; background: #525659; }
				#container { width: 100%; height: 100%; overflow: auto; padding: 20px; display: flex; flex-direction: column; align-items: center; }
				canvas { margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); background: white; }
				#loading { text-align: center; color: white; padding: 50px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; }
				#error { text-align: center; color: #ff6b6b; padding: 50px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
			</style>
		</head>
		<body>
			<div id="container">
				<div id="loading">正在加载PDF...</div>
			</div>
			<script>
				console.log('[Webview] Starting PDF render...');
				// Load PDF.js via data URI to bypass CSP restrictions
				var script = document.createElement('script');
				script.src = '${pdfjsDataUri}';
				script.onload = async function() {
					console.log('[Webview] PDF.js script loaded');
					const container = document.getElementById('container');
					const loading = document.getElementById('loading');

					try {
						if (typeof pdfjsLib === 'undefined') {
							throw new Error('PDF.js库未加载');
						}
						console.log('[Webview] pdfjsLib available');

						// Set worker source to data URI
						pdfjsLib.GlobalWorkerOptions.workerSrc = '${workerDataUri}';

						let pdfData;
						const pdfUrl = '${pdfUrl}';
						const base64Data = '${base64Data}';

						if (pdfUrl) {
							// Load PDF from HTTP URL
							const response = await fetch(pdfUrl);
							const arrayBuffer = await response.arrayBuffer();
							pdfData = { data: new Uint8Array(arrayBuffer) };
						} else if (base64Data) {
							// Decode base64 to binary
							const binaryString = atob(base64Data);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							pdfData = { data: bytes };
						} else {
							throw new Error('No PDF data available');
						}

						// Load PDF
						const pdf = await pdfjsLib.getDocument(pdfData).promise;
						loading.style.display = 'none';

						// Render all pages
						for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
							const page = await pdf.getPage(pageNum);
							const scale = 1.5;
							const viewport = page.getViewport({ scale });

							const canvas = document.createElement('canvas');
							canvas.width = viewport.width;
							canvas.height = viewport.height;

							const context = canvas.getContext('2d');
							await page.render({ canvasContext: context, viewport }).promise;

							container.appendChild(canvas);
						}
					} catch (error) {
						loading.innerHTML = '<div id="error">PDF加载失败: ' + error.message + '</div>';
						console.error('PDF render error:', error);
					}
				};
				script.onerror = function(e) {
					document.getElementById('loading').innerHTML = '<div id="error">PDF.js库加载失败</div>';
					console.error('Script load error:', e);
				};
				document.head.appendChild(script);
			</script>
			</body>
			</html>
		`;

		// Webview is recreated fresh each time, so just set HTML directly
		this.webview.setHtml(html);
	}

	private async renderDocxInWebview(base64Data: string): Promise<void> {

		// Recreate webview to ensure it's in active state after tab switch
		this.recreateWebview();

		if (!this.webview) {
			console.error('[SenweaverDocument] webview is undefined!');
			return;
		}

		// Get the document reader server port
		const port = (this.documentService as any)._serverPort || 3008;

		// Use cached JSZip library or fetch from local server (required by docx-preview)
		let jszipDataUri = this.cachedJszipDataUri;

		if (!jszipDataUri) {
			try {
				const response = await fetch(`http://localhost:${port}/jszip/jszip.min.js`);
				if (response.ok) {
					const code = await response.text();
					jszipDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
					this.cachedJszipDataUri = jszipDataUri;
				}
			} catch (e) {
				console.error('[SenweaverDocument] Failed to fetch JSZip:', e);
			}
		}

		// Use cached docx-preview or fetch from local server
		let docxPreviewDataUri = this.cachedDocxPreviewDataUri;

		if (!docxPreviewDataUri) {
			try {
				const response = await fetch(`http://localhost:${port}/docx-preview/docx-preview.min.js`);
				if (response.ok) {
					const code = await response.text();
					docxPreviewDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
					this.cachedDocxPreviewDataUri = docxPreviewDataUri;
				}
			} catch (e) {
				console.error('[SenweaverDocument] Failed to fetch docx-preview:', e);
			}
		}

		if (!jszipDataUri || !docxPreviewDataUri) {
			console.error('[SenweaverDocument] JSZip or docx-preview not available');
			return;
		}

		// Render DOCX using docx-preview library loaded via data URI
		const timestamp = Date.now();
		const html = `
		<!DOCTYPE html>
		<!-- refresh: ${timestamp} -->
		<html>
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline'; connect-src http://localhost:*; img-src data: blob:;">
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				html, body { width: 100%; height: 100%; overflow: hidden; background: #f5f5f5; }
				#container { width: 100%; height: 100%; overflow: auto; }
				#loading { text-align: center; color: #666; padding: 50px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 16px; }
				#error { text-align: center; color: #ff6b6b; padding: 50px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
				.docx-wrapper { background: #f5f5f5 !important; padding: 20px !important; }
				.docx-wrapper > section.docx { background: white !important; box-shadow: 0 2px 10px rgba(0,0,0,0.1) !important; margin: 0 auto 20px !important; }
				/* 表格样式优化 - 更接近Office原版 */
				.docx table { border-collapse: collapse !important; }
				.docx table td, .docx table th {
					border: 1px solid #000 !important;
					padding: 4px 8px !important;
					vertical-align: top !important;
				}
				.docx table tr { page-break-inside: avoid !important; }
				/* 保持原始字体和行高 */
				.docx p { line-height: 1.5 !important; }
			</style>
		</head>
		<body>
			<div id="container">
				<div id="loading">正在加载Word文档...</div>
			</div>
			<script>
				console.log('[Webview] Starting DOCX render...');
				const container = document.getElementById('container');
				const loading = document.getElementById('loading');

				// First load JSZip (required by docx-preview)
				var jszipScript = document.createElement('script');
				jszipScript.src = '${jszipDataUri}';
				jszipScript.onload = function() {
					console.log('[Webview] JSZip script loaded');

					// Then load docx-preview
					var docxScript = document.createElement('script');
					docxScript.src = '${docxPreviewDataUri}';
					docxScript.onload = async function() {
						console.log('[Webview] docx-preview script loaded');
						try {
							if (typeof docx === 'undefined') {
								throw new Error('docx-preview库未加载');
							}
							console.log('[Webview] docx-preview available');

							// Decode base64 to ArrayBuffer
							const base64Data = '${base64Data}';
							const binaryString = atob(base64Data);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}

							// Clear loading message
							loading.style.display = 'none';

							// Render DOCX
							await docx.renderAsync(bytes.buffer, container, null, {
								className: 'docx',
								inWrapper: true,
								ignoreWidth: false,
								ignoreHeight: false,
								ignoreFonts: false,
								breakPages: true,
								useBase64URL: true,
								renderHeaders: true,
								renderFooters: true,
								renderFootnotes: true,
								renderEndnotes: true
							});
							console.log('[Webview] DOCX rendered successfully');
						} catch (error) {
							loading.innerHTML = '<div id="error">Word文档加载失败: ' + error.message + '</div>';
							console.error('DOCX render error:', error);
						}
					};
					docxScript.onerror = function(e) {
						loading.innerHTML = '<div id="error">docx-preview库加载失败</div>';
						console.error('docx-preview load error:', e);
					};
					document.head.appendChild(docxScript);
				};
				jszipScript.onerror = function(e) {
					loading.innerHTML = '<div id="error">JSZip库加载失败</div>';
					console.error('JSZip load error:', e);
				};
				document.head.appendChild(jszipScript);
			</script>
		</body>
		</html>
		`;

		this.webview.setHtml(html);
	}

	private async renderXlsxInWebview(base64Data: string, sheets?: string[]): Promise<void> {

		// Recreate webview to ensure it's in active state after tab switch
		this.recreateWebview();

		if (!this.webview) {
			console.error('[SenweaverDocument] webview is undefined!');
			return;
		}

		// Get the document reader server port
		const port = (this.documentService as any)._serverPort || 3008;

		// Use cached xlsx library or fetch from local server
		let xlsxDataUri = this.cachedXlsxDataUri;

		if (!xlsxDataUri) {
			try {
				const response = await fetch(`http://localhost:${port}/xlsx/xlsx.full.min.js`);
				if (response.ok) {
					const code = await response.text();
					xlsxDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
					this.cachedXlsxDataUri = xlsxDataUri;

				}
			} catch (e) {
				console.error('[SenweaverDocument] Failed to fetch xlsx library:', e);
			}
		}

		if (!xlsxDataUri) {
			console.error('[SenweaverDocument] xlsx library not available');
			return;
		}

		// Render XLSX using SheetJS library loaded via data URI
		const timestamp = Date.now();
		const sheetTabs = sheets?.map((name, i) => `<button class="sheet-tab ${i === 0 ? 'active' : ''}" onclick="showSheet(${i})">${name}</button>`).join('') || '';

		const html = `
		<!DOCTYPE html>
		<!-- refresh: ${timestamp} -->
		<html>
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline'; img-src data: blob:;">
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				html, body { width: 100%; height: 100%; overflow: hidden; background: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
				#container { width: 100%; height: 100%; display: flex; flex-direction: column; }
				#loading { text-align: center; color: #666; padding: 50px; font-size: 16px; }
				#error { text-align: center; color: #ff6b6b; padding: 50px; }
				.sheet-tabs { display: flex; background: #e0e0e0; border-bottom: 1px solid #ccc; padding: 4px 8px 0; gap: 2px; }
				.sheet-tab { padding: 8px 16px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; background: #f5f5f5; font-size: 13px; border-radius: 4px 4px 0 0; }
				.sheet-tab:hover { background: #e8e8e8; }
				.sheet-tab.active { background: white; border-bottom: 1px solid white; margin-bottom: -1px; }
				#sheet-container { flex: 1; overflow: auto; background: white; }
				.sheet-content { display: none; }
				.sheet-content.active { display: block; }
				table { border-collapse: collapse; font-size: 13px; }
				th { background: #f5f5f5; font-weight: bold; text-align: center; padding: 6px 10px; border: 1px solid #d0d0d0; min-width: 80px; position: sticky; top: 0; }
				td { padding: 6px 10px; border: 1px solid #d0d0d0; white-space: nowrap; }
				tr:nth-child(even) { background: #fafafa; }
				tr:hover { background: #e8f4fc; }
				.row-num { background: #f5f5f5; color: #666; text-align: center; font-weight: normal; width: 40px; position: sticky; left: 0; }
			</style>
		</head>
		<body>
			<div id="container">
				<div id="loading">正在加载Excel文档...</div>
				<div class="sheet-tabs" style="display:none;">${sheetTabs}</div>
				<div id="sheet-container"></div>
			</div>
			<script>
				console.log('[Webview] Starting XLSX render...');
				const container = document.getElementById('sheet-container');
				const loading = document.getElementById('loading');
				const tabs = document.querySelector('.sheet-tabs');
				let workbook = null;

				window.showSheet = function(index) {
					document.querySelectorAll('.sheet-content').forEach((el, i) => {
						el.classList.toggle('active', i === index);
					});
					document.querySelectorAll('.sheet-tab').forEach((el, i) => {
						el.classList.toggle('active', i === index);
					});
				};

				// Load SheetJS via data URI
				var script = document.createElement('script');
				script.src = '${xlsxDataUri}';
				script.onload = async function() {
					console.log('[Webview] SheetJS script loaded');
					try {
						if (typeof XLSX === 'undefined') {
							throw new Error('SheetJS库未加载');
						}
						console.log('[Webview] SheetJS available');

						// Decode base64 to ArrayBuffer
						const base64Data = '${base64Data}';
						const binaryString = atob(base64Data);
						const bytes = new Uint8Array(binaryString.length);
						for (let i = 0; i < binaryString.length; i++) {
							bytes[i] = binaryString.charCodeAt(i);
						}

						// Parse workbook
						workbook = XLSX.read(bytes, { type: 'array' });
						loading.style.display = 'none';
						tabs.style.display = 'flex';

						// Render each sheet
						workbook.SheetNames.forEach((sheetName, sheetIndex) => {
							const sheet = workbook.Sheets[sheetName];
							const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

							const div = document.createElement('div');
							div.className = 'sheet-content' + (sheetIndex === 0 ? ' active' : '');

							let html = '<table><thead><tr><th class="row-num"></th>';
							const maxCols = Math.max(...jsonData.map(row => (row || []).length), 1);
							for (let col = 0; col < maxCols; col++) {
								html += '<th>' + String.fromCharCode(65 + (col % 26)) + '</th>';
							}
							html += '</tr></thead><tbody>';

							jsonData.forEach((row, rowIndex) => {
								html += '<tr><td class="row-num">' + (rowIndex + 1) + '</td>';
								for (let col = 0; col < maxCols; col++) {
									const val = row && row[col] !== undefined ? String(row[col]).replace(/</g, '&lt;') : '';
									html += '<td>' + val + '</td>';
								}
								html += '</tr>';
							});
							html += '</tbody></table>';

							div.innerHTML = html;
							container.appendChild(div);
						});

						console.log('[Webview] XLSX rendered successfully');
					} catch (error) {
						loading.innerHTML = '<div id="error">Excel文档加载失败: ' + error.message + '</div>';
						console.error('XLSX render error:', error);
					}
				};
				script.onerror = function(e) {
					loading.innerHTML = '<div id="error">SheetJS库加载失败</div>';
					console.error('Script load error:', e);
				};
				document.head.appendChild(script);
			</script>
		</body>
		</html>
		`;

		this.webview.setHtml(html);
	}

	private async renderPptxInWebview(base64Data: string): Promise<void> {

		// Recreate webview to ensure it's in active state after tab switch
		this.recreateWebview();

		if (!this.webview) {
			console.error('[SenweaverDocument] webview is undefined!');
			return;
		}

		// Get the document reader server port
		const port = (this.documentService as any)._serverPort || 3008;

		// Use cached jszip library or fetch from local server
		let jszipDataUri = this.cachedJszipDataUri;

		if (!jszipDataUri) {

			try {
				const response = await fetch(`http://localhost:${port}/jszip/jszip.min.js`);
				if (response.ok) {
					const code = await response.text();
					jszipDataUri = 'data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(code)));
					this.cachedJszipDataUri = jszipDataUri;

				}
			} catch (e) {
				console.error('[SenweaverDocument] Failed to fetch jszip library:', e);
			}
		}

		if (!jszipDataUri) {
			console.error('[SenweaverDocument] jszip library not available');
			return;
		}

		// Render PPTX using JSZip library loaded via data URI
		const timestamp = Date.now();
		const html = `
		<!DOCTYPE html>
		<!-- refresh: ${timestamp} -->
		<html>
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src blob:;">
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				html, body { width: 100%; height: 100%; overflow: hidden; background: #2d2d2d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
				#container { width: 100%; height: 100%; overflow: auto; padding: 20px; display: flex; flex-direction: column; align-items: center; }
				#loading { text-align: center; color: #ccc; padding: 50px; font-size: 16px; }
				#error { text-align: center; color: #ff6b6b; padding: 50px; }
				.slide { background: white; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); width: 100%; max-width: 960px; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; position: relative; }
				.slide-number { position: absolute; bottom: 10px; right: 10px; background: rgba(0,0,0,0.5); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
				.slide-content { padding: 40px; text-align: center; width: 100%; }
				.slide-content h1 { font-size: 32px; margin-bottom: 20px; color: #333; }
				.slide-content p { font-size: 18px; color: #666; line-height: 1.6; }
				.slide-content ul { text-align: left; margin: 20px auto; max-width: 600px; }
				.slide-content li { font-size: 16px; color: #555; margin: 8px 0; }
			</style>
		</head>
		<body>
			<div id="container">
				<div id="loading">正在加载PowerPoint文档...</div>
			</div>
			<script>
				console.log('[Webview] Starting PPTX render...');
				const container = document.getElementById('container');
				const loading = document.getElementById('loading');

				// Load JSZip via data URI
				var script = document.createElement('script');
				script.src = '${jszipDataUri}';
				script.onload = async function() {
					console.log('[Webview] JSZip script loaded');
					try {
						if (typeof JSZip === 'undefined') {
							throw new Error('JSZip库未加载');
						}
						console.log('[Webview] JSZip available');

						// Decode base64 to ArrayBuffer
						const base64Data = '${base64Data}';
						const binaryString = atob(base64Data);
						const bytes = new Uint8Array(binaryString.length);
						for (let i = 0; i < binaryString.length; i++) {
							bytes[i] = binaryString.charCodeAt(i);
						}

						// Parse PPTX (it's a ZIP file)
						const zip = await JSZip.loadAsync(bytes);

						// Find slide files
						const slideFiles = Object.keys(zip.files)
							.filter(name => name.match(/ppt\\/slides\\/slide\\d+\\.xml$/))
							.sort((a, b) => {
								const numA = parseInt(a.match(/slide(\\d+)/)[1]);
								const numB = parseInt(b.match(/slide(\\d+)/)[1]);
								return numA - numB;
							});

						loading.style.display = 'none';

						if (slideFiles.length === 0) {
							container.innerHTML = '<div id="error">无法解析PowerPoint文档</div>';
							return;
						}

						// Render each slide
						for (let i = 0; i < slideFiles.length; i++) {
							const slideXml = await zip.file(slideFiles[i]).async('text');

							// Extract text content from XML
							const textMatches = slideXml.match(/<a:t>([^<]*)<\\/a:t>/g) || [];
							const texts = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(t => t);

							const slideDiv = document.createElement('div');
							slideDiv.className = 'slide';

							let contentHtml = '<div class="slide-content">';
							if (texts.length > 0) {
								// First text as title
								contentHtml += '<h1>' + texts[0].replace(/</g, '&lt;') + '</h1>';
								if (texts.length > 1) {
									contentHtml += '<ul>';
									for (let j = 1; j < texts.length; j++) {
										contentHtml += '<li>' + texts[j].replace(/</g, '&lt;') + '</li>';
									}
									contentHtml += '</ul>';
								}
							} else {
								contentHtml += '<p style="color:#999;">（幻灯片 ' + (i + 1) + '）</p>';
							}
							contentHtml += '</div>';
							contentHtml += '<div class="slide-number">第 ' + (i + 1) + ' 页 / 共 ' + slideFiles.length + ' 页</div>';

							slideDiv.innerHTML = contentHtml;
							container.appendChild(slideDiv);
						}

						console.log('[Webview] PPTX rendered successfully');
					} catch (error) {
						loading.innerHTML = '<div id="error">PowerPoint文档加载失败: ' + error.message + '</div>';
						console.error('PPTX render error:', error);
					}
				};
				script.onerror = function(e) {
					loading.innerHTML = '<div id="error">JSZip库加载失败</div>';
					console.error('Script load error:', e);
				};
				document.head.appendChild(script);
			</script>
		</body>
		</html>
		`;

		this.webview.setHtml(html);
	}

	private renderHtmlInWebview(htmlContent: string): void {
		if (!this.webview) return;

		// Create HTML document with the content
		const html = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:;">
				<style>
					* { margin: 0; padding: 0; box-sizing: border-box; }
					html, body {
						width: 100%;
						min-height: 100%;
						background: white;
						font-family: 'Segoe UI', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
						font-size: 14px;
						line-height: 1.6;
						color: #333;
					}
					body { padding: 0; }
				</style>
			</head>
			<body>
				${htmlContent}
			</body>
			</html>
		`;

		this.webview.setHtml(html);
	}

	private getTypeEmoji(fileType: string): string {
		switch (fileType) {
			case 'word': return '📝';
			case 'pdf': return '📕';
			case 'excel': return '📊';
			case 'powerpoint': return '📽️';
			default: return '📄';
		}
	}

	private async refreshDocument(): Promise<void> {
		if (this.currentInput) {
			await this.documentService.openDocument(this.currentInput.filePath);
		}
	}

	layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}
}

// Register the editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		SenweaverDocumentEditor,
		SenweaverDocumentEditor.ID,
		localize('SenweaverDocumentEditor', '文档编辑器')
	),
	[new SyncDescriptor(SenweaverDocumentInput)]
);

// Register actions
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.openDocumentEditor',
			title: { value: localize('openDocumentEditor', '打开文档编辑器'), original: 'Open Document Editor' },
			f1: true,
			icon: Codicon.fileText,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);
		const documentService = accessor.get(ISenweaverDocumentService);
		const notificationService = accessor.get(INotificationService);

		try {
			const result = await fileDialogService.showOpenDialog({
				title: '选择文档文件',
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: [
					{ name: 'Office 文档', extensions: ['docx', 'xlsx', 'xls', 'pptx'] },
					{ name: 'PDF 文档', extensions: ['pdf'] },
					{ name: '文本文件', extensions: ['txt', 'md'] },
					{ name: '所有文件', extensions: ['*'] }
				]
			});

			if (result && result.length > 0) {
				const filePath = result[0].fsPath;
				await documentService.openDocument(filePath);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			notificationService.notify({
				severity: Severity.Error,
				message: `无法打开文档: ${errorMessage}`
			});
		}
	}
});

// Register file associations for document types
class SenweaverDocumentEditorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.SenweaverDocumentEditor';

	constructor(
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISenweaverDocumentService private readonly documentService: ISenweaverDocumentService,
	) {
		super();
		this.registerEditors();
	}

	private registerEditors(): void {
		// Document file patterns
		const documentPatterns = [
			'*.docx',
			'*.pdf',
			'*.xlsx',
			'*.xls',
			'*.pptx'
		];

		for (const pattern of documentPatterns) {
			this._register(
				this.editorResolverService.registerEditor(
					pattern,
					{
						id: SenweaverDocumentEditor.ID,
						label: localize('SenweaverDocumentEditor.label', '文档编辑器'),
						detail: localize('SenweaverDocumentEditor.detail', '使用SenWeaver文档编辑器打开'),
						priority: RegisteredEditorPriority.default
					},
					{
						singlePerResource: true,
						canSupportResource: (resource: URI) => {
							const ext = resource.path.toLowerCase();
							return ext.endsWith('.docx') ||
								ext.endsWith('.pdf') ||
								ext.endsWith('.xlsx') ||
								ext.endsWith('.xls') ||
								ext.endsWith('.pptx');
						}
					},
					{
						createEditorInput: (editorInput, group) => {
							const resource = editorInput.resource;
							if (!resource) {
								throw new Error('Resource is required');
							}

							const filePath = resource.fsPath;
							const fileName = filePath.split(/[/\\]/).pop() || 'document';
							const ext = filePath.toLowerCase().split('.').pop() || '';

							let fileType = 'unknown';
							if (ext === 'docx' || ext === 'doc') fileType = 'word';
							else if (ext === 'pdf') fileType = 'pdf';
							else if (ext === 'xlsx' || ext === 'xls') fileType = 'excel';
							else if (ext === 'pptx' || ext === 'ppt') fileType = 'powerpoint';

							const documentState: DocumentState = {
								filePath,
								fileName,
								fileType,
								content: '',
								contentLength: 0,
								pages: 0,
								isModified: false
							};

							const input = this.instantiationService.createInstance(SenweaverDocumentInput, filePath, documentState);

							// Load document content async
							this.documentService.openDocument(filePath).catch(err => {
								console.error('[SenweaverDocumentEditor] Failed to load document:', err);
							});

							return { editor: input };
						}
					}
				)
			);
		}
	}
}

// Register the contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	SenweaverDocumentEditorContribution,
	LifecyclePhase.Restored
);
