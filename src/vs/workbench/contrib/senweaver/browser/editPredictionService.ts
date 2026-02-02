/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { OnText, OnFinalMessage, OnError } from '../common/sendLLMMessageTypes.js';
import { ISenweaverCommandBarService } from './senweaverCommandBarService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { URI } from '../../../../base/common/uri.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import {
	EditPredictionItem,
	EditPredictionResult,
	EditPredictionRequest,
	EditPredictionConfig,
	EditPredictionState,
	EditLocation,
	RecentEdit,
	DiagnosticInfo,
	DEFAULT_EDIT_PREDICTION_CONFIG,
	INITIAL_EDIT_PREDICTION_STATE,
} from '../common/editPredictionTypes.js';

/**
 * Edit Prediction 多位置编辑预测服务
 *
 * 借鉴 Zed IDE 的 Edit Prediction 设计：
 * - 不仅预测光标位置的补全
 * - 还能预测文件中其他相关位置的编辑
 * - 支持多文件联动编辑预测
 */

// ============================================================================
// 服务接口
// ============================================================================

export const IEditPredictionService = createDecorator<IEditPredictionService>('editPredictionService');

/**
 * 应用编辑的结果统计
 */
export interface ApplyEditStats {
	fileCount: number;
	totalAdded: number;
	totalRemoved: number;
	files: Array<{
		fileName: string;
		added: number;
		removed: number;
	}>;
}

export interface IEditPredictionService {
	readonly _serviceBrand: undefined;

	// 事件
	readonly onPredictionReady: Event<EditPredictionResult>;
	readonly onPredictionApplied: Event<EditPredictionItem[]>;
	readonly onPredictionRejected: Event<string>;

	// 方法
	requestPrediction(request: EditPredictionRequest): Promise<EditPredictionResult | null>;
	applyPrediction(predictionId: string, itemIds?: string[]): Promise<ApplyEditStats | null>;
	rejectPrediction(predictionId: string): void;
	getState(): EditPredictionState;
	getConfig(): EditPredictionConfig;
	setConfig(config: Partial<EditPredictionConfig>): void;
	recordEdit(edit: RecentEdit): void;
	clearRecentEdits(): void;
	onFileChange(request: EditPredictionRequest): void;
	canTriggerPrediction(): boolean;
	getEditStats(items: EditPredictionItem[]): ApplyEditStats;
}

// ============================================================================
// LRU 缓存
// ============================================================================

class PredictionCache<K, V> {
	private items: Map<K, V> = new Map();
	private keyOrder: K[] = [];
	private maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	set(key: K, value: V): void {
		if (this.items.has(key)) {
			this.keyOrder = this.keyOrder.filter(k => k !== key);
		} else if (this.items.size >= this.maxSize) {
			const oldKey = this.keyOrder.shift();
			if (oldKey !== undefined) {
				this.items.delete(oldKey);
			}
		}
		this.items.set(key, value);
		this.keyOrder.push(key);
	}

	get(key: K): V | undefined {
		return this.items.get(key);
	}

	has(key: K): boolean {
		return this.items.has(key);
	}

	delete(key: K): boolean {
		if (this.items.has(key)) {
			this.items.delete(key);
			this.keyOrder = this.keyOrder.filter(k => k !== key);
			return true;
		}
		return false;
	}

	clear(): void {
		this.items.clear();
		this.keyOrder = [];
	}
}

// ============================================================================
// EditPredictionService 实现
// ============================================================================

class EditPredictionService extends Disposable implements IEditPredictionService {
	readonly _serviceBrand: undefined;

	private _config: EditPredictionConfig = { ...DEFAULT_EDIT_PREDICTION_CONFIG };
	private _state: EditPredictionState = { ...INITIAL_EDIT_PREDICTION_STATE };
	private _cache: PredictionCache<string, EditPredictionResult>;
	private _debounceTimer: NodeJS.Timeout | null = null;
	private _currentRequestId: string | null = null;

	// 事件发射器
	private readonly _onPredictionReady = this._register(new Emitter<EditPredictionResult>());
	readonly onPredictionReady: Event<EditPredictionResult> = this._onPredictionReady.event;

	private readonly _onPredictionApplied = this._register(new Emitter<EditPredictionItem[]>());
	readonly onPredictionApplied: Event<EditPredictionItem[]> = this._onPredictionApplied.event;

	private readonly _onPredictionRejected = this._register(new Emitter<string>());
	readonly onPredictionRejected: Event<string> = this._onPredictionRejected.event;

	// 10秒防抖定时器（文件改动后）
	private _fileChangeDebounceTimer: NodeJS.Timeout | null = null;
	private readonly FILE_CHANGE_DEBOUNCE_MS = 10000; // 10秒防抖

	// 🔥 防止循环修复的机制
	private _isApplyingEdits = false; // 编辑锁
	//private _recentlyFixedLines: Map<string, Set<number>> = new Map(); // 文件 -> 已修复的行号
	private _lastApplyTime = 0; // 上次应用编辑的时间
	private readonly APPLY_COOLDOWN_MS = 5000; // 应用后5秒内不再触发

	// 已打开的文件集合（用于初始检查）
	private _openedFiles: Set<string> = new Set();

	// 🔥 跟踪每个文件的触发状态
	private _hasTriggeredFirstTime: Set<string> = new Set(); // 文件URI -> 是否已触发第一次
	private _userAcceptedSuggestion: Map<string, boolean> = new Map(); // 文件URI -> 用户是否接受了建议
	private _fileContentHash: Map<string, string> = new Map(); // 文件URI -> 文件内容哈希（用于检测是否修改）

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@ISenweaverSettingsService private readonly _settingsService: ISenweaverSettingsService,
		@IModelService private readonly _modelService: IModelService,
		@ISenweaverCommandBarService private readonly _commandBarService: ISenweaverCommandBarService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IEditorService private readonly _editorService: IEditorService,
	) {
		super();
		this._cache = new PredictionCache(this._config.maxCacheSize);

		// 🔥 监听文件打开事件，触发初始检查
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._handleEditorChange();
		}));

		// 🔥 IDE初始化时，检查当前已打开的文件
		setTimeout(() => {
			const activeEditor = this._editorService.activeEditorPane;
			if (activeEditor) {
				const control = activeEditor.getControl();
				if (isCodeEditor(control)) {
					const model = control.getModel();
					if (model) {
						const uri = model.uri;
						const uriStr = uri.toString();
						// 如果当前文件还没有触发过，触发一次
						if (!this._hasTriggeredFirstTime.has(uriStr)) {
							this._openedFiles.add(uriStr);
							setTimeout(() => {
								this._triggerInitialCheck(uri);
							}, 500);
						}
					}
				}
			}
		}, 1000);
	}

	/**
	 * 检查是否可以触发预测
	 */
	private _canTriggerPrediction(): boolean {
		// 🔥 如果正在应用编辑，不触发
		if (this._isApplyingEdits) {
			return false;
		}
		// 🔥 如果在冷却期内，不触发
		if (Date.now() - this._lastApplyTime < this.APPLY_COOLDOWN_MS) {
			return false;
		}
		if (this._commandBarService.anyFileIsStreaming()) {
			return false;
		}
		return true;
	}

	/**
	 * 🔥 处理编辑器切换事件（文件打开时触发初始检查）
	 */
	private _handleEditorChange(): void {
		const activeEditor = this._editorService.activeEditorPane;
		if (!activeEditor) return;

		const control = activeEditor.getControl();
		if (!isCodeEditor(control)) return;

		const model = control.getModel();
		if (!model) return;

		const uri = model.uri;
		const uriStr = uri.toString();

		// 如果是新打开的文件，触发初始检查（只触发一次）
		if (!this._openedFiles.has(uriStr)) {
			this._openedFiles.add(uriStr);
			// 延迟500ms触发，等待诊断信息更新
			setTimeout(() => {
				this._triggerInitialCheck(uri);
			}, 500);
		}
	}

	/**
	 * 🔥 触发初始检查（文件打开时，只触发一次）
	 */
	private async _triggerInitialCheck(uri: URI): Promise<void> {
		const uriStr = uri.toString();

		// 如果已经触发过第一次，不再触发
		if (this._hasTriggeredFirstTime.has(uriStr)) {
			return;
		}

		if (!this._canTriggerPrediction()) {
			return;
		}

		const model = this._modelService.getModel(uri);
		if (!model) {
			return;
		}

		// 记录文件内容哈希
		const content = model.getValue();
		const contentHash = this._simpleHash(content);
		this._fileContentHash.set(uriStr, contentHash);

		const position = { line: 1, column: 1 };
		const diagnostics: DiagnosticInfo[] = this._getDiagnosticsForUri(uri);

		// 触发检查（即使没有错误也触发，因为可能有问题需要优化）
		await this.requestPrediction({
			uri,
			position,
			trigger: 'file_open',
			context: {
				prefix: '',
				suffix: '',
				currentLine: '',
				surroundingLines: [],
				recentEdits: [],
				diagnostics,
			},
		});

		// 标记已触发第一次
		this._hasTriggeredFirstTime.add(uriStr);
	}

	/**
	 * 简单的字符串哈希函数（用于检测文件内容是否改变）
	 */
	private _simpleHash(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return hash.toString();
	}

	/**
	 * 🔥 获取URI的诊断信息
	 */
	private _getDiagnosticsForUri(uri: URI): DiagnosticInfo[] {
		const markers = this._markerService.read({ resource: uri });
		const diagnostics: DiagnosticInfo[] = markers
			.filter(marker => marker.severity === MarkerSeverity.Error || marker.severity === MarkerSeverity.Warning)
			.slice(0, 20)
			.map(marker => {
				const diagnostic: DiagnosticInfo = {
					uri,
					line: marker.startLineNumber,
					column: marker.startColumn,
					endLine: marker.endLineNumber,
					endColumn: marker.endColumn,
					message: marker.message,
					severity: marker.severity === MarkerSeverity.Error ? 'error' : 'warning',
					source: marker.source,
					code: typeof marker.code === 'object' ? marker.code.value : marker.code,
				};
				return diagnostic;
			});
		return diagnostics;
	}

	/**
	 * 文件变化时触发预测（带5秒防抖）
	 * 触发条件：
	 * 1. 文件内容确实改变了
	 * 2. 满足触发条件（有错误、优化空间等）
	 */
	onFileChange(request: EditPredictionRequest): void {
		const uriStr = request.uri.toString();

		// 检查文件内容是否真的改变了
		const model = this._modelService.getModel(request.uri);
		if (!model) {
			return;
		}

		const currentContent = model.getValue();
		const currentHash = this._simpleHash(currentContent);
		const previousHash = this._fileContentHash.get(uriStr);

		// 🔥 优化：如果哈希匹配且不是首次检查，跳过（但允许防抖定时器继续运行）
		// 这样可以避免重复触发，但如果防抖定时器已经在运行，就不需要重新设置
		if (currentHash === previousHash && previousHash !== undefined) {
			// 如果防抖定时器已经在运行，说明之前已经检测到变化，不需要重复设置
			if (this._fileChangeDebounceTimer) {
				return;
			}
			// 如果没有防抖定时器，说明这是第一次检测到相同内容，也不需要触发
			return;
		}

		// 🔥 重要：不在 onFileChange 时立即更新哈希，而是在防抖定时器触发后才更新
		// 这样可以避免快速输入时，第一个调用更新哈希导致后续调用被跳过

		// 清除之前的防抖定时器
		if (this._fileChangeDebounceTimer) {
			clearTimeout(this._fileChangeDebounceTimer);
		}

		// 🔥 保存当前哈希作为"待处理的哈希"，用于防抖定时器触发时比较
		const pendingHash = currentHash;

		this._fileChangeDebounceTimer = setTimeout(async () => {
			// 清除定时器引用
			this._fileChangeDebounceTimer = null;

			// 再次检查AI助手是否在运行
			if (!this._canTriggerPrediction()) {
				return;
			}

			// 再次检查文件内容是否改变（可能在防抖期间又被修改）
			const model = this._modelService.getModel(request.uri);
			if (!model) return;
			const finalContent = model.getValue();
			const finalHash = this._simpleHash(finalContent);
			const lastHash = this._fileContentHash.get(uriStr);

			// 🔥 如果内容在防抖期间没有改变（与待处理的哈希匹配），触发预测并更新哈希
			if (finalHash === pendingHash || lastHash === undefined) {
				// 更新文件内容哈希（在防抖定时器触发时更新，而不是在 onFileChange 时）
				this._fileContentHash.set(uriStr, finalHash);
				await this.requestPrediction(request);
			} else {
				// 如果内容在防抖期间又改变了，更新哈希但不触发（等待下一次防抖）
				this._fileContentHash.set(uriStr, finalHash);
			}
		}, this.FILE_CHANGE_DEBOUNCE_MS);
	}

	/**
	 * 请求编辑预测
	 */
	async requestPrediction(request: EditPredictionRequest): Promise<EditPredictionResult | null> {
		// 检查是否启用多位置预测
		if (!this._config.enableMultiLocationPrediction) {
			return null;
		}

		// 🔥 如果已有正在进行的请求，等待它完成
		if (this._state.isLoading && this._currentRequestId) {
			// 等待最多10秒
			const maxWait = 10000;
			const startTime = Date.now();
			while (this._state.isLoading && Date.now() - startTime < maxWait) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}

		// 防抖处理
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		return new Promise((resolve) => {
			this._debounceTimer = setTimeout(async () => {
				try {
					const result = await this._executePrediction(request);
					resolve(result);
				} catch (error) {
					resolve(null);
				}
			}, this._config.debounceTime);
		});
	}

	/**
	 * 执行预测 - 像代码安全助手一样工作
	 */
	private async _executePrediction(request: EditPredictionRequest): Promise<EditPredictionResult | null> {
		const requestId = generateUuid();
		this._currentRequestId = requestId;

		// 更新状态
		this._state = {
			...this._state,
			isLoading: true,
			pendingRequest: request,
		};

		// 检查缓存
		const cacheKey = this._getCacheKey(request);
		const cachedResult = this._cache.get(cacheKey);
		if (cachedResult) {
			this._state = {
				...this._state,
				isLoading: false,
				currentResult: cachedResult,
				pendingRequest: null,
			};
			this._onPredictionReady.fire(cachedResult);
			return cachedResult;
		}

		// 🔥 Step 1: 像助手一样使用read_file读取完整文件内容
		const fullFileContent = await this._readFile(request.uri);
		if (!fullFileContent) {
			return null;
		}

		// 🔥 Step 2: 构建预测提示词（要求一次性修复所有错误）
		const prompt = this._buildPredictionPrompt(request, fullFileContent);

		// 🔥 Step 3: 调用 LLM 分析并获取修复建议（要求一次性修复所有错误）
		const result = await this._callLLMForPrediction(requestId, prompt, request, fullFileContent);

		if (result) {
			// 缓存结果
			this._cache.set(cacheKey, result);

			// 更新状态
			this._state = {
				...this._state,
				isLoading: false,
				currentResult: result,
				pendingRequest: null,
			};

			this._onPredictionReady.fire(result);
		} else {
			this._state = {
				...this._state,
				isLoading: false,
				pendingRequest: null,
			};
		}

		return result;
	}

	/**
	 * 🔥 读取完整文件内容（类似助手的read_file工具）
	 */
	private async _readFile(uri: URI): Promise<string | null> {
		try {
			// 优先从已打开的模型中读取
			const model = this._modelService.getModel(uri);
			if (model) {
				return model.getValue();
			}

			// 否则从文件系统读取
			const content = await this._textFileService.read(uri);
			return content.value;
		} catch (error) {
			return null;
		}
	}

	/**
	 * 构建预测提示词 - 代码安全助手模式（使用工具，像agent一样）
	 */
	private _buildPredictionPrompt(request: EditPredictionRequest, fullFileContent: string): string {
		const { context, position } = request;
		const hasDiagnostics = context.diagnostics && context.diagnostics.length > 0;

		// 🔥 使用直接读取的完整文件内容
		const allLines = fullFileContent.split('\n');
		const totalLines = allLines.length;

		// 🔥 只包含相关代码片段（错误行周围150行，最多300行）
		const CONTEXT_LINES = 150;
		const MAX_LINES = 300;
		const endLine = Math.min(totalLines, position.line + CONTEXT_LINES);
		const actualStart = Math.max(0, endLine - MAX_LINES);
		const actualEnd = Math.min(totalLines, actualStart + MAX_LINES);

		// 构建带行号的代码视图（只包含相关片段）
		let numberedCode = '';
		if (actualStart > 0) {
			numberedCode += `   1 | ... (${actualStart} lines before) ...\n`;
		}
		for (let i = actualStart; i < actualEnd; i++) {
			const lineNum = i + 1;
			const marker = lineNum === position.line ? '  <-- CURSOR' : '';
			numberedCode += `${lineNum.toString().padStart(4, ' ')} | ${allLines[i]}${marker}\n`;
		}
		if (actualEnd < totalLines) {
			numberedCode += `${(totalLines + 1).toString().padStart(4, ' ')} | ... (${totalLines - actualEnd} lines after) ...\n`;
		}

		// 检测文件类型和框架
		const fileExt = request.uri.fsPath.split('.').pop()?.toLowerCase() || '';
		const languageHints = this._detectLanguageAndFramework(fullFileContent, fileExt);

		// 🔥 提取代码结构上下文（类定义、方法、属性等）- 参考strix的代码理解
		const codeContext = this._extractCodeContext(fullFileContent, fileExt);

		// 🔥 使用行号引用格式，避免LLM复制代码不精确的问题
		let prompt = `You are a professional code security inspector (similar to Strix security testing tool), specialized in:
1. **Security Vulnerability Detection**: SQL injection, XSS, SSRF, IDOR, RCE, CSRF, authentication bypass, etc.
2. **Code Error Fixing**: Syntax errors, type errors, logic errors, runtime errors
3. **Code Optimization Suggestions**: Performance optimization, best practices, code quality improvements
4. **Security Hardening**: Input validation, output encoding, permission checks, secure encryption usage

## File Information
- Path: ${request.uri.fsPath}
- Language: ${languageHints.language}
${languageHints.framework ? `- Framework: ${languageHints.framework}` : ''}
- Total Lines: ${totalLines}

## Code Structure
- Classes: ${codeContext.classes.length > 0 ? codeContext.classes.join(', ') : 'None'}
- Methods: ${codeContext.methods.length > 0 ? codeContext.methods.slice(0, 20).join(', ') : 'None'}
- Attributes: ${codeContext.attributes.length > 0 ? codeContext.attributes.slice(0, 30).join(', ') : 'None'}
${codeContext.imports.length > 0 ? `- Imports: ${codeContext.imports.slice(0, 10).join(', ')}` : ''}

## Complete File Content (with line numbers)
\`\`\`${fileExt}
${numberedCode}
\`\`\`

`;

		// 添加诊断信息（错误和警告）
		if (hasDiagnostics) {
			const errors = context.diagnostics!.filter(d => d.severity === 'error');
			const warnings = context.diagnostics!.filter(d => d.severity === 'warning');

			if (errors.length > 0) {
				prompt += `## ⚠️ Errors to Fix
${errors.slice(0, 10).map(d =>
					`- Line ${d.line}: ${d.message}`
				).join('\n')}

`;
			}

			if (warnings.length > 0) {
				prompt += `## Warnings
${warnings.slice(0, 5).map(d =>
					`- Line ${d.line}: ${d.message}`
				).join('\n')}

`;
			}
		}

		// 🔥 添加安全漏洞检测指南（简化版）
		prompt += `## 🔒 Security Vulnerability Detection

Detect: SQL injection (string concat in queries), XSS (user input to HTML), SSRF (user URLs), IDOR (missing auth checks), RCE (os.system/subprocess), Path traversal (user file paths), Insecure deserialization (pickle/yaml.load), Info disclosure (hardcoded keys), Auth bypass (weak passwords/JWT).

## 🚀 Code Optimization

Detect: Performance issues (N+1 queries, memory leaks), Code quality (duplicates, long functions), Best practices (error handling, logging), Maintainability (magic numbers, hardcoded values).

## 🔥 CRITICAL: Fix ALL Errors at Once

You MUST fix ALL errors and issues in ONE go. Do NOT fix errors one by one. Analyze the entire file and fix ALL problems in a single response.

## 📋 Output Format

Output JSON with ALL fixes in one array:
\`\`\`json
{
  "fixes": [
    {
      "line": line_number,
      "endLine": end_line_number (optional),
      "newCode": "Fixed code (preserve indentation)",
      "reason": "Fix reason",
      "type": "security_vulnerability|error|optimization|best_practice",
      "severity": "critical|high|medium|low|info",
      "category": "sql_injection|xss|ssrf|idor|auth|rce|path_traversal|deserialization|info_disclosure|business_logic|performance|code_quality"
    }
  ]
}
\`\`\`

## 🔥 Rules
1. Fix ALL errors in ONE response - do NOT fix one by one
2. Use valid line numbers from the code above
3. Preserve original indentation in newCode
4. newCode MUST be different from original code
5. Prioritize security vulnerabilities first, then errors, then optimizations
6. Ensure fixes don't introduce new errors

If unable to safely fix or no issues found, return:
\`\`\`json
{"fixes": []}
\`\`\`

Analyze the code, detect ALL security vulnerabilities, errors, and optimization opportunities. Fix ALL of them in ONE response.`;

		return prompt;
	}

	/**
	 * 调用 LLM 获取预测 - 代码安全助手模式（要求一次性修复所有错误）
	 */
	private async _callLLMForPrediction(
		requestId: string,
		prompt: string,
		request: EditPredictionRequest,
		fullFileContent: string
	): Promise<EditPredictionResult | null> {
		return new Promise((resolve) => {
			let resultContent = '';

			const state = this._settingsService.state;
			const modelSelection = state.modelSelectionOfFeature['Chat'];

			if (!modelSelection) {
				resolve(null);
				return;
			}

			const onText: OnText = ({ fullText }) => {
				resultContent = fullText;
			};

			const onFinalMessage: OnFinalMessage = () => {
				try {
					// 🔥 使用直接读取的文件内容进行解析
					const parsed = this._parseResponse(resultContent, request, fullFileContent);
					resolve(parsed);
				} catch (error) {
					resolve(null);
				}
			};

			const onError: OnError = () => {
				resolve(null);
			};

			const onAbort = () => {
				resolve(null);
			};

			try {
				this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					messages: [{
						role: 'user',
						content: prompt,
					}],
					separateSystemMessage: `You are a professional code security inspector (similar to Strix security testing tool).
Your role is to:
1. Detect security vulnerabilities (SQL injection, XSS, SSRF, IDOR, RCE, etc.)
2. Fix code errors and bugs
3. Provide optimization suggestions
4. Recommend best practices

CRITICAL: You MUST fix ALL errors in ONE response. Do NOT fix errors one by one. Analyze the entire file and provide ALL fixes in a single JSON response.

You MUST output ONLY valid JSON in the specified format. Be thorough, systematic, and prioritize security vulnerabilities.`,
					chatMode: null,
					onText,
					onFinalMessage,
					onError,
					onAbort,
					logging: { loggingName: 'editPrediction' },
					modelSelection,
					modelSelectionOptions: undefined,
					overridesOfModel: undefined,
				});
			} catch (error) {
				resolve(null);
			}
		});
	}

	/**
	 * 解析 LLM 响应 - 使用行号引用格式（更精确，避免复制代码不匹配）
	 */
	private _parseResponse(response: string, request: EditPredictionRequest, fullFileContent: string): EditPredictionResult | null {
		try {
			// 🔥 使用直接读取的完整文件内容（类似助手的read_file工具）
			const allLines = fullFileContent.split('\n');

			// 尝试解析JSON格式
			const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
			if (!jsonMatch) {
				// 检查是否为空修复
				if (response.includes('"fixes": []') || response.includes('"fixes":[]')) {
					return {
						id: generateUuid(),
						timestamp: Date.now(),
						cursorPosition: { uri: request.uri, line: request.position.line, column: request.position.column },
						predictions: [],
						relatedEdits: [],
						totalConfidence: 1.0,
					};
				}
				return null;
			}

			let jsonStr = jsonMatch[1] || jsonMatch[0];
			// 清理JSON字符串
			jsonStr = jsonStr.replace(/```json|```/g, '').trim();

			// 🔥 尝试修复常见的JSON格式错误
			// 1. 处理未转义的换行符（在字符串值中）
			jsonStr = jsonStr.replace(/(?<!\\)"(?:[^"\\]|\\.)*"/g, (match) => {
				// 在字符串值内部，将未转义的换行符转义
				return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
			});

			// 2. 尝试找到完整的JSON对象（从第一个 { 到匹配的 }）
			let braceCount = 0;
			let jsonStart = -1;
			let jsonEnd = -1;
			for (let i = 0; i < jsonStr.length; i++) {
				if (jsonStr[i] === '{') {
					if (braceCount === 0) jsonStart = i;
					braceCount++;
				} else if (jsonStr[i] === '}') {
					braceCount--;
					if (braceCount === 0) {
						jsonEnd = i + 1;
						break;
					}
				}
			}

			// 如果找到了匹配的大括号，只使用这部分
			if (jsonStart >= 0 && jsonEnd > jsonStart) {
				jsonStr = jsonStr.substring(jsonStart, jsonEnd);
			}

			// 3. 尝试修复未终止的字符串（在最后一个引号之前添加引号）
			const lastQuoteIndex = jsonStr.lastIndexOf('"');
			if (lastQuoteIndex >= 0) {
				// 检查是否有未终止的字符串（从最后一个引号到末尾）
				const afterLastQuote = jsonStr.substring(lastQuoteIndex + 1);
				if (afterLastQuote.trim() && !afterLastQuote.includes('"')) {
					// 可能未终止，尝试在适当位置添加引号
					const beforeLastQuote = jsonStr.substring(0, lastQuoteIndex);
					const quoteCount = (beforeLastQuote.match(/"/g) || []).length;
					// 如果引号数量是奇数，说明有未终止的字符串
					if (quoteCount % 2 === 1) {
						// 尝试在最后一个有效字符后添加引号
						const trimmed = jsonStr.trim();
						if (!trimmed.endsWith('"') && !trimmed.endsWith('}')) {
							jsonStr = jsonStr.trim() + '"';
						}
					}
				}
			}

			let parsed: {
				fixes: Array<{
					line: number;
					endLine?: number;
					newCode: string;
					reason?: string;
					type?: string;
					severity?: string;
					category?: string;
				}>
			};
			try {
				parsed = JSON.parse(jsonStr);
			} catch (e) {
				// 🔥 如果解析失败，尝试更激进的修复
				// 尝试提取并修复每个 fix 对象
				const fixesMatch = jsonStr.match(/"fixes"\s*:\s*\[([\s\S]*?)\]/);
				if (fixesMatch) {
					try {
						// 尝试手动解析 fixes 数组
						const fixesStr = fixesMatch[1];
						// 使用更宽松的解析：找到每个 { ... } 对象
						const fixObjects: any[] = [];
						let currentFix = '';
						let inString = false;
						let escapeNext = false;
						let braceLevel = 0;

						for (let i = 0; i < fixesStr.length; i++) {
							const char = fixesStr[i];

							if (escapeNext) {
								currentFix += char;
								escapeNext = false;
								continue;
							}

							if (char === '\\') {
								escapeNext = true;
								currentFix += char;
								continue;
							}

							if (char === '"' && !escapeNext) {
								inString = !inString;
								currentFix += char;
								continue;
							}

							if (!inString) {
								if (char === '{') {
									if (braceLevel === 0) currentFix = '';
									braceLevel++;
									currentFix += char;
								} else if (char === '}') {
									braceLevel--;
									currentFix += char;
									if (braceLevel === 0) {
										try {
											const fixObj = JSON.parse(currentFix);
											fixObjects.push(fixObj);
										} catch {
											// 跳过这个无效的 fix
										}
										currentFix = '';
									} else {
										currentFix += char;
									}
								} else {
									currentFix += char;
								}
							} else {
								currentFix += char;
							}
						}

						if (fixObjects.length > 0) {
							parsed = { fixes: fixObjects };
						} else {
							return null;
						}
					} catch (repairError) {
						return null;
					}
				} else {
					return null;
				}
			}

			if (!parsed.fixes || !Array.isArray(parsed.fixes)) {
				return null;
			}

			// 🔥 提取文件中定义的属性和方法（用于验证）
			const fileExt = request.uri.fsPath.split('.').pop()?.toLowerCase() || '';
			const definedAttrs = new Set<string>();
			const definedMethods = new Set<string>();

			for (const line of allLines) {
				const pyAttr = line.match(/self\.(\w+)\s*=/);
				if (pyAttr) definedAttrs.add(pyAttr[1]);
				const pyMethod = line.match(/def\s+(\w+)\s*\(/);
				if (pyMethod) definedMethods.add(pyMethod[1]);
				const jsAttr = line.match(/this\.(\w+)\s*=/);
				if (jsAttr) definedAttrs.add(jsAttr[1]);
				const jsProp = line.match(/(?:private|public|protected)\s+(\w+)/);
				if (jsProp) definedAttrs.add(jsProp[1]);
			}

			// 🔥 根据行号获取原始代码并创建预测项
			const predictions: EditPredictionItem[] = [];

			for (const fix of parsed.fixes) {
				const lineNum = fix.line;
				const endLineNum = fix.endLine || lineNum;

				// 验证行号有效性
				if (lineNum < 1 || lineNum > allLines.length) {
					continue;
				}

				// 🔥 直接从文件中获取原始代码（根据行号）
				const oldLines: string[] = [];
				for (let i = lineNum - 1; i < endLineNum && i < allLines.length; i++) {
					oldLines.push(allLines[i]);
				}
				const oldText = oldLines.join('\n');

				// 处理newCode中的换行符
				let newText = fix.newCode;
				if (newText.includes('\\n')) {
					newText = newText.replace(/\\n/g, '\n');
				}

				// 验证newText中的属性/方法是否存在
				if (fileExt === 'py' || ['ts', 'tsx', 'js', 'jsx'].includes(fileExt)) {
					const selfRefs = newText.match(/(?:self|this)\.(\w+)/g) || [];
					let valid = true;
					for (const ref of selfRefs) {
						const attrName = ref.replace(/^(self|this)\./, '');
						if (newText.includes(`${ref}(`)) {
							if (!definedMethods.has(attrName) && !definedAttrs.has(attrName)) {
								if (!newText.includes(`def ${attrName}`) && !newText.includes(`${attrName} =`)) {
									// 也检查原文件中是否已有
									if (!fullFileContent.includes(`def ${attrName}`) && !fullFileContent.includes(`.${attrName}(`)) {
										valid = false;
										break;
									}
								}
							}
						}
					}
					if (!valid) continue;
				}

				// oldText和newText不能相同（更严格的比较）
				const normalizedOld = oldText.trim().replace(/\s+/g, ' ');
				const normalizedNew = newText.trim().replace(/\s+/g, ' ');
				if (normalizedOld === normalizedNew) {
					continue;
				}

				// 验证 newText 确实有实际内容
				if (!newText.trim()) {
					continue;
				}

				// 确定修复类型和严重程度
				const fixType = fix.type || 'error';
				const severity = fix.severity || 'medium';
				const category = fix.category || 'code_quality';

				// 根据类型和严重程度调整置信度
				let confidence = 0.9;
				if (fixType === 'security_vulnerability') {
					confidence = severity === 'critical' ? 0.95 : 0.9;
				} else if (fixType === 'error') {
					confidence = 0.9;
				} else {
					confidence = 0.8; // 优化建议置信度稍低
				}

				// 构建详细的修复原因
				let reason = fix.reason || 'Code fix';
				if (fixType === 'security_vulnerability') {
					reason = `[Security Vulnerability: ${category}] ${reason}`;
				} else if (fixType === 'optimization') {
					reason = `[Performance Optimization] ${reason}`;
				} else if (fixType === 'best_practice') {
					reason = `[Best Practice] ${reason}`;
				}

				predictions.push({
					id: `pred-${generateUuid()}-${predictions.length}`,
					location: {
						uri: request.uri,
						startLine: lineNum,
						startColumn: 1,
						endLine: endLineNum,
						endColumn: oldLines[oldLines.length - 1]?.length || 1,
					} as EditLocation,
					oldText,
					newText,
					confidence,
					reason,
					type: fixType === 'security_vulnerability' ? 'security_fix' :
						fixType === 'optimization' ? 'optimization' :
							fixType === 'best_practice' ? 'best_practice' : 'error_fix',
					diagnosticId: undefined,
				});
			}

			const result: EditPredictionResult = {
				id: generateUuid(),
				timestamp: Date.now(),
				cursorPosition: { uri: request.uri, line: request.position.line, column: request.position.column },
				predictions: predictions.slice(0, this._config.maxPredictionLocations),
				relatedEdits: [],
				totalConfidence: predictions.length > 0 ? 0.9 : 0,
			};

			return result;
		} catch (error) {
			return null;
		}
	}

	/**
	 * 应用预测 - 使用编辑锁防止循环
	 */
	async applyPrediction(predictionId: string, itemIds?: string[]): Promise<ApplyEditStats | null> {
		// 🔥 编辑锁：防止重入
		if (this._isApplyingEdits) {
			return null;
		}

		const result = this._state.currentResult;
		if (!result || result.id !== predictionId) {
			return null;
		}

		const allItems = [...result.predictions, ...result.relatedEdits];
		const itemsToApply = itemIds
			? allItems.filter(item => itemIds.includes(item.id))
			: allItems;

		if (itemsToApply.length === 0) {
			return null;
		}

		// 🔥 设置编辑锁和冷却时间
		this._isApplyingEdits = true;
		this._lastApplyTime = Date.now();

		// 统计信息
		const fileStats: Map<string, { added: number; removed: number }> = new Map();
		const modifiedUris: Set<string> = new Set();

		try {
			// 🔥 按行号从大到小排序，避免行号偏移问题
			const sortedItems = [...itemsToApply].sort((a, b) => b.location.startLine - a.location.startLine);

			for (const item of sortedItems) {
				const uri = item.location.uri;
				const uriStr = uri.toString();
				const fileName = uri.fsPath.split(/[/\\]/).pop() || 'unknown';

				const editResult = await this._applyEditItemByLineNumber(item);
				if (!editResult) {
					continue;
				}

				const existing = fileStats.get(fileName) || { added: 0, removed: 0 };
				fileStats.set(fileName, {
					added: existing.added + editResult.added,
					removed: existing.removed + editResult.removed,
				});
				modifiedUris.add(uriStr);
				this._state.appliedPredictions.add(item.id);
			}

			// 自动保存所有修改过的文件
			for (const uriStr of modifiedUris) {
				try {
					const uri = URI.parse(uriStr);
					await this._textFileService.save(uri);
				} catch (saveError) {
					// 忽略保存错误
				}
			}

			// 清除当前预测结果
			this._state = {
				...this._state,
				currentResult: null,
			};

			this._onPredictionApplied.fire(itemsToApply);

			// 🔥 用户接受修复后，标记为已接受，允许后续文件修改时触发
			for (const uriStr of modifiedUris) {
				this._userAcceptedSuggestion.set(uriStr, true);
				// 更新文件内容哈希（因为文件已被修改）
				const uri = URI.parse(uriStr);
				const model = this._modelService.getModel(uri);
				if (model) {
					const content = model.getValue();
					const contentHash = this._simpleHash(content);
					this._fileContentHash.set(uriStr, contentHash);
				}
			}

			// 构建统计结果
			const files = Array.from(fileStats.entries()).map(([fileName, stats]) => ({
				fileName,
				added: stats.added,
				removed: stats.removed,
			}));

			return {
				fileCount: files.length,
				totalAdded: files.reduce((sum, f) => sum + f.added, 0),
				totalRemoved: files.reduce((sum, f) => sum + f.removed, 0),
				files,
			};
		} catch (error) {
			return null;
		} finally {
			// 🔥 释放编辑锁
			this._isApplyingEdits = false;
		}
	}

	/**
	 * 🔥 使用行号直接应用编辑（不搜索oldText）
	 */
	private async _applyEditItemByLineNumber(item: EditPredictionItem): Promise<{ added: number; removed: number } | null> {
		const uri = item.location.uri;
		const model = this._modelService.getModel(uri);

		if (!model) {
			return null;
		}

		const startLine = item.location.startLine;
		const endLine = item.location.endLine || startLine;
		const newText = item.newText;

		// 验证行号有效性
		const lineCount = model.getLineCount();
		if (startLine < 1 || startLine > lineCount) {
			return null;
		}

		// 🔥 直接使用行号创建编辑范围
		const startColumn = 1;
		const endColumn = model.getLineMaxColumn(Math.min(endLine, lineCount));

		const range = new Range(startLine, startColumn, Math.min(endLine, lineCount), endColumn);

		// 应用编辑
		model.pushEditOperations([], [{ range, text: newText }], () => null);

		// 计算添加和删除的行数
		const oldLines = endLine - startLine + 1;
		const newLines = newText.split('\n').length;
		const added = Math.max(0, newLines - oldLines);
		const removed = Math.max(0, oldLines - newLines);

		return { added, removed };
	}

	/**
	 * 拒绝预测
	 */
	rejectPrediction(predictionId: string): void {
		if (this._state.currentResult?.id === predictionId) {
			const uri = this._state.currentResult.cursorPosition.uri;
			const uriStr = uri.toString();

			// 🔥 清除接受标记，但不清除拒绝标记（拒绝后仍可触发）
			this._userAcceptedSuggestion.delete(uriStr);

			this._state = {
				...this._state,
				currentResult: null,
			};
			this._onPredictionRejected.fire(predictionId);
		}
	}

	/**
	 * 获取状态
	 */
	getState(): EditPredictionState {
		return { ...this._state };
	}

	/**
	 * 获取配置
	 */
	getConfig(): EditPredictionConfig {
		return { ...this._config };
	}

	/**
	 * 设置配置
	 */
	setConfig(config: Partial<EditPredictionConfig>): void {
		this._config = { ...this._config, ...config };
		if (config.maxCacheSize !== undefined) {
			this._cache = new PredictionCache(config.maxCacheSize);
		}
	}

	/**
	 * 记录编辑
	 */
	recordEdit(edit: RecentEdit): void {
		this._state.recentEdits.push(edit);
		// 保留最近 20 条
		if (this._state.recentEdits.length > 20) {
			this._state.recentEdits = this._state.recentEdits.slice(-20);
		}
	}

	/**
	 * 清除最近编辑
	 */
	clearRecentEdits(): void {
		this._state.recentEdits = [];
	}

	/**
	 * 提取代码结构上下文（参考strix的代码理解能力）
	 * 收集类定义、方法签名、属性列表等信息，帮助LLM理解代码结构
	 */
	private _extractCodeContext(content: string, fileExt: string): {
		classes: string[];
		methods: string[];
		attributes: string[];
		imports: string[];
	} {
		const classes: string[] = [];
		const methods: string[] = [];
		const attributes: string[] = [];
		const imports: string[] = [];

		const lines = content.split('\n');

		// Python 模式
		if (fileExt === 'py') {
			for (const line of lines) {
				// 类定义
				const classMatch = line.match(/^class\s+(\w+)/);
				if (classMatch) {
					classes.push(classMatch[1]);
				}
				// 方法定义
				const defMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
				if (defMatch) {
					methods.push(defMatch[1]);
				}
				// 属性定义 (self.xxx = )
				const attrMatch = line.match(/self\.(\w+)\s*=/);
				if (attrMatch && !attributes.includes(attrMatch[1])) {
					attributes.push(attrMatch[1]);
				}
				// import语句
				if (line.startsWith('import ') || line.startsWith('from ')) {
					imports.push(line.trim());
				}
			}
		}
		// TypeScript/JavaScript 模式
		else if (['ts', 'tsx', 'js', 'jsx'].includes(fileExt)) {
			for (const line of lines) {
				// 类定义
				const classMatch = line.match(/class\s+(\w+)/);
				if (classMatch) {
					classes.push(classMatch[1]);
				}
				// 方法定义
				const methodMatch = line.match(/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);
				if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
					methods.push(methodMatch[1]);
				}
				// 属性定义 (this.xxx = 或 private/public xxx)
				const thisAttrMatch = line.match(/this\.(\w+)\s*=/);
				if (thisAttrMatch && !attributes.includes(thisAttrMatch[1])) {
					attributes.push(thisAttrMatch[1]);
				}
				const propMatch = line.match(/(?:private|public|protected|readonly)\s+(\w+)/);
				if (propMatch && !attributes.includes(propMatch[1])) {
					attributes.push(propMatch[1]);
				}
				// import语句
				if (line.startsWith('import ')) {
					imports.push(line.trim());
				}
			}
		}
		// Java/Kotlin 模式
		else if (['java', 'kt'].includes(fileExt)) {
			for (const line of lines) {
				const classMatch = line.match(/class\s+(\w+)/);
				if (classMatch) {
					classes.push(classMatch[1]);
				}
				const methodMatch = line.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:\w+)\s+(\w+)\s*\(/);
				if (methodMatch) {
					methods.push(methodMatch[1]);
				}
				if (line.startsWith('import ')) {
					imports.push(line.trim());
				}
			}
		}

		return { classes, methods, attributes, imports };
	}

	/**
	 * 检测语言和框架（参考strix的代码分析方法）
	 */
	private _detectLanguageAndFramework(content: string, fileExt: string): { language: string; framework: string | null } {
		// 语言检测
		const langMap: Record<string, string> = {
			'ts': 'TypeScript', 'tsx': 'TypeScript/React', 'js': 'JavaScript', 'jsx': 'JavaScript/React',
			'py': 'Python', 'java': 'Java', 'kt': 'Kotlin', 'go': 'Go', 'rs': 'Rust',
			'cpp': 'C++', 'c': 'C', 'cs': 'C#', 'rb': 'Ruby', 'php': 'PHP',
			'swift': 'Swift', 'scala': 'Scala', 'vue': 'Vue', 'svelte': 'Svelte',
		};
		const language = langMap[fileExt] || fileExt.toUpperCase();

		// 框架检测
		let framework: string | null = null;
		if (content.includes('from fastapi') || content.includes('FastAPI')) framework = 'FastAPI';
		else if (content.includes('from flask') || content.includes('Flask')) framework = 'Flask';
		else if (content.includes('from django') || content.includes('Django')) framework = 'Django';
		else if (content.includes('express') || content.includes('Express')) framework = 'Express.js';
		else if (content.includes('from react') || content.includes('import React')) framework = 'React';
		else if (content.includes('@angular') || content.includes('Angular')) framework = 'Angular';
		else if (content.includes('Vue') || content.includes('vue')) framework = 'Vue.js';
		else if (content.includes('Spring') || content.includes('@RestController')) framework = 'Spring';
		else if (content.includes('Rails') || content.includes('ActiveRecord')) framework = 'Ruby on Rails';
		else if (content.includes('Laravel') || content.includes('Illuminate')) framework = 'Laravel';

		return { language, framework };
	}

	/**
	 * 检查是否可以触发预测（公共方法）
	 */
	canTriggerPrediction(): boolean {
		return this._canTriggerPrediction();
	}

	/**
	 * 获取编辑统计信息（预览用）
	 */
	getEditStats(items: EditPredictionItem[]): ApplyEditStats {
		const fileStats: Map<string, { added: number; removed: number }> = new Map();

		for (const item of items) {
			const fileName = item.location.uri.fsPath.split(/[/\\]/).pop() || 'unknown';
			const oldLines = item.oldText ? item.oldText.split('\n').length : 0;
			const newLines = item.newText.split('\n').length;
			const added = Math.max(0, newLines - oldLines);
			const removed = Math.max(0, oldLines - newLines);

			const existing = fileStats.get(fileName) || { added: 0, removed: 0 };
			fileStats.set(fileName, {
				added: existing.added + added,
				removed: existing.removed + removed,
			});
		}

		const files = Array.from(fileStats.entries()).map(([fileName, stats]) => ({
			fileName,
			added: stats.added,
			removed: stats.removed,
		}));

		return {
			fileCount: files.length,
			totalAdded: files.reduce((sum, f) => sum + f.added, 0),
			totalRemoved: files.reduce((sum, f) => sum + f.removed, 0),
			files,
		};
	}

	/**
	 * 生成缓存键
	 */
	private _getCacheKey(request: EditPredictionRequest): string {
		return `${request.uri.fsPath}:${request.position.line}:${request.position.column}:${request.context.prefix.slice(-100)}`;
	}

	/**
	 * 清理资源
	 */
	override dispose(): void {
		// 清理所有定时器
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = null;
		}
		if (this._fileChangeDebounceTimer) {
			clearTimeout(this._fileChangeDebounceTimer);
			this._fileChangeDebounceTimer = null;
		}
		super.dispose();
	}
}

registerSingleton(IEditPredictionService, EditPredictionService, InstantiationType.Delayed);
