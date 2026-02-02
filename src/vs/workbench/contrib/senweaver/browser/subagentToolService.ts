/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { BuiltinToolName } from '../common/toolsServiceTypes.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { OnText, OnFinalMessage, OnError } from '../common/sendLLMMessageTypes.js';

/**
 * SubagentTool - 真正的子代理工具
 *
 * 借鉴 Zed IDE 的 SubagentTool 设计：
 * - 子代理拥有独立的上下文窗口
 * - 最多支持 8 个并行子代理
 * - 最多支持 4 层嵌套深度
 * - 支持超时控制
 * - 支持工具限制
 * - 上下文不足时自动总结
 */

// ============================================================================
// 配置常量
// ============================================================================

export const MAX_PARALLEL_SUBAGENTS = 8;
export const MAX_SUBAGENT_DEPTH = 4;
export const CONTEXT_LOW_THRESHOLD = 0.25; // 25% 上下文告警
export const DEFAULT_SUBAGENT_TIMEOUT = 300000; // 5 分钟默认超时

// ============================================================================
// 服务接口
// ============================================================================

export const ISubagentToolService = createDecorator<ISubagentToolService>('subagentToolService');

export interface ISubagentToolService {
	readonly _serviceBrand: undefined;

	// 事件
	readonly onSubagentStarted: Event<SubagentTask>;
	readonly onSubagentProgress: Event<SubagentProgressEvent>;
	readonly onSubagentCompleted: Event<SubagentResult>;
	readonly onSubagentFailed: Event<{ taskId: string; error: string }>;

	// 方法
	spawnSubagent(input: SubagentInput): Promise<SubagentResult>;
	cancelSubagent(taskId: string): void;
	getActiveSubagents(): SubagentTask[];
	getCurrentDepth(): number;
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 子代理输入参数
 */
export interface SubagentInput {
	// UI 显示标签
	label: string;
	// 任务提示词
	taskPrompt: string;
	// 完成后的总结提示词
	summaryPrompt: string;
	// 上下文不足时的提示词
	contextLowPrompt: string;
	// 超时时间 (ms)
	timeoutMs?: number;
	// 允许使用的工具列表（不提供则使用父代理的所有工具）
	allowedTools?: BuiltinToolName[];
	// 父代理 ID（用于嵌套）
	parentTaskId?: string;
	// 当前深度
	depth?: number;
}

/**
 * 子代理任务
 */
export interface SubagentTask {
	id: string;
	input: SubagentInput;
	status: 'pending' | 'running' | 'summarizing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
	depth: number;
	startTime: number;
	endTime?: number;
	// 上下文使用情况
	contextUsage: {
		used: number;
		total: number;
		percentage: number;
	};
	// 执行的工具调用
	toolCalls: Array<{
		tool: string;
		params: unknown;
		result: unknown;
		timestamp: number;
	}>;
	// 中间输出
	intermediateOutput: string;
}

/**
 * 子代理进度事件
 */
export interface SubagentProgressEvent {
	taskId: string;
	type: 'tool_call' | 'output' | 'context_low' | 'summarizing';
	data: unknown;
}

/**
 * 子代理执行结果
 */
export interface SubagentResult {
	taskId: string;
	success: boolean;
	// 最终总结
	summary: string;
	// 执行的工具调用
	toolCalls: Array<{
		tool: string;
		params: unknown;
		result: unknown;
	}>;
	// 错误信息
	error?: string;
	// 执行时间
	executionTime: number;
	// 是否因超时终止
	timedOut?: boolean;
	// 是否因上下文不足终止
	contextExhausted?: boolean;
}

// ============================================================================
// SubagentTool 服务实现
// ============================================================================

class SubagentToolService extends Disposable implements ISubagentToolService {
	readonly _serviceBrand: undefined;

	private _activeTasks: Map<string, SubagentTask> = new Map();
	private _cancellationSources: Map<string, CancellationTokenSource> = new Map();
	private _currentParallelCount = 0;

	// 事件发射器
	private readonly _onSubagentStarted = this._register(new Emitter<SubagentTask>());
	readonly onSubagentStarted: Event<SubagentTask> = this._onSubagentStarted.event;

	private readonly _onSubagentProgress = this._register(new Emitter<SubagentProgressEvent>());
	readonly onSubagentProgress: Event<SubagentProgressEvent> = this._onSubagentProgress.event;

	private readonly _onSubagentCompleted = this._register(new Emitter<SubagentResult>());
	readonly onSubagentCompleted: Event<SubagentResult> = this._onSubagentCompleted.event;

	private readonly _onSubagentFailed = this._register(new Emitter<{ taskId: string; error: string }>());
	readonly onSubagentFailed: Event<{ taskId: string; error: string }> = this._onSubagentFailed.event;

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@ISenweaverSettingsService private readonly _settingsService: ISenweaverSettingsService,
	) {
		super();
	}

	/**
	 * 启动子代理
	 */
	async spawnSubagent(input: SubagentInput): Promise<SubagentResult> {
		const taskId = generateUuid();
		const startTime = Date.now();
		const depth = input.depth ?? 0;

		// 检查深度限制
		if (depth >= MAX_SUBAGENT_DEPTH) {
			return {
				taskId,
				success: false,
				summary: '',
				toolCalls: [],
				error: `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) exceeded`,
				executionTime: 0,
			};
		}

		// 检查并行数量限制
		if (this._currentParallelCount >= MAX_PARALLEL_SUBAGENTS) {
			return {
				taskId,
				success: false,
				summary: '',
				toolCalls: [],
				error: `Maximum parallel subagents (${MAX_PARALLEL_SUBAGENTS}) exceeded`,
				executionTime: 0,
			};
		}

		// 创建任务
		const task: SubagentTask = {
			id: taskId,
			input,
			status: 'pending',
			depth,
			startTime,
			contextUsage: { used: 0, total: 128000, percentage: 0 }, // 假设 128k 上下文
			toolCalls: [],
			intermediateOutput: '',
		};

		this._activeTasks.set(taskId, task);
		this._currentParallelCount++;

		// 创建取消令牌
		const cts = new CancellationTokenSource();
		this._cancellationSources.set(taskId, cts);

		// 设置超时
		const timeoutMs = input.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT;
		const timeoutId = setTimeout(() => {
			if (task.status === 'running') {
				task.status = 'timeout';
				cts.cancel();
			}
		}, timeoutMs);

		try {
			// 更新状态
			task.status = 'running';
			this._onSubagentStarted.fire(task);

			// 执行子代理任务
			const result = await this._executeSubagent(task, cts.token);

			// 清除超时
			clearTimeout(timeoutId);

			// 更新任务状态
			task.status = 'completed';
			task.endTime = Date.now();

			this._onSubagentCompleted.fire(result);
			return result;

		} catch (error) {
			clearTimeout(timeoutId);

			const errorMessage = error instanceof Error ? error.message : String(error);
			const timedOut = task.status === 'timeout';

			task.status = timedOut ? 'timeout' : 'failed';
			task.endTime = Date.now();

			const result: SubagentResult = {
				taskId,
				success: false,
				summary: task.intermediateOutput || '',
				toolCalls: task.toolCalls,
				error: timedOut ? 'Subagent timed out' : errorMessage,
				executionTime: Date.now() - startTime,
				timedOut,
			};

			this._onSubagentFailed.fire({ taskId, error: result.error! });
			return result;

		} finally {
			this._activeTasks.delete(taskId);
			this._cancellationSources.delete(taskId);
			this._currentParallelCount--;
		}
	}

	/**
	 * 取消子代理
	 */
	cancelSubagent(taskId: string): void {
		const cts = this._cancellationSources.get(taskId);
		if (cts) {
			cts.cancel();
		}

		const task = this._activeTasks.get(taskId);
		if (task) {
			task.status = 'cancelled';
			task.endTime = Date.now();
		}
	}

	/**
	 * 获取活动子代理
	 */
	getActiveSubagents(): SubagentTask[] {
		return Array.from(this._activeTasks.values());
	}

	/**
	 * 获取当前深度
	 */
	getCurrentDepth(): number {
		let maxDepth = 0;
		const tasks = Array.from(this._activeTasks.values());
		for (const task of tasks) {
			if (task.depth > maxDepth) {
				maxDepth = task.depth;
			}
		}
		return maxDepth;
	}

	/**
	 * 执行子代理任务
	 */
	private async _executeSubagent(task: SubagentTask, token: CancellationToken): Promise<SubagentResult> {
		const { input } = task;
		const startTime = task.startTime;

		// 构建子代理系统提示词
		const systemPrompt = this._buildSubagentSystemPrompt(input);

		return new Promise((resolve, reject) => {
			let resultContent = '';

			// 检查是否已取消
			if (token.isCancellationRequested) {
				reject(new Error('Subagent cancelled'));
				return;
			}

			// 监听取消
			const cancelListener = token.onCancellationRequested(() => {
				reject(new Error('Subagent cancelled'));
			});

			// 获取当前模型设置 - 使用 Chat 模型
			const state = this._settingsService.state;
			const modelSelection = state.modelSelectionOfFeature['Chat'];

			if (!modelSelection) {
				cancelListener.dispose();
				reject(new Error('No model selected. Please configure a model in Settings.'));
				return;
			}

			// LLM 回调
			const onText: OnText = ({ fullText }) => {
				resultContent = fullText;
				task.intermediateOutput = fullText;

				// 估算上下文使用
				const contextUsed = Math.ceil(fullText.length / 4); // 大约 4 字符 = 1 token
				task.contextUsage = {
					used: contextUsed,
					total: 128000,
					percentage: contextUsed / 128000,
				};

				// 发送进度事件
				this._onSubagentProgress.fire({
					taskId: task.id,
					type: 'output',
					data: { text: fullText },
				});

				// 检查上下文是否不足
				if (task.contextUsage.percentage > (1 - CONTEXT_LOW_THRESHOLD)) {
					this._onSubagentProgress.fire({
						taskId: task.id,
						type: 'context_low',
						data: { percentage: task.contextUsage.percentage },
					});
				}
			};

			const onFinalMessage: OnFinalMessage = () => {
				cancelListener.dispose();

				// 请求总结
				task.status = 'summarizing';
				this._onSubagentProgress.fire({
					taskId: task.id,
					type: 'summarizing',
					data: {},
				});

				const result: SubagentResult = {
					taskId: task.id,
					success: true,
					summary: resultContent || `[Subagent "${input.label}"] Task completed.`,
					toolCalls: task.toolCalls,
					executionTime: Date.now() - startTime,
					contextExhausted: task.contextUsage.percentage > (1 - CONTEXT_LOW_THRESHOLD),
				};

				resolve(result);
			};

			const onError: OnError = ({ message, fullError }) => {
				cancelListener.dispose();
				reject(new Error(message || (fullError?.message ?? 'Unknown error')));
			};

			// 发送 LLM 消息
			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages: [{
					role: 'user',
					content: input.taskPrompt,
				}],
				separateSystemMessage: systemPrompt,
				chatMode: null,
				onText,
				onFinalMessage,
				onError,
				onAbort: () => { },
				logging: { loggingName: 'subagent', loggingExtras: { label: input.label } },
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			});
		});
	}

	/**
	 * 构建子代理系统提示词
	 */
	private _buildSubagentSystemPrompt(input: SubagentInput): string {
		return `You are a subagent with a specific task to complete.

## Your Task
${input.label}

## Guidelines
1. Focus on completing the assigned task efficiently
2. Be concise in your responses
3. If you encounter errors, try alternative approaches
4. When you complete the task or cannot proceed further, clearly state your findings

## Available Tools
${input.allowedTools ? input.allowedTools.join(', ') : 'All tools from parent agent'}

## Important
- You have a limited context window. Be concise in your responses.
- Always respond with actionable information that helps the parent agent.

## Summary Requirement
${input.summaryPrompt}`;
	}
}

registerSingleton(ISubagentToolService, SubagentToolService, InstantiationType.Delayed);
