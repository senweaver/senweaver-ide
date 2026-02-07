/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useSettingsState, useActiveURI, useCommandBarState, useFullChatThreadsStreamState, useAnyThreadRunning } from '../util/services.js';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';

import { ChatMarkdownRender, ChatMessageLocation, getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { BlockCode, TextAreaFns, SenweaverCustomDropdownBox, SenweaverInputBox2, SenweaverSlider, SenweaverSwitch, SenweaverDiffEditor } from '../util/inputs.js';
import { ModelDropdown, } from '../senweaver-settings-tsx/ModelDropdown.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import { SENWEAVER_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { extractEditorsDropData } from '../../../../../../../platform/dnd/browser/dnd.js';
import { SENWEAVER_OPEN_SETTINGS_ACTION_ID } from '../../../senweaverSettingsPane.js';
import { ChatMode, displayInfoOfProviderName, FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/senweaver/common/senweaverSettingsTypes.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { WarningBox } from '../senweaver-settings-tsx/WarningBox.js';
import { getModelCapabilities, getIsReasoningEnabledState } from '../../../../common/modelCapabilities.js';
import { AlertTriangle, File, Ban, Check, ChevronRight, Dot, FileIcon, Pencil, Undo, Undo2, X, Flag, Copy as CopyIcon, Info, CirclePlus, Ellipsis, CircleEllipsis, Folder, ALargeSmall, TypeOutline, Text, MessageSquare, Bot, BookOpen, Palette, Terminal } from 'lucide-react';
import { ChatMessage, CheckpointEntry, StagingSelectionItem, ToolMessage, ImageAttachment } from '../../../../common/chatThreadServiceTypes.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, BuiltinToolName, ToolName, LintErrorItem, ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js';
import { CopyButton, EditToolAcceptRejectButtonsHTML, IconShell1, JumpToFileButton, JumpToTerminalButton, StatusIndicator, StatusIndicatorForApplyButton, useApplyStreamState, useEditToolStreamState } from '../markdown/ApplyBlockHoverButtons.js';
import { IsRunningType } from '../../../chatThreadService.js';
import { acceptAllBg, acceptBorder, buttonFontSize, buttonTextColor, rejectAllBg, rejectBg, rejectBorder } from '../../../../common/helpers/colors.js';
import { builtinToolNames, isABuiltinToolName, MAX_FILE_CHARS_PAGE, MAX_TERMINAL_INACTIVE_TIME } from '../../../../common/prompt/prompts.js';
import { RawToolCallObj } from '../../../../common/sendLLMMessageTypes.js';
import ErrorBoundary from './ErrorBoundary.js';
import { ToolApprovalTypeSwitch } from '../senweaver-settings-tsx/Settings.js';

import { persistentTerminalNameOfId } from '../../../terminalToolService.js';
import { removeMCPToolNamePrefix } from '../../../../common/mcpServiceTypes.js';
import { DesignerMessageRenderer } from '../design-canvas/DesignerMessageRenderer.js';
import { DesignerPreviewPanel } from '../design-canvas/DesignerPreviewPanel.js';
import { DesignData, NavigationLink } from '../design-canvas/DesignerCanvas.js';
import { DesignTaskProgress, DesignTaskProgressIndicator, extractTaskProgressFromMessage, calculateTaskProgress } from './DesignTaskProgress.js';

export const IconX = ({ size, className = '', ...props }: { size: number, className?: string } & React.SVGProps<SVGSVGElement>) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			className={className}
			{...props}
		>
			<path
				strokeLinecap='round'
				strokeLinejoin='round'
				d='M6 18 18 6M6 6l12 12'
			/>
		</svg>
	);
};

const IconArrowUp = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			width={size}
			height={size}
			className={className}
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="black"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
			></path>
		</svg>
	);
};


const IconSquare = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="black"
			fill="black"
			strokeWidth="0"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
		</svg>
	);
};


export const IconWarning = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="currentColor"
			fill="currentColor"
			strokeWidth="0"
			viewBox="0 0 16 16"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z"
			/>
		</svg>
	);
};


export const IconLoading = ({ className = '', text }: { className?: string, text?: string }) => {

	const [loadingText, setLoadingText] = useState('.');

	// Perf: Use functional update to avoid recreating interval on every state change
	useEffect(() => {
		const intervalId = setInterval(() => {
			setLoadingText(prev => prev === '...' ? '.' : prev + '.');
		}, 300);

		return () => clearInterval(intervalId);
	}, []); // Empty deps - interval created once

	return <div className={`${className}`}>
		{text ? <span>{text} {loadingText}</span> : loadingText}
	</div>;

}

// Clean up invalid tool call formats and internal tags that should not be displayed to users
// This handles cases where LLM returns malformed tool calls like "<<<<<<< read_file", ".edit_file", or "<invoke name=\"edit_file\">"
// Also removes internal thinking/reasoning tags that should never be visible to users
const cleanInvalidToolCallFormats = (content: string): string => {
	if (!content) return content
	let cleaned = content

	// 🚫 FIRST PRIORITY: Detect if content is primarily a tool call and return empty
	// This is the most aggressive filter - if content starts with a tool tag, it's a tool call being streamed
	const toolCallStartPattern = /^\s*<(write_to_file|read_file|edit_file|rewrite_file|create_file|delete_file|create_file_or_folder|delete_file_or_folder|ls_dir|get_dir_tree|search_pathnames_only|search_for_files|search_in_file|run_command|run_persistent_command|open_persistent_terminal|kill_persistent_terminal|open_browser|fetch_url|web_search|api_request|read_document|edit_document|create_document|pdf_operation|document_convert|document_merge|document_extract|read_lint_errors|analyze_image|screenshot_to_code|tool_call|function_call|tool_use|function)>/i
	if (toolCallStartPattern.test(cleaned)) {
		return '' // Content is a tool call being streamed, don't show to user
	}

	// Also check if content contains tool closing tags at the end (tool call just finished)
	const toolCallEndPattern = /<\/(write_to_file|read_file|edit_file|rewrite_file|create_file|delete_file|create_file_or_folder|delete_file_or_folder|ls_dir|get_dir_tree|search_pathnames_only|search_for_files|search_in_file|run_command|run_persistent_command|open_persistent_terminal|kill_persistent_terminal|open_browser|fetch_url|web_search|api_request|read_document|edit_document|create_document|pdf_operation|document_convert|document_merge|document_extract|read_lint_errors|analyze_image|screenshot_to_code|tool_call|function_call|tool_use|function)>\s*$/i
	if (toolCallEndPattern.test(cleaned)) {
		// Remove everything from the tool start tag to the end
		cleaned = cleaned.replace(/<(write_to_file|read_file|edit_file|rewrite_file|create_file|delete_file|create_file_or_folder|delete_file_or_folder|ls_dir|get_dir_tree|search_pathnames_only|search_for_files|search_in_file|run_command|run_persistent_command|open_persistent_terminal|kill_persistent_terminal|open_browser|fetch_url|web_search|api_request|read_document|edit_document|create_document|pdf_operation|document_convert|document_merge|document_extract|read_lint_errors|analyze_image|screenshot_to_code|tool_call|function_call|tool_use|function)>[\s\S]*$/gi, '')
	}

	// Remove ALL thinking/reasoning tags (internal processing tags should NEVER be visible)
	// Remove complete <think>...</think> and <thinking>...</thinking> blocks
	cleaned = cleaned.replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/gi, '')
	// Remove orphaned opening tags (streaming case - tag started but not closed yet)
	cleaned = cleaned.replace(/<(?:think|thinking)>[\s\S]*$/gi, '')
	// Remove orphaned closing tags (streaming case - only closing tag visible)
	cleaned = cleaned.replace(/<\/(?:think|thinking)>/gi, '')
	// Remove standalone opening tags at end of content
	cleaned = cleaned.replace(/<(?:think|thinking)>\s*$/gi, '')
	// Remove <reasoning>...</reasoning> blocks
	cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
	cleaned = cleaned.replace(/<reasoning>[\s\S]*$/gi, '')
	cleaned = cleaned.replace(/<\/reasoning>/gi, '')

	// 🚫 CRITICAL: Remove ALL tool protocol XML tags (these should NEVER be visible to users during streaming)
	// Complete list of all builtin tool names
	const toolTags = [
		// File operations
		'read_file', 'write_to_file', 'edit_file', 'rewrite_file', 'create_file', 'delete_file',
		'create_file_or_folder', 'delete_file_or_folder', 'ls_dir', 'get_dir_tree',
		// Search operations
		'search_pathnames_only', 'search_for_files', 'search_in_file', 'search_files', 'list_files',
		// Terminal operations
		'run_command', 'run_persistent_command', 'open_persistent_terminal', 'kill_persistent_terminal',
		// Web operations
		'open_browser', 'fetch_url', 'web_search', 'api_request',
		// Document operations
		'read_document', 'edit_document', 'create_document', 'pdf_operation',
		'document_convert', 'document_merge', 'document_extract', 'read_lint_errors',
		// Vision/AI operations
		'analyze_image', 'screenshot_to_code',
		// Generic tool wrappers
		'tool_call', 'function_call', 'tool_use', 'function'
	]
	const toolTagPattern = toolTags.join('|')
	// Remove complete tool blocks
	cleaned = cleaned.replace(new RegExp(`<(${toolTagPattern})>[\\s\\S]*?<\\/\\1>`, 'gi'), '')
	// Remove orphaned opening tool tags with content (streaming case)
	cleaned = cleaned.replace(new RegExp(`<(${toolTagPattern})>[\\s\\S]*$`, 'gi'), '')
	// Remove orphaned closing tool tags
	cleaned = cleaned.replace(new RegExp(`<\\/(${toolTagPattern})>`, 'gi'), '')
	// Remove standalone opening tool tags
	cleaned = cleaned.replace(new RegExp(`<(${toolTagPattern})>\\s*$`, 'gi'), '')

	// Complete list of all tool parameter tags
	const paramTags = [
		// Common params
		'path', 'uri', 'url', 'file_path', 'input_file', 'output_path', 'output_dir',
		'content', 'new_content', 'old_content', 'text',
		// Line/position params
		'line_count', 'start_line', 'end_line', 'start_index', 'max_length', 'page_number',
		// Search params
		'query', 'pattern', 'replacement', 'search_replace_blocks', 'is_regex', 'include_pattern', 'search_in_folder',
		// Command params
		'command', 'cwd', 'blocking', 'persistent_terminal_id',
		// Web params
		'method', 'headers', 'body', 'auth', 'timeout', 'max_results', 'crawl_links', 'max_pages', 'max_depth',
		// Document params
		'type', 'format', 'document_data', 'options', 'backup', 'replacements',
		'operation', 'input_files', 'watermark_text', 'extract_type',
		// Vision params
		'image_data', 'source', 'stack', 'custom_prompt', 'prompt', 'api_key', 'model', 'headless',
		// Other params
		'directory', 'is_recursive', 'same_domain_only'
	]
	const paramTagPattern = paramTags.join('|')
	// Remove complete param blocks
	cleaned = cleaned.replace(new RegExp(`<(${paramTagPattern})>[\\s\\S]*?<\\/\\1>`, 'gi'), '')
	// Remove orphaned opening param tags with content (streaming case)
	cleaned = cleaned.replace(new RegExp(`<(${paramTagPattern})>[\\s\\S]*$`, 'gi'), '')
	// Remove orphaned closing param tags
	cleaned = cleaned.replace(new RegExp(`<\\/(${paramTagPattern})>`, 'gi'), '')
	// Remove standalone opening param tags
	cleaned = cleaned.replace(new RegExp(`<(${paramTagPattern})>\\s*$`, 'gi'), '')

	// 🚫 FALLBACK: Generic XML-like tag removal for any remaining tool protocol tags
	// This catches any tags that look like tool parameters (snake_case or simple lowercase)
	// Remove complete blocks: <some_tag>...</some_tag>
	cleaned = cleaned.replace(/<([a-z][a-z0-9_]*)>[\s\S]*?<\/\1>/gi, (match, tagName) => {
		// Don't remove common HTML tags
		const htmlTags = ['div', 'span', 'p', 'a', 'b', 'i', 'u', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'blockquote', 'details', 'summary']
		if (htmlTags.includes(tagName.toLowerCase())) return match
		return ''
	})
	// Remove orphaned opening tags with content (streaming): <some_tag>...
	cleaned = cleaned.replace(/<([a-z][a-z0-9_]*)>[\s\S]*$/gi, (match, tagName) => {
		const htmlTags = ['div', 'span', 'p', 'a', 'b', 'i', 'u', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'blockquote', 'details', 'summary']
		if (htmlTags.includes(tagName.toLowerCase())) return match
		return ''
	})
	// Remove orphaned closing tags: </some_tag>
	cleaned = cleaned.replace(/<\/([a-z][a-z0-9_]*)>/gi, (match, tagName) => {
		const htmlTags = ['div', 'span', 'p', 'a', 'b', 'i', 'u', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'blockquote', 'details', 'summary']
		if (htmlTags.includes(tagName.toLowerCase())) return match
		return ''
	})

	// Remove lines starting with "<<<<<<< " followed by a tool name (malformed git-style markers)
	cleaned = cleaned.replace(/^<{3,}\s*(read_file|edit_file|rewrite_file|ls_dir|get_dir_tree|search_pathnames_only|search_for_files|search_in_file|run_terminal_cmd|web_search|fetch_url|analyze_image|read_lint_errors|open_browser|screenshot_browser).*$/gim, '')
	// Remove standalone tool names on their own line (like ".edit_file" or "edit_file" or "read_file>")
	cleaned = cleaned.replace(/^\.?(read_file|edit_file|rewrite_file|ls_dir|get_dir_tree|search_pathnames_only|search_for_files|search_in_file|run_terminal_cmd|web_search|fetch_url|analyze_image|read_lint_errors|open_browser|screenshot_browser)>?\s*$/gim, '')
	// Remove orphaned XML parameter tags without proper tool wrapper (single or multiple on same line)
	cleaned = cleaned.replace(/(<(start_line|end_line|uri|query|is_regex|new_content|search_replace_blocks|command|url|max_results|line_count|start_index|max_length|page_number)>[^<]*<\/\2>\s*)+/gim, '')
	// Remove orphaned parameter tags with just numbers or simple values
	cleaned = cleaned.replace(/<(start_line|end_line|line_count|start_index|max_length|page_number)>\s*\d+\s*<\/\1>/gi, '')
	// Remove <invoke name="tool_name"> ... </invoke> patterns (malformed Anthropic-style tool calls)
	// 匹配中间有空白或少量内容的情况
	cleaned = cleaned.replace(/<invoke\s+name\s*=\s*["'][^"']*["']\s*>[\s\S]{0,50}<\/invoke>/gi, '')
	// 移除单独的 <invoke name="..."> </invoke> 行（中间可能有空格）
	cleaned = cleaned.replace(/^<invoke\s+name\s*=\s*["'][^"']*["']\s*>\s*<\/invoke>\s*$/gim, '')
	// Remove partial/incomplete invoke tags
	cleaned = cleaned.replace(/<invoke\s+name\s*=\s*["'][^"']*["']\s*>\s*$/gim, '')
	cleaned = cleaned.replace(/^\s*<\/invoke>\s*$/gim, '')
	// Remove <invoke> and </invoke> patterns
	cleaned = cleaned.replace(/<invoke\s+name\s*=\s*["'][^"']*["']\s*>[\s\S]*?<\/antml:invoke>/gi, '')
	cleaned = cleaned.replace(/<invoke[^>]*>\s*$/gim, '')
	cleaned = cleaned.replace(/^\s*<\/antml:invoke>\s*$/gim, '')
	// Remove <edit_file_result>, <read_file_result>, <tool_result> and similar system result tags
	cleaned = cleaned.replace(/<(edit_file_result|read_file_result|tool_result|function_result|command_result|search_result|fetch_result|browser_result|lint_result|image_result)[^>]*>[\s\S]*?<\/\1>/gi, '')
	// Remove partial/orphaned result tags
	cleaned = cleaned.replace(/<(edit_file_result|read_file_result|tool_result|function_result|command_result|search_result|fetch_result|browser_result|lint_result|image_result)[^>]*>[^<]*$/gim, '')
	cleaned = cleaned.replace(/^[^<]*<\/(edit_file_result|read_file_result|tool_result|function_result|command_result|search_result|fetch_result|browser_result|lint_result|image_result)>/gim, '')
	// Remove any remaining XML-like tags that look like system messages (e.g., <*>, <system_*>)
	cleaned = cleaned.replace(/<[^>]*>[\s\S]*?<\/antml:[^>]*>/gi, '')
	cleaned = cleaned.replace(/<system_[^>]*>[\s\S]*?<\/system_[^>]*>/gi, '')
	// Clean up multiple consecutive empty lines
	cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
	return cleaned.trim()
}



// SLIDER ONLY:
const ReasoningOptionSlider = ({ featureName }: { featureName: FeatureName }) => {
	const accessor = useAccessor()

	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const senweaverSettingsState = useSettingsState()

	const modelSelection = senweaverSettingsState.modelSelectionOfFeature[featureName]
	const overridesOfModel = senweaverSettingsState.overridesOfModel

	if (!modelSelection) return null

	const { modelName, providerName } = modelSelection
	const { reasoningCapabilities } = getModelCapabilities(providerName, modelName, overridesOfModel)
	const { canTurnOffReasoning, reasoningSlider: reasoningBudgetSlider } = reasoningCapabilities || {}

	const modelSelectionOptions = senweaverSettingsState.optionsOfModelSelection[featureName][providerName]?.[modelName]
	const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)

	if (canTurnOffReasoning && !reasoningBudgetSlider) { // if it's just a on/off toggle without a power slider
		return <div className='flex items-center gap-x-2'>
			<span className='text-senweaver-fg-3 text-xs pointer-events-none inline-block w-10 pr-1'>思考</span>
			<SenweaverSwitch
				size='xxs'
				value={isReasoningEnabled}
				onChange={(newVal) => {
					const isOff = canTurnOffReasoning && !newVal
					senweaverSettingsService.setOptionsOfModelSelection(featureName, modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: !isOff })
				}}
			/>
		</div>
	}

	if (reasoningBudgetSlider?.type === 'budget_slider') { // if it's a slider
		const { min: min_, max, default: defaultVal } = reasoningBudgetSlider

		const nSteps = 8 // only used in calculating stepSize, stepSize is what actually matters
		const stepSize = Math.round((max - min_) / nSteps)

		const valueIfOff = min_ - stepSize
		const min = canTurnOffReasoning ? valueIfOff : min_
		const value = isReasoningEnabled ? senweaverSettingsState.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]?.reasoningBudget ?? defaultVal
			: valueIfOff

		return <div className='flex items-center gap-x-2'>
			<span className='text-senweaver-fg-3 text-xs pointer-events-none inline-block w-10 pr-1'>思考</span>
			<SenweaverSlider
				width={50}
				size='xs'
				min={min}
				max={max}
				step={stepSize}
				value={value}
				onChange={(newVal) => {
					const isOff = canTurnOffReasoning && newVal === valueIfOff
					senweaverSettingsService.setOptionsOfModelSelection(featureName, modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: !isOff, reasoningBudget: newVal })
				}}
			/>
			<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{isReasoningEnabled ? `${value} tokens` : 'Thinking disabled'}</span>
		</div>
	}

	if (reasoningBudgetSlider?.type === 'effort_slider') {

		const { values, default: defaultVal } = reasoningBudgetSlider

		const min = canTurnOffReasoning ? -1 : 0
		const max = values.length - 1

		const currentEffort = senweaverSettingsState.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]?.reasoningEffort ?? defaultVal
		const valueIfOff = -1
		const value = isReasoningEnabled && currentEffort ? values.indexOf(currentEffort) : valueIfOff

		const currentEffortCapitalized = currentEffort.charAt(0).toUpperCase() + currentEffort.slice(1, Infinity)

		return <div className='flex items-center gap-x-2'>
			<span className='text-senweaver-fg-3 text-xs pointer-events-none inline-block w-10 pr-1'>思考</span>
			<SenweaverSlider
				width={30}
				size='xs'
				min={min}
				max={max}
				step={1}
				value={value}
				onChange={(newVal) => {
					const isOff = canTurnOffReasoning && newVal === valueIfOff
					senweaverSettingsService.setOptionsOfModelSelection(featureName, modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: !isOff, reasoningEffort: values[newVal] ?? undefined })
				}}
			/>
			<span className='text-senweaver-fg-3 text-xs pointer-events-none'>{isReasoningEnabled ? `${currentEffortCapitalized}` : 'Thinking disabled'}</span>
		</div>
	}

	return null
}



const nameOfChatMode = {
	'normal': 'Chat',
	'gather': 'Reader',
	'agent': 'Agent with Tools',
	'designer': 'Designer with Builder',
}

const detailOfChatMode = {
	'normal': '聊聊你的代码和编写代码',
	'gather': '读取文件,但不能编辑',
	'agent': '续写、编辑文件、使用工具、调用mcp',
	'designer': '从界面开始完成生成UI设计、组件和线框图等，到后端接口开发全流程设计和管理',
}

const iconOfChatMode = {
	'normal': <MessageSquare className="size-4" />,
	'gather': <BookOpen className="size-4" />,
	'agent': <Bot className="size-4" />,
	'designer': <Palette className="size-4" />,
}

const tooltipOfChatMode = {
	'normal': 'Chat - 聊聊你的代码和编写代码',
	'gather': 'Reader - 读取文件,但不能编辑',
	'agent': 'Agent with Tools - 续写、编辑文件、使用工具、调用mcp',
	'designer': 'Designer with Builder - 从界面开始完成生成UI设计、组件和线框图等，到后端接口开发全流程设计和管理',
}


const ChatModeDropdown = ({ className }: { className: string }) => {
	const accessor = useAccessor()

	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const settingsState = useSettingsState()

	const options: ChatMode[] = useMemo(() => ['normal', 'agent', 'designer'], [])

	const onChangeOption = useCallback((newVal: ChatMode) => {
		senweaverSettingsService.setGlobalSetting('chatMode', newVal)
	}, [senweaverSettingsService])

	return <SenweaverCustomDropdownBox
		className={className}
		options={options}
		selectedOption={settingsState.globalSettings.chatMode}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => nameOfChatMode[val]}
		getOptionDropdownName={(val) => nameOfChatMode[val]}
		getOptionDropdownDetail={(val) => detailOfChatMode[val]}
		getOptionIcon={(val) => iconOfChatMode[val]}
		getOptionTooltip={(val) => tooltipOfChatMode[val]}
		getOptionsEqual={(a, b) => a === b}
	/>

}





interface SenweaverChatAreaProps {
	// Required
	children: React.ReactNode; // This will be the input component

	// Form controls
	onSubmit: () => void;
	onAbort: () => void;
	isStreaming: boolean;
	isDisabled?: boolean;
	divRef?: React.RefObject<HTMLDivElement | null>;

	// UI customization
	className?: string;
	showModelDropdown?: boolean;
	showSelections?: boolean;
	showProspectiveSelections?: boolean;
	loadingIcon?: React.ReactNode;

	selections?: StagingSelectionItem[]
	setSelections?: (s: StagingSelectionItem[]) => void
	// selections?: any[];
	// onSelectionsChange?: (selections: any[]) => void;

	onClickAnywhere?: () => void;
	// Optional close button
	onClose?: () => void;

	featureName: FeatureName;
}

export const SenweaverChatArea: React.FC<SenweaverChatAreaProps> = ({
	children,
	onSubmit,
	onAbort,
	onClose,
	onClickAnywhere,
	divRef,
	isStreaming = false,
	isDisabled = false,
	className = '',
	showModelDropdown = true,
	showSelections = false,
	showProspectiveSelections = false,
	selections,
	setSelections,
	featureName,
	loadingIcon,
}) => {
	const accessor = useAccessor()
	const modelReferenceService = accessor.get('ISenweaverModelService')
	const chatThreadService = accessor.get('IChatThreadService')
	const languageService = accessor.get('ILanguageService')
	const fileService = accessor.get('IFileService')
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')

	const settingsState = useSettingsState()
	const chatMode = settingsState.globalSettings.chatMode

	const [isDragOver, setIsDragOver] = useState(false)

	// Log once on mount to confirm code is loaded
	useEffect(() => {
	}, [])

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragOver(true)
	}, [])

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragOver(false)
	}, [])

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragOver(false)

		// IMPORTANT: Extract data BEFORE any async operations
		// React synthetic events are pooled and cleared after the handler
		const nativeEvent = e.nativeEvent as DragEvent
		const filesArray = Array.from(e.dataTransfer.files)

		// Check if it's a design unit drag
		try {
			const jsonData = e.dataTransfer.getData('application/json')
			if (jsonData) {
				const dragData = JSON.parse(jsonData)
				if (dragData.type === 'designUnit' && dragData.index !== undefined) {
					// Trigger the edit design functionality via message passing
					window.postMessage({
						type: 'editDesignFromDrag',
						index: dragData.index
					}, '*')
					return
				}
			}
		} catch (error) {

		}

		// Extract editors data immediately (before any await)
		const editorInputs = extractEditorsDropData(nativeEvent)

		// Process image files from editorInputs (dragged from VS Code explorer)
		const imageUris: URI[] = []
		const newSelections: StagingSelectionItem[] = []

		for (const input of editorInputs) {
			if (!input.resource) continue

			try {
				const stat = await fileService.stat(input.resource)

				if (stat.isDirectory) {
					newSelections.push({
						type: 'Folder',
						uri: input.resource,
						language: undefined,
						state: undefined,
					})
				} else {
					// Check if it's an image file
					const isImage = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(input.resource.fsPath)

					if (isImage) {
						imageUris.push(input.resource)
					} else {
						const language = languageService.guessLanguageIdByFilepathOrFirstLine(input.resource) || 'plaintext'
						newSelections.push({
							type: 'File',
							uri: input.resource,
							language: language,
							state: { wasAddedAsCurrentFile: false },
						})
					}
				}
			} catch (error) {
			}
		}

		// Process image URIs by reading files and converting to base64
		if (imageUris.length > 0) {
			try {
				const processedImages: ImageAttachment[] = []

				for (const uri of imageUris) {
					try {
						// Read file content
						const content = await fileService.readFile(uri)
						const buffer = content.value.buffer
						const size = content.value.byteLength

						// Convert to base64
						const base64Data = btoa(
							new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
						)

						// Determine mime type from extension
						const ext = uri.path.split('.').pop()?.toLowerCase() || 'png'
						const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
						const name = uri.path.split('/').pop() || 'image'

						processedImages.push({
							id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
							name,
							base64Data,
							mimeType,
							size,
							uploadStatus: 'pending' as const,
						})

					} catch (error) {

					}
				}

				// Add to current thread's uploadedImages and trigger upload
				if (processedImages.length > 0) {
					const currentThread = chatThreadService.getCurrentThread()
					if (currentThread) {
						const existingImages = currentThread.state.uploadedImages || []
						// 先添加到状态中（显示pending状态）
						chatThreadService.setCurrentThreadState({
							uploadedImages: [...existingImages, ...processedImages]
						})

						// 然后触发上传
						const { uploadImagesWithProgress } = await import('../util/imageUtils.js')
						uploadImagesWithProgress(processedImages, (updatedImages) => {
							// 更新上传状态
							const thread = chatThreadService.getCurrentThread()
							if (thread) {
								const existing = thread.state.uploadedImages || []
								// 替换正在上传的图片为更新后的状态
								const merged = existing.map(img => {
									const updated = updatedImages.find(u => u.id === img.id)
									return updated || img
								})
								chatThreadService.setCurrentThreadState({
									uploadedImages: merged
								})
							}
						})
					}
				}
			} catch (error) {

			}
		}

		// Handle image files from FileList (for images dragged from OS)
		const osImageFiles: File[] = filesArray.filter(file => file.type.startsWith('image/'))

		if (osImageFiles.length > 0) {
			try {
				const { processImageFiles, uploadImagesWithProgress } = await import('../util/imageUtils.js')
				const processedImages = await processImageFiles(osImageFiles)

				// Add to current thread's uploadedImages and trigger upload
				const currentThread = chatThreadService.getCurrentThread()
				if (currentThread) {
					const existingImages = currentThread.state.uploadedImages || []
					// 先添加到状态中（显示pending状态）
					chatThreadService.setCurrentThreadState({
						uploadedImages: [...existingImages, ...processedImages]
					})

					// 然后触发上传
					uploadImagesWithProgress(processedImages, (updatedImages) => {
						// 更新上传状态
						const thread = chatThreadService.getCurrentThread()
						if (thread) {
							const existing = thread.state.uploadedImages || []
							// 替换正在上传的图片为更新后的状态
							const merged = existing.map(img => {
								const updated = updatedImages.find(u => u.id === img.id)
								return updated || img
							})
							chatThreadService.setCurrentThreadState({
								uploadedImages: merged
							})
						}
					})
				}
			} catch (error) {
			}
		}

		// Add all selections with deduplication
		if (newSelections.length > 0) {
			// Use addNewStagingSelection which handles deduplication internally
			for (const selection of newSelections) {
				chatThreadService.addNewStagingSelection(selection)
			}
		}
	}, [fileService, languageService, chatThreadService, chatMode])

	return (
		<div
			ref={divRef}
			className={`
				gap-x-1
				flex flex-col p-2 relative input text-left shrink-0
				rounded-md
				bg-senweaver-bg-1
				transition-all duration-200
				border border-senweaver-border-3 focus-within:border-senweaver-border-1 hover:border-senweaver-border-1
				max-h-[80vh] overflow-y-auto
				${className}
			`}
			onClick={(e) => {
				onClickAnywhere?.()
			}}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{/* Drag overlay */}
			{isDragOver && (
				<div className="absolute inset-0 bg-blue-500 bg-opacity-20 border-2 border-dashed border-blue-500 rounded flex items-center justify-center z-50 pointer-events-none">
					<div className="text-blue-600 dark:text-blue-400 font-medium text-sm">拖拽文件或文件夹到此处添加</div>
				</div>
			)}
			{/* Selections section */}
			{showSelections && selections && setSelections && (
				<SelectedFiles
					type='staging'
					selections={selections}
					setSelections={setSelections}
					showProspectiveSelections={showProspectiveSelections}
				/>
			)}

			{/* Input section */}
			<div className="relative w-full">
				{children}

				{/* Close button (X) if onClose is provided */}
				{onClose && (
					<div className='absolute -top-1 -right-1 cursor-pointer z-1'>
						<IconX
							size={12}
							className="stroke-[2] opacity-80 text-senweaver-fg-3 hover:brightness-95"
							onClick={onClose}
						/>
					</div>
				)}
			</div>

			{/* Bottom row */}
			<div className='flex flex-row justify-between items-end gap-1'>
				{showModelDropdown && (
					<div className='flex flex-col gap-y-1'>
						<ReasoningOptionSlider featureName={featureName} />

						<div className='flex items-center flex-wrap gap-x-2 gap-y-1 text-nowrap '>
							{featureName === 'Chat' && <ChatModeDropdown className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 border border-senweaver-border-2 rounded py-0.5 px-1' />}
							<ModelDropdown featureName={featureName} className='text-xs text-senweaver-fg-3 bg-senweaver-bg-1 rounded' />
						</div>
					</div>
				)}

				<div className="flex items-center gap-2">

					{isStreaming && loadingIcon}

					{isStreaming ? (
						<ButtonStop onClick={onAbort} />
					) : (
						<ButtonSubmit
							onClick={onSubmit}
							disabled={isDisabled}
						/>
					)}
				</div>

			</div>
		</div>
	);
};




type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
const DEFAULT_BUTTON_SIZE = 22;
export const ButtonSubmit = ({ className, disabled, ...props }: ButtonProps & Required<Pick<ButtonProps, 'disabled'>>) => {

	return <button
		type='button'
		className={`rounded-full flex-shrink-0 flex-grow-0 flex items-center justify-center
			${disabled ? 'bg-vscode-disabled-fg cursor-default' : 'bg-white cursor-pointer'}
			${className}
		`}
		// data-tooltip-id='senweaver-tooltip'
		// data-tooltip-content={'Send'}
		// data-tooltip-place='left'
		{...props}
	>
		<IconArrowUp size={DEFAULT_BUTTON_SIZE} className="stroke-[2] p-[2px]" />
	</button>
}

export const ButtonStop = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {
	return <button
		className={`rounded-full flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center
			bg-white
			${className}
		`}
		type='button'
		{...props}
	>
		<IconSquare size={DEFAULT_BUTTON_SIZE} className="stroke-[3] p-[7px]" />
	</button>
}



const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
	if (divRef.current) {
		divRef.current.scrollTop = divRef.current.scrollHeight;
	}
};



const ScrollToBottomContainer = ({ children, className, style, scrollContainerRef, onReachTop }: { children: React.ReactNode, className?: string, style?: React.CSSProperties, scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>, onReachTop?: () => void }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom
	const rafIdRef = useRef<number | null>(null)
	const lastScrollHeightRef = useRef<number>(0)
	const scrollRafIdRef = useRef<number | null>(null)
	const lastIsAtBottomRef = useRef<boolean>(true)

	const divRef = scrollContainerRef

	const scheduleScrollToBottom = useCallback(() => {
		if (rafIdRef.current !== null) return
		rafIdRef.current = requestAnimationFrame(() => {
			rafIdRef.current = null
			const div = divRef.current
			if (!div) return
			const h = div.scrollHeight
			if (h === lastScrollHeightRef.current) return
			lastScrollHeightRef.current = h
			scrollToBottom(divRef)
		})
	}, [divRef])

	useEffect(() => {
		return () => {
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current)
				rafIdRef.current = null
			}
			if (scrollRafIdRef.current !== null) {
				cancelAnimationFrame(scrollRafIdRef.current)
				scrollRafIdRef.current = null
			}
		}
	}, [])

	// Throttled scroll handler using RAF to prevent excessive state updates
	const onScroll = useCallback(() => {
		if (scrollRafIdRef.current !== null) return
		scrollRafIdRef.current = requestAnimationFrame(() => {
			scrollRafIdRef.current = null
			const div = divRef.current;
			if (!div) return;

			// Load more when user scrolls to top
			if (div.scrollTop < 20) {
				onReachTop?.();
			}

			const isBottom = Math.abs(
				div.scrollHeight - div.clientHeight - div.scrollTop
			) < 4;

			// Only update state if the value actually changed
			if (isBottom !== lastIsAtBottomRef.current) {
				lastIsAtBottomRef.current = isBottom
				setIsAtBottom(isBottom);
			}
		})
	}, [divRef, onReachTop]);

	// When children change (new messages added)
	useEffect(() => {
		if (isAtBottom) {
			scheduleScrollToBottom();
		}
	}, [children, isAtBottom, scheduleScrollToBottom]); // Dependency on children to detect new messages

	// Initial scroll to bottom
	useEffect(() => {
		scheduleScrollToBottom();
	}, []);

	return (
		<div
			ref={divRef}
			onScroll={onScroll}
			className={className}
			style={style}
		>
			{children}
		</div>
	);
};

export const getRelative = (uri: URI, accessor: ReturnType<typeof useAccessor>) => {
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	let path: string
	const isInside = workspaceContextService.isInsideWorkspace(uri)
	if (isInside) {
		const f = workspaceContextService.getWorkspace().folders.find(f => uri.fsPath?.startsWith(f.uri.fsPath))
		if (f) { path = uri.fsPath.replace(f.uri.fsPath, '') }
		else { path = uri.fsPath }
	}
	else {
		path = uri.fsPath
	}
	return path || undefined
}

export const getFolderName = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	// Filter out empty parts (the last element will be empty if path ends with /)
	const nonEmptyParts = parts.filter(part => part.length > 0)
	if (nonEmptyParts.length === 0) return '/' // Root directory
	if (nonEmptyParts.length === 1) return nonEmptyParts[0] + '/' // Only one folder
	// Get the last two parts
	const lastTwo = nonEmptyParts.slice(-2)
	return lastTwo.join('/') + '/'
}

export const getBasename = (pathStr: string, parts: number = 1) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const allParts = pathStr.split('/') // split on /
	if (allParts.length === 0) return pathStr
	return allParts.slice(-parts).join('/')
}



// Open file utility function
export const senweaverOpenFileFn = (
	uri: URI,
	accessor: ReturnType<typeof useAccessor>,
	range?: [number, number]
) => {
	const commandService = accessor.get('ICommandService')
	const editorService = accessor.get('ICodeEditorService')

	// Get editor selection from CodeSelection range
	let editorSelection = undefined;

	// If we have a selection, create an editor selection from the range
	if (range) {
		editorSelection = {
			startLineNumber: range[0],
			startColumn: 1,
			endLineNumber: range[1],
			endColumn: Number.MAX_SAFE_INTEGER,
		};
	}

	// open the file
	commandService.executeCommand('vscode.open', uri).then(() => {

		// select the text
		setTimeout(() => {
			if (!editorSelection) return;

			const editor = editorService.getActiveCodeEditor()
			if (!editor) return;

			editor.setSelection(editorSelection)
			editor.revealRange(editorSelection, ScrollType.Immediate)

		}, 50) // needed when document was just opened and needs to initialize

	})

};


export const SelectedFiles = (
	{ type, selections, setSelections, showProspectiveSelections, messageIdx, }:
		| { type: 'past', selections: StagingSelectionItem[]; setSelections?: undefined, showProspectiveSelections?: undefined, messageIdx: number, }
		| { type: 'staging', selections: StagingSelectionItem[]; setSelections: ((newSelections: StagingSelectionItem[]) => void), showProspectiveSelections?: boolean, messageIdx?: number }
) => {

	const accessor = useAccessor()
	const modelReferenceService = accessor.get('ISenweaverModelService')

	// state for tracking prospective files
	const { uri: currentURI } = useActiveURI()
	const [recentUris, setRecentUris] = useState<URI[]>([])
	const maxRecentUris = 10
	const maxProspectiveFiles = 3
	useEffect(() => { // handle recent files
		if (!currentURI) return
		// Skip non-file URIs (like Senweaver://custom-api, Senweaver://designer, etc.)
		if (currentURI.scheme !== 'file') return
		setRecentUris(prev => {
			const withoutCurrent = prev.filter(uri => uri.fsPath !== currentURI.fsPath) // remove duplicates
			const withCurrent = [currentURI, ...withoutCurrent]
			return withCurrent.slice(0, maxRecentUris)
		})
	}, [currentURI])
	const [prospectiveSelections, setProspectiveSelections] = useState<StagingSelectionItem[]>([])


	// handle prospective files
	useEffect(() => {
		const computeRecents = async () => {
			const prospectiveURIs = recentUris
				.filter(uri => uri.scheme === 'file') // Only show real files, not Senweaver:// URIs
				.filter(uri => !selections.find(s => s.type === 'File' && s.uri.fsPath === uri.fsPath))
				.slice(0, maxProspectiveFiles)

			const answer: StagingSelectionItem[] = []
			for (const uri of prospectiveURIs) {
				answer.push({
					type: 'File',
					uri: uri,
					language: (await modelReferenceService.getModelSafe(uri)).model?.getLanguageId() || 'plaintext',
					state: { wasAddedAsCurrentFile: false },
				})
			}
			return answer
		}

		// add a prospective file if type === 'staging' and if the user is in a file, and if the file is not selected yet
		if (type === 'staging' && showProspectiveSelections) {
			computeRecents().then((a) => setProspectiveSelections(a))
		}
		else {
			setProspectiveSelections([])
		}
	}, [recentUris, selections, type, showProspectiveSelections])


	// Filter out non-file URIs (like Senweaver://custom-api, Senweaver://designer, etc.)
	const filteredSelections = selections.filter(s =>
		s.type === 'DesignUnit' || s.type === 'Terminal' || ('uri' in s && s.uri && s.uri.scheme === 'file')
	)
	const allSelections = [...filteredSelections, ...prospectiveSelections]

	if (allSelections.length === 0) {
		return null
	}

	return (
		<div className='flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1 pb-0.5'>

			{allSelections.map((selection, i) => {

				const isThisSelectionProspective = i > filteredSelections.length - 1

				const thisKey = selection.type === 'CodeSelection' ? selection.type + selection.language + selection.range + selection.state.wasAddedAsCurrentFile + selection.uri.fsPath
					: selection.type === 'File' ? selection.type + selection.language + selection.state.wasAddedAsCurrentFile + selection.uri.fsPath
						: selection.type === 'Folder' ? selection.type + selection.language + selection.state + selection.uri.fsPath
							: selection.type === 'DesignUnit' ? selection.type + selection.designId + selection.designTimestamp
								: selection.type === 'Terminal' ? selection.type + selection.terminalName + selection.terminalContent.slice(0, 50)
									: i

				const SelectionIcon = (
					selection.type === 'File' ? File
						: selection.type === 'Folder' ? Folder
							: selection.type === 'CodeSelection' ? Text
								: selection.type === 'DesignUnit' ? Palette
									: selection.type === 'Terminal' ? Terminal
										: (undefined as never)
				)

				return <div // container for summarybox and code
					key={thisKey}
					className={`flex flex-col space-y-[1px]`}
				>
					{/* tooltip for file path or design info */}
					<span className="truncate overflow-hidden text-ellipsis"
						data-tooltip-id='senweaver-tooltip'
						data-tooltip-content={selection.type === 'DesignUnit' ? `设计单元: ${selection.designTitle}` : selection.type === 'Terminal' ? `终端: ${selection.terminalName}` : getRelative(selection.uri, accessor)}
						data-tooltip-place='top'
						data-tooltip-delay-show={3000}
					>
						{/* summarybox */}
						<div
							className={`
								flex items-center gap-1 relative
								px-1
								w-fit h-fit
								select-none
								text-xs text-nowrap
								border rounded-sm
								${isThisSelectionProspective ? 'bg-senweaver-bg-1 text-senweaver-fg-3 opacity-80' : 'bg-senweaver-bg-1 hover:brightness-95 text-senweaver-fg-1'}
								${isThisSelectionProspective
									? 'border-senweaver-border-2'
									: 'border-senweaver-border-1'
								}
								hover:border-senweaver-border-1
								transition-all duration-150
							`}
							onClick={() => {
								if (type !== 'staging') return; // (never)
								if (isThisSelectionProspective) { // add prospective selection to selections
									setSelections([...selections, selection])
								}
								else if (selection.type === 'File') { // open files
									senweaverOpenFileFn(selection.uri, accessor);

									const wasAddedAsCurrentFile = selection.state.wasAddedAsCurrentFile
									if (wasAddedAsCurrentFile) {
										// make it so the file is added permanently, not just as the current file
										const newSelection: StagingSelectionItem = { ...selection, state: { ...selection.state, wasAddedAsCurrentFile: false } }
										setSelections([
											...selections.slice(0, i),
											newSelection,
											...selections.slice(i + 1)
										])
									}
								}
								else if (selection.type === 'CodeSelection') {
									senweaverOpenFileFn(selection.uri, accessor, selection.range);
								}
								else if (selection.type === 'Folder') {
									// TODO!!! reveal in tree
								}
								else if (selection.type === 'DesignUnit') {
									// Do nothing on click for design units
								}
								else if (selection.type === 'Terminal') {
									// Do nothing on click for terminal selections
								}
							}}
						>
							{<SelectionIcon size={10} />}

							{ // file name, range, design title, or terminal name
								selection.type === 'DesignUnit'
									? selection.designTitle
									: selection.type === 'Terminal'
										? `@terminal:${selection.terminalName}`
										: (getBasename(selection.uri.fsPath) + (selection.type === 'CodeSelection' ? ` (${selection.range[0]}-${selection.range[1]})` : ''))
							}

							{ // Show timestamp for design units
								selection.type === 'DesignUnit' && (
									<span className="text-[8px] text-senweaver-fg-4 ml-1">
										{new Date(selection.designTimestamp).toLocaleTimeString()}
									</span>
								)
							}

							{selection.type === 'File' && selection.state.wasAddedAsCurrentFile && messageIdx === undefined && currentURI?.fsPath === selection.uri.fsPath ?
								<span className={`text-[8px] 'senweaver-opacity-60 text-senweaver-fg-4`}>
									{`(Current File)`}
								</span>
								: null
							}

							{type === 'staging' && !isThisSelectionProspective ? // X button
								<div // box for making it easier to click
									className='cursor-pointer z-1 self-stretch flex items-center justify-center'
									onClick={(e) => {
										e.stopPropagation(); // don't open/close selection
										if (type !== 'staging') return;
										setSelections([...selections.slice(0, i), ...selections.slice(i + 1)])
									}}
								>
									<IconX
										className='stroke-[2]'
										size={10}
									/>
								</div>
								: <></>
							}
						</div>
					</span>
				</div>

			})}


		</div>

	)
}


type ToolHeaderParams = {
	icon?: React.ReactNode;
	title: React.ReactNode;
	desc1: React.ReactNode;
	desc1OnClick?: () => void;
	desc2?: React.ReactNode;
	isError?: boolean;
	info?: string;
	desc1Info?: string;
	isRejected?: boolean;
	numResults?: number;
	hasNextPage?: boolean;
	children?: React.ReactNode;
	bottomChildren?: React.ReactNode;
	onClick?: () => void;
	desc2OnClick?: () => void;
	isOpen?: boolean;
	className?: string;
	changeStats?: { linesAdded: number; linesRemoved: number; isNewFile?: boolean }; // 代码变更统计
}

const ToolHeaderWrapper = ({
	icon,
	title,
	desc1,
	desc1OnClick,
	desc1Info,
	desc2,
	numResults,
	hasNextPage,
	children,
	info,
	bottomChildren,
	isError,
	onClick,
	desc2OnClick,
	isOpen,
	isRejected,
	className, // applies to the main content
	changeStats, // 代码变更统计
}: ToolHeaderParams) => {

	const [isOpen_, setIsOpen] = useState(false);
	const isExpanded = isOpen !== undefined ? isOpen : isOpen_

	const isDropdown = children !== undefined // null ALLOWS dropdown
	const isClickable = !!(isDropdown || onClick)

	const isDesc1Clickable = !!desc1OnClick

	const desc1HTML = <span
		className={`text-senweaver-fg-4 text-xs italic truncate ml-2
			${isDesc1Clickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
		`}
		onClick={desc1OnClick}
		{...desc1Info ? {
			'data-tooltip-id': 'senweaver-tooltip',
			'data-tooltip-content': desc1Info,
			'data-tooltip-place': 'top',
			'data-tooltip-delay-show': 1000,
		} : {}}
	>{desc1}</span>

	return (<div className=''>
		<div className={`w-full border border-senweaver-border-3 rounded px-2 py-1 bg-senweaver-bg-3 overflow-hidden ${className}`}>
			{/* header */}
			<div className={`select-none flex items-center min-h-[24px]`}>
				<div className={`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`}>
					{/* left */}
					<div // container for if desc1 is clickable
						className='ml-1 flex items-center overflow-hidden'
					>
						{/* title eg "> Edited File" */}
						<div className={`
							flex items-center min-w-0 overflow-hidden grow
							${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
						`}
							onClick={() => {
								if (isDropdown) { setIsOpen(v => !v); }
								if (onClick) { onClick(); }
							}}
						>
							{isDropdown && (<ChevronRight
								className={`
								text-senweaver-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]
								${isExpanded ? 'rotate-90' : ''}
							`}
							/>)}
							<span className="text-senweaver-fg-3 flex-shrink-0">{title}</span>

							{!isDesc1Clickable && desc1HTML}
						</div>
						{isDesc1Clickable && desc1HTML}
					</div>

					{/* right */}
					<div className="flex items-center gap-x-2 flex-shrink-0">

						{info && <CircleEllipsis
							className='ml-2 text-senweaver-fg-4 opacity-60 flex-shrink-0'
							size={14}
							data-tooltip-id='senweaver-tooltip'
							data-tooltip-content={info}
							data-tooltip-place='top-end'
						/>}

						{isError && <AlertTriangle
							className='text-senweaver-warning opacity-90 flex-shrink-0'
							size={14}
							data-tooltip-id='senweaver-tooltip'
							data-tooltip-content={'Error running tool'}
							data-tooltip-place='top'
						/>}
						{isRejected && <Ban
							className='text-senweaver-fg-4 opacity-90 flex-shrink-0'
							size={14}
							data-tooltip-id='senweaver-tooltip'
							data-tooltip-content={'Canceled'}
							data-tooltip-place='top'
						/>}
						{changeStats && (changeStats.linesAdded > 0 || changeStats.linesRemoved > 0) && (
							<span className="text-xs flex-shrink-0 flex items-center gap-1">
								{changeStats.isNewFile && (
									<span className="text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded text-[10px] font-medium">new</span>
								)}
								{changeStats.linesAdded > 0 && <span className="text-green-400">+{changeStats.linesAdded}</span>}
								{changeStats.linesAdded > 0 && changeStats.linesRemoved > 0 && <span className="text-senweaver-fg-4 mx-0.5">·</span>}
								{changeStats.linesRemoved > 0 && <span className="text-red-400">-{changeStats.linesRemoved}</span>}
							</span>
						)}
						{desc2 && <span className="text-senweaver-fg-4 text-xs" onClick={desc2OnClick}>
							{desc2}
						</span>}
						{numResults !== undefined && (
							<span className="text-senweaver-fg-4 text-xs ml-auto mr-1">
								{`${numResults}${hasNextPage ? '+' : ''} result${numResults !== 1 ? 's' : ''}`}
							</span>
						)}
					</div>
				</div>
			</div>
			{/* children */}
			{<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}
					text-senweaver-fg-4 rounded-sm overflow-x-auto
				  `}
			//    bg-black bg-opacity-10 border border-senweaver-border-4 border-opacity-50
			>
				{isExpanded ? children : null}
			</div>}
		</div>
		{bottomChildren}
	</div>);
};



const EditTool = ({ toolMessage, threadId, messageIdx, content }: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & { content: string }) => {
	const accessor = useAccessor()
	const isError = false
	const isRejected = toolMessage.type === 'rejected'

	const title = getTitle(toolMessage)

	// 优化：使用 useMemo 缓存工具参数解析结果，避免每次渲染都重新计算
	const { desc1, desc1Info } = useMemo(() =>
		toolNameToDesc(toolMessage.name, toolMessage.params, accessor),
		[toolMessage.name, toolMessage.params, accessor]
	)
	const icon = null

	const { params } = toolMessage
	const desc1OnClick = () => senweaverOpenFileFn(params.uri, accessor)

	// 获取代码变更统计
	const changeStats = toolMessage.type === 'success' && toolMessage.result?.changeStats
		? toolMessage.result.changeStats
		: undefined

	const componentParams: ToolHeaderParams = { title, desc1, desc1OnClick, desc1Info, isError, icon, isRejected, changeStats }


	const editToolType = toolMessage.name === 'edit_file' ? 'diff' : 'rewrite'
	if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
		componentParams.children = <ToolChildrenWrapper className='bg-senweaver-bg-3'>
			<EditToolChildren
				uri={params.uri}
				code={content}
				type={editToolType}
			/>
		</ToolChildrenWrapper>
		// JumpToFileButton removed in favor of FileLinkText
	}
	else if (toolMessage.type === 'success' || toolMessage.type === 'rejected' || toolMessage.type === 'tool_error') {
		// Accept/Reject 按钮现在在底部文件列表中显示，不在这里显示
		// add children
		componentParams.children = <ToolChildrenWrapper className='bg-senweaver-bg-3'>
			<EditToolChildren
				uri={params.uri}
				code={content}
				type={editToolType}
			/>
		</ToolChildrenWrapper>

		if (toolMessage.type === 'success' || toolMessage.type === 'rejected') {
			const { result } = toolMessage
			// 对于 edit_file 和 rewrite_file，不显示 lint 错误
			// 因为这些错误通常是文件本身的问题（如导入路径、类型错误等），不是工具调用导致的
			// 如果用户需要查看 lint 错误，可以使用 read_lint_errors 工具
			if (toolMessage.name !== 'edit_file' && toolMessage.name !== 'rewrite_file') {
				// 只有当存在lint错误时才显示，避免总是显示空的Lint errors区域
				if (result?.lintErrors && result.lintErrors.length > 0) {
			componentParams.bottomChildren = <BottomChildren title='Lint errors'>
						{result.lintErrors.map((error, i) => (
					<div key={i} className='whitespace-nowrap'>Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}</div>
				))}
			</BottomChildren>
				}
			}
		}
		else if (toolMessage.type === 'tool_error') {
			// error
			const { result } = toolMessage
			componentParams.bottomChildren = <BottomChildren title='Error'>
				<CodeChildren>
					{result}
				</CodeChildren>
			</BottomChildren>
		}
	}

	return <ToolHeaderWrapper {...componentParams} />
}

const SimplifiedToolHeader = ({
	title,
	children,
}: {
	title: string;
	children?: React.ReactNode;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const isDropdown = children !== undefined;
	return (
		<div>
			<div className="w-full">
				{/* header */}
				<div
					className={`select-none flex items-center min-h-[24px] ${isDropdown ? 'cursor-pointer' : ''}`}
					onClick={() => {
						if (isDropdown) { setIsOpen(v => !v); }
					}}
				>
					{isDropdown && (
						<ChevronRight
							className={`text-senweaver-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`}
						/>
					)}
					<div className="flex items-center w-full overflow-hidden">
						<span className="text-senweaver-fg-3">{title}</span>
					</div>
				</div>
				{/* children */}
				{<div
					className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-senweaver-fg-4`}
				>
					{children}
				</div>}
			</div>
		</div>
	);
};




const UserMessageComponent = React.memo(({ chatMessage, messageIdx, isCheckpointGhost, currCheckpointIdx, _scrollToBottom }: { chatMessage: ChatMessage & { role: 'user' }, messageIdx: number, currCheckpointIdx: number | undefined, isCheckpointGhost: boolean, _scrollToBottom: (() => void) | null }) => {
	// Hide system auto-navigation planning messages
	if (chatMessage.displayContent === '[SYSTEM_AUTO_NAVIGATION_PLANNING]') {
		return null;
	}

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	// global state
	let isBeingEdited = false
	let stagingSelections: StagingSelectionItem[] = []
	let setIsBeingEdited = (_: boolean) => { }
	let setStagingSelections = (_: StagingSelectionItem[]) => { }

	if (messageIdx !== undefined) {
		const _state = chatThreadsService.getCurrentMessageState(messageIdx)
		isBeingEdited = _state.isBeingEdited
		stagingSelections = _state.stagingSelections
		setIsBeingEdited = (v) => chatThreadsService.setCurrentMessageState(messageIdx, { isBeingEdited: v })
		setStagingSelections = (s) => chatThreadsService.setCurrentMessageState(messageIdx, { stagingSelections: s })
	}


	// local state
	const mode: ChatBubbleMode = isBeingEdited ? 'edit' : 'display'
	const [isFocused, setIsFocused] = useState(false)
	const [isHovered, setIsHovered] = useState(false)
	const [isDisabled, setIsDisabled] = useState(false)
	const [textAreaRefState, setTextAreaRef] = useState<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)
	// initialize on first render, and when edit was just enabled
	const _mustInitialize = useRef(true)
	const _justEnabledEdit = useRef(false)
	useEffect(() => {
		const canInitialize = mode === 'edit' && textAreaRefState
		const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current
		if (canInitialize && shouldInitialize) {
			setStagingSelections(
				(chatMessage.selections || []).map(s => { // quick hack so we dont have to do anything more
					if (s.type === 'File') return { ...s, state: { ...s.state, wasAddedAsCurrentFile: false, } }
					else return s
				})
			)

			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '')

			textAreaRefState.focus();

			_justEnabledEdit.current = false
			_mustInitialize.current = false
		}

	}, [chatMessage, mode, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current])

	const onOpenEdit = () => {
		setIsBeingEdited(true)
		chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx)
		_justEnabledEdit.current = true
	}
	const onCloseEdit = () => {
		setIsFocused(false)
		setIsHovered(false)
		setIsBeingEdited(false)
		chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)

	}

	const EditSymbol = mode === 'display' ? Pencil : X


	let chatbubbleContents: React.ReactNode
	if (mode === 'display') {
		const images = chatMessage.images || []
		chatbubbleContents = <>
			<SelectedFiles type='past' messageIdx={messageIdx} selections={chatMessage.selections || []} />
			{/* Display uploaded images */}
			{images.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-2">
					{images.map((image, index) => (
						<div key={image.id || index} className="relative">
							<img
								src={image.uploadedUrl || (image.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : '')}
								alt={image.name}
								className="w-16 h-16 object-cover rounded border border-senweaver-border-3"
							/>
							<div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 rounded-b truncate">
								{image.name}
							</div>
						</div>
					))}
				</div>
			)}
			<span className='px-0.5'>{chatMessage.displayContent}</span>
		</>
	}
	else if (mode === 'edit') {

		const onSubmit = async () => {

			if (isDisabled) return;
			if (!textAreaRefState) return;
			if (messageIdx === undefined) return;

			// cancel any streams on this thread
			const threadId = chatThreadsService.state.currentThreadId

			await chatThreadsService.abortRunning(threadId)

			// update state
			setIsBeingEdited(false)
			chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)

			// stream the edit
			const userMessage = textAreaRefState.value;
			try {
				await chatThreadsService.editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId })
			} catch (e) {
			}
			await chatThreadsService.focusCurrentChat()
			requestAnimationFrame(() => _scrollToBottom?.())
		}

		const onAbort = async () => {
			const threadId = chatThreadsService.state.currentThreadId
			await chatThreadsService.abortRunning(threadId)
		}

		const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Escape') {
				onCloseEdit()
			}
			if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
				onSubmit()
			}
		}

		if (!chatMessage.content) { // don't show if empty and not loading (if loading, want to show).
			return null
		}

		chatbubbleContents = <SenweaverChatArea
			featureName='Chat'
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={false}
			isDisabled={isDisabled}
			showSelections={true}
			showProspectiveSelections={false}
			selections={stagingSelections}
			setSelections={setStagingSelections}
		>
			<SenweaverInputBox2
				enableAtToMention
				ref={setTextAreaRef}
				className='min-h-[81px] max-h-[500px] px-0.5'
				placeholder="Edit your message..."
				onChangeText={(text) => setIsDisabled(!text)}
				onFocus={() => {
					setIsFocused(true)
					chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
				}}
				onBlur={() => {
					setIsFocused(false)
				}}
				onKeyDown={onKeyDown}
				fnsRef={textAreaFnsRef}
				multiline={true}
			/>
		</SenweaverChatArea>
	}

	const isMsgAfterCheckpoint = currCheckpointIdx !== undefined && currCheckpointIdx === messageIdx - 1

	return <div
		// align chatbubble accoridng to role
		className={`
		relative ml-auto
		${mode === 'edit' ? 'w-full max-w-full'
				: mode === 'display' ? `self-end w-fit max-w-full whitespace-pre-wrap` : '' // user words should be pre
			}

		${isCheckpointGhost && !isMsgAfterCheckpoint ? 'opacity-50 pointer-events-none' : ''}
	`}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<div
			// style chatbubble according to role
			className={`
			text-left rounded-lg max-w-full
			${mode === 'edit' ? ''
					: mode === 'display' ? 'p-2 flex flex-col bg-senweaver-bg-1 text-senweaver-fg-1 overflow-x-auto cursor-pointer' : ''
				}
		`}
			onClick={() => { if (mode === 'display') { onOpenEdit() } }}
		>
			{chatbubbleContents}
		</div>



		<div
			className="absolute -top-1 -right-1 translate-x-0 -translate-y-0 z-1"
		// data-tooltip-id='senweaver-tooltip'
		// data-tooltip-content='Edit message'
		// data-tooltip-place='left'
		>
			<EditSymbol
				size={18}
				className={`
					cursor-pointer
					p-[2px]
					bg-senweaver-bg-1 border border-senweaver-border-1 rounded-md
					transition-opacity duration-200 ease-in-out
					${isHovered || (isFocused && mode === 'edit') ? 'opacity-100' : 'opacity-0'}
				`}
				onClick={() => {
					if (mode === 'display') {
						onOpenEdit()
					} else if (mode === 'edit') {
						onCloseEdit()
					}
				}}
			/>
		</div>


	</div>

})

const SmallProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
text-senweaver-fg-4
prose
prose-sm
break-words
max-w-none
leading-snug
text-[13px]

[&>:first-child]:!mt-0
[&>:last-child]:!mb-0

prose-h1:text-[14px]
prose-h1:my-4

prose-h2:text-[13px]
prose-h2:my-4

prose-h3:text-[13px]
prose-h3:my-3

prose-h4:text-[13px]
prose-h4:my-2

prose-p:my-2
prose-p:leading-snug
prose-hr:my-2

prose-ul:my-2
prose-ul:pl-4
prose-ul:list-outside
prose-ul:list-disc
prose-ul:leading-snug


prose-ol:my-2
prose-ol:pl-4
prose-ol:list-outside
prose-ol:list-decimal
prose-ol:leading-snug

marker:text-inherit

prose-blockquote:pl-2
prose-blockquote:my-2

prose-code:text-senweaver-fg-3
prose-code:text-[12px]
prose-code:before:content-none
prose-code:after:content-none

prose-pre:text-[12px]
prose-pre:p-2
prose-pre:my-2

prose-table:text-[13px]
'>
		{children}
	</div>
}

const ProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
text-senweaver-fg-2
prose
prose-sm
break-words
prose-p:block
prose-hr:my-4
prose-pre:my-2
marker:text-inherit
prose-ol:list-outside
prose-ol:list-decimal
prose-ul:list-outside
prose-ul:list-disc
prose-li:my-0
prose-code:before:content-none
prose-code:after:content-none
prose-headings:prose-sm
prose-headings:font-bold

prose-p:leading-normal
prose-ol:leading-normal
prose-ul:leading-normal

max-w-none
'
	>
		{children}
	</div>
}

const stripToolProtocolForDisplay = (content: string) => {
	if (!content) return content
	const maybeToolProtocolRegex = /<(tool_call|uri|search_replace_blocks|edit_file|rewrite_file|write_file|read_file|ls_dir|get_dir_tree|search_in_file|search_for_files|search_pathnames_only|run_command|run_persistent_command|open_persistent_terminal|kill_persistent_terminal)(\s*\/?>|>)/i
	if (!maybeToolProtocolRegex.test(content)) {
		return content
	}

	const stripInNonCode = (s: string) => {
		let out = s
		let didChange = false
		const tags = [
			'tool_call',
			'uri',
			'search_replace_blocks',
			'edit_file',
			'rewrite_file',
			'write_file',
			'read_file',
			'ls_dir',
			'get_dir_tree',
			'search_in_file',
			'search_for_files',
			'search_pathnames_only',
			'run_command',
			'run_persistent_command',
			'open_persistent_terminal',
			'kill_persistent_terminal',
		]

		for (const tag of tags) {
			const before = out
			out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
			out = out.replace(new RegExp(`<${tag}\\s*\\/>`, 'gi'), '')
			out = out.replace(new RegExp(`<\\/${tag}>`, 'gi'), '')
			out = out.replace(new RegExp(`<${tag}>`, 'gi'), '')
			out = out.replace(new RegExp(`<${tag}>[\\s\\S]*$`, 'gi'), '')
			if (out !== before) didChange = true
		}

		if (!didChange) return s
		out = out.replace(/\n{3,}/g, '\n\n')
		return out
	}

	const parts = content.split('```')
	for (let i = 0; i < parts.length; i += 2) {
		parts[i] = stripInNonCode(parts[i])
	}
	return parts.join('```')
}

const AssistantMessageComponent = React.memo(({ chatMessage, isCheckpointGhost, isCommitted, messageIdx, onOpenPreview, globalTaskProgress, designHistoryLength }: { chatMessage: ChatMessage & { role: 'assistant' }, isCheckpointGhost: boolean, messageIdx: number, isCommitted: boolean, onOpenPreview: (design: DesignData) => void, globalTaskProgress: DesignTaskProgress | null, designHistoryLength: number }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const settingsState = useSettingsState()

	const reasoningStr = chatMessage.reasoning?.trim() || null
	const hasReasoning = !!reasoningStr
	const isDoneReasoning = !!chatMessage.displayContent
	const thread = chatThreadsService.getCurrentThread()
	const chatMode = settingsState.globalSettings.chatMode


	const chatMessageLocation: ChatMessageLocation = {
		threadId: thread.id,
		messageIdx: messageIdx,
	}

	// Check if this message contains any code blocks
	// For committed messages, check content to determine if collapsible code blocks should be used
	// This ensures mode switching doesn't affect historical message rendering
	// Match any code block: ```language or just ```
	const hasCodeContent = !!(chatMessage.displayContent && chatMessage.displayContent.includes('```'))
	const isCurrentlyDesignerMode = chatMode === 'designer'
	// For committed messages: use collapsible if content has HTML/CSS code blocks (preserve original rendering)
	// For streaming messages: use collapsible only in designer mode
	const isDesignerMode = isCommitted ? hasCodeContent : isCurrentlyDesignerMode
	const hasDesignContent = hasCodeContent

	// Check if previous message is system auto-navigation planning
	const previousMessage = messageIdx > 0 ? thread.messages[messageIdx - 1] : null;
	const isNavigationPlanningResponse = previousMessage?.role === 'user' &&
		previousMessage.displayContent === '[SYSTEM_AUTO_NAVIGATION_PLANNING]';

	// Show navigation planning indicator at START (in progress)
	const showNavigationPlanningStart = isNavigationPlanningResponse;

	// Show navigation planning completed indicator at END (only when committed)
	const showNavigationPlanningEnd = isNavigationPlanningResponse && isCommitted && chatMessage.displayContent;

	if (isNavigationPlanningResponse) {

	}

	// Calculate task progress at the START of the message (planning phase)
	// This shows when the task is beginning (during reasoning or when design task starts)
	// Perf optimization: use thread.messages.length instead of thread.messages to reduce dependency changes
	const messagesLength = thread.messages.length
	const taskProgressStart = useMemo(() => {
		// Task progress indicator should only show in designer mode (based on current mode)
		if (!isCurrentlyDesignerMode) return null;
		if (isNavigationPlanningResponse) return null;

		// Show at the start if:
		// 1. We have reasoning (AI is thinking about the design)
		// 2. OR we have design content (this is a design task)
		const isDesignTask = hasReasoning || hasDesignContent;
		if (!isDesignTask) return null;

		// Count how many designs were completed BEFORE this message
		// Only iterate up to messageIdx which is stable for this component
		let completedBeforeThisMessage = 0;
		const messages = thread.messages
		for (let i = 0; i < messageIdx && i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === 'assistant' && msg.displayContent) {
				// Count all HTML blocks in this message
				const htmlMatches = msg.displayContent.match(/```html/g);
				if (htmlMatches) {
					completedBeforeThisMessage += htmlMatches.length;
				}
			}
		}

		const progress: DesignTaskProgress = {
			totalCount: null,
			completedCount: completedBeforeThisMessage,
			phase: 'planning'
		};
		return progress;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isCurrentlyDesignerMode, isNavigationPlanningResponse, hasReasoning, hasDesignContent, messagesLength, messageIdx]);

	// Calculate task progress at the END of the message (completed phase)
	// This shows when the task is finished (after design content)
	const taskProgressEnd = useMemo(() => {
		// Task progress indicator should only show in designer mode (based on current mode)
		if (!isCurrentlyDesignerMode) return null;
		if (isNavigationPlanningResponse) return null;

		// Only show at the end if:
		// 1. We have design content
		// 2. AND the message is committed (fully received)
		if (!hasDesignContent || !isCommitted) return null;

		// Count how many designs were completed BEFORE this message
		let completedBeforeThisMessage = 0;
		const messages = thread.messages
		for (let i = 0; i < messageIdx && i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === 'assistant' && msg.displayContent) {
				// Count all HTML blocks in this message
				const htmlMatches = msg.displayContent.match(/```html/g);
				if (htmlMatches) {
					completedBeforeThisMessage += htmlMatches.length;
				}
			}
		}

		// Count how many designs are in THIS message
		let designsInThisMessage = 0;
		if (chatMessage.displayContent) {
			const htmlMatches = chatMessage.displayContent.match(/```html/g);
			if (htmlMatches) {
				designsInThisMessage = htmlMatches.length;
			}
		}

		const progress: DesignTaskProgress = {
			totalCount: null,
			completedCount: completedBeforeThisMessage + designsInThisMessage, // Include all designs in this message
			phase: 'completed'
		};
		return progress;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isCurrentlyDesignerMode, isNavigationPlanningResponse, hasDesignContent, isCommitted, chatMessage.displayContent, messagesLength, messageIdx]);

	const displayContentForUser = useMemo(() => {
		return stripToolProtocolForDisplay(chatMessage.displayContent || '')
	}, [chatMessage.displayContent])

	// Check if empty - do this AFTER all hooks
	const isEmpty = !chatMessage.displayContent && !chatMessage.reasoning
	if (isEmpty) return null

	// 优化：流式输出和完成后都使用 Markdown 渲染，保持样式一致性
	// 移除了 shouldUseLightweightStreamingRender，避免流式输出和完成后样式突变
	const shouldHideDesignerStreamingCode = isDesignerMode && hasDesignContent && !isCommitted

	return <>
		{/* Task progress indicator at START - planning phase */}
		{taskProgressStart && (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<DesignTaskProgressIndicator progress={taskProgressStart} isStreaming={!isCommitted} />
			</div>
		)}

		{/* Navigation planning status indicator at START - in progress */}
		{showNavigationPlanningStart && (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''} mb-2`}>
				<DesignTaskProgressIndicator
					progress={{ totalCount: 0, completedCount: 0, phase: 'navigation' }}
					isStreaming={!isCommitted}
				/>
			</div>
		)}
		{/* reasoning token */}
		{hasReasoning &&
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ReasoningWrapper isDoneReasoning={isDoneReasoning} isStreaming={!isCommitted}>
					<SmallProseWrapper>
							<ChatMarkdownRender
								string={reasoningStr}
								chatMessageLocation={chatMessageLocation}
								isApplyEnabled={false}
								isLinkDetectionEnabled={true}
							/>
					</SmallProseWrapper>
				</ReasoningWrapper>
			</div>
		}

		{/* assistant message */}
		{chatMessage.displayContent &&
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ProseWrapper>
					{shouldHideDesignerStreamingCode ?
						<div className='whitespace-pre-wrap break-words'>
							正在生成本批UI…
							</div>
							:
							<ChatMarkdownRender
								string={displayContentForUser}
								chatMessageLocation={chatMessageLocation}
								isApplyEnabled={true}
								isLinkDetectionEnabled={true}
								isDesignerMode={isDesignerMode}
							/>
					}
				</ProseWrapper>

				{/* Designer canvas for designer mode */}
				{/* hasDesignContent && (
					<DesignerMessageRenderer
						content={chatMessage.displayContent}
						messageId={`${thread.id}-${messageIdx}`}
						onOpenPreview={onOpenPreview}
					/>
				) */}
			</div>
		}

		{/* Task progress indicator at END - completed phase */}
		{taskProgressEnd && (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<DesignTaskProgressIndicator progress={taskProgressEnd} isStreaming={!isCommitted} />
			</div>
		)}

		{/* Navigation planning completed indicator at END */}
		{showNavigationPlanningEnd && (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<DesignTaskProgressIndicator
					progress={{ totalCount: 0, completedCount: 0, phase: 'navigation_completed' }}
					isStreaming={false}
				/>
			</div>
		)}
	</>

})

const ReasoningWrapper = ({ isDoneReasoning, isStreaming, children }: { isDoneReasoning: boolean, isStreaming: boolean, children: React.ReactNode }) => {
	const isDone = isDoneReasoning || !isStreaming
	const isWriting = !isDone
	const [isOpen, setIsOpen] = useState(isWriting)
	const contentRef = useRef<HTMLDivElement>(null)
	const [shouldAutoCollapse, setShouldAutoCollapse] = useState(false)

	// 最大高度限制（超过后自动收起）
	const MAX_REASONING_HEIGHT = 200 // px

	useEffect(() => {
		if (!isWriting) setIsOpen(false) // if just finished reasoning, close
	}, [isWriting])

	// 检测内容高度，超过阈值时自动收起
	useEffect(() => {
		if (contentRef.current && isWriting) {
			const checkHeight = () => {
				const height = contentRef.current?.scrollHeight || 0
				if (height > MAX_REASONING_HEIGHT && !shouldAutoCollapse) {
					setShouldAutoCollapse(true)
					setIsOpen(false) // 自动收起
				}
			}
			checkHeight()
			// 持续检测（流式输出时内容不断增加）
			const observer = new ResizeObserver(checkHeight)
			observer.observe(contentRef.current)
			return () => observer.disconnect()
		}
	}, [isWriting, shouldAutoCollapse])

	return <ToolHeaderWrapper title='Reasoning' desc1='' isOpen={isOpen} onClick={() => setIsOpen(v => !v)}>
		<ToolChildrenWrapper>
			<div
				ref={contentRef}
				className={`!select-text cursor-auto ${!isOpen ? '' : 'max-h-[300px] overflow-y-auto'}`}
			>
				{children}
			</div>
		</ToolChildrenWrapper>
	</ToolHeaderWrapper>
}

// 图片分析结果包装器，样式类似Reasoning
export const ImageAnalysisWrapper = ({ title, children, defaultOpen = false }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) => {
	const [isOpen, setIsOpen] = useState(defaultOpen)
	return <ToolHeaderWrapper title={title} desc1='' isOpen={isOpen} onClick={() => setIsOpen(v => !v)}>
		<ToolChildrenWrapper>
			<div className='!select-text cursor-auto'>
				{children}
			</div>
		</ToolChildrenWrapper>
	</ToolHeaderWrapper>
}



// should either be past or "-ing" tense, not present tense. Eg. when the LLM searches for something, the user expects it to say "I searched for X" or "I am searching for X". Not "I search X".

const loadingTitleWrapper = (item: React.ReactNode): React.ReactNode => {
	return <span className='flex items-center flex-nowrap'>
		{item}
		<IconLoading className='w-3 text-sm' />
	</span>
}

const titleOfBuiltinToolName = {
	'read_file': { done: '读取文件完成 (read_file)', proposed: '读取文件 (read_file)', running: loadingTitleWrapper('正在读取文件') },
	'ls_dir': { done: '查看目录完成 (ls_dir)', proposed: '查看目录 (ls_dir)', running: loadingTitleWrapper('正在查看目录') },
	'get_dir_tree': { done: '查看目录树完成 (get_dir_tree)', proposed: '查看目录树 (get_dir_tree)', running: loadingTitleWrapper('正在查看目录树') },
	'search_pathnames_only': { done: '搜索文件名完成 (search_pathnames_only)', proposed: '搜索文件名 (search_pathnames_only)', running: loadingTitleWrapper('正在搜索文件名') },
	'search_for_files': { done: '搜索完成 (search_for_files)', proposed: '搜索文件 (search_for_files)', running: loadingTitleWrapper('正在搜索') },
	'create_file_or_folder': { done: '创建完成 (create_file_or_folder)', proposed: '创建文件/文件夹 (create_file_or_folder)', running: loadingTitleWrapper('正在创建') },
	'delete_file_or_folder': { done: '删除完成 (delete_file_or_folder)', proposed: '删除文件/文件夹 (delete_file_or_folder)', running: loadingTitleWrapper('正在删除') },
	'edit_file': { done: '编辑文件完成 (edit_file)', proposed: '编辑文件 (edit_file)', running: loadingTitleWrapper('正在编辑文件') },
	'rewrite_file': { done: '写入文件完成 (rewrite_file)', proposed: '写入文件 (rewrite_file)', running: loadingTitleWrapper('正在写入文件') },
	'run_command': { done: '运行命令完成 (run_command)', proposed: '运行命令 (run_command)', running: loadingTitleWrapper('正在运行命令') },
	'run_persistent_command': { done: '运行命令完成 (run_persistent_command)', proposed: '运行命令 (run_persistent_command)', running: loadingTitleWrapper('正在运行命令') },

	'open_persistent_terminal': { done: '打开终端完成 (open_persistent_terminal)', proposed: '打开终端 (open_persistent_terminal)', running: loadingTitleWrapper('正在打开终端') },
	'kill_persistent_terminal': { done: '关闭终端完成 (kill_persistent_terminal)', proposed: '关闭终端 (kill_persistent_terminal)', running: loadingTitleWrapper('正在关闭终端') },

	'read_lint_errors': { done: '读取代码错误完成 (read_lint_errors)', proposed: '读取代码错误 (read_lint_errors)', running: loadingTitleWrapper('正在读取代码错误') },
	'search_in_file': { done: '文件内搜索完成 (search_in_file)', proposed: '文件内搜索 (search_in_file)', running: loadingTitleWrapper('正在文件内搜索') },
	'open_browser': { done: '打开浏览器完成 (open_browser)', proposed: '打开浏览器 (open_browser)', running: loadingTitleWrapper('正在打开浏览器') },
	'fetch_url': { done: '获取网页完成 (fetch_url)', proposed: '获取网页 (fetch_url)', running: loadingTitleWrapper('正在获取网页') },
	'web_search': { done: '联网搜索完成 (web_search)', proposed: '联网搜索 (web_search)', running: loadingTitleWrapper('正在联网搜索') },
	//'clone_website': { done: '克隆网站完成 (clone_website)', proposed: '克隆网站 (clone_website)', running: loadingTitleWrapper('正在克隆网站') },
	'analyze_image': { done: '图片分析完成 (analyze_image)', proposed: '图片分析 (analyze_image)', running: loadingTitleWrapper('正在分析图片') },
	'screenshot_to_code': { done: '生成代码完成 (any_to_code)', proposed: '生成代码 (any_to_code)', running: loadingTitleWrapper('正在生成代码') },
	'api_request': { done: 'API请求完成 (api_request)', proposed: 'API请求 (api_request)', running: loadingTitleWrapper('正在发送API请求') },

	// Office document tools
	'read_document': { done: '读取文档完成 (read_document)', proposed: '读取文档 (read_document)', running: loadingTitleWrapper('正在读取文档') },
	'edit_document': { done: '编辑文档完成 (edit_document)', proposed: '编辑文档 (edit_document)', running: loadingTitleWrapper('正在编辑文档') },
	'create_document': { done: '创建文档完成 (create_document)', proposed: '创建文档 (create_document)', running: loadingTitleWrapper('正在创建文档') },
	'pdf_operation': { done: 'PDF操作完成 (pdf_operation)', proposed: 'PDF操作 (pdf_operation)', running: loadingTitleWrapper('正在执行PDF操作') },
	'document_convert': { done: '文档转换完成 (document_convert)', proposed: '文档转换 (document_convert)', running: loadingTitleWrapper('正在转换文档') },
	'document_merge': { done: '文档合并完成 (document_merge)', proposed: '文档合并 (document_merge)', running: loadingTitleWrapper('正在合并文档') },
	'document_extract': { done: '内容提取完成 (document_extract)', proposed: '内容提取 (document_extract)', running: loadingTitleWrapper('正在提取内容') },

	// Agent tools
	'spawn_subagent': { done: '子代理完成 (spawn_subagent)', proposed: '启动子代理 (spawn_subagent)', running: loadingTitleWrapper('正在运行子代理') },
	'edit_agent': { done: '编辑代理完成 (edit_agent)', proposed: '编辑代理 (edit_agent)', running: loadingTitleWrapper('正在编辑代理') },
	'skill': { done: '技能执行完成 (skill)', proposed: '执行技能 (skill)', running: loadingTitleWrapper('正在执行技能') },
} as const satisfies Record<BuiltinToolName, { done: any, proposed: any, running: any }>


const getTitle = (toolMessage: Pick<ChatMessage & { role: 'tool' }, 'name' | 'type' | 'mcpServerName'>): React.ReactNode => {
	const t = toolMessage

	// non-built-in title (MCP tools)
	if (!builtinToolNames.includes(t.name as BuiltinToolName)) {
		// descriptor of Running or Ran etc (中文 + 英文工具名)
		const descriptor =
			t.type === 'success' ? '调用完成'
				: t.type === 'running_now' ? '正在调用'
					: t.type === 'tool_request' ? '调用'
						: t.type === 'rejected' ? '调用'
							: t.type === 'invalid_params' ? '调用'
								: t.type === 'tool_error' ? '调用'
									: '调用'

		const serverName = toolMessage.mcpServerName || 'MCP'
		const toolName = t.name
		const title = `${descriptor} ${serverName} 工具 (${toolName})`
		if (t.type === 'running_now' || t.type === 'tool_request')
			return loadingTitleWrapper(title)
		return title
	}

	// built-in title
	else {
		const toolName = t.name as BuiltinToolName
		if (t.type === 'success') return titleOfBuiltinToolName[toolName].done
		if (t.type === 'running_now') return titleOfBuiltinToolName[toolName].running
		return titleOfBuiltinToolName[toolName].proposed
	}
}


const toolNameToDesc = (toolName: BuiltinToolName, _toolParams: BuiltinToolCallParams[BuiltinToolName] | undefined, accessor: ReturnType<typeof useAccessor>): {
	desc1: React.ReactNode,
	desc1Info?: string,
} => {

	if (!_toolParams) {
		return { desc1: '', };
	}

	const x = {
		'read_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['read_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'ls_dir': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['ls_dir']
			return {
				desc1: getFolderName(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'search_pathnames_only': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_pathnames_only']
			return {
				desc1: `"${toolParams.query}"`,
			}
		},
		'search_for_files': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_for_files']
			return {
				desc1: `"${toolParams.query}"`,
			}
		},
		'search_in_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_in_file'];
			return {
				desc1: `"${toolParams.query}"`,
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'create_file_or_folder': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['create_file_or_folder']
			return {
				desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'delete_file_or_folder': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['delete_file_or_folder']
			return {
				desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'rewrite_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['rewrite_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'edit_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['edit_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'run_command': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['run_command']
			return {
				desc1: `"${toolParams.command}"`,
			}
		},
		'run_persistent_command': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['run_persistent_command']
			return {
				desc1: `"${toolParams.command}"`,
			}
		},
		'open_persistent_terminal': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['open_persistent_terminal']
			return { desc1: '' }
		},
		'kill_persistent_terminal': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['kill_persistent_terminal']
			return { desc1: toolParams.persistentTerminalId }
		},
		'get_dir_tree': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['get_dir_tree']
			return {
				desc1: getFolderName(toolParams.uri.fsPath) ?? '/',
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'read_lint_errors': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['read_lint_errors']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'open_browser': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['open_browser']
			return {
				desc1: toolParams.url,
			}
		},
		'fetch_url': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['fetch_url']
			return {
				desc1: toolParams.url,
			}
		},
		'web_search': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['web_search']
			return {
				desc1: toolParams.query,
			}
		},
		/* 'clone_website': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['clone_website']
			return {
				desc1: toolParams.url,
			}
		}, */
		'analyze_image': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['analyze_image']
			const imageLength = toolParams.image_data?.length || 0;
			const sizeKB = (imageLength * 0.75 / 1024).toFixed(1); // Base64 is ~33% larger
			return {
				desc1: `Image (${sizeKB} KB)`,
			}
		},
		'screenshot_to_code': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['screenshot_to_code']
			const stack = toolParams.stack || 'html_tailwind';
			if (toolParams.source === 'url') {
				return {
					desc1: `${toolParams.url} → ${stack}`,
				}
			} else {
				const imageLength = toolParams.image_data?.length || 0;
				const sizeKB = (imageLength * 0.75 / 1024).toFixed(1);
				return {
					desc1: `Image (${sizeKB} KB) → ${stack}`,
				}
			}
		},
		'api_request': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['api_request']
			const method = toolParams.method || 'GET';
			try {
				const urlObj = new URL(toolParams.url);
				return {
					desc1: `${method} ${urlObj.hostname}${urlObj.pathname.length > 30 ? urlObj.pathname.substring(0, 30) + '...' : urlObj.pathname}`,
				}
			} catch {
				return {
					desc1: `${method} ${toolParams.url.substring(0, 50)}${toolParams.url.length > 50 ? '...' : ''}`,
				}
			}
		},
		// Office document tools
		'read_document': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['read_document']
			return { desc1: toolParams.uri?.fsPath ? getBasename(toolParams.uri.fsPath) : '', desc1Info: getRelative(toolParams.uri, accessor) }
		},
		'edit_document': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['edit_document']
			return { desc1: toolParams.uri?.fsPath ? getBasename(toolParams.uri.fsPath) : '', desc1Info: getRelative(toolParams.uri, accessor) }
		},
		'create_document': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['create_document']
			return { desc1: toolParams.file_path ? getBasename(toolParams.file_path) : '' }
		},
		'pdf_operation': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['pdf_operation']
			return { desc1: toolParams.operation || '' }
		},
		'document_convert': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['document_convert']
			return { desc1: toolParams.input_file ? getBasename(toolParams.input_file) : '' }
		},
		'document_merge': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['document_merge']
			return { desc1: `${toolParams.input_files?.length || 0} files` }
		},
		'document_extract': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['document_extract']
			return { desc1: toolParams.input_file ? getBasename(toolParams.input_file) : '' }
		},
		'spawn_subagent': () => {
			return { desc1: '' }
		},
		'edit_agent': () => {
			return { desc1: '' }
		},
		'skill': () => {
			return { desc1: '' }
		},
	}

	try {
		return x[toolName]?.() || { desc1: '' }
	}
	catch {
		return { desc1: '' }
	}
}

const ToolRequestAcceptRejectButtons = ({ toolName }: { toolName: ToolName }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const metricsService = accessor.get('IMetricsService')
	const senweaverSettingsService = accessor.get('ISenweaverSettingsService')
	const senweaverSettingsState = useSettingsState()

	const onAccept = useCallback(() => {
		try { // this doesn't need to be wrapped in try/catch anymore
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.approveLatestToolRequest(threadId)
			metricsService.capture('Tool Request Accepted', {})
		} catch (e) { }
	}, [chatThreadsService, metricsService])

	const onReject = useCallback(() => {
		try {
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.rejectLatestToolRequest(threadId)
		} catch (e) { }
		metricsService.capture('Tool Request Rejected', {})
	}, [chatThreadsService, metricsService])

	const approveButton = (
		<button
			onClick={onAccept}
			className={`
				px-2 py-1
				bg-[var(--vscode-button-background)]
				text-[var(--vscode-button-foreground)]
				hover:bg-[var(--vscode-button-hoverBackground)]
				rounded
				text-sm font-medium
			`}
		>
			Approve
		</button>
	)

	const cancelButton = (
		<button
			onClick={onReject}
			className={`
				px-2 py-1
				bg-[var(--vscode-button-secondaryBackground)]
				text-[var(--vscode-button-secondaryForeground)]
				hover:bg-[var(--vscode-button-secondaryHoverBackground)]
				rounded
				text-sm font-medium
			`}
		>
			Cancel
		</button>
	)

	const approvalType = isABuiltinToolName(toolName) ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
	const approvalToggle = approvalType ? <div key={approvalType} className="flex items-center ml-2 gap-x-1">
		<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
	</div> : null

	return <div className="flex gap-2 mx-0.5 items-center">
		{approveButton}
		{cancelButton}
		{approvalToggle}
	</div>
}

export const ToolChildrenWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <div className={`${className ? className : ''} cursor-default select-none`}>
		<div className='px-2 min-w-full overflow-hidden'>
			{children}
		</div>
	</div>
}
export const CodeChildren = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <div className={`${className ?? ''} p-1 rounded-sm overflow-auto text-sm`}>
		<div className='!select-text cursor-auto'>
			{children}
		</div>
	</div>
}

export const ListableToolItem = ({ name, onClick, isSmall, className, showDot }: { name: React.ReactNode, onClick?: () => void, isSmall?: boolean, className?: string, showDot?: boolean }) => {
	return <div
		className={`
			${onClick ? 'hover:brightness-125 hover:cursor-pointer transition-all duration-200 ' : ''}
			flex items-center flex-nowrap whitespace-nowrap
			${className ? className : ''}
			`}
		onClick={onClick}
	>
		{showDot === false ? null : <div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>}
		<div className={`${isSmall ? 'italic text-senweaver-fg-4 flex items-center' : ''}`}>{name}</div>
	</div>
}



const EditToolChildren = ({ uri, code, type }: { uri: URI | undefined, code: string, type: 'diff' | 'rewrite' }) => {

	const content = type === 'diff' ?
		<SenweaverDiffEditor uri={uri} searchReplaceBlocks={code} />
		: <ChatMarkdownRender string={`\`\`\`\n${code}\n\`\`\``} codeURI={uri} chatMessageLocation={undefined} />

	return <div className='!select-text cursor-auto'>
		<SmallProseWrapper>
			{content}
		</SmallProseWrapper>
	</div>

}


const LintErrorChildren = ({ lintErrors }: { lintErrors: LintErrorItem[] }) => {
	return <div className="text-xs text-senweaver-fg-4 opacity-80 border-l-2 border-senweaver-warning px-2 py-0.5 flex flex-col gap-0.5 overflow-x-auto whitespace-nowrap">
		{lintErrors.map((error, i) => (
			<div key={i}>Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}</div>
		))}
	</div>
}

const BottomChildren = ({ children, title }: { children: React.ReactNode, title: string }) => {
	const [isOpen, setIsOpen] = useState(false);
	if (!children) return null;
	return (
		<div className="w-full px-2 mt-0.5">
			<div
				className={`flex items-center cursor-pointer select-none transition-colors duration-150 pl-0 py-0.5 rounded group`}
				onClick={() => setIsOpen(o => !o)}
				style={{ background: 'none' }}
			>
				<ChevronRight
					className={`mr-1 h-3 w-3 flex-shrink-0 transition-transform duration-100 text-senweaver-fg-4 group-hover:text-senweaver-fg-3 ${isOpen ? 'rotate-90' : ''}`}
				/>
				<span className="font-medium text-senweaver-fg-4 group-hover:text-senweaver-fg-3 text-xs">{title}</span>
			</div>
			<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-xs pl-4`}
			>
				<div className="overflow-x-auto text-senweaver-fg-4 opacity-90 border-l-2 border-senweaver-warning px-2 py-0.5">
					{children}
				</div>
			</div>
		</div>
	);
}


const EditToolHeaderButtons = ({ applyBoxId, uri, codeStr, toolName, threadId }: { threadId: string, applyBoxId: string, uri: URI, codeStr: string, toolName: 'edit_file' | 'rewrite_file' }) => {
	const { streamState } = useEditToolStreamState({ applyBoxId, uri })
	return <div className='flex items-center gap-1'>
		{/* <StatusIndicatorForApplyButton applyBoxId={applyBoxId} uri={uri} /> */}
		{/* <JumpToFileButton uri={uri} /> */}
		{streamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} toolTipName='Copy' />}
		<EditToolAcceptRejectButtonsHTML type={toolName} codeStr={codeStr} applyBoxId={applyBoxId} uri={uri} threadId={threadId} />
	</div>
}



const InvalidTool = ({ toolName, message, mcpServerName }: { toolName: ToolName, message: string, mcpServerName: string | undefined }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'invalid_params', mcpServerName })
	const desc1 = 'Invalid parameters'
	const icon = null
	const isError = true
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

	componentParams.children = <ToolChildrenWrapper>
		<CodeChildren className='bg-senweaver-bg-3'>
			{message}
		</CodeChildren>
	</ToolChildrenWrapper>
	return <ToolHeaderWrapper {...componentParams} />
}

const CanceledTool = ({ toolName, mcpServerName }: { toolName: ToolName, mcpServerName: string | undefined }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'rejected', mcpServerName })
	const desc1 = ''
	const icon = null
	const isRejected = true
	const componentParams: ToolHeaderParams = { title, desc1, icon, isRejected }
	return <ToolHeaderWrapper {...componentParams} />
}


const CommandTool = ({ toolMessage, type, threadId }: { threadId: string } & ({
	toolMessage: Exclude<ToolMessage<'run_command'>, { type: 'invalid_params' }>
	type: 'run_command'
} | {
	toolMessage: Exclude<ToolMessage<'run_persistent_command'>, { type: 'invalid_params' }>
	type: | 'run_persistent_command'
})) => {
	const accessor = useAccessor()

	const commandService = accessor.get('ICommandService')
	const terminalToolsService = accessor.get('ITerminalToolService')
	const toolsService = accessor.get('IToolsService')
	const isError = false
	const title = getTitle(toolMessage)
	const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
	const icon = null
	const streamState = useChatThreadsStreamState(threadId)

	const divRef = useRef<HTMLDivElement | null>(null)

	const isRejected = toolMessage.type === 'rejected'
	const { params } = toolMessage
	const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }


	const effect = async () => {
		if (streamState?.isRunning !== 'tool') return
		if (type !== 'run_command' || toolMessage.type !== 'running_now') return;

		// wait for the interruptor so we know it's running

		await streamState?.interrupt
		const container = divRef.current;
		if (!container) return;

		const terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
		if (!terminal) return;

		try {
			terminal.attachToElement(container);
			terminal.setVisible(true)
		} catch {
		}

		// Listen for size changes of the container and keep the terminal layout in sync.
		const resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].borderBoxSize[0].blockSize;
			const width = entries[0].borderBoxSize[0].inlineSize;
			if (typeof terminal.layout === 'function') {
				terminal.layout({ width, height });
			}
		});

		resizeObserver.observe(container);
		return () => { terminal.detachFromElement(); resizeObserver?.disconnect(); }
	}

	useEffect(() => {
		effect()
	}, [terminalToolsService, toolMessage, toolMessage.type, type]);

	if (toolMessage.type === 'success') {
		const { result } = toolMessage

		// it's unclear that this is a button and not an icon.
		// componentParams.desc2 = <JumpToTerminalButton
		// 	onClick={() => { terminalToolsService.openTerminal(terminalId) }}
		// />

		let msg: string
		if (type === 'run_command') msg = toolsService.stringOfResult['run_command'](toolMessage.params, result)
		else msg = toolsService.stringOfResult['run_persistent_command'](toolMessage.params, result)

		if (type === 'run_persistent_command') {
			componentParams.info = persistentTerminalNameOfId(toolMessage.params.persistentTerminalId)
		}

		componentParams.children = <ToolChildrenWrapper className='whitespace-pre text-nowrap overflow-auto text-sm'>
			<div className='!select-text cursor-auto'>
				<BlockCode initValue={`${msg.trim()}`} language='shellscript' />
			</div>
		</ToolChildrenWrapper>
	}
	else if (toolMessage.type === 'tool_error') {
		const { result } = toolMessage
		componentParams.bottomChildren = <BottomChildren title='Error'>
			<CodeChildren>
				{result}
			</CodeChildren>
		</BottomChildren>
	}
	else if (toolMessage.type === 'running_now') {
		const chatThreadsService = accessor.get('IChatThreadService')

		// 停止命令的处理函数
		const handleStopCommand = async () => {
			try {
				await chatThreadsService.abortRunning(threadId)
			} catch (e) {
				console.error('Failed to stop command:', e)
			}
		}

		if (type === 'run_command') {
			componentParams.children = <>
				<div ref={divRef} className='relative h-[300px] text-sm' />
				<div className='flex justify-end mt-2 px-2'>
					<button
						onClick={handleStopCommand}
						className='flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors'
					>
						<Ban size={12} />
						Stop
					</button>
				</div>
			</>
		} else {
			// run_persistent_command 也显示停止按钮
			componentParams.children = <div className='flex justify-end mt-2 px-2'>
				<button
					onClick={handleStopCommand}
					className='flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors'
				>
					<Ban size={12} />
					Stop
				</button>
			</div>
		}
	}
	else if (toolMessage.type === 'rejected' || toolMessage.type === 'tool_request') {
	}

	return <>
		<ToolHeaderWrapper {...componentParams} isOpen={type === 'run_command' && toolMessage.type === 'running_now' ? true : undefined} />
	</>
}

type WrapperProps<T extends ToolName> = { toolMessage: Exclude<ToolMessage<T>, { type: 'invalid_params' }>, messageIdx: number, threadId: string }
const MCPToolWrapper = ({ toolMessage }: WrapperProps<string>) => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')

	const title = getTitle(toolMessage)
	const desc1 = removeMCPToolNamePrefix(toolMessage.name)
	const icon = null


	if (toolMessage.type === 'running_now') return null // do not show running

	const isError = false
	const isRejected = toolMessage.type === 'rejected'
	const { params } = toolMessage
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected, }

	const paramsStr = JSON.stringify(params, null, 2)
	componentParams.desc2 = <CopyButton codeStr={paramsStr} toolTipName={`Copy inputs: ${paramsStr}`} />

	componentParams.info = !toolMessage.mcpServerName ? 'MCP tool not found' : undefined

	// Add copy inputs button in desc2


	if (toolMessage.type === 'success' || toolMessage.type === 'tool_request') {
		const { result } = toolMessage
		const resultStr = result ? mcpService.stringifyResult(result) : 'null'
		componentParams.children = <ToolChildrenWrapper>
			<SmallProseWrapper>
				<ChatMarkdownRender
					string={`\`\`\`json\n${resultStr}\n\`\`\``}
					chatMessageLocation={undefined}
					isApplyEnabled={false}
					isLinkDetectionEnabled={true}
				/>
			</SmallProseWrapper>
		</ToolChildrenWrapper>
	}
	else if (toolMessage.type === 'tool_error') {
		const { result } = toolMessage
		componentParams.bottomChildren = <BottomChildren title='Error'>
			<CodeChildren>
				{result}
			</CodeChildren>
		</BottomChildren>
	}

	return <ToolHeaderWrapper {...componentParams} />

}

type ResultWrapper<T extends ToolName> = (props: WrapperProps<T>) => React.ReactNode

const builtinToolNameToComponent: { [T in BuiltinToolName]: { resultWrapper: ResultWrapper<T>, } } = {
	'read_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			let range: [number, number] | undefined = undefined
			if (toolMessage.params.startLine !== null || toolMessage.params.endLine !== null) {
				const start = toolMessage.params.startLine === null ? `1` : `${toolMessage.params.startLine}`
				const end = toolMessage.params.endLine === null ? `` : `${toolMessage.params.endLine}`
				const addStr = `(${start}-${end})`
				componentParams.desc1 += ` ${addStr}`
				range = [params.startLine || 1, params.endLine || 1]
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor, range) }
				if (result.hasNextPage && params.pageNumber === 1)  // first page
					componentParams.desc2 = `(truncated after ${Math.round(MAX_FILE_CHARS_PAGE) / 1000}k)`
				else if (params.pageNumber > 1) // subsequent pages
					componentParams.desc2 = `(part ${params.pageNumber})`
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				// JumpToFileButton removed in favor of FileLinkText
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'get_dir_tree': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<SmallProseWrapper>
						<ChatMarkdownRender
							string={`\`\`\`\n${result.str}\n\`\`\``}
							chatMessageLocation={undefined}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</SmallProseWrapper>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />

		}
	},
	'ls_dir': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const explorerService = accessor.get('IExplorerService')
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.numResults = result.children?.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = !result.children || (result.children.length ?? 0) === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.children.map((child, i) => (<ListableToolItem key={i}
							name={`${child.name}${child.isDirectory ? '/' : ''}`}
							className='w-full overflow-auto'
							onClick={() => {
								senweaverOpenFileFn(child.uri, accessor)
								// commandService.executeCommand('workbench.view.explorer'); // open in explorer folders view instead
								// explorerService.select(child.uri, true);
							}}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated (${result.itemsRemaining} remaining).`} isSmall={true} className='w-full overflow-auto' />
						}
					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_pathnames_only': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.includePattern) {
				componentParams.info = `Only search in ${params.includePattern}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { senweaverOpenFileFn(uri, accessor) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={'Results truncated.'} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_for_files': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.searchInFolder || params.isRegex) {
				let info: string[] = []
				if (params.searchInFolder) {
					const rel = getRelative(params.searchInFolder, accessor)
					if (rel) info.push(`Only search in ${rel}`)
				}
				if (params.isRegex) { info.push(`Uses regex search`) }
				componentParams.info = info.join('; ')
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { senweaverOpenFileFn(uri, accessor) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated.`} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			return <ToolHeaderWrapper {...componentParams} />
		}
	},

	'search_in_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();
			const toolsService = accessor.get('IToolsService');
			const title = getTitle(toolMessage);
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null;

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { params } = toolMessage;
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };

			const infoarr: string[] = []
			const uriStr = getRelative(params.uri, accessor)
			if (uriStr) infoarr.push(uriStr)
			if (params.isRegex) infoarr.push('Uses regex search')
			componentParams.info = infoarr.join('; ')

			if (toolMessage.type === 'success') {
				const { result } = toolMessage; // result is array of snippets
				componentParams.numResults = result.lines.length;
				componentParams.children = result.lines.length === 0 ? undefined :
					<ToolChildrenWrapper>
						<CodeChildren className='bg-senweaver-bg-3'>
							<pre className='font-mono whitespace-pre'>
								{toolsService.stringOfResult['search_in_file'](params, result)}
							</pre>
						</CodeChildren>
					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage;
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />;
		}
	},

	'read_lint_errors': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { uri } = toolMessage.params ?? {}
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			componentParams.info = getRelative(uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
				if (result.lintErrors)
					componentParams.children = <LintErrorChildren lintErrors={result.lintErrors} />
				else
					componentParams.children = `No lint errors found.`

			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				// JumpToFileButton removed in favor of FileLinkText
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},

	// ---

	'create_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null


			const { params } = toolMessage

			// 获取代码变更统计
			const changeStats = toolMessage.type === 'success' && toolMessage.result?.changeStats && !params.isFolder
				? toolMessage.result.changeStats
				: undefined

			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, changeStats }

			componentParams.info = getRelative(params.uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			else if (toolMessage.type === 'running_now') {
				// nothing more is needed
			}
			else if (toolMessage.type === 'tool_request') {
				// nothing more is needed
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'delete_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isFolder = toolMessage.params?.isFolder ?? false
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			componentParams.info = getRelative(params.uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			else if (toolMessage.type === 'running_now') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_request') {
				const { result } = toolMessage
				componentParams.onClick = () => { senweaverOpenFileFn(params.uri, accessor) }
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'rewrite_file': {
		resultWrapper: (params) => {
			return <EditTool {...params} content={params.toolMessage.params.newContent} />
		}
	},
	'edit_file': {
		resultWrapper: (params) => {
			return <EditTool {...params} content={params.toolMessage.params.searchReplaceBlocks} />
		}
	},

	// ---

	'run_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_command' />
		}
	},

	'run_persistent_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_persistent_command' />
		}
	},
	'open_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			const relativePath = params.cwd ? getRelative(URI.file(params.cwd), accessor) : ''
			componentParams.info = relativePath ? `Running in ${relativePath}` : undefined

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				const { persistentTerminalId } = result
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'kill_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { persistentTerminalId } = params
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'open_browser': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'fetch_url': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null
			const [elapsedSeconds, setElapsedSeconds] = React.useState(0)

			React.useEffect(() => {
				if (toolMessage.type !== 'running_now') return
				setElapsedSeconds(0)
				const startedAt = Date.now()
				const interval = window.setInterval(() => {
					setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
				}, 1000)
				return () => window.clearInterval(interval)
			}, [toolMessage.type])

			if (toolMessage.type === 'tool_request') return null // do not show past requests

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'running_now') {
				componentParams.info = params?.url
					? `${params.url}${elapsedSeconds > 0 ? ` • 已等待 ${elapsedSeconds}s` : ''}`
					: (elapsedSeconds > 0 ? `已等待 ${elapsedSeconds}s` : undefined)
				return <ToolHeaderWrapper {...componentParams} />
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				const statusText = `Status: ${result.statusCode}`
				componentParams.info = statusText

				// Add web fetch icon badge
				componentParams.desc2 = (
					<div className='flex items-center gap-1 ml-2'>
						<span className='inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400'>
							<svg className='w-3 h-3' fill='currentColor' viewBox='0 0 20 20'>
								<path d='M10 2a8 8 0 100 16 8 8 0 000-16zM9 5h2v6H9V5zm0 8h2v2H9v-2z'/>
							</svg>
						</span>
						<span className='text-xs text-senweaver-text-2'>Web Fetch</span>
					</div>
				)

				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren className='bg-senweaver-bg-3'>
						<pre className='font-mono whitespace-pre-wrap break-words text-sm'>
							{result.body}
						</pre>
					</CodeChildren>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'web_search': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			// Open URL in built-in Senweaver Browser
			const openInBuiltInBrowser = (url: string) => {
				try {
					commandService.executeCommand('senweaver.openBrowserWithUrl', url)
				} catch (e) {
					// Fallback to external browser if Senweaver Browser fails
					window.open(url, '_blank')
				}
			}

			if (toolMessage.type === 'tool_request') return null // do not show past requests

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'running_now') {
				const infoParts: string[] = []
				if (params?.query) infoParts.push(params.query)
				if ((params as any)?.engine) infoParts.push(`engine: ${(params as any).engine}`)
				if ((params as any)?.engines && Array.isArray((params as any).engines)) infoParts.push(`engines: ${((params as any).engines as any[]).join(', ')}`)
				componentParams.info = infoParts.length ? infoParts.join(' • ') : undefined
				return <ToolHeaderWrapper {...componentParams} />
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				const MAX_DISPLAY_RESULTS = 16

				// Engine icon URLs - using official favicon sources with distinct icons
				const engineIcons: Record<string, string> = {
					'duckduckgo': 'https://duckduckgo.com/favicon.ico',
					'brave': 'https://brave.com/static-assets/images/brave-favicon.png',
					'bing': 'https://www.bing.com/favicon.ico',
					'baidu': 'https://www.baidu.com/favicon.ico',
					'csdn': 'https://g.csdnimg.cn/static/logo/favicon32.ico',
					'juejin': 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png',
					'zhihu': 'https://static.zhihu.com/heifetz/favicon.ico',
					'jina': 'https://jina.ai/favicon.ico',
					'weixin': 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico',
					'wechat': 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico',
					'github': 'https://github.githubassets.com/favicons/favicon.svg',
					'arxiv': 'https://static.arxiv.org/static/browse/0.3.4/images/icons/favicon-32x32.png',
					'semanticscholar': 'https://cdn.semanticscholar.org/d5a7fc2a8d2c90b9/img/favicon-32x32.png',
					'dblp': 'https://dblp.org/img/dblp.icon.192x192.png',
					'pubmed': 'https://www.ncbi.nlm.nih.gov/favicon.ico',
					'googlescholar': 'https://scholar.google.com/favicon.ico',
				}

				// Engine emoji fallbacks when icons fail to load (distinct emojis)
				const engineEmojis: Record<string, string> = {
					'duckduckgo': '🦆', 'brave': '🦁', 'bing': 'Ⓑ',
					'baidu': '度', 'csdn': 'C', 'juejin': '💎',
					'zhihu': '知', 'jina': 'J', 'weixin': '微',
					'wechat': '微', 'github': 'github', 'arxiv': '📝',
					'semanticscholar': 'S2', 'dblp': 'DB', 'pubmed': 'PM',
					'googlescholar': '🎓',
				}

				// Get engine name from URL domain (for accurate icon display)
				const getEngineFromUrl = (url: string): string | null => {
					try {
						const hostname = new URL(url).hostname.toLowerCase()
						if (hostname.includes('zhihu.com')) return 'zhihu'
						if (hostname.includes('github.com') || hostname.includes('github.io')) return 'github'
						if (hostname.includes('csdn.net')) return 'csdn'
						if (hostname.includes('juejin.cn') || hostname.includes('juejin.im')) return 'juejin'
						if (hostname.includes('baidu.com')) return 'baidu'
						if (hostname.includes('weixin') || hostname.includes('sogou.com/weixin') || hostname.includes('mp.weixin.qq.com')) return 'weixin'
						if (hostname.includes('bing.com')) return 'bing'
						if (hostname.includes('duckduckgo.com')) return 'duckduckgo'
						if (hostname.includes('brave.com')) return 'brave'
						if (hostname.includes('arxiv.org')) return 'arxiv'
						if (hostname.includes('semanticscholar.org')) return 'semanticscholar'
						if (hostname.includes('dblp.org') || hostname.includes('dblp.uni-trier.de')) return 'dblp'
						if (hostname.includes('pubmed.ncbi.nlm.nih.gov') || hostname.includes('ncbi.nlm.nih.gov')) return 'pubmed'
						if (hostname.includes('scholar.google.com') || hostname.includes('scholar.google.')) return 'googlescholar'
						return null
					} catch {
						return null
					}
				}

				// Count search engines used
				const engineCounts: Record<string, number> = {}
				result.results.forEach((item: any) => {
					if (item.engine) {
						engineCounts[item.engine] = (engineCounts[item.engine] || 0) + 1
					}
				})
				const engines = Object.keys(engineCounts)

				// Smart result selection: ensure each engine has at least 1 result
				const displayResults: any[] = []
				const seenUrls = new Set<string>()

				// First pass: one result per engine
				for (const engine of engines) {
					const engineResults = result.results.filter((item: any) =>
						item.engine === engine && !seenUrls.has(item.url)
					)
					if (engineResults.length > 0) {
						displayResults.push(engineResults[0])
						seenUrls.add(engineResults[0].url)
					}
				}

				// Second pass: fill remaining slots
				const remainingSlots = MAX_DISPLAY_RESULTS - displayResults.length
				if (remainingSlots > 0) {
					const remaining = result.results.filter((item: any) => !seenUrls.has(item.url))
					for (const item of remaining.slice(0, remainingSlots)) {
						displayResults.push(item)
						seenUrls.add(item.url)
					}
				}

				const finalResults = displayResults.slice(0, MAX_DISPLAY_RESULTS)
				const displayCount = finalResults.length

				// Create stacked icons with fallback
				const EngineIcon = ({ engine, url, size = 5, style = {} }: { engine: string; url?: string; size?: number; style?: React.CSSProperties }) => {
					const [failed, setFailed] = React.useState(false)
					// Prefer URL-based engine detection for result items
					const effectiveEngine = (url ? getEngineFromUrl(url) : null) || engine
					const iconUrl = engineIcons[effectiveEngine]
					const emoji = engineEmojis[effectiveEngine] || '🔍'

					if (failed || !iconUrl) {
						return <span className={`w-${size} h-${size} flex items-center justify-center text-xs`} style={style}>{emoji}</span>
					}
					return (
						<img
							src={iconUrl}
							className={`w-${size} h-${size} rounded-full border-2 border-senweaver-bg-1 bg-white object-contain`}
							style={style}
							alt={effectiveEngine}
							onError={() => setFailed(true)}
						/>
					)
				}

				const stackedIcons = engines.slice(0, 6).map((engine, index) => (
					<EngineIcon
						key={engine}
						engine={engine}
						size={5}
						style={{
							marginLeft: index > 0 ? '-8px' : '0',
							zIndex: engines.length - index,
							position: 'relative'
						}}
					/>
				))

				componentParams.desc2 = (
					<div className='flex items-center gap-2 ml-2'>
						<div className='flex items-center'>{stackedIcons}</div>
						<span className='text-senweaver-text-2 text-xs'>已阅读 {displayCount} 个网页</span>
					</div>
				)

				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren className='bg-senweaver-bg-3'>
						<div className='space-y-3 p-3'>
							{finalResults.map((item: any, idx: number) => (
								<div
									key={idx}
									className='border-b border-senweaver-bg-2 pb-2 last:border-b-0 cursor-pointer hover:bg-senweaver-bg-2 rounded p-2 -m-2 mb-1 transition-colors'
									onClick={() => openInBuiltInBrowser(item.url)}
								>
									<div className='flex items-start gap-2'>
										<EngineIcon engine={item.engine} url={item.url} size={4} />
										<div className='font-semibold text-sm text-senweaver-text-1 hover:text-senweaver-accent-1 flex-1'>
											{item.title}
										</div>
									</div>
									<div className='text-xs text-senweaver-text-3 mt-1 ml-6 truncate'>{item.url}</div>
									{item.snippet && (
										<div className='text-sm text-senweaver-text-2 mt-1 ml-6 line-clamp-2'>{item.snippet}</div>
									)}
								</div>
							))}
						</div>
					</CodeChildren>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	/* 'clone_website': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage

				if (result.success && result.summary) {
					const summary = result.summary
					const pagesCount = summary.pagesCount || 0
					componentParams.info = `${pagesCount} pages • ${summary.processingTime || '0s'}`

					componentParams.children = <ToolChildrenWrapper>
						<CodeChildren className='bg-senweaver-bg-3'>
							<div className='space-y-3 p-3 text-xs'>
								<div className='font-semibold text-senweaver-text-1'>{summary.title || 'Website Cloned'}</div>

								<div className='grid grid-cols-2 gap-x-4 gap-y-1 text-senweaver-text-2'>
									<div><span className='text-senweaver-text-3'>📄 Pages:</span> {summary.pagesCount || 0}</div>
									<div><span className='text-senweaver-text-3'>🖼️ Images:</span> {summary.images || 0}</div>
									<div><span className='text-senweaver-text-3'>📝 Forms:</span> {summary.forms || 0}</div>
									<div><span className='text-senweaver-text-3'>🔘 Buttons:</span> {summary.buttons || 0}</div>
								</div>

								{summary.frameworks && summary.frameworks.length > 0 && (
									<div>
										<span className='text-senweaver-text-3'>⚡ Frameworks:</span> {summary.frameworks.join(', ')}
									</div>
								)}

								{summary.colors && summary.colors.length > 0 && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>🎨 Colors ({summary.colors.length}):</span>
										<div className='flex flex-wrap gap-1'>
											{summary.colors.slice(0, 12).map((color: string, idx: number) => (
												<div key={idx} className='w-3 h-3 rounded border' style={{ backgroundColor: color }} title={color} />
											))}
										</div>
									</div>
								)}

								{result.sitemap && result.sitemap.length > 0 && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>🗺️ Sitemap:</span>
										<div className='pl-2 space-y-0.5 max-h-32 overflow-y-auto text-[10px]'>
											{result.sitemap.slice(0, 10).map((page: any, idx: number) => (
												<div key={idx} className='truncate'>
													<span className='text-senweaver-text-3'>D{page.depth}</span> {page.title || page.url}
												</div>
											))}
											{result.sitemap.length > 10 && (
												<div className='text-senweaver-text-3 italic'>... +{result.sitemap.length - 10} more pages</div>
											)}
										</div>
									</div>
								)}

								<div className='text-senweaver-text-3 text-[10px] italic border-t border-senweaver-bg-2 pt-2'>
									💡 {pagesCount}-page site analyzed • Use this data to generate a complete React application
								</div>
							</div>
						</CodeChildren>
					</ToolChildrenWrapper>
				} else {
					componentParams.info = 'Failed'
					if (result.error) {
						componentParams.bottomChildren = <BottomChildren title='Error'>
							<CodeChildren>{result.error}</CodeChildren>
						</BottomChildren>
					}
				}
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>{result}</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	}, */
	'analyze_image': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage

				if (result.success) {
					componentParams.info = result.processingTime || '0ms'

					componentParams.children = <ToolChildrenWrapper>
						<CodeChildren className='bg-senweaver-bg-3'>
							<div className='space-y-3 p-3 text-xs'>
								<div className='font-semibold text-senweaver-text-1'>
									{result.method === 'local' ? '📊 Local Analysis' : '🤖 AI Vision Analysis'}
								</div>

								{result.basicInfo && (
									<div className='grid grid-cols-2 gap-x-4 gap-y-1 text-senweaver-text-2'>
										<div><span className='text-senweaver-text-3'>📐 Dimensions:</span> {result.basicInfo.width}x{result.basicInfo.height}</div>
										<div><span className='text-senweaver-text-3'>📁 Format:</span> {result.basicInfo.format.toUpperCase()}</div>
										<div><span className='text-senweaver-text-3'>💾 Size:</span> {result.basicInfo.sizeFormatted}</div>
										<div><span className='text-senweaver-text-3'>🎨 Channels:</span> {result.basicInfo.channels}{result.basicInfo.hasAlpha ? ' + Alpha' : ''}</div>
									</div>
								)}

								{result.quality && (
									<div className='space-y-1'>
										<div className='text-senweaver-text-3 font-semibold'>Quality Metrics</div>
										<div className='grid grid-cols-2 gap-x-4 gap-y-1 text-senweaver-text-2 text-[11px]'>
											<div>Aspect: {result.quality.aspectRatio}</div>
											<div>MP: {result.quality.megapixels}</div>
											<div>Space: {result.quality.colorSpace}</div>
										</div>
									</div>
								)}

								{result.colors?.dominant && result.colors.dominant.length > 0 && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>🎨 Dominant Colors:</span>
										<div className='flex flex-wrap gap-2'>
											{result.colors.dominant.slice(0, 5).map((color: any, idx: number) => (
												<div key={idx} className='flex items-center gap-1'>
													<div className='w-4 h-4 rounded border' style={{ backgroundColor: color.hex }} title={`${color.hex} (${color.percentage}%)`} />
													<span className='text-[10px] text-senweaver-text-3'>{color.hex}</span>
												</div>
											))}
										</div>
									</div>
								)}

								{result.description && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>📝 Description:</span>
										<div className='text-senweaver-text-2 text-[11px]'>{result.description}</div>
									</div>
								)}

								{result.ocrText && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>🔤 OCR Text:</span>
										<div className='text-senweaver-text-2 text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap bg-senweaver-bg-2 p-2 rounded'>{result.ocrText}</div>
									</div>
								)}

								{result.analysis && (
									<div className='space-y-1'>
										<span className='text-senweaver-text-3'>🤖 AI Analysis:</span>
										<div className='text-senweaver-text-2 text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap'>{result.analysis}</div>
										{result.model && <div className='text-senweaver-text-3 text-[10px] italic'>Model: {result.model}</div>}
									</div>
								)}

								<div className='text-senweaver-text-3 text-[10px] italic border-t border-senweaver-bg-2 pt-2'>
									💡 Use this analysis to understand images, generate UI from screenshots, or extract visual information
								</div>
							</div>
						</CodeChildren>
					</ToolChildrenWrapper>
				} else {
					componentParams.info = 'Failed'
					if (result.error) {
						componentParams.bottomChildren = <BottomChildren title='Error'>
							<CodeChildren>{result.error}</CodeChildren>
						</BottomChildren>
					}
				}
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>{result}</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'screenshot_to_code': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage

				if (result.success && result.code) {
					componentParams.info = `✅ ${result.stack || 'html_tailwind'} • ${result.processingTime || 'N/A'}`

					componentParams.children = <ToolChildrenWrapper>
						<CodeChildren>
							<div className='flex flex-col gap-2 text-[11px]'>
								<div className='flex items-center gap-2'>
									<span className='text-senweaver-text-3'>📋 Stack:</span>
									<span className='text-senweaver-text-2'>{result.stack || 'html_tailwind'}</span>
								</div>
								{result.model && (
									<div className='flex items-center gap-2'>
										<span className='text-senweaver-text-3'>🤖 Model:</span>
										<span className='text-senweaver-text-2'>{result.model}</span>
									</div>
								)}
								{result.processingTime && (
									<div className='flex items-center gap-2'>
										<span className='text-senweaver-text-3'>⏱️ Time:</span>
										<span className='text-senweaver-text-2'>{result.processingTime}</span>
									</div>
								)}
								<div className='space-y-1 mt-2'>
									<span className='text-senweaver-text-3'>📄 Generated Code:</span>
									<div className='text-senweaver-text-2 text-[10px] max-h-64 overflow-y-auto whitespace-pre-wrap bg-senweaver-bg-2 p-2 rounded font-mono'>
										{result.code.length > 3000 ? result.code.substring(0, 3000) + '\n... (truncated)' : result.code}
									</div>
								</div>
								<div className='text-senweaver-text-3 text-[10px] italic border-t border-senweaver-bg-2 pt-2'>
									💡 Copy this code to a new HTML file and open in browser to preview
								</div>
							</div>
						</CodeChildren>
					</ToolChildrenWrapper>
				} else {
					componentParams.info = 'Failed'
					if (result.error) {
						componentParams.bottomChildren = <BottomChildren title='Error'>
							<CodeChildren>{result.error}</CodeChildren>
						</BottomChildren>
					}
				}
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>{result}</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'api_request': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null
			const [isExpanded, setIsExpanded] = React.useState(false)

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage

				if (result.success) {
					const statusEmoji = result.statusCode >= 200 && result.statusCode < 300 ? '✅' :
						result.statusCode >= 300 && result.statusCode < 400 ? '🔄' :
							result.statusCode >= 400 && result.statusCode < 500 ? '⚠️' : '❌';

					componentParams.info = `${statusEmoji} ${result.statusCode} • ${result.responseTime || 0}ms`

					componentParams.children = <ToolChildrenWrapper>
						<CodeChildren className='bg-senweaver-bg-3'>
							<div className='space-y-2 p-3 text-xs'>
								{/* Header Info */}
								<div className='flex items-center justify-between'>
									<div className='font-semibold text-senweaver-text-1 flex items-center gap-2'>
										<span>{statusEmoji}</span>
										<span>{result.statusCode} {result.statusText || ''}</span>
									</div>
									<button
										onClick={() => setIsExpanded(!isExpanded)}
										className='text-xs text-senweaver-text-3 hover:text-senweaver-text-1 flex items-center gap-1 px-2 py-1 rounded hover:bg-senweaver-bg-2 transition-colors'
									>
										{isExpanded ? '▼ 收起' : '▶ 展开详情'}
									</button>
								</div>

								{/* Basic Info (always visible) */}
								<div className='grid grid-cols-2 gap-x-4 gap-y-1 text-senweaver-text-2'>
									<div><span className='text-senweaver-text-3'>📤 Method:</span> {params?.method || 'GET'}</div>
									<div><span className='text-senweaver-text-3'>⏱️ Time:</span> {result.responseTime || 0}ms</div>
									<div><span className='text-senweaver-text-3'>📄 Type:</span> {result.contentType?.split(';')[0] || 'unknown'}</div>
									<div><span className='text-senweaver-text-3'>📦 Size:</span> {result.contentLength || result.body?.length || 0} bytes</div>
								</div>

								{/* Collapsible Content */}
								{isExpanded && (
									<div className='space-y-3 border-t border-senweaver-bg-2 pt-3 mt-2'>
										{/* Request Info */}
										{params && (
											<div className='space-y-1'>
												<div className='text-senweaver-text-3 font-semibold text-[11px]'>📤 Request</div>
												<div className='text-senweaver-text-2 text-[10px] bg-senweaver-bg-2 p-2 rounded space-y-1'>
													<div className='truncate'><span className='text-senweaver-text-3'>URL:</span> {params.url}</div>
													{params.headers && Object.keys(params.headers).length > 0 && (
														<div className='truncate'>
															<span className='text-senweaver-text-3'>Headers:</span> {Object.keys(params.headers).join(', ')}
														</div>
													)}
													{params.body && (
														<div className='truncate'>
															<span className='text-senweaver-text-3'>Body:</span> {String(params.body).substring(0, 100)}{String(params.body).length > 100 ? '...' : ''}
														</div>
													)}
												</div>
											</div>
										)}

										{/* Response Headers */}
										{result.headers && Object.keys(result.headers).length > 0 && (
											<div className='space-y-1'>
												<div className='text-senweaver-text-3 font-semibold text-[11px]'>📋 Response Headers</div>
												<div className='text-[10px] bg-senweaver-bg-2 p-2 rounded max-h-24 overflow-y-auto'>
													{Object.entries(result.headers).slice(0, 8).map(([key, value]) => (
														<div key={key} className='truncate text-senweaver-text-2'>
															<span className='text-senweaver-text-3'>{key}:</span> {String(value).substring(0, 80)}
														</div>
													))}
													{Object.keys(result.headers).length > 8 && (
														<div className='text-senweaver-text-3 italic'>... +{Object.keys(result.headers).length - 8} more</div>
													)}
												</div>
											</div>
										)}

										{/* Response Body */}
										<div className='space-y-1'>
											<div className='text-senweaver-text-3 font-semibold text-[11px]'>📥 Response Body ({result.bodyFormat || 'text'})</div>
											<div className='text-[10px] bg-senweaver-bg-2 p-2 rounded max-h-64 overflow-y-auto'>
												<pre className='whitespace-pre-wrap text-senweaver-text-2 font-mono'>
													{(result.bodyFormatted || result.body || '').substring(0, 3000)}
													{(result.bodyFormatted || result.body || '').length > 3000 && '\n... (truncated)'}
												</pre>
											</div>
										</div>
									</div>
								)}

								{/* Quick Preview (when collapsed) */}
								{!isExpanded && result.body && (
									<div className='space-y-1'>
										<div className='text-senweaver-text-3 text-[11px]'>📥 Response Preview:</div>
										<div className='text-[10px] text-senweaver-text-2 bg-senweaver-bg-2 p-2 rounded truncate'>
											{(result.bodyFormatted || result.body || '').substring(0, 200)}{(result.bodyFormatted || result.body || '').length > 200 ? '...' : ''}
										</div>
									</div>
								)}

								<div className='text-senweaver-text-3 text-[10px] italic border-t border-senweaver-bg-2 pt-2'>
									💡 API Request Tool - 点击"展开详情"查看完整响应
								</div>
							</div>
						</CodeChildren>
					</ToolChildrenWrapper>
				} else {
					componentParams.info = `❌ ${result.statusCode || 'Error'}`
					componentParams.bottomChildren = <BottomChildren title='Error'>
						<CodeChildren>{result.error || 'Request failed'}</CodeChildren>
					</BottomChildren>
				}
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>{result}</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},

	// Office document tools - generic wrapper
	'read_document': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = `📄 ${result.fileType || 'document'} • ${result.contentLength || 0} chars`
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'edit_document': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? '✅ 编辑成功' : '❌ 编辑失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'create_document': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? '✅ 创建成功' : '❌ 创建失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'pdf_operation': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? '✅ 操作成功' : '❌ 操作失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'document_convert': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? `✅ ${result.sourceFormat} → ${result.targetFormat}` : '❌ 转换失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'document_merge': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? '✅ 合并成功' : '❌ 合并失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'document_extract': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.info = result.success ? '✅ 提取成功' : '❌ 提取失败'
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'><CodeChildren>{result}</CodeChildren></BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},

	// Agent tools
	'spawn_subagent': {
		resultWrapper: ({ toolMessage }) => {
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1: '', isError, icon, isRejected }

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'edit_agent': {
		resultWrapper: ({ toolMessage }) => {
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1: '', isError, icon, isRejected }

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'skill': {
		resultWrapper: ({ toolMessage }) => {
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'running_now') return null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1: '', isError, icon, isRejected }

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
};


const Checkpoint = ({ message, threadId, messageIdx, isCheckpointGhost, threadIsRunning, anyThreadRunning }: { message: CheckpointEntry, threadId: string; messageIdx: number, isCheckpointGhost: boolean, threadIsRunning: boolean, anyThreadRunning: boolean }) => {
	const accessor = useAccessor()
	const chatThreadService = accessor.get('IChatThreadService')
	const clipboardService = accessor.get('IClipboardService')
	const [copied, setCopied] = useState(false)

	const isRunning = useChatThreadsStreamState(threadId)?.isRunning
	const isDisabled = useMemo(() => {
		if (isRunning) return true
		return anyThreadRunning
	}, [isRunning, anyThreadRunning])

	// Get messages for this conversation round (from previous checkpoint to this one)
	const getConversationRoundContent = useCallback(() => {
		const thread = chatThreadService.state.allThreads[threadId]
		if (!thread) return ''

		const messages = thread.messages
		// Find the previous checkpoint index
		let prevCheckpointIdx = -1
		for (let i = messageIdx - 1; i >= 0; i--) {
			if (messages[i]?.role === 'checkpoint') {
				prevCheckpointIdx = i
				break
			}
		}

		// Collect messages between previous checkpoint and current checkpoint
		const startIdx = prevCheckpointIdx + 1
		const endIdx = messageIdx
		const roundMessages = messages.slice(startIdx, endIdx)

		// Format messages for copying
		const formattedContent = roundMessages.map(msg => {
			if (msg.role === 'user') {
				return `## 用户\n${msg.displayContent || msg.content || ''}`
			} else if (msg.role === 'assistant') {
				return `## 助手\n${msg.displayContent || ''}`
			} else if (msg.role === 'tool') {
				const toolName = msg.name
				if (msg.type === 'success') {
					return `## 工具: ${toolName}\n${typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2)}`
				}
				return null
			}
			return null
		}).filter(Boolean).join('\n\n---\n\n')

		return formattedContent
	}, [chatThreadService, threadId, messageIdx])

	const handleCopyConversation = useCallback(async () => {
		const content = getConversationRoundContent()
		if (content) {
			clipboardService.writeText(content)
				.then(() => {
					setCopied(true)
					setTimeout(() => setCopied(false), 2000)
				})
				.catch((e: any) => {
					console.error('Failed to copy:', e)
				})
		}
	}, [getConversationRoundContent, clipboardService])

	return <div
		className={`flex items-center justify-end px-2 gap-2 ${isCheckpointGhost ? 'opacity-50' : 'opacity-100'}`}
	>
		{/* Copy conversation button */}
		<div
			className={`
				text-senweaver-fg-3 select-none cursor-pointer
				hover:text-senweaver-fg-1 transition-colors
			`}
			onClick={handleCopyConversation}
			data-tooltip-id='senweaver-tooltip'
			data-tooltip-content='Copy'
			data-tooltip-place='top'
		>
			{copied ? (
				<Check size={14} className="text-green-500" />
			) : (
				<CopyIcon size={14} />
			)}
		</div>

		{/* Rollback button */}
		<div
			className={`
				text-senweaver-fg-3 select-none
				${isDisabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:text-senweaver-fg-1'}
				transition-colors
			`}
			onClick={() => {
				if (threadIsRunning) return
				if (isDisabled) return
				chatThreadService.jumpToCheckpointBeforeMessageIdx({
					threadId,
					messageIdx,
					jumpToUserModified: messageIdx === (chatThreadService.state.allThreads[threadId]?.messages.length ?? 0) - 1
				})
			}}
			data-tooltip-id='senweaver-tooltip'
			data-tooltip-content={isDisabled ? `Disabled ${isRunning ? 'when running' : 'because another thread is running'}` : 'Checkpoint'}
			data-tooltip-place='top'
		>
			<Undo2 size={14} className={isDisabled ? '' : 'text-green-500'} />
		</div>
	</div>
}


type ChatBubbleMode = 'display' | 'edit'
type ChatBubbleProps = {
	chatMessage: ChatMessage,
	messageIdx: number,
	isCommitted: boolean,
	chatIsRunning: IsRunningType,
	threadId: string,
	currCheckpointIdx: number | undefined,
	_scrollToBottom: (() => void) | null,
	anyThreadRunning: boolean,
	onOpenPreview: (design: DesignData) => void,
	globalTaskProgress: DesignTaskProgress | null,
	designHistoryLength: number,
}

const ChatBubble = React.memo((props: ChatBubbleProps) => {
	return <ErrorBoundary>
		<_ChatBubble {...props} />
	</ErrorBoundary>
})

const _ChatBubble = ({ threadId, chatMessage, currCheckpointIdx, isCommitted, messageIdx, chatIsRunning, _scrollToBottom, anyThreadRunning, onOpenPreview, globalTaskProgress, designHistoryLength }: ChatBubbleProps) => {
	const role = chatMessage.role

	const isCheckpointGhost = messageIdx > (currCheckpointIdx ?? Infinity) && !chatIsRunning // whether to show as gray (if chat is running, for good measure just dont show any ghosts)

	if (role === 'user') {
		return <UserMessageComponent
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			currCheckpointIdx={currCheckpointIdx}
			messageIdx={messageIdx}
			_scrollToBottom={_scrollToBottom}
		/>
	}
	else if (role === 'assistant') {
		return <AssistantMessageComponent
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			messageIdx={messageIdx}
			isCommitted={isCommitted}
			onOpenPreview={onOpenPreview}
			globalTaskProgress={globalTaskProgress}
			designHistoryLength={designHistoryLength}
		/>
	}
	else if (role === 'tool') {

		if (chatMessage.type === 'invalid_params') {
			return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<InvalidTool toolName={chatMessage.name} message={chatMessage.content} mcpServerName={chatMessage.mcpServerName} />
			</div>
		}

		const toolName = chatMessage.name
		const isBuiltInTool = isABuiltinToolName(toolName)
		const ToolResultWrapper = isBuiltInTool ? builtinToolNameToComponent[toolName]?.resultWrapper as ResultWrapper<ToolName>
			: MCPToolWrapper as ResultWrapper<ToolName>

		if (ToolResultWrapper)
			return <>
				<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
					<ToolResultWrapper
						toolMessage={chatMessage}
						messageIdx={messageIdx}
						threadId={threadId}
					/>
				</div>
				{chatMessage.type === 'tool_request' ?
					<div className={`${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
						<ToolRequestAcceptRejectButtons toolName={chatMessage.name} />
					</div> : null}
			</>
		return null
	}

	else if (role === 'interrupted_streaming_tool') {
		return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<CanceledTool toolName={chatMessage.name} mcpServerName={chatMessage.mcpServerName} />
		</div>
	}

	else if (role === 'checkpoint') {
		return <Checkpoint
			threadId={threadId}
			message={chatMessage}
			messageIdx={messageIdx}
			isCheckpointGhost={isCheckpointGhost}
			threadIsRunning={!!chatIsRunning}
			anyThreadRunning={anyThreadRunning}
		/>
	}

}

const CommandBarInChat = () => {
	const { stateOfURI: commandBarStateOfURI, sortedURIs: sortedCommandBarURIs } = useCommandBarState()
	const numFilesChanged = sortedCommandBarURIs.length

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const commandService = accessor.get('ICommandService')
	const chatThreadsState = useChatThreadsState()
	const commandBarState = useCommandBarState()
	const chatThreadsStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)

	// (
	// 	<IconShell1
	// 		Icon={CopyIcon}
	// 		onClick={copyChatToClipboard}
	// 		data-tooltip-id='senweaver-tooltip'
	// 		data-tooltip-place='top'
	// 		data-tooltip-content='Copy chat JSON'
	// 	/>
	// )

	const [fileDetailsOpenedState, setFileDetailsOpenedState] = useState<'auto-opened' | 'auto-closed' | 'user-opened' | 'user-closed'>('auto-closed');
	const isFileDetailsOpened = fileDetailsOpenedState === 'auto-opened' || fileDetailsOpenedState === 'user-opened';


	useEffect(() => {
		// close the file details if there are no files
		// this converts 'user-closed' to 'auto-closed'
		if (numFilesChanged === 0) {
			setFileDetailsOpenedState('auto-closed')
		}
		// open the file details if it hasnt been closed
		if (numFilesChanged > 0 && fileDetailsOpenedState !== 'user-closed') {
			setFileDetailsOpenedState('auto-opened')
		}
	}, [fileDetailsOpenedState, setFileDetailsOpenedState, numFilesChanged])


	const isFinishedMakingThreadChanges = (
		// there are changed files
		commandBarState.sortedURIs.length !== 0
		// none of the files are streaming
		&& commandBarState.sortedURIs.every(uri => !commandBarState.stateOfURI[uri.fsPath]?.isStreaming)
	)

	// ======== status of agent ========
	// This icon answers the question "is the LLM doing work on this thread?"
	// assume it is single threaded for now
	// green = Running
	// orange = Requires action
	// dark = Done

	const threadStatus = (
		chatThreadsStreamState?.isRunning === 'awaiting_user' ? { title: 'Needs Approval', color: 'yellow', } as const
			: chatThreadsStreamState?.isRunning ? { title: 'Running', color: 'blue', } as const
				: { title: 'Done', color: 'dark', } as const
	)


	const threadStatusHTML = <StatusIndicator className='mx-1' indicatorColor={threadStatus.color} title={threadStatus.title} />


	// ======== info about changes ========
	// num files changed
	// acceptall + rejectall
	// popup info about each change (each with num changes + acceptall + rejectall of their own)

	// 计算总的 +/- 统计
	const totalStats = useMemo(() => {
		let totalAdded = 0
		let totalRemoved = 0
		sortedCommandBarURIs.forEach(uri => {
			const state = commandBarStateOfURI[uri.fsPath]
			if (state?.sortedDiffIds) {
				// 简单估算：每个 diff 平均 5 行变更
				totalAdded += state.sortedDiffIds.length * 3
				totalRemoved += state.sortedDiffIds.length * 2
			}
		})
		return { totalAdded, totalRemoved }
	}, [sortedCommandBarURIs, commandBarStateOfURI])
	const { totalAdded, totalRemoved } = totalStats

	const numFilesChangedStr = `${numFilesChanged} file${numFilesChanged !== 1 ? 's' : ''}`




	const acceptRejectAllButtons = <div
		// do this with opacity so that the height remains the same at all times
		className={`flex items-center gap-0.5
			${isFinishedMakingThreadChanges ? '' : 'opacity-0 pointer-events-none'}`
		}
	>
		<button
			className="p-0.5 text-gray-400 hover:bg-gray-400/20 rounded transition-colors"
			onClick={() => {
				sortedCommandBarURIs.forEach(uri => {
					editCodeService.acceptOrRejectAllDiffAreas({
						uri,
						removeCtrlKs: true,
						behavior: "reject",
						_addToHistory: true,
					});
				});
			}}
			data-tooltip-id='senweaver-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Reject all'
		>
			<X size={14} />
		</button>

		<button
			className="p-0.5 text-green-400 hover:bg-green-400/20 rounded transition-colors"
			onClick={() => {
				sortedCommandBarURIs.forEach(uri => {
					editCodeService.acceptOrRejectAllDiffAreas({
						uri,
						removeCtrlKs: true,
						behavior: "accept",
						_addToHistory: true,
					});
				});
			}}
			data-tooltip-id='senweaver-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Accept all'
		>
			<Check size={14} />
		</button>



	</div>


	// !select-text cursor-auto
	const fileDetailsContent = <div className="flex flex-col gap-0.5 w-full overflow-y-auto px-2">
		{sortedCommandBarURIs.map((uri, i) => {
			const basename = getBasename(uri.fsPath)
			const ext = basename.includes('.') ? basename.split('.').pop() : ''

			const { sortedDiffIds, isStreaming } = commandBarStateOfURI[uri.fsPath] ?? {}
			const isFinishedMakingFileChanges = !isStreaming

			const numDiffs = sortedDiffIds?.length || 0
			// 估算每个文件的 +/- 统计
			const fileAdded = numDiffs * 3
			const fileRemoved = numDiffs * 2

			return (
				<div
					key={i}
					className="flex items-center gap-2 py-0.5 hover:bg-senweaver-bg-2/50 rounded px-1 transition-colors"
				>
					{/* File icon placeholder */}
					<span
						className="text-senweaver-fg-4 text-xs cursor-pointer"
				onClick={() => senweaverOpenFileFn(uri, accessor)}
					>{`{}`}</span>
					{/* File name */}
					<span
						className="text-senweaver-fg-2 text-xs truncate cursor-pointer flex-1"
						onClick={() => senweaverOpenFileFn(uri, accessor)}
					>{basename}</span>
					{/* Stats */}
					{(fileAdded > 0 || fileRemoved > 0) && (
						<span className="text-xs flex items-center gap-1">
							{fileAdded > 0 && <span className="text-green-400">+{fileAdded}</span>}
							{fileRemoved > 0 && <span className="text-red-400">-{fileRemoved}</span>}
						</span>
					)}
					{/* Reject/Accept 按钮（叉在前，勾在后） */}
					{isFinishedMakingFileChanges && numDiffs > 0 && (
						<div className="flex items-center gap-0.5 ml-1">
							<button
								className="p-0.5 text-gray-400 hover:bg-gray-400/20 rounded transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									editCodeService.acceptOrRejectAllDiffAreas({
										uri,
										removeCtrlKs: true,
										behavior: 'reject',
										_addToHistory: true,
									})
								}}
					data-tooltip-id='senweaver-tooltip'
					data-tooltip-place='top'
								data-tooltip-content='Reject'
							>
								<X size={14} />
							</button>
							<button
								className="p-0.5 text-green-400 hover:bg-green-400/20 rounded transition-colors"
								onClick={(e) => {
									e.stopPropagation()
									editCodeService.acceptOrRejectAllDiffAreas({
										uri,
										removeCtrlKs: true,
										behavior: 'accept',
										_addToHistory: true,
									})
								}}
					data-tooltip-id='senweaver-tooltip'
					data-tooltip-place='top'
								data-tooltip-content='Accept'
							>
								<Check size={14} />
							</button>
			</div>
					)}
				</div>
			)
		})}
	</div>

	const fileDetailsButton = (
		<button
			className={`flex items-center gap-1 rounded ${numFilesChanged === 0 ? 'cursor-default opacity-50' : 'cursor-pointer hover:brightness-125 transition-all duration-200'}`}
			onClick={() => numFilesChanged > 0 && (isFileDetailsOpened ? setFileDetailsOpenedState('user-closed') : setFileDetailsOpenedState('user-opened'))}
			type='button'
			disabled={numFilesChanged === 0}
		>
			<svg
				className="transition-transform duration-200 size-3.5"
				style={{
					transform: isFileDetailsOpened ? 'rotate(180deg)' : 'rotate(0deg)',
					transition: 'transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)'
				}}
				xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline>
			</svg>
			{numFilesChangedStr}
			{(totalAdded > 0 || totalRemoved > 0) && (
				<span className="text-xs flex items-center gap-1 ml-1">
					{totalAdded > 0 && <span className="text-green-400">+{totalAdded}</span>}
					{totalRemoved > 0 && <span className="text-red-400">-{totalRemoved}</span>}
				</span>
			)}
		</button>
	)

	// 当任务完成且没有文件被修改时，隐藏整个栏
	const shouldHideCommandBar = threadStatus.title === 'Done' && numFilesChanged === 0
	if (shouldHideCommandBar) {
		return null
	}

	return (
		<>
			{/* main content - header bar */}
				<div
					className={`
						select-none
					flex w-full bg-senweaver-bg-3
					text-senweaver-fg-3 text-sm text-nowrap
					border-t border-l border-r border-zinc-300/10
					${isFileDetailsOpened ? '' : 'rounded-t-lg'}

					px-2 py-1
					justify-between
				`}
			>
				<div className="flex gap-2 items-center">
					{fileDetailsButton}
				</div>
				<div className="flex gap-2 items-center">
					{acceptRejectAllButtons}
					{threadStatusHTML}
				</div>
			</div>
			{/* file details - expands downward */}
			<div
				className={`
					select-none
					flex flex-col w-full rounded-b-lg bg-senweaver-bg-3
					text-senweaver-fg-3 text-sm text-nowrap
					border-b border-l border-r border-zinc-300/10

					overflow-hidden transition-all duration-200 ease-in-out
					${isFileDetailsOpened ? 'max-h-48 py-1' : 'max-h-0'}
				`}
			>
				{fileDetailsContent}
			</div>
		</>
	)
}



const EditToolSoFar = ({ toolCallSoFar, }: { toolCallSoFar: RawToolCallObj }) => {

	if (!isABuiltinToolName(toolCallSoFar.name)) return null

	const accessor = useAccessor()

	const uri = toolCallSoFar.rawParams.uri ? URI.file(toolCallSoFar.rawParams.uri) : undefined

	const title = titleOfBuiltinToolName[toolCallSoFar.name].proposed

	const uriDone = toolCallSoFar.doneParams.includes('uri')
	const desc1 = <span className='flex items-center'>
		{uriDone ?
			getBasename(toolCallSoFar.rawParams['uri'] ?? 'unknown')
			: `Generating`}
		<IconLoading />
	</span>

	const desc1OnClick = () => { uri && senweaverOpenFileFn(uri, accessor) }

	// If URI has not been specified
	return <ToolHeaderWrapper
		title={title}
		desc1={desc1}
		desc1OnClick={desc1OnClick}
	>
		<EditToolChildren
			uri={uri}
			code={toolCallSoFar.rawParams.search_replace_blocks ?? toolCallSoFar.rawParams.new_content ?? ''}
			type={'rewrite'} // as it streams, show in rewrite format, don't make a diff editor
		/>
		<IconLoading />
	</ToolHeaderWrapper>

}


// Helper function to resolve AI-provided navigation config to actual design IDs
const resolveNavigationConfig = (aiConfig: any[], allDesigns: DesignData[]): NavigationLink[] => {
	const links: NavigationLink[] = [];

	// Create a map of valid design IDs for quick lookup
	const validDesignIds = new Set(allDesigns.map(d => d.id));
	const designIdToTitle = new Map(allDesigns.map(d => [d.id, d.title]));

	for (const item of aiConfig) {
		const elementText = item.elementText;
		const targetDesignId = item.targetDesignId;
		const targetTitle = item.targetDesignTitle || item.targetTitle;

		if (!elementText) {
			continue;
		}

		let resolvedTargetId: string | null = null;

		// Priority 1: Use AI-provided targetDesignId if it exists and is valid
		if (targetDesignId && validDesignIds.has(targetDesignId)) {
			resolvedTargetId = targetDesignId;
		}
		// Priority 2: Try to find by title if ID is missing or invalid
		else if (targetTitle) {
			// First try exact match
			const exactMatch = allDesigns.find(design =>
				design.title.toLowerCase().trim() === targetTitle.toLowerCase().trim()
			);

			if (exactMatch) {
				resolvedTargetId = exactMatch.id;
			} else {
				// Try fuzzy match as fallback
				const fuzzyMatch = allDesigns.find(design => {
					const similarity = calculateSimilarity(design.title, targetTitle);
					return similarity > 0.7; // Increased threshold to 70% for stricter matching
				});

				if (fuzzyMatch) {
					resolvedTargetId = fuzzyMatch.id;
				}
			}

			if (!resolvedTargetId) {
			}
		} else {
		}

		// Only add link if we successfully resolved a valid target
		if (resolvedTargetId) {
			links.push({
				elementText: elementText,
				targetDesignId: resolvedTargetId
			});
		}
	}

	return links;
};

// Helper function to calculate text similarity (0-1)
const calculateSimilarity = (text1: string, text2: string): number => {
	const str1 = text1.toLowerCase().trim();
	const str2 = text2.toLowerCase().trim();

	// Exact match
	if (str1 === str2) return 1.0;

	// Contains match
	if (str1.includes(str2) || str2.includes(str1)) {
		const shorter = str1.length < str2.length ? str1 : str2;
		const longer = str1.length >= str2.length ? str1 : str2;
		return shorter.length / longer.length * 0.8; // 80% for contains
	}

	// Word overlap
	const words1 = str1.split(/\s+/);
	const words2 = str2.split(/\s+/);
	const commonWords = words1.filter(w => words2.includes(w));
	if (commonWords.length > 0) {
		return commonWords.length / Math.max(words1.length, words2.length) * 0.6;
	}

	// Character overlap (for partial matches)
	let matches = 0;
	for (let i = 0; i < Math.min(str1.length, str2.length); i++) {
		if (str1[i] === str2[i]) matches++;
	}
	return matches / Math.max(str1.length, str2.length) * 0.4;
};

// Helper function to auto-detect navigation links between UI designs
const detectNavigationLinks = (html: string, currentDesignId: string, allDesigns: DesignData[]): NavigationLink[] => {
	const links: NavigationLink[] = [];

	// Use regex to extract text from clickable elements (avoid DOMParser TrustedHTML issue)
	const clickablePatterns = [
		/<button[^>]*>(.*?)<\/button>/gi,
		/<a[^>]*>(.*?)<\/a>/gi,
		/<div[^>]*class="[^"]*(?:btn|button|menu-item|nav-item|nav-link)[^"]*"[^>]*>(.*?)<\/div>/gi,
		/<span[^>]*class="[^"]*(?:btn|button|menu-item|nav-item|nav-link)[^"]*"[^>]*>(.*?)<\/span>/gi
	];

	const elementTexts = new Set<string>();

	for (const pattern of clickablePatterns) {
		let match;
		while ((match = pattern.exec(html)) !== null) {
			// Remove HTML tags from the captured text
			const text = match[1].replace(/<[^>]*>/g, '').trim();
			if (text.length >= 2) {
				elementTexts.add(text);
			}
		}
	}

	// Try to match extracted texts with other design titles
	elementTexts.forEach(elementText => {
		for (const targetDesign of allDesigns) {
			// Don't link to self
			if (targetDesign.id === currentDesignId) continue;

			const similarity = calculateSimilarity(elementText, targetDesign.title);

			// If similarity is high enough, create a link
			if (similarity > 0.5) { // 50% threshold
				// Check if we already have a link for this element
				const existingLink = links.find(l => l.elementText === elementText);

				if (!existingLink) {
					links.push({
						elementText: elementText,
						targetDesignId: targetDesign.id
					});
				} else if (existingLink) {
					// If we found a better match, replace it
					const existingTarget = allDesigns.find(d => d.id === existingLink.targetDesignId);
					if (existingTarget) {
						const existingSimilarity = calculateSimilarity(elementText, existingTarget.title);
						if (similarity > existingSimilarity) {
							existingLink.targetDesignId = targetDesign.id;
						}
					}
				}
			}
		}
	});

	return links;
};

export const SidebarChat = () => {
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const editorService = accessor.get('IEditorService')

	const settingsState = useSettingsState()
	// ----- HIGHER STATE -----

	// threads state
	const chatThreadsState = useChatThreadsState()

	const currentThread = chatThreadsService.getCurrentThread()
	const previousMessages = currentThread?.messages ?? []

	// Perf: windowed rendering to avoid re-rendering thousands of DOM nodes
	const DEFAULT_RENDER_LIMIT = 120
	const LOAD_MORE_COUNT = 80
	const [renderLimit, setRenderLimit] = useState(DEFAULT_RENDER_LIMIT)
	const pendingPrependScrollHeightRef = useRef<number | null>(null)
	const pendingPrependScrollTopRef = useRef<number | null>(null)

	// Reset window when switching thread
	useEffect(() => {
		setRenderLimit(DEFAULT_RENDER_LIMIT)
		pendingPrependScrollHeightRef.current = null
		pendingPrependScrollTopRef.current = null
	}, [chatThreadsState.currentThreadId])

	const selections = currentThread.state.stagingSelections
	const setSelections = (s: StagingSelectionItem[]) => { chatThreadsService.setCurrentThreadState({ stagingSelections: s }) }

	// stream state
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isRunning = currThreadStreamState?.isRunning
	const latestError = currThreadStreamState?.error
	const { displayContentSoFar: rawDisplayContentSoFar, toolCallSoFar, reasoningSoFar } = currThreadStreamState?.llmInfo ?? {}

	// 优化：使用 React 18 的 useDeferredValue 延迟非关键更新，减少重渲染频率
	const deferredRawDisplayContent = React.useDeferredValue(rawDisplayContentSoFar)
	// Clean up any invalid tool call formats that shouldn't be shown to users
	const displayContentSoFar = useMemo(() => cleanInvalidToolCallFormats(deferredRawDisplayContent ?? ''), [deferredRawDisplayContent])

	// Use optimized hook that only updates when running state changes, not on every stream update
	const anyThreadRunning = useAnyThreadRunning()

	// this is just if it's currently being generated, NOT if it's currently running
	const toolIsGenerating = toolCallSoFar && !toolCallSoFar.isDone // show loading for slow tools (right now just edit)

	// 获取当前选择的模型信息
	const currentModelSelection = settingsState.modelSelectionOfFeature['Chat']

	// 检查当前模型是否支持视觉功能
	const supportsVision = useMemo(() => {
		if (!currentModelSelection) return false
		const { providerName, modelName } = currentModelSelection
		const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel)
		return modelCapabilities?.supportsVision ?? false
	}, [currentModelSelection, settingsState.overridesOfModel])

	// 所有模型都支持图片输入：
	// - 支持视觉的模型：直接使用模型本身的视觉能力
	// - 不支持视觉的模型：通过analyze_image工具提供视觉能力
	const enableImageInput = true

	// Get threadId early for use in effects
	const threadId = currentThread.id

	// Get chat mode
	const chatMode = settingsState.globalSettings.chatMode;

	// Track the current preview editor input
	const previewEditorInputRef = useRef<any>(null);

	// Cache for extractInteractiveElements to avoid repeated parsing
	const interactiveElementsCacheRef = useRef<Map<string, Array<{text: string, tag: string, context: string, htmlSnippet?: string, attributes?: string}>>>(new Map());

	// 优化：使用 useTransition 将非紧急的UI更新标记为可中断的
	const [isPending, startTransition] = React.useTransition();

	// Helper function to extract interactive elements from HTML with detailed context
	// Uses cache to avoid repeated expensive regex operations
	// 优化：改为异步执行，避免阻塞主线程
	const extractInteractiveElements = useCallback((html: string): Array<{text: string, tag: string, context: string, htmlSnippet?: string, attributes?: string}> => {
		// Check cache first - use hash of first 500 chars + length as key for performance
		const cacheKey = `${html.length}_${html.substring(0, 500)}`;
		const cached = interactiveElementsCacheRef.current.get(cacheKey);
		if (cached) return cached;
		const elements: Array<{text: string, tag: string, context: string, htmlSnippet?: string, attributes?: string}> = [];

		try {
			// Helper to extract attributes from tag
			const extractAttributes = (tagStr: string): string => {
				const attrs: string[] = [];
				// Extract title
				const titleMatch = tagStr.match(/title=["']([^"']*)["']/i);
				if (titleMatch) attrs.push(`title="${titleMatch[1]}"`);
				// Extract aria-label
				const ariaMatch = tagStr.match(/aria-label=["']([^"']*)["']/i);
				if (ariaMatch) attrs.push(`aria-label="${ariaMatch[1]}"`);
				// Extract class (simplified)
				const classMatch = tagStr.match(/class=["']([^"']*)["']/i);
				if (classMatch) {
					const classes = classMatch[1].split(/\s+/).filter(c =>
						c.includes('logout') || c.includes('exit') || c.includes('login') ||
						c.includes('menu') || c.includes('nav') || c.includes('button')
					);
					if (classes.length > 0) attrs.push(`class="${classes.join(' ')}"`);
				}
				return attrs.join(' ');
			};

			// Helper to check if element contains icon/svg
			const hasIcon = (content: string): boolean => {
				return content.includes('<svg') || content.includes('<i ') ||
					   content.includes('icon') || content.includes('Icon');
			};

			// Helper to describe icon content
			const describeIcon = (content: string): string => {
				if (content.includes('<svg')) {
					// Try to extract meaningful info from SVG
					if (content.includes('logout') || content.includes('exit') || content.includes('sign-out')) {
						return '[退出/登出图标]';
					} else if (content.includes('login') || content.includes('sign-in')) {
						return '[登录图标]';
					} else if (content.includes('user') || content.includes('person')) {
						return '[用户图标]';
					} else if (content.includes('setting') || content.includes('gear')) {
						return '[设置图标]';
					} else if (content.includes('dashboard') || content.includes('home')) {
						return '[仪表盘图标]';
					}
					return '[SVG图标]';
				} else if (content.includes('<i ')) {
					const classMatch = content.match(/<i[^>]*class=["']([^"']*)["']/i);
					if (classMatch) {
						const iconClass = classMatch[1];
						if (iconClass.includes('logout') || iconClass.includes('exit')) return '[退出图标]';
						if (iconClass.includes('login')) return '[登录图标]';
						if (iconClass.includes('user')) return '[用户图标]';
						if (iconClass.includes('setting')) return '[设置图标]';
						return `[图标: ${iconClass}]`;
					}
					return '[图标]';
				}
				return '';
			};

			// Extract buttons: <button...>content</button>
			const buttonRegex = /<button([^>]*)>(.*?)<\/button>/gi;
			let match;
			while ((match = buttonRegex.exec(html)) !== null) {
				const attrs = extractAttributes(match[1]);
				const content = match[2];
				const text = content.replace(/<[^>]*>/g, '').trim();
				const iconDesc = hasIcon(content) ? describeIcon(content) : '';
				const displayText = text || iconDesc || '[按钮]';
				const htmlSnippet = match[0].length > 200 ? match[0].substring(0, 200) + '...' : match[0];

				elements.push({
					text: displayText,
					tag: 'button',
					context: `button${iconDesc ? ' with icon' : ''}`,
					htmlSnippet,
					attributes: attrs
				});
			}

			// Extract links: <a...>content</a>
			const linkRegex = /<a([^>]*)>(.*?)<\/a>/gi;
			while ((match = linkRegex.exec(html)) !== null) {
				const attrs = extractAttributes(match[1]);
				const content = match[2];
				const text = content.replace(/<[^>]*>/g, '').trim();
				const iconDesc = hasIcon(content) ? describeIcon(content) : '';
				const displayText = text || iconDesc || '[链接]';
				const htmlSnippet = match[0].length > 200 ? match[0].substring(0, 200) + '...' : match[0];

				if (!elements.some(e => e.text === displayText && e.htmlSnippet === htmlSnippet)) {
					elements.push({
						text: displayText,
						tag: 'a',
						context: `link${iconDesc ? ' with icon' : ''}`,
						htmlSnippet,
						attributes: attrs
					});
				}
			}

			// Extract elements with onclick
			const onclickRegex = /<(\w+)([^>]*onclick[^>]*)>(.*?)<\/\1>/gi;
			while ((match = onclickRegex.exec(html)) !== null) {
				const attrs = extractAttributes(match[2]);
				const content = match[3];
				const text = content.replace(/<[^>]*>/g, '').trim();
				const iconDesc = hasIcon(content) ? describeIcon(content) : '';
				const displayText = text || iconDesc || '[可点击元素]';
				const htmlSnippet = match[0].length > 200 ? match[0].substring(0, 200) + '...' : match[0];

				if (!elements.some(e => e.text === displayText && e.htmlSnippet === htmlSnippet)) {
					elements.push({
						text: displayText,
						tag: match[1],
						context: `onclick${iconDesc ? ' with icon' : ''}`,
						htmlSnippet,
						attributes: attrs
					});
				}
			}

			// Extract elements with role="button"
			const roleButtonRegex = /<(\w+)([^>]*role=["']button["'][^>]*)>(.*?)<\/\1>/gi;
			while ((match = roleButtonRegex.exec(html)) !== null) {
				const attrs = extractAttributes(match[2]);
				const content = match[3];
				const text = content.replace(/<[^>]*>/g, '').trim();
				const iconDesc = hasIcon(content) ? describeIcon(content) : '';
				const displayText = text || iconDesc || '[按钮角色元素]';
				const htmlSnippet = match[0].length > 200 ? match[0].substring(0, 200) + '...' : match[0];

				if (!elements.some(e => e.text === displayText && e.htmlSnippet === htmlSnippet)) {
					elements.push({
						text: displayText,
						tag: match[1],
						context: `role-button${iconDesc ? ' with icon' : ''}`,
						htmlSnippet,
						attributes: attrs
					});
				}
			}

			// Extract menu items and nav items (expanded patterns)
			const menuPatterns = [
				// Standard menu/nav items
				/<(\w+)([^>]*class=["'][^"']*(?:menu-item|nav-item|navigation-item|sidebar-item|nav-link)[^"']*["'][^>]*)>(.*?)<\/\1>/gi,
				// Div/span with clickable, item, link classes
				/<(div|span|li|a)([^>]*class=["'][^"']*(?:item|link|tab|option)[^"']*["'][^>]*)>(.*?)<\/\1>/gi,
			];

			for (const pattern of menuPatterns) {
				while ((match = pattern.exec(html)) !== null) {
					const attrs = extractAttributes(match[2]);
					const content = match[3];
					const text = content.replace(/<[^>]*>/g, '').trim();
					const iconDesc = hasIcon(content) ? describeIcon(content) : '';
					const displayText = text || iconDesc || '[菜单项]';
					const htmlSnippet = match[0].length > 200 ? match[0].substring(0, 200) + '...' : match[0];

					// Only add if text is meaningful (not empty, not just whitespace, not too short)
					if (displayText && displayText.length >= 2 && displayText !== '[菜单项]') {
						if (!elements.some(e => e.text === displayText)) {
							elements.push({
								text: displayText,
								tag: match[1],
								context: `menu/nav${iconDesc ? ' with icon' : ''}`,
								htmlSnippet,
								attributes: attrs
							});
						}
					}
				}
			}
		} catch (error) {
		}

		// Cache the result (limit cache size to prevent memory issues)
		if (interactiveElementsCacheRef.current.size > 50) {
			// Clear oldest entries when cache is too large
			const firstKey = interactiveElementsCacheRef.current.keys().next().value;
			if (firstKey) interactiveElementsCacheRef.current.delete(firstKey);
		}
		interactiveElementsCacheRef.current.set(cacheKey, elements);

		return elements;
	}, []); // 空依赖数组，函数只创建一次

	// Helper function to plan navigation using AI
	const planNavigationWithAI = async (allDesigns: DesignData[]) => {

		// Only plan if there are at least 2 designs
		if (allDesigns.length < 2) {
			return;
		}

		// Get current thread ID
		const threadId = chatThreadsService.state.currentThreadId;

		// Check if navigation has already been planned for this thread
		// This prevents re-triggering navigation planning when switching to historical threads
		if (navigationPlannedThreadsRef.current.has(threadId)) {
			return;
		}

		// Mark this thread as having navigation planned
		navigationPlannedThreadsRef.current.add(threadId);

		// Check if we're in design phase - this might be blocking navigation planning

		// Prepare design summary for AI - include HTML for intelligent analysis
		const designSummary = allDesigns.map((design, idx) => ({
			index: idx,
			id: design.id,
			title: design.title,
			type: design.type,
			// Include full HTML for AI to analyze (truncate if too long)
			html: design.html.length > 5000 ? design.html.substring(0, 5000) + '...[truncated]' : design.html,
			// Also extract elements as a hint
			interactiveElements: extractInteractiveElements(design.html)
		}));

		// Create a strict list of available target IDs
		const availableTargetIds = designSummary.map(d => d.id);
		const availableTargetTitles = designSummary.map(d => `"${d.title}" (ID: ${d.id})`).join('\n   ');

		// Create comprehensive prompt for AI with semantic understanding
		const navigationPrompt = `你是一个UI/UX专家和前端开发专家。请智能分析以下UI页面的HTML代码，识别所有可能的导航元素，然后规划它们之间的导航关系。

**🎯 你的任务：**
1. **分析每个页面的HTML代码**，识别所有可能用于页面跳转的交互元素
2. **理解元素的语义和功能**，判断它是否应该创建导航
3. **只为实际存在的目标页面创建导航**
4. **确保双向导航的完整性**

**📋 可用的目标页面（共${designSummary.length}个）：**
${designSummary.map((d, idx) => `${idx + 1}. "${d.title}" (ID: ${d.id})`).join('\n')}

**⚠️ 重要约束：**
- ✅ targetDesignId必须从上面的列表中选择（精确复制ID）
- ✅ 只为"页面跳转"类型的元素创建导航（登录按钮、菜单项、返回按钮等）
- ❌ 不为"数据操作"创建导航（删除、保存、导出等）
- ❌ 不为"UI控制"创建导航（折叠、展开、筛选器等）
- ❌ 不能编造不存在的页面ID

**📄 页面HTML代码：**
${designSummary.map((d, idx) => `
${'='.repeat(60)}
页面 ${idx + 1}: ${d.title}
ID: ${d.id}
类型: ${d.type}
${'='.repeat(60)}

HTML代码：
${d.html}

提示的交互元素（供参考）：
${d.interactiveElements.length > 0 ? d.interactiveElements.map(e => `  • "${e.text}" (${e.tag})`).join('\n') : '  （无）'}
`).join('\n')}

**💡 智能分析指南：**

**常见的页面跳转元素：**
- 登录/注册按钮 → 进入系统主页
- 退出/登出按钮 → 返回登录页
- 侧边栏菜单项（仪表盘、用户管理、数据分析、系统设置等）→ 对应功能页
- 面包屑导航 → 上级页面
- 返回/首页按钮 → 上级或主页

**不应创建导航的元素：**
- 数据操作：删除、保存、导出、刷新
- 表单操作：提交、取消、重置
- UI控制：折叠、展开、筛选器、分页
- 纯展示：统计数字、图表、标签

**判断技巧：**
问自己：点击这个元素，用户会看到一个新的完整页面吗？
- 是 → 创建导航（如果目标页面存在）
- 否 → 不创建导航

**📝 分析步骤：**
1. 从HTML中识别所有交互元素（button、a、带onclick的元素、菜单项等）
2. 判断每个元素是否用于页面跳转
3. 为页面跳转元素查找匹配的目标页面（从可用列表中）
4. 确保双向导航的完整性

**返回格式（必须在navigation代码块中）：**

\`\`\`navigation
{
  "navigationPlan": [
	{
	  "sourceDesignId": "必须从可用ID列表中精确复制",
	  "sourceDesignTitle": "源页面标题",
	  "links": [
		{
		  "elementText": "按钮/链接的文本（精确匹配，包括图标描述）",
		  "targetDesignId": "必须从可用ID列表中精确复制",
		  "targetDesignTitle": "目标页面标题",
		  "reason": "匹配逻辑说明"
		}
	  ]
	}
  ]
}
\`\`\`

**📌 示例：**
假设有"登录页"和"仪表盘"两个页面：
- 登录页的"立即登录"按钮 → 仪表盘
- 仪表盘的"退出"按钮 → 登录页
- 仪表盘的"用户管理"菜单 → 用户管理页（如果存在）

**✅ 验证清单：**
- 所有targetDesignId都在可用列表中
- 只为页面跳转元素创建导航
- 语义匹配合理
- 考虑了双向导航

现在开始分析并返回导航规划：`;

		try {
			const threadId = chatThreadsService.state.currentThreadId;

			// Send the navigation planning request to AI
			// Use a special marker to hide this message from user view
			await chatThreadsService.addUserMessageAndStreamResponse({
				userMessage: navigationPrompt,
				displayMessage: '[SYSTEM_AUTO_NAVIGATION_PLANNING]', // Special marker to hide this message
				threadId,
				images: []
			});


		} catch (error) {
		}
	};

	// Persistent design history state - store per thread
	const [designHistory, setDesignHistory] = useState<DesignData[]>([]);
	const lastProcessedMessageRef = useRef<number>(-1);
	const lastDesignRef = useRef<DesignData | null>(null);

	// Task progress tracking for designer mode
	const [currentTaskProgress, setCurrentTaskProgress] = useState<DesignTaskProgress | null>(null);
	const taskProgressByThreadRef = useRef<Map<string, DesignTaskProgress>>(new Map());

	// Store design history per thread
	const designHistoryByThreadRef = useRef<Map<string, {
		designs: DesignData[];
		lastProcessedMessage: number;
		lastDesign: DesignData | null;
	}>>(new Map());

	const currentThreadId = chatThreadsService.state.currentThreadId;

	// Track previous thread ID to detect switches
	const prevThreadIdRef = useRef<string>(currentThreadId);

	// Track previous chat mode to detect mode switches
	const prevChatModeRef = useRef<ChatMode>(chatMode);
	// 标记是否允许自动继续对话（只有用户在当前模式下发起过新对话后才允许）
	const allowAutoContinueRef = useRef<boolean>(false);

	// Track which threads have already had navigation planning triggered
	// This prevents re-triggering navigation planning when switching to a historical thread
	const navigationPlannedThreadsRef = useRef<Set<string>>(new Set());

	// Save current thread's design history when switching threads
	useEffect(() => {
		const prevThreadId = prevThreadIdRef.current;

		// Detect thread switch
		if (prevThreadId !== currentThreadId) {
			// Save previous thread's state (only if we have designs)
			if (designHistory.length > 0) {
				designHistoryByThreadRef.current.set(prevThreadId, {
					designs: [...designHistory], // Clone array
					lastProcessedMessage: lastProcessedMessageRef.current,
					lastDesign: lastDesignRef.current
				});
			}

			// Load current thread's state or initialize
			const currentThreadState = designHistoryByThreadRef.current.get(currentThreadId);
			if (currentThreadState && currentThreadState.designs.length > 0) {
				// Restore state
				setDesignHistory([...currentThreadState.designs]); // Clone array
				lastProcessedMessageRef.current = currentThreadState.lastProcessedMessage;
				lastDesignRef.current = currentThreadState.lastDesign;

				// Mark this thread as already having navigation planned
				// This prevents re-triggering navigation planning for historical threads
				if (currentThreadState.designs.length >= 2) {
					navigationPlannedThreadsRef.current.add(currentThreadId);
				}
			} else {
				setDesignHistory([]);
				lastProcessedMessageRef.current = -1;
				lastDesignRef.current = null;

				// Note: Don't reset previewEditorInputRef here
				// Let the preview update logic handle creating a new one if needed
				previewEditorInputRef.current = null;
				lastPreviewDesignsRef.current = null;
				totalUICountRef.current = 0;
				currentCompletedCountRef.current = 0;
				lastProcessedHTMLCountRef.current = 0;
				isDesignPhaseRef.current = false;
				hasCompletedDesignRef.current = false;
				designJustCompletedUntilRef.current = 0;
				continuationInFlightRef.current = false;
				continuationSentAtRef.current = 0;
				continuationCooldownUntilRef.current = 0;
				lastAutoContinueTimeRef.current = 0;
				lastAutoContinueHTMLCountRef.current = 0;
			}

			// Update previous thread ID
			prevThreadIdRef.current = currentThreadId;
		}
	}, [currentThreadId, chatMode]);

	// Auto-save design history to current thread whenever it changes
	// Note: We don't include designHistory in deps to avoid saving during restore
	// Instead, we save in the extraction effect after processing new designs
	useEffect(() => {
		// This effect only handles mode changes
		// Empty effect body - logic moved to next useEffect
	}, [chatMode, currentThreadId]);

	// Reset history when switching away from designer mode
	useEffect(() => {
		if (chatMode !== 'designer') {
			setDesignHistory([]);
			lastProcessedMessageRef.current = -1;
			lastDesignRef.current = null;
			// Also clear from storage
			designHistoryByThreadRef.current.delete(currentThreadId);
			// Reset preview panel reference
			previewEditorInputRef.current = null;
		}
	}, [chatMode, currentThreadId]);

	// 检测模式切换，重置自动继续状态
	useEffect(() => {
		const prevChatMode = prevChatModeRef.current;

		// 检测到模式切换
		if (prevChatMode !== chatMode) {
			// 重置自动继续相关的所有状态
			allowAutoContinueRef.current = false; // 禁止自动继续，等待用户发起新对话
			totalUICountRef.current = 0;
			currentCompletedCountRef.current = 0;
			lastProcessedHTMLCountRef.current = 0;
			isDesignPhaseRef.current = false;
			hasCompletedDesignRef.current = false;
			designJustCompletedUntilRef.current = 0;
			continuationInFlightRef.current = false;
			continuationSentAtRef.current = 0;
			continuationCooldownUntilRef.current = 0;
			lastAutoContinueTimeRef.current = 0;
			lastAutoContinueHTMLCountRef.current = 0;

			// 清除可能存在的自动继续timeout
			if (autoContinueTimeoutRef.current) {
				clearTimeout(autoContinueTimeoutRef.current);
				autoContinueTimeoutRef.current = null;
			}

			// 更新上一次的模式
			prevChatModeRef.current = chatMode;
		}
	}, [chatMode]);

	// Extract and accumulate designs (don't replace, append new ones)
	useEffect(() => {
		// Only proceed if in designer mode
		if (chatMode === 'designer') {

		// Get current checkpoint index (messages after this are "ghost" messages)
		const currentCheckpoint = chatThreadsState.allThreads[currentThreadId]?.state?.currCheckpointIdx;
		const effectiveMessageCount = (currentCheckpoint !== undefined && currentCheckpoint !== null) ? currentCheckpoint + 1 : previousMessages.length;

		// Detect task planning from reasoning or first assistant message
		let detectedTaskTotal: number | null = null;
		for (let i = lastProcessedMessageRef.current + 1; i < effectiveMessageCount; i++) {
			const message = previousMessages[i];
			if (message.role === 'assistant') {
				// Check reasoning first
				if (message.reasoning) {
					const progress = extractTaskProgressFromMessage(message.reasoning);
					if (progress && progress.phase === 'planning' && progress.totalCount !== null && progress.totalCount > 1) {
						detectedTaskTotal = progress.totalCount;
						break;
					}
				}
				// Check display content
				if (message.displayContent) {
					const progress = extractTaskProgressFromMessage(message.displayContent);
					if (progress && progress.phase === 'planning' && progress.totalCount !== null && progress.totalCount > 1) {
						detectedTaskTotal = progress.totalCount;
						break;
					}
				}
			}
		}

		// Detect checkpoint rollback (e.g., when user clicks "回退到本轮对话发起前")
		// If effectiveMessageCount < lastProcessedMessageRef + 1, we need to rebuild
		if (effectiveMessageCount <= lastProcessedMessageRef.current) {

			// Rebuild designHistory from scratch based on messages up to checkpoint
			const rebuiltDesigns: DesignData[] = [];
			previousMessages.forEach((message, idx) => {
				// Only process messages up to current checkpoint
				if (idx >= effectiveMessageCount) {
					return;
				}

				if (message.role === 'assistant' && message.displayContent) {
					const content = message.displayContent;

					// Extract designs from this message (使用更宽松的正则表达式)
					const htmlMatch = content.match(/```html\s*([\s\S]*?)```/i) || content.match(/<html[\s\S]*?<\/html>/i);
					// Try multiple CSS formats: ```css, unlabeled blocks with CSS content, <style> tags
					let cssMatch = content.match(/```css\s*\n([\s\S]*?)```/i);
					if (!cssMatch) {
						// Try unlabeled code blocks that look like CSS
						const unlabeledMatch = content.match(/```\n([\s\S]*?)```/i);
						if (unlabeledMatch && unlabeledMatch[1].match(/(:root|\.[\w-]+\s*\{|#[\w-]+\s*\{|--[\w-]+:)/)) {
							cssMatch = unlabeledMatch;
						}
					}
					if (!cssMatch) {
						cssMatch = content.match(/<style[\s\S]*?<\/style>/i);
					}
					const titleMatch = content.match(/##\s*(.+)/);

					// 只有当 HTML 内容不为空时才创建设计
					const htmlContent = htmlMatch ? htmlMatch[1].trim() : '';
					if (htmlContent && htmlContent.length >= 10) {
						const design: DesignData = {
							id: `design-${Date.now()}-${idx}`,
							type: 'mockup',
							title: titleMatch ? titleMatch[1].trim() : `设计 ${rebuiltDesigns.length + 1}`,
							html: htmlContent,
							css: cssMatch ? cssMatch[1] : '',
							timestamp: Date.now(),
						};
						rebuiltDesigns.push(design);
					}
				}

				// screenshot_to_code 工具的结果不添加为UI单元，仅作为AI设计的参考
			});

			setDesignHistory(rebuiltDesigns);
			lastProcessedMessageRef.current = effectiveMessageCount - 1;

			// Save to thread storage
			if (rebuiltDesigns.length > 0) {
				designHistoryByThreadRef.current.set(currentThreadId, {
					designs: [...rebuiltDesigns],
					lastProcessedMessage: effectiveMessageCount - 1,
					lastDesign: rebuiltDesigns[rebuiltDesigns.length - 1]
				});
			} else {
				// No designs left after rollback, clear storage
				designHistoryByThreadRef.current.delete(currentThreadId);
				lastDesignRef.current = null;
			}

			return;
		}

		// Process new messages only (up to current checkpoint)
		const newDesigns: DesignData[] = [];
		let designToUpdate: { id: string; design: DesignData } | null = null;

		previousMessages.forEach((message, idx) => {
			// Skip already processed messages
			if (idx <= lastProcessedMessageRef.current) {
				return;
			}

			// Skip messages after checkpoint (ghost messages)
			if (idx >= effectiveMessageCount) {
				return;
			}

			if (message.role === 'assistant' && message.displayContent) {
				const content = message.displayContent;

				// Check if this is an edit operation by looking for the marker in the PREVIOUS user message
				let editDesignId: string | null = null;
				if (idx > 0) {
					const prevMessage = previousMessages[idx - 1];
					if (prevMessage.role === 'user' && 'content' in prevMessage) {
						const userMessage = prevMessage.content || '';
						const editMatch = userMessage.match(/\[EDIT_DESIGN:([^\]]+)\]/);
						if (editMatch) {
							editDesignId = editMatch[1];
						}
					}
				}

				// Try to extract navigation configuration from AI response
				let aiNavigationLinks: NavigationLink[] | undefined;
				let fullNavigationPlan: any = null;
				// More flexible regex: allow optional newline after "navigation"
				const navConfigMatch = content.match(/```navigation\s*([\s\S]*?)```/i);
				if (navConfigMatch) {
					try {
						const navJsonStr = navConfigMatch[1].trim();
						if (navJsonStr && navJsonStr.length > 2) {
							const navConfig = JSON.parse(navJsonStr);
							// Check if this is a full navigation plan (for all designs)
							if (navConfig.navigationPlan && Array.isArray(navConfig.navigationPlan)) {
								fullNavigationPlan = navConfig.navigationPlan;
							} else if (Array.isArray(navConfig)) {
								// Direct array format
								aiNavigationLinks = navConfig;
							} else {
								// Object format with links property
								aiNavigationLinks = navConfig.links || navConfig;
							}
						}
					} catch (e) {
						console.warn('[Designer] Failed to parse navigation config:', e);
					}
				}

				// If we have a full navigation plan, apply it to all designs
				if (fullNavigationPlan) {
					setDesignHistory(prev => {
						// Create a set of valid design IDs for quick lookup
						const validDesignIds = new Set(prev.map(d => d.id));
						const updatedDesigns = prev.map(design => {
							const planForDesign = fullNavigationPlan.find((p: any) => p.sourceDesignId === design.id);
							if (planForDesign && planForDesign.links) {
								// Filter out links with invalid targetDesignId
								const validLinks = planForDesign.links.filter((link: any) => {
									const isValid = validDesignIds.has(link.targetDesignId);
									if (!isValid) {

									}
									return isValid;
								});

								if (validLinks.length > 0) {
									return {
										...design,
										navigationLinks: validLinks
									};
								}
							}
							return design;
						});

						return updatedDesigns;
					});
					return;
				}

				if (content.includes('```html') || content.includes('```css') || content.includes('```\n')) {
					// Extract ALL HTML blocks from the message (support multiple designs in one message)
					// 使用更宽松的正则表达式，允许 ```html 后面有或没有换行符
					const htmlRegex = /```html\s*([\s\S]*?)```/gi;
					const htmlMatches = Array.from(content.matchAll(htmlRegex));

					// If no html blocks found, try alternative format
					if (htmlMatches.length === 0) {
						const altMatch = content.match(/```\n(<!DOCTYPE html>[\s\S]*?)```/i);
						if (altMatch) {
							htmlMatches.push(altMatch as any);
						}
					}


					// Extract ALL CSS blocks - support multiple formats
					// Format 1: ```css ... ```
					const cssRegex1 = /```css\s*\n([\s\S]*?)```/gi;
					let cssMatches = Array.from(content.matchAll(cssRegex1));

					// Format 2: If no ```css found, try to find unlabeled code blocks that look like CSS
					if (cssMatches.length === 0) {
						// Match code blocks without language tag that contain CSS-like content
						const unlabeledBlockRegex = /```\n([\s\S]*?)```/gi;
						const unlabeledMatches = Array.from(content.matchAll(unlabeledBlockRegex));
						for (const match of unlabeledMatches) {
							const blockContent = match[1].trim();
							// Check if it looks like CSS (contains selectors, properties, or CSS variables)
							if (blockContent.match(/(:root|\.[\w-]+|#[\w-]+|\{[\s\S]*?:[\s\S]*?\}|--[\w-]+:)/)) {
								cssMatches.push(match);
							}
						}
					}

					// Format 3: Try plaintext/plain blocks that contain CSS
					if (cssMatches.length === 0) {
						const plainBlockRegex = /```(?:plaintext|plain|text)?\s*\n([\s\S]*?)```/gi;
						const plainMatches = Array.from(content.matchAll(plainBlockRegex));
						for (const match of plainMatches) {
							const blockContent = match[1].trim();
							// Check if it looks like CSS
							if (blockContent.match(/(:root\s*\{|\.[\w-]+\s*\{|#[\w-]+\s*\{|--[\w-]+\s*:)/)) {
								cssMatches.push(match);
							}
						}
					}

					// Process each HTML block as a separate design
					for (let htmlIdx = 0; htmlIdx < htmlMatches.length; htmlIdx++) {
						const htmlMatch = htmlMatches[htmlIdx];
						const html = htmlMatch[1].trim();

						// 跳过空的 HTML 块
						if (!html || html.length < 10) {
							continue;
						}

						// Smart CSS matching:
						// 1. If CSS count matches HTML count, use index-based matching
						// 2. If there's only one CSS block, use it for all HTML blocks
						// 3. Otherwise, try to find the closest CSS block after this HTML block
						// 4. If no CSS block found, extract from <style> tags in HTML
						let css = '';
						if (cssMatches.length === htmlMatches.length) {
							// Perfect match - use index-based matching
							css = cssMatches[htmlIdx][1].trim();
						} else if (cssMatches.length === 1) {
							// Single CSS for all HTML blocks
							css = cssMatches[0][1].trim();
						} else if (cssMatches.length > 0) {
							// Try to find the closest CSS block after this HTML block
							const htmlBlockEnd = (htmlMatch.index || 0) + htmlMatch[0].length;
							let closestCssIdx = -1;
							let minDistance = Infinity;

							for (let cssIdx = 0; cssIdx < cssMatches.length; cssIdx++) {
								const cssBlockStart = cssMatches[cssIdx].index || 0;
								if (cssBlockStart >= htmlBlockEnd) {
									const distance = cssBlockStart - htmlBlockEnd;
									if (distance < minDistance) {
										minDistance = distance;
										closestCssIdx = cssIdx;
									}
								}
							}

							if (closestCssIdx >= 0) {
								css = cssMatches[closestCssIdx][1].trim();
							} else {
								// No CSS block after this HTML, try to use any available CSS
								css = cssMatches[Math.min(htmlIdx, cssMatches.length - 1)][1].trim();
							}
						}

						// Fallback: Extract CSS from <style> tags in HTML if no separate CSS block found
						if (!css) {
							const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
							const styleMatches = Array.from(html.matchAll(styleTagRegex));
							if (styleMatches.length > 0) {
								css = styleMatches.map(m => m[1].trim()).join('\n\n');
							}
						}

						// If still no CSS, provide minimal default styles
						if (!css) {
							css = `/* Auto-generated default styles */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
a { color: inherit; text-decoration: none; }
button { cursor: pointer; }`;

						}

						let type: 'mockup' | 'component' | 'wireframe' = 'component';
						const lowerContent = content.toLowerCase();
						if (lowerContent.includes('mockup') || lowerContent.includes('screen') || lowerContent.includes('page')) {
							type = 'mockup';
						} else if (lowerContent.includes('wireframe') || lowerContent.includes('sketch')) {
							type = 'wireframe';
						}

						// Extract title for this specific design
						let title = '';

						// Get the position of this HTML block in the content
						const htmlBlockStart = htmlMatch.index || 0;
						// Get text before this HTML block (up to 500 chars)
						const textBeforeBlock = content.substring(Math.max(0, htmlBlockStart - 500), htmlBlockStart);

						// Pattern 1: Look for markdown heading (## or #) right before this code block
						const headingMatch = textBeforeBlock.match(/#{1,3}\s+([^\n]+)\s*$/);
						if (headingMatch) {
							title = headingMatch[1].trim();
						}

						// Pattern 2: Look for bold text or numbered title (e.g., "1. 数据分析界面" or "**界面名称**")
						if (!title) {
							const boldOrNumberMatch = textBeforeBlock.match(/(?:\d+\.\s+|\*\*\s*)([^*\n]{3,50})(?:\*\*|\s*$)/);
							if (boldOrNumberMatch) {
								title = boldOrNumberMatch[1].trim();
							}
						}

						// Pattern 3: Look for Chinese title patterns (界面、页面、组件 etc.)
						if (!title) {
							const chineseTitleMatch = textBeforeBlock.match(/([^\n]{2,30}(?:界面|页面|组件|模块|面板|视图))\s*$/);
							if (chineseTitleMatch) {
								title = chineseTitleMatch[1].trim();
							}
						}

						// Pattern 4: Look for any text on the line immediately before the code block
						if (!title) {
							const lines = textBeforeBlock.split('\n');
							for (let i = lines.length - 1; i >= 0; i--) {
								const line = lines[i].trim();
								// Skip empty lines and lines with only symbols
								if (line && line.length > 2 && line.length < 100 &&
									!line.startsWith('```') && !line.startsWith('//') &&
									!line.match(/^[`*\-_=]+$/)) {
									title = line.replace(/^[*\-#\s]+/, '').replace(/[*:：]+$/, '').trim();
									break;
								}
							}
						}

						// Pattern 5: For multiple designs, try to extract from structured content
						if (!title && htmlMatches.length > 1) {
							// Look for patterns like "第一个界面", "第二个界面" or ordinal numbers
							const ordinalMatch = textBeforeBlock.match(/第[一二三四五六七八九十]+(?:个)?([^\n]{2,20})/);
							if (ordinalMatch) {
								title = ordinalMatch[1].trim();
							}
						}

						// Fallback: Use generic name with proper numbering
						if (!title) {
							// Count existing designs to get proper index
							const currentDesignCount = designHistory.length + htmlIdx + 1;
							title = `设计 ${currentDesignCount}`;
						}

						// If this is an edit operation, update the existing design
						if (editDesignId && htmlIdx === 0) {
							// Find the original design to preserve its title and CSS if not updated
							const originalDesign = designHistory.find(d => d.id === editDesignId);
							const preservedTitle = originalDesign?.title || title;
							// If no new CSS provided, keep the original CSS
							const preservedCss = css || originalDesign?.css || '';


							designToUpdate = {
								id: editDesignId,
								design: {
									id: editDesignId, // Keep the same ID
									type,
									html,
									css: preservedCss, // Use new CSS if provided, otherwise keep original
									title: preservedTitle, // Keep the original title
									timestamp: Date.now(), // Update timestamp
									navigationLinks: aiNavigationLinks // Use AI-provided navigation if available
								}
							};
						} else {
							// Create new design
							newDesigns.push({
								id: `${threadId}-${idx}-${htmlIdx}-${Date.now()}`,
								type,
								html,
								css,
								title,
								timestamp: Date.now(),
								navigationLinks: aiNavigationLinks // Use AI-provided navigation if available
							});
						}
					}
				}
			}

			// 注意：screenshot_to_code 工具的结果不直接添加为UI单元
			// 该工具生成的代码仅作为AI设计的参考信息，AI需要根据参考来生成最终的HTML+CSS代码块
			// 最终的UI单元由AI在消息中输出的```html和```css代码块生成
		});

		// Update design history
		if (designToUpdate !== null) {
			// Update existing design
			lastProcessedMessageRef.current = previousMessages.length - 1;
			const updateInfo: { id: string; design: DesignData } = designToUpdate; // Capture for closure
			setDesignHistory(prev => {
				const index = prev.findIndex(d => d.id === updateInfo.id);
				let newHistory: DesignData[];
				if (index !== -1) {
					// Replace the design at the found index
					newHistory = [...prev];
					newHistory[index] = updateInfo.design;
				} else {
					// Design not found, add as new (shouldn't happen, but handle gracefully)
					newHistory = [...prev, updateInfo.design];
				}

				// Save to thread storage immediately after updating
				designHistoryByThreadRef.current.set(currentThreadId, {
					designs: [...newHistory],
					lastProcessedMessage: previousMessages.length - 1,
					lastDesign: newHistory[newHistory.length - 1]
				});

				// Trigger AI navigation planning FIRST (before task progress updates)
				// This ensures navigation planning happens immediately, like the original version
				if (newHistory.length >= 2) {
					planNavigationWithAI(newHistory);
				}

				// Update task progress
				const currentProgress = taskProgressByThreadRef.current.get(currentThreadId);
				const expectedTotal = detectedTaskTotal || currentProgress?.totalCount || null;
				const isStreaming = Boolean(currThreadStreamState?.isRunning);
				const updatedProgress = calculateTaskProgress(newHistory.length, expectedTotal, isStreaming);
				if (updatedProgress) {
					setCurrentTaskProgress(updatedProgress);
					taskProgressByThreadRef.current.set(currentThreadId, updatedProgress);

					// If task is completed AND we have multiple designs, update to navigation phase
					if (updatedProgress.phase === 'completed' && newHistory.length >= 2) {
						// Update progress to navigation phase
						const navProgress: DesignTaskProgress = {
							...updatedProgress,
							phase: 'navigation'
						};
						setCurrentTaskProgress(navProgress);
						taskProgressByThreadRef.current.set(currentThreadId, navProgress);
					} else if (updatedProgress.phase === 'completed' && newHistory.length === 1) {

					}
				}

				// Re-detect navigation links for all designs
				return newHistory.map(design => {
					// If AI provided navigation config (as raw config), resolve it to actual IDs
					if (design.navigationLinks && Array.isArray(design.navigationLinks) && design.navigationLinks.length > 0) {
						const firstLink = design.navigationLinks[0];
						// Check if it's unresolved (has targetDesignTitle instead of targetDesignId)
						if ('targetDesignTitle' in firstLink || !('targetDesignId' in firstLink)) {
							return {
								...design,
								navigationLinks: resolveNavigationConfig(design.navigationLinks as any[], newHistory)
							};
						}
						// Already resolved, keep as is
						return design;
					}
					// No AI config, use auto-detection
					return {
						...design,
						navigationLinks: detectNavigationLinks(design.html, design.id, newHistory)
					};
				});
			});
		} else if (newDesigns.length > 0) {
			// Add new designs
			lastProcessedMessageRef.current = previousMessages.length - 1;
			setDesignHistory(prev => {
				const newHistory = [...prev, ...newDesigns];

				// Save to thread storage immediately after adding
				designHistoryByThreadRef.current.set(currentThreadId, {
					designs: [...newHistory],
					lastProcessedMessage: previousMessages.length - 1,
					lastDesign: newHistory[newHistory.length - 1]
				});

				// Trigger AI navigation planning FIRST (before task progress updates)
				// This ensures navigation planning happens immediately, like the original version
				if (newHistory.length >= 2) {
					planNavigationWithAI(newHistory);
				}

				// Update task progress
				const currentProgress = taskProgressByThreadRef.current.get(currentThreadId);
				const expectedTotal = detectedTaskTotal || currentProgress?.totalCount || null;
				const isStreaming = Boolean(currThreadStreamState?.isRunning);
				const updatedProgress = calculateTaskProgress(newHistory.length, expectedTotal, isStreaming);
				if (updatedProgress) {
					setCurrentTaskProgress(updatedProgress);
					taskProgressByThreadRef.current.set(currentThreadId, updatedProgress);

					// If task is completed AND we have multiple designs, update to navigation phase
					if (updatedProgress.phase === 'completed' && newHistory.length >= 2) {
						// Update progress to navigation phase
						const navProgress: DesignTaskProgress = {
							...updatedProgress,
							phase: 'navigation'
						};
						setCurrentTaskProgress(navProgress);
						taskProgressByThreadRef.current.set(currentThreadId, navProgress);
					} else if (updatedProgress.phase === 'completed' && newHistory.length === 1) {

					}
				}

				// Detect navigation links for all designs
				return newHistory.map(design => {
					// If AI provided navigation config (as raw config), resolve it to actual IDs
					if (design.navigationLinks && Array.isArray(design.navigationLinks) && design.navigationLinks.length > 0) {
						const firstLink = design.navigationLinks[0];
						// Check if it's unresolved (has targetDesignTitle instead of targetDesignId)
						if ('targetDesignTitle' in firstLink || !('targetDesignId' in firstLink)) {
							return {
								...design,
								navigationLinks: resolveNavigationConfig(design.navigationLinks as any[], newHistory)
							};
						}
						// Already resolved, keep as is
						return design;
					}
					// No AI config, use auto-detection
					return {
						...design,
						navigationLinks: detectNavigationLinks(design.html, design.id, newHistory)
					};
				});
			});
		}
		} // End of chatMode === 'designer' check
	}, [chatMode, previousMessages, threadId, chatThreadsState]);

	// 旧的自动继续逻辑已删除，现在使用基于HTML计数的新逻辑（见下方useEffect）

	// Extract streaming design (temporary, real-time preview)
	const streamingDesign = useMemo(() => {
		if (chatMode !== 'designer' || !displayContentSoFar) {
			return null;
		}

		// Check if we're editing an existing design
		let editDesignId: string | null = null;
		if (previousMessages.length > 0) {
			const lastUserMessage = [...previousMessages].reverse().find(m => m.role === 'user');
			if (lastUserMessage && 'content' in lastUserMessage) {
				const editMatch = (lastUserMessage.content || '').match(/\[EDIT_DESIGN:([^\]]+)\]/);
				if (editMatch) {
					editDesignId = editMatch[1];
				}
			}
		}

		if (displayContentSoFar.includes('```html') || displayContentSoFar.includes('```css') || displayContentSoFar.includes('```\n')) {
			// 使用更宽松的正则表达式，允许 ```html 后面有或没有换行符
			const htmlMatch = displayContentSoFar.match(/```html\s*([\s\S]*?)```/i) ||
							  displayContentSoFar.match(/```\n(<!DOCTYPE html>[\s\S]*?)```/i);
			// Try multiple CSS formats
			let cssMatch = displayContentSoFar.match(/```css\s*\n([\s\S]*?)```/i);
			if (!cssMatch) {
				// Try unlabeled code blocks that look like CSS
				const unlabeledMatch = displayContentSoFar.match(/```\n([\s\S]*?)```/i);
				if (unlabeledMatch && unlabeledMatch[1].match(/(:root|\.[\w-]+\s*\{|#[\w-]+\s*\{|--[\w-]+:)/)) {
					cssMatch = unlabeledMatch;
				}
			}

			if (htmlMatch) {
				const html = htmlMatch[1].trim();
				// 跳过空的 HTML 内容
				if (!html || html.length < 10) {
					return null;
				}
				const css = cssMatch ? cssMatch[1].trim() : '';

				let type: 'mockup' | 'component' | 'wireframe' = 'component';
				const lowerContent = displayContentSoFar.toLowerCase();
				if (lowerContent.includes('mockup') || lowerContent.includes('screen') || lowerContent.includes('page')) {
					type = 'mockup';
				} else if (lowerContent.includes('wireframe') || lowerContent.includes('sketch')) {
					type = 'wireframe';
				}

				const titleMatch = displayContentSoFar.match(/^#\s+(.+)$/m);
				const title = titleMatch ? titleMatch[1] : '🔴 Live Preview';

				// If editing, preserve the original title and CSS if not updated
				let finalTitle = title;
				let finalCss = css;
				if (editDesignId) {
					const originalDesign = designHistory.find(d => d.id === editDesignId);
					finalTitle = originalDesign?.title || title;
					// If no new CSS in the stream yet, keep the original CSS
					finalCss = css || originalDesign?.css || '';

				}

				return {
					id: editDesignId || `${threadId}-streaming`, // Use edit ID if editing, otherwise use streaming ID
					type,
					html,
					css: finalCss, // Use new CSS if provided, otherwise keep original
					title: finalTitle, // Use preserved title if editing
					timestamp: Date.now(),
					isStreaming: true // Mark as streaming for special handling
				} as DesignData & { isStreaming?: boolean };
			}
		}

		return null;
	}, [chatMode, displayContentSoFar, threadId, previousMessages, designHistory]);

	// Combine history with streaming design
	const allDesigns = useMemo(() => {
		let designs: DesignData[] = [];

		if (streamingDesign) {
			// Check if streaming design is an edit (has a non-streaming ID)
			const isEditStreaming = !streamingDesign.id.includes('-streaming');

			if (isEditStreaming) {
				// Replace the design being edited with the streaming version
				designs = designHistory.map(d =>
					d.id === streamingDesign.id ? streamingDesign : d
				);
			} else {
				// Append new streaming design
				designs = [...designHistory, streamingDesign];
			}
		} else {
			designs = designHistory;
		}

		// Update last design reference
		if (designs.length > 0) {
			lastDesignRef.current = designs[designs.length - 1];
		}

		// If designs is empty but we had a design before, keep showing it
		// This prevents the canvas from going blank during the transition
		if (designs.length === 0 && lastDesignRef.current) {
			designs = [lastDesignRef.current];
		}
		return designs;
	}, [designHistory, streamingDesign]);

	// Function to open/update preview in editor area
	const openPreviewInEditor = useCallback(async (designs: DesignData[]) => {

		const { SenweaverDesignerPreviewInput } = await import('../../../senweaverDesignerPreviewEditor.js');

		// 统一进行设计阶段的非递减保护，适用于首次创建或已有预览
		let nextDesigns = designs;
		const now = Date.now();
		const inDesignPhase = isDesignPhaseRef.current;
		const justCompleted = now < designJustCompletedUntilRef.current;

		if (inDesignPhase || justCompleted) {
			if (!lastPreviewDesignsRef.current) {
				lastPreviewDesignsRef.current = nextDesigns;
				} else if (nextDesigns.length < lastPreviewDesignsRef.current.length) {
				const reason = inDesignPhase ? 'design phase' : 'just completed';
				nextDesigns = lastPreviewDesignsRef.current;
			} else {
				lastPreviewDesignsRef.current = nextDesigns;
			}
		} else {
			lastPreviewDesignsRef.current = nextDesigns;
		}

		// Always try to update the active editor pane if it supports updateDesigns
		const activePane = editorService.activeEditorPane;
		if (activePane && 'updateDesigns' in activePane) {
			(activePane as any).updateDesigns(nextDesigns);
		}

		// Update existing preview input if we are tracking one
		if (previewEditorInputRef.current) {
			previewEditorInputRef.current.updateDesigns(nextDesigns);
		} else if (!activePane || !('updateDesigns' in activePane)) {
			// No tracked input and no active pane to update – create a new preview editor
			const input = new SenweaverDesignerPreviewInput(nextDesigns);
			previewEditorInputRef.current = input;
			await editorService.openEditor(input, { pinned: true });
		}
	}, [editorService]);

	// Auto-open/update preview panel when in designer mode (always open, even if no designs)
	useEffect(() => {
		if (chatMode === 'designer') {
			openPreviewInEditor(allDesigns);
		}
	}, [chatMode, allDesigns, openPreviewInEditor]);

	const handleOpenPreview = useCallback((design: DesignData) => {
		// Open preview with the specific design
		openPreviewInEditor([design]);
	}, [openPreviewInEditor]);

	const handleClosePreview = useCallback(() => {
		// Close is handled by VS Code's editor close button
		// We don't need to do anything here
	}, []);

	// Auto-continue design generation if incomplete
	const autoContinueTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const designPlanRef = useRef<{ total: number; pages: string[]; designSystem: string } | null>(null);
	const lastProcessedHTMLCountRef = useRef<number>(0); // 上次处理的HTML数量，防止重复触发

	// 静默计数器 - 核心状态管理
	const totalUICountRef = useRef<number>(0); // UI总数（从规划中提取）
	const currentCompletedCountRef = useRef<number>(0); // 当前已完成的UI数量（纯HTML计数）
	const isDesignPhaseRef = useRef<boolean>(false); // 是否处于设计阶段（true=设计中，false=可以导航规划）
	const hasCompletedDesignRef = useRef<boolean>(false); // 是否已经完成过一轮完整的设计（防止重复进入）
	// 预览推送的上一次designs缓存，用于防止设计阶段数量回退
	const lastPreviewDesignsRef = useRef<DesignData[] | null>(null);
	const lastAutoContinueTimeRef = useRef<number>(0); // 上一次自动继续的时间戳（用于节流）
	const lastAutoContinueHTMLCountRef = useRef<number>(0); // 上一次自动继续时的HTML计数（用于去重）
	const continuationInFlightRef = useRef<boolean>(false); // 是否已有续写在途
	const continuationSentAtRef = useRef<number>(0); // 最近一次续写发送时间
	const continuationCooldownUntilRef = useRef<number>(0); // 统一冷却期（ms时间戳）
	const designJustCompletedUntilRef = useRef<number>(0); // 设计刚完成的保护窗口

	useEffect(() => {

		// Only check when in designer mode
		if (chatMode !== 'designer') {
			return;
		}

		// 模式切换后，禁止自动继续对话，直到用户发起新对话
		// allowAutoContinueRef 会在用户发送新消息时被设置为 true
		if (!allowAutoContinueRef.current) {
			return;
		}

		// Skip if LLM is currently running (wait for completion)
		if (isRunning) {
			return;
		}

		// Get the last assistant message
		const lastAssistantMessage = previousMessages.filter(m => m.role === 'assistant').pop();
		if (!lastAssistantMessage || !lastAssistantMessage.displayContent) {
			return;
		}

		const content = lastAssistantMessage.displayContent;

		// ========== 步骤1: 检测并提取设计规划 ==========
		const planMatch = content.match(/\[DESIGN_PLAN:START\]([\s\S]*?)\[DESIGN_PLAN:END\]/);

		if (planMatch) {
			// 新的设计规划 - 初始化静默计数器
			const planText = planMatch[1];
			const pages = planText.split('\n')
				.map(line => line.trim())
				.filter(line => /^\d+\./.test(line))
				.map(line => line.replace(/^\d+\.\s*/, ''));

			const cssMatches = content.match(/```css\s*\n([\s\S]*?)```/);
			const designSystem = cssMatches ? cssMatches[1] : '';

			designPlanRef.current = {
				total: pages.length,
				pages: pages,
				designSystem: designSystem
			};

			// 初始化所有计数器
			totalUICountRef.current = pages.length;
			currentCompletedCountRef.current = 0;
			lastProcessedHTMLCountRef.current = 0; // 重置防重复触发的计数器
			isDesignPhaseRef.current = true; // 进入设计阶段
			hasCompletedDesignRef.current = false; // 重置完成标志，允许新一轮设计
			designJustCompletedUntilRef.current = 0; // 清除设计完成保护窗口

			// 不要return，继续执行后面的逻辑
		}

		// ========== 步骤1.5: 备用方案 - 智能提取规划总数 ==========
		// 如果AI跳过了规划步骤，我们尝试多种方式提取总数
		// 只在还没有进入设计阶段且没有完成过设计时才尝试提取
		if (!isDesignPhaseRef.current && totalUICountRef.current === 0 && !hasCompletedDesignRef.current) {
			const assistantMessages = previousMessages.filter(m => m.role === 'assistant');
			const allContent = assistantMessages.map(m => m.displayContent || '').join('\n');

			let extractedTotal = 0;
			let extractionMethod = '';

			// 方法1: 从进度标记中提取 [DESIGN_PROGRESS:X/Y] 或 [DESIGN_INCOMPLETE:X/Y]
			const progressMatch = allContent.match(/\[DESIGN_(?:PROGRESS|INCOMPLETE):(\d+)\/(\d+)\]/);
			if (progressMatch) {
				extractedTotal = parseInt(progressMatch[2], 10);
				extractionMethod = 'progress marker';
			}

			// 方法2: 从第一条助手消息中智能提取规划列表
			// 查找类似 "1. 页面名称" 的列表格式
			if (!extractedTotal && assistantMessages.length > 0) {
				const firstMessage = assistantMessages[0].displayContent || '';

				// 匹配编号列表：1. xxx \n 2. xxx \n 3. xxx ...
				const numberedListMatches = firstMessage.match(/^\s*\d+\.\s+.+$/gm);
				if (numberedListMatches && numberedListMatches.length >= 3) {
					// 找到最大的编号
					const numbers = numberedListMatches.map(line => {
						const match = line.match(/^\s*(\d+)\./);
						return match ? parseInt(match[1], 10) : 0;
					});
					extractedTotal = Math.max(...numbers);
					extractionMethod = 'numbered list in first message';
				}

				// 匹配中文描述：如 "共28个页面"、"总共35个UI"、"设计28个页面"
				if (!extractedTotal) {
					const chineseMatch = firstMessage.match(/(?:共|总共|一共|设计|生成|创建)\s*(\d+)\s*(?:个|张)?(?:页面|UI|界面|设计)/i);
					if (chineseMatch) {
						extractedTotal = parseInt(chineseMatch[1], 10);
						extractionMethod = 'Chinese description in first message';
					}
				}

				// 匹配英文描述：如 "28 pages", "35 UIs", "design 28 pages"
				if (!extractedTotal) {
					const englishMatch = firstMessage.match(/(?:total|design|create|generate)\s*(?:of)?\s*(\d+)\s*(?:pages?|UIs?|screens?|designs?)/i);
					if (englishMatch) {
						extractedTotal = parseInt(englishMatch[1], 10);
						extractionMethod = 'English description in first message';
					}
				}
			}

			// 如果成功提取到总数，初始化设计阶段
			if (extractedTotal > 0) {

				// 初始化计数器
				totalUICountRef.current = extractedTotal;
				currentCompletedCountRef.current = 0; // ✅ 重置为0，让后续逻辑自然更新
				lastProcessedHTMLCountRef.current = 0; // ✅ 重置为0，确保能触发自动继续
				isDesignPhaseRef.current = true; // 进入设计阶段
				designJustCompletedUntilRef.current = 0; // 清除设计完成保护窗口
				// ✅ 重置续写状态，避免旧在途/基线影响新一轮
				lastAutoContinueTimeRef.current = 0;
				lastAutoContinueHTMLCountRef.current = 0;
				continuationInFlightRef.current = false;
				continuationSentAtRef.current = 0;

					// 不要return，继续执行后面的逻辑
			}
		}

		// ========== 步骤2: 检查是否处于设计阶段 ==========
		if (!isDesignPhaseRef.current || totalUICountRef.current === 0) {
			return;
		}

		// ========== 步骤3: 纯HTML计数 - 统计所有助手消息中的HTML总数 ==========
		// 不只看最后一条消息，而是统计所有助手消息中的HTML总数
		const assistantMessages = previousMessages.filter(m => m.role === 'assistant');
		let totalHTMLCount = 0;

		for (const msg of assistantMessages) {
			if (msg.displayContent) {
				const htmlMatches = msg.displayContent.match(/```html/g);
				if (htmlMatches) {
					totalHTMLCount += htmlMatches.length;
				}
			}
		}

		// 续写完成检测：有新HTML或LLM已完成但无新HTML时清除在途标记
		if (continuationInFlightRef.current) {
			const hasNewHTML = totalHTMLCount > lastAutoContinueHTMLCountRef.current;
			const llmFinishedWithoutHTML = !isRunning && totalHTMLCount === lastAutoContinueHTMLCountRef.current;

			if (hasNewHTML || llmFinishedWithoutHTML) {
				continuationInFlightRef.current = false;
			}

		if (hasNewHTML || llmFinishedWithoutHTML) {
			continuationInFlightRef.current = false;
		}
	}

	// 防止重复触发：如果已经处理过这个HTML数量，默认跳过
	if (totalHTMLCount === lastProcessedHTMLCountRef.current) {
		// 补偿性处理：若仍在设计阶段且未完成，但上一轮LLM未产出HTML，尝试重新触发继续
		const completed = currentCompletedCountRef.current;
		const total = totalUICountRef.current;
		const now = Date.now();
		const canRetry = isDesignPhaseRef.current
			&& total > 0
			&& completed < total
			&& !isRunning
			&& (now - lastAutoContinueTimeRef.current > 4000)
			&& lastAutoContinueHTMLCountRef.current === totalHTMLCount;

		// 若已有在途且未超时，不进行重试
		const inFlightBlock = continuationInFlightRef.current && (now - continuationSentAtRef.current <= 8000);
		const cooldownBlock = now < continuationCooldownUntilRef.current;

		if (canRetry && !inFlightBlock && !cooldownBlock) {
			const remainingUI = total - completed;
			const nextBatchSize = Math.min(1, remainingUI);
			// 清除之前的timeout
			if (autoContinueTimeoutRef.current) {
				clearTimeout(autoContinueTimeoutRef.current);
			}
			lastAutoContinueTimeRef.current = now;
			lastAutoContinueHTMLCountRef.current = totalHTMLCount;
			continuationInFlightRef.current = true;
			continuationSentAtRef.current = now;
			continuationCooldownUntilRef.current = now + 2000; // 设置冷却期（从6秒减少到2秒）
			autoContinueTimeoutRef.current = setTimeout(async () => {
				const continuationPrompt = `继续设计剩余的UI页面。

**当前进度**: 已完成 ${completed}/${total} 个UI，还剩 ${remainingUI} 个待设计

**⚠️ 严格限制 - 必须遵守 ⚠️**:
本批次只能设计 ${nextBatchSize} 个UI页面（第 ${completed + 1} 到第 ${completed + nextBatchSize} 个）

**🚫🚫🚫 绝对禁止的行为 🚫🚫🚫**:
1. ❌ 禁止超过 ${nextBatchSize} 个UI
2. ❌ 禁止生成第 ${completed + nextBatchSize + 1} 个或更多UI
3. ❌❌❌ 绝对禁止启动导航规划
4. ❌❌❌ 绝对禁止生成导航JSON
5. ❌ 禁止输出任何导航相关内容
6. ❌ 禁止思考或分析导航逻辑
7. ❌ 禁止提及接下来规划导航

**为什么禁止导航规划？**
- 导航规划只能在所有${total}个UI完成后才能开始
- 现在才完成${completed}个，还有${remainingUI}个未完成
- 你的唯一任务是设计UI

**✅ 必须执行**:
1. 只设计 ${nextBatchSize} 个完整的UI（第 ${completed + 1} 个）
2. **CSS完整性保证**: 每个UI必须包含完整的HTML和CSS代码，CSS丢失则参考上一个UI的样式
3. 每个UI后添加 [DESIGN_PROGRESS:X/${total}] 标记
4. 设计完后添加 [DESIGN_INCOMPLETE:${completed + nextBatchSize}/${total}]
5. 立即停止响应，系统会自动触发下一批`;

				try {
					await chatThreadsService.addUserMessageAndStreamResponse({
						userMessage: continuationPrompt,
						displayMessage: `🔄 继续设计剩余 ${remainingUI} 个UI...`,
						threadId: threadId,
						images: [],
						_chatSelections: []
					});
				} catch (error) {
				}
			}, 300); // 从500ms减少到300ms
			return;
		}

		return;
	}

	// 更新当前完成数
	const newUICount = totalHTMLCount - lastProcessedHTMLCountRef.current;
	currentCompletedCountRef.current = totalHTMLCount;
	lastProcessedHTMLCountRef.current = totalHTMLCount; // 记录已处理的数量
	const completed = currentCompletedCountRef.current;
	const total = totalUICountRef.current;


	// ========== 步骤4: 检查是否完成所有设计 ==========
	if (completed >= total) {
		isDesignPhaseRef.current = false; // 退出设计阶段，允许导航规划
		hasCompletedDesignRef.current = true; // 标记已完成，防止重复进入

		// 设置短期保护窗口，防止设计完成后的延迟更新导致回退
		designJustCompletedUntilRef.current = Date.now() + 3000; // 3秒保护窗口

		// 清空所有计数器，等待新一轮请求
		totalUICountRef.current = 0;
		currentCompletedCountRef.current = 0;
		lastProcessedHTMLCountRef.current = 0;
		// ✅ 清理续写在途与基线，防止完成后再次触发补偿重试
		lastAutoContinueTimeRef.current = 0;
		lastAutoContinueHTMLCountRef.current = 0;
		continuationInFlightRef.current = false;
		continuationSentAtRef.current = 0;

		// ✅ 设计完成时强制刷新预览界面，确保最后一个UI显示
		setTimeout(() => {
			if (allDesigns.length > 0) {
				openPreviewInEditor(allDesigns);
			}
		}, 500);

		return;
	}

	// ========== 步骤5: 每1个UI停止，触发继续设计 ==========
	const remainingUI = total - completed;
	const nextBatchSize = Math.min(1, remainingUI);

	// 冷却期保护：未到期则跳过
	if (Date.now() < continuationCooldownUntilRef.current) {
		return;
	}


	// 清除之前的timeout
	if (autoContinueTimeoutRef.current) {
		clearTimeout(autoContinueTimeoutRef.current);
	}

	// 若已有在途请求，则不再重复触发
	if (continuationInFlightRef.current) {
		return;
	}

	// 记录触发时刻与基线HTML计数，用于后续补偿性重试
	lastAutoContinueTimeRef.current = Date.now();
	lastAutoContinueHTMLCountRef.current = totalHTMLCount;
	continuationInFlightRef.current = true;
	continuationSentAtRef.current = lastAutoContinueTimeRef.current;
	continuationCooldownUntilRef.current = lastAutoContinueTimeRef.current + 2000; // 设置统一冷却期（从6秒减少到2秒）

	// 延迟300ms后发送继续请求（从500ms减少到3
	autoContinueTimeoutRef.current = setTimeout(async () => {

		const continuationPrompt = `继续设计剩余的UI页面。

**当前进度**: 已完成 ${completed}/${total} 个UI，还剩 ${remainingUI} 个待设计

**⚠️ 严格限制 - 必须遵守 ⚠️**:
本批次只能设计 ${nextBatchSize} 个UI页面（第 ${completed + 1} 到第 ${completed + nextBatchSize} 个）

**🚫🚫🚫 绝对禁止的行为 🚫🚫🚫**:
1. ❌ 禁止超过 ${nextBatchSize} 个UI
2. ❌ 禁止生成第 ${completed + nextBatchSize + 1} 个或更多UI
3. ❌❌❌ **绝对禁止启动导航规划** - 这是最重要的规则！
4. ❌❌❌ **绝对禁止生成导航JSON** - 系统会在所有UI完成后自动处理！
5. ❌ 禁止输出任何"导航关系"、"页面跳转"、"链接规划"等内容
6. ❌ 禁止思考或分析导航逻辑
7. ❌ 禁止提及"接下来规划导航"之类的话

**为什么禁止导航规划？**
- 导航规划只能在**所有${total}个UI完成后**才能开始
- 现在才完成${completed}个，还有${remainingUI}个未完成
- 如果现在规划导航，会导致系统混乱
- **你的唯一任务是设计UI，不是规划导航**

**✅ 必须执行**:
1. 只设计 ${nextBatchSize} 个完整的UI（第 ${completed + 1} 个）
2. **CSS完整性保证**: 每个UI必须包含完整的HTML和CSS代码，CSS丢失则参考上一个UI的样式
3. 每个UI后添加 [DESIGN_PROGRESS:X/${total}] 标记
4. 设计完后添加 [DESIGN_INCOMPLETE:${completed + nextBatchSize}/${total}]
5. 立即停止响应，系统会自动触发下一批

现在开始设计第 ${completed + 1} 个UI页面。`;

		try {
			await chatThreadsService.addUserMessageAndStreamResponse({
				userMessage: continuationPrompt,
				displayMessage: `🔄 继续设计剩余 ${remainingUI} 个UI...`,
				threadId: threadId,
				images: [],
				_chatSelections: []
			});
		} catch (error) {
		}
	}, 300); // 从500ms减少到300ms

	// Cleanup timeout on unmount
	return () => {
		if (autoContinueTimeoutRef.current) {
			clearTimeout(autoContinueTimeoutRef.current);
		}
	};
}, [chatMode, isRunning, previousMessages, threadId, chatThreadsService]);

	// ----- SIDEBAR CHAT state (local) -----

	// Input history state
	type InputHistoryEntry = {
		text: string;
		selections: StagingSelectionItem[];
		images: ImageAttachment[];
	}
	const [inputHistory, setInputHistory] = useState<InputHistoryEntry[]>([]);
	const [historyIndex, setHistoryIndex] = useState(-1); // -1 means current input, 0+ means history
	const [currentDraft, setCurrentDraft] = useState<InputHistoryEntry>({ text: '', selections: [], images: [] }); // Store current draft when navigating history
	const isProgrammaticUpdate = useRef(false); // Track if we're programmatically updating the text

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)

	const isDisabled = instructionsAreEmpty || !!isFeatureNameDisabled('Chat', settingsState)

	const sidebarRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const fileService = accessor.get('IFileService')

	const onSubmit = useCallback(async (_forceSubmit?: string) => {

		if (isDisabled && !_forceSubmit) return
		if (isRunning) return

		// 用户主动发起了对话，允许自动继续功能
		allowAutoContinueRef.current = true;

		const threadId = chatThreadsService.state.currentThreadId

		// send message to LLM
		const userMessage = _forceSubmit || textAreaRef.current?.value || ''

		// 获取当前线程中的图片附件
		const currentThread = chatThreadsService.getCurrentThread();
		let uploadedImages = currentThread.state.uploadedImages || [];

		// 等待所有图片上传完成（最多等待30秒）
		if (uploadedImages.length > 0) {
			const pendingImages = uploadedImages.filter(img => img.uploadStatus === 'pending' || img.uploadStatus === 'uploading');
			if (pendingImages.length > 0) {
				// 轮询等待上传完成
				const maxWait = 30000; // 30秒
				const pollInterval = 200; // 200ms
				let waited = 0;
				while (waited < maxWait) {
					await new Promise(resolve => setTimeout(resolve, pollInterval));
					waited += pollInterval;
					const thread = chatThreadsService.getCurrentThread();
					if (!thread) break;
					uploadedImages = thread.state.uploadedImages || [];
					const stillPending = uploadedImages.filter(img => img.uploadStatus === 'pending' || img.uploadStatus === 'uploading');
					if (stillPending.length === 0) {
						break;
					}
				}
				// 检查是否有上传失败的图片
				const failedImages = uploadedImages.filter(img => img.uploadStatus === 'error');
				if (failedImages.length > 0) {
					console.warn(`[SidebarChat] ${failedImages.length} image(s) failed to upload`);
				}
			}
		}

		// 验证图片上传状态
		if (uploadedImages.length > 0) {
			// 过滤掉未上传成功的图片
			const successfulImages = uploadedImages.filter(img => img.uploadedUrl && img.uploadStatus === 'uploaded');
			if (successfulImages.length !== uploadedImages.length) {
				console.warn(`[SidebarChat] Only ${successfulImages.length}/${uploadedImages.length} images uploaded successfully`);
			}
			uploadedImages = successfulImages;
		}

		// Check if there are any DesignUnit selections
		const designUnits = selections.filter(s => s.type === 'DesignUnit');
		let finalMessage = userMessage;
		let displayMessage = userMessage; // Message to display in chat history

		// Convert DesignUnit selections to edit prompt
		if (designUnits.length > 0) {
			const designUnit = designUnits[0]; // Take the first one (should only be one)
			if (designUnit.type === 'DesignUnit') {
				// Full message with code for LLM
				const editPrompt = `[EDIT_DESIGN:${designUnit.designId}]
请帮我修改这个UI设计："${designUnit.designTitle}"

当前的HTML代码：
\`\`\`html
${designUnit.html}
\`\`\`

当前的CSS代码：
\`\`\`css
${designUnit.css}
\`\`\`

${userMessage || '请说明你想要进行什么修改：'}`;
				finalMessage = editPrompt;

				// Simple message to display in chat (no code)
				displayMessage = userMessage || '请帮我修改这个UI设计';
			}
		}

		// Process requirement documents in designer mode
		if (chatMode === 'designer' && selections.length > 0) {
			const documentFiles = selections.filter(s =>
				s.type === 'File' &&
				s.uri &&
				/\.(md|markdown|doc|docx|txt)$/i.test(s.uri.fsPath)
			);

			if (documentFiles.length > 0) {

				// Read all document contents
				const documentContents: string[] = [];
				for (const docFile of documentFiles) {
					if (docFile.type === 'File' && docFile.uri) {
						try {
							const content = await fileService.readFile(docFile.uri);
							const textContent = content.value.toString();
							const fileName = docFile.uri.path.split('/').pop() || 'document';
							documentContents.push(`### 需求文档：《${fileName}》\n\n${textContent}`);
						} catch (error) {
									}
					}
				}

				// Build comprehensive prompt with document contents
				if (documentContents.length > 0) {
					const requirementPrompt = `${documentContents.join('\n\n---\n\n')}

${userMessage ? `\n用户补充需求：${userMessage}\n` : ''}

---

# 任务说明

你是一位资深的产品架构师和UI/UX设计专家，拥有10年以上的产品设计经验。请对上述需求文档进行**全面、系统、深度**的需求分析，并设计一个**完整的、专业级的**前端系统。

## 第一阶段：深度需求分析

### 1.1 业务架构分析
- **核心业务价值**：明确产品的核心价值主张和商业目标
- **业务流程梳理**：绘制完整的业务流程图，识别关键路径和分支场景
- **用户角色定义**：
  - 识别所有用户角色（管理员、普通用户、访客等）
  - 定义每个角色的权限和可访问功能
  - 分析角色之间的交互关系
- **使用场景分析**：
  - 主要使用场景（高频场景）
  - 次要使用场景（低频但重要）
  - 异常场景和边界情况

### 1.2 功能架构设计
- **功能模块划分**：按业务领域划分功能模块
- **功能优先级**：P0（核心）、P1（重要）、P2（增强）
- **功能依赖关系**：识别模块间的依赖和调用关系
- **数据流分析**：梳理数据的产生、流转、存储和展示

### 1.3 信息架构设计
- **导航结构**：设计清晰的信息层级和导航体系
- **页面层级**：一级页面、二级页面、弹窗/抽屉等
- **页面关系图**：绘制完整的页面跳转关系

## 第二阶段：完整UI系统设计

### 2.1 必须设计的核心页面（不可遗漏）

#### 用户认证与权限
1. **登录页** - 支持多种登录方式（账号密码、手机验证码、第三方登录）
2. **注册页** - 完整的注册流程和表单验证
3. **忘记密码页** - 密码找回流程
4. **个人中心/用户设置页** - 个人信息、账号安全、偏好设置

#### 主要功能页面
5. **首页/Dashboard** - 数据概览、快捷入口、关键指标
6. **列表页** - 数据列表展示、筛选、排序、分页
7. **详情页** - 单条数据的完整信息展示
8. **创建/编辑页** - 表单录入和编辑
9. **搜索结果页** - 全局搜索和结果展示

#### 系统管理（如适用）
10. **系统设置页** - 系统级配置
11. **权限管理页** - 角色和权限配置
12. **数据统计/报表页** - 数据分析和可视化

#### 辅助页面
13. **404错误页** - 页面不存在提示
14. **500错误页** - 服务器错误提示
15. **无权限页** - 权限不足提示
16. **空状态页** - 无数据时的引导页
17. **加载中页面** - 首次加载或数据加载状态
18. **引导页/欢迎页** - 首次使用引导

### 2.2 根据需求文档补充的业务页面
- 仔细阅读需求文档，识别所有明确提到的功能
- 为每个功能设计对应的页面
- **重要**：不要遗漏任何需求文档中提到的功能

### 2.3 专业系统必备的增强页面
即使需求文档未明确提到，也应该包含：
- **通知中心** - 系统消息、提醒、公告
- **帮助中心** - 使用帮助、FAQ、文档
- **反馈页** - 用户反馈和建议收集
- **关于页** - 产品介绍、版本信息、团队信息
- **隐私政策/用户协议** - 法律合规页面

### 2.4 UI设计原则与规范

#### 设计系统
- **设计语言**：采用现代扁平化设计，参考Material Design、Ant Design、Element Plus等成熟设计系统
- **色彩系统**：
  - 主色（品牌色）
  - 辅助色（成功、警告、错误、信息）
  - 中性色（文字、边框、背景）
- **字体系统**：标题、正文、辅助文字的字号和字重
- **间距系统**：统一的间距规范（4px、8px、16px、24px等）
- **圆角规范**：统一的圆角大小
- **阴影系统**：不同层级的阴影效果

#### 组件规范
- **按钮**：主要按钮、次要按钮、文字按钮、图标按钮
- **表单**：输入框、下拉框、单选、多选、日期选择、上传等
- **导航**：顶部导航、侧边导航、面包屑、标签页
- **反馈**：消息提示、对话框、抽屉、加载状态
- **数据展示**：表格、卡片、列表、时间轴、统计图表

#### 交互设计
- **响应式设计**：适配桌面、平板、手机
- **加载状态**：骨架屏、加载动画、进度条
- **空状态**：无数据时的友好提示和引导
- **错误处理**：表单验证、错误提示、异常处理
- **微交互**：hover效果、点击反馈、过渡动画

#### UX最佳实践
- **用户引导**：首次使用引导、功能提示
- **快捷操作**：快捷键、批量操作、拖拽排序
- **搜索优化**：智能搜索、搜索建议、历史记录
- **无障碍设计**：键盘导航、屏幕阅读器支持
- **性能优化**：懒加载、虚拟滚动、图片优化

## 第三阶段：页面设计实现

### 3.1 设计输出要求
为**每一个页面**生成：
1. **页面说明**：页面用途、使用场景、目标用户
2. **功能清单**：该页面包含的所有功能点
3. **布局结构**：页面的整体布局和区域划分
4. **完整的HTML代码**：
   - 语义化标签
   - 清晰的结构层次
   - 必要的data属性和id
5. **完整的CSS代码**：
   - 现代CSS特性（Flexbox、Grid、CSS变量）
   - 响应式设计（媒体查询）
   - 流畅的过渡动画
   - 统一的设计规范

### 3.2 代码质量要求
- **可维护性**：清晰的命名、合理的结构、充分的注释
- **可扩展性**：组件化思维、样式复用、变量管理
- **浏览器兼容**：支持主流现代浏览器
- **性能优化**：CSS优化、避免重绘重排

### 3.3 设计一致性
- 所有页面使用统一的设计语言
- 相同功能使用相同的交互模式
- 保持视觉风格的一致性

---

## 执行要求

1. **完整性检查**：确保所有必需页面都已设计，不遗漏任何功能
2. **专业性保证**：采用业界最佳实践和成熟的设计模式
3. **细节打磨**：注重细节，包括边界情况、异常状态、空状态等
4. **用户体验**：始终从用户角度思考，提供流畅、直观的使用体验

现在，请开始进行全面的需求分析和完整的UI系统设计。为每个页面生成对应的HTML和CSS代码，确保不遗漏任何页面。`;

					finalMessage = requirementPrompt;
					displayMessage = userMessage || '请根据需求文档进行完整的UI系统设计';
				}
			}
		}

		// 优化：使用 startTransition 将历史记录保存标记为非紧急更新
		// Save to history before sending (只保留URL，清除base64Data节省内存)
		if (userMessage.trim() || selections.length > 0 || uploadedImages.length > 0) {
			const cleanedImages = uploadedImages.map(img => {
				if (img.uploadedUrl && img.uploadStatus === 'uploaded') {
					const { base64Data, ...rest } = img;
					return rest;
				}
				return img;
			});
			const historyEntry: InputHistoryEntry = {
				text: userMessage,
				selections: [...selections],
				images: cleanedImages
			};
			// 使用 startTransition 降低历史记录更新的优先级
			startTransition(() => {
			setInputHistory(prev => [historyEntry, ...prev]); // Add to beginning of history
			});
		}

		try {
			await chatThreadsService.addUserMessageAndStreamResponse({
				userMessage: finalMessage,
				displayMessage: displayMessage,
				threadId,
				_chatSelections: selections.length > 0 ? selections : undefined,
				images: uploadedImages.length > 0 ? uploadedImages : undefined
			})

			// 清空输入框和上传的图片
			if (textAreaRef.current) {
				textAreaRef.current.value = '';
			}

			// 清空线程状态中的上传图片
			if (uploadedImages.length > 0) {
				chatThreadsService.setCurrentThreadState({ uploadedImages: [] });
			}

		} catch (e) {
		}

		setSelections([]) // clear staging

		// 清除上传的图片
		if (uploadedImages.length > 0) {
			chatThreadsService.setCurrentThreadState({
				uploadedImages: []
			});
		}

		// Mark as programmatic update when clearing
		isProgrammaticUpdate.current = true;
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus() // focus input after submit

		// Reset history navigation
		setHistoryIndex(-1);
		setCurrentDraft({ text: '', selections: [], images: [] });

		// Reset flag after clearing
		setTimeout(() => {
			isProgrammaticUpdate.current = false;
		}, 0);

	}, [chatThreadsService, isDisabled, isRunning, textAreaRef, textAreaFnsRef, setSelections, settingsState, selections, chatMode, fileService])

	const onAbort = async () => {
		// 用户手动取消/中断会话，禁止自动继续功能，等待下一次用户主动发起对话
		allowAutoContinueRef.current = false;

		// 清除可能存在的自动继续timeout
		if (autoContinueTimeoutRef.current) {
			clearTimeout(autoContinueTimeoutRef.current);
			autoContinueTimeoutRef.current = null;
		}

		// 重置自动继续相关状态
		continuationInFlightRef.current = false;
		continuationSentAtRef.current = 0;
		continuationCooldownUntilRef.current = 0;

		await chatThreadsService.abortRunning(threadId)
	}

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(SENWEAVER_CTRL_L_ACTION_ID)?.getLabel()

	// threadId is already declared earlier for use in effects
	const currCheckpointIdx = chatThreadsState.allThreads[threadId]?.state?.currCheckpointIdx ?? undefined  // if not exist, treat like checkpoint is last message (infinity)



	// resolve mount info
	const isResolved = chatThreadsState.allThreads[threadId]?.state.mountedInfo?.mountedIsResolvedRef.current
	useEffect(() => {
		if (isResolved) return
		chatThreadsState.allThreads[threadId]?.state.mountedInfo?._whenMountedResolver?.({
			textAreaRef: textAreaRef,
			textAreaFnsRef: textAreaFnsRef,
			scrollToBottom: () => scrollToBottom(scrollContainerRef),
		})

	}, [chatThreadsState, threadId, textAreaRef, textAreaFnsRef, scrollContainerRef, isResolved])




	// Windowed list (keep original indices)
	const visibleStartIdx = Math.max(0, previousMessages.length - renderLimit)
	const visibleMessages = useMemo(() => previousMessages.slice(visibleStartIdx), [previousMessages, visibleStartIdx])

	const loadMoreHistory = useCallback(() => {
		if (visibleStartIdx <= 0) return
		const div = scrollContainerRef.current
		if (div) {
			pendingPrependScrollHeightRef.current = div.scrollHeight
			pendingPrependScrollTopRef.current = div.scrollTop
		}
		setRenderLimit((prev) => Math.min(previousMessages.length, prev + LOAD_MORE_COUNT))
	}, [previousMessages.length, visibleStartIdx])

	// After prepending older messages, keep user's view stable
	useEffect(() => {
		const prevH = pendingPrependScrollHeightRef.current
		const prevTop = pendingPrependScrollTopRef.current
		const div = scrollContainerRef.current
		if (!div || prevH === null || prevTop === null) return
		const newH = div.scrollHeight
		const delta = newH - prevH
		div.scrollTop = prevTop + delta
		pendingPrependScrollHeightRef.current = null
		pendingPrependScrollTopRef.current = null
	}, [renderLimit, visibleStartIdx])

	// Memoize scroll callback to avoid recreating on every render
	const scrollToBottomCallback = useCallback(() => scrollToBottom(scrollContainerRef), [scrollContainerRef])

	// Perf: Separate isRunning into a ref to avoid re-rendering all messages when running state changes
	// The isRunning is only used for visual effects (ghost opacity), not for data
	const isRunningRef = useRef(isRunning)
	isRunningRef.current = isRunning

	const previousMessagesHTML = useMemo(() => {
		// const lastMessageIdx = previousMessages.findLastIndex(v => v.role !== 'checkpoint')
		// tool request shows up as Editing... if in progress
		return visibleMessages.map((message, i) => {
			const messageIdx = visibleStartIdx + i
			return <ChatBubble
				key={messageIdx}
				currCheckpointIdx={currCheckpointIdx}
				chatMessage={message}
				messageIdx={messageIdx}
				isCommitted={true}
				chatIsRunning={isRunning}
				threadId={threadId}
				anyThreadRunning={anyThreadRunning}
				_scrollToBottom={scrollToBottomCallback}
				onOpenPreview={handleOpenPreview}
				globalTaskProgress={currentTaskProgress}
				designHistoryLength={designHistory.length}
			/>
		})
	// Perf: Remove frequently-changing dependencies that don't affect committed message content
	// isRunning is kept because it affects checkpoint ghost styling
	}, [visibleMessages, visibleStartIdx, threadId, currCheckpointIdx, isRunning, handleOpenPreview, currentTaskProgress, designHistory.length, anyThreadRunning, scrollToBottomCallback])

	// IMPORTANT: keep messageIdx consistent with full thread history
	const streamingChatIdx = previousMessages.length
	const currStreamingMessageHTML = reasoningSoFar || displayContentSoFar || isRunning ?
		<ChatBubble
			key={'curr-streaming-msg'}
			currCheckpointIdx={currCheckpointIdx}
			chatMessage={{
				role: 'assistant',
				displayContent: displayContentSoFar ?? '',
				reasoning: reasoningSoFar ?? '',
				anthropicReasoning: null,
			}}
			messageIdx={streamingChatIdx}
			isCommitted={false}
			globalTaskProgress={currentTaskProgress}
			designHistoryLength={designHistory.length}
			chatIsRunning={isRunning}
			anyThreadRunning={anyThreadRunning}

			threadId={threadId}
			_scrollToBottom={null}
			onOpenPreview={handleOpenPreview}
		/> : null


	// the tool currently being generated
	// 对于 edit_file 和 rewrite_file，不显示流式生成效果，直接等待完成后显示结果
	const generatingTool = toolIsGenerating ?
		// 文件编辑工具不显示流式效果，等待完成后直接显示结果
		(toolCallSoFar.name === 'edit_file' || toolCallSoFar.name === 'rewrite_file') ? null
			: null
		: null

	const messagesHTML = <ScrollToBottomContainer
		key={'messages' + chatThreadsState.currentThreadId} // force rerender on all children if id changes
		scrollContainerRef={scrollContainerRef}
		onReachTop={loadMoreHistory}
		className={
`
			flex flex-col
			px-4 py-4 space-y-4
			w-full h-full
			overflow-x-hidden
			overflow-y-auto
			${previousMessagesHTML.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`}
	>
		{/* previous messages */}
		{previousMessagesHTML}
		{currStreamingMessageHTML}

		{/* Generating tool */}
		{generatingTool}

		{/* loading indicator - 统一处理，避免重复显示 */}
		{(() => {
			// 文件编辑工具执行时显示带说明的加载指示器
			if (toolIsGenerating && (toolCallSoFar.name === 'edit_file' || toolCallSoFar.name === 'rewrite_file')) {
				return <ProseWrapper>
					<IconLoading className='opacity-50 text-sm' text='Editing file' />
				</ProseWrapper>
			}
			// LLM思考或生成时显示带说明的加载指示器
			if (isRunning === 'LLM' || (isRunning === 'idle' && !toolIsGenerating)) {
				return <ProseWrapper>
					<IconLoading className='opacity-50 text-sm' text='Thinking' />
				</ProseWrapper>
			}
			// 其他工具执行时显示带说明的加载指示器
			if (toolIsGenerating && toolCallSoFar.name) {
				const toolName = toolCallSoFar.name
				const toolNameMap: Record<string, string> = {
					'read_file': 'Reading file',
					'ls_dir': 'Listing directory',
					'get_dir_tree': 'Getting directory tree',
					'search_pathnames_only': 'Searching filenames',
					'search_for_files': 'Searching files',
					'search_in_file': 'Searching in file',
					'create_file_or_folder': 'Creating',
					'delete_file_or_folder': 'Deleting',
					'run_command': 'Running command',
					'run_persistent_command': 'Running command',
					'open_persistent_terminal': 'Opening terminal',
					'kill_persistent_terminal': 'Closing terminal',
					'read_lint_errors': 'Reading lint errors',
					'open_browser': 'Opening browser',
					'fetch_url': 'Fetching URL',
					'web_search': 'Searching web',
					'analyze_image': 'Analyzing image',
					'screenshot_to_code': 'Generating code',
					'api_request': 'Sending API request',
					'read_document': 'Reading document',
					'edit_document': 'Editing document',
					'create_document': 'Creating document',
					'pdf_operation': 'Processing PDF',
					'document_convert': 'Converting document',
					'document_merge': 'Merging documents',
					'document_extract': 'Extracting content',
				}
				const loadingText = toolNameMap[toolName] || 'Processing'
				return <ProseWrapper>
					<IconLoading className='opacity-50 text-sm' text={loadingText} />
				</ProseWrapper>
			}
			return null
		})()}


		{/* error message */}
		{latestError === undefined ? null :
			<div className='px-2 my-1'>
				<ErrorDisplay
					message={latestError.message}
					fullError={latestError.fullError}
					onDismiss={() => { chatThreadsService.dismissStreamError(currentThread.id) }}
					showDismiss={true}
				/>

				<WarningBox className='text-sm my-2 mx-4' onClick={() => { commandService.executeCommand(SENWEAVER_OPEN_SETTINGS_ACTION_ID) }} text='Open settings' />
			</div>
		}
	</ScrollToBottomContainer>


	const onChangeText = useCallback((newStr: string) => {
		setInstructionsAreEmpty(!newStr.trim())
		// Reset history navigation when user types (but not when we programmatically update)
		if (!isProgrammaticUpdate.current && historyIndex !== -1) {
			setHistoryIndex(-1);
		}
	}, [historyIndex])

	const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		const textarea = e.currentTarget;
		const cursorAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
		const cursorAtEnd = textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length;

		// Handle ArrowUp: Navigate to older history (no cursor position restriction)
		if (e.key === 'ArrowUp') {
			// Only proceed if we have history
			if (inputHistory.length === 0) {
				return; // No history to navigate, allow default behavior
			}

			// Calculate what the next index would be
			const nextIndex = historyIndex === -1 ? 0 : historyIndex + 1;

			// Check if we would go beyond the oldest entry
			if (nextIndex >= inputHistory.length) {
				e.preventDefault();
				return; // Already at the oldest entry, do nothing
			}

			e.preventDefault();

			// Save current draft when first navigating to history
			if (historyIndex === -1) {
				const currentThread = chatThreadsService.getCurrentThread();
				const uploadedImages = currentThread.state.uploadedImages || [];
				setCurrentDraft({
					text: textarea.value,
					selections: [...selections],
					images: [...uploadedImages]
				});
			}

			// Navigate to the older history entry
			setHistoryIndex(nextIndex);

			const entry = inputHistory[nextIndex];
			if (entry) {
				// Mark as programmatic update
				isProgrammaticUpdate.current = true;

				// Restore text
				textarea.value = entry.text;
				textAreaFnsRef.current?.setValue(entry.text);

				// Set cursor to end
				const textLength = entry.text.length;
				textarea.setSelectionRange(textLength, textLength);

				// Restore selections
				setSelections(entry.selections);

				// Restore images
				chatThreadsService.setCurrentThreadState({ uploadedImages: entry.images });

				setInstructionsAreEmpty(!entry.text.trim());

				// Reset flag after a short delay to ensure onChange has fired
				setTimeout(() => {
					isProgrammaticUpdate.current = false;
				}, 0);
			}
		}
		// Handle ArrowDown: Navigate to newer history or back to current input (no cursor position restriction)
		else if (e.key === 'ArrowDown') {
			// Only handle if we're in history mode
			if (historyIndex === -1) {
				return; // Already at current input, allow default behavior
			}

			e.preventDefault();

			// Calculate what the next index would be
			const nextIndex = historyIndex - 1;

			// Mark as programmatic update
			isProgrammaticUpdate.current = true;

			if (nextIndex < 0) {
				// Return to the current draft
				textarea.value = currentDraft.text;
				textAreaFnsRef.current?.setValue(currentDraft.text);

				// Set cursor to end so next ArrowDown will work immediately
				const textLength = currentDraft.text.length;
				textarea.setSelectionRange(textLength, textLength);

				setSelections(currentDraft.selections);
				chatThreadsService.setCurrentThreadState({ uploadedImages: currentDraft.images });
				setInstructionsAreEmpty(!currentDraft.text.trim());
				setHistoryIndex(-1);
			} else {
				// Navigate to newer history entry
				setHistoryIndex(nextIndex);

				const entry = inputHistory[nextIndex];
				if (entry) {
					textarea.value = entry.text;
					textAreaFnsRef.current?.setValue(entry.text);

					// Set cursor to end so next ArrowDown will work immediately
					const textLength = entry.text.length;
					textarea.setSelectionRange(textLength, textLength);

					setSelections(entry.selections);
					chatThreadsService.setCurrentThreadState({ uploadedImages: entry.images });
					setInstructionsAreEmpty(!entry.text.trim());
				}
			}

			// Reset flag after a short delay to ensure onChange has fired
			setTimeout(() => {
				isProgrammaticUpdate.current = false;
			}, 0);
		}
		else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			onSubmit()
		} else if (e.key === 'Escape' && isRunning) {
			onAbort()
		}
	}, [onSubmit, onAbort, isRunning, inputHistory, historyIndex, selections, currentDraft, chatThreadsService, textAreaFnsRef, setSelections, setInstructionsAreEmpty])

	const inputChatArea = <SenweaverChatArea
		featureName='Chat'
		onSubmit={() => onSubmit()}
		onAbort={onAbort}
		isStreaming={!!isRunning}
		isDisabled={isDisabled}
		showSelections={true}
		// showProspectiveSelections={previousMessagesHTML.length === 0}
		selections={selections}
		setSelections={setSelections}
		onClickAnywhere={() => { textAreaRef.current?.focus() }}
	>
		<SenweaverInputBox2
			enableAtToMention
			enableImageUpload={enableImageInput}
			className={`min-h-[81px] px-0.5 py-0.5`}
			placeholder={`您正在与SenWeaver对话，请输入您的指令...`}
			onChangeText={onChangeText}
			onKeyDown={onKeyDown}
			onFocus={() => {
				chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)

				// Auto-add current file when input box gets focus
				// Conditions:
				// 1. Input is empty (no text, files, or images)
				// 2. AI is not running
				// 3. Haven't auto-added files in this conversation round yet
				const currentText = textAreaRef.current?.value || ''
				const currentThread = chatThreadsService.getCurrentThread()
				const currentSelections = currentThread?.state.stagingSelections || []
				const currentImages = currentThread?.state.uploadedImages || []
				const hasAutoAddedThisRound = currentThread?.state.hasAutoAddedFilesThisRound || false

				// Check if input is completely empty and AI is not running
				const isInputEmpty = !currentText.trim() && currentSelections.length === 0 && currentImages.length === 0
				const isAINotRunning = !isRunning

				if (isInputEmpty && isAINotRunning && !hasAutoAddedThisRound) {
					// Call the service method to get current file
					const currentFile = (chatThreadsService as any)._getCurrentFile?.()
					if (currentFile) {
						// Add the current file
						chatThreadsService.addNewStagingSelection(currentFile)
						// Mark that we've auto-added files in this round
						chatThreadsService.markFilesAutoAddedThisRound()
					}
				} else if (hasAutoAddedThisRound) {

				}
			}}
			onImageUpload={async (images) => {
				// 将上传的图片设置到当前线程的状态中
				const currentThread = chatThreadsService.getCurrentThread();
				if (currentThread) {
					// 如果是新上传的图片，添加到现有图片中；如果是删除操作，直接设置
					const existingImages = currentThread.state.uploadedImages || [];
					const isDeleteOperation = images.length < existingImages.length;

					if (isDeleteOperation) {
						// 删除操作，直接设置
						chatThreadsService.setCurrentThreadState({
							uploadedImages: images
						});
					} else {
						// 新增图片操作
						// 找出需要上传的新图片（状态为pending的图片）
						const newImages = images.filter(img => img.uploadStatus === 'pending' || !img.uploadStatus);

						// 先添加到状态中
						chatThreadsService.setCurrentThreadState({
							uploadedImages: [...existingImages, ...images]
						});

						// 如果有需要上传的新图片，触发上传
						if (newImages.length > 0) {
							try {
								const { uploadImagesWithProgress } = await import('../util/imageUtils.js');
								uploadImagesWithProgress(newImages, (updatedImages) => {
									// 更新上传状态
									const thread = chatThreadsService.getCurrentThread();
									if (thread) {
										const existing = thread.state.uploadedImages || [];
										// 替换正在上传的图片为更新后的状态
										const merged = existing.map(img => {
											const updated = updatedImages.find(u => u.id === img.id);
											return updated || img;
										});
										chatThreadsService.setCurrentThreadState({
											uploadedImages: merged
										});
									}
								});
							} catch (error) {
								console.error('Error uploading images:', error);
							}
						}
					}
				}
			}}
			ref={textAreaRef}
			fnsRef={textAreaFnsRef}
			multiline={true}
		/>

	</SenweaverChatArea>


	const isLandingPage = previousMessages.length === 0


	const initiallySuggestedPromptsHTML = <div className='flex flex-col gap-2 w-full text-nowrap text-senweaver-fg-3 select-none'>
		{[
			'Summarize my codebase',
			'How do types work in Rust?',
			'Create a .SenweaverRules file for me'
		].map((text, index) => (
			<div
				key={index}
				className='py-1 px-2 rounded text-sm bg-zinc-700/5 hover:bg-zinc-700/10 dark:bg-zinc-300/5 dark:hover:bg-zinc-300/10 cursor-pointer opacity-80 hover:opacity-100'
				onClick={() => onSubmit(text)}
			>
				{text}
			</div>
		))}
	</div>



	const threadPageInput = <div key={'input' + chatThreadsState.currentThreadId}>
		<div className='px-4'>
			<CommandBarInChat />
		</div>
		<div className='px-2 pb-2'>
			{inputChatArea}
		</div>
	</div>

	const landingPageInput = <div>
		<div className='pt-8'>
			{inputChatArea}
		</div>
	</div>

	const landingPageContent = <div
		ref={sidebarRef}
		className='w-full h-full max-h-full flex flex-col overflow-auto px-4'
	>
		<ErrorBoundary>
			{landingPageInput}
		</ErrorBoundary>

		{Object.keys(chatThreadsState.allThreads).length > 1 ? // show if there are threads
			<ErrorBoundary>
				<div className='pt-8 mb-2 text-senweaver-fg-3 text-root select-none pointer-events-none'>历史会话</div>
				<PastThreadsList />
			</ErrorBoundary>
			:
			<ErrorBoundary>
				<div className='pt-8 mb-2 text-senweaver-fg-3 text-root select-none pointer-events-none'>建议</div>
				{initiallySuggestedPromptsHTML}
			</ErrorBoundary>
		}
	</div>


	// const threadPageContent = <div>
	// 	{/* Thread content */}
	// 	<div className='flex flex-col overflow-hidden'>
	// 		<div className={`overflow-hidden ${previousMessages.length === 0 ? 'h-0 max-h-0 pb-2' : ''}`}>
	// 			<ErrorBoundary>
	// 				{messagesHTML}
	// 			</ErrorBoundary>
	// 		</div>
	// 		<ErrorBoundary>
	// 			{inputForm}
	// 		</ErrorBoundary>
	// 	</div>
	// </div>
	const threadPageContent = <div
		ref={sidebarRef}
		className='w-full h-full flex flex-col overflow-hidden'
	>

		<ErrorBoundary>
			{messagesHTML}
		</ErrorBoundary>
		<ErrorBoundary>
			{threadPageInput}
		</ErrorBoundary>
	</div>


	// Debug: Log render state

	return (
		<Fragment key={threadId}>
			{isLandingPage ?
				landingPageContent
				: threadPageContent}
		</Fragment>
	)
}
