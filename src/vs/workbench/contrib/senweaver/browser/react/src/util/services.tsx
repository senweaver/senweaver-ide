/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useCallback, startTransition, useRef } from 'react'
import { MCPUserState, RefreshableProviderName, SettingsOfProvider } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsTypes.js'
import { DisposableStore, IDisposable } from '../../../../../../../base/common/lifecycle.js'
import { SenweaverSettingsState } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsService.js'
import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js'
import { RefreshModelStateOfProvider } from '../../../../../../../workbench/contrib/senweaver/common/refreshModelService.js'

import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';
import { IExplorerService } from '../../../../../../../workbench/contrib/files/browser/files.js'
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { IClipboardService } from '../../../../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService, IContextMenuService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../../../../platform/theme/common/themeService.js';
import { ILLMMessageService } from '../../../../common/sendLLMMessageService.js';
import { IRefreshModelService } from '../../../../../../../workbench/contrib/senweaver/common/refreshModelService.js';
import { ISenweaverSettingsService } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsService.js';
import { IExtensionTransferService } from '../../../../../../../workbench/contrib/senweaver/browser/extensionTransferService.js'

import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js'
import { ICodeEditorService } from '../../../../../../../editor/browser/services/codeEditorService.js'
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js'
import { IContextKeyService } from '../../../../../../../platform/contextkey/common/contextkey.js'
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js'
import { IAccessibilityService } from '../../../../../../../platform/accessibility/common/accessibility.js'
import { ILanguageConfigurationService } from '../../../../../../../editor/common/languages/languageConfigurationRegistry.js'
import { ILanguageFeaturesService } from '../../../../../../../editor/common/services/languageFeatures.js'
import { ILanguageDetectionService } from '../../../../../../services/languageDetection/common/languageDetectionWorkerService.js'
import { IKeybindingService } from '../../../../../../../platform/keybinding/common/keybinding.js'
import { IEnvironmentService } from '../../../../../../../platform/environment/common/environment.js'
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js'
import { IPathService } from '../../../../../../../workbench/services/path/common/pathService.js'
import { IMetricsService } from '../../../../../../../workbench/contrib/senweaver/common/metricsService.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { IChatThreadService, ThreadsState, ThreadStreamState } from '../../../chatThreadService.js'
import { ITerminalToolService } from '../../../terminalToolService.js'
import { ILanguageService } from '../../../../../../../editor/common/languages/language.js'
import { ISenweaverModelService } from '../../../../common/senweaverModelService.js'
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js'
import { ISenweaverCommandBarService } from '../../../senweaverCommandBarService.js'
import { INativeHostService } from '../../../../../../../platform/native/common/native.js';
import { IEditCodeService } from '../../../editCodeServiceInterface.js'
import { IToolsService } from '../../../toolsService.js'
import { IConvertToLLMMessageService } from '../../../convertToLLMMessageService.js'
import { ITerminalService } from '../../../../../terminal/browser/terminal.js'
import { ISearchService } from '../../../../../../services/search/common/search.js'
import { IExtensionManagementService } from '../../../../../../../platform/extensionManagement/common/extensionManagement.js'
import { IMCPService } from '../../../../common/mcpService.js';
import { ISkillService } from '../../../../common/skillService.js';
import { IStorageService, StorageScope } from '../../../../../../../platform/storage/common/storage.js'
import { IProductService } from '../../../../../../../platform/product/common/productService.js'
import { OPT_OUT_KEY } from '../../../../common/storageKeys.js'
import { IEditorService } from '../../../../../../services/editor/common/editorService.js'
import { ICustomApiService } from '../../../../common/customApiService.js'


// normally to do this you'd use a useEffect that calls .onDidChangeState(), but useEffect mounts too late and misses initial state changes

// even if React hasn't mounted yet, the variables are always updated to the latest state.
// React listens by adding a setState function to these listeners.

// RAF-based throttle utility to prevent excessive React re-renders
// Uses requestAnimationFrame for smooth updates that don't block main thread
const createRAFThrottle = () => {
	let pending = false
	let latestFn: (() => void) | null = null

	return (fn: () => void) => {
		latestFn = fn
		if (!pending) {
			pending = true
			requestAnimationFrame(() => {
				pending = false
				if (latestFn) {
					latestFn()
					latestFn = null
				}
			})
		}
	}
}

// Time-based throttle for less frequent updates
const createTimeThrottle = (delay: number) => {
	let lastCall = 0
	let pendingCall: ReturnType<typeof setTimeout> | null = null
	return (fn: () => void) => {
		const now = Date.now()
		if (now - lastCall >= delay) {
			lastCall = now
			// Use requestAnimationFrame to avoid blocking
			requestAnimationFrame(fn)
		} else if (!pendingCall) {
			pendingCall = setTimeout(() => {
				lastCall = Date.now()
				pendingCall = null
				requestAnimationFrame(fn)
			}, delay - (now - lastCall))
		}
	}
}

// Use RAF-based throttle for high-frequency updates (streaming)
const throttledChatThreadsUpdate = createRAFThrottle()
const throttledStreamStateUpdate = createRAFThrottle()
// Use time-based throttle for less frequent updates
const throttledCommandBarUpdate = createTimeThrottle(50) // ~20fps for command bar

let chatThreadsState: ThreadsState
const chatThreadsStateListeners: Set<(s: ThreadsState) => void> = new Set()

let chatThreadsStreamState: ThreadStreamState
const chatThreadsStreamStateListeners: Set<(threadId: string) => void> = new Set()

let settingsState: SenweaverSettingsState
const settingsStateListeners: Set<(s: SenweaverSettingsState) => void> = new Set()

let refreshModelState: RefreshModelStateOfProvider
const refreshModelStateListeners: Set<(s: RefreshModelStateOfProvider) => void> = new Set()
const refreshModelProviderListeners: Set<(p: RefreshableProviderName, s: RefreshModelStateOfProvider) => void> = new Set()

let colorThemeState: ColorScheme
const colorThemeStateListeners: Set<(s: ColorScheme) => void> = new Set()

const ctrlKZoneStreamingStateListeners: Set<(diffareaid: number, s: boolean) => void> = new Set()
const commandBarURIStateListeners: Set<(uri: URI) => void> = new Set();
const activeURIListeners: Set<(uri: URI | null) => void> = new Set();

const mcpListeners: Set<() => void> = new Set()


// must call this before you can use any of the hooks below
// this should only be called ONCE! this is the only place you don't need to dispose onDidChange. If you use state.onDidChange anywhere else, make sure to dispose it!
export const _registerServices = (accessor: ServicesAccessor) => {

	const disposables: IDisposable[] = []

	_registerAccessor(accessor)

	const stateServices = {
		chatThreadsStateService: accessor.get(IChatThreadService),
		settingsStateService: accessor.get(ISenweaverSettingsService),
		refreshModelService: accessor.get(IRefreshModelService),
		themeService: accessor.get(IThemeService),
		editCodeService: accessor.get(IEditCodeService),
		senweaverCommandBarService: accessor.get(ISenweaverCommandBarService),
		modelService: accessor.get(IModelService),
		mcpService: accessor.get(IMCPService),
	}

	const { settingsStateService, chatThreadsStateService, refreshModelService, themeService, editCodeService, senweaverCommandBarService, modelService, mcpService } = stateServices




	chatThreadsState = chatThreadsStateService.state
	disposables.push(
		chatThreadsStateService.onDidChangeCurrentThread(() => {
			chatThreadsState = chatThreadsStateService.state
			// Use throttled updates to prevent UI blocking during rapid state changes
			throttledChatThreadsUpdate(() => {
				chatThreadsStateListeners.forEach(l => l(chatThreadsState))
			})
		})
	)

	// same service, different state
	chatThreadsStreamState = chatThreadsStateService.streamState
	disposables.push(
		chatThreadsStateService.onDidChangeStreamState(({ threadId }) => {
			chatThreadsStreamState = chatThreadsStateService.streamState
			// Use throttled updates to prevent UI blocking during rapid stream state changes
			throttledStreamStateUpdate(() => {
				chatThreadsStreamStateListeners.forEach(l => l(threadId))
			})
		})
	)

	settingsState = settingsStateService.state
	disposables.push(
		settingsStateService.onDidChangeState(() => {
			settingsState = settingsStateService.state
			settingsStateListeners.forEach(l => l(settingsState))
		})
	)

	refreshModelState = refreshModelService.state
	disposables.push(
		refreshModelService.onDidChangeState((providerName) => {
			refreshModelState = refreshModelService.state
			refreshModelStateListeners.forEach(l => l(refreshModelState))
			refreshModelProviderListeners.forEach(l => l(providerName, refreshModelState)) // no state
		})
	)

	colorThemeState = themeService.getColorTheme().type
	disposables.push(
		themeService.onDidColorThemeChange(({ type }) => {
			colorThemeState = type
			colorThemeStateListeners.forEach(l => l(colorThemeState))
		})
	)

	// no state
	disposables.push(
		editCodeService.onDidChangeStreamingInCtrlKZone(({ diffareaid }) => {
			const isStreaming = editCodeService.isCtrlKZoneStreaming({ diffareaid })
			// Throttle CtrlK zone streaming updates
			throttledCommandBarUpdate(() => {
				ctrlKZoneStreamingStateListeners.forEach(l => l(diffareaid, isStreaming))
			})
		})
	)

	disposables.push(
		senweaverCommandBarService.onDidChangeState(({ uri }) => {
			// Throttle command bar state updates to prevent UI blocking
			throttledCommandBarUpdate(() => {
				commandBarURIStateListeners.forEach(l => l(uri));
			})
		})
	)

	disposables.push(
		senweaverCommandBarService.onDidChangeActiveURI(({ uri }) => {
			activeURIListeners.forEach(l => l(uri));
		})
	)

	disposables.push(
		mcpService.onDidChangeState(() => {
			mcpListeners.forEach(l => l())
		})
	)


	return disposables
}



const getReactAccessor = (accessor: ServicesAccessor) => {
	const reactAccessor = {
		IModelService: accessor.get(IModelService),
		IClipboardService: accessor.get(IClipboardService),
		IContextViewService: accessor.get(IContextViewService),
		IContextMenuService: accessor.get(IContextMenuService),
		IFileService: accessor.get(IFileService),
		IHoverService: accessor.get(IHoverService),
		IThemeService: accessor.get(IThemeService),
		ILLMMessageService: accessor.get(ILLMMessageService),
		IRefreshModelService: accessor.get(IRefreshModelService),
		ISenweaverSettingsService: accessor.get(ISenweaverSettingsService),
		IEditCodeService: accessor.get(IEditCodeService),
		IChatThreadService: accessor.get(IChatThreadService),

		IInstantiationService: accessor.get(IInstantiationService),
		ICodeEditorService: accessor.get(ICodeEditorService),
		ICommandService: accessor.get(ICommandService),
		IContextKeyService: accessor.get(IContextKeyService),
		INotificationService: accessor.get(INotificationService),
		IAccessibilityService: accessor.get(IAccessibilityService),
		ILanguageConfigurationService: accessor.get(ILanguageConfigurationService),
		ILanguageDetectionService: accessor.get(ILanguageDetectionService),
		ILanguageFeaturesService: accessor.get(ILanguageFeaturesService),
		IKeybindingService: accessor.get(IKeybindingService),
		ISearchService: accessor.get(ISearchService),

		IExplorerService: accessor.get(IExplorerService),
		IEnvironmentService: accessor.get(IEnvironmentService),
		IConfigurationService: accessor.get(IConfigurationService),
		IPathService: accessor.get(IPathService),
		IMetricsService: accessor.get(IMetricsService),
		ITerminalToolService: accessor.get(ITerminalToolService),
		ILanguageService: accessor.get(ILanguageService),
		ISenweaverModelService: accessor.get(ISenweaverModelService),
		IWorkspaceContextService: accessor.get(IWorkspaceContextService),

		ISenweaverCommandBarService: accessor.get(ISenweaverCommandBarService),
		INativeHostService: accessor.get(INativeHostService),
		IToolsService: accessor.get(IToolsService),
		IConvertToLLMMessageService: accessor.get(IConvertToLLMMessageService),
		ITerminalService: accessor.get(ITerminalService),
		IExtensionManagementService: accessor.get(IExtensionManagementService),
		IExtensionTransferService: accessor.get(IExtensionTransferService),
		IMCPService: accessor.get(IMCPService),
		ISkillService: accessor.get(ISkillService),

		IStorageService: accessor.get(IStorageService),
		IEditorService: accessor.get(IEditorService),
		ICustomApiService: accessor.get(ICustomApiService),
		IProductService: accessor.get(IProductService),

	} as const
	return reactAccessor
}

type ReactAccessor = ReturnType<typeof getReactAccessor>


let reactAccessor_: ReactAccessor | null = null
const _registerAccessor = (accessor: ServicesAccessor) => {
	const reactAccessor = getReactAccessor(accessor)
	reactAccessor_ = reactAccessor
}

// -- services --
export const useAccessor = () => {
	if (!reactAccessor_) {
		throw new Error(`⚠️ SenWeaver useAccessor was called before _registerServices!`)
	}

	return { get: <S extends keyof ReactAccessor,>(service: S): ReactAccessor[S] => reactAccessor_![service] }
}



// -- state of services --

export const useSettingsState = () => {
	const [s, ss] = useState(settingsState)
	useEffect(() => {
		startTransition(() => ss(settingsState))
		const listener = (newState: typeof settingsState) => {
			startTransition(() => ss(newState))
		}
		settingsStateListeners.add(listener)
		return () => { settingsStateListeners.delete(listener) }
	}, [ss])
	return s
}

export const useChatThreadsState = () => {
	const [s, ss] = useState(chatThreadsState)
	useEffect(() => {
		startTransition(() => ss(chatThreadsState))
		const listener = (newState: typeof chatThreadsState) => {
			startTransition(() => ss(newState))
		}
		chatThreadsStateListeners.add(listener)
		return () => { chatThreadsStateListeners.delete(listener) }
	}, [ss])
	return s
	// allow user to set state natively in react
	// const ss: React.Dispatch<React.SetStateAction<ThreadsState>> = (action)=>{
	// 	_ss(action)
	// 	if (typeof action === 'function') {
	// 		const newState = action(chatThreadsState)
	// 		chatThreadsState = newState
	// 	} else {
	// 		chatThreadsState = action
	// 	}
	// }
	// return [s, ss] as const
}




export const useChatThreadsStreamState = (threadId: string) => {
	const [s, ss] = useState<ThreadStreamState[string] | undefined>(chatThreadsStreamState[threadId])
	// Use ref to track last update time for additional throttling
	const lastUpdateRef = useRef(0)

	useEffect(() => {
		startTransition(() => ss(chatThreadsStreamState[threadId]))
		const listener = (threadId_: string) => {
			if (threadId_ !== threadId) return

			// Additional client-side throttling: skip updates within 32ms (~30fps)
			const now = Date.now()
			if (now - lastUpdateRef.current < 32) return
			lastUpdateRef.current = now

			// Use startTransition to mark this as low-priority update
			startTransition(() => ss(chatThreadsStreamState[threadId]))
		}
		chatThreadsStreamStateListeners.add(listener)
		return () => { chatThreadsStreamStateListeners.delete(listener) }
	}, [ss, threadId])
	return s
}

// Optimized: only track if ANY thread is running, not the full state
// This reduces unnecessary re-renders when stream content changes
export const useAnyThreadRunning = () => {
	const [isRunning, setIsRunning] = useState(() => {
		return Object.keys(chatThreadsStreamState).some(tid => chatThreadsStreamState[tid]?.isRunning)
	})
	const lastValueRef = useRef(isRunning)

	useEffect(() => {
		const listener = () => {
			const newValue = Object.keys(chatThreadsStreamState).some(tid => chatThreadsStreamState[tid]?.isRunning)
			// Only update if the value actually changed
			if (newValue !== lastValueRef.current) {
				lastValueRef.current = newValue
				setIsRunning(newValue)
			}
		}
		chatThreadsStreamStateListeners.add(listener)
		return () => { chatThreadsStreamStateListeners.delete(listener) }
	}, [])
	return isRunning
}

export const useFullChatThreadsStreamState = () => {
	const [s, ss] = useState(chatThreadsStreamState)
	// Throttle full state updates more aggressively
	const lastUpdateRef = useRef(0)

	useEffect(() => {
		startTransition(() => ss(chatThreadsStreamState))
		const listener = () => {
			// Throttle to ~10fps for full state updates (100ms)
			const now = Date.now()
			if (now - lastUpdateRef.current < 100) return
			lastUpdateRef.current = now

			startTransition(() => ss(chatThreadsStreamState))
		}
		chatThreadsStreamStateListeners.add(listener)
		return () => { chatThreadsStreamStateListeners.delete(listener) }
	}, [ss])
	return s
}



export const useRefreshModelState = () => {
	const [s, ss] = useState(refreshModelState)
	useEffect(() => {
		ss(refreshModelState)
		refreshModelStateListeners.add(ss)
		return () => { refreshModelStateListeners.delete(ss) }
	}, [ss])
	return s
}


export const useRefreshModelListener = (listener: (providerName: RefreshableProviderName, s: RefreshModelStateOfProvider) => void) => {
	useEffect(() => {
		refreshModelProviderListeners.add(listener)
		return () => { refreshModelProviderListeners.delete(listener) }
	}, [listener, refreshModelProviderListeners])
}

export const useCtrlKZoneStreamingState = (listener: (diffareaid: number, s: boolean) => void) => {
	useEffect(() => {
		ctrlKZoneStreamingStateListeners.add(listener)
		return () => { ctrlKZoneStreamingStateListeners.delete(listener) }
	}, [listener, ctrlKZoneStreamingStateListeners])
}

export const useIsDark = () => {
	const [s, ss] = useState(colorThemeState)
	useEffect(() => {
		ss(colorThemeState)
		colorThemeStateListeners.add(ss)
		return () => { colorThemeStateListeners.delete(ss) }
	}, [ss])

	// s is the theme, return isDark instead of s
	const isDark = s === ColorScheme.DARK || s === ColorScheme.HIGH_CONTRAST_DARK
	return isDark
}

export const useCommandBarURIListener = (listener: (uri: URI) => void) => {
	useEffect(() => {
		commandBarURIStateListeners.add(listener);
		return () => { commandBarURIStateListeners.delete(listener) };
	}, [listener]);
};
export const useCommandBarState = () => {
	const accessor = useAccessor()
	const commandBarService = accessor.get('ISenweaverCommandBarService')
	const [s, ss] = useState({ stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs });
	const listener = useCallback(() => {
		ss({ stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs });
	}, [commandBarService])
	useCommandBarURIListener(listener)

	return s;
}



// roughly gets the active URI - this is used to get the history of recent URIs
export const useActiveURI = () => {
	const accessor = useAccessor()
	const commandBarService = accessor.get('ISenweaverCommandBarService')
	const [s, ss] = useState(commandBarService.activeURI)
	useEffect(() => {
		const listener = () => { ss(commandBarService.activeURI) }
		activeURIListeners.add(listener);
		return () => { activeURIListeners.delete(listener) };
	}, [])
	return { uri: s }
}




export const useMCPServiceState = () => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')
	const [s, ss] = useState(mcpService.state)
	useEffect(() => {
		const listener = () => { ss(mcpService.state) }
		mcpListeners.add(listener);
		return () => { mcpListeners.delete(listener) };
	}, []);
	return s
}



export const useIsOptedOut = () => {
	const accessor = useAccessor()
	const storageService = accessor.get('IStorageService')

	const getVal = useCallback(() => {
		return storageService.getBoolean(OPT_OUT_KEY, StorageScope.APPLICATION, false)
	}, [storageService])

	const [s, ss] = useState(getVal())

	useEffect(() => {
		const disposables = new DisposableStore();
		const d = storageService.onDidChangeValue(StorageScope.APPLICATION, OPT_OUT_KEY, disposables)(e => {
			ss(getVal())
		})
		disposables.add(d)
		return () => disposables.clear()
	}, [storageService, getVal])

	return s
}
