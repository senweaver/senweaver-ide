/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'; // Added useRef import just in case it was missed, though likely already present
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, SenweaverStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames, subTextMdOfProviderName } from '../../../../common/senweaverSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { SenweaverButtonBgDarken, SenweaverCustomDropdownBox, SenweaverInputBox2, SenweaverSimpleInputBox, SenweaverSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useIsOptedOut, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Plus, Cloud, Settings as SettingsIcon } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { getModelCapabilities, modelOverrideKeys, ModelOverrides } from '../../../../common/modelCapabilities.js';
import { TransferEditorType, TransferFilesInfo } from '../../../extensionTransferTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';
import { useMCPServiceState } from '../util/services.js';
import { OPT_OUT_KEY } from '../../../../common/storageKeys.js';
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js';
import { CustomApiPanel } from '../custom-api-tsx/CustomApiPanel.js';

type Tab =
	| 'models'
	| 'localProviders'
	| 'providers'
	| 'featureOptions'
	| 'mcp'
	| 'skills'
	| 'general'
	| 'customApi'
	| 'remoteCollaboration'
	| 'aboutUpdate'
	| 'all';


const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-senweaver-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2'>
		{leftButton ? leftButton : null}
		<span>
			{text}
		</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {

	const refreshModelState = useRefreshModelState()

	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')
	const metricsService = accessor.get('IMetricsService')

	const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (!(state === 'finished' || state === 'error')) return
			// now we know we just entered 'finished' state for this providerName
			setJustFinished(state)
			const tid = setTimeout(() => { setJustFinished(null) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <ButtonLeftTextRightOption

		leftButton={
			<button
				className='flex items-center'
				disabled={state === 'refreshing' || justFinished !== null}
				onClick={() => {
					refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false })
					metricsService.capture('Click', { providerName, action: 'Refresh Models' })
				}}
			>
				{justFinished === 'finished' ? <Check className='stroke-green-500 size-3' />
					: justFinished === 'error' ? <X className='stroke-red-500 size-3' />
						: state === 'refreshing' ? <Loader2 className='size-3 animate-spin' />
							: <RefreshCw className='size-3' />}
			</button>
		}

		text={justFinished === 'finished' ? `${providerTitle} Models are up-to-date!`
			: justFinished === 'error' ? `${providerTitle} not found!`
				: `手动刷新 ${providerTitle} 模型.`}
	/>
}

const RefreshableModels = () => {
	const settingsState = useSettingsState()


	const buttons = refreshableProviderNames.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null
		return <RefreshModelButton key={providerName} providerName={providerName} />
	})

	return <>
		{buttons}
	</>

}

// 线上配置模型按钮组件




export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500; // 500ms animation

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);

			setDashOffset(newOffset);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}


const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		className={`bg-white/90 px-4 py-1 text-gray-700 rounded-sm border border-gray-300 ${!disabled ? 'hover:bg-white hover:border-gray-400 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
		{...props}
	>{text}</button>

}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<SenweaverButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</SenweaverButtonBgDarken>
		</div>
	);
};

// ---------------- Simplified Model Settings Dialog ------------------

// keys of ModelOverrides we allow the user to override



// This new dialog replaces the verbose UI with a single JSON override box.
const SimpleModelSettingsDialog = ({
	isOpen,
	onClose,
	modelInfo,
}: {
	isOpen: boolean;
	onClose: () => void;
	modelInfo: { modelName: string; providerName: ProviderName; type: 'autodetected' | 'custom' | 'default' } | null;
}) => {
	if (!isOpen || !modelInfo) return null;

	const { modelName, providerName, type } = modelInfo;
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const mouseDownInsideModal = useRef(false); // Ref to track mousedown origin
	const settingsStateService = accessor.get('ISenweaverSettingsService')

	// current overrides and defaults
	const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined);
	const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] ?? undefined;
	const { recognizedModelName, isUnrecognizedModel } = defaultModelCapabilities

	// Create the placeholder with the default values for allowed keys
	const partialDefaults: Partial<ModelOverrides> = {};
	for (const k of modelOverrideKeys) { if (defaultModelCapabilities[k]) partialDefaults[k] = defaultModelCapabilities[k] as any; }
	const placeholder = JSON.stringify(partialDefaults, null, 2);

	const [overrideEnabled, setOverrideEnabled] = useState<boolean>(() => !!currentOverrides);

	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	// reset when dialog toggles
	useEffect(() => {
		if (!isOpen) return;
		const cur = settingsState.overridesOfModel?.[providerName]?.[modelName];
		setOverrideEnabled(!!cur);
		setErrorMsg(null);
	}, [isOpen, providerName, modelName, settingsState.overridesOfModel, placeholder]);

	const onSave = async () => {
		// if disabled override, reset overrides
		if (!overrideEnabled) {
			await settingsStateService.setOverridesOfModel(providerName, modelName, undefined);
			onClose();
			return;
		}

		// enabled overrides
		// parse json
		let parsedInput: Record<string, unknown>

		if (textAreaRef.current?.value) {
			try {
				parsedInput = JSON.parse(textAreaRef.current.value);
			} catch (e) {
				setErrorMsg('Invalid JSON');
				return;
			}
		} else {
			setErrorMsg('Invalid JSON');
			return;
		}

		// only keep allowed keys
		const cleaned: Partial<ModelOverrides> = {};
		for (const k of modelOverrideKeys) {
			if (!(k in parsedInput)) continue
			const isEmpty = parsedInput[k] === '' || parsedInput[k] === null || parsedInput[k] === undefined;
			if (!isEmpty) {
				cleaned[k] = parsedInput[k] as any;
			}
		}
		await settingsStateService.setOverridesOfModel(providerName, modelName, cleaned);
		onClose();
	};

	const sourcecodeOverridesLink = `https://github.com/senweaver/SenWeaver/blob/main/src/vs/workbench/contrib/senweaver/common/modelCapabilities.ts#L146-L172`

	return (
		<div // Backdrop
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
			onMouseDown={() => {
				mouseDownInsideModal.current = false;
			}}
			onMouseUp={() => {
				if (!mouseDownInsideModal.current) {
					onClose();
				}
				mouseDownInsideModal.current = false;
			}}
		>
			{/* MODAL */}
			<div
				className="bg-senweaver-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
				onClick={(e) => e.stopPropagation()} // Keep stopping propagation for normal clicks inside
				onMouseDown={(e) => {
					mouseDownInsideModal.current = true;
					e.stopPropagation();
				}}
			>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">
						Change Defaults for {modelName} ({displayInfoOfProviderName(providerName).title})
					</h3>
					<button
						onClick={onClose}
						className="text-senweaver-fg-3 hover:text-senweaver-fg-1"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Display model recognition status */}
				<div className="text-sm text-senweaver-fg-3 mb-4">
					{type === 'default' ? `${modelName} comes packaged with SenWeaver, so you shouldn't need to change these settings.`
						: isUnrecognizedModel
							? `Model not recognized by SenWeaver.`
							: `senweaver recognizes ${modelName} ("${recognizedModelName}").`}
				</div>


				{/* override toggle */}
				<div className="flex items-center gap-2 mb-4">
					<SenweaverSwitch size='xs' value={overrideEnabled} onChange={setOverrideEnabled} />
					<span className="text-senweaver-fg-3 text-sm">Override model defaults</span>
				</div>

				{/* Informational link */}
				{overrideEnabled && <div className="text-sm text-senweaver-fg-3 mb-4">
					<ChatMarkdownRender string={`See the [sourcecode](${sourcecodeOverridesLink}) for a reference on how to set this JSON (advanced).`} chatMessageLocation={undefined} />
				</div>}

				<textarea
					key={overrideEnabled + ''}
					ref={textAreaRef}
					className={`w-full min-h-[200px] p-2 rounded-sm border border-senweaver-border-2 bg-senweaver-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-senweaver-fg-3' : ''}`}
					defaultValue={overrideEnabled && currentOverrides ? JSON.stringify(currentOverrides, null, 2) : placeholder}
					placeholder={placeholder}
					readOnly={!overrideEnabled}
				/>
				{errorMsg && (
					<div className="text-red-500 mt-2 text-sm">{errorMsg}</div>
				)}


				<div className="flex justify-end gap-2 mt-4">
					<SenweaverButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</SenweaverButtonBgDarken>
					<SenweaverButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 bg-[#ECB939] text-white"
					>
						Save
					</SenweaverButtonBgDarken>
				</div>
			</div>
		</div>
	);
};




export const ModelDump = ({ filteredProviders }: { filteredProviders?: ProviderName[] }) => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('ISenweaverSettingsService')
	const settingsState = useSettingsState()

	// State to track which model's settings dialog is open
	const [openSettingsModel, setOpenSettingsModel] = useState<{
		modelName: string,
		providerName: ProviderName,
		type: 'autodetected' | 'custom' | 'default'
	} | null>(null);

	// States for add model functionality
	const [isAddModelOpen, setIsAddModelOpen] = useState(false);
	const [showCheckmark, setShowCheckmark] = useState(false);
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null);
	const [modelName, setModelName] = useState<string>('');
	const [errorString, setErrorString] = useState('');

	// a dump of all the enabled providers' models
	const modelDump: (SenweaverStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []

	// Use either filtered providers or all providers
	// 隐藏 ollama、vLLM、lmStudio 这三个本地提供商
	const hiddenLocalProviders: ProviderName[] = ['ollama', 'vLLM', 'lmStudio'];
	const providersToShow = (filteredProviders || providerNames).filter(pn => !hiddenLocalProviders.includes(pn));

	// 将 ownProvider 排在最前面
	const sortedProvidersToShow = [...providersToShow].sort((a, b) => {
		if (a === 'ownProvider') return -1;
		if (b === 'ownProvider') return 1;
		return 0;
	});

	for (let providerName of sortedProvidersToShow) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
	}

	// sort by provider enabled, but keep ownProvider at the top
	modelDump.sort((a, b) => {
		// ownProvider 始终排在最前面
		if (a.providerName === 'ownProvider' && b.providerName !== 'ownProvider') return -1;
		if (b.providerName === 'ownProvider' && a.providerName !== 'ownProvider') return 1;
		// 其他提供商按 providerEnabled 排序
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	// Providers that can be used to add new models (exclude ownProvider as it's managed via online config)
	const providersForAddModel = providersToShow.filter(pn => pn !== 'ownProvider');

	// Add model handler
	const handleAddModel = () => {
		if (!userChosenProviderName) {
			setErrorString('Please select a provider.');
			return;
		}
		if (!modelName) {
			setErrorString('Please enter a model name.');
			return;
		}

		// Check if model already exists
		if (settingsState.settingsOfProvider[userChosenProviderName].models.find(m => m.modelName === modelName)) {
			setErrorString(`This model already exists.`);
			return;
		}

		settingsStateService.addModel(userChosenProviderName, modelName);
		setShowCheckmark(true);
		setTimeout(() => {
			setShowCheckmark(false);
			setIsAddModelOpen(false);
			setUserChosenProviderName(null);
			setModelName('');
		}, 1500);
		setErrorString('');
	};

	return <div className=''>
		{modelDump.map((m, i) => {
			const { isHidden, type, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Show in Dropdown'
						: 'Hide from Dropdown'
			)


			const hasOverrides = !!settingsState.overridesOfModel?.[providerName]?.[modelName]

			// 获取模型的 displayName
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);
			const displayName = modelCapabilities.displayName || modelName;

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
			>
				{/* left part is width:full */}
				<div className={`flex flex-grow items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? providerTitle : ''}</span>
					<span className='w-fit max-w-[400px] truncate'>{displayName}</span>
				</div>

				{/* right part is anything that fits */}
				<div className="flex items-center gap-2 w-fit">

					{/* Advanced Settings button (gear). Hide entirely when provider/model disabled or when it's ownProvider. */}
					{disabled || providerName === 'ownProvider' ? null : (
						<div className="w-5 flex items-center justify-center">
							<button
								onClick={() => { setOpenSettingsModel({ modelName, providerName, type }) }}
								data-tooltip-id='senweaver-tooltip'
								data-tooltip-place='right'
								data-tooltip-content='Advanced Settings'
								className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
							>
								<SettingsIcon size={12} className="text-senweaver-fg-3 opacity-50" />
							</button>
						</div>
					)}


					{/* Switch */}
					<SenweaverSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='senweaver-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
					/>

					{/* X button */}
					<div className={`w-5 flex items-center justify-center`}>
						{type === 'default' || type === 'autodetected' ? null : <button
							onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}
							data-tooltip-id='senweaver-tooltip'
							data-tooltip-place='right'
							data-tooltip-content='Delete'
							className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
						>
							<X size={12} className="text-senweaver-fg-3 opacity-50" />
						</button>}
					</div>
				</div>
			</div>
		})}

		{/* Add Model Section */}
		{showCheckmark ? (
			<div className="mt-4">
				<AnimatedCheckmarkButton text='Added' className="bg-[#ECB939] text-white px-3 py-1 rounded-sm" />
			</div>
		) : isAddModelOpen ? (
			<div className="mt-4">
				<form className="flex items-center gap-2">

					{/* Provider dropdown */}
					<ErrorBoundary>
						<SenweaverCustomDropdownBox
							options={providersForAddModel}
							selectedOption={userChosenProviderName}
							onChangeOption={(pn) => setUserChosenProviderName(pn)}
							getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionsEqual={(a, b) => a === b}
							className="max-w-32 mx-2 w-full resize-none bg-senweaver-bg-1 text-senweaver-fg-1 placeholder:text-senweaver-fg-3 border border-senweaver-border-2 focus:border-senweaver-border-1 py-1 px-2 rounded"
							arrowTouchesText={false}
						/>
					</ErrorBoundary>

					{/* Model name input */}
					<ErrorBoundary>
						<SenweaverSimpleInputBox
							value={modelName}
							compact={true}
							onChangeValue={setModelName}
							placeholder='Model Name'
							className='max-w-32'
						/>
					</ErrorBoundary>

					{/* Add button */}
					<ErrorBoundary>
						<AddButton
							type='button'
							disabled={!modelName || !userChosenProviderName}
							onClick={handleAddModel}
						/>
					</ErrorBoundary>

					{/* X button to cancel */}
					<button
						type="button"
						onClick={() => {
							setIsAddModelOpen(false);
							setErrorString('');
							setModelName('');
							setUserChosenProviderName(null);
						}}
						className='text-senweaver-fg-4'
					>
						<X className='size-4' />
					</button>
				</form>

				{errorString && (
					<div className='text-red-500 truncate whitespace-nowrap mt-1'>
						{errorString}
					</div>
				)}
			</div>
		) : (
			<div
				className="text-senweaver-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer mt-4"
				onClick={() => setIsAddModelOpen(true)}
			>
				<div className="flex items-center gap-1">
					<Plus size={16} />
					<span>添加模型</span>
				</div>
			</div>
		)}

		{/* Model Settings Dialog */}
		<SimpleModelSettingsDialog
			isOpen={openSettingsModel !== null}
			onClose={() => setOpenSettingsModel(null)}
			modelInfo={openSettingsModel}
		/>
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	// Create a stable callback reference using useCallback with proper dependencies
	const handleChangeValue = useCallback((newVal: string) => {
		senweaverSettingsService.setSettingOfProvider(providerName, settingName, newVal)
	}, [senweaverSettingsService, providerName, settingName]);

	return <ErrorBoundary>
		<div className='my-1'>
			<SenweaverSimpleInputBox
				value={settingValue}
				onChangeValue={handleChangeValue}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
				compact={true}
			/>
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
			</div>}
		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const senweaverSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, senweaverSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const senweaverSettingsService = accessor.get('ISenweaverSettingsService')

// 	// const { enabled } = senweaverSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <SenweaverSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = senweaverSettingsService.state.settingsOfProvider[providerName].enabled
// 						senweaverSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [senweaverSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }


export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const senweaverSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, senweaverSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const senweaverSettingsService = accessor.get('ISenweaverSettingsService')

	// const { enabled } = senweaverSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

			{/* enable provider switch */}
			{/* <SenweaverSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = senweaverSettingsService.state.settingsOfProvider[providerName].enabled
						senweaverSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [senweaverSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
			})}

			{showProviderSuggestions && needsModel ?
				providerName === 'ollama' ?
					<WarningBox className="pl-2 mb-4" text={`Please install an Ollama model. We'll auto-detect it.`} />
					: <WarningBox className="pl-2 mb-4" text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
		</div>
	</div >
}


export const SenweaverProviderSettings = ({ providerNames }: { providerNames: ProviderName[] }) => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
		)}
	</>
}


type TabName = 'models' | 'general'
export const AutoDetectLocalModelsToggle = () => {
	const settingName: GlobalSettingName = 'autoRefreshModels'

	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const metricsService = accessor.get('IMetricsService')

	const senweaverSettingsState = useSettingsState()

	// right now this is just `enabled_autoRefreshModels`
	const enabled = senweaverSettingsState.globalSettings[settingName]

	return <ButtonLeftTextRightOption
		leftButton={<SenweaverSwitch
			size='xxs'
			value={enabled}
			onChange={(newVal) => {
				senweaverSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: newVal })
			}}
		/>}
		text={`自动检测本地提供商和模型 (${refreshableProviderNames.map(providerName => displayInfoOfProviderName(providerName).title).join(', ')}).`}
	/>


}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const senweaverSettingsState = useSettingsState()
	return <SenweaverInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={senweaverSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			senweaverSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		senweaverSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [senweaverSettingsService])

	return <SenweaverCustomDropdownBox
		className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 border border-senweaver-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={senweaverSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>

}


export const OllamaSetupInstructions = ({ sayWeAutoDetect }: { sayWeAutoDetect?: boolean }) => {
	return <div className='prose-p:my-0 prose-ol:list-decimal prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-senweaver-fg-3 text-sm list-decimal select-text'>
		<div className=''><ChatMarkdownRender string={`Ollama 使用说明`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`1. 下载 [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`2. 打开你的终端.`} chatMessageLocation={undefined} /></div>
		<div
			className='pl-6 flex items-center w-fit'
			data-tooltip-id='senweaver-tooltip-ollama-settings'
		>
			<ChatMarkdownRender string={`3. 运行 \`ollama pull your_model\` 安装模型.`} chatMessageLocation={undefined} />
		</div>
		{sayWeAutoDetect && <div className=' pl-6'><ChatMarkdownRender string={`senweaver 自动检测本地运行的模型并启用它们.`} chatMessageLocation={undefined} /></div>}
	</div>
}


// About Update component to display changelogs
const AboutUpdate = () => {
	const [changelogs, setChangelogs] = useState<{ version: string; changelog: string; file_path: string }[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const accessor = useAccessor();
	const productService = accessor.get('IProductService');
	const apiBaseUrl = productService.senweaverApiConfig?.apiBaseUrl || 'https://ide-api.senweaver.com';

	useEffect(() => {
		// Fetch changelogs from API
		const fetchChangelogs = async () => {
			try {
				setLoading(true);
				const response = await fetch(`${apiBaseUrl}/changelogs`, {
					method: 'GET',
					headers: {
						'accept': 'application/json'
					}
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const result = await response.json();
				if (result.success && Array.isArray(result.data)) {
					setChangelogs(result.data);
				} else {
					throw new Error('Invalid API response format');
				}
			} catch (err) {
				console.error('Failed to fetch changelogs:', err);
				setError(err instanceof Error ? err.message : 'Unknown error');
			} finally {
				setLoading(false);
			}
		};

		fetchChangelogs();
	}, []);

	return (
		<div className="flex flex-col gap-6">
			{/* Team Introduction */}
			<div className="prose prose-invert max-w-none">
				<div className="text-center mb-8">
					<h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
						SenWeaver 人工智能团队
					</h1>
					<div className="text-lg text-senweaver-fg-2 space-y-2">
						<p>开源共享一起进步</p>
						<p>我们致力于打造更智能、更高效的 AI 辅助编程工具</p>
						<p>
							开源地址：{' '}
							<a
								href="https://github.com/senweaver"
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-400 hover:text-blue-300 underline"
							>
								github.com/senweaver
							</a>
						</p>
						<p>
							用户协议：{' '}
							<a
								href="https://github.com/senweaver"
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-400 hover:text-blue-300 underline"
							>
								github.com/senweaver
							</a>
						</p>
						<p>
							隐私条款：{' '}
							<a
								href="https://github.com/senweaver"
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-400 hover:text-blue-300 underline"
							>
								github.com/senweaver
							</a>
						</p>
					</div>
				</div>

				<div className="border-t border-senweaver-border-3 my-8" />

				{/* Changelogs Section */}
				<div>
					<h2 className="text-3xl font-semibold mb-6">历史版本更新日志</h2>

					{loading && (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="animate-spin size-8 text-senweaver-fg-3" />
							<span className="ml-3 text-senweaver-fg-3">加载更新日志中...</span>
						</div>
					)}

					{error && (
						<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
							<p className="font-semibold">加载失败</p>
							<p className="text-sm mt-1">{error}</p>
						</div>
					)}

					{!loading && !error && changelogs.length === 0 && (
						<div className="text-center py-12 text-senweaver-fg-3">
							暂无更新日志
						</div>
					)}

					{!loading && !error && changelogs.length > 0 && (
						<div className="space-y-8">
							{changelogs.map((log, index) => (
								<div
									key={log.version}
									className="border border-senweaver-border-3 rounded-lg p-6 bg-senweaver-bg-2/50 hover:bg-senweaver-bg-2 transition-colors"
								>
									<div className="flex items-center justify-between mb-4">
										<h3 className="text-2xl font-semibold text-senweaver-fg-1">
											版本 {log.version}
										</h3>
										{index === 0 && (
											<span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-sm font-medium">
												最新版本
											</span>
										)}
									</div>
									<div className="prose prose-invert max-w-none prose-headings:text-senweaver-fg-1 prose-p:text-senweaver-fg-2 prose-li:text-senweaver-fg-2 prose-strong:text-senweaver-fg-1 prose-code:text-blue-400 prose-code:bg-senweaver-bg-1 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline">
										<ChatMarkdownRender
											string={log.changelog}
											chatMessageLocation={undefined}
										/>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	return <div
		className={`text-senweaver-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { senweaverSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		查看初始化界面?
	</div>

}







export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const senweaverSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		senweaverSettingsService.setGlobalSetting('autoApprove', {
			...senweaverSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [senweaverSettingsService, metricsService])

	return <>
		<SenweaverSwitch
			size={size}
			value={senweaverSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-senweaver-fg-3 text-xs">{desc}</span>
	</>
}



export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })



	const onClick = async () => {
		if (transferState.type !== 'done') return

		setTransferState({ type: 'loading' })

		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)

		// Even if some files were missing, consider it a success if no actual errors occurred
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<SenweaverButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</SenweaverButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}


// full settings

// MCP Server component
const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	const SenweaverSettings = useSettingsState()
	const isOn = SenweaverSettings.mcpUserStateOfName[name]?.isOn

	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className="border border-senweaver-border-2 bg-senweaver-bg-1 py-3 px-4 rounded-sm my-2">
			<div className="flex items-center justify-between">
				{/* Left side - status and name */}
				<div className="flex items-center gap-2">
					{/* Status indicator */}
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-senweaver-fg-3'
										: ''}
					`}></div>

					{/* Server name */}
					<div className="text-sm font-medium text-senweaver-fg-1">{name}</div>
				</div>

				{/* Right side - power toggle switch */}
				<SenweaverSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>

			{/* Tools section */}
			{isOn && (
				<div className="mt-3">
					<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<span
									key={tool.name}
									className="px-2 py-0.5 bg-senweaver-bg-2 text-senweaver-fg-3 rounded-sm text-xs"

									data-tooltip-id='senweaver-tooltip'
									data-tooltip-content={tool.description || ''}
									data-tooltip-class-name='senweaver-max-w-[300px]'
								>
									{removeUniquePrefix(tool.name)}
								</span>
							))
						) : (
							<span className="text-xs text-senweaver-fg-3">No tools available</span>
						)}
					</div>
				</div>
			)}

			{/* Command badge */}
			{isOn && server.command && (
				<div className="mt-3">
					<div className="text-xs text-senweaver-fg-3 mb-1">Command:</div>
					<div className="px-2 py-1 bg-senweaver-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-senweaver-fg-2 rounded-sm">
						{server.command}
					</div>
				</div>
			)}

			{/* Error message if present */}
			{server.error && (
				<div className="mt-3">
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	);
};

// Main component that renders the list of servers
const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()

	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className="text-senweaver-fg-3 text-sm mt-2">
			{mcpServiceState.error}
		</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-senweaver-fg-3 text-sm mt-2">
				未找到服务器
			</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent key={name} name={name} server={server} />
			))
		}
	}

	return <div className="my-2">{content}</div>
};

// Skills list component
const SkillsList = () => {
	const accessor = useAccessor();
	const skillService = accessor.get('ISkillService');
	const [skills, setSkills] = useState<Array<{ name: string; description: string; location: string }>>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const loadSkills = async () => {
			setIsLoading(true);
			await skillService.refresh();
			setSkills(skillService.getAllSkills());
			setIsLoading(false);
		};
		loadSkills();

		// Subscribe to skill service state changes
		const disposable = skillService.onDidChangeState(() => {
			setSkills(skillService.getAllSkills());
		});

		return () => disposable.dispose();
	}, [skillService]);

	const handleOpenSkillsConfig = async () => {
		await skillService.revealSkillsConfigFile();
	};

	const handleDeleteSkill = async (name: string) => {
		if (confirm(`确定要删除技能 "${name}" 吗？`)) {
			await skillService.deleteSkill(name);
		}
	};

	if (isLoading) {
		return <div className="text-senweaver-fg-3 text-sm mt-2 flex items-center gap-2">
			<Loader2 className="size-4 animate-spin" />
			加载中...
		</div>;
	}

	return (
		<div className="my-2">
			{/* Add Skill button */}
			<div className='my-2 mb-4'>
				<SenweaverButtonBgDarken className='px-4 py-1 w-full max-w-48' onClick={handleOpenSkillsConfig}>
					编辑 Skills 配置
				</SenweaverButtonBgDarken>
				<div className="text-senweaver-fg-3 text-xs mt-2">
					点击打开 skills.json 配置文件，添加或编辑技能
				</div>
			</div>

			{/* Skills list */}
			{skills.length === 0 ? (
				<div className="text-senweaver-fg-3 text-sm mt-2">
					未找到 Skills。点击上方按钮打开配置文件添加技能。
				</div>
			) : (
				skills.map((skill) => (
					<div key={skill.name} className="border border-senweaver-border-2 bg-senweaver-bg-1 py-3 px-4 rounded-sm my-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div className="w-2 h-2 rounded-full bg-green-500"></div>
								<div className="text-sm font-medium text-senweaver-fg-1">{skill.name}</div>
							</div>
							<button
								onClick={() => handleDeleteSkill(skill.name)}
								className="text-senweaver-fg-3 hover:text-red-500 transition-colors text-xs px-2 py-1"
								title="删除此技能"
							>
								删除
							</button>
						</div>
						<div className="mt-2 text-xs text-senweaver-fg-3">{skill.description}</div>
					</div>
				))
			)}
		</div>
	);
};

export const Settings = () => {
	const isDark = useIsDark()
	// ─── sidebar nav ──────────────────────────
	const [selectedSection, setSelectedSection] =
		useState<Tab>('models');

	const navItems: { tab: Tab; label: string }[] = [
		{ tab: 'models', label: '模型' },
		// { tab: 'localProviders', label: '本地提供商' },
		{ tab: 'providers', label: '主要提供商' },
		{ tab: 'featureOptions', label: '功能选项' },
		{ tab: 'general', label: '通用设置' },
		{ tab: 'customApi', label: 'API' },
		{ tab: 'mcp', label: 'MCP' },
		{ tab: 'skills', label: 'Skills' },
		{ tab: 'all', label: '所有设置' },
		{ tab: 'aboutUpdate', label: '关于更新' },
	];
	const shouldShowTab = (tab: Tab) => selectedSection === 'all' || selectedSection === tab;
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')
	const storageService = accessor.get('IStorageService')
	const metricsService = accessor.get('IMetricsService')
	const isOptedOut = useIsOptedOut()

	// 获取当前用户ID的函数
	const getCurrentUserID = () => {
		const storageKey = 'senweaver.user.id';
		let userId = localStorage.getItem(storageKey);
		if (!userId) {
			userId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
			localStorage.setItem(storageKey, userId);
		}
		return userId;
	};

	// 应用线上配置的函数
	const applyOnlineConfig = async (config: any) => {
		if (!config) return;

		// 应用模型配置
		if (config.models && Array.isArray(config.models)) {
			for (const model of config.models) {
				const { providerName, modelName, apiKey, baseUrl } = model;

				if (!providerName || !modelName) continue;

				// 添加模型到对应的提供商
				senweaverSettingsService.addModel(providerName, modelName);

				// 设置API Key
				if (apiKey) {
					await senweaverSettingsService.setSettingOfProvider(providerName, 'apiKey', apiKey);
				}

				// 设置Base URL（如果提供商支持）
				if (baseUrl) {
					if (providerName === 'openAICompatible' || providerName === 'ollama' || providerName === 'vLLM' || providerName === 'lmStudio') {
						await senweaverSettingsService.setSettingOfProvider(providerName, 'endpoint', baseUrl);
					} else if (providerName === 'liteLLM' || providerName === 'awsBedrock') {
						await senweaverSettingsService.setSettingOfProvider(providerName, 'endpoint', baseUrl);
					}
				}
			}
		}

		// 应用AI指令配置
		if (config.aiInstructions && typeof config.aiInstructions === 'string') {
			await senweaverSettingsService.setGlobalSetting('aiInstructions', config.aiInstructions);
		}
	};

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			// 导出聊天线程
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'senweaver-chats.json'
		}
		else if (t === 'Settings') {
			// 导出用户设置
			dataStr = JSON.stringify(senweaverSettingsService.state, null, 2)
			downloadName = 'senweaver-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}

		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}


	// Add file input refs
	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const [s, ss] = useState(0)

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);

				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					senweaverSettingsService.dangerousSetState(json as any)
				}

				notificationService.info(`${t} 导入成功！`)
			} catch (err) {
				notificationService.notify({ message: `导入 ${t} 失败`, source: err + '', severity: Severity.Error, })
			}
		};
		reader.readAsText(file);
		e.target.value = '';

		ss(s => s + 1)
	}


	return (
		<div className={`@@senweaver-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto' }}>
			<div className="flex flex-col md:flex-row w-full gap-6 max-w-[900px] mx-auto mb-32" style={{ minHeight: '80vh' }}>
				{/* ──────────────  SIDEBAR  ────────────── */}

				<aside className="md:w-1/4 w-full p-6 shrink-0">
					{/* vertical tab list */}
					<div className="flex flex-col gap-2 mt-12">
						{navItems.map(({ tab, label }) => (
							<button
								key={tab}
								onClick={() => {
									if (tab === 'all') {
										setSelectedSection('all');
										window.scrollTo({ top: 0, behavior: 'smooth' });
									} else {
										setSelectedSection(tab);
									}
								}}
								className={`
          py-2 px-4 rounded-md text-left transition-all duration-200
          ${selectedSection === tab
										? 'bg-white/10 text-senweaver-fg-1 font-medium shadow-sm'
										: 'bg-senweaver-bg-2 hover:bg-senweaver-bg-2/80 text-senweaver-fg-1'}
        `}
							>
								{label}
							</button>
						))}
					</div>
				</aside>

				{/* ───────────── MAIN PANE ───────────── */}
				<main className="flex-1 p-6 select-none">



					<div className='max-w-3xl'>

						<h1 className='text-2xl w-full'>{`设置`}</h1>

						<div className='w-full h-[1px] my-2' />

						{/* Models section (formerly FeaturesTab) - 隐藏查看初始化界面 */}
						{/* <ErrorBoundary>
							<RedoOnboardingButton />
						</ErrorBoundary> */}

						<div className='w-full h-[1px] my-4' />

						{/* All sections in flex container with gap-12 */}
						<div className='flex flex-col gap-12'>
							{/* Models section (formerly FeaturesTab) */}
							<div className={shouldShowTab('models') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>模型</h2>
									<ModelDump />
									<div className='w-full h-[1px] my-4' />
									{/* <AutoDetectLocalModelsToggle /> */}
									{/* <RefreshableModels /> */}
								</ErrorBoundary>
							</div>

							{/* Local Providers section - temporarily hidden */}
							{/* <div className={shouldShowTab('localProviders') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>本地提供商</h2>
									<h3 className={`text-senweaver-fg-3 mb-2`}>{`senweaver 可以访问您本地托管的任何模型。我们默认自动检测您的本地模型。`}</h3>

									<div className='opacity-80 mb-4'>
										<OllamaSetupInstructions sayWeAutoDetect={true} />
									</div>

									<SenweaverProviderSettings providerNames={localProviderNames} />
								</ErrorBoundary>
							</div> */}

							{/* Main Providers section */}
							<div className={shouldShowTab('providers') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>主要提供商</h2>
									<h3 className={`text-senweaver-fg-3 mb-2`}>{`senweaver 可以访问来自 Anthropic、OpenAI、OpenRouter 等的模型。`}</h3>

									<SenweaverProviderSettings providerNames={nonlocalProviderNames} />
								</ErrorBoundary>
							</div>

							{/* Feature Options section */}
							<div className={shouldShowTab('featureOptions') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>功能选项</h2>

									<div className='flex flex-col gap-y-8 my-4'>
										<ErrorBoundary>
											{/* FIM */}
											<div>
												<h4 className={`text-base`}>代码补全</h4>
												<div className='text-sm text-senweaver-fg-3 mt-1'>
													<span>
														自动代码补全，该功能需要 FIM 模型支持，不指定模型时会使用默认的 FIM 模型。{' '}
													</span>
													<span
														className='hover:brightness-110'
														data-tooltip-id='senweaver-tooltip'
														data-tooltip-content='我们建议使用 deepseek官方 中最新的chat模型，因为chat模型支持FIM。'
														data-tooltip-class-name='senweaver-max-w-[20px]'
													>
														（仅适用于 FIM 模型）
													</span>
												</div>

												<div className='my-2'>
													{/* Enable Switch */}
													<ErrorBoundary>
														<div className='flex items-center gap-x-2 my-2'>
															<SenweaverSwitch
																size='xs'
																value={settingsState.globalSettings.enableAutocomplete}
																onChange={(newVal) => senweaverSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
															/>
															<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.enableAutocomplete ? '已启用' : '已禁用'}</span>
														</div>
													</ErrorBoundary>

													{/* Model Dropdown */}
													<ErrorBoundary>
														<div className={`my-2 ${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
															<ModelDropdown featureName={'Autocomplete'} className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 border border-senweaver-border-1 rounded p-0.5 px-1' />
														</div>
													</ErrorBoundary>

												</div>

											</div>
										</ErrorBoundary>

										{/* Apply */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>请求</h4>
												<div className='text-sm text-senweaver-fg-3 mt-1'>控制应用按钮行为的设置。</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<SenweaverSwitch
															size='xs'
															value={settingsState.globalSettings.syncApplyToChat}
															onChange={(newVal) => senweaverSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
														/>
														<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncApplyToChat ? '与聊天模型相同' : '不同模型'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'Apply'} className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 border border-senweaver-border-1 rounded p-0.5 px-1' />
													</div>
												</div>


												<div className='my-2'>
													{/* Fast Apply Method Dropdown */}
													<div className='flex items-center gap-x-2 my-2'>
														<FastApplyMethodDropdown />
													</div>
												</div>

											</div>
										</ErrorBoundary>




										{/* Tools Section */}
										<div>
											<h4 className={`text-base`}>工具</h4>
											<div className='text-sm text-senweaver-fg-3 mt-1'>{`工具是 LLM 可以调用的函数。某些工具需要用户批准。`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													{[...toolApprovalTypes].map((approvalType) => {
														return <div key={approvalType} className="flex items-center gap-x-2 my-2">
															<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`自动批准 ${approvalType}`} />
														</div>
													})}

												</ErrorBoundary>

												{/* Tool Lint Errors Switch */}
												<ErrorBoundary>

													<div className='flex items-center gap-x-2 my-2'>
														<SenweaverSwitch
															size='xs'
															value={settingsState.globalSettings.includeToolLintErrors}
															onChange={(newVal) => senweaverSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
														/>
														<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.includeToolLintErrors ? '修复代码检查错误' : `修复代码检查错误`}</span>
													</div>
												</ErrorBoundary>

												{/* Auto Accept LLM Changes Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<SenweaverSwitch
															size='xs'
															value={settingsState.globalSettings.autoAcceptLLMChanges}
															onChange={(newVal) => senweaverSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)}
														/>
														<span className='text-senweaver-fg-3 text-xs pointer-events-none'>自动接受 LLM 更改</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>



										<div className='w-full'>
											<h4 className={`text-base`}>编辑器</h4>
											<div className='text-sm text-senweaver-fg-3 mt-1'>{`控制 senweaver 建议在代码编辑器中可见性的设置。`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<SenweaverSwitch
															size='xs'
															value={settingsState.globalSettings.showInlineSuggestions}
															onChange={(newVal) => senweaverSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
														/>
														<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.showInlineSuggestions ? '选择时显示建议' : '选择时显示建议'}</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>

										{/* SCM */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('SCM')}</h4>
												<div className='text-sm text-senweaver-fg-3 mt-1'>控制提交消息生成器行为的设置。</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<SenweaverSwitch
															size='xs'
															value={settingsState.globalSettings.syncSCMToChat}
															onChange={(newVal) => senweaverSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
														/>
														<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncSCMToChat ? '与聊天模型相同' : '不同模型'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'SCM'} className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 border border-senweaver-border-1 rounded p-0.5 px-1' />
													</div>
												</div>

											</div>
										</ErrorBoundary>
									</div>
								</ErrorBoundary>
							</div>

							{/* General section */}
							<div className={`${shouldShowTab('general') ? `` : 'hidden'} flex flex-col gap-12`}>
								{/* One-Click Switch section */}
								<div>
									<ErrorBoundary>
										<h2 className='text-3xl mb-2'>一键切换</h2>
										<h4 className='text-senweaver-fg-3 mb-4'>{`将您的编辑器设置转移到 SenWeaver 中。`}</h4>

										<div className='flex flex-col gap-2'>
											<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
											<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
											<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
										</div>
									</ErrorBoundary>
								</div>

								{/* Import/Export section */}
								<div>
									<h2 className='text-3xl mb-2'>导入/导出</h2>
									<h4 className='text-senweaver-fg-3 mb-4'>{`在 Senweaver 中导入和导出 SenWeaver 的设置和聊天记录。`}</h4>
									<div className='flex flex-col gap-8'>
										{/* Settings Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
											<SenweaverButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>
												导入设置
											</SenweaverButtonBgDarken>
											<SenweaverButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>
												导出设置
											</SenweaverButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { senweaverSettingsService.resetState(); }}>
												重置设置
											</ConfirmButton>
										</div>

										{/* Chats Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
											<SenweaverButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>
												导入聊天
											</SenweaverButtonBgDarken>
											<SenweaverButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>
												导出聊天
											</SenweaverButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState(); }}>
												重置聊天
											</ConfirmButton>
										</div>
									</div>
								</div>



								{/* Built-in Settings section */}
								<div>
									<h2 className={`text-3xl mb-2`}>内置设置</h2>
									<h4 className={`text-senweaver-fg-3 mb-4`}>{`IDE 设置、键盘设置和主题自定义。`}</h4>

									<ErrorBoundary>
										<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
											<SenweaverButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
												通用设置
											</SenweaverButtonBgDarken>
											<SenweaverButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
												键盘设置
											</SenweaverButtonBgDarken>
											<SenweaverButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
												主题设置
											</SenweaverButtonBgDarken>
											<SenweaverButtonBgDarken className='px-4 py-1' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
												打开日志
											</SenweaverButtonBgDarken>
										</div>
									</ErrorBoundary>
								</div>


								{/* Metrics section */}
								<div className='max-w-[600px]'>
									<h2 className={`text-3xl mb-2`}>指标</h2>
									<h4 className={`text-senweaver-fg-3 mb-4`}>非常基础的匿名使用跟踪有助于我们保持 senweaver 平稳运行。您可以在下方选择退出。无论此设置如何，senweaver 永远不会看到您的代码、消息或 API 密钥。</h4>

									<div className='my-2'>
										{/* Disable All Metrics Switch */}
										<ErrorBoundary>
											<div className='flex items-center gap-x-2 my-2'>
												<SenweaverSwitch
													size='xs'
													value={isOptedOut}
													onChange={(newVal) => {
														storageService.store(OPT_OUT_KEY, newVal, StorageScope.APPLICATION, StorageTarget.MACHINE)
														metricsService.capture(`Set metrics opt-out to ${newVal}`, {}) // this only fires if it's enabled, so it's fine to have here
													}}
												/>
												<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{'选择退出（需要重启）'}</span>
											</div>
										</ErrorBoundary>
									</div>
								</div>

								{/* AI Instructions section */}
								<div className='max-w-[600px] hidden' >
									<h2 className={`text-3xl mb-2`}>AI 指令</h2>
									<h4 className={`text-senweaver-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
系统指令以包含在所有 AI 请求中.
或者, 在您的 workspace 的根目录下放置一个 \`.senweaverrules\` 文件.
								`} chatMessageLocation={undefined} />
									</h4>
									<ErrorBoundary>
										<AIInstructionsBox />
									</ErrorBoundary>
									{/* --- Disable System Message Toggle --- */}
									<div className='my-4'>
										<ErrorBoundary>
											<div className='flex items-center gap-x-2'>
												<SenweaverSwitch
													size='xs'
													value={!!settingsState.globalSettings.disableSystemMessage}
													onChange={(newValue) => {
														senweaverSettingsService.setGlobalSetting('disableSystemMessage', newValue);
													}}
												/>
												<span className='text-senweaver-fg-3 text-xs pointer-events-none'>
													{'禁用系统指令'}
												</span>
											</div>
										</ErrorBoundary>
										<div className='text-senweaver-fg-3 text-xs mt-1'>
											{`当禁用时, senweaver 不会在系统消息中包含任何内容, 除了您上面指定的内容.`}
										</div>
									</div>
								</div>

							</div>

							{/* Custom API section */}
							<div className={shouldShowTab('customApi') ? `` : 'hidden'}>
								<ErrorBoundary>
									<CustomApiPanel embedded={true} />
								</ErrorBoundary>
							</div>

							{/* MCP section */}
							<div className={shouldShowTab('mcp') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className='text-3xl mb-2'>MCP</h2>
									<h4 className={`text-senweaver-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
使用 Model Context Protocol 为 Agent 模式提供更多工具.
							`} chatMessageLocation={undefined} />
									</h4>
									<div className='my-2'>
										<SenweaverButtonBgDarken className='px-4 py-1 w-full max-w-48' onClick={async () => { await mcpService.revealMCPConfigFile() }}>
											Add MCP Server
										</SenweaverButtonBgDarken>
									</div>

									<ErrorBoundary>
										<MCPServersList />
									</ErrorBoundary>
								</ErrorBoundary>
							</div>

							{/* Skills section */}
							<div className={shouldShowTab('skills') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className='text-3xl mb-2'>Skills</h2>
									<h4 className={`text-senweaver-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
Skills 是可复用的专业指令，帮助 AI 执行特定任务（如代码审查、Git 提交等）。
							`} chatMessageLocation={undefined} />
									</h4>
									<ErrorBoundary>
										<SkillsList />
									</ErrorBoundary>
								</ErrorBoundary>
							</div>

							{/* About Update section */}
							<div className={shouldShowTab('aboutUpdate') ? `` : 'hidden'}>
								<ErrorBoundary>
									<AboutUpdate />
								</ErrorBoundary>
							</div>

						</div>

					</div>
				</main>
			</div>
		</div>
	);
};
