/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
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
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Codicon } from '../../../../base/common/codicons.js';

// React mount function
import { mountCustomApiPanel } from './react/out/custom-api-tsx/index.js';

// Custom API Panel ID
const SENWEAVER_CUSTOM_API_EDITOR_ID = 'workbench.editor.SenweaverCustomApi';

// Editor Input for Custom API Panel
export class SenweaverCustomApiInput extends EditorInput {
	static readonly ID = 'workbench.input.SenweaverCustomApi';

	override get typeId(): string {
		return SenweaverCustomApiInput.ID;
	}

	override get resource(): URI | undefined {
		return URI.parse('Senweaver://custom-api');
	}

	override getName(): string {
		return '自定义 API';
	}

	override getDescription(): string | undefined {
		return '管理可供助手使用的自定义 API';
	}

	override matches(other: EditorInput | { resource: URI }): boolean {
		return other instanceof SenweaverCustomApiInput;
	}
}

// Editor Pane for Custom API Panel
export class SenweaverCustomApiEditor extends EditorPane {
	static readonly ID = SENWEAVER_CUSTOM_API_EDITOR_ID;

	private _container: HTMLElement | undefined;
	private _unmountFn: (() => void) | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(SenweaverCustomApiEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this._container = document.createElement('div');
		this._container.style.width = '100%';
		this._container.style.height = '100%';
		this._container.style.overflow = 'auto';
		parent.appendChild(this._container);
	}

	override async setInput(
		input: SenweaverCustomApiInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);

		if (this._container) {
			// Unmount previous content
			if (this._unmountFn) {
				this._unmountFn();
				this._unmountFn = undefined;
			}

			// Mount React component
			const result = this.instantiationService.invokeFunction(accessor => {
				return mountCustomApiPanel(this._container!, accessor);
			});
			if (result) {
				this._unmountFn = result.dispose;
			}
		}
	}

	override layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.width = `${dimension.width}px`;
			this._container.style.height = `${dimension.height}px`;
		}
	}

	override clearInput(): void {
		if (this._unmountFn) {
			this._unmountFn();
			this._unmountFn = undefined;
		}
		super.clearInput();
	}

	override dispose(): void {
		if (this._unmountFn) {
			this._unmountFn();
			this._unmountFn = undefined;
		}
		super.dispose();
	}
}

// Register the editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		SenweaverCustomApiEditor,
		SenweaverCustomApiEditor.ID,
		'自定义 API'
	),
	[new SyncDescriptor(SenweaverCustomApiInput)]
);

// Register action to open the editor
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.openCustomApi',
			title: localize2('senweaverOpenCustomApi', '打开自定义 API 管理'),
			f1: true,
			icon: Codicon.plug,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		// Check if there's already an open editor with this input type
		const existingEditor = editorService.editors.find(e => e instanceof SenweaverCustomApiInput);
		if (existingEditor) {
			await editorService.openEditor(existingEditor, { pinned: true });
		} else {
			const input = instantiationService.createInstance(SenweaverCustomApiInput);
			await editorService.openEditor(input, { pinned: true });
		}
	}
});
