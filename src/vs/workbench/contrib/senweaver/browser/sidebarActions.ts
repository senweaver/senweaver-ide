/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { SENWEAVER_VIEW_CONTAINER_ID, SENWEAVER_VIEW_ID } from './sidebarPane.js';
import { IMetricsService } from '../common/metricsService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { SENWEAVER_TOGGLE_SETTINGS_ACTION_ID } from './senweaverSettingsPane.js';
import { SENWEAVER_CTRL_L_ACTION_ID } from './actionIDs.js';
import { localize2 } from '../../../../nls.js';
import { IChatThreadService } from './chatThreadService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';

// ---------- Register commands and keybindings ----------


export const roundRangeToLines = (range: IRange | null | undefined, options: { emptySelectionBehavior: 'null' | 'line' }) => {
	if (!range)
		return null

	// treat as no selection if selection is empty
	if (range.endColumn === range.startColumn && range.endLineNumber === range.startLineNumber) {
		if (options.emptySelectionBehavior === 'null')
			return null
		else if (options.emptySelectionBehavior === 'line')
			return { startLineNumber: range.startLineNumber, startColumn: 1, endLineNumber: range.startLineNumber, endColumn: 1 }
	}

	// IRange is 1-indexed
	const endLine = range.endColumn === 1 ? range.endLineNumber - 1 : range.endLineNumber // e.g. if the user triple clicks, it selects column=0, line=line -> column=0, line=line+1
	const newRange: IRange = {
		startLineNumber: range.startLineNumber,
		startColumn: 1,
		endLineNumber: endLine,
		endColumn: Number.MAX_SAFE_INTEGER
	}
	return newRange
}

// const getContentInRange = (model: ITextModel, range: IRange | null) => {
// 	if (!range)
// 		return null
// 	const content = model.getValueInRange(range)
// 	const trimmedContent = content
// 		.replace(/^\s*\n/g, '') // trim pure whitespace lines from start
// 		.replace(/\n\s*$/g, '') // trim pure whitespace lines from end
// 	return trimmedContent
// }



const SENWEAVER_OPEN_SIDEBAR_ACTION_ID = 'senweaver.sidebar.open'
registerAction2(class extends Action2 {
	constructor() {
		super({ id: SENWEAVER_OPEN_SIDEBAR_ACTION_ID, title: localize2('senweaverOpenSidebar', '打开'), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService)
		const chatThreadsService = accessor.get(IChatThreadService)
		viewsService.openViewContainer(SENWEAVER_VIEW_CONTAINER_ID)
		await chatThreadsService.focusCurrentChat()
	}
})


// cmd L
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_CTRL_L_ACTION_ID,
			f1: true,
			title: { value: 'SenWeaver: Add Selection to Chat', original: 'SenWeaver: Add Selection to Chat' }, // hardcoded to prevent language switching issues
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		// Get services
		const commandService = accessor.get(ICommandService)
		const viewsService = accessor.get(IViewsService)
		const metricsService = accessor.get(IMetricsService)
		const editorService = accessor.get(ICodeEditorService)
		const chatThreadService = accessor.get(IChatThreadService)

		metricsService.capture('Ctrl+L', {})

		// capture selection and model before opening the chat panel
		const editor = editorService.getActiveCodeEditor()
		const model = editor?.getModel()
		if (!model) return

		const selectionRange = roundRangeToLines(editor?.getSelection(), { emptySelectionBehavior: 'null' })

		// open panel
		const wasAlreadyOpen = viewsService.isViewContainerVisible(SENWEAVER_VIEW_CONTAINER_ID)
		if (!wasAlreadyOpen) {
			await commandService.executeCommand(SENWEAVER_OPEN_SIDEBAR_ACTION_ID)
		}

		// Add selection to chat
		// add line selection
		if (selectionRange) {
			editor?.setSelection({
				startLineNumber: selectionRange.startLineNumber,
				endLineNumber: selectionRange.endLineNumber,
				startColumn: 1,
				endColumn: Number.MAX_SAFE_INTEGER
			})
			chatThreadService.addNewStagingSelection({
				type: 'CodeSelection',
				uri: model.uri,
				language: model.getLanguageId(),
				range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
				state: { wasAddedAsCurrentFile: false },
			})
		}
		// add file
		else {
			chatThreadService.addNewStagingSelection({
				type: 'File',
				uri: model.uri,
				language: model.getLanguageId(),
				state: { wasAddedAsCurrentFile: false },
			})
		}

		await chatThreadService.focusCurrentChat()
	}
})


// New chat keybind + menu button
const SENWEAVER_CMD_SHIFT_L_ACTION_ID = 'senweaver.cmdShiftL'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_CMD_SHIFT_L_ACTION_ID,
			title: '新建会话',
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension,
			},
			icon: { id: 'add' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SENWEAVER_VIEW_ID), order: 1 }],
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {

		const metricsService = accessor.get(IMetricsService)
		const chatThreadsService = accessor.get(IChatThreadService)
		const editorService = accessor.get(ICodeEditorService)
		metricsService.capture('Chat Navigation', { type: 'Start New Chat' })

		// get current selections and value to transfer
		const oldThreadId = chatThreadsService.state.currentThreadId
		const oldThread = chatThreadsService.state.allThreads[oldThreadId]

		const oldUI = await oldThread?.state.mountedInfo?.whenMounted

		const oldSelns = oldThread?.state.stagingSelections
		const oldVal = oldUI?.textAreaRef?.current?.value

		// open and focus new thread
		chatThreadsService.openNewThread()
		await chatThreadsService.focusCurrentChat()


		// set new thread values
		const newThreadId = chatThreadsService.state.currentThreadId
		const newThread = chatThreadsService.state.allThreads[newThreadId]

		const newUI = await newThread?.state.mountedInfo?.whenMounted
		chatThreadsService.setCurrentThreadState({ stagingSelections: oldSelns, })
		if (newUI?.textAreaRef?.current && oldVal) newUI.textAreaRef.current.value = oldVal


		// if has selection, add it
		const editor = editorService.getActiveCodeEditor()
		const model = editor?.getModel()
		if (!model) return
		const selectionRange = roundRangeToLines(editor?.getSelection(), { emptySelectionBehavior: 'null' })
		if (!selectionRange) return
		editor?.setSelection({ startLineNumber: selectionRange.startLineNumber, endLineNumber: selectionRange.endLineNumber, startColumn: 1, endColumn: Number.MAX_SAFE_INTEGER })
		chatThreadsService.addNewStagingSelection({
			type: 'CodeSelection',
			uri: model.uri,
			language: model.getLanguageId(),
			range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
			state: { wasAddedAsCurrentFile: false },
		})
	}
})

// History menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.historyAction',
			title: '历史会话',
			icon: { id: 'history' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SENWEAVER_VIEW_ID), order: 2 }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {

		// do not do anything if there are no messages (without this it clears all of the user's selections if the button is pressed)
		// TODO the history button should be disabled in this case so we can remove this logic
		const thread = accessor.get(IChatThreadService).getCurrentThread()
		if (thread.messages.length === 0) {
			return;
		}

		const metricsService = accessor.get(IMetricsService)

		const commandService = accessor.get(ICommandService)

		metricsService.capture('Chat Navigation', { type: 'History' })
		commandService.executeCommand(SENWEAVER_CMD_SHIFT_L_ACTION_ID)

	}
})


// Settings gear
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.settingsAction',
			title: `设置`,
			icon: { id: 'settings-gear' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SENWEAVER_VIEW_ID), order: 3 }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService)
		commandService.executeCommand(SENWEAVER_TOGGLE_SETTINGS_ACTION_ID)
	}
})

// Built-in Browser button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.browserAction',
			title: '内置浏览器',
			icon: { id: 'globe' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SENWEAVER_VIEW_ID), order: 2.5 }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService)
		commandService.executeCommand('senweaver.openBrowser')
	}
})

// Design Canvas button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'senweaver.designCanvasAction',
			title: '设计画布',
			icon: { id: 'symbol-color' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SENWEAVER_VIEW_ID), order: 2.6 }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService)
		const SenweaverSettingsService = accessor.get(ISenweaverSettingsService)

		// 检查当前是否在designer模式
		const chatMode = SenweaverSettingsService.state.globalSettings.chatMode
		const isDesignerMode = chatMode === 'designer'

		// 打开设计画布，传递是否为designer模式的信息
		commandService.executeCommand('senweaver.openDesignCanvas', { isDesignerMode })
	}
})




// export class TabSwitchListener extends Disposable {

// 	constructor(
// 		onSwitchTab: () => void,
// 		@ICodeEditorService private readonly _editorService: ICodeEditorService,
// 	) {
// 		super()

// 		// when editor switches tabs (models)
// 		const addTabSwitchListeners = (editor: ICodeEditor) => {
// 			this._register(editor.onDidChangeModel(e => {
// 				if (e.newModelUrl?.scheme !== 'file') return
// 				onSwitchTab()
// 			}))
// 		}

// 		const initializeEditor = (editor: ICodeEditor) => {
// 			addTabSwitchListeners(editor)
// 		}

// 		// initialize current editors + any new editors
// 		for (let editor of this._editorService.listCodeEditors()) initializeEditor(editor)
// 		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))
// 	}
// }
