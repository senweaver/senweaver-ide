/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeatureName, featureNames, isFeatureNameDisabled, ModelSelection, modelSelectionsEqual, ProviderName, providerNames, SettingsOfProvider } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsTypes.js'
import { useSettingsState, useRefreshModelState, useAccessor } from '../util/services.js'
import { _SenweaverSelectBox, SenweaverCustomDropdownBox, SenweaverSwitch } from '../util/inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'
import { IconWarning } from '../sidebar-tsx/SidebarChat.js'
import { SENWEAVER_OPEN_SETTINGS_ACTION_ID, SENWEAVER_TOGGLE_SETTINGS_ACTION_ID } from '../../../senweaverSettingsPane.js'
import { modelFilterOfFeatureName, ModelOption } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsService.js'
import { WarningBox } from './WarningBox.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { getModelCapabilities, ModelFeatureTag, AUTO_MODE_MODEL } from '../../../../../../../workbench/contrib/senweaver/common/modelCapabilities.js'
import { Image, Eye, Code, ListTodo, Sparkles, Bot } from 'lucide-react'

const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
	if (m1.length !== m2.length) return false
	for (let i = 0; i < m1.length; i++) {
		if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false
	}
	return true
}

const ModelSelectBox = ({ options, featureName, className }: { options: ModelOption[], featureName: FeatureName, className: string }) => {
	const accessor = useAccessor()
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const settingsState = useSettingsState()

	// Auto Mode 状态
	const autoModeEnabled = settingsState.globalSettings.autoModeEnabled

	const selection = senweaverSettingsService.state.modelSelectionOfFeature[featureName]
	const selectedOption = selection ? senweaverSettingsService.state._modelOptions.find(v => modelSelectionsEqual(v.selection, selection))! : options[0]

	const onChangeOption = useCallback((newOption: ModelOption) => {
		// 如果 Auto Mode 开启，不允许选择其他模型
		if (autoModeEnabled) {
			return
		}
		senweaverSettingsService.setModelSelectionOfFeature(featureName, newOption.selection)
	}, [senweaverSettingsService, featureName, autoModeEnabled])

	// Auto Mode 开关切换，返回是否应该关闭下拉列表
	const onToggleAutoMode = useCallback((enabled: boolean): boolean => {
		senweaverSettingsService.setGlobalSetting('autoModeEnabled', enabled)
		// 当开启 Auto Mode 时，自动设置为预设模型，并关闭下拉列表
		if (enabled) {
			senweaverSettingsService.setModelSelectionOfFeature(featureName, AUTO_MODE_MODEL)
			return true // 关闭下拉列表
		}
		// 当关闭 Auto Mode 时，不选择任何模型，保持下拉列表打开让用户选择
		return false // 保持下拉列表打开
	}, [senweaverSettingsService, featureName])

	// 定义推荐模型列表
	const recommendedModels = ['glm4.7','kimi-k2-thinking'];

	return <SenweaverCustomDropdownBox
		options={options}
		selectedOption={selectedOption}
		onChangeOption={onChangeOption}
		// 当 Auto Mode 开启时，显示 "Auto" 而不是模型名称
		getOptionDisplayName={(option) => {
			if (autoModeEnabled) {
				return 'Auto'
			}
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 优先使用 displayName，如果没有则使用原始名称
			let displayName = modelCapabilities.displayName || modelName;

			// Remove provider prefix (e.g., "google/gemini-..." -> "gemini-...")
			const slashIndex = displayName.indexOf('/');
			return slashIndex !== -1 ? displayName.substring(slashIndex + 1) : displayName;
		}}
		// Auto Mode 时显示名称样式，但仍然显示图标
		displayNameClassName={autoModeEnabled ? 'text-green-400 text-base' : ''}
		// Auto Mode 时始终显示图标
		showIconWhenCustomDisplayName={true}
		getOptionDropdownName={(option) => {
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 优先使用 displayName，如果没有则使用原始名称
			let displayName = modelCapabilities.displayName || modelName;

			return displayName;
		}}
		getOptionLabel={(option) => {
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 只有明确标记为 isFree: true 的才显示 free
			if (modelCapabilities.isFree === true) {
				return 'free';
			}

			// 不再显示 x1，返回 undefined
			return undefined;
		}}
		getOptionFeatureTags={(option) => {
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 获取模型的功能标签
			const featureTags = [...(modelCapabilities.featureTags || [])];

			// 非 ownProvider 的模型添加 'your-api-key' 标签
			if (providerName !== 'ownProvider' && !featureTags.includes('your-api-key')) {
				featureTags.push('your-api-key');
			}

			return featureTags;
		}}
		getOptionIcon={(option) => {
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 使用不同图标和颜色区分视觉支持：
			// - 支持视觉的模型：Eye图标 + 明亮蓝色（原生视觉能力）
			// - 不支持视觉的模型：Image图标 + 深灰色（通过analyze_image工具提供视觉能力）
			if (modelCapabilities.supportsVision) {
				return (
					<Eye
						size={15}
						className="text-[#42A5F5]"
						strokeWidth={2.5}
						data-tooltip-id="senweaver-tooltip"
						data-tooltip-content="原生支持视觉"
					/>
				);
			} else {
				return (
					<Image
						size={14}
						className="text-senweaver-fg-5"
						strokeWidth={1.8}
						data-tooltip-id="senweaver-tooltip"
						data-tooltip-content="通过工具支持视觉"
					/>
				);
			}
		}}
		getOptionIsDisabled={(option) => {
			// 如果 Auto Mode 开启，禁用所有模型选择
			if (autoModeEnabled) {
				return true;
			}

			// 如果输入价格超过 2，禁用该模型
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 免费模型不禁用
			if (modelCapabilities.isFree === true) {
				return false;
			}

			// 检查输入价格禁用模型
			const { cost } = modelCapabilities;
			if (cost && cost.input > 2) {
				return true;
			}

			return false;
		}}
		getOptionTooltip={(option) => {
			// 如果 Auto Mode 开启，提示用户先关闭
			if (autoModeEnabled) {
				return '请先关闭 Auto Mode 再选择模型';
			}

			// 如果被禁用，显示提示
			const { providerName, modelName } = option.selection;
			const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);

			// 免费模型不需要提示
			if (modelCapabilities.isFree === true) {
				return undefined;
			}

			// 检查是否因价格被禁用
			const { cost } = modelCapabilities;
			if (cost && cost.input > 2) {
				return '余额不足使用高速模型';
			}

			return undefined;
		}}
		getOptionGroup={(option) => {
			const modelName = option.selection.modelName;
			const shortName = modelName.includes('/') ? modelName.substring(modelName.indexOf('/') + 1) : modelName;
			return recommendedModels.includes(shortName) ? '最新推荐' : '全部';
		}}
		getOptionsEqual={(a, b) => optionsEqual([a], [b])}
		className={className}
		matchInputWidth={false}
		// Auto Mode 开关渲染，返回是否应该关闭下拉列表
		renderHeaderContent={(closeDropdown) => (
			<div className="flex items-center justify-between px-2 py-1.5 border-b border-senweaver-border-3">
				<div className="flex items-center gap-2">
					<Bot size={14} className="text-senweaver-fg-3" />
					<span className="text-sm text-senweaver-fg-2">Auto Mode</span>
				</div>
				<SenweaverSwitch
					value={autoModeEnabled}
					onChange={(enabled) => {
						const shouldClose = onToggleAutoMode(enabled)
						if (shouldClose) {
							closeDropdown()
						}
					}}
					size="xs"
				/>
			</div>
		)}
	/>
}


const MemoizedModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()
	const oldOptionsRef = useRef<ModelOption[]>([])
	const [memoizedOptions, setMemoizedOptions] = useState(oldOptionsRef.current)

	const { filter, emptyMessage } = modelFilterOfFeatureName[featureName]

	useEffect(() => {
		const oldOptions = oldOptionsRef.current
		const newOptions = settingsState._modelOptions.filter((o) => filter(o.selection, { chatMode: settingsState.globalSettings.chatMode, overridesOfModel: settingsState.overridesOfModel }))

		if (!optionsEqual(oldOptions, newOptions)) {
			setMemoizedOptions(newOptions)
		}
		oldOptionsRef.current = newOptions
	}, [settingsState._modelOptions, filter])

	if (memoizedOptions.length === 0) { // Pretty sure this will never be reached unless filter is enabled
		return <WarningBox text={emptyMessage?.message || 'No models available'} />
	}

	return <ModelSelectBox featureName={featureName} options={memoizedOptions} className={className} />

}

export const ModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const openSettings = () => { commandService.executeCommand(SENWEAVER_OPEN_SETTINGS_ACTION_ID); };


	const { emptyMessage } = modelFilterOfFeatureName[featureName]

	const isDisabled = isFeatureNameDisabled(featureName, settingsState)
	if (isDisabled)
		return <WarningBox onClick={openSettings} text={
			emptyMessage && emptyMessage.priority === 'always' ? emptyMessage.message :
				isDisabled === 'needToEnableModel' ? 'Enable a model'
					: isDisabled === 'addModel' ? 'Add a model'
						: (isDisabled === 'addProvider' || isDisabled === 'notFilledIn' || isDisabled === 'providerNotAutoDetected') ? 'Provider required'
							: 'Provider required'
		} />

	return <ErrorBoundary>
		<MemoizedModelDropdown featureName={featureName} className={className} />
	</ErrorBoundary>
}
