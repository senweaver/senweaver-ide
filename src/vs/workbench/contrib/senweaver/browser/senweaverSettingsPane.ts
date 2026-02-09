/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorExtensions } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { isWindows, isMacintosh, isLinux, language, locale } from '../../../../base/common/platform.js';
import { mountSenweaverSettings } from './react/out/senweaver-settings-tsx/index.js'
import { Codicon } from '../../../../base/common/codicons.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { ILocaleService } from '../../../services/localization/common/locale.js';
import { ILanguagePackItem } from '../../../../platform/languagePacks/common/languagePacks.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { senweaverUpdateDownloadStatus } from './senweaverOnlineConfigContribution.js';
// 远程协作的 UI 已迁移到 React 设置面板 (Settings.tsx -> RemoteCollaboration 组件)

// 向管理地址上传用户ID
function uploadUserID(userId: string): void {
	try {


	} catch (error) {

	}
}

// 生成基于用户ID的8位唯一数字（远程协作服务内部使用，此处保留供其他场景调用）
function _generateCollaborationCode(userId: string): string {
	// 使用用户ID生成一个稳定的哈希值
	let hash = 0;
	for (let i = 0; i < userId.length; i++) {
		const char = userId.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // 转换为32位整数
	}

	// 确保是正数并转换为8位数字
	const positiveHash = Math.abs(hash);
	const eightDigitCode = (positiveHash % 90000000) + 10000000; // 确保是8位数字

	return eightDigitCode.toString();
}
void _generateCollaborationCode; // suppress unused warning

// 生成基于电脑唯一标识的用户ID
function generateUserID(): string {
	const storageKey = 'senweaver.user.id';
	let userId = localStorage.getItem(storageKey);

	if (!userId) {
		//let isNewUser = true;
		// 基于系统信息生成唯一ID
		const systemInfo = {
			platform: isWindows ? 'win' : isMacintosh ? 'mac' : isLinux ? 'linux' : 'unknown',
			userAgent: navigator.userAgent,
			timestamp: Date.now(),
			random: Math.random()
		};

		// 生成基础UUID并结合系统信息
		const baseId = generateUuid();
		const hash = btoa(JSON.stringify(systemInfo)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
		userId = `${baseId.substring(0, 8)}-${hash}`;

		localStorage.setItem(storageKey, userId);
	}

	// 每次获取用户ID时都上传一次（新用户或现有用户）
	uploadUserID(userId);

	return userId;
}

// 获取当前用户ID
function getCurrentUserID(): string {
	return generateUserID();
}

// 模块级变量：用于在菜单动作和编辑器面板之间传递初始标签页
let _pendingInitialTab: string | undefined;

class SenweaverSettingsInput extends EditorInput {

	static readonly ID: string = 'workbench.input.senweaver.settings';

	static readonly RESOURCE = URI.from({ // I think this scheme is invalid, it just shuts up TS
		scheme: 'senweaver',  // Custom scheme for our editor (try Schemas.https)
		path: 'settings'
	})
	readonly resource = SenweaverSettingsInput.RESOURCE;

	constructor() {
		super();
	}

	override get typeId(): string {
		return SenweaverSettingsInput.ID;
	}

	override getName(): string {
		return '设置'; // hardcoded to prevent language switching issues
	}

	override getIcon() {
		return Codicon.checklist // symbol for the actual editor pane
	}

}


class SenweaverSettingsPane extends EditorPane {
	static readonly ID = 'workbench.test.myCustomPane';

	// private _scrollbar: DomScrollableElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(SenweaverSettingsPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';

		const settingsElt = document.createElement('div');
		settingsElt.style.height = '100%';
		settingsElt.style.width = '100%';

		parent.appendChild(settingsElt);

		// this._scrollbar = this._register(new DomScrollableElement(scrollableContent, {}));
		// parent.appendChild(this._scrollbar.getDomNode());
		// this._scrollbar.scanDomNode();

		// Mount React into the scrollable content
		this.instantiationService.invokeFunction(accessor => {
			// 读取并消费 pendingInitialTab（若有）
			const props = _pendingInitialTab ? { initialTab: _pendingInitialTab } : undefined;
			_pendingInitialTab = undefined;
			const disposeFn = mountSenweaverSettings(settingsElt, accessor, props)?.dispose;
			this._register(toDisposable(() => disposeFn?.()))

			// setTimeout(() => { // this is a complete hack and I don't really understand how scrollbar works here
			// 	this._scrollbar?.scanDomNode();
			// }, 1000)
		});
	}

	layout(dimension: Dimension): void {
		// if (!settingsElt) return
		// settingsElt.style.height = `${dimension.height}px`;
		// settingsElt.style.width = `${dimension.width}px`;
	}


	override get minimumWidth() { return 700 }

}

// register Settings pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(SenweaverSettingsPane, SenweaverSettingsPane.ID, "设置面板"), // hardcoded to prevent language switching issues
	[new SyncDescriptor(SenweaverSettingsInput)]
);


// register the gear on the top right - 服务设置主菜单
export const SENWEAVER_TOGGLE_SETTINGS_ACTION_ID = 'workbench.action.toggleSenweaverSettings'
export const SENWEAVER_IDE_SETTINGS_SUBMENU_ID = new MenuId('workbench.submenu.ideSettings')

// 注册服务设置子菜单
MenuRegistry.appendMenuItem(MenuId.LayoutControlMenuSubmenu, {
	submenu: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
	title: '服务设置', // hardcoded to prevent language switching issues
	icon: Codicon.account,
	group: 'z_end'
});

MenuRegistry.appendMenuItem(MenuId.LayoutControlMenu, {
	submenu: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
	title: '服务设置', // hardcoded to prevent language switching issues
	icon: Codicon.account,
	when: ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
	group: 'z_end'
});

// 显示用户ID菜单项
export const SENWEAVER_SHOW_USER_ID_ACTION_ID = 'workbench.action.voidShowUserId'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_SHOW_USER_ID_ACTION_ID,
			title: { value: `用户ID: ${getCurrentUserID()}`, original: `用户ID: ${getCurrentUserID()}` }, // hardcoded to prevent language switching issues
			icon: Codicon.account,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '0_user',
					order: 1
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const openerService = accessor.get(IOpenerService);
		// 跳转到Web主页
		await openerService.open(URI.parse('https://ide.senweaver.com/home'));
	}
})

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_TOGGLE_SETTINGS_ACTION_ID,
			title: { value: "IDE设置", original: "IDE设置" }, // hardcoded to prevent language switching issues
			icon: Codicon.settingsGear,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '1_settings',
					order: 1
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);

		const instantiationService = accessor.get(IInstantiationService);

		// if is open, close it
		const openEditors = editorService.findEditors(SenweaverSettingsInput.RESOURCE); // should only have 0 or 1 elements...
		if (openEditors.length !== 0) {
			const openEditor = openEditors[0].editor
			const isCurrentlyOpen = editorService.activeEditor?.resource?.fsPath === openEditor.resource?.fsPath
			if (isCurrentlyOpen)
				await editorService.closeEditors(openEditors)
			else
				await editorGroupService.activeGroup.openEditor(openEditor)
			return;
		}


		// else open it
		const input = instantiationService.createInstance(SenweaverSettingsInput);

		await editorGroupService.activeGroup.openEditor(input);
	}
})



export const SENWEAVER_OPEN_SETTINGS_ACTION_ID = 'workbench.action.openSenweaverSettings'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_OPEN_SETTINGS_ACTION_ID,
			title: { value: "SenWeaver: Open Settings", original: "SenWeaver: Open Settings" }, // hardcoded to prevent language switching issues
			f1: true,
			icon: Codicon.settingsGear,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		// close all instances if found
		const openEditors = editorService.findEditors(SenweaverSettingsInput.RESOURCE);
		if (openEditors.length > 0) {
			await editorService.closeEditors(openEditors);
		}

		// then, open one single editor
		const input = instantiationService.createInstance(SenweaverSettingsInput);
		await editorService.openEditor(input);
	}
})

// Web主页菜单项
export const SENWEAVER_MANAGE_ACCOUNT_ACTION_ID = 'workbench.action.voidManageAccount'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_MANAGE_ACCOUNT_ACTION_ID,
			title: { value: "Web主页", original: "Web主页" }, // hardcoded to prevent language switching issues
			icon: Codicon.gear,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '2_account',
					order: 2
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const openerService = accessor.get(IOpenerService);
		// 跳转到Web主页
		await openerService.open(URI.parse('https://ide.senweaver.com/home'));
	}
})

// 主题菜单项
export const SENWEAVER_THEME_ACTION_ID = 'workbench.action.voidTheme'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_THEME_ACTION_ID,
			title: { value: "主题", original: "主题" }, // hardcoded to prevent language switching issues
			icon: Codicon.colorMode,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '3_appearance',
					order: 1
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		showThemeDialog(accessor);
	}
})

// 语言菜单项
export const SENWEAVER_LANGUAGE_ACTION_ID = 'workbench.action.voidLanguage'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_LANGUAGE_ACTION_ID,
			title: { value: "语言", original: "语言" }, // hardcoded to prevent language switching issues
			icon: Codicon.globe,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '3_appearance',
					order: 2
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		showLanguageDialog(accessor);
	}
})

// 消息菜单项
export const SENWEAVER_MESSAGE_ACTION_ID = 'workbench.action.SenweaverMessage'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_MESSAGE_ACTION_ID,
			title: { value: "消息", original: "消息" }, // hardcoded to prevent language switching issues
			icon: Codicon.mail,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '2_account',
					order: 3
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		showMessageDialog();
	}
})

// 显示消息对话框
function showMessageDialog(): void {
	// 创建背景遮罩
	const backdrop = document.createElement('div');
	backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';

	// 创建对话框容器
	const dialog = document.createElement('div');
	dialog.style.cssText = 'background-color: #252526; border: 1px solid #3c3c3c; border-radius: 8px; width: 600px; max-width: 90vw; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);';

	// 创建内容容器
	const content = document.createElement('div');
	content.style.cssText = 'padding: 24px;';

	// 标题
	const title = document.createElement('h2');
	title.style.cssText = 'margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #ffffff;';
	title.textContent = '消息中心';
	content.appendChild(title);

	// 消息发送部分
	const sendMessageSection = document.createElement('div');
	sendMessageSection.style.marginBottom = '24px';

	const sendMessageTitle = document.createElement('h3');
	sendMessageTitle.style.cssText = 'margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #ffffff;';
	sendMessageTitle.textContent = '发送消息';
	sendMessageSection.appendChild(sendMessageTitle);

	// 收件人输入
	const recipientContainer = document.createElement('div');
	recipientContainer.style.cssText = 'margin-bottom: 12px;';

	const recipientLabel = document.createElement('label');
	recipientLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 14px; color: #cccccc;';
	recipientLabel.textContent = '收件人';
	recipientContainer.appendChild(recipientLabel);

	const recipientInput = document.createElement('input');
	recipientInput.id = 'recipientInput';
	recipientInput.type = 'text';
	recipientInput.placeholder = '请输入收件人用户ID或邮箱';
	recipientInput.style.cssText = 'width: 100%; background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #ffffff; font-size: 14px; box-sizing: border-box;';
	recipientContainer.appendChild(recipientInput);

	sendMessageSection.appendChild(recipientContainer);

	// 消息内容输入
	const messageContainer = document.createElement('div');
	messageContainer.style.cssText = 'margin-bottom: 12px;';

	const messageLabel = document.createElement('label');
	messageLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 14px; color: #cccccc;';
	messageLabel.textContent = '消息内容';
	messageContainer.appendChild(messageLabel);

	const messageTextarea = document.createElement('textarea');
	messageTextarea.id = 'messageTextarea';
	messageTextarea.placeholder = '请输入要发送的消息内容...';
	messageTextarea.style.cssText = 'width: 100%; height: 120px; background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #ffffff; font-size: 14px; resize: vertical; box-sizing: border-box; font-family: inherit;';
	messageContainer.appendChild(messageTextarea);

	sendMessageSection.appendChild(messageContainer);

	// 发送按钮
	const sendButtonContainer = document.createElement('div');
	sendButtonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

	const sendBtn = document.createElement('button');
	sendBtn.id = 'sendMessageButton';
	sendBtn.style.cssText = 'background-color: #0e639c; border: none; border-radius: 4px; padding: 8px 16px; color: #ffffff; cursor: pointer; font-size: 14px; font-weight: 500;';
	sendBtn.textContent = '发送消息';
	sendButtonContainer.appendChild(sendBtn);

	sendMessageSection.appendChild(sendButtonContainer);
	content.appendChild(sendMessageSection);

	// 消息历史部分
	const messageHistorySection = document.createElement('div');
	messageHistorySection.style.marginBottom = '24px';

	const historyTitle = document.createElement('h3');
	historyTitle.style.cssText = 'margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #ffffff;';
	historyTitle.textContent = '消息历史';
	messageHistorySection.appendChild(historyTitle);

	// 消息列表容器
	const messageListContainer = document.createElement('div');
	messageListContainer.id = 'messageListContainer';
	messageListContainer.style.cssText = 'background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px; max-height: 200px; overflow-y: auto;';

	// 示例消息
	const sampleMessages = [
		{ sender: '系统', content: '欢迎使用消息中心！', time: '2024-01-20 10:00' },
		{ sender: 'user123', content: '你好，请问如何使用远程协作功能？', time: '2024-01-20 09:30' }
	];

	sampleMessages.forEach(msg => {
		const messageItem = document.createElement('div');
		messageItem.style.cssText = 'margin-bottom: 12px; padding: 8px; background-color: #2d2d30; border-radius: 4px;';

		const messageHeader = document.createElement('div');
		messageHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';

		const senderName = document.createElement('span');
		senderName.style.cssText = 'font-size: 12px; color: #569cd6; font-weight: 500;';
		senderName.textContent = msg.sender;
		messageHeader.appendChild(senderName);

		const messageTime = document.createElement('span');
		messageTime.style.cssText = 'font-size: 11px; color: #858585;';
		messageTime.textContent = msg.time;
		messageHeader.appendChild(messageTime);

		messageItem.appendChild(messageHeader);

		const messageContent = document.createElement('div');
		messageContent.style.cssText = 'font-size: 13px; color: #cccccc; line-height: 1.4;';
		messageContent.textContent = msg.content;
		messageItem.appendChild(messageContent);

		messageListContainer.appendChild(messageItem);
	});

	messageHistorySection.appendChild(messageListContainer);
	content.appendChild(messageHistorySection);

	// 在线状态部分
	const statusSection = document.createElement('div');
	statusSection.style.marginBottom = '24px';

	const statusTitle = document.createElement('h3');
	statusTitle.style.cssText = 'margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #ffffff;';
	statusTitle.textContent = '在线状态';
	statusSection.appendChild(statusTitle);

	const statusContainer = document.createElement('div');
	statusContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

	const onlineDot = document.createElement('span');
	onlineDot.style.cssText = 'width: 8px; height: 8px; background-color: #73c991; border-radius: 50%;';
	statusContainer.appendChild(onlineDot);

	const statusLabel = document.createElement('span');
	statusLabel.style.cssText = 'font-size: 14px; color: #cccccc;';
	statusLabel.textContent = '在线 - 可接收消息';
	statusContainer.appendChild(statusLabel);

	statusSection.appendChild(statusContainer);
	content.appendChild(statusSection);

	// 按钮部分
	const buttonSection = document.createElement('div');
	buttonSection.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

	const refreshBtn = document.createElement('button');
	refreshBtn.id = 'refreshMessagesButton';
	refreshBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 16px; color: #cccccc; cursor: pointer; font-size: 14px;';
	refreshBtn.textContent = '刷新消息';
	buttonSection.appendChild(refreshBtn);

	const closeBtn = document.createElement('button');
	closeBtn.id = 'closeMessageButton';
	closeBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 16px; color: #cccccc; cursor: pointer; font-size: 14px;';
	closeBtn.textContent = '关闭';
	buttonSection.appendChild(closeBtn);

	content.appendChild(buttonSection);
	dialog.appendChild(content);

	// 添加事件监听器
	const recipientInputElement = dialog.querySelector('#recipientInput') as HTMLInputElement;
	const messageTextareaElement = dialog.querySelector('#messageTextarea') as HTMLTextAreaElement;
	const sendMessageBtnElement = dialog.querySelector('#sendMessageButton') as HTMLButtonElement;
	const refreshMessagesBtnElement = dialog.querySelector('#refreshMessagesButton') as HTMLButtonElement;
	const closeMessageBtnElement = dialog.querySelector('#closeMessageButton') as HTMLButtonElement;
	const messageListContainerElement = dialog.querySelector('#messageListContainer') as HTMLElement;

	// 发送消息
	sendMessageBtnElement.addEventListener('click', () => {
		const recipient = recipientInputElement.value.trim();
		const message = messageTextareaElement.value.trim();

		if (recipient && message) {
			console.log('发送消息到:', recipient, '内容:', message);

			// 添加到消息历史
			const messageItem = document.createElement('div');
			messageItem.style.cssText = 'margin-bottom: 12px; padding: 8px; background-color: #2d2d30; border-radius: 4px;';

			const messageHeader = document.createElement('div');
			messageHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';

			const senderName = document.createElement('span');
			senderName.style.cssText = 'font-size: 12px; color: #569cd6; font-weight: 500;';
			senderName.textContent = '我';
			messageHeader.appendChild(senderName);

			const messageTime = document.createElement('span');
			messageTime.style.cssText = 'font-size: 11px; color: #858585;';
			messageTime.textContent = new Date().toLocaleString();
			messageHeader.appendChild(messageTime);

			messageItem.appendChild(messageHeader);

			const messageContent = document.createElement('div');
			messageContent.style.cssText = 'font-size: 13px; color: #cccccc; line-height: 1.4;';
			messageContent.textContent = `发送给 ${recipient}: ${message}`;
			messageItem.appendChild(messageContent);

			messageListContainerElement.appendChild(messageItem);
			messageListContainerElement.scrollTop = messageListContainerElement.scrollHeight;

			// 清空输入框
			messageTextareaElement.value = '';

			// 显示发送成功提示
			sendMessageBtnElement.textContent = '发送成功';
			setTimeout(() => {
				sendMessageBtnElement.textContent = '发送消息';
			}, 1500);
		} else {
			alert('请填写收件人和消息内容');
		}
	});

	// 刷新消息
	refreshMessagesBtnElement.addEventListener('click', () => {
		console.log('刷新消息列表');
		refreshMessagesBtnElement.textContent = '刷新中...';
		setTimeout(() => {
			refreshMessagesBtnElement.textContent = '刷新消息';
		}, 1000);
	});

	// 关闭按钮
	closeMessageBtnElement.addEventListener('click', closeDialog);

	// 点击背景关闭
	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) {
			closeDialog();
		}
	});

	// ESC键关闭
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			closeDialog();
		}
	};

	function closeDialog() {
		document.removeEventListener('keydown', handleKeyDown);
		backdrop.remove();
	}

	document.addEventListener('keydown', handleKeyDown);
	backdrop.appendChild(dialog);
	document.body.appendChild(backdrop);

	// 聚焦到收件人输入框
	setTimeout(() => {
		recipientInputElement.focus();
	}, 100);
}

// 显示主题设置对话框
function showThemeDialog(accessor?: ServicesAccessor): void {
	// 获取主题服务
	let themeService: IWorkbenchThemeService | undefined;
	if (accessor) {
		themeService = accessor.get(IWorkbenchThemeService);
	}

	// 获取当前主题
	let currentThemeName = 'Dark+ (默认深色)';
	let currentThemeLabelValue = 'Dark+ (default dark)';
	if (themeService) {
		const currentTheme = themeService.getColorTheme();
		currentThemeName = currentTheme.label || currentThemeName;
		currentThemeLabelValue = currentTheme.label || currentThemeLabelValue;
		console.log('当前主题信息:', {
			id: currentTheme.id,
			label: currentTheme.label,
			settingsId: currentTheme.settingsId
		});
	}
	// 创建对话框背景
	const backdrop = document.createElement('div');
	backdrop.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.5);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	`;

	// 创建对话框容器
	const dialog = document.createElement('div');
	dialog.style.cssText = `
		background-color: #2d2d30;
		color: #cccccc;
		border-radius: 8px;
		padding: 24px;
		width: 480px;
		max-width: 90vw;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	`;

	// 创建对话框内容
	const content = document.createElement('div');

	// 标题
	const title = document.createElement('h2');
	title.style.cssText = 'margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #ffffff; text-align: center;';
	title.textContent = '主题设置';
	content.appendChild(title);

	// 当前主题显示部分
	const currentThemeSection = document.createElement('div');
	currentThemeSection.style.marginBottom = '24px';

	const currentThemeLabel = document.createElement('label');
	currentThemeLabel.style.cssText = 'display: block; margin-bottom: 8px; font-size: 14px; color: #cccccc; font-weight: 500;';
	currentThemeLabel.textContent = '当前主题';
	currentThemeSection.appendChild(currentThemeLabel);

	const currentThemeDisplay = document.createElement('div');
	currentThemeDisplay.style.cssText = 'background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px; color: #ffffff; font-size: 14px;';
	currentThemeDisplay.textContent = currentThemeName;
	currentThemeSection.appendChild(currentThemeDisplay);
	content.appendChild(currentThemeSection);

	// 主题选择部分
	const themeSelectionSection = document.createElement('div');
	themeSelectionSection.style.marginBottom = '24px';

	const themeSelectionLabel = document.createElement('label');
	themeSelectionLabel.style.cssText = 'display: block; margin-bottom: 12px; font-size: 14px; color: #cccccc; font-weight: 500;';
	themeSelectionLabel.textContent = '选择主题';
	themeSelectionSection.appendChild(themeSelectionLabel);

	// 主题选项列表 - 使用label匹配当前主题
	// VS Code主题label格式: "Dark+ (default dark)", "Light+ (default light)", "Dark Modern", "Light Modern"
	const themes = [
		{ name: 'Dark+ (默认深色)', value: 'Default Dark+', label: 'Dark+ (default dark)', current: currentThemeLabelValue.toLowerCase().includes('dark+') },
		{ name: 'Light+ (默认浅色)', value: 'Default Light+', label: 'Light+ (default light)', current: currentThemeLabelValue.toLowerCase().includes('light+') },
		{ name: 'Dark Modern (现代深色)', value: 'Default Dark Modern', label: 'Dark Modern', current: currentThemeLabelValue.toLowerCase() === 'dark modern' },
		{ name: 'Light Modern (现代浅色)', value: 'Default Light Modern', label: 'Light Modern', current: currentThemeLabelValue.toLowerCase() === 'light modern' },
	];

	const themeList = document.createElement('div');
	themeList.style.cssText = 'max-height: 200px; overflow-y: auto; border: 1px solid #3c3c3c; border-radius: 4px; background-color: #1e1e1e;';

	themes.forEach(theme => {
		const themeItem = document.createElement('div');
		themeItem.style.cssText = `
			padding: 12px 16px;
			cursor: pointer;
			border-bottom: 1px solid #3c3c3c;
			display: flex;
			align-items: center;
			justify-content: space-between;
			transition: background-color 0.2s;
			${theme.current ? 'background-color: #313232;' : ''}
		`;

		const themeName = document.createElement('span');
		themeName.style.cssText = 'color: #ffffff; font-size: 14px;';
		themeName.textContent = theme.name;
		themeItem.appendChild(themeName);

		if (theme.current) {
			const checkmark = document.createElement('span');
			checkmark.style.cssText = 'color: #73c991; font-size: 16px;';
			checkmark.textContent = '✓';
			themeItem.appendChild(checkmark);
		}

		// 鼠标悬停效果
		themeItem.addEventListener('mouseenter', () => {
			if (!theme.current) {
				themeItem.style.backgroundColor = '#2a2d2e';
			}
		});

		themeItem.addEventListener('mouseleave', () => {
			if (!theme.current) {
				themeItem.style.backgroundColor = 'transparent';
			}
		});

		// 点击选择主题
		themeItem.addEventListener('click', () => {
			// 移除其他主题的选中状态
			themes.forEach(t => t.current = false);
			theme.current = true;

			// 更新UI
			themeList.querySelectorAll('div').forEach(item => {
				item.style.backgroundColor = 'transparent';
				const checkmark = item.querySelector('span:last-child');
				if (checkmark && checkmark.textContent === '✓') {
					checkmark.remove();
				}
			});

			themeItem.style.backgroundColor = '#313232';
			const checkmark = document.createElement('span');
			checkmark.style.cssText = 'color: #73c991; font-size: 16px;';
			checkmark.textContent = '✓';
			themeItem.appendChild(checkmark);

			// 更新当前主题显示
			currentThemeDisplay.textContent = theme.name;
		});

		themeList.appendChild(themeItem);
	});

	themeSelectionSection.appendChild(themeList);
	content.appendChild(themeSelectionSection);

	// 预览部分
	const previewSection = document.createElement('div');
	previewSection.style.marginBottom = '24px';

	const previewLabel = document.createElement('label');
	previewLabel.style.cssText = 'display: block; margin-bottom: 8px; font-size: 14px; color: #cccccc; font-weight: 500;';
	previewLabel.textContent = '预览效果';
	previewSection.appendChild(previewLabel);

	const previewContainer = document.createElement('div');
	previewContainer.style.cssText = 'background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px; font-family: "Consolas", "Monaco", monospace; font-size: 12px; color: #d4d4d4; line-height: 1.4;';

	// 创建代码预览内容，避免使用innerHTML
	const functionKeyword = document.createElement('span');
	functionKeyword.style.color = '#569cd6';
	functionKeyword.textContent = 'function';

	const functionName = document.createElement('span');
	functionName.style.color = '#dcdcaa';
	functionName.textContent = ' example';

	const openParen = document.createElement('span');
	openParen.textContent = '() {';

	const lineBreak1 = document.createElement('br');

	const indent = document.createElement('span');
	indent.textContent = '  '; // 使用两个空格代替&nbsp;&nbsp;

	const returnKeyword = document.createElement('span');
	returnKeyword.style.color = '#c586c0';
	returnKeyword.textContent = 'return';

	const stringLiteral = document.createElement('span');
	stringLiteral.style.color = '#ce9178';
	stringLiteral.textContent = ' "Hello World"';

	const semicolon = document.createElement('span');
	semicolon.textContent = ';';

	const lineBreak2 = document.createElement('br');

	const closeBrace = document.createElement('span');
	closeBrace.textContent = '}';

	previewContainer.appendChild(functionKeyword);
	previewContainer.appendChild(functionName);
	previewContainer.appendChild(openParen);
	previewContainer.appendChild(lineBreak1);
	previewContainer.appendChild(indent);
	previewContainer.appendChild(returnKeyword);
	previewContainer.appendChild(stringLiteral);
	previewContainer.appendChild(semicolon);
	previewContainer.appendChild(lineBreak2);
	previewContainer.appendChild(closeBrace);
	previewSection.appendChild(previewContainer);
	content.appendChild(previewSection);

	// 按钮部分
	const buttonSection = document.createElement('div');
	buttonSection.style.cssText = 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;';

	const cancelBtn = document.createElement('button');
	cancelBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 16px; color: #cccccc; cursor: pointer; font-size: 14px;';
	cancelBtn.textContent = '取消';
	buttonSection.appendChild(cancelBtn);

	const applyBtn = document.createElement('button');
	applyBtn.style.cssText = 'background-color: #0e639c; border: none; border-radius: 4px; padding: 8px 16px; color: #ffffff; cursor: pointer; font-size: 14px; font-weight: 500;';
	applyBtn.textContent = '应用';
	buttonSection.appendChild(applyBtn);

	content.appendChild(buttonSection);
	dialog.appendChild(content);
	backdrop.appendChild(dialog);

	// 应用主题
	async function applyTheme() {
		const selectedTheme = themes.find(t => t.current);
		console.log('=== 开始主题切换调试 ===');
		console.log('选中的主题:', selectedTheme);
		console.log('themeService 是否可用:', !!themeService);

		if (selectedTheme && themeService) {
			try {
				// 获取当前主题信息
				const currentTheme = themeService.getColorTheme();
				console.log('当前主题信息:', {
					id: currentTheme.id,
					label: currentTheme.label,
					settingsId: currentTheme.settingsId
				});

				// 先获取所有可用主题进行对比
				try {
					const availableThemes = await themeService.getColorThemes();
					console.log('可用主题数量:', availableThemes.length);

					// 打印所有Light相关主题
					const lightThemes = availableThemes.filter(t =>
						t.id.toLowerCase().includes('light') ||
						t.label.toLowerCase().includes('light')
					);
					console.log('Light相关主题:', lightThemes.map(t => ({
						id: t.id,
						label: t.label,
						settingsId: t.settingsId
					})));

					const matchingTheme = availableThemes.find(t => t.id === selectedTheme.value);
					console.log('通过ID匹配的主题:', matchingTheme);

					// 如果没有找到精确匹配，尝试通过settingsId匹配
					if (!matchingTheme) {
						const settingsIdMatch = availableThemes.find(t => t.settingsId === selectedTheme.value);
						console.log('通过settingsId匹配的主题:', settingsIdMatch);
						if (settingsIdMatch) {
							console.log('更新主题ID从', selectedTheme.value, '到', settingsIdMatch.id);
							selectedTheme.value = settingsIdMatch.id; // 更新为正确的ID
						}
					}
				} catch (e) {
					console.error('获取可用主题失败:', e);
				}

				console.log('准备切换到主题ID:', selectedTheme.value);

				// 使用VS Code主题服务切换主题，使用'auto'作为设置目标
				const result = await themeService.setColorTheme(selectedTheme.value, 'auto');
				console.log('setColorTheme 返回结果:', result);

				if (result) {
					console.log('主题切换成功');
					// 验证切换后的主题
					const newCurrentTheme = themeService.getColorTheme();
					console.log('切换后的主题:', {
						id: newCurrentTheme.id,
						label: newCurrentTheme.label,
						settingsId: newCurrentTheme.settingsId
					});
				} else {
					console.error('主题切换失败: setColorTheme返回null');
				}
			} catch (error) {
				console.error('切换主题失败:', error);
				console.error('错误堆栈:', error.stack);
			}
		} else {
			console.log('无法切换主题 - selectedTheme:', !!selectedTheme, 'themeService:', !!themeService);
		}
		console.log('=== 主题切换调试结束 ===');
		closeDialog();
	}

	// 关闭对话框
	function closeDialog() {
		if (backdrop && backdrop.parentNode) {
			backdrop.parentNode.removeChild(backdrop);
		}
	}

	// 事件监听器
	applyBtn.addEventListener('click', applyTheme);
	cancelBtn.addEventListener('click', closeDialog);

	// 点击背景关闭对话框
	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) {
			closeDialog();
		}
	});

	// ESC键关闭对话框
	document.addEventListener('keydown', function escHandler(e) {
		if (e.key === 'Escape') {
			closeDialog();
			document.removeEventListener('keydown', escHandler);
		}
	});

	// 添加到页面
	document.body.appendChild(backdrop);
}

// 显示语言设置对话框
function showLanguageDialog(accessor?: ServicesAccessor): void {
	// 获取服务
	const localeService = accessor?.get(ILocaleService);

	// 创建对话框背景
	const backdrop = document.createElement('div');
	backdrop.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.5);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	`;

	// 创建对话框容器
	const dialog = document.createElement('div');
	dialog.style.cssText = `
		background-color: #2d2d30;
		color: #cccccc;
		border-radius: 8px;
		padding: 24px;
		width: 480px;
		max-width: 90vw;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	`;

	// 创建对话框内容
	const content = document.createElement('div');

	// 标题
	const title = document.createElement('h2');
	title.style.cssText = 'margin: 0 0 24px 0; font-size: 20px; font-weight: 600; color: #ffffff; text-align: center;';
	title.textContent = '语言设置'; // hardcoded to prevent language switching issues
	content.appendChild(title);

	// 当前语言显示部分
	const currentLanguageSection = document.createElement('div');
	currentLanguageSection.style.marginBottom = '24px';

	const currentLanguageLabel = document.createElement('label');
	currentLanguageLabel.style.cssText = 'display: block; margin-bottom: 8px; font-size: 14px; color: #cccccc; font-weight: 500;';
	currentLanguageLabel.textContent = '当前语言'; // hardcoded to prevent language switching issues
	currentLanguageSection.appendChild(currentLanguageLabel);

	// 获取当前UI语言
	// 使用 VS Code 的 language/locale 来准确识别当前UI语言
	// language: 解析后的UI语言 (e.g., 'en', 'zh-cn')
	// locale: 用户在 argv.json 中设置的 locale (e.g., 'en', 'zh-cn')
	let currentLanguage = language || locale || 'en';

	// 标准化语言代码：将 'zh-hans' 转换为 'zh-cn'
	if (currentLanguage.toLowerCase().includes('zh')) {
		currentLanguage = 'zh-cn';
	} else if (currentLanguage.startsWith('en')) {
		currentLanguage = 'en';
	}

	console.log('当前UI语言检测:', {
		language: language,
		locale: locale,
		navigator: navigator.language,
		final: currentLanguage,
		localeService: localeService ? '可用' : '不可用'
	});

	// 定义支持的语言
	const supportedLanguages: ILanguagePackItem[] = [
		{
			id: 'en',
			label: 'English',
			galleryExtension: undefined,
			extensionId: undefined
		},
		{
			id: 'zh-cn',
			label: '中文 (简体)',
			galleryExtension: undefined,
			extensionId: 'ms-ceintl.vscode-language-pack-zh-hans'
		}
	];

	const currentLanguageName = supportedLanguages.find(lang => lang.id === currentLanguage)?.label || 'English';

	const currentLanguageDisplay = document.createElement('div');
	currentLanguageDisplay.style.cssText = 'background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 12px; color: #ffffff; font-size: 14px;';
	currentLanguageDisplay.textContent = currentLanguageName;
	currentLanguageSection.appendChild(currentLanguageDisplay);
	content.appendChild(currentLanguageSection);

	// 语言选择部分
	const languageSelectionSection = document.createElement('div');
	languageSelectionSection.style.marginBottom = '24px';

	const languageSelectionLabel = document.createElement('label');
	languageSelectionLabel.style.cssText = 'display: block; margin-bottom: 12px; font-size: 14px; color: #cccccc; font-weight: 500;';
	languageSelectionLabel.textContent = '选择语言'; // hardcoded to prevent language switching issues
	languageSelectionSection.appendChild(languageSelectionLabel);

	const languageList = document.createElement('div');
	languageList.style.cssText = 'max-height: 250px; overflow-y: auto; border: 1px solid #3c3c3c; border-radius: 4px; background-color: #1e1e1e;';

	// 初始化选中的语言
	let selectedLanguage: string | undefined = currentLanguage || undefined;
	let selectedLanguageItem: ILanguagePackItem | undefined = supportedLanguages.find(lang => lang.id === currentLanguage);

	supportedLanguages.forEach((language, index) => {
		const languageItem = document.createElement('div');
		const isSelected = language.id === currentLanguage;
		languageItem.style.cssText = `
			padding: 12px 16px;
			cursor: pointer;
			border-bottom: ${index < supportedLanguages.length - 1 ? '1px solid #3c3c3c' : 'none'};
			display: flex;
			align-items: center;
			justify-content: space-between;
			transition: background-color 0.2s;
			${isSelected ? 'background-color: #313232;' : ''}
		`;

		const languageName = document.createElement('span');
		languageName.style.cssText = 'color: #ffffff; font-size: 14px;';
		languageName.textContent = language.label;
		languageItem.appendChild(languageName);

		if (isSelected) {
			const checkmark = document.createElement('span');
			checkmark.style.cssText = 'color: #73c991; font-size: 16px;';
			checkmark.textContent = '✓';
			languageItem.appendChild(checkmark);
		}

		// 鼠标悬停效果
		languageItem.addEventListener('mouseenter', () => {
			if (!isSelected) {
				languageItem.style.backgroundColor = '#2a2d2e';
			}
		});

		languageItem.addEventListener('mouseleave', () => {
			if (!isSelected) {
				languageItem.style.backgroundColor = 'transparent';
			}
		});

		// 点击选择语言
		languageItem.addEventListener('click', () => {
			// 移除其他语言的选中状态
			languageList.querySelectorAll('div').forEach(item => {
				item.style.backgroundColor = 'transparent';
				const checkmark = item.querySelector('span:last-child');
				if (checkmark && checkmark.textContent === '✓') {
					checkmark.remove();
				}
			});

			languageItem.style.backgroundColor = '#313232';
			const checkmark = document.createElement('span');
			checkmark.style.cssText = 'color: #73c991; font-size: 16px;';
			checkmark.textContent = '✓';
			languageItem.appendChild(checkmark);

			// 更新选中的语言
			selectedLanguage = language.id;
			selectedLanguageItem = language;

			// 更新当前语言显示
			currentLanguageDisplay.textContent = language.label;
		});

		languageList.appendChild(languageItem);
	});

	languageSelectionSection.appendChild(languageList);
	content.appendChild(languageSelectionSection);

	// 重启提示部分
	const restartNoticeSection = document.createElement('div');
	restartNoticeSection.style.marginBottom = '24px';

	const restartNotice = document.createElement('div');
	restartNotice.style.cssText = 'background-color: #3c3c3c; border-left: 4px solid #ffa500; padding: 12px; border-radius: 4px; font-size: 13px; color: #cccccc; line-height: 1.4;';

	// 创建警告图标和文本，避免使用innerHTML
	const warningIcon = document.createElement('strong');
	warningIcon.style.color = '#ffa500';
	warningIcon.textContent = '⚠️ ';

	const noticeText = document.createElement('span');
	noticeText.textContent = '注意：更改语言设置后需要重启IDE才能生效。'; // hardcoded to prevent language switching issues

	restartNotice.appendChild(warningIcon);
	restartNotice.appendChild(noticeText);
	restartNoticeSection.appendChild(restartNotice);
	content.appendChild(restartNoticeSection);

	// 按钮部分
	const buttonSection = document.createElement('div');
	buttonSection.style.cssText = 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;';

	const cancelBtn = document.createElement('button');
	cancelBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 16px; color: #cccccc; cursor: pointer; font-size: 14px;';
	cancelBtn.textContent = '取消'; // hardcoded to prevent language switching issues
	buttonSection.appendChild(cancelBtn);

	const applyBtn = document.createElement('button');
	applyBtn.style.cssText = 'background-color: #0e639c; border: none; border-radius: 4px; padding: 8px 16px; color: #ffffff; cursor: pointer; font-size: 14px; font-weight: 500;';
	applyBtn.textContent = '应用并重启'; // hardcoded to prevent language switching issues
	buttonSection.appendChild(applyBtn);

	content.appendChild(buttonSection);
	dialog.appendChild(content);
	backdrop.appendChild(dialog);

	// 应用语言设置
	async function applyLanguage() {
		if (selectedLanguage && selectedLanguage !== currentLanguage && selectedLanguageItem) {
			console.log('应用语言设置:', {
				from: currentLanguage,
				to: selectedLanguage,
				languageItem: selectedLanguageItem
			});

			try {
				// 使用 VS Code 的标准语言切换机制
				// setLocale 会将语言设置保存到 argv.json 并触发重启
				if (localeService) {
					// 使用 skipDialog: true 跳过确认对话框，直接重启
					await localeService.setLocale(selectedLanguageItem, true);
					console.log('语言设置已通过 localeService 应用，IDE将重启');
				} else {
					console.warn('localeService 不可用，无法应用语言设置');
					alert('语言服务不可用，请稍后重试');
				}
			} catch (error) {
				console.error('设置语言失败:', error);
				alert(`设置语言失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		// 注意：如果 localeService.setLocale() 成功，IDE会重启，不会执行到这里
		closeDialog();
	}

	// 关闭对话框
	function closeDialog() {
		if (backdrop && backdrop.parentNode) {
			backdrop.parentNode.removeChild(backdrop);
		}
	}

	// 事件监听器
	applyBtn.addEventListener('click', applyLanguage);
	cancelBtn.addEventListener('click', closeDialog);

	// 点击背景关闭对话框
	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) {
			closeDialog();
		}
	});

	// ESC键关闭对话框
	document.addEventListener('keydown', function escHandler(e) {
		if (e.key === 'Escape') {
			closeDialog();
			document.removeEventListener('keydown', escHandler);
		}
	});

	// 添加到页面
	document.body.appendChild(backdrop);
}

// 任务管理数据结构
interface Task {
	id: string;
	title: string;
	description: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
	workingDirectory: string;
	createdAt: Date;
	updatedAt: Date;
}

// 任务管理存储
class TaskManager {
	private static readonly STORAGE_KEY = 'senweaver.assistant.tasks';
	private tasks: Task[] = [];

	constructor() {
		this.loadTasks();
	}

	private loadTasks(): void {
		try {
			const stored = localStorage.getItem(TaskManager.STORAGE_KEY);
			if (stored) {
				this.tasks = JSON.parse(stored).map((task: any) => ({
					...task,
					createdAt: new Date(task.createdAt),
					updatedAt: new Date(task.updatedAt)
				}));
			}
		} catch (error) {
			console.error('加载任务失败:', error);
			this.tasks = [];
		}
	}

	private saveTasks(): void {
		try {
			localStorage.setItem(TaskManager.STORAGE_KEY, JSON.stringify(this.tasks));
		} catch (error) {
			console.error('保存任务失败:', error);
		}
	}

	addTask(title: string, description: string, workingDirectory: string): Task {
		const task: Task = {
			id: generateUuid(),
			title,
			description,
			status: 'pending',
			workingDirectory,
			createdAt: new Date(),
			updatedAt: new Date()
		};
		this.tasks.unshift(task);
		this.saveTasks();
		return task;
	}

	updateTask(id: string, updates: Partial<Task>): boolean {
		const index = this.tasks.findIndex(task => task.id === id);
		if (index !== -1) {
			this.tasks[index] = { ...this.tasks[index], ...updates, updatedAt: new Date() };
			this.saveTasks();
			return true;
		}
		return false;
	}

	deleteTask(id: string): boolean {
		const index = this.tasks.findIndex(task => task.id === id);
		if (index !== -1) {
			this.tasks.splice(index, 1);
			this.saveTasks();
			return true;
		}
		return false;
	}

	getTasks(): Task[] {
		return [...this.tasks];
	}
}

const taskManager = new TaskManager();

// 显示5X24小时助手对话框
function show24HourAssistantDialog(): void {
	// 创建对话框背景
	const backdrop = document.createElement('div');
	backdrop.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.5);
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	`;

	// 创建对话框容器
	const dialog = document.createElement('div');
	dialog.style.cssText = `
		background-color: #2d2d30;
		color: #cccccc;
		border-radius: 8px;
		padding: 24px;
		width: 600px;
		max-width: 90vw;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	`;

	// 创建对话框内容
	const content = document.createElement('div');

	// 标题部分
	const titleSection = document.createElement('div');
	titleSection.style.marginBottom = '24px';

	const title = document.createElement('h2');
	title.style.cssText = 'margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #ffffff;';
	title.textContent = '5X24小时助手';
	titleSection.appendChild(title);

	const subtitle = document.createElement('p');
	subtitle.style.cssText = 'margin: 0; font-size: 14px; color: #cccccc; opacity: 0.8;';
	subtitle.textContent = '智能任务管理和项目协助';
	titleSection.appendChild(subtitle);

	content.appendChild(titleSection);

	// 新建任务部分
	const newTaskSection = document.createElement('div');
	newTaskSection.style.marginBottom = '24px';

	const newTaskTitle = document.createElement('h3');
	newTaskTitle.style.cssText = 'margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #ffffff;';
	newTaskTitle.textContent = '创建新任务';
	newTaskSection.appendChild(newTaskTitle);

	// 任务标题输入
	const taskTitleContainer = document.createElement('div');
	taskTitleContainer.style.marginBottom = '12px';

	const taskTitleLabel = document.createElement('label');
	taskTitleLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 14px; color: #cccccc;';
	taskTitleLabel.textContent = '任务标题';
	taskTitleContainer.appendChild(taskTitleLabel);

	const taskTitleInput = document.createElement('input');
	taskTitleInput.id = 'taskTitle';
	taskTitleInput.type = 'text';
	taskTitleInput.placeholder = '请输入任务标题...';
	taskTitleInput.style.cssText = 'width: 100%; background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #ffffff; font-size: 14px; box-sizing: border-box;';
	taskTitleContainer.appendChild(taskTitleInput);

	newTaskSection.appendChild(taskTitleContainer);

	// 任务描述输入（富文本）
	const taskDescContainer = document.createElement('div');
	taskDescContainer.style.marginBottom = '12px';

	const taskDescLabel = document.createElement('label');
	taskDescLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 14px; color: #cccccc;';
	taskDescLabel.textContent = '任务描述';
	taskDescContainer.appendChild(taskDescLabel);

	const taskDescTextarea = document.createElement('textarea');
	taskDescTextarea.id = 'taskDescription';
	taskDescTextarea.placeholder = '请详细描述任务需求、目标和要求...';
	taskDescTextarea.style.cssText = 'width: 100%; height: 120px; background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #ffffff; font-size: 14px; resize: vertical; font-family: inherit; box-sizing: border-box;';
	taskDescContainer.appendChild(taskDescTextarea);

	newTaskSection.appendChild(taskDescContainer);

	// 工作目录选择
	const workDirContainer = document.createElement('div');
	workDirContainer.style.marginBottom = '16px';

	const workDirLabel = document.createElement('label');
	workDirLabel.style.cssText = 'display: block; margin-bottom: 4px; font-size: 14px; color: #cccccc;';
	workDirLabel.textContent = '工作目录';
	workDirContainer.appendChild(workDirLabel);

	const workDirInputContainer = document.createElement('div');
	workDirInputContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

	const workDirInput = document.createElement('input');
	workDirInput.id = 'workingDirectory';
	workDirInput.type = 'text';
	workDirInput.placeholder = '选择或输入工作目录路径...';
	workDirInput.value = 'd:\\ai\\swcoder\\code4\\void'; // 默认当前工作目录
	workDirInput.style.cssText = 'flex: 1; background-color: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #ffffff; font-size: 14px;';
	workDirInputContainer.appendChild(workDirInput);

	const browseDirBtn = document.createElement('button');
	browseDirBtn.id = 'browseDirectory';
	browseDirBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 12px; color: #cccccc; cursor: pointer; font-size: 14px;';
	browseDirBtn.textContent = '浏览';
	workDirInputContainer.appendChild(browseDirBtn);

	workDirContainer.appendChild(workDirInputContainer);
	newTaskSection.appendChild(workDirContainer);

	// 创建任务按钮
	const createTaskBtn = document.createElement('button');
	createTaskBtn.id = 'createTask';
	createTaskBtn.style.cssText = 'background-color: #0e639c; border: none; border-radius: 4px; padding: 10px 20px; color: #ffffff; cursor: pointer; font-size: 14px; font-weight: 500;';
	createTaskBtn.textContent = '创建任务';
	newTaskSection.appendChild(createTaskBtn);

	content.appendChild(newTaskSection);

	// 任务列表部分
	const taskListSection = document.createElement('div');
	taskListSection.style.marginBottom = '24px';

	const taskListTitle = document.createElement('h3');
	taskListTitle.style.cssText = 'margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #ffffff;';
	taskListTitle.textContent = '任务列表';
	taskListSection.appendChild(taskListTitle);

	const taskListContainer = document.createElement('div');
	taskListContainer.id = 'taskListContainer';
	taskListContainer.style.cssText = 'max-height: 300px; overflow-y: auto; border: 1px solid #3c3c3c; border-radius: 4px; background-color: #1e1e1e;';

	// 渲染任务列表
	function renderTaskList() {
		// 清空容器内容，避免使用innerHTML
		while (taskListContainer.firstChild) {
			taskListContainer.removeChild(taskListContainer.firstChild);
		}
		const tasks = taskManager.getTasks();

		if (tasks.length === 0) {
			const emptyState = document.createElement('div');
			emptyState.style.cssText = 'padding: 20px; text-align: center; color: #888; font-size: 14px;';
			emptyState.textContent = '暂无任务';
			taskListContainer.appendChild(emptyState);
			return;
		}

		tasks.forEach(task => {
			const taskItem = document.createElement('div');
			taskItem.style.cssText = 'padding: 12px; border-bottom: 1px solid #3c3c3c; display: flex; justify-content: space-between; align-items: flex-start;';

			const taskInfo = document.createElement('div');
			taskInfo.style.cssText = 'flex: 1; margin-right: 12px;';

			const taskTitleEl = document.createElement('div');
			taskTitleEl.style.cssText = 'font-weight: 500; color: #ffffff; margin-bottom: 4px; font-size: 14px;';
			taskTitleEl.textContent = task.title;
			taskInfo.appendChild(taskTitleEl);

			const taskDesc = document.createElement('div');
			taskDesc.style.cssText = 'color: #cccccc; font-size: 12px; margin-bottom: 4px; line-height: 1.4;';
			taskDesc.textContent = task.description.length > 100 ? task.description.substring(0, 100) + '...' : task.description;
			taskInfo.appendChild(taskDesc);

			const taskMeta = document.createElement('div');
			taskMeta.style.cssText = 'display: flex; align-items: center; gap: 12px; font-size: 11px; color: #888;';

			const statusBadge = document.createElement('span');
			const statusColors = {
				pending: '#ffa500',
				in_progress: '#0e639c',
				completed: '#73c991',
				cancelled: '#f14c4c'
			};
			const statusTexts = {
				pending: '待处理',
				in_progress: '进行中',
				completed: '已完成',
				cancelled: '已取消'
			};
			statusBadge.style.cssText = `background-color: ${statusColors[task.status]}; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-size: 10px;`;
			statusBadge.textContent = statusTexts[task.status];
			taskMeta.appendChild(statusBadge);

			const workDir = document.createElement('span');
			workDir.textContent = `📁 ${task.workingDirectory}`;
			taskMeta.appendChild(workDir);

			const updateTime = document.createElement('span');
			updateTime.textContent = `🕒 ${task.updatedAt.toLocaleString()}`;
			taskMeta.appendChild(updateTime);

			taskInfo.appendChild(taskMeta);
			taskItem.appendChild(taskInfo);

			// 操作按钮
			const actions = document.createElement('div');
			actions.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

			// 状态切换按钮
			if (task.status !== 'completed' && task.status !== 'cancelled') {
				const statusBtn = document.createElement('button');
				statusBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 3px; padding: 4px 8px; color: #cccccc; cursor: pointer; font-size: 11px;';
				statusBtn.textContent = task.status === 'pending' ? '开始' : '完成';
				statusBtn.addEventListener('click', () => {
					const newStatus = task.status === 'pending' ? 'in_progress' : 'completed';
					taskManager.updateTask(task.id, { status: newStatus });
					renderTaskList();
				});
				actions.appendChild(statusBtn);
			}

			// 删除按钮
			const deleteBtn = document.createElement('button');
			deleteBtn.style.cssText = 'background-color: transparent; border: 1px solid #f14c4c; border-radius: 3px; padding: 4px 8px; color: #f14c4c; cursor: pointer; font-size: 11px;';
			deleteBtn.textContent = '删除';
			deleteBtn.addEventListener('click', () => {
				if (confirm('确定要删除这个任务吗？')) {
					taskManager.deleteTask(task.id);
					renderTaskList();
				}
			});
			actions.appendChild(deleteBtn);

			taskItem.appendChild(actions);
			taskListContainer.appendChild(taskItem);
		});
	}

	renderTaskList();
	taskListSection.appendChild(taskListContainer);
	content.appendChild(taskListSection);

	// 按钮部分
	const buttonSection = document.createElement('div');
	buttonSection.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';

	const closeBtn = document.createElement('button');
	closeBtn.id = 'closeButton';
	closeBtn.style.cssText = 'background-color: transparent; border: 1px solid #3c3c3c; border-radius: 4px; padding: 8px 16px; color: #cccccc; cursor: pointer; font-size: 14px;';
	closeBtn.textContent = '关闭';
	buttonSection.appendChild(closeBtn);

	content.appendChild(buttonSection);
	dialog.appendChild(content);

	// 添加事件监听器
	const taskTitleInputEl = dialog.querySelector('#taskTitle') as HTMLInputElement;
	const taskDescTextareaEl = dialog.querySelector('#taskDescription') as HTMLTextAreaElement;
	const workDirInputEl = dialog.querySelector('#workingDirectory') as HTMLInputElement;
	const browseDirBtnEl = dialog.querySelector('#browseDirectory') as HTMLButtonElement;
	const createTaskBtnEl = dialog.querySelector('#createTask') as HTMLButtonElement;
	const closeBtnEl = dialog.querySelector('#closeButton') as HTMLButtonElement;

	// 创建任务
	createTaskBtnEl.addEventListener('click', () => {
		const title = taskTitleInputEl.value.trim();
		const description = taskDescTextareaEl.value.trim();
		const workingDirectory = workDirInputEl.value.trim();

		if (!title) {
			alert('请输入任务标题');
			taskTitleInputEl.focus();
			return;
		}

		if (!description) {
			alert('请输入任务描述');
			taskDescTextareaEl.focus();
			return;
		}

		if (!workingDirectory) {
			alert('请选择工作目录');
			workDirInputEl.focus();
			return;
		}

		taskManager.addTask(title, description, workingDirectory);

		// 清空输入框
		taskTitleInputEl.value = '';
		taskDescTextareaEl.value = '';

		// 重新渲染任务列表
		renderTaskList();

		// 显示成功提示
		createTaskBtnEl.textContent = '✓ 已创建';
		createTaskBtnEl.style.backgroundColor = '#73c991';
		setTimeout(() => {
			createTaskBtnEl.textContent = '创建任务';
			createTaskBtnEl.style.backgroundColor = '#0e639c';
		}, 1500);
	});

	// 浏览目录（简化实现）
	browseDirBtnEl.addEventListener('click', () => {
		// 这里可以集成文件选择器，暂时使用简单的提示
		const newPath = prompt('请输入工作目录路径:', workDirInputEl.value);
		if (newPath && newPath.trim()) {
			workDirInputEl.value = newPath.trim();
		}
	});

	// 关闭按钮
	closeBtnEl.addEventListener('click', closeDialog);

	// 点击背景关闭
	backdrop.addEventListener('click', (e) => {
		if (e.target === backdrop) {
			closeDialog();
		}
	});

	// ESC键关闭
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			closeDialog();
		}
	};

	function closeDialog() {
		document.removeEventListener('keydown', handleKeyDown);
		backdrop.remove();
	}

	document.addEventListener('keydown', handleKeyDown);
	backdrop.appendChild(dialog);
	document.body.appendChild(backdrop);

	// 聚焦到任务标题输入框
	setTimeout(() => {
		taskTitleInputEl.focus();
	}, 100);
}



// 远程协作菜单项
export const SENWEAVER_REMOTE_COLLABORATION_ACTION_ID = 'workbench.action.voidRemoteCollaboration'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_REMOTE_COLLABORATION_ACTION_ID,
			title: { value: "远程协作", original: "远程协作" }, // hardcoded to prevent language switching issues
			icon: Codicon.liveShare,
			menu: [
				{
					id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
					group: '2_account',
					order: 4
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// 设置初始标签页为远程协作，然后打开设置页面
		_pendingInitialTab = 'remoteCollaboration';

		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		// 关闭已有的设置编辑器实例（确保重新创建以读取 pendingInitialTab）
		const openEditors = editorService.findEditors(SenweaverSettingsInput.RESOURCE);
		if (openEditors.length > 0) {
			await editorService.closeEditors(openEditors);
		}

		// 打开设置编辑器
		const input = instantiationService.createInstance(SenweaverSettingsInput);
		await editorService.openEditor(input);
	}
})

// 5X24小时助手菜单项 - 暂时隐藏
export const SENWEAVER_24HOUR_ASSISTANT_ACTION_ID = 'workbench.action.void24HourAssistant'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_24HOUR_ASSISTANT_ACTION_ID,
			title: { value: "5X24小时助手", original: "5X24小时助手" }, // hardcoded to prevent language switching issues
			icon: Codicon.robot,
			// 暂时隐藏5X24小时助手菜单项
			// menu: [
			// 	{
			// 		id: SENWEAVER_IDE_SETTINGS_SUBMENU_ID,
			// 		group: '2_account',
			// 		order: 5
			// 	}
			// ]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		show24HourAssistantDialog();
	}
})



// add to settings gear on bottom left
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: SENWEAVER_TOGGLE_SETTINGS_ACTION_ID,
		title: "设置" // hardcoded to prevent language switching issues
	},
	order: 1
});

// 新版本更新后重启按钮 - 在右上角主侧栏按钮前面显示
export const SENWEAVER_UPDATE_RESTART_ACTION_ID = 'workbench.action.SenweaverUpdateRestart'
registerAction2(class SenweaverUpdateRestartAction extends Action2 {
	constructor() {
		super({
			id: SENWEAVER_UPDATE_RESTART_ACTION_ID,
			title: { value: "有版本更新", original: "有版本更新" },
			// 不使用图标，直接显示文字
			// icon: undefined, // 明确设置为不使用图标
			menu: [
				{
					id: MenuId.LayoutControlMenu,
					group: '0_update', // 在主侧栏按钮前面（主侧栏是 2_pane_toggles）
					order: 1,
					// 根据版本更新状态控制显示：当服务器版本与本地版本不同时显示
					when: ContextKeyExpr.equals('senweaver.hasUpdate', true)
				}
			],
			precondition: undefined,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);
		const dialogService = accessor.get(IDialogService);

		console.log('用户点击版本更新按钮');

		try {
			// 检查下载状态
			if (senweaverUpdateDownloadStatus.downloading) {
				// 正在下载中
				await dialogService.info(
					'正在下载更新',
					'新版本安装包正在后台静默下载中，请稍后再试。'
				);
				return;
			}

			if (senweaverUpdateDownloadStatus.error) {
				// 下载失败
				await dialogService.error(
					'下载更新失败',
					`后台下载新版本时出错: ${senweaverUpdateDownloadStatus.error}\n\n请稍后重试或联系管理员。`
				);
				return;
			}

			if (senweaverUpdateDownloadStatus.downloaded && senweaverUpdateDownloadStatus.filePath) {
				// 下载完成，提示用户安装
				console.log('更新已下载完成:', senweaverUpdateDownloadStatus.filePath);

				const result = await dialogService.confirm({
					message: '更新已准备就绪',
					detail: '是否现在关闭应用并启动安装程序？',
					primaryButton: '现在安装',
					cancelButton: '稍后安装'
				});

				if (result.confirmed) {
					console.log('用户选择立即安装');

					// 启动安装程序
					try {
						// 在 Windows 上，直接运行 exe 文件
						// 在 macOS 上，打开 dmg 文件
						// 在 Linux 上，需要用户手动安装 deb 文件
						if (isWindows) {
							// Windows: 启动 exe 安装程序
							await nativeHostService.openExternal(`file:///${senweaverUpdateDownloadStatus.filePath}`);
						} else {
							// macOS/Linux: 打开文件所在目录
							await nativeHostService.showItemInFolder(senweaverUpdateDownloadStatus.filePath);
						}

						// 关闭应用
						console.log('关闭应用，准备安装更新');
						await nativeHostService.quit();
					} catch (error) {
						console.error('启动安装程序失败:', error);
						await dialogService.error(
							'启动安装程序失败',
							`无法启动安装程序: ${error instanceof Error ? error.message : String(error)}\n\n安装程序位置: ${senweaverUpdateDownloadStatus.filePath}`
						);
					}
				} else {
					console.log('用户选择稍后安装');
				}
			} else {
				// 还未开始下载（理论上不应该出现这种情况）
				await dialogService.info(
					'检查更新',
					'正在检查更新，请稍后再试。'
				);
			}

		} catch (error) {
			console.error('处理更新失败:', error);
			await dialogService.error(
				'更新失败',
				`处理更新时出错: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
})
