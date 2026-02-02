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
import { ISenweaverChangelogService } from '../common/senweaverChangelogService.js';
import { IWebviewElement } from '../../../contrib/webview/browser/webview.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { marked } from '../../../../base/common/marked/marked.js';
import { URI } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

export class SenweaverChangelogInput extends EditorInput {
	static readonly ID = 'workbench.input.SenweaverChangelog';

	static readonly RESOURCE = URI.from({
		scheme: 'Senweaver',
		path: 'changelog'
	});

	readonly resource = SenweaverChangelogInput.RESOURCE;

	constructor(
		public readonly version: string
	) {
		super();
	}

	override get typeId(): string {
		return SenweaverChangelogInput.ID;
	}

	override getName(): string {
		return localize('SenweaverChangelog', '更新日志');
	}

	override matches(other: EditorInput): boolean {
		return other instanceof SenweaverChangelogInput && other.version === this.version;
	}
}

export class SenweaverChangelogEditor extends EditorPane {
	static readonly ID = 'workbench.editor.SenweaverChangelog';

	private webview: IWebviewElement | undefined;
	private content: string = '';
	private version: string = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ISenweaverChangelogService private readonly changelogService: ISenweaverChangelogService,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super(SenweaverChangelogEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		// Webview will be created in setInput
	}

	override async setInput(input: SenweaverChangelogInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this.version = input.version;

		// Fetch changelog data
		const changelogData = await this.changelogService.fetchChangelog(this.version);

		if (changelogData && changelogData.success && changelogData.data) {
			this.content = changelogData.data.changelog;
		} else {
			this.content = localize('SenweaverChangelog.fetchError', '# 无法获取更新日志\n\n获取版本 {0} 的更新日志失败。', this.version);
		}

		this.renderChangelog();
	}

	private async renderChangelog(): Promise<void> {
		const container = assertIsDefined(this.getContainer());

		if (!this.webview) {
			this.webview = this.webviewService.createWebviewElement({
				providedViewType: 'SenweaverChangelog',
				title: localize('SenweaverChangelog', '更新日志'),
				options: {
					enableFindWidget: true
				},
				contentOptions: {
					enableCommandUris: true,
					localResourceRoots: []
				},
				extension: undefined
			});

			this.webview.mountTo(container, this.window);
		}

		// Convert markdown to HTML
		const htmlContent = await this.markdownToHtml(this.content);

		// Set webview HTML with styling
		this.webview.setHtml(this.getHtmlTemplate(htmlContent));
	}

	private async markdownToHtml(markdown: string): Promise<string> {
		try {
			// Use marked to convert markdown to HTML
			const html = await marked.parse(markdown);
			return html;
		} catch (error) {
			console.error('Error converting markdown to HTML:', error);
			return `<p>${markdown}</p>`;
		}
	}

	private getHtmlTemplate(content: string): string {
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
			font-size: 14px;
			line-height: 1.6;
			color: var(--vscode-editor-foreground);
			background-color: var(--vscode-editor-background);
			padding: 20px 40px;
			max-width: 900px;
			margin: 0 auto;
		}
		h1 {
			font-size: 2em;
			font-weight: 600;
			margin-bottom: 0.5em;
			padding-bottom: 0.3em;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		h2 {
			font-size: 1.5em;
			font-weight: 600;
			margin-top: 1.5em;
			margin-bottom: 0.5em;
			padding-bottom: 0.3em;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		h3 {
			font-size: 1.25em;
			font-weight: 600;
			margin-top: 1em;
			margin-bottom: 0.5em;
		}
		p {
			margin: 0.5em 0;
		}
		ul, ol {
			padding-left: 2em;
			margin: 0.5em 0;
		}
		li {
			margin: 0.25em 0;
		}
		code {
			font-family: "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace;
			background-color: var(--vscode-textCodeBlock-background);
			padding: 0.2em 0.4em;
			border-radius: 3px;
			font-size: 0.9em;
		}
		pre {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 1em;
			border-radius: 5px;
			overflow-x: auto;
			margin: 1em 0;
		}
		pre code {
			background-color: transparent;
			padding: 0;
		}
		blockquote {
			border-left: 4px solid var(--vscode-panel-border);
			padding-left: 1em;
			margin: 1em 0;
			color: var(--vscode-descriptionForeground);
		}
		a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		a:hover {
			text-decoration: underline;
		}
		hr {
			border: none;
			border-top: 1px solid var(--vscode-panel-border);
			margin: 2em 0;
		}
		table {
			border-collapse: collapse;
			width: 100%;
			margin: 1em 0;
		}
		th, td {
			border: 1px solid var(--vscode-panel-border);
			padding: 0.5em;
			text-align: left;
		}
		th {
			background-color: var(--vscode-editor-inactiveSelectionBackground);
			font-weight: 600;
		}
		.checkbox-container {
			display: flex;
			align-items: center;
			margin: 1em 0;
			padding: 0.5em;
			background-color: var(--vscode-editor-inactiveSelectionBackground);
			border-radius: 5px;
		}
		.checkbox-container input[type="checkbox"] {
			margin-right: 0.5em;
		}
		.version-info {
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
			margin: 1em 0;
		}
	</style>
</head>
<body>
	${content}
</body>
</html>`;
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
}

// Register the changelog editor pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(SenweaverChangelogEditor, SenweaverChangelogEditor.ID, "更新日志"),
	[new SyncDescriptor(SenweaverChangelogInput)]
);
