/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent, isABuiltinToolName } from '../common/prompt/prompts.js';
import { AnthropicReasoning, getErrorMessage, RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FeatureName, ModelSelection, ModelSelectionOptions } from '../common/senweaverSettingsTypes.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, ToolCallParams, ToolName, ToolResult } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ChatMessage, CheckpointEntry, CodespanLocationLink, StagingSelectionItem, ToolMessage, ImageAttachment } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { ISenweaverModelService } from '../common/senweaverModelService.js';
import { findLast, findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { SenweaverFileSnapshot } from '../common/editCodeServiceTypes.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY, THREAD_INDEX_KEY, THREAD_SHARD_PREFIX } from '../common/storageKeys.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { timeout } from '../../../../base/common/async.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMCPService } from '../common/mcpService.js';
import { RawMCPToolCall } from '../common/mcpServiceTypes.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { getModelCapabilities } from '../common/modelCapabilities.js';
import { isOwnProviderEnabled, getOwnProviderModelAccess, sendModelUsageReport } from './senweaverOnlineConfigContribution.js';
import { tpmRateLimiter } from '../common/tpmRateLimiter.js';
import { enhancedContextManager } from '../common/smartContextManager.js';

// related to retrying when LLM message has error
const CHAT_RETRIES = 5  // 增加重试次数
const BASE_RETRY_DELAY = 3000  // 基础重试延迟
const MAX_RETRY_DELAY = 60000  // 最大重试延迟

// 计算指数退避延迟
const getRetryDelay = (attempt: number, isTPMError: boolean): number => {
	if (isTPMError) {
		// TPM 错误使用更长的延迟
		return Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
	}
	// 普通错误使用较短延迟
	return Math.min(BASE_RETRY_DELAY * Math.pow(1.5, attempt - 1), MAX_RETRY_DELAY / 2);
};

const perfNow = () => (typeof (globalThis as any).performance?.now === 'function' ? (globalThis as any).performance.now() : Date.now())
// Performance logging disabled - keep function signature for call sites
const maybePerfLog = (_label: string, _ms: number, _extra?: Record<string, any>) => { }
const debugThinkingLog = (_label: string, _elapsed: number, _extra?: Record<string, any>) => { }
const schedulePerfHeartbeats = (_label: string, _extra?: Record<string, any>) => { }

// 获取用户 ID（与 SenweaverOnlineConfigContribution.ts 中相同的逻辑）
function getUserId(): string {
	const storageKey = 'senweaver.user.id';
	return localStorage.getItem(storageKey) || 'unknown';
}

// 发送模型使用记录到后端（仅针对 ownProvider）- 使用 WebSocket 方式
function reportModelUsage(userId: string, modelName: string): boolean {
	return sendModelUsageReport(userId, modelName, 1);
}


const findStagingSelectionIndex = (currentSelections: StagingSelectionItem[] | undefined, newSelection: StagingSelectionItem): number | null => {
	if (!currentSelections) return null

	for (let i = 0; i < currentSelections.length; i += 1) {
		const s = currentSelections[i]

		// DesignUnit type: match by designId
		if (s.type === 'DesignUnit' && newSelection.type === 'DesignUnit') {
			if (s.designId === newSelection.designId) {
				return i
			}
			continue
		}

		// Terminal type: match by terminalName
		if (s.type === 'Terminal' && newSelection.type === 'Terminal') {
			if (s.terminalName === newSelection.terminalName) {
				return i
			}
			continue
		}

		// Only handle types with uri property (File, CodeSelection, Folder)
		if ((s.type === 'File' || s.type === 'CodeSelection' || s.type === 'Folder') &&
			(newSelection.type === 'File' || newSelection.type === 'CodeSelection' || newSelection.type === 'Folder')) {

			if (s.uri.fsPath !== newSelection.uri.fsPath) continue

			if (s.type === 'File' && newSelection.type === 'File') {
				return i
			}
			if (s.type === 'CodeSelection' && newSelection.type === 'CodeSelection') {
				// if there's any collision return true
				const [oldStart, oldEnd] = s.range
				const [newStart, newEnd] = newSelection.range
				if (oldStart !== newStart || oldEnd !== newEnd) continue
				return i
			}
			if (s.type === 'Folder' && newSelection.type === 'Folder') {
				return i
			}
		}
	}
	return null
}


/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/


type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']
const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
}

// a 'thread' means a chat message history

type TextAreaFns = { setValue: (v: string) => void, enable: () => void, disable: () => void }

type WhenMounted = {
	textAreaRef: { current: HTMLTextAreaElement | null }; // the textarea that this thread has, gets set in SidebarChat
	textAreaFnsRef?: { current: TextAreaFns | null }; // functions to manipulate the textarea
	scrollToBottom: () => void;
}



export type ThreadType = {
	id: string; // store the id here too
	createdAt: string; // ISO string
	lastModified: string; // ISO string

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	state: {
		currCheckpointIdx: number | null; // the latest checkpoint we're at (null if not at a particular checkpoint, like if the chat is streaming, or chat just finished and we haven't clicked on a checkpt)

		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined; // index of the user message that is being edited (undefined if none)

		linksOfMessageIdx: { // eg. link = linksOfMessageIdx[4]['RangeFunction']
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		}

		uploadedImages?: ImageAttachment[]; // 存储当前线程中上传的图片附件

		hasAutoAddedFilesThisRound?: boolean; // 标记本轮对话是否已经自动添加过文件

		mountedInfo?: {
			whenMounted: Promise<WhenMounted>
			_whenMountedResolver: (res: WhenMounted) => void
			mountedIsResolvedRef: { current: boolean };
		}
	};
}

type ChatThreads = {
	[id: string]: undefined | ThreadType;
}


export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type IsRunningType =
	| 'LLM' // the LLM is currently streaming
	| 'tool' // whether a tool is currently running
	| 'awaiting_user' // awaiting user call
	| 'idle' // nothing is running now, but the chat should still appear like it's going (used in-between calls)
	| undefined

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		isRunning: undefined;
		error?: { message: string, fullError: Error | null, };
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | { // an assistant message is being written
		isRunning: 'LLM';
		error?: undefined;
		llmInfo: {
			displayContentSoFar: string;
			reasoningSoFar: string;
			toolCallSoFar: RawToolCallObj | null;
		};
		toolInfo?: undefined;
		interrupt: Promise<() => void>; // calling this should have no effect on state - would be too confusing. it just cancels the tool
	} | { // a tool is being run
		isRunning: 'tool';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo: {
			toolName: ToolName;
			toolParams: ToolCallParams<ToolName>;
			id: string;
			content: string;
			rawParams: RawToolParamsObj;
			mcpServerName: string | undefined;
		};
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'awaiting_user';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'idle';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt: 'not_needed' | Promise<() => void>; // calling this should have no effect on state - would be too confusing. it just cancels the tool
	}
}

const newThreadObject = (): ThreadType => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set()
	}
}






export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState; // not persistent

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;

	// thread selector
	deleteThread(threadId: string): void;
	duplicateThread(threadId: string): void;

	// exposed getters/setters
	// these all apply to current thread
	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void

	// you can edit multiple messages - the one you're currently editing is "focused", and we add items to that one when you press cmd+L.
	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;

	popStagingSelections(numPops?: number): void;
	addNewStagingSelection(newSelection: StagingSelectionItem): void;

	// Mark that files have been auto-added in this conversation round
	markFilesAutoAddedThisRound(): void;

	dangerousSetState: (newState: ThreadsState) => void;
	resetState: () => void;

	// // current thread's staging selections
	// closeCurrentStagingSelectionsInMessage(opts: { messageIdx: number }): void;
	// closeCurrentStagingSelectionsInThread(): void;

	// codespan links (link to symbols in the markdown)
	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink>;
	getRelativeStr(uri: URI): string | undefined

	// entry pts
	abortRunning(threadId: string): Promise<void>;
	dismissStreamError(threadId: string): void;

	// call to edit a message
	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;

	// call to add a message
	addUserMessageAndStreamResponse({ userMessage, displayMessage, threadId, images, _chatSelections }: { userMessage: string, displayMessage?: string, threadId: string, images?: ImageAttachment[], _chatSelections?: StagingSelectionItem[] }): Promise<void>;

	// approve/reject
	approveLatestToolRequest(threadId: string): void;
	rejectLatestToolRequest(threadId: string): void;

	// jump to history
	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): Promise<void>;

	focusCurrentChat: () => Promise<void>
	blurCurrentChat: () => Promise<void>
	insertTextInCurrentChat: (text: string) => Promise<void>
}

export const IChatThreadService = createDecorator<IChatThreadService>('senweaverChatThreadService');
class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	readonly streamState: ThreadStreamState = {}
	state: ThreadsState // allThreads is persisted, currentThread is not

	// used in checkpointing
	// private readonly _userModifiedFilesToCheckInCheckpoints = new LRUCache<string, null>(50)

	// Concurrency control for checkpoint jumps
	private readonly _jumpOperationInProgress = new Set<string>()

	// Cache: files already saved in checkpoint per thread (avoids O(n) message scan)
	private readonly _filesInCheckpointCache = new Map<string, Set<string>>()

	// Dirty tracking for sharded storage (only store modified threads)
	private readonly _dirtyThreadIds = new Set<string>()

	// Perf tracing for end-to-end debugging (one traceId per user message send)
	private _perfTraceSeq = 0
	private readonly _perfTraceIdByThread = new Map<string, string>()
	private _newPerfTraceId(threadId: string) {
		this._perfTraceSeq += 1
		const traceId = `${Date.now()}-${this._perfTraceSeq}`
		this._perfTraceIdByThread.set(threadId, traceId)
		return traceId
	}
	private _getPerfTraceId(threadId: string) {
		return this._perfTraceIdByThread.get(threadId) ?? 'no-trace'
	}
	private _clearPerfTraceId(threadId: string) {
		this._perfTraceIdByThread.delete(threadId)
	}

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@ISenweaverModelService private readonly _senweaverModelService: ISenweaverModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@ISenweaverSettingsService private readonly _settingsService: ISenweaverSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		super()
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // default state

		const readThreads = this._readAllThreads() || {}

		const allThreads = readThreads
		this.state = {
			allThreads: allThreads,
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()

		// Listen to editor changes to auto-update current file in context
		this._register(
			this._editorService.onDidActiveEditorChange(() => {
				this._onActiveEditorChanged()
			})
		)

		// keep track of user-modified files
		// const disposablesOfModelId: { [modelId: string]: IDisposable[] } = {}
		// this._register(
		// 	this._modelService.onModelAdded(e => {
		// 		if (!(e.id in disposablesOfModelId)) disposablesOfModelId[e.id] = []
		// 		disposablesOfModelId[e.id].push(
		// 			e.onDidChangeContent(() => { this._userModifiedFilesToCheckInCheckpoints.set(e.uri.fsPath, null) })
		// 		)
		// 	})
		// )
		// this._register(this._modelService.onModelRemoved(e => {
		// 	if (!(e.id in disposablesOfModelId)) return
		// 	disposablesOfModelId[e.id].forEach(d => d.dispose())
		// }))

	}

	async focusCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await thread.state.mountedInfo?.whenMounted
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.focus()
		}
	}
	async blurCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await thread.state.mountedInfo?.whenMounted
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.blur()
		}
	}

	async insertTextInCurrentChat(text: string) {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await thread.state.mountedInfo?.whenMounted
		const textarea = s?.textAreaRef.current
		const textAreaFns = s?.textAreaFnsRef?.current
		if (!textarea) return

		// Insert text at cursor position
		const start = textarea.selectionStart
		const end = textarea.selectionEnd
		const currentValue = textarea.value
		const newValue = currentValue.substring(0, start) + text + currentValue.substring(end)

		// Use textAreaFns.setValue if available (properly triggers React state update)
		if (textAreaFns) {
			textAreaFns.setValue(newValue)
		} else {
			textarea.value = newValue
		}

		// Move cursor to end of inserted text
		const newCursorPos = start + text.length
		textarea.setSelectionRange(newCursorPos, newCursorPos)
	}



	dangerousSetState = (newState: ThreadsState) => {
		this.state = newState
		this._onDidChangeCurrentThread.fire()
	}
	resetState = () => {
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // see constructor
		this.openNewThread()
		this._onDidChangeCurrentThread.fire()
	}

	// !!! this is important for properly restoring URIs from storage
	// should probably re-use code from void/src/vs/base/common/marshalling.ts instead. but this is simple enough
	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) { // $mid is the MarshalledId. $mid === 1 means it is a URI
				return URI.from(value); // TODO URI.revive instead of this?
			}
			return value;
		});
	}

	private _convertSingleThreadFromStorage(threadStr: string): ThreadType {
		return JSON.parse(threadStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) {
				return URI.from(value);
			}
			return value;
		});
	}

	// Read threads using sharded storage (each thread stored separately)
	// Falls back to legacy storage and migrates automatically
	private _readAllThreads(): ChatThreads | null {
		// First try sharded storage
		const indexStr = this._storageService.get(THREAD_INDEX_KEY, StorageScope.APPLICATION)
		if (indexStr) {
			try {
				const threadIds: string[] = JSON.parse(indexStr)
				const threads: ChatThreads = {}
				for (const tid of threadIds) {
					const threadStr = this._storageService.get(THREAD_SHARD_PREFIX + tid, StorageScope.APPLICATION)
					if (threadStr) {
						try {
							threads[tid] = this._convertSingleThreadFromStorage(threadStr)
						} catch (e) {
							console.error(`Failed to parse thread ${tid}:`, e)
						}
					}
				}
				return Object.keys(threads).length > 0 ? threads : null
			} catch (e) {
				console.error('Failed to parse thread index:', e)
			}
		}

		// Fallback: read from legacy storage and migrate
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
		if (!threadsStr) {
			return null
		}
		const threads = this._convertThreadDataFromStorage(threadsStr)

		// Migrate to sharded storage in background
		if (threads && Object.keys(threads).length > 0) {
			setTimeout(() => this._migrateToShardedStorage(threads), 100)
		}

		return threads
	}

	// Migrate from legacy single-key storage to sharded storage
	private async _migrateToShardedStorage(threads: ChatThreads) {
		const t0 = perfNow()
		const threadIds = Object.keys(threads)

		// Store index
		this._storageService.store(THREAD_INDEX_KEY, JSON.stringify(threadIds), StorageScope.APPLICATION, StorageTarget.USER)

		// Store each thread separately with yielding
		for (const tid of threadIds) {
			const threadJson = JSON.stringify(threads[tid])
			this._storageService.store(THREAD_SHARD_PREFIX + tid, threadJson, StorageScope.APPLICATION, StorageTarget.USER)
			await new Promise(r => setTimeout(r, 0)) // yield
		}

		// Remove legacy storage after successful migration
		this._storageService.remove(THREAD_STORAGE_KEY, StorageScope.APPLICATION)

		maybePerfLog('migrateToShardedStorage', perfNow() - t0, { threads: threadIds.length })
	}

	// ==================== SHARDED STORAGE ====================
	// Each thread is stored in its own key (senweaver.thread.{id})
	// Only dirty (modified) threads are serialized and stored
	// This reduces 90MB all-at-once serialization to ~1-5MB per thread

	private _pendingStoreTimeout: ReturnType<typeof setTimeout> | null = null
	private _storeDebounceDelay = 1000 // Reduced: only storing dirty threads now

	// Mark a thread as dirty (needs to be saved)
	private _markThreadDirty(threadId: string) {
		this._dirtyThreadIds.add(threadId)
	}

	// Called when threads change - marks dirty and schedules save
	private _storeAllThreads(threads: ChatThreads, changedThreadId?: string) {
		// Mark the changed thread as dirty
		if (changedThreadId) {
			this._markThreadDirty(changedThreadId)
		} else {
			// If no specific thread, mark all as dirty (rare case)
			Object.keys(threads).forEach(tid => this._markThreadDirty(tid))
		}

		// If there's already a pending store, let it handle
		if (this._pendingStoreTimeout) {
			return
		}

		// Skip storage during active conversations
		const hasActiveConversation = Object.keys(this.streamState).some(
			tid => this.streamState[tid]?.isRunning
		)
		if (hasActiveConversation) {
			return
		}

		// Schedule the actual store operation
		this._pendingStoreTimeout = setTimeout(() => {
			this._pendingStoreTimeout = null
			this._storeDirtyThreads()
		}, this._storeDebounceDelay)
	}

	// Store only the dirty threads (not all 90MB!)
	private async _storeDirtyThreads() {
		if (this._dirtyThreadIds.size === 0) return

		const t0 = perfNow()
		const dirtyIds = Array.from(this._dirtyThreadIds)
		this._dirtyThreadIds.clear()

		// Update thread index
		const allThreadIds = Object.keys(this.state.allThreads)
		this._storageService.store(THREAD_INDEX_KEY, JSON.stringify(allThreadIds), StorageScope.APPLICATION, StorageTarget.USER)

		// Store each dirty thread separately with yielding
		let totalBytes = 0
		for (const tid of dirtyIds) {
			const thread = this.state.allThreads[tid]
			if (thread) {
				const threadJson = JSON.stringify(thread)
				totalBytes += threadJson.length
				this._storageService.store(THREAD_SHARD_PREFIX + tid, threadJson, StorageScope.APPLICATION, StorageTarget.USER)
			} else {
				// Thread was deleted
				this._storageService.remove(THREAD_SHARD_PREFIX + tid, StorageScope.APPLICATION)
			}
			// Yield to main thread between each thread
			await new Promise(r => setTimeout(r, 0))
		}

		const t1 = perfNow()
		maybePerfLog('storeDirtyThreads', t1 - t0, { dirtyCount: dirtyIds.length, totalBytes })
	}

	// Force store when conversation ends
	private _forceStoreIfDirty() {
		if (this._dirtyThreadIds.size === 0) return
		// Cancel pending debounced store
		if (this._pendingStoreTimeout) {
			clearTimeout(this._pendingStoreTimeout)
			this._pendingStoreTimeout = null
		}
		// Store immediately
		this._storeDirtyThreads()
	}


	// RAF-based throttle for _setState to prevent excessive event firing
	private _stateChangeRAF: number | null = null

	// this should be the only place this.state = ... appears besides constructor
	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const t0 = perfNow()
		const newState = {
			...this.state,
			...state
		}

		this.state = newState

		// Use requestAnimationFrame to batch updates and avoid blocking main thread
		if (this._stateChangeRAF) {
			cancelAnimationFrame(this._stateChangeRAF)
		}
		this._stateChangeRAF = requestAnimationFrame(() => {
			this._stateChangeRAF = null
			this._onDidChangeCurrentThread.fire()
		})


		// if we just switched to a thread, update its current stream state if it's not streaming to possibly streaming
		const threadId = newState.currentThreadId
		const streamState = this.streamState[threadId]
		if (streamState?.isRunning === undefined && !streamState?.error) {

			// set streamState
			const messages = newState.allThreads[threadId]?.messages
			const lastMessage = messages && messages[messages.length - 1]
			// if awaiting user but stream state doesn't indicate it (happens if restart SenWeaver)
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'tool_request')
				this._setStreamState(threadId, { isRunning: 'awaiting_user', })

			// if running now but stream state doesn't indicate it (happens if restart SenWeaver), cancel that last tool
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'running_now') {

				this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', content: lastMessage.content, id: lastMessage.id, rawParams: lastMessage.rawParams, result: null, name: lastMessage.name, params: lastMessage.params, mcpServerName: lastMessage.mcpServerName })
			}

		}


		// if we did not just set the state to true, set mount info
		if (doNotRefreshMountInfo) {
			maybePerfLog('_setState (no mount refresh)', perfNow() - t0, {})
			return
		}

		let whenMountedResolver: (w: WhenMounted) => void
		const whenMountedPromise = new Promise<WhenMounted>((res) => whenMountedResolver = res)

		this._setThreadState(threadId, {
			mountedInfo: {
				whenMounted: whenMountedPromise,
				mountedIsResolvedRef: { current: false },
				_whenMountedResolver: (w: WhenMounted) => {
					whenMountedResolver(w)
					const mountInfo = this.state.allThreads[threadId]?.state.mountedInfo
					if (mountInfo) mountInfo.mountedIsResolvedRef.current = true
				},
			}
		}, true) // do not trigger an update
		maybePerfLog('_setState', perfNow() - t0, {})



	}


	// Enhanced throttle for stream state updates to prevent UI blocking during LLM streaming
	private _streamStatePendingRAF = new Map<string, number>()
	private _streamStateLastFireTime = new Map<string, number>()
	private _streamStatePendingTimeout = new Map<string, ReturnType<typeof setTimeout>>()
	private static readonly STREAM_STATE_MIN_INTERVAL = 50 // Minimum 50ms between updates (~20fps)

	private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
		this.streamState[threadId] = state

		const now = Date.now()
		const lastFireTime = this._streamStateLastFireTime.get(threadId) || 0
		const timeSinceLastFire = now - lastFireTime

		// Cancel any pending RAF or timeout for this thread
		const existingRAF = this._streamStatePendingRAF.get(threadId)
		if (existingRAF) {
			cancelAnimationFrame(existingRAF)
			this._streamStatePendingRAF.delete(threadId)
		}

		// If state is undefined (stream ended) or it's been long enough, fire immediately via RAF
		if (!state || timeSinceLastFire >= ChatThreadService.STREAM_STATE_MIN_INTERVAL) {
			// Clear any pending timeout
			const existingTimeout = this._streamStatePendingTimeout.get(threadId)
			if (existingTimeout) {
				clearTimeout(existingTimeout)
				this._streamStatePendingTimeout.delete(threadId)
			}

			const rafId = requestAnimationFrame(() => {
				this._streamStatePendingRAF.delete(threadId)
				this._streamStateLastFireTime.set(threadId, Date.now())
				this._onDidChangeStreamState.fire({ threadId })
			})
			this._streamStatePendingRAF.set(threadId, rafId)
		} else {
			// Otherwise, schedule update for later if not already scheduled
			if (!this._streamStatePendingTimeout.has(threadId)) {
				const delay = ChatThreadService.STREAM_STATE_MIN_INTERVAL - timeSinceLastFire
				const timeoutId = setTimeout(() => {
					this._streamStatePendingTimeout.delete(threadId)
					const rafId = requestAnimationFrame(() => {
						this._streamStatePendingRAF.delete(threadId)
						this._streamStateLastFireTime.set(threadId, Date.now())
						this._onDidChangeStreamState.fire({ threadId })
					})
					this._streamStatePendingRAF.set(threadId, rafId)
				}, delay)
				this._streamStatePendingTimeout.set(threadId, timeoutId)
			}
		}
	}


	// ---------- streaming ----------



	private _currentModelSelectionProps = () => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}



	private _swapOutLatestStreamingToolWithResult = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const messages = this.state.allThreads[threadId]?.messages
		if (!messages) return false
		const lastMsg = messages[messages.length - 1]
		if (!lastMsg) return false

		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			this._editMessageInThread(threadId, messages.length - 1, tool)
			return true
		}
		return false
	}
	private _updateLatestTool = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const swapped = this._swapOutLatestStreamingToolWithResult(threadId, tool)
		if (swapped) return
		this._addMessageToThread(threadId, tool)
	}

	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]
		if (!(lastMsg.role === 'tool' && lastMsg.type === 'tool_request')) return // should never happen

		const callThisToolFirst: ToolMessage<ToolName> = lastMsg

		this._wrapRunAgentToNotify(
			this._runChatAgent({ callThisToolFirst, threadId, ...this._currentModelSelectionProps() })
			, threadId
		)
	}
	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]

		let params: ToolCallParams<ToolName>
		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			params = lastMsg.params
		}
		else return

		const { name, id, rawParams, mcpServerName } = lastMsg

		const errorMessage = this.toolErrMsgs.rejected
		this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', params: params, name: name, content: errorMessage, result: null, id, rawParams, mcpServerName })
		this._setStreamState(threadId, undefined)
	}

	private _computeMCPServerOfToolName = (toolName: string) => {
		return this._mcpService.getMCPTools()?.find(t => t.name === toolName)?.mcpServerName
	}

	async abortRunning(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// add assistant message
		if (this.streamState[threadId]?.isRunning === 'LLM') {
			const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo
			this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
			if (toolCallSoFar) this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name, mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name) })
		}
		// add tool that's running
		else if (this.streamState[threadId]?.isRunning === 'tool') {
			const { toolName, toolParams, id, content: content_, rawParams, mcpServerName } = this.streamState[threadId].toolInfo

			// 对于命令行工具，用户手动停止视为正常完成
			const isCommandTool = toolName === 'run_command' || toolName === 'run_persistent_command'
			if (isCommandTool) {
				// 命令行工具被用户停止，视为正常完成
				const successResult = {
					output: '[Command stopped by user / 用户手动停止命令]',
					resolveReason: { type: 'user_stopped' as const }
				}
				this._updateLatestTool(threadId, { role: 'tool', name: toolName, params: toolParams, id, content: 'Command stopped by user.', rawParams, type: 'success', result: successResult, mcpServerName })
			} else {
				// 其他工具保持原有逻辑
				const content = content_ || this.toolErrMsgs.interrupted
				this._updateLatestTool(threadId, { role: 'tool', name: toolName, params: toolParams, id, content, rawParams, type: 'rejected', result: null, mcpServerName })
			}
		}
		// reject the tool for the user if relevant
		else if (this.streamState[threadId]?.isRunning === 'awaiting_user') {
			this.rejectLatestToolRequest(threadId)
		}
		else if (this.streamState[threadId]?.isRunning === 'idle') {
			// do nothing
		}

		this._addUserCheckpoint({ threadId })

		// interrupt any effects
		const interrupt = await this.streamState[threadId]?.interrupt
		if (typeof interrupt === 'function')
			interrupt()


		this._setStreamState(threadId, undefined)
	}



	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	}


	// private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}


	// returns true when the tool call is waiting for user approval
	private _runToolCall = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		opts: { preapproved: true, unvalidatedToolParams: RawToolParamsObj, validatedParams: ToolCallParams<ToolName> } | { preapproved: false, unvalidatedToolParams: RawToolParamsObj },
	): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> => {
		const traceId = this._getPerfTraceId(threadId)
		const tAll0 = perfNow()

		// compute these below
		let toolParams: ToolCallParams<ToolName>
		let toolResult: ToolResult<ToolName>
		let toolResultStr: string

		// Check if it's a built-in tool
		const isBuiltInTool = isABuiltinToolName(toolName)


		if (!opts.preapproved) { // skip this if pre-approved
			// 1. validate tool params
			const tValidate0 = perfNow()
			try {
				if (isBuiltInTool) {
					const params = this._toolsService.validateParams[toolName](opts.unvalidatedToolParams)
					toolParams = params
				}
				else {
					toolParams = opts.unvalidatedToolParams
				}
			}
			catch (error) {
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', type: 'invalid_params', rawParams: opts.unvalidatedToolParams, result: null, name: toolName, content: errorMessage, id: toolId, mcpServerName })
				return {}
			}
			maybePerfLog('runToolCall validateParams', perfNow() - tValidate0, { threadId, traceId, toolName })

			// Note: Checkpoint is now only added after the entire conversation ends (see line ~908)
			// This prevents the "回退到本轮对话发起前" button from appearing after every file edit
			// if (toolName === 'edit_file') { this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['edit_file']).uri }) }
			// if (toolName === 'rewrite_file') { this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['rewrite_file']).uri }) }

			// 2. if tool requires approval, break from the loop, awaiting approval

			const approvalType = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
			if (approvalType) {
				const autoApprove = this._settingsService.state.globalSettings.autoApprove[approvalType]
				// add a tool_request because we use it for UI if a tool is loading (this should be improved in the future)
				this._addMessageToThread(threadId, { role: 'tool', type: 'tool_request', content: '(Awaiting user permission...)', result: null, name: toolName, params: toolParams, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
				if (!autoApprove) {
					return { awaitingUserApproval: true }
				}
			}
		}
		else {
			toolParams = opts.validatedParams
		}

		// 1.6. 特殊处理 screenshot_to_code 和 analyze_image：自动注入原始图片数据
		// 这个逻辑放在 if-else 之后，确保无论是否预批准都会执行
		// 因为 AI 无法直接传递完整的 base64 图片数据，需要从当前线程的用户消息中获取
		if ((toolName === 'screenshot_to_code' || toolName === 'analyze_image') && isBuiltInTool) {
			const params = toolParams as any;
			const needsImageData = toolName === 'analyze_image' ||
				(toolName === 'screenshot_to_code' && params.source === 'image');

			if (needsImageData) {
				const thread = this.state.allThreads[threadId];
				if (thread) {
					// 从最近的用户消息中获取所有图片
					for (let i = thread.messages.length - 1; i >= 0; i--) {
						const msg = thread.messages[i];
						if (msg.role === 'user' && msg.images && msg.images.length > 0) {
							// 收集所有图片的URL
							const imageUrls: string[] = [];
							for (const img of msg.images) {
								// 优先使用消息中已保存的URL
								if (img.uploadedUrl && img.uploadStatus === 'uploaded') {
									imageUrls.push(img.uploadedUrl);
								} else {
									// 消息快照中没有URL，尝试从当前线程状态获取最新的图片信息
									const currentUploadedImages = thread.state.uploadedImages || [];
									const latestImg = currentUploadedImages.find(u => u.id === img.id);
									if (latestImg?.uploadedUrl && latestImg.uploadStatus === 'uploaded') {
										imageUrls.push(latestImg.uploadedUrl);
										// 同时更新消息中的图片信息（避免下次还要查找）
										img.uploadedUrl = latestImg.uploadedUrl;
										img.uploadStatus = latestImg.uploadStatus;
									} else {
										// 如果还是没有URL，跳过
									}
								}
							}
							// 只传递有效的URL
							if (imageUrls.length > 0) {
								params.image_data = imageUrls.length === 1 ? imageUrls[0] : imageUrls;
							}
							break;
						}
					}
				}
			}
		}

		let toolParamsForMessage = toolParams
		let rawParamsForMessage = opts.unvalidatedToolParams
		if ((toolName === 'screenshot_to_code' || toolName === 'analyze_image') && isBuiltInTool) {
			const redactImageData = (p: any) => {
				if (!p || typeof p !== 'object') return p
				if (typeof p.image_data !== 'string' || p.image_data.length < 2000) return p
				return {
					...p,
					image_data: `[omitted image_data: ${p.image_data.length} chars]`,
				}
			}
			toolParamsForMessage = redactImageData(toolParams as any)
			rawParamsForMessage = redactImageData(opts.unvalidatedToolParams as any)
		}



		// 3. IMPORTANT: Before modifying a file, save its "before" state if this is the first time
		if (toolName === 'edit_file' || toolName === 'rewrite_file' || toolName === 'write_file') {
			const uri = (toolParams as any)?.uri as URI | undefined
			if (uri) {
				const tBefore0 = perfNow()
				await this._ensureFileBeforeStateIsSaved(threadId, uri)
				maybePerfLog('runToolCall ensureFileBeforeState', perfNow() - tBefore0, { threadId, traceId, toolName, fsPath: uri.fsPath })
			}
		}

		// 4. call the tool
		// this._setStreamState(threadId, { isRunning: 'tool' }, 'merge')
		const runningTool = { role: 'tool', type: 'running_now', name: toolName, params: toolParamsForMessage, content: '(value not received yet...)', result: null, id: toolId, rawParams: rawParamsForMessage, mcpServerName } as const
		this._updateLatestTool(threadId, runningTool)
		// 优化：移除 waitNextFrame() 延迟，立即开始工具调用，UI更新可以在工具执行期间异步完成
		// 工具调用本身需要时间，不需要等待UI更新完成


		let interrupted = false
		let resolveInterruptor: (r: () => void) => void = () => { }
		const interruptorPromise = new Promise<() => void>(res => { resolveInterruptor = res })
		try {

			// set stream state
			this._setStreamState(threadId, { isRunning: 'tool', interrupt: interruptorPromise, toolInfo: { toolName, toolParams: toolParamsForMessage, id: toolId, content: 'interrupted...', rawParams: rawParamsForMessage, mcpServerName } })

			if (isBuiltInTool) {
				const tCall0 = perfNow()
				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any)
				const interruptor = () => { interrupted = true; interruptTool?.() }
				resolveInterruptor(interruptor)
				toolResult = await result
				maybePerfLog('runToolCall callTool await', perfNow() - tCall0, { threadId, traceId, toolName })
			}
			else {
				const mcpTools = this._mcpService.getMCPTools()
				const mcpTool = mcpTools?.find(t => t.name === toolName)
				if (!mcpTool) { throw new Error(`MCP tool ${toolName} not found`) }

				resolveInterruptor(() => { })

				toolResult = (await this._mcpService.callMCPTool({
					serverName: mcpTool.mcpServerName ?? 'unknown_mcp_server',
					toolName: toolName,
					params: toolParams
				})).result
			}

			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here
		}
		catch (error) {
			resolveInterruptor(() => { }) // resolve for the sake of it
			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here

			const errorMessage = getErrorMessage(error)
			// 优化：移除 waitNextFrame() 延迟，立即更新错误状态，不阻塞错误处理流程
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
			return {}
		}

		// 4. stringify the result to give to the LLM
		const stringifyStart = perfNow()
		try {
			// 优化：移除 waitIdle() 延迟，直接执行字符串化，不阻塞工具调用完成后的继续流程
			// waitIdle() 最多等待300ms，会严重影响响应速度
			if (isBuiltInTool) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			}
			// For MCP tools, handle the result based on its type
			else {
				toolResultStr = this._mcpService.stringifyResult(toolResult as RawMCPToolCall)
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error)
			// 优化：移除 waitNextFrame() 延迟，立即更新错误状态
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
			return {}
		}
		maybePerfLog('runToolCall stringifyResult', perfNow() - stringifyStart, { threadId, traceId, toolName })

		// 5. add to history and keep going
		// 优化：移除 waitNextFrame() 延迟，立即更新工具结果，让UI异步更新，不阻塞继续流程
		// 使用 setTimeout(0) 将UI更新放到下一个事件循环，但不等待
		this._updateLatestTool(threadId, { role: 'tool', type: 'success', params: toolParams, result: toolResult, name: toolName, content: toolResultStr, id: toolId, rawParams: opts.unvalidatedToolParams, mcpServerName })
		maybePerfLog('runToolCall total', perfNow() - tAll0, { threadId, traceId, toolName })
		return {}
	};




	private async _runChatAgent({
		threadId,
		modelSelection,
		modelSelectionOptions,
		callThisToolFirst,
	}: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,

		callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' }
	}) {
		const traceId = this._getPerfTraceId(threadId)
		const tAgent0 = perfNow()

		// 清理之前的错误状态，确保新消息可以正常发送
		if (this.streamState[threadId]?.error) {
			this._setStreamState(threadId, undefined)
		}

		let interruptedWhenIdle = false
		const idleInterruptor = Promise.resolve(() => { interruptedWhenIdle = true })
		// _runToolCall does not need setStreamState({idle}) before it, but it needs it after it. (handles its own setStreamState)

		// above just defines helpers, below starts the actual function
		const { chatMode } = this._settingsService.state.globalSettings // should not change as we loop even if user changes it, so it goes here
		const { overridesOfModel } = this._settingsService.state

		let nMessagesSent = 0
		let shouldSendAnotherMessage = true
		let isRunningWhenEnd: IsRunningType = undefined

		// before enter loop, call tool
		if (callThisToolFirst) {
			const { interrupted } = await this._runToolCall(threadId, callThisToolFirst.name, callThisToolFirst.id, callThisToolFirst.mcpServerName, { preapproved: true, unvalidatedToolParams: callThisToolFirst.rawParams, validatedParams: callThisToolFirst.params })
			if (interrupted) {
				this._setStreamState(threadId, undefined)
				this._addUserCheckpoint({ threadId })

			}
		}
		this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })  // just decorative, for clarity


		// tool use loop
		while (shouldSendAnotherMessage) {
			const tIter0 = perfNow()
			const tThinkingStart = perfNow() // Thinking 状态开始时间
			// false by default each iteration
			shouldSendAnotherMessage = false
			isRunningWhenEnd = undefined
			nMessagesSent += 1

			// 优化：如果状态还不是LLM（比如第一次循环），立即设置为LLM，让用户看到"Thinking..."状态
			// 如果已经是LLM（比如工具调用完成后设置的），保持LLM状态
			if (this.streamState[threadId]?.isRunning !== 'LLM') {
				this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: idleInterruptor })
			}
			const tAfterSetState = perfNow()
			debugThinkingLog('1. Set Thinking state', tAfterSetState - tThinkingStart, { threadId, nMessagesSent })

			const chatMessages = this.state.allThreads[threadId]?.messages ?? []
			const tAfterGetMessages = perfNow()
			debugThinkingLog('2. Get chat messages', tAfterGetMessages - tAfterSetState, { messageCount: chatMessages.length })

			// 响应式限流：不预等待，只检查是否在 429 错误冷却期内
			// 宁可偶尔触发 429 重试，也不要让用户长时间等待
			const tBeforeTPMCheck = perfNow()
			let tpmCooldownWait = 0
			if (modelSelection) {
				// 只检查是否在 429 错误冷却期内，不进行预测式限流
				tpmCooldownWait = tpmRateLimiter.getWaitTime(modelSelection.providerName, 0)
				if (tpmCooldownWait > 0) {
					await timeout(tpmCooldownWait)
				}
				// 记录请求开始
				tpmRateLimiter.recordRequestStart(modelSelection.providerName)
			}
			const tAfterTPMCheck = perfNow()
			if (tpmCooldownWait > 100) {
				debugThinkingLog('3. TPM cooldown wait', tAfterTPMCheck - tBeforeTPMCheck, { cooldownWait: `${(tpmCooldownWait / 1000).toFixed(2)}s` })
			}

			// 准备 LLM 消息（不再有预等待，直接执行）
			const tPrep0 = perfNow()
			let prepResult: { messages: any, separateSystemMessage: string | undefined }

			try {
				prepResult = await this._convertToLLMMessagesService.prepareLLMChatMessages({
					chatMessages,
					modelSelection,
					chatMode
				})
				const prepTime = perfNow() - tPrep0
				debugThinkingLog('3. Prepare LLM messages', prepTime, {
					chatMessages: chatMessages.length,
					slow: prepTime > 1000 ? '⚠️ SLOW' : 'OK'
				})
				maybePerfLog('runChatAgent prepareLLMChatMessages', prepTime, { threadId, traceId, nMessagesSent, chatMode, chatMessages: chatMessages.length })
			} catch (error) {
				// 如果失败，尝试重试一次
				try {
					prepResult = await this._convertToLLMMessagesService.prepareLLMChatMessages({
						chatMessages,
						modelSelection,
						chatMode
					})
				} catch (retryError) {
					// 如果重试也失败，设置错误状态
					this._setStreamState(threadId, { isRunning: undefined, error: { message: 'Failed to prepare messages. Please try again.', fullError: retryError instanceof Error ? retryError : null } })
					return
				}
			}
			const { messages, separateSystemMessage } = prepResult

			if (interruptedWhenIdle) {
				this._setStreamState(threadId, undefined)
				return
			}

			let shouldRetryLLM = true
			let nAttempts = 0
			while (shouldRetryLLM) {
				shouldRetryLLM = false
				nAttempts += 1

				// 响应式限流：不预等待，如果收到 429 错误会在重试时处理
				// 只在重试时检查是否在冷却期内
				if (nAttempts > 1 && modelSelection) {
					const cooldownWait = tpmRateLimiter.getWaitTime(modelSelection.providerName, 0)
					if (cooldownWait > 0) {
						debugThinkingLog('4. Rate limit cooldown (retry)', cooldownWait, { attempt: nAttempts })
						await timeout(cooldownWait)
						if (interruptedWhenIdle) {
							this._setStreamState(threadId, undefined)
							return
						}
					}
				}

				type ResTypes =
					| { type: 'llmDone', toolCall?: RawToolCallObj, info: { fullText: string, fullReasoning: string, anthropicReasoning: AnthropicReasoning[] | null } }
					| { type: 'llmError', error?: { message: string; fullError: Error | null; } }
					| { type: 'llmAborted' }

				let resMessageIsDonePromise: (res: ResTypes) => void // resolves when user approves this tool use (or if tool doesn't require approval)
				const messageIsDonePromise = new Promise<ResTypes>((res, rej) => { resMessageIsDonePromise = res })

				const tBeforeSendLLM = perfNow()
				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					chatMode,
					messages: messages,
					modelSelection,
					modelSelectionOptions,
					overridesOfModel,
					logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
					separateSystemMessage: separateSystemMessage,
					onText: ({ fullText, fullReasoning, toolCall }) => {
						const tOnText = perfNow()
						if (tOnText - tBeforeSendLLM < 100) {
							// 第一次收到文本，记录 LLM 开始响应的时间
							debugThinkingLog('6. LLM started responding', tOnText - tBeforeSendLLM, { attempt: nAttempts })
						}
						this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: fullText, reasoningSoFar: fullReasoning, toolCallSoFar: toolCall ?? null }, interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken) }) })
					},
					onFinalMessage: async ({ fullText, fullReasoning, toolCall, anthropicReasoning, }) => {
						resMessageIsDonePromise({ type: 'llmDone', toolCall, info: { fullText, fullReasoning, anthropicReasoning } }) // resolve with tool calls
					},
					onError: async (error) => {
						resMessageIsDonePromise({ type: 'llmError', error: error })
					},
					onAbort: () => {
						// stop the loop to free up the promise, but don't modify state (already handled by whatever stopped it)
						resMessageIsDonePromise({ type: 'llmAborted' })
						this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode })
					},
				})
				const tAfterSendLLM = perfNow()
				debugThinkingLog('6. Send LLM request', tAfterSendLLM - tBeforeSendLLM, { attempt: nAttempts, hasCancelToken: !!llmCancelToken })

				// mark as streaming
				if (!llmCancelToken) {
					this._setStreamState(threadId, { isRunning: undefined, error: { message: 'There was an unexpected error when sending your chat message.', fullError: null } })
					break
				}

				this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: Promise.resolve(() => this._llmMessageService.abort(llmCancelToken)) })
				const tLLM0 = perfNow()

				// 添加超时检测，如果LLM响应超过30秒没有开始，清理超时
				const LLM_START_TIMEOUT = 30000 // 30秒
				const llmStartTimeoutId = setTimeout(() => {
					// 超时仅用于清理，不输出日志
				}, LLM_START_TIMEOUT)

				const tBeforeWaitLLM = perfNow()
				const llmRes = await messageIsDonePromise // wait for message to complete
				clearTimeout(llmStartTimeoutId)
				const tAfterWaitLLM = perfNow()

				const llmWaitTime = perfNow() - tLLM0
				const llmResponseTime = tAfterWaitLLM - tBeforeWaitLLM
				debugThinkingLog('7. Wait for LLM response', llmResponseTime, {
					attempt: nAttempts,
					totalTime: `${(llmWaitTime / 1000).toFixed(2)}s`,
					resultType: llmRes.type,
					slow: llmWaitTime > 10000 ? '⚠️ SLOW' : 'OK'
				})
				maybePerfLog('runChatAgent waitLLMFinal', llmWaitTime, { threadId, traceId, nMessagesSent, chatMode })

				// if something else started running in the meantime
				if (this.streamState[threadId]?.isRunning !== 'LLM') {
					return
				}

				// llm res aborted
				if (llmRes.type === 'llmAborted') {
					// 优化：检测是否有未完成的任务，如果有则自动继续，而不是直接返回
					const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId]?.llmInfo ?? {}

					// 如果有未完成的工具调用，自动继续执行
					if (toolCallSoFar) {
						// 保存当前部分内容
						if (displayContentSoFar || reasoningSoFar) {
							this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar || '', reasoning: reasoningSoFar || '', anthropicReasoning: null })
						}
						// 自动继续执行工具调用
						const mcpTools = this._mcpService.getMCPTools()
						const mcpTool = mcpTools?.find(t => t.name === toolCallSoFar.name)

						const tTool0 = perfNow()
						const { awaitingUserApproval, interrupted } = await this._runToolCall(threadId, toolCallSoFar.name, toolCallSoFar.id, mcpTool?.mcpServerName, { preapproved: false, unvalidatedToolParams: toolCallSoFar.rawParams })
						maybePerfLog('runChatAgent runToolCall (auto-continue)', perfNow() - tTool0, { threadId, traceId, toolName: toolCallSoFar.name })

						if (interrupted) {
							this._setStreamState(threadId, undefined)
							return
						}
						if (awaitingUserApproval) {
							isRunningWhenEnd = 'awaiting_user'
							this._setStreamState(threadId, { isRunning: 'awaiting_user' })
						} else {
							shouldSendAnotherMessage = true
							// 继续循环，自动发送下一次LLM消息
							this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: idleInterruptor })
						}
						// 继续循环，不返回
						continue
					}

					// 如果有部分内容但没有工具调用，保存内容并结束
					if (displayContentSoFar || reasoningSoFar) {
						this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar || '', reasoning: reasoningSoFar || '', anthropicReasoning: null })
					}

					this._setStreamState(threadId, undefined)
					this._addUserCheckpoint({ threadId })
					return
				}
				// llm res error
				else if (llmRes.type === 'llmError') {
					const { error } = llmRes
					const isRateLimitError = tpmRateLimiter.isRateLimitError(error)

					// 检测 context length 超限错误 (400: maximum context length exceeded)
					const fullErrorStr = JSON.stringify(error).toLowerCase()
					const isContextLengthError = fullErrorStr.includes('context_length') ||
						fullErrorStr.includes('context length') ||
						fullErrorStr.includes('maximum context') ||
						fullErrorStr.includes('token limit') ||
						fullErrorStr.includes('too many tokens') ||
						fullErrorStr.includes('max_tokens') ||
						fullErrorStr.includes('input is too long') ||
						(fullErrorStr.includes('400') && (fullErrorStr.includes('token') || fullErrorStr.includes('length')))

					// Context Length 错误：积极裁剪上下文后重试
					if (isContextLengthError) {
						console.warn('[ChatThread] Context length exceeded, aggressively pruning and retrying...')

						// 强制执行积极裁剪：清除所有非最近轮次的工具输出
						const toolMessages = chatMessages.filter(m => m.role === 'tool')
						for (const toolMsg of toolMessages) {
							if (!enhancedContextManager.isToolPruned(toolMsg.id)) {
								enhancedContextManager['compactionState'].prunedToolIds.add(toolMsg.id)
							}
						}

						// 最多重试 2 次 context length 错误
						if (nAttempts <= 2) {
							shouldRetryLLM = true
							// 重新准备消息（这次裁剪过的工具输出会被替换为摘要）
							try {
								prepResult = await this._convertToLLMMessagesService.prepareLLMChatMessages({
									chatMessages,
									modelSelection,
									chatMode
								})
							} catch (retryError) {
								this._setStreamState(threadId, { isRunning: undefined, error: { message: 'Context too large even after pruning. Please start a new conversation.', fullError: retryError instanceof Error ? retryError : null } })
								return
							}

							this._setStreamState(threadId, {
								isRunning: 'LLM',
								llmInfo: {
									displayContentSoFar: this.streamState[threadId]?.llmInfo?.displayContentSoFar || '',
									reasoningSoFar: (this.streamState[threadId]?.llmInfo?.reasoningSoFar || '') + `\n[Context too large, compressing history and retrying...]`,
									toolCallSoFar: null
								},
								interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken) })
							})
							continue // 用裁剪后的消息重试
						}
						else {
							// 裁剪后仍然超限，提示用户开始新对话
							this._setStreamState(threadId, {
								isRunning: undefined,
								error: { message: 'The conversation context is too large. Please start a new conversation or reduce the number of selected files/folders.', fullError: error instanceof Error ? error : null }
							})
							this._addUserCheckpoint({ threadId })
							return
						}
					}

					// 响应式限流：只在收到 429 错误时才进行限流
					if (isRateLimitError && modelSelection) {
						// 使用新的 handleRateLimitError 方法，它会从 API 响应中提取 retry-after
						const waitTime = tpmRateLimiter.handleRateLimitError(modelSelection.providerName, error)

						shouldRetryLLM = true
						// 保持 LLM 运行状态，给用户"正在思考"的感觉
						this._setStreamState(threadId, {
							isRunning: 'LLM',
							llmInfo: {
								displayContentSoFar: this.streamState[threadId]?.llmInfo?.displayContentSoFar || '',
								reasoningSoFar: (this.streamState[threadId]?.llmInfo?.reasoningSoFar || '') + `\n[API rate limit, retrying in ${(waitTime / 1000).toFixed(0)}s...]`,
								toolCallSoFar: null
							},
							interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken) })
						})

						await timeout(waitTime)

						if (interruptedWhenIdle) {
							this._setStreamState(threadId, undefined)
							return
						}
						// 重置尝试次数，允许无限重试 rate limit 错误
						nAttempts = Math.max(0, nAttempts - 1)
						continue // 静默重试
					}

					// 非 rate limit 错误：使用原有逻辑
					if (nAttempts < CHAT_RETRIES) {
						shouldRetryLLM = true
						this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor })

						const retryDelay = getRetryDelay(nAttempts, false)
						await timeout(retryDelay)
						if (interruptedWhenIdle) {
							this._setStreamState(threadId, undefined)
							return
						}
						else
							continue // retry
					}
					// error, but too many attempts
					else {
						const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo
						this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
						if (toolCallSoFar) this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name, mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name) })

						this._setStreamState(threadId, { isRunning: undefined, error: error })
						this._addUserCheckpoint({ threadId })
						return
					}
				}

				// llm res success
				const tBeforeProcessSuccess = perfNow()
				const { toolCall, info } = llmRes

				// 记录成功请求（重置 rate limit 错误计数）
				if (modelSelection) {
					tpmRateLimiter.recordSuccess(modelSelection.providerName)
				}

				this._addMessageToThread(threadId, { role: 'assistant', displayContent: info.fullText, reasoning: info.fullReasoning, anthropicReasoning: info.anthropicReasoning })
				const tAfterAddMessage = perfNow()
				debugThinkingLog('8. Process LLM success & add message', tAfterAddMessage - tBeforeProcessSuccess, {
					hasToolCall: !!toolCall,
					textLength: info.fullText.length,
					reasoningLength: info.fullReasoning?.length || 0
				})

				this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' }) // just decorative for clarity

				// call tool if there is one
				if (toolCall) {
					debugThinkingLog('9. Starting tool call', 0, { toolName: toolCall.name, toolId: toolCall.id })
					const mcpTools = this._mcpService.getMCPTools()
					const mcpTool = mcpTools?.find(t => t.name === toolCall.name)

					// 优化：在工具调用执行时并行预热系统消息和目录字符串缓存
					// 在工具执行期间就开始准备下一次可能需要的资源
					// 系统消息和目录字符串的获取可以并行执行，不依赖于工具结果
					const systemMessageWarmupPromise = (async () => {
						try {
							// 预热系统消息生成（会使用缓存，但确保缓存已加载）
							const { providerName, modelName } = modelSelection || { providerName: null, modelName: null }
							if (providerName && modelName) {
								// 触发系统消息生成（会使用缓存），但不等待结果
								this._convertToLLMMessagesService.prepareLLMChatMessages({
									chatMessages: chatMessages.slice(-1), // 只使用最后一条消息来触发系统消息生成
									modelSelection,
									chatMode
								}).catch(() => { }) // 忽略错误，这只是预热
							}
						} catch (error) {
							// 忽略预热错误
						}
					})()

					const tTool0 = perfNow()
					// 优化：工具调用和系统消息预热并行执行
					const [toolCallResult, _] = await Promise.all([
						this._runToolCall(threadId, toolCall.name, toolCall.id, mcpTool?.mcpServerName, { preapproved: false, unvalidatedToolParams: toolCall.rawParams }),
						systemMessageWarmupPromise // 并行预热，不阻塞工具调用
					])
					const { awaitingUserApproval, interrupted } = toolCallResult
					const tAfterToolCall = perfNow()
					const toolCallTime = tAfterToolCall - tTool0
					debugThinkingLog('9. Tool call completed', toolCallTime, {
						toolName: toolCall.name,
						awaitingUserApproval,
						interrupted
					})
					maybePerfLog('runChatAgent runToolCall', toolCallTime, { threadId, traceId, toolName: toolCall.name })
					if (interrupted) {
						this._setStreamState(threadId, undefined)
						return
					}
					if (awaitingUserApproval) {
						isRunningWhenEnd = 'awaiting_user'
						this._setStreamState(threadId, { isRunning: 'awaiting_user' })
					}
					else {
						shouldSendAnotherMessage = true
						// 优化：工具调用完成后，立即设置状态为LLM，让用户看到"Thinking..."状态，而不是等待
						// 这样用户能立即感知到系统正在处理，而不是感觉卡住了
						this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: idleInterruptor })
					}
				} else {
					// 没有工具调用，Thinking 状态结束
					const tThinkingEnd = perfNow()
					const totalThinkingTime = tThinkingEnd - tThinkingStart
					debugThinkingLog('✅ Thinking completed (no tool call)', totalThinkingTime, {
						totalTime: `${(totalThinkingTime / 1000).toFixed(2)}s`,
						nMessagesSent
					})
				}

			} // end while (attempts)
			const tIterEnd = perfNow()
			const iterationTime = tIterEnd - tIter0
			debugThinkingLog('📊 Iteration summary', iterationTime, {
				nMessagesSent,
				nAttempts,
				totalTime: `${(iterationTime / 1000).toFixed(2)}s`
			})
			maybePerfLog('runChatAgent iteration', iterationTime, { threadId, traceId, nMessagesSent, chatMode })
		} // end while (send message)

		// if awaiting user approval, keep isRunning true, else end isRunning
		const tFinalize0 = perfNow()
		this._setStreamState(threadId, { isRunning: isRunningWhenEnd })

		// add checkpoint before the next user message
		if (!isRunningWhenEnd) this._addUserCheckpoint({ threadId })

		// capture number of messages sent
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode })
		maybePerfLog('runChatAgent finalize', perfNow() - tFinalize0, { nMessagesSent, isRunningWhenEnd })
		maybePerfLog('runChatAgent total', perfNow() - tAgent0, { threadId, traceId, nMessagesSent, chatMode })

		// Post-conversation heartbeat to detect UI blocking after conversation ends
		if (!isRunningWhenEnd) {
			const tConvEnd = perfNow()
			// Use existing heartbeat scheduler for post-conversation monitoring
			schedulePerfHeartbeats('postConversation', { threadId, traceId })
			// Additional delayed heartbeats for longer-term blocking detection
			setTimeout(() => {
				maybePerfLog('postConversation heartbeat:t100', perfNow() - tConvEnd - 100, { threadId, traceId, drift: perfNow() - tConvEnd - 100 })
			}, 100)
			setTimeout(() => {
				maybePerfLog('postConversation heartbeat:t500', perfNow() - tConvEnd - 500, { threadId, traceId, drift: perfNow() - tConvEnd - 500 })
			}, 500)
			// Force store dirty data after conversation ends (deferred during conversation)
			this._forceStoreIfDirty()
			// Clear trace at the end of a full conversation (avoid leaking state)
			this._clearPerfTraceId(threadId)
		}
	}


	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {

		// 在实际添加前再次检查，防止竞态条件导致的重复 checkpoint
		const thread = this.state.allThreads[threadId]
		if (thread && thread.messages.length > 0) {
			// 查找最近的 checkpoint
			let lastCheckpointIndex = -1
			for (let i = thread.messages.length - 1; i >= 0; i--) {
				if (thread.messages[i].role === 'checkpoint') {
					lastCheckpointIndex = i
					break
				}
			}

			if (lastCheckpointIndex >= 0) {
				// 检查最后一个 checkpoint 之后是否有真正的用户或AI消息
				const messagesSinceCheckpoint = thread.messages.slice(lastCheckpointIndex + 1)

				// 只有真正的用户消息才算数，排除 continuation 请求
				const hasRealUserMessages = messagesSinceCheckpoint.some(msg => {
					if (msg.role === 'user') {
						// 检查是否是 continuation 请求
						let content = ''
						try {
							if (typeof msg.content === 'string') {
								content = msg.content
							} else if (msg.content && Array.isArray(msg.content)) {
								content = (msg.content as any[]).map((c: any) => typeof c === 'string' ? c : (c?.text || '')).join('')
							} else {
								content = String(msg.content || '')
							}
						} catch (e) {
							content = ''
						}


						// 如果包含自动生成的内容，则不算真正的用户消息
						const isContinuation = content.includes('Requesting UI') ||
							content.includes('continuation request') ||
							content.includes('馃摛') ||
							content.includes('继续设计剩余的UI页面') ||
							content.includes('**当前进度**') ||
							content.includes('DESIGN_INCOMPLETE') ||
							content.includes('[SYSTEM_AUTO_NAVIGATION_PLANNING]') ||
							content.includes('你是一个UI/UX专家和前端开发专家') ||
							content.includes('现在开始分析并返回导航规划') ||
							content.trim() === '' ||
							content.includes('Generate more UI')


						return !isContinuation
					}
					return msg.role === 'assistant'
				})


				if (!hasRealUserMessages) {
					return
				}
			}
		}

		this._addMessageToThread(threadId, checkpoint)
	}



	private _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage,) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		const newMessages = oldThread.messages.slice()
		newMessages[messageIdx] = newMessage
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: newMessages,
			}
		}
		this._storeAllThreads(newThreads, threadId)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}


	private _getCheckpointInfo = (checkpointMessage: ChatMessage & { role: 'checkpoint' }, fsPath: string, opts: { includeUserModifiedChanges: boolean }) => {
		const senweaverFileSnapshot = checkpointMessage.senweaverFileSnapshotOfURI ? checkpointMessage.senweaverFileSnapshotOfURI[fsPath] ?? null : null
		if (!opts.includeUserModifiedChanges) { return { senweaverFileSnapshot, } }

		const userModifiedSenweaverFileSnapshot = fsPath in checkpointMessage.userModifications.senweaverFileSnapshotOfURI ? checkpointMessage.userModifications.senweaverFileSnapshotOfURI[fsPath] ?? null : null
		return { senweaverFileSnapshot: userModifiedSenweaverFileSnapshot ?? senweaverFileSnapshot, }
	}

	private async _ensureFileBeforeStateIsSaved(threadId: string, uri: URI) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const fsPath = uri.fsPath

		// Use cache to avoid O(n) message scan (fixes 6.8s blocking!)
		let cachedFiles = this._filesInCheckpointCache.get(threadId)
		if (!cachedFiles) {
			// Build cache on first access for this thread
			cachedFiles = new Set<string>()
			for (const message of thread.messages) {
				if (message.role === 'checkpoint') {
					for (const path of Object.keys(message.senweaverFileSnapshotOfURI)) {
						cachedFiles.add(path)
					}
				}
			}
			this._filesInCheckpointCache.set(threadId, cachedFiles)
		}

		// Fast O(1) lookup instead of O(n) scan
		if (cachedFiles.has(fsPath)) {
			return // Already saved in checkpoint
		}

		// This file has never been saved in any checkpoint
		// We need to save its current state to the first checkpoint (checkpoint 0)
		const firstCheckpointIdx = thread.messages.findIndex(m => m.role === 'checkpoint')
		if (firstCheckpointIdx >= 0) {
			const firstCheckpoint = thread.messages[firstCheckpointIdx]
			if (firstCheckpoint.role === 'checkpoint') {
				// Try to get the file's state from disk (true "before" state)
				// This is more reliable than getting it from the model which may already be modified
				try {
					// First, check if file exists on disk
					const fileExists = await this._fileService.exists(uri)
					if (fileExists) {
						// Read the original file content from disk
						const fileContent = await this._fileService.readFile(uri)
						const originalContent = fileContent.value.toString()

						// Create a snapshot with the original content and no diff areas
						const senweaverFileSnapshot: SenweaverFileSnapshot = {
							snapshottedDiffAreaOfId: {}, // No diff areas in the original state
							entireFileCode: originalContent
						}

						firstCheckpoint.senweaverFileSnapshotOfURI[fsPath] = senweaverFileSnapshot
					} else {
						// File doesn't exist on disk yet (will be created by tool)
						// Save an empty snapshot to indicate file didn't exist
						const senweaverFileSnapshot: SenweaverFileSnapshot = {
							snapshottedDiffAreaOfId: {},
							entireFileCode: '' // Empty indicates file didn't exist
						}
						firstCheckpoint.senweaverFileSnapshotOfURI[fsPath] = senweaverFileSnapshot
					}
					// Update cache
					cachedFiles.add(fsPath)
				} catch (error) {
					// Fallback: use current model state (better than nothing)
					const { model } = this._senweaverModelService.getModelFromFsPath(fsPath)
					if (model) {
						const senweaverFileSnapshot = this._editCodeService.getSenweaverFileSnapshot(uri)
						firstCheckpoint.senweaverFileSnapshotOfURI[fsPath] = senweaverFileSnapshot
						cachedFiles.add(fsPath)
					} else {
						console.error('[ensureFileBeforeState] CRITICAL: Cannot save before state - no disk file and no model')
					}
				}
			}
		}
	}

	private _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const t0 = perfNow()

		const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1
		if (lastCheckpointIdx === -1) return

		const senweaverFileSnapshotOfURI: { [fsPath: string]: SenweaverFileSnapshot | undefined } = {}

		// Collect all files that have been modified since the last checkpoint
		// This includes both files in checkpoint history and newly created/modified files
		const filesInCheckpointHistory = new Set<string>()

		// 1. Add changes for all URIs in the checkpoint history
		const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx, }) ?? {}
		let nCheckpointFiles = 0
		let nToolMessagesScanned = 0
		let nToolFilesCaptured = 0
		for (const fsPath in lastIdxOfURI ?? {}) {
			filesInCheckpointHistory.add(fsPath)
			nCheckpointFiles++
			const { model } = this._senweaverModelService.getModelFromFsPath(fsPath)
			if (!model) continue
			const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null
			if (!checkpoint2) continue
			if (checkpoint2.role !== 'checkpoint') continue
			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false })
			if (!res) continue
			const { senweaverFileSnapshot: oldSenweaverFileSnapshot } = res

			// if there was any change to the str or diffAreaSnapshot, update
			const senweaverFileSnapshot = this._editCodeService.getSenweaverFileSnapshot(URI.file(fsPath))
			if (oldSenweaverFileSnapshot === senweaverFileSnapshot) continue
			senweaverFileSnapshotOfURI[fsPath] = senweaverFileSnapshot
		}

		// 2. Check all tool messages since last checkpoint for newly created/modified files
		// This captures files that were created or modified in this conversation round
		for (let i = lastCheckpointIdx + 1; i < thread.messages.length; i++) {
			const message = thread.messages[i]
			nToolMessagesScanned++
			if (message.role !== 'tool' || message.type !== 'success') continue

			// Check if this tool modified a file
			let uri: URI | undefined
			if (message.name === 'edit_file' || message.name === 'rewrite_file') {
				uri = (message.params as any)?.uri
			} else if (message.name === 'write_file') {
				uri = (message.params as any)?.uri
			}

			if (uri) {
				const fsPath = uri.fsPath
				// Skip if already processed
				if (fsPath in senweaverFileSnapshotOfURI || filesInCheckpointHistory.has(fsPath)) continue

				// This file was modified but not in checkpoint history
				// We need to save its current state
				const { model } = this._senweaverModelService.getModelFromFsPath(fsPath)
				if (!model) continue
				const senweaverFileSnapshot = this._editCodeService.getSenweaverFileSnapshot(uri)
				senweaverFileSnapshotOfURI[fsPath] = senweaverFileSnapshot
				nToolFilesCaptured++

				// IMPORTANT: Also check if this file needs its "before" state saved
				// If this file has never appeared in any checkpoint, we need to save its state
				// BEFORE the first modification in the lastCheckpoint
				const fileExistsInAnyCheckpoint = filesInCheckpointHistory.has(fsPath)
				if (!fileExistsInAnyCheckpoint && lastCheckpointIdx >= 0) {
					// This file was modified for the first time in this conversation
					// We need to retroactively add its "before" state to the last checkpoint
					const lastCheckpoint = thread.messages[lastCheckpointIdx]
					if (lastCheckpoint && lastCheckpoint.role === 'checkpoint') {
						// Find the state of this file BEFORE the first tool modified it
						// We need to look at the tool message that first modified this file
						for (let j = lastCheckpointIdx + 1; j < thread.messages.length; j++) {
							const toolMsg = thread.messages[j]
							if (toolMsg.role !== 'tool' || toolMsg.type !== 'success') continue

							let toolUri: URI | undefined
							if (toolMsg.name === 'edit_file' || toolMsg.name === 'rewrite_file' || toolMsg.name === 'write_file') {
								toolUri = (toolMsg.params as any)?.uri
							}

							if (toolUri && toolUri.fsPath === fsPath) {
								// This is the first tool that modified this file
								// The "before" state should be captured here
								// But we can't retroactively change the checkpoint
								// So we'll handle this in the jump logic instead
								break
							}
						}
					}
				}
			}
		}

		const t1 = perfNow()
		maybePerfLog('_computeNewCheckpointInfo', t1 - t0, {
			messages: thread.messages.length,
			lastCheckpointIdx,
			nCheckpointFiles,
			nToolMessagesScanned,
			nToolFilesCaptured,
			outFiles: Object.keys(senweaverFileSnapshotOfURI).length,
		})
		return { senweaverFileSnapshotOfURI }
	}


	private _addUserCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) {
			return
		}
		const t0 = perfNow()
		const traceId = this._getPerfTraceId(threadId)
		const beforeLen = thread.messages.length

		// 检查是否存在连续的 checkpoint（中间没有真正的用户或AI消息）
		// 从后往前查找最近的 checkpoint
		let lastCheckpointIndex = -1
		for (let i = thread.messages.length - 1; i >= 0; i--) {
			if (thread.messages[i].role === 'checkpoint') {
				lastCheckpointIndex = i
				break
			}
		}

		if (lastCheckpointIndex >= 0) {
			// 检查最后一个 checkpoint 之后是否有真正的用户或AI消息
			const messagesSinceCheckpoint = thread.messages.slice(lastCheckpointIndex + 1)

			// 检查是否有真正的用户消息和有效的AI输出
			const hasRealUserMessages = messagesSinceCheckpoint.some(msg => {
				if (msg.role === 'user') {
					// 检查是否是 continuation 请求
					let content = ''
					try {
						if (typeof msg.content === 'string') {
							content = msg.content
						} else if (msg.content && Array.isArray(msg.content)) {
							content = (msg.content as any[]).map((c: any) => typeof c === 'string' ? c : (c?.text || '')).join('')
						} else {
							content = String(msg.content || '')
						}
					} catch (e) {
						content = ''
					}

					// 如果包含自动生成的内容，则不算真正的用户消息
					const isContinuation = content.includes('Requesting UI') ||
						content.includes('continuation request') ||
						content.includes('馃摛') ||
						content.includes('继续设计剩余的UI页面') ||
						content.includes('**当前进度**') ||
						content.includes('DESIGN_INCOMPLETE') ||
						content.includes('[SYSTEM_AUTO_NAVIGATION_PLANNING]') ||
						content.includes('你是一个UI/UX专家和前端开发专家') ||
						content.includes('现在开始分析并返回导航规划') ||
						content.trim() === '' ||
						content.includes('Generate more UI')

					return !isContinuation
				}
				return msg.role === 'assistant'
			})

			// 检查是否有有效的输出（工具调用、设计输出或任何assistant响应）
			const hasValidOutput = messagesSinceCheckpoint.some(msg => {
				// 工具调用（edit_file, rewrite_file 等）算作有效输出
				if (msg.role === 'tool' && (msg.type === 'success' || msg.type === 'running_now')) {
					return true
				}
				// assistant 消息算作有效输出
				if (msg.role === 'assistant') {
					return true
				}
				return false
			})

			// 只有当既有真正的用户消息，又有有效的输出时，才创建新的checkpoint
			if (!hasRealUserMessages || !hasValidOutput) {
				return
			}
		}

		const result = this._computeNewCheckpointInfo({ threadId })
		const senweaverFileSnapshotOfURI = result?.senweaverFileSnapshotOfURI ?? {}

		// Note: The "before" state saving is now handled by _ensureFileBeforeStateIsSaved
		// which is called before each file modification in _runToolCall
		// This ensures we always have the original disk state saved before any modifications

		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			senweaverFileSnapshotOfURI: senweaverFileSnapshotOfURI,
			userModifications: { senweaverFileSnapshotOfURI: {}, },
		})
		const afterLen = this.state.allThreads[threadId]?.messages.length ?? beforeLen
		maybePerfLog('_addUserCheckpoint', perfNow() - t0, { messages: thread.messages.length, files: Object.keys(senweaverFileSnapshotOfURI).length })
		if (afterLen > beforeLen) {
			// Heartbeats after checkpoint creation: helps identify what blocks the UI *after* checkpoint is added
			schedulePerfHeartbeats('after checkpoint', { threadId, traceId, checkpointMsgIdx: afterLen - 1 })
		}
	}
	// No longer used - checkpoints are now only added after entire conversation ends
	// private _addToolEditCheckpoint({ threadId, uri, }: { threadId: string, uri: URI }) {
	// 	const thread = this.state.allThreads[threadId]
	// 	if (!thread) return
	// 	const { model } = this._senweaverModelService.getModel(uri)
	// 	if (!model) return // should never happen
	// 	const diffAreasSnapshot = this._editCodeService.getSenweaverFileSnapshot(uri)
	// 	this._addCheckpoint(threadId, {
	// 		role: 'checkpoint',
	// 		type: 'tool_edit',
	// 		senweaverFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
	// 		userModifications: { senweaverFileSnapshotOfURI: {} },
	// 	})
	// }


	private _getCheckpointBeforeMessage = ({ threadId, messageIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined
		for (let i = messageIdx; i >= 0; i--) {
			const message = thread.messages[i]
			if (message.role === 'checkpoint') {
				return [message, i]
			}
		}
		return undefined
	}

	private _getCheckpointsBetween({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return { lastIdxOfURI: {} } // should never happen
		const lastIdxOfURI: { [fsPath: string]: number } = {}
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i]
			if (message?.role !== 'checkpoint') continue
			for (const fsPath in message.senweaverFileSnapshotOfURI) { // do not include userModified.beforeStrOfURI here, jumping should not include those changes
				lastIdxOfURI[fsPath] = i
			}
		}
		return { lastIdxOfURI }
	}

	private _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const { currCheckpointIdx } = thread.state
		if (currCheckpointIdx === null) return

		const checkpoint = thread.messages[currCheckpointIdx]
		if (!checkpoint) return
		if (checkpoint.role !== 'checkpoint') return
		return [checkpoint, currCheckpointIdx]
	}
	private _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
		const { senweaverFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		const res = this._readCurrentCheckpoint(threadId)
		if (!res) return
		const [checkpoint, checkpointIdx] = res
		this._editMessageInThread(threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { senweaverFileSnapshotOfURI: senweaverFileSnapshotOfURI ?? {}, },
		})
	}


	private _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (thread.state.currCheckpointIdx === null) {
			const lastMsg = thread.messages[thread.messages.length - 1]
			if (lastMsg?.role !== 'checkpoint')
				this._addUserCheckpoint({ threadId })
			this._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 })
		}
	}

	async jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified }: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {

		// Concurrency control: prevent multiple simultaneous jump operations on the same thread
		if (this._jumpOperationInProgress.has(threadId)) {
			this._notificationService.notify({
				severity: Severity.Warning,
				message: 'A checkpoint jump is already in progress. Please wait for it to complete.'
			})
			return
		}

		// Mark this thread as having a jump operation in progress
		this._jumpOperationInProgress.add(threadId)

		try {
			// if null, add a new temp checkpoint so user can jump forward again
			this._makeUsStandOnCheckpoint({ threadId })

			const thread = this.state.allThreads[threadId]
			if (!thread) {
				return
			}
			if (this.streamState[threadId]?.isRunning) {
				return
			}

			const c = this._getCheckpointBeforeMessage({ threadId, messageIdx })
			if (c === undefined) {
				return // should never happen
			}

			const fromIdx = thread.state.currCheckpointIdx
			if (fromIdx === null) {
				return // should never happen
			}

			const [_, toIdx] = c
			if (toIdx === fromIdx) {
				return
			}

			// update the user's checkpoint
			this._addUserModificationsToCurrCheckpoint({ threadId })

			// Create backup snapshots for transactional rollback support
			const backupSnapshots = new Map<string, SenweaverFileSnapshot>()
			const filesToRestore = new Set<string>()

			/*
	if undoing

	A,B,C are all files.
	x means a checkpoint where the file changed.

	A B C D E F G H I
		x x x x x   x           <-- you can't always go up to find the "before" version; sometimes you need to go down
		| | | | |   | x
	--x-|-|-|-x---x-|-----     <-- to
		| | | | x   x
		| | x x |
		| |   | |
	----x-|---x-x-------     <-- from
			x

	We need to revert anything that happened between to+1 and from.
	**We do this by finding the last x from 0...`to` for each file and applying those contents.**
	We only need to do it for files that were edited since `to`, ie files between to+1...from.
	*/
			if (toIdx < fromIdx) {
				const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx })
				for (const fsPath in lastIdxOfURI) {
					try {
						const uri = URI.file(fsPath)
						const { model } = this._senweaverModelService.getModelFromFsPath(fsPath)
						if (model) {
							const currentSnapshot = this._editCodeService.getSenweaverFileSnapshot(uri)
							backupSnapshots.set(fsPath, currentSnapshot)
							filesToRestore.add(fsPath)
						}
					} catch (error) {
						console.warn('[jumpToCheckpoint] Failed to backup file:', fsPath, error)
					}
				}

				// Restore files sequentially to ensure correct order
				const restorePromises: Promise<void>[] = []
				const filesToSave: URI[] = []
				for (const fsPath in lastIdxOfURI) {
					// Search for the file's state at or before toIdx
					let foundSnapshot: SenweaverFileSnapshot | null = null
					let foundAtCheckpoint: number | null = null

					// Search backwards from toIdx to 0
					for (let k = toIdx; k >= 0; k -= 1) {
						const message = thread.messages[k]
						if (message.role !== 'checkpoint') continue
						const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
						if (!res) continue
						const { senweaverFileSnapshot } = res
						if (!senweaverFileSnapshot) continue
						foundSnapshot = senweaverFileSnapshot
						foundAtCheckpoint = k
						break
					}

					if (foundSnapshot && foundAtCheckpoint !== null) {
						// File existed before, restore it
						const fileUri = URI.file(fsPath)
						restorePromises.push(this._editCodeService.restoreSenweaverFileSnapshot(fileUri, foundSnapshot))
						filesToSave.push(fileUri)
					} else {
						// File's "before" state not found in checkpoints
						// Try to recover by reading from disk as last resort
						try {
							// First, check if file exists on disk
							const fileUri = URI.file(fsPath)
							const fileExists = await this._fileService.exists(fileUri)

							if (fileExists) {
								// Read original content from disk
								const fileContent = await this._fileService.readFile(fileUri)
								const originalContent = fileContent.value.toString()

								const recoveredSnapshot: SenweaverFileSnapshot = {
									snapshottedDiffAreaOfId: {},
									entireFileCode: originalContent
								}

								restorePromises.push(this._editCodeService.restoreSenweaverFileSnapshot(fileUri, recoveredSnapshot))
								filesToSave.push(fileUri)
							} else {
								// File doesn't exist on disk - it was created during this conversation
								// We should delete it to restore the "before" state
								// Note: We don't auto-delete for safety. User can manually delete if needed.
								this._notificationService.notify({
									severity: Severity.Info,
									message: `File ${fsPath} was created during this conversation. Consider deleting it manually to fully restore the previous state.`
								})
							}
						} catch (error) {
							console.error('[jumpToCheckpoint] Failed to recover file from disk:', fsPath, error)
							this._notificationService.notify({
								severity: Severity.Warning,
								message: `Cannot restore file ${fsPath}: before state not found in checkpoints and disk recovery failed. ${getErrorMessage(error)}`
							})
						}
					}
				}

				// Execute restore operations with transactional rollback support
				try {
					// Wait for all files to be restored
					await Promise.all(restorePromises)

					// Auto-save all restored files
					if (filesToSave.length > 0) {
						const savePromises = filesToSave.map(async (uri) => {
							try {
								await this._textFileService.save(uri)
							} catch (error) {
								console.error('[jumpToCheckpoint] Failed to auto-save file:', uri.fsPath, error)
								// Throw to trigger rollback
								throw new Error(`Failed to save ${uri.fsPath}: ${getErrorMessage(error)}`)
							}
						})
						await Promise.all(savePromises)
					}
				} catch (error) {
					// Rollback: restore all files to their backup state
					this._notificationService.notify({
						severity: Severity.Error,
						message: `Failed to restore files to checkpoint. Rolling back changes... ${getErrorMessage(error)}`
					})

					const rollbackPromises: Promise<void>[] = []
					for (const [fsPath, snapshot] of backupSnapshots) {
						try {
							const uri = URI.file(fsPath)
							rollbackPromises.push(this._editCodeService.restoreSenweaverFileSnapshot(uri, snapshot))
						} catch (rollbackError) {
							console.error('[jumpToCheckpoint] Failed to rollback file:', fsPath, rollbackError)
						}
					}

					try {
						await Promise.all(rollbackPromises)
						this._notificationService.notify({
							severity: Severity.Info,
							message: 'Rollback completed. Files have been restored to their state before the failed checkpoint jump.'
						})
					} catch (rollbackError) {
						console.error('[jumpToCheckpoint] CRITICAL: Rollback failed:', rollbackError)
						this._notificationService.notify({
							severity: Severity.Error,
							message: `CRITICAL: Rollback failed. Some files may be in an inconsistent state. ${getErrorMessage(rollbackError)}`
						})
					}

					// Don't update checkpoint index if restore failed
					return
				}
			}

			/*
	if redoing

	A B C D E F G H I J
		x x x x x   x     x
		| | | | |   | x x x
	--x-|-|-|-x---x-|-|---     <-- from
		| | | | x   x
		| | x x |
		| |   | |
	----x-|---x-x-----|---     <-- to
			x           x


	We need to apply latest change for anything that happened between from+1 and to.
	We only need to do it for files that were edited since `from`, ie files between from+1...to.
	*/
			if (toIdx > fromIdx) {
				const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx })
				for (const fsPath in lastIdxOfURI) {
					try {
						const uri = URI.file(fsPath)
						const { model } = this._senweaverModelService.getModelFromFsPath(fsPath)
						if (model) {
							const currentSnapshot = this._editCodeService.getSenweaverFileSnapshot(uri)
							backupSnapshots.set(fsPath, currentSnapshot)
							filesToRestore.add(fsPath)
						}
					} catch (error) {
						console.warn('[jumpToCheckpoint] Failed to backup file:', fsPath, error)
					}
				}

				// Restore files sequentially to ensure correct order
				const restorePromises: Promise<void>[] = []
				const filesToSave: URI[] = []
				for (const fsPath in lastIdxOfURI) {
					// apply lowest down content for each uri
					for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
						const message = thread.messages[k]
						if (message.role !== 'checkpoint') continue
						const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
						if (!res) continue
						const { senweaverFileSnapshot } = res
						if (!senweaverFileSnapshot) continue
						const fileUri = URI.file(fsPath)
						restorePromises.push(this._editCodeService.restoreSenweaverFileSnapshot(fileUri, senweaverFileSnapshot))
						filesToSave.push(fileUri)
						break
					}
				}

				// Execute restore operations with transactional rollback support
				try {
					await Promise.all(restorePromises)

					// Auto-save all restored files
					if (filesToSave.length > 0) {
						const savePromises = filesToSave.map(async (uri) => {
							try {
								await this._textFileService.save(uri)
							} catch (error) {
								console.error('[jumpToCheckpoint] Failed to auto-save file:', uri.fsPath, error)
								// Throw to trigger rollback
								throw new Error(`Failed to save ${uri.fsPath}: ${getErrorMessage(error)}`)
							}
						})
						await Promise.all(savePromises)
					}
				} catch (error) {
					// Rollback: restore all files to their backup state
					this._notificationService.notify({
						severity: Severity.Error,
						message: `Failed to apply files to checkpoint. Rolling back changes... ${getErrorMessage(error)}`
					})

					const rollbackPromises: Promise<void>[] = []
					for (const [fsPath, snapshot] of backupSnapshots) {
						try {
							const uri = URI.file(fsPath)
							rollbackPromises.push(this._editCodeService.restoreSenweaverFileSnapshot(uri, snapshot))
						} catch (rollbackError) {
							console.error('[jumpToCheckpoint] Failed to rollback file:', fsPath, rollbackError)
						}
					}

					try {
						await Promise.all(rollbackPromises)
						this._notificationService.notify({
							severity: Severity.Info,
							message: 'Rollback completed. Files have been restored to their state before the failed checkpoint jump.'
						})
					} catch (rollbackError) {
						this._notificationService.notify({
							severity: Severity.Error,
							message: `CRITICAL: Rollback failed. Some files may be in an inconsistent state. ${getErrorMessage(rollbackError)}`
						})
					}

					// Don't update checkpoint index if restore failed
					return
				}
			}

			this._setThreadState(threadId, { currCheckpointIdx: toIdx })
		} finally {
			// Always release the lock, even if an error occurred
			this._jumpOperationInProgress.delete(threadId)
		}
	}


	private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
		const notify = ({ error }: { error: string | null }) => {
			const thread = this.state.allThreads[threadId]
			if (!thread) return
			const userMsg = findLast(thread.messages, m => m.role === 'user')
			if (!userMsg) return
			if (userMsg.role !== 'user') return
			const messageContent = truncate(userMsg.displayContent, 50, '...')

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContent,
				sticky: true,
				actions: {
					primary: [{
						id: 'senweaver.goToChat',
						enabled: true,
						label: `Jump to Chat`,
						tooltip: '',
						class: undefined,
						run: () => {
							this.switchToThread(threadId)
							// scroll to bottom
							this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
								m.scrollToBottom()
							})
						}
					}]
				},
			})
		}

		p.then(() => {
			if (threadId !== this.state.currentThreadId) notify({ error: null })
		}).catch((e) => {
			if (threadId !== this.state.currentThreadId) notify({ error: getErrorMessage(e) })
			throw e
		})
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, undefined)
	}

	/**
	 * 异步分析图片，带流式反馈（不卡 UI）
	 */
	private async _analyzeImagesWithProgress(images: ImageAttachment[], threadId: string): Promise<string> {
		// 设置流状态为运行中，确保 UI 显示运行状态指示器
		this._setStreamState(threadId, {
			isRunning: 'tool',
			interrupt: Promise.resolve(() => { }),
			toolInfo: {
				toolName: 'analyze_image' as any,
				toolParams: {} as any,
				id: `image-analysis-${Date.now()}`,
				content: '正在分析图片...',
				rawParams: {},
				mcpServerName: undefined
			}
		});

		// 创建初始状态消息
		const statusMessageId = `analysis-status-${Date.now()}`;
		const initialStatusMessage: ChatMessage = {
			role: 'assistant',
			displayContent: `🔍 **正在分析 ${images.length} 张图片...**\n\n⏳ 准备中...`,
			reasoning: '',
			anthropicReasoning: null,
			// @ts-ignore - 添加 ID 用于后续更新
			tempId: statusMessageId
		};
		this._addMessageToThread(threadId, initialStatusMessage);

		const imageAnalysisResults: string[] = [];
		for (let i = 0; i < images.length; i++) {
			const img = images[i];
			const imageNum = i + 1;

			// 只使用上传后的URL，不再使用base64
			if (!img.uploadedUrl || img.uploadStatus !== 'uploaded') {
				imageAnalysisResults.push(`<<<IMAGE_ANALYSIS_START:图片 ${imageNum} 分析失败>>>\n图片尚未上传完成\n<<<IMAGE_ANALYSIS_END>>>`);
				continue;
			}
			const imageSource = img.uploadedUrl;

			// 更新状态：正在分析当前图片
			this._updateAnalysisStatus(threadId, statusMessageId,
				`🔍 **正在分析 ${images.length} 张图片...**\n\n📊 正在分析第 ${imageNum}/${images.length} 张图片...\n\n${imageAnalysisResults.length > 0 ? '\n✅ 已完成 ' + imageAnalysisResults.length + ' 张' : ''}`);

			try {
				const { result } = await this._toolsService.callTool['analyze_image']({
					image_data: imageSource
				});
				const analysisResult = await result;

				if (analysisResult.success) {
					const analysis = analysisResult.analysis || analysisResult.localAnalysis || 'Analysis completed';
					// 使用特殊标记包装图片分析结果，后续会被渲染为可折叠组件
					const collapsibleResult = `<<<IMAGE_ANALYSIS_START:图片 ${imageNum} 分析结果>>>\n${analysis}\n<<<IMAGE_ANALYSIS_END>>>`;
					imageAnalysisResults.push(collapsibleResult);
				} else {
					const errorDetails = `<<<IMAGE_ANALYSIS_START:图片 ${imageNum} 分析失败>>>\n${analysisResult.error || 'Unknown error'}\n<<<IMAGE_ANALYSIS_END>>>`;
					imageAnalysisResults.push(errorDetails);
				}
			} catch (error: unknown) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				const errorDetails = `<<<IMAGE_ANALYSIS_START:图片 ${imageNum} 分析错误>>>\n${errorMsg}\n<<<IMAGE_ANALYSIS_END>>>`;
				imageAnalysisResults.push(errorDetails);
			}
		}

		// 更新为最终结果
		const finalResults = imageAnalysisResults.length > 0 ? imageAnalysisResults.join('\n\n') : '';
		this._updateAnalysisStatus(threadId, statusMessageId,
			`✅ **图片分析完成** ${finalResults}\n\n---\n\n🤖 正在处理您的问题...`);

		// 清除流状态
		this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

		return finalResults;
	}

	/**
	 * 更新分析状态消息
	 */
	private _updateAnalysisStatus(threadId: string, tempId: string, newContent: string): void {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		// 找到状态消息并更新
		const messageIndex = thread.messages.findIndex((msg: any) => msg.tempId === tempId);
		if (messageIndex !== -1) {
			const updatedMessages = [...thread.messages];
			const existingMsg = updatedMessages[messageIndex];

			// 只更新 displayContent，保持其他字段不变
			if (existingMsg.role === 'assistant') {
				updatedMessages[messageIndex] = {
					...existingMsg,
					displayContent: newContent
				} as ChatMessage;
			}

			const newThreads = {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: updatedMessages,
					lastModified: new Date().toISOString()
				}
			};
			this._storeAllThreads(newThreads, threadId);
			this._setState({ allThreads: newThreads });
		}
	}

	private async _addUserMessageAndStreamResponse({ userMessage, displayMessage, _chatSelections, threadId, images }: { userMessage: string, displayMessage?: string, _chatSelections?: StagingSelectionItem[], threadId: string, images?: ImageAttachment[] }) {
		const traceId = this._newPerfTraceId(threadId)
		const t0 = perfNow()
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// interrupt existing stream
		if (this.streamState[threadId]?.isRunning) {
			const tAbort0 = perfNow()
			await this.abortRunning(threadId)
			maybePerfLog('userMessage abortRunning', perfNow() - tAbort0, { threadId, traceId })
		}

		// add dummy before this message to keep checkpoint before user message idea consistent
		if (thread.messages.length === 0) {
			const tCP0 = perfNow()
			this._addUserCheckpoint({ threadId })
			maybePerfLog('userMessage initial checkpoint', perfNow() - tCP0, { threadId, traceId })
		}


		// add user's message to chat history
		const instructions = userMessage
		const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections

		const tBuild0 = perfNow()
		const userMessageContent = await chat_userMessageContent(instructions, currSelns, { directoryStrService: this._directoryStringService, fileService: this._fileService }) // user message + names of files (NOT content)
		maybePerfLog('userMessage build chat_userMessageContent', perfNow() - tBuild0, { threadId, traceId, selections: currSelns.length })
		// 清理图片数据：上传成功后只保留URL，不存储base64（节省存储空间）
		const cleanedImages = images?.map(img => {
			if (img.uploadedUrl && img.uploadStatus === 'uploaded') {
				// 上传成功，清除base64Data只保留URL和缩略图
				const { base64Data, ...rest } = img;
				return rest;
			}
			return img;
		});

		const userHistoryElt: ChatMessage = {
			role: 'user',
			content: userMessageContent,
			displayContent: displayMessage || instructions, // Use displayMessage if provided, otherwise use instructions
			selections: currSelns,
			images: cleanedImages, // 添加图片附件（只保留URL，不存储base64）
			state: defaultMessageState
		}
		this._addMessageToThread(threadId, userHistoryElt)
		maybePerfLog('userMessage addMessageToThread', perfNow() - t0, { threadId, traceId })

		this._setThreadState(threadId, {
			currCheckpointIdx: null, // no longer at a checkpoint because started streaming
			hasAutoAddedFilesThisRound: false // 重置标志，允许下一轮对话自动添加文件
		})

		this._wrapRunAgentToNotify(
			this._runChatAgent({ threadId, ...this._currentModelSelectionProps(), }),
			threadId,
		)
		maybePerfLog('userMessage kickoff agent', perfNow() - t0, { threadId, traceId })

		// scroll to bottom
		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom()
		})
		maybePerfLog('userMessage total (pre-stream)', perfNow() - t0, { threadId, traceId })
	}


	async addUserMessageAndStreamResponse({ userMessage, displayMessage, _chatSelections, threadId, images }: { userMessage: string, displayMessage?: string, _chatSelections?: StagingSelectionItem[], threadId: string, images?: ImageAttachment[] }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return

		// 检查 ownProvider 模型状态（仅记录使用，不阻止发送）
		const { modelSelection } = this._currentModelSelectionProps();

		if (modelSelection && modelSelection.providerName === 'ownProvider') {
			// 检查 model_access 状态，仅记录警告，不阻止发送
			// 智能上下文管理会自动处理 token 溢出，不需要阻止用户发送消息
			if (!isOwnProviderEnabled()) {
				const accessStatus = getOwnProviderModelAccess();
				// 仅在认证失败时阻止，其他情况（连接断开等）不阻止
				if (accessStatus.reason === '认证失败') {
					this._notificationService.notify({
						severity: Severity.Warning,
						message: `模型认证失败，请检查配置`
					});
					return;
				}
				// 其他情况只显示警告，不阻止发送
				const reason = accessStatus.reason || '网络状态异常';
				console.warn(`[ModelAccess] ⚠️ ${reason}，尝试继续对话...`);
			}

			// 通过 WebSocket 发送模型使用记录（同步，不阻塞）
			const userId = getUserId();
			const modelName = modelSelection.modelName;

			// 使用 WebSocket 发送使用记录（失败不阻止发送）
			reportModelUsage(userId, modelName);
		}

		// if there's a current checkpoint, delete all messages after it
		if (thread.state.currCheckpointIdx !== null) {
			const checkpointIdx = thread.state.currCheckpointIdx;
			const newMessages = thread.messages.slice(0, checkpointIdx + 1);

			// Update the thread with truncated messages
			const newThreads = {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					lastModified: new Date().toISOString(),
					messages: newMessages,
				}
			};
			this._storeAllThreads(newThreads, threadId);
			this._setState({ allThreads: newThreads });
		}

		// Pre-process images if model doesn't support vision
		if (images && images.length > 0) {
			const { modelSelection } = this._currentModelSelectionProps();

			if (modelSelection) {
				const { overridesOfModel } = this._settingsService.state;
				const { supportsVision } = getModelCapabilities(
					modelSelection.providerName,
					modelSelection.modelName,
					overridesOfModel
				);

				if (!supportsVision) {

					const thread = this.state.allThreads[threadId];
					if (!thread) return;

					// interrupt existing stream
					if (this.streamState[threadId]?.isRunning) {
						await this.abortRunning(threadId);
					}

					// add dummy before this message to keep checkpoint before user message idea consistent
					if (thread.messages.length === 0) {
						this._addUserCheckpoint({ threadId });
					}

					// 立即添加用户消息到 UI（不阻塞）
					const instructions = userMessage;
					const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections;

					const userMessageContent = await chat_userMessageContent(instructions, currSelns, { directoryStrService: this._directoryStringService, fileService: this._fileService });
					const userHistoryElt: ChatMessage = {
						role: 'user',
						content: userMessageContent,
						displayContent: displayMessage || instructions,
						selections: currSelns,
						images: images, // 保存图片以便在UI中展示，虽然不会发送给模型
						state: defaultMessageState
					};
					this._addMessageToThread(threadId, userHistoryElt);

					this._setThreadState(threadId, {
						currCheckpointIdx: null,
						hasAutoAddedFilesThisRound: false
					});

					// 异步分析图片，带进度反馈（不阻塞 UI）
					(async () => {
						try {
							const analysisResults = await this._analyzeImagesWithProgress(images, threadId);

							// 分析完成后，使用增强的消息内容启动模型响应
							const enhancedUserMessage = analysisResults
								? `${userMessageContent}\n\n---\n\n📸 **图片已预先分析完成（请勿再次调用 analyze_image 工具）：**\n\n${analysisResults}\n\n---\n\n**重要提示**：图片分析已完成，请直接使用以上分析结果回答用户问题，不要调用 analyze_image 工具。`
								: userMessageContent;

							// 更新用户消息内容（包含分析结果）
							const updatedThread = this.state.allThreads[threadId];
							if (updatedThread) {
								// 从后往前查找最后一条用户消息（更可靠）
								let lastUserMsgIndex = -1;
								for (let i = updatedThread.messages.length - 1; i >= 0; i--) {
									if (updatedThread.messages[i].role === 'user') {
										lastUserMsgIndex = i;
										break;
									}
								}

								if (lastUserMsgIndex >= 0) {
									const updatedMessages = updatedThread.messages.map((msg, idx) => {
										if (idx === lastUserMsgIndex && msg.role === 'user' && 'content' in msg) {
											return { ...msg, content: enhancedUserMessage };
										}
										return msg;
									});

									const newThreads = {
										...this.state.allThreads,
										[threadId]: {
											...updatedThread,
											messages: updatedMessages
										}
									};
									this._storeAllThreads(newThreads, threadId);
									this._setState({ allThreads: newThreads });
								}
							}

							// 启动模型响应
							this._wrapRunAgentToNotify(
								this._runChatAgent({ threadId, ...this._currentModelSelectionProps() }),
								threadId
							);

							// scroll to bottom
							this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
								m.scrollToBottom();
							});
						} catch (error) {
							console.error(`[ChatThread] ❌ Image analysis with progress failed:`, error);
						}
					})();

					return; // Return early, don't execute subsequent code
				} else {
					// Keep image data unchanged if model supports vision
					await this._addUserMessageAndStreamResponse({ userMessage, displayMessage, _chatSelections, threadId, images });
					return;
				}
			}
		}

		// Normal flow when there are no images
		await this._addUserMessageAndStreamResponse({ userMessage, displayMessage, _chatSelections, threadId, images });

	}

	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {

		// ...
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`)
		}

		// get prev and curr selections before clearing the message
		const currSelns = thread.messages[messageIdx].state.stagingSelections || [] // staging selections for the edited message

		// clear messages up to the index
		const slicedMessages = thread.messages.slice(0, messageIdx)
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		})

		// re-add the message and stream it
		this._addUserMessageAndStreamResponse({ userMessage, displayMessage: userMessage, _chatSelections: currSelns, threadId })
	}

	// ---------- the rest ----------

	private _getAllSeenFileURIs(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return []

		const fsPathsSet = new Set<string>()
		const uris: URI[] = []
		const addURI = (uri: URI) => {
			if (!fsPathsSet.has(uri.fsPath)) uris.push(uri)
			fsPathsSet.add(uri.fsPath)
			uris.push(uri)
		}

		for (const m of thread.messages) {
			// URIs of user selections
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) {
					// Skip DesignUnit and Terminal types as they don't have uri
					if (sel.type === 'File' || sel.type === 'CodeSelection' || sel.type === 'Folder') {
						addURI(sel.uri)
					}
				}
			}
			// URIs of files that have been read
			else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as BuiltinToolCallParams['read_file']
				addURI(params.uri)
			}
		}
		return uris
	}



	getRelativeStr = (uri: URI) => {
		const isInside = this._workspaceContextService.isInsideWorkspace(uri)
		if (isInside) {
			const f = this._workspaceContextService.getWorkspace().folders.find(f => uri.fsPath.startsWith(f.uri.fsPath))
			if (f) { return uri.fsPath.replace(f.uri.fsPath, '') }
			else { return undefined }
		}
		else {
			return undefined
		}
	}


	// gets the location of codespan link so the user can click on it
	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file-or-folder' | 'function-or-class'
		if (target.includes('.') || target.includes('/')) {

			codespanType = 'file-or-folder'
			target = _codespanStr

		} else if (functionOrMethodPattern.test(target)) {

			codespanType = 'function-or-class'
			target = _codespanStr

		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern)
			if (match && match[1]) {

				codespanType = 'function-or-class'
				target = match[1]

			}
			else { return null }
		}
		else {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSeenFileURIs(threadId).reverse()

		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target)

			// check if any prevFiles are the `target`
			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// shorten it

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}

					return { uri, displayText }
				}
			}

			// else search codebase for `target`
			let uris: URI[] = []
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ query: target, includePattern: null, pageNumber: 0 })
				const { uris: uris_ } = await result
				uris = uris_
			} catch (e) {
				return null
			}

			for (const [idx, uri] of uris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}


					return { uri, displayText }
				}
			}

		}


		if (codespanType === 'function-or-class') {


			// check all prevUris for the target
			for (const uri of prevUris) {

				const modelRef = await this._senweaverModelService.getModelSafe(uri)
				const { model } = modelRef
				if (!model) continue

				const matches = model.findMatches(
					target,
					false, // searchOnlyEditableRange
					false, // isRegex
					true,  // matchCase
					null, //' ',   // wordSeparators
					true   // captureMatches
				);

				const firstThree = matches.slice(0, 3);

				// take first 3 occurences, attempt to goto definition on them
				for (const match of firstThree) {
					const position = new Position(match.range.startLineNumber, match.range.startColumn);
					const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);

					for (const provider of definitionProviders) {

						const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);

						if (!_definitions) continue;

						const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

						for (const definition of definitions) {

							return {
								uri: definition.uri,
								selection: {
									startLineNumber: definition.range.startLineNumber,
									startColumn: definition.range.startColumn,
									endLineNumber: definition.range.endLineNumber,
									endColumn: definition.range.endColumn,
								},
								displayText: _codespanStr,
							};

							// const defModelRef = await this._textModelService.createModelReference(definition.uri);
							// const defModel = defModelRef.object.textEditorModel;

							// try {
							// 	const symbolProviders = this._languageFeaturesService.documentSymbolProvider.ordered(defModel);

							// 	for (const symbolProvider of symbolProviders) {
							// 		const symbols = await symbolProvider.provideDocumentSymbols(
							// 			defModel,
							// 			CancellationToken.None
							// 		);

							// 		if (symbols) {
							// 			const symbol = symbols.find(s => {
							// 				const symbolRange = s.range;
							// 				return symbolRange.startLineNumber <= definition.range.startLineNumber &&
							// 					symbolRange.endLineNumber >= definition.range.endLineNumber &&
							// 					(symbolRange.startLineNumber !== definition.range.startLineNumber || symbolRange.startColumn <= definition.range.startColumn) &&
							// 					(symbolRange.endLineNumber !== definition.range.endLineNumber || symbolRange.endColumn >= definition.range.endColumn);
							// 			});

							// 			// if we got to a class/function get the full range and return
							// 			if (symbol?.kind === SymbolKind.Function || symbol?.kind === SymbolKind.Method || symbol?.kind === SymbolKind.Class) {
							// 				return {
							// 					uri: definition.uri,
							// 					selection: {
							// 						startLineNumber: definition.range.startLineNumber,
							// 						startColumn: definition.range.startColumn,
							// 						endLineNumber: definition.range.endLineNumber,
							// 						endColumn: definition.range.endColumn,
							// 					}
							// 				};
							// 			}
							// 		}
							// 	}
							// } finally {
							// 	defModelRef.dispose();
							// }
						}
					}
				}
			}

			// unlike above do not search codebase (doesnt make sense)

		}

		return null

	}

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined;

		const links = thread.state.linksOfMessageIdx?.[messageIdx]
		if (!links) return undefined;

		const link = links[codespanStr]

		return link
	}

	async addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({

			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						linksOfMessageIdx: {
							...thread.state.linksOfMessageIdx,
							[messageIdx]: {
								...thread.state.linksOfMessageIdx?.[messageIdx],
								[newLinkText]: newLinkLocation
							}
						}
					}

				}
			}
		})
	}


	getCurrentThread(): ThreadType {
		const state = this.state
		const thread = state.allThreads[state.currentThreadId]
		if (!thread) throw new Error(`Current thread should never be undefined`)
		return thread
	}

	getCurrentFocusedMessageIdx() {
		const thread = this.getCurrentThread()

		// get the focusedMessageIdx
		const focusedMessageIdx = thread.state.focusedMessageIdx
		if (focusedMessageIdx === undefined) return;

		// check that the message is actually being edited
		const focusedMessage = thread.messages[focusedMessageIdx]
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.state) return;

		return focusedMessageIdx
	}

	isCurrentlyFocusingMessage() {
		return this.getCurrentFocusedMessageIdx() !== undefined
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId })
	}


	openNewThread() {
		// Reset context compaction state for new thread
		enhancedContextManager.reset();

		// Get current file first
		const currentFile = this._getCurrentFile()

		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId]!.messages.length === 0) {
				// switch to the existing empty thread
				this.switchToThread(threadId)
				// Add current file after state is set - use setTimeout to ensure state updates are complete
				setTimeout(() => {
					if (currentFile && currentFile.type === 'File') {
						this._setThreadState(threadId, { stagingSelections: [currentFile] })
					}
				}, 0)
				return
			}
		}
		// otherwise, start a new thread
		const newThread = newThreadObject()

		// Add current file to the new thread's initial state
		if (currentFile && currentFile.type === 'File') {
			newThread.state.stagingSelections = [currentFile]
		}

		// update state
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads, newThread.id)
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id })
	}

	private _getCurrentFile(): StagingSelectionItem | null {
		// Get the currently active editor
		const activeEditor = this._editorService.activeEditor
		if (!activeEditor) {
			return null
		}

		const resource = EditorResourceAccessor.getOriginalUri(activeEditor)
		if (!resource) {
			return null
		}

		// Skip designer-preview editor (it's not a real file)
		if (resource.scheme === 'Senweaver' && resource.path === 'designer-preview') {
			return null
		}

		// Skip built-in browser editor (it's not a code file)
		if (resource.scheme === 'Senweaver' && resource.path === 'browser') {
			return null
		}

		// Get language ID from the model if available
		const { model } = this._senweaverModelService.getModel(resource)
		const language = model?.getLanguageId() || 'plaintext'

		// Create a staging selection item for the current file
		// Set wasAddedAsCurrentFile to true to show "current file" badge
		const fileSelection: StagingSelectionItem = {
			type: 'File',
			uri: resource,
			language: language,
			state: { wasAddedAsCurrentFile: true }
		}

		return fileSelection
	}

	private _onActiveEditorChanged(): void {
		const currentThread = this.getCurrentThread()
		if (!currentThread) return

		// Only auto-update if:
		// 1. AI is not running
		// 2. Input is empty (no user message typed yet)
		// 3. Has auto-added files this round (meaning we're in the auto-add mode)
		const hasAutoAddedThisRound = currentThread.state.hasAutoAddedFilesThisRound || false
		if (!hasAutoAddedThisRound) return

		const currentSelections = currentThread.state.stagingSelections || []

		// Get the new current file
		const newCurrentFile = this._getCurrentFile()
		if (!newCurrentFile) return

		// Check if the new file is already in the selections
		const alreadyExists = currentSelections.some(sel =>
			sel.type === 'File' && newCurrentFile.type === 'File' && sel.uri.fsPath === newCurrentFile.uri.fsPath
		)

		if (alreadyExists) {
			return
		}

		// Remove old current file (marked with wasAddedAsCurrentFile: true)
		const updatedSelections = currentSelections.filter(sel =>
			!(sel.type === 'File' && sel.state?.wasAddedAsCurrentFile === true)
		)

		// Add the new current file
		updatedSelections.push(newCurrentFile)

		this.setCurrentThreadState({ stagingSelections: updatedSelections })
	}


	deleteThread(threadId: string): void {
		const { allThreads: currentThreads } = this.state

		// delete the thread
		const newThreads = { ...currentThreads };
		delete newThreads[threadId];

		// store the updated threads (pass threadId to trigger removal from storage)
		this._storeAllThreads(newThreads, threadId);
		this._setState({ ...this.state, allThreads: newThreads })
	}

	duplicateThread(threadId: string) {
		const { allThreads: currentThreads } = this.state
		const threadToDuplicate = currentThreads[threadId]
		if (!threadToDuplicate) return
		const newThread = {
			...deepClone(threadToDuplicate),
			id: generateUuid(),
		}
		const newThreads = {
			...currentThreads,
			[newThread.id]: newThread,
		}
		this._storeAllThreads(newThreads, newThread.id)
		this._setState({ allThreads: newThreads })
	}


	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) {
			return // should never happen
		}
		const newMessages = oldThread.messages.concat(message)

		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: newMessages,
			}
		}
		this._storeAllThreads(newThreads, threadId)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						focusedMessageIdx: messageIdx,
					}
				}
			}
		})

		// // when change focused message idx, jump - do not jump back when click edit, too confusing.
		// if (messageIdx !== undefined)
		// 	this.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified: true })
	}


	addNewStagingSelection(newSelection: StagingSelectionItem): void {

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		// Check if this selection already exists
		const idx = findStagingSelectionIndex(selections, newSelection)

		// If it's a File type and already exists, don't add it again (avoid duplicates)
		if (idx !== null && idx !== -1 && newSelection.type === 'File') {
			return
		}

		// If it's a DesignUnit type and already exists, replace it
		if (idx !== null && idx !== -1 && newSelection.type === 'DesignUnit') {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
			return
		}

		// If it's a Terminal type and already exists, replace it (since content may change)
		if (idx !== null && idx !== -1 && newSelection.type === 'Terminal') {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
			return
		}

		// For CodeSelection, overwrite if exists (since text may change)
		if (idx !== null && idx !== -1 && newSelection.type === 'CodeSelection') {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
		}
		// if no match, add it
		else if (idx === null || idx === -1) {
			setSelections([...(selections ?? []), newSelection])
		}
	}


	// Mark that files have been auto-added in this conversation round
	markFilesAutoAddedThisRound(): void {
		this.setCurrentThreadState({ hasAutoAddedFilesThisRound: true })
	}

	// Pops the staging selections from the current thread's state
	popStagingSelections(numPops: number): void {

		numPops = numPops ?? 1;

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		setSelections([
			...selections.slice(0, selections.length - numPops)
		])

	}

	// set message.state
	private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx && m.role === 'user' ? {
							...m,
							state: {
								...m.state,
								...state
							},
						} : m
					)
				}
			}
		})

	}

	// set thread.state
	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					state: {
						...thread.state,
						...state
					}
				}
			}
		}, doNotRefreshMountInfo)

	}


	// closeCurrentStagingSelectionsInThread = () => {
	// 	const currThread = this.getCurrentThreadState()

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newThread = currThread
	// 	newThread.stagingSelections = closedStagingSelections

	// 	this.setCurrentThreadState(newThread)

	// }

	// closeCurrentStagingSelectionsInMessage: IChatThreadService['closeCurrentStagingSelectionsInMessage'] = ({ messageIdx }) => {
	// 	const currMessage = this.getCurrentMessageState(messageIdx)

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currMessage.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newMessage = currMessage
	// 	newMessage.stagingSelections = closedStagingSelections

	// 	this.setCurrentMessageState(messageIdx, newMessage)

	// }



	getCurrentThreadState = () => {
		const currentThread = this.getCurrentThread()
		return currentThread.state
	}
	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setThreadState(this.state.currentThreadId, newState)
	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)

	getCurrentMessageState(messageIdx: number): UserMessageState {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return defaultMessageState
		return currMessage.state
	}
	setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return
		this._setCurrentMessageState(newState, messageIdx)
	}



}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
