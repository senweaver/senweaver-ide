/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { InlineCompletion, } from '../../../../editor/common/languages.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { extractCodeFromRegular } from '../common/helpers/extractCodeFromResult.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { isWindows } from '../../../../base/common/platform.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { FeatureName } from '../common/senweaverSettingsTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { getModelCapabilities } from '../common/modelCapabilities.js';
import { IEditPredictionService } from './editPredictionService.js';
import { EditPredictionTrigger, DiagnosticInfo } from '../common/editPredictionTypes.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
// import { IContextGatheringService } from './contextGatheringService.js';



const allLinebreakSymbols = ['\r\n', '\n']
const _ln = isWindows ? allLinebreakSymbols[0] : allLinebreakSymbols[1]

// The extension this was called from is here - https://github.com/SenweaverEditor/void/blob/autocomplete/extensions/void/src/extension/extension.ts


/*
A summary of autotab:

Postprocessing
-one common problem for all models is outputting unbalanced parentheses
we solve this by trimming all extra closing parentheses from the generated string
in future, should make sure parentheses are always balanced

-another problem is completing the middle of a string, eg. "const [x, CURSOR] = useState()"
we complete up to first matchup character
but should instead complete the whole line / block (difficult because of parenthesis accuracy)

-too much info is bad. usually we want to show the user 1 line, and have a preloaded response afterwards
this should happen automatically with caching system
should break preloaded responses into \n\n chunks

Preprocessing
- we don't generate if cursor is at end / beginning of a line (no spaces)
- we generate 1 line if there is text to the right of cursor
- we generate 1 line if variable declaration
- (in many cases want to show 1 line but generate multiple)

State
- cache based on prefix (and do some trimming first)
- when press tab on one line, should have an immediate followup response
to do this, show autocompletes before they're fully finished
- [todo] remove each autotab when accepted
!- [todo] provide type information

Details
-generated results are trimmed up to 1 leading/trailing space
-prefixes are cached up to 1 trailing newline
-
*/

class LRUCache<K, V> {
	public items: Map<K, V>;
	private keyOrder: K[];
	private maxSize: number;
	private disposeCallback?: (value: V, key?: K) => void;

	constructor(maxSize: number, disposeCallback?: (value: V, key?: K) => void) {
		if (maxSize <= 0) throw new Error('Cache size must be greater than 0');

		this.items = new Map();
		this.keyOrder = [];
		this.maxSize = maxSize;
		this.disposeCallback = disposeCallback;
	}

	set(key: K, value: V): void {
		// If key exists, remove it from the order list
		if (this.items.has(key)) {
			this.keyOrder = this.keyOrder.filter(k => k !== key);
		}
		// If cache is full, remove least recently used item
		else if (this.items.size >= this.maxSize) {
			const key = this.keyOrder[0];
			const value = this.items.get(key);

			// Call dispose callback if it exists
			if (this.disposeCallback && value !== undefined) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder.shift();
		}

		// Add new item
		this.items.set(key, value);
		this.keyOrder.push(key);
	}

	delete(key: K): boolean {
		const value = this.items.get(key);

		if (value !== undefined) {
			// Call dispose callback if it exists
			if (this.disposeCallback) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder = this.keyOrder.filter(k => k !== key);
			return true;
		}

		return false;
	}

	clear(): void {
		// Call dispose callback for all items if it exists
		if (this.disposeCallback) {
			for (const [key, value] of this.items.entries()) {
				this.disposeCallback(value, key);
			}
		}

		this.items.clear();
		this.keyOrder = [];
	}

	get size(): number {
		return this.items.size;
	}

	has(key: K): boolean {
		return this.items.has(key);
	}
}

type AutocompletionPredictionType =
	| 'single-line-fill-middle'
	| 'single-line-redo-suffix'
	// | 'multi-line-start-here'
	| 'multi-line-start-on-next-line'
	| 'do-not-predict'

type Autocompletion = {
	id: number,
	prefix: string,
	suffix: string,
	llmPrefix: string,
	llmSuffix: string,
	startTime: number,
	endTime: number | undefined,
	status: 'pending' | 'finished' | 'error',
	type: AutocompletionPredictionType,
	llmPromise: Promise<string> | undefined,
	insertText: string,
	requestId: string | null,
	_newlineCount: number,
}

// 🔥 优化性能参数
const CURSOR_MOVE_DEBOUNCE = 300  // 🔥 光标移动防抖时间（300ms，平衡响应速度和请求频率）
const ERROR_COOLDOWN_TIME = 3000  // 🔥 错误后冷却时间，避免频繁触发防火墙
const ENABLE_MULTI_LOCATION_PREDICTION = true  // 启用多位置编辑预测

// postprocesses the result
const processStartAndEndSpaces = (result: string) => {

	// trim all whitespace except for a single leading/trailing space
	// return result.trim()

	let hasSpace = true
	// if first characters are only \n or \r\n, remove the first one
	if (result.startsWith('\r\n')) result = result.slice(2)
	else if (result.startsWith('\n')) result = result.slice(1)
	else hasSpace = false

	return (hasSpace ? _ln : '') + result
}

// 🔥 移除与前缀和后缀重复的代码 - 参考 GitHub Copilot 的策略
// GitHub Copilot 的去重逻辑：
// 1. 从头部移除与 prefix 末尾重复的部分（common prefix removal）
// 2. 从尾部移除与 suffix 开头重复的部分（common suffix removal）
// 3. 逐行比较，而不是逐字符，避免破坏代码结构
const removeDuplicateWithPrefixAndSuffix = (insertText: string, prefix: string, suffix: string): string => {
	// 快速检查：如果补全为空，直接返回
	const normalizedInsert = insertText.trim()
	if (!normalizedInsert) {
		return insertText
	}


	// 按行分割补全、前缀、后缀
	let insertLines = normalizedInsert.split(/\r?\n/)
	const prefixLines = prefix.split(/\r?\n/)
	const suffixLines = suffix.split(/\r?\n/)


	// 🔥 策略0: 检查代码块是否完整存在于 prefix 中（最重要）
	// 高性能：只检查前 3 行，减少计算量
	if (insertLines.length >= 3) {
		// 🔥 扩大检查范围到 200 行，确保能检测到较远位置的重复代码
		const prefixCheckRange = prefixLines.slice(-Math.min(200, prefixLines.length))

		// 取前 4 行非空代码作为特征（更准确的检测）
		const nonEmptyLines = []
		for (let i = 0; i < insertLines.length && nonEmptyLines.length < 4; i++) {
			const trimmed = insertLines[i].trim()
			if (trimmed.length > 0) {
				nonEmptyLines.push(trimmed)
			}
		}

		// 检查至少 3 行（允许 3-4 行）
		if (nonEmptyLines.length >= 3) {
			const patternLength = nonEmptyLines.length
			const pattern = nonEmptyLines

			// 在 prefix 中查找这个连续模式
			for (let i = 0; i <= prefixCheckRange.length - patternLength; i++) {
				let matchCount = 0

				// 检查连续几行是否匹配
				for (let j = 0; j < patternLength; j++) {
					if (i + j < prefixCheckRange.length && prefixCheckRange[i + j].trim() === pattern[j]) {
						matchCount++
					}
				}

				// 全部匹配，认为是重复代码块
				if (matchCount === patternLength) {

					return ''
				}
			}
		}
	}

	// 🔥 额外策略：检查完整补全文本是否作为子串存在于 prefix 中
	// 这能捕获更多边缘情况
	if (normalizedInsert.length > 20) {  // 至少20个字符才检查
		const prefixText = prefix.trim()
		const completionText = normalizedInsert.trim()

		// 检查补全是否完整存在于 prefix 中（允许一些空白差异）
		const normalizedPrefix = prefixText.replace(/\s+/g, ' ')
		const normalizedCompletion = completionText.replace(/\s+/g, ' ')

		if (normalizedPrefix.includes(normalizedCompletion)) {
			return ''
		}
	}

	// 🔥 策略2: 移除前缀重复（紧邻光标的行）
	// 从补全开头移除与 prefix 末尾紧邻的重复行
	const prefixLastLines = prefixLines.slice(-10)  // 只检查最后10行
	let skipFromStart = 0

	// 从补全的开头开始，找连续匹配的行
	for (let i = 0; i < Math.min(insertLines.length, prefixLastLines.length); i++) {
		const insertLine = insertLines[i].trim()
		if (insertLine.length === 0) {
			// 跳过空行
			skipFromStart++
			continue
		}

		// 检查这行是否在 prefix 末尾出现
		let found = false
		for (let j = prefixLastLines.length - 1; j >= 0; j--) {
			if (prefixLastLines[j].trim() === insertLine) {
				found = true
				break
			}
		}

		if (found) {
			skipFromStart = i + 1
		} else {
			// 遇到不匹配的行，停止
			break
		}
	}

	if (skipFromStart > 0) {
		insertLines = insertLines.slice(skipFromStart)
	}

	if (insertLines.length === 0 || insertLines.every(l => l.trim().length === 0)) {
		return ''
	}

	// 🔥 策略3: 移除后缀重复（GitHub Copilot 风格）
	// 从补全末尾移除与 suffix 开头重复的连续行
	const suffixFirstLines = suffixLines.slice(0, 20)  // 只检查前20行
	let skipFromEnd = 0

	// 从补全的末尾开始，找连续匹配的行
	for (let i = insertLines.length - 1; i >= 0; i--) {
		const insertLine = insertLines[i].trim()
		if (insertLine.length === 0) {
			// 跳过空行
			skipFromEnd++
			continue
		}

		// 检查这行是否在 suffix 开头出现
		let found = false
		for (let j = 0; j < suffixFirstLines.length; j++) {
			if (suffixFirstLines[j].trim() === insertLine) {
				found = true
				break
			}
		}

		if (found) {
			skipFromEnd++
		} else {
			// 遇到不匹配的行，停止
			break
		}
	}

	if (skipFromEnd > 0) {
		insertLines = insertLines.slice(0, insertLines.length - skipFromEnd)

	}

	if (insertLines.length === 0 || insertLines.every(l => l.trim().length === 0)) {

		return ''
	}

	// 最终检查
	if (insertLines.length === 0) {

		return ''
	}

	// 🔥 策略4: 最终安全检查 - 确保没有完全重复的内容
	// 检查补全是否完全存在于 prefix 或 suffix 中
	const completionText = insertLines.join('\n').trim()
	if (completionText.length > 0) {
		// 检查是否完全存在于 prefix 的末尾
		if (prefix.trim().endsWith(completionText)) {
			return ''
		}
		// 检查是否完全存在于 suffix 的开头
		if (suffix.trim().startsWith(completionText)) {
			return ''
		}
	}

	const result = insertLines.join('\n')
	return result
}

// trims the end of the prefix to improve cache hit rate
const removeLeftTabsAndTrimEnds = (s: string): string => {
	const trimmedString = s.trimEnd();
	const trailingEnd = s.slice(trimmedString.length);

	// keep only a single trailing newline
	if (trailingEnd.includes(_ln)) {
		s = trimmedString + _ln;
	}

	s = s.replace(/^\s+/gm, ''); // remove left tabs

	return s;
}



const removeAllWhitespace = (str: string): string => str.replace(/\s+/g, '');

type PrefixAndSuffixInfo = { prefix: string, suffix: string, prefixLines: string[], suffixLines: string[], prefixToTheLeftOfCursor: string, suffixToTheRightOfCursor: string }
const getPrefixAndSuffixInfo = (model: ITextModel, position: Position): PrefixAndSuffixInfo => {
	const fullText = model.getValue();
	const cursorOffset = model.getOffsetAt(position)
	const prefix = fullText.substring(0, cursorOffset)
	const suffix = fullText.substring(cursorOffset)

	const prefixLines = prefix.split(/\r\n|\n|\r/)
	const suffixLines = suffix.split(/\r\n|\n|\r/)

	const prefixToTheLeftOfCursor = (prefixLines.slice(-1)[0] ?? '').replace(/\r/g, '')
	const suffixToTheRightOfCursor = (suffixLines[0] ?? '').replace(/\r/g, '')

	return { prefix, suffix, prefixLines, suffixLines, prefixToTheLeftOfCursor, suffixToTheRightOfCursor }
}

const getIndex = (str: string, line: number, char: number) => {
	return str.split(_ln).slice(0, line).join(_ln).length + (line > 0 ? 1 : 0) + char;
}
const getLastLine = (s: string): string => {
	const matches = s.match(new RegExp(`[^${_ln}]*$`))
	return matches ? matches[0] : ''
}

type AutocompletionMatchupBounds = {
	startLine: number,
	startCharacter: number,
	startIdx: number,
}
// returns the startIdx of the match if there is a match, or undefined if there is no match
// all results are wrt `autocompletion.result`
const getAutocompletionMatchup = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): AutocompletionMatchupBounds | undefined => {

	const trimmedCurrentPrefix = removeLeftTabsAndTrimEnds(prefix)
	const trimmedCompletionPrefix = removeLeftTabsAndTrimEnds(autocompletion.prefix)
	const trimmedCompletionMiddle = removeLeftTabsAndTrimEnds(autocompletion.insertText)

	if (trimmedCurrentPrefix.length < trimmedCompletionPrefix.length) {
		return undefined
	}

	if ( // check that completion starts with the prefix
		!(trimmedCompletionPrefix + trimmedCompletionMiddle)
			.startsWith(trimmedCurrentPrefix)
	) {
		return undefined
	}

	// reverse map to find position wrt `autocompletion.result`
	const lineStart =
		trimmedCurrentPrefix.split(_ln).length -
		trimmedCompletionPrefix.split(_ln).length;

	if (lineStart < 0) {
		return undefined;
	}
	const currentPrefixLine = getLastLine(trimmedCurrentPrefix)
	const completionPrefixLine = lineStart === 0 ? getLastLine(trimmedCompletionPrefix) : ''
	const completionMiddleLine = autocompletion.insertText.split(_ln)[lineStart]
	const fullCompletionLine = completionPrefixLine + completionMiddleLine


	const charMatchIdx = fullCompletionLine.indexOf(currentPrefixLine)
	if (charMatchIdx < 0) {
		return undefined
	}

	const character = (charMatchIdx +
		currentPrefixLine.length
		- completionPrefixLine.length
	)

	const startIdx = getIndex(autocompletion.insertText, lineStart, character)

	return {
		startLine: lineStart,
		startCharacter: character,
		startIdx,
	}


}


type CompletionOptions = {
	predictionType: AutocompletionPredictionType,
	shouldGenerate: boolean,
	llmPrefix: string,
	llmSuffix: string,
	stopTokens: string[],
}

const getCompletionOptions = (prefixAndSuffix: PrefixAndSuffixInfo, relevantContext: string, justAcceptedAutocompletion: boolean): CompletionOptions => {

	const { prefix, suffix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor } = prefixAndSuffix

	// 🔥 FIM 关键修复：使用原始的 prefix/suffix，保持精确的光标位置
	// 不要使用 extractSmartContext，因为它会改变分割点，破坏 FIM 的上下文
	// 只对 suffix 进行截断，避免发送过长的上下文

	// 限制 suffix 长度：只保留前 2000 字符（约 50-100 行），避免上下文过长
	const maxSuffixLength = 2000
	const llmSuffix = suffix.length > maxSuffixLength ? suffix.slice(0, maxSuffixLength) : suffix

	// prefix 也可以适当截断，保留最后 4000 字符
	const maxPrefixLength = 4000
	const llmPrefix = prefix.length > maxPrefixLength ? prefix.slice(-maxPrefixLength) : prefix

	const isCurrentLineEmpty = prefixToTheLeftOfCursor.trim().length === 0
	const hasContentAfterCursor = suffixToTheRightOfCursor.trim().length > 0

	let predictionType: AutocompletionPredictionType

	// 优化：空白行也要触发补全
	if (isCurrentLineEmpty) {
		// 空行：使用 start-on-next-line（会添加换行符）
		predictionType = 'multi-line-start-on-next-line'
	} else if (hasContentAfterCursor) {
		// 非空行且有后缀：使用 fill-middle
		predictionType = 'single-line-fill-middle'
	} else {
		// 非空行且无后缀：使用 redo-suffix
		predictionType = 'single-line-redo-suffix'
	}

	const completionOptions: CompletionOptions = {
		predictionType: predictionType,
		shouldGenerate: true,
		llmPrefix: llmPrefix,
		llmSuffix: llmSuffix,
		stopTokens: []  // 无停止条件，允许生成完整代码块
	}

	return completionOptions

}

export interface IAutocompleteService {
	readonly _serviceBrand: undefined;
}

export const IAutocompleteService = createDecorator<IAutocompleteService>('AutocompleteService');

export class AutocompleteService extends Disposable implements IAutocompleteService {

	static readonly ID = 'senweaver.autocompleteService'

	_serviceBrand: undefined;

	private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } = {}

	// 🔥 快速缓存：保存最后一个成功的补全
	private _lastSuccessfulCompletion: {
		docUri: string,
		line: number,
		column: number,
		insertText: string,
		completionId: number
	} | null = null

	// 🔥 冷却时间控制：避免频繁请求导致 403 防火墙拦截
	private _lastErrorTime: number = 0  // 最后一次错误的时间

	// used internally by vscode
	// fires after every keystroke and returns the completion to show
	async _provideInlineCompletionItems(
		model: ITextModel,
		position: Position,
	): Promise<InlineCompletion[]> {
		const isEnabled = this._settingsService.state.globalSettings.enableAutocomplete
		if (!isEnabled) {
			return []
		}

		const docUriStr = model.uri.fsPath
		const prefixAndSuffix = getPrefixAndSuffixInfo(model, position)
		const { prefix } = prefixAndSuffix

		// 快速缓存检查
		if (this._lastSuccessfulCompletion) {
			const last = this._lastSuccessfulCompletion
			if (last.docUri === model.uri.fsPath &&
				last.line === position.lineNumber &&
				position.column >= last.column &&
				last.insertText && last.insertText.trim()) {
				const typedChars = position.column - last.column
				const remainingText = last.insertText.substring(typedChars)
				if (remainingText && remainingText.trim()) {
					return [{
						insertText: remainingText,
						range: {
							startLineNumber: position.lineNumber,
							startColumn: position.column,
							endLineNumber: position.lineNumber,
							endColumn: position.column
						}
					}]
				}
			}
			this._lastSuccessfulCompletion = null
		}

		// 检查文档缓存
		if (this._autocompletionsOfDocument[docUriStr]) {
			for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
				if (autocompletion.status !== 'finished' || !autocompletion.insertText.trim()) {
					continue
				}
				const autocompletionMatchup = getAutocompletionMatchup({ prefix, autocompletion })
				if (autocompletionMatchup !== undefined) {
					const remainingText = autocompletion.insertText.substring(autocompletionMatchup.startIdx)
					if (remainingText && remainingText.trim()) {
						this._lastSuccessfulCompletion = {
							docUri: docUriStr,
							line: position.lineNumber,
							column: position.column,
							insertText: autocompletion.insertText,
							completionId: autocompletion.id
						}
						return [{
							insertText: remainingText,
							range: {
								startLineNumber: position.lineNumber,
								startColumn: position.column,
								endLineNumber: position.lineNumber,
								endColumn: position.column
							}
						}]
					}
				}
			}
		}

		// 同步生成补全
		try {
			const completionResult = await this._generateCompletionSync(model, position, prefix, docUriStr)
			if (completionResult && completionResult.trim()) {
				this._lastSuccessfulCompletion = {
					docUri: docUriStr,
					line: position.lineNumber,
					column: position.column,
					insertText: completionResult,
					completionId: -1
				}
				return [{
					insertText: completionResult,
					range: {
						startLineNumber: position.lineNumber,
						startColumn: position.column,
						endLineNumber: position.lineNumber,
						endColumn: position.column
					}
				}]
			}
		} catch (e) {
			// 补全失败，静默处理
		}
		return []
	}

	// 🔥 触发多位置编辑预测（使用文件变化+5秒抖动机制）
	private _triggerMultiLocationPrediction(
		model: ITextModel,
		position: Position,
		prefixAndSuffix: PrefixAndSuffixInfo,
		trigger: EditPredictionTrigger = 'file_change'
	): void {
		if (!this._editPredictionEnabled) {
			return;
		}

		// 检查AI助手是否在运行，如果在运行则不触发
		if (!this._editPredictionService.canTriggerPrediction()) {
			return;
		}

		const { prefix, suffix, prefixLines, suffixLines } = prefixAndSuffix;
		const currentLine = prefixLines[prefixLines.length - 1] || '';

		// 获取最近编辑历史
		const recentEdits = this._editPredictionService.getState().recentEdits;

		// 🔥 获取当前文件的诊断信息（错误和警告）
		const diagnostics = this._getDiagnosticsForModel(model);

		// 使用onFileChange方法触发预测（内部有5秒抖动）
		this._editPredictionService.onFileChange({
			uri: model.uri,
			position: { line: position.lineNumber, column: position.column },
			trigger,
			context: {
				prefix: prefix.slice(-2000),
				suffix: suffix.slice(0, 2000),
				currentLine,
				surroundingLines: [
					...prefixLines.slice(-5),
					...suffixLines.slice(0, 5),
				],
				recentEdits: recentEdits.slice(-5),
				diagnostics, // 添加诊断信息
			},
		});
	}

	// 🔥 获取模型的诊断信息
	private _getDiagnosticsForModel(model: ITextModel): DiagnosticInfo[] {
		const markers = this._markerService.read({ resource: model.uri });

		return markers
			.filter(marker => marker.severity === MarkerSeverity.Error || marker.severity === MarkerSeverity.Warning)
			.slice(0, 20) // 限制数量
			.map(marker => ({
				id: `${marker.startLineNumber}-${marker.startColumn}-${marker.code}`,
				uri: model.uri,
				line: marker.startLineNumber,
				column: marker.startColumn,
				endLine: marker.endLineNumber,
				endColumn: marker.endColumn,
				message: marker.message,
				severity: marker.severity === MarkerSeverity.Error ? 'error' as const : 'warning' as const,
				source: marker.source,
				code: typeof marker.code === 'object' ? marker.code.value : marker.code,
			}));
	}

	// 同步生成补全并返回结果
	private async _generateCompletionSync(
		model: ITextModel,
		position: Position,
		prefix: string,
		docUriStr: string
	): Promise<string | null> {
		const currentTime = Date.now()

		// 冷却时间检查
		if (currentTime - this._lastErrorTime < ERROR_COOLDOWN_TIME) {
			return null
		}

		// 获取前缀和后缀信息
		const prefixAndSuffix = getPrefixAndSuffixInfo(model, position)

		// 🔥 触发多位置编辑预测（文件变化+5秒抖动，不阻塞）
		if (this._editPredictionEnabled) {
			this._triggerMultiLocationPrediction(model, position, prefixAndSuffix, 'file_change');
		}

		// 获取补全选项
		const { shouldGenerate, predictionType, llmPrefix, llmSuffix, stopTokens } = getCompletionOptions(prefixAndSuffix, '', false)

		if (!shouldGenerate) {
			return null
		}

		// 获取模型配置
		const featureName: FeatureName = 'Autocomplete'
		const overridesOfModel = this._settingsService.state.overridesOfModel
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined

		if (!modelSelection) {
			return null
		}

		// 检查模型是否支持 FIM
		const modelCapabilities = getModelCapabilities(modelSelection.providerName, modelSelection.modelName, overridesOfModel)
		if (!modelCapabilities.supportsFIM) {
			return null
		}

		// 创建 Promise 来等待 LLM 响应
		return new Promise<string | null>((resolve) => {
			let resolved = false

			const requestId = this._llmMessageService.sendLLMMessage({
				messagesType: 'FIMMessage',
				messages: this._convertToLLMMessageService.prepareFIMMessage({
					messages: {
						prefix: llmPrefix,
						suffix: llmSuffix,
						stopTokens: stopTokens,
					}
				}),
				modelSelection,
				modelSelectionOptions,
				overridesOfModel,
				logging: { loggingName: 'Autocomplete' },
				onText: () => { },
				onFinalMessage: ({ fullText }) => {
					if (resolved) return
					resolved = true

					const [text, _] = extractCodeFromRegular({ text: fullText, recentlyAddedTextLen: 0 })
					let processedText = processStartAndEndSpaces(text)

					// 处理多行补全
					if (predictionType === 'multi-line-start-on-next-line') {
						processedText = _ln + processedText
					}

					// 移除重复代码
					processedText = removeDuplicateWithPrefixAndSuffix(
						processedText,
						prefix,
						prefixAndSuffix.suffix
					)

					if (!processedText || !processedText.trim()) {
						resolve(null)
						return
					}
					resolve(processedText)
				},
				onError: () => {
					if (resolved) return
					resolved = true
					this._lastErrorTime = Date.now()
					resolve(null)
				},
				onAbort: () => {
					if (resolved) return
					resolved = true
					resolve(null)
				},
			})

			// 超时处理
			setTimeout(() => {
				if (!resolved) {
					resolved = true
					if (requestId) {
						this._llmMessageService.abort(requestId)
					}
					resolve(null)
				}
			}, 30000)
		})
	}

	// 光标位置变化监听器
	private _cursorPositionListenerDisposable: { dispose: () => void } | null = null;
	private _lastCursorPosition: { line: number, column: number } | null = null;
	private _cursorMoveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	private _setupCursorPositionListener(): void {
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._attachCursorListener();
		}));
		this._attachCursorListener();
	}

	private _attachCursorListener(): void {
		if (this._cursorPositionListenerDisposable) {
			this._cursorPositionListenerDisposable.dispose();
			this._cursorPositionListenerDisposable = null;
		}

		const activePane = this._editorService.activeEditorPane;
		if (!activePane) return;

		const control = activePane.getControl();
		if (!control || !isCodeEditor(control)) return;

		this._cursorPositionListenerDisposable = control.onDidChangeCursorPosition((e) => {
			const newPos = { line: e.position.lineNumber, column: e.position.column };

			if (this._lastCursorPosition &&
				this._lastCursorPosition.line === newPos.line &&
				this._lastCursorPosition.column === newPos.column) {
				return;
			}
			this._lastCursorPosition = newPos;

			if (this._cursorMoveDebounceTimer) {
				clearTimeout(this._cursorMoveDebounceTimer);
			}

			this._cursorMoveDebounceTimer = setTimeout(() => {
				this._cursorMoveDebounceTimer = null;
				this._triggerCompletionOnCursorMove(control);
			}, CURSOR_MOVE_DEBOUNCE);
		});

		this._register({
			dispose: () => {
				if (this._cursorPositionListenerDisposable) {
					this._cursorPositionListenerDisposable.dispose();
				}
				if (this._cursorMoveDebounceTimer) {
					clearTimeout(this._cursorMoveDebounceTimer);
				}
			}
		});
	}

	// 光标移动时触发补全
	private _triggerCompletionOnCursorMove(editor: any): void {
		const isEnabled = this._settingsService.state.globalSettings.enableAutocomplete
		if (!isEnabled) return;

		// 触发 VS Code 的 inline suggestion
		try {
			editor.trigger('autocomplete-cursor-move', 'editor.action.inlineSuggest.trigger', {});
		} catch (e) {
			// 忽略触发失败
		}

		// 同时手动触发补全处理（双保险）
		const position = editor.getPosition();
		const model = editor.getModel();
		if (position && model) {
			this._provideInlineCompletionItems(model, position).then(items => {
				if (items && items.length > 0) {
					setTimeout(() => {
						try {
							editor.trigger('autocomplete-cursor-move-display', 'editor.action.inlineSuggest.trigger', {});
						} catch (e) {
							// ignore
						}
					}, 50);
				}
			}).catch(() => { });
		}
	}

	private _editPredictionEnabled: boolean = ENABLE_MULTI_LOCATION_PREDICTION;

	constructor(
		@ILanguageFeaturesService private _langFeatureService: ILanguageFeaturesService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IEditorService private readonly _editorService: IEditorService,
		@IModelService private readonly _modelService: IModelService,
		@ISenweaverSettingsService private readonly _settingsService: ISenweaverSettingsService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessageService: IConvertToLLMMessageService,
		@IEditPredictionService private readonly _editPredictionService: IEditPredictionService,
		@IMarkerService private readonly _markerService: IMarkerService,
	) {
		super()

		// 监听编辑预测事件
		this._register(this._editPredictionService.onPredictionReady(() => { }));

		// 监听光标位置变化
		this._setupCursorPositionListener();

		this._register(this._langFeatureService.inlineCompletionsProvider.register('*', {
			provideInlineCompletions: async (model, position, context, token) => {
				const items = await this._provideInlineCompletionItems(model, position)

				return { items: items, }
			},
			freeInlineCompletions: (completions) => {
				// get the `docUriStr` and the `position` of the cursor
				const activePane = this._editorService.activeEditorPane;
				if (!activePane) return;
				const control = activePane.getControl();
				if (!control || !isCodeEditor(control)) return;
				const position = control.getPosition();
				if (!position) return;
				const resource = EditorResourceAccessor.getCanonicalUri(this._editorService.activeEditor);
				if (!resource) return;
				const model = this._modelService.getModel(resource)
				if (!model) return;
				const docUriStr = resource.fsPath;
				if (!this._autocompletionsOfDocument[docUriStr]) return;

				const { prefix, } = getPrefixAndSuffixInfo(model, position)

				// go through cached items and remove matching ones
				// autocompletion.prefix + autocompletion.insertedText ~== insertedText
				this._autocompletionsOfDocument[docUriStr].items.forEach((autocompletion: Autocompletion) => {

					// we can do this more efficiently, I just didn't want to deal with all of the edge cases
					const matchup = removeAllWhitespace(prefix) === removeAllWhitespace(autocompletion.prefix + autocompletion.insertText)

					if (matchup) {
						// 🔥 清除快速缓存
						if (this._lastSuccessfulCompletion && this._lastSuccessfulCompletion.completionId === autocompletion.id) {
							this._lastSuccessfulCompletion = null
						}
					}
				});

			},
		}))
	}


}

registerWorkbenchContribution2(AutocompleteService.ID, AutocompleteService, WorkbenchPhase.BlockRestore);


