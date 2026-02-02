/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { OnText, OnFinalMessage, OnError } from '../common/sendLLMMessageTypes.js';

/**
 * EditAgent 专业编辑代理
 *
 * 借鉴 Zed IDE 的 EditAgent 设计：
 * - 专门处理代码编辑任务
 * - 独立的 LLM 调用，专注于代码修改
 * - 支持多种编辑模式：edit, create, overwrite
 * - 自动格式化和 LSP 集成
 */

// ============================================================================
// 服务接口
// ============================================================================

export const IEditAgentService = createDecorator<IEditAgentService>('editAgentService');

export interface IEditAgentService {
	readonly _serviceBrand: undefined;

	// 事件
	readonly onEditStarted: Event<EditAgentTask>;
	readonly onEditCompleted: Event<EditAgentResult>;
	readonly onEditFailed: Event<{ taskId: string; error: string }>;

	// 方法
	executeEdit(input: EditAgentInput): Promise<EditAgentResult>;
	cancelEdit(taskId: string): void;
	getActiveEdits(): EditAgentTask[];
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 编辑模式
 */
export type EditMode = 'edit' | 'create' | 'overwrite';

/**
 * 编辑代理输入
 */
export interface EditAgentInput {
	// 文件路径
	uri: URI;
	// 编辑模式
	mode: EditMode;
	// 编辑描述（给 LLM 的指令）
	description: string;
	// 当前文件内容（edit/overwrite 模式需要）
	currentContent?: string;
	// 上下文信息
	context?: {
		// 相关文件
		relatedFiles?: Array<{ uri: URI; content: string }>;
		// 诊断信息
		diagnostics?: Array<{ line: number; message: string }>;
		// 用户选择的代码范围
		selectionRange?: { startLine: number; endLine: number };
	};
}

/**
 * 编辑代理任务
 */
export interface EditAgentTask {
	id: string;
	input: EditAgentInput;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	startTime: number;
	endTime?: number;
}

/**
 * 编辑代理结果
 */
export interface EditAgentResult {
	taskId: string;
	success: boolean;
	// 编辑内容
	edits?: Array<{
		uri: URI;
		oldContent: string;
		newContent: string;
		changes: Array<{
			startLine: number;
			endLine: number;
			oldText: string;
			newText: string;
		}>;
	}>;
	// 错误信息
	error?: string;
	// 执行时间
	executionTime: number;
}

// ============================================================================
// EditAgent 服务实现
// ============================================================================

class EditAgentService extends Disposable implements IEditAgentService {
	readonly _serviceBrand: undefined;

	private _activeTasks: Map<string, EditAgentTask> = new Map();
	private _abortControllers: Map<string, AbortController> = new Map();

	// 事件发射器
	private readonly _onEditStarted = this._register(new Emitter<EditAgentTask>());
	readonly onEditStarted: Event<EditAgentTask> = this._onEditStarted.event;

	private readonly _onEditCompleted = this._register(new Emitter<EditAgentResult>());
	readonly onEditCompleted: Event<EditAgentResult> = this._onEditCompleted.event;

	private readonly _onEditFailed = this._register(new Emitter<{ taskId: string; error: string }>());
	readonly onEditFailed: Event<{ taskId: string; error: string }> = this._onEditFailed.event;

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@ISenweaverSettingsService private readonly _settingsService: ISenweaverSettingsService,
	) {
		super();
	}

	/**
	 * 执行编辑任务
	 */
	async executeEdit(input: EditAgentInput): Promise<EditAgentResult> {
		const taskId = generateUuid();
		const startTime = Date.now();

		// 创建任务
		const task: EditAgentTask = {
			id: taskId,
			input,
			status: 'pending',
			startTime,
		};

		this._activeTasks.set(taskId, task);

		// 创建取消控制器
		const abortController = new AbortController();
		this._abortControllers.set(taskId, abortController);

		try {
			// 更新状态
			task.status = 'running';
			this._onEditStarted.fire(task);

			// 构建编辑提示词
			const prompt = this._buildEditPrompt(input);

			// 调用 LLM 执行编辑
			const result = await this._executeLLMEdit(taskId, prompt, input, abortController.signal);

			// 更新任务状态
			task.status = 'completed';
			task.endTime = Date.now();

			this._onEditCompleted.fire(result);
			return result;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			task.status = 'failed';
			task.endTime = Date.now();

			const result: EditAgentResult = {
				taskId,
				success: false,
				error: errorMessage,
				executionTime: Date.now() - startTime,
			};

			this._onEditFailed.fire({ taskId, error: errorMessage });
			return result;

		} finally {
			this._activeTasks.delete(taskId);
			this._abortControllers.delete(taskId);
		}
	}

	/**
	 * 取消编辑任务
	 */
	cancelEdit(taskId: string): void {
		const controller = this._abortControllers.get(taskId);
		if (controller) {
			controller.abort();
		}

		const task = this._activeTasks.get(taskId);
		if (task) {
			task.status = 'cancelled';
			task.endTime = Date.now();
		}
	}

	/**
	 * 获取活动编辑任务
	 */
	getActiveEdits(): EditAgentTask[] {
		return Array.from(this._activeTasks.values());
	}

	/**
	 * 构建编辑提示词
	 */
	private _buildEditPrompt(input: EditAgentInput): string {
		const { mode, description, currentContent, context } = input;

		let prompt = `You are a professional code editing agent. Your task is to ${mode} code based on the following instructions.

## Edit Mode: ${mode.toUpperCase()}

## Instructions:
${description}

`;

		if (mode === 'edit' || mode === 'overwrite') {
			prompt += `## Current File Content:
\`\`\`
${currentContent || '(empty file)'}
\`\`\`

`;
		}

		if (context?.selectionRange) {
			prompt += `## Focus Area:
Lines ${context.selectionRange.startLine} to ${context.selectionRange.endLine}

`;
		}

		if (context?.diagnostics && context.diagnostics.length > 0) {
			prompt += `## Current Diagnostics:
${context.diagnostics.map(d => `- Line ${d.line}: ${d.message}`).join('\n')}

`;
		}

		if (context?.relatedFiles && context.relatedFiles.length > 0) {
			prompt += `## Related Files:
${context.relatedFiles.map(f => `### ${f.uri.fsPath}\n\`\`\`\n${f.content.substring(0, 1000)}${f.content.length > 1000 ? '...(truncated)' : ''}\n\`\`\``).join('\n\n')}

`;
		}

		prompt += `## Output Format:
Respond with ONLY the edited code content, no explanations. The code should be complete and ready to use.

For 'edit' mode: Output the complete file with your changes applied.
For 'create' mode: Output the new file content.
For 'overwrite' mode: Output the complete new file content.`;

		return prompt;
	}

	/**
	 * 执行 LLM 编辑调用
	 */
	private async _executeLLMEdit(
		taskId: string,
		prompt: string,
		input: EditAgentInput,
		signal: AbortSignal
	): Promise<EditAgentResult> {
		const startTime = Date.now();

		return new Promise((resolve, reject) => {
			let resultContent = '';

			// 检查是否已取消
			if (signal.aborted) {
				reject(new Error('Edit cancelled'));
				return;
			}

			// 监听取消信号
			const abortHandler = () => {
				reject(new Error('Edit cancelled'));
			};
			signal.addEventListener('abort', abortHandler);

			// 获取当前模型设置 - 使用 Chat 模型
			const state = this._settingsService.state;
			const modelSelection = state.modelSelectionOfFeature['Chat'];

			if (!modelSelection) {
				signal.removeEventListener('abort', abortHandler);
				reject(new Error('No model selected. Please configure a model in Settings.'));
				return;
			}

			// LLM 回调
			const onText: OnText = ({ fullText }) => {
				resultContent = fullText;
			};

			const onFinalMessage: OnFinalMessage = () => {
				signal.removeEventListener('abort', abortHandler);

				// 解析编辑结果
				const newContent = this._extractCodeFromResponse(resultContent);

				const result: EditAgentResult = {
					taskId,
					success: true,
					edits: [{
						uri: input.uri,
						oldContent: input.currentContent || '',
						newContent,
						changes: this._computeChanges(input.currentContent || '', newContent),
					}],
					executionTime: Date.now() - startTime,
				};

				resolve(result);
			};

			const onError: OnError = ({ message, fullError }) => {
				signal.removeEventListener('abort', abortHandler);
				reject(new Error(message || (fullError?.message ?? 'Unknown error')));
			};

			// 发送 LLM 消息
			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{
					role: 'user',
					content: prompt,
				}],
				separateSystemMessage: 'You are a professional code editing agent. Output ONLY code, no explanations.',
				chatMode: null,
				onText,
				onFinalMessage,
				onError,
				onAbort: () => { },
				logging: { loggingName: 'editAgent' },
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			});
		});
	}

	/**
	 * 从 LLM 响应中提取代码
	 */
	private _extractCodeFromResponse(response: string): string {
		// 尝试提取代码块
		const codeBlockMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			return codeBlockMatch[1].trim();
		}

		// 如果没有代码块，返回整个响应（去除首尾空白）
		return response.trim();
	}

	/**
	 * 计算变更
	 */
	private _computeChanges(oldContent: string, newContent: string): Array<{
		startLine: number;
		endLine: number;
		oldText: string;
		newText: string;
	}> {
		const oldLines = oldContent.split('\n');
		const newLines = newContent.split('\n');

		const changes: Array<{
			startLine: number;
			endLine: number;
			oldText: string;
			newText: string;
		}> = [];

		// 简单的行级别差异检测
		let i = 0;
		let j = 0;

		while (i < oldLines.length || j < newLines.length) {
			if (i >= oldLines.length) {
				// 新增的行
				changes.push({
					startLine: i + 1,
					endLine: i + 1,
					oldText: '',
					newText: newLines.slice(j).join('\n'),
				});
				break;
			}

			if (j >= newLines.length) {
				// 删除的行
				changes.push({
					startLine: i + 1,
					endLine: oldLines.length,
					oldText: oldLines.slice(i).join('\n'),
					newText: '',
				});
				break;
			}

			if (oldLines[i] !== newLines[j]) {
				// 找到变更区域
				const startLine = i + 1;
				let endOld = i;
				let endNew = j;

				// 查找变更结束位置
				while (endOld < oldLines.length && endNew < newLines.length && oldLines[endOld] !== newLines[endNew]) {
					endOld++;
					endNew++;
				}

				changes.push({
					startLine,
					endLine: endOld,
					oldText: oldLines.slice(i, endOld).join('\n'),
					newText: newLines.slice(j, endNew).join('\n'),
				});

				i = endOld;
				j = endNew;
			} else {
				i++;
				j++;
			}
		}

		return changes;
	}
}

registerSingleton(IEditAgentService, EditAgentService, InstantiationType.Delayed);
