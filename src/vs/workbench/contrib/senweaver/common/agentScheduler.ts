/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	AgentDefinition,
	AgentExecutionContext,
	AgentExecutionResult,
	getAgentDefinition,
	getAgentComposition,
	recommendSubAgents,
	shouldUseSubAgents,
	createAgentExecutionContext,
	canAgentUseTool,
} from './agentService.js';
import { ChatMode } from './senweaverSettingsTypes.js';
import { BuiltinToolName } from './toolsServiceTypes.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * Agent 调度器
 *
 * 负责：
 * 1. 根据 ChatMode 选择合适的 Agent 组合
 * 2. 分析任务并决定是否使用子代理
 * 3. 并行调度子代理执行任务
 * 4. 收集和合并执行结果
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 子代理任务
 */
export interface SubAgentTask {
	agentId: string;
	taskDescription: string;
	priority: number;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	result?: AgentExecutionResult;
	error?: string;
}

/**
 * 调度会话
 */
export interface SchedulingSession {
	id: string;
	chatMode: ChatMode;
	primaryAgentId: string;
	subAgentTasks: SubAgentTask[];
	startTime: number;
	endTime?: number;
	status: 'planning' | 'executing' | 'completed' | 'failed';
}

/**
 * 调度事件
 */
export interface SchedulingEvent {
	sessionId: string;
	type: 'session_start' | 'task_start' | 'task_complete' | 'task_failed' | 'session_complete';
	agentId?: string;
	data?: unknown;
}

// ============================================================================
// Agent 调度器实现
// ============================================================================

export class AgentScheduler extends Disposable {
	private _currentSession: SchedulingSession | null = null;
	private _sessionIdCounter = 0;

	// 事件发射器
	private readonly _onSchedulingEvent = this._register(new Emitter<SchedulingEvent>());
	public readonly onSchedulingEvent: Event<SchedulingEvent> = this._onSchedulingEvent.event;

	private readonly _onSubAgentOutput = this._register(new Emitter<{ agentId: string; output: string }>());
	public readonly onSubAgentOutput: Event<{ agentId: string; output: string }> = this._onSubAgentOutput.event;

	constructor() {
		super();
	}

	/**
	 * 获取当前调度会话
	 */
	public getCurrentSession(): SchedulingSession | null {
		return this._currentSession;
	}

	/**
	 * 开始新的调度会话
	 */
	public startSession(chatMode: ChatMode): SchedulingSession {
		const composition = getAgentComposition(chatMode);
		const session: SchedulingSession = {
			id: `session_${++this._sessionIdCounter}`,
			chatMode,
			primaryAgentId: composition.primaryAgent,
			subAgentTasks: [],
			startTime: Date.now(),
			status: 'planning',
		};

		this._currentSession = session;
		this._onSchedulingEvent.fire({
			sessionId: session.id,
			type: 'session_start',
			data: { chatMode, primaryAgent: composition.primaryAgent },
		});

		return session;
	}

	/**
	 * 分析任务并规划子代理
	 * 返回推荐的子代理列表
	 */
	public planSubAgents(taskDescription: string): string[] {
		if (!this._currentSession) {
			return [];
		}

		const { chatMode } = this._currentSession;

		// 检查是否需要使用子代理
		if (!shouldUseSubAgents(taskDescription, chatMode)) {
			return [];
		}

		// 获取推荐的子代理
		const recommended = recommendSubAgents(taskDescription, chatMode);

		// 为每个推荐的子代理创建任务
		this._currentSession.subAgentTasks = recommended.map((agentId, index) => ({
			agentId,
			taskDescription: this._generateSubTaskDescription(agentId, taskDescription),
			priority: index,
			status: 'pending' as const,
		}));

		return recommended;
	}

	/**
	 * 为子代理生成具体的任务描述
	 */
	private _generateSubTaskDescription(agentId: string, originalTask: string): string {
		const agent = getAgentDefinition(agentId);
		if (!agent) return originalTask;

		// 根据代理类型生成特定的任务描述
		switch (agentId) {
			case 'explore':
				return `探索代码库，找到与以下任务相关的文件和代码：${originalTask}`;
			case 'plan':
				return `分析以下任务并制定执行计划：${originalTask}`;
			case 'code':
				return `实现以下编码任务：${originalTask}`;
			case 'review':
				return `审查以下任务相关的代码：${originalTask}`;
			case 'test':
				return `为以下功能编写测试：${originalTask}`;
			case 'ui':
				return `设计和实现以下 UI：${originalTask}`;
			case 'api':
				return `设计和实现以下 API：${originalTask}`;
			default:
				return originalTask;
		}
	}

	/**
	 * 添加子代理任务
	 */
	public addSubAgentTask(agentId: string, taskDescription: string, priority: number = 0): SubAgentTask | null {
		if (!this._currentSession) return null;

		const agent = getAgentDefinition(agentId);
		if (!agent || agent.mode !== 'subagent') return null;

		const task: SubAgentTask = {
			agentId,
			taskDescription,
			priority,
			status: 'pending',
		};

		this._currentSession.subAgentTasks.push(task);
		return task;
	}

	/**
	 * 执行所有待处理的子代理任务
	 * 支持并行执行
	 */
	public async executeSubAgentTasks(
		executor: (context: AgentExecutionContext) => Promise<AgentExecutionResult>
	): Promise<AgentExecutionResult[]> {
		if (!this._currentSession) {
			return [];
		}

		const session = this._currentSession;
		session.status = 'executing';

		const composition = getAgentComposition(session.chatMode);
		const pendingTasks = session.subAgentTasks.filter(t => t.status === 'pending');

		if (pendingTasks.length === 0) {
			return [];
		}

		const results: AgentExecutionResult[] = [];

		if (composition.enableParallel) {
			// 并行执行
			const chunks = this._chunkArray(pendingTasks, composition.maxParallel);

			for (const chunk of chunks) {
				const chunkPromises = chunk.map(async (task) => {
					return this._executeTask(task, executor);
				});

				const chunkResults = await Promise.allSettled(chunkPromises);
				for (const result of chunkResults) {
					if (result.status === 'fulfilled' && result.value) {
						results.push(result.value);
					}
				}
			}
		} else {
			// 顺序执行
			for (const task of pendingTasks) {
				const result = await this._executeTask(task, executor);
				if (result) {
					results.push(result);
				}
			}
		}

		session.status = 'completed';
		session.endTime = Date.now();

		this._onSchedulingEvent.fire({
			sessionId: session.id,
			type: 'session_complete',
			data: { results },
		});

		return results;
	}

	/**
	 * 执行单个任务
	 */
	private async _executeTask(
		task: SubAgentTask,
		executor: (context: AgentExecutionContext) => Promise<AgentExecutionResult>
	): Promise<AgentExecutionResult | null> {
		if (!this._currentSession) return null;

		task.status = 'running';
		this._onSchedulingEvent.fire({
			sessionId: this._currentSession.id,
			type: 'task_start',
			agentId: task.agentId,
			data: { taskDescription: task.taskDescription },
		});

		try {
			const context = createAgentExecutionContext(task.agentId, task.taskDescription, {
				parentAgentId: this._currentSession.primaryAgentId,
				depth: 1,
				maxDepth: 2,
			});

			const result = await executor(context);
			task.status = 'completed';
			task.result = result;

			this._onSchedulingEvent.fire({
				sessionId: this._currentSession.id,
				type: 'task_complete',
				agentId: task.agentId,
				data: result,
			});

			return result;
		} catch (error) {
			task.status = 'failed';
			task.error = error instanceof Error ? error.message : String(error);

			this._onSchedulingEvent.fire({
				sessionId: this._currentSession.id,
				type: 'task_failed',
				agentId: task.agentId,
				data: { error: task.error },
			});

			return null;
		}
	}

	/**
	 * 合并子代理结果
	 */
	public mergeSubAgentResults(results: AgentExecutionResult[]): string {
		if (results.length === 0) {
			return '';
		}

		const sections: string[] = [];

		for (const result of results) {
			if (result.success && result.output) {
				const agent = getAgentDefinition(result.agentId);
				const agentName = agent?.name || result.agentId;
				sections.push(`## ${agentName} 结果\n\n${result.output}`);
			}
		}

		return sections.join('\n\n---\n\n');
	}

	/**
	 * 获取当前 Agent 的系统提示词
	 */
	public getAgentSystemPrompt(agentId: string): string | undefined {
		const agent = getAgentDefinition(agentId);
		return agent?.systemPrompt;
	}

	/**
	 * 获取当前模式的主 Agent
	 */
	public getPrimaryAgent(chatMode: ChatMode): AgentDefinition | undefined {
		const composition = getAgentComposition(chatMode);
		return getAgentDefinition(composition.primaryAgent);
	}

	/**
	 * 检查工具是否被当前 Agent 允许
	 */
	public isToolAllowed(agentId: string, toolName: BuiltinToolName): boolean {
		return canAgentUseTool(agentId, toolName);
	}

	/**
	 * 过滤 Agent 允许的工具列表
	 */
	public filterAllowedTools(agentId: string, tools: BuiltinToolName[]): BuiltinToolName[] {
		return tools.filter(tool => canAgentUseTool(agentId, tool));
	}

	/**
	 * 结束当前会话
	 */
	public endSession(): void {
		if (this._currentSession) {
			this._currentSession.status = 'completed';
			this._currentSession.endTime = Date.now();
			this._currentSession = null;
		}
	}

	/**
	 * 取消当前会话
	 */
	public cancelSession(): void {
		if (this._currentSession) {
			for (const task of this._currentSession.subAgentTasks) {
				if (task.status === 'pending' || task.status === 'running') {
					task.status = 'cancelled';
				}
			}
			this._currentSession.status = 'failed';
			this._currentSession.endTime = Date.now();
			this._currentSession = null;
		}
	}

	/**
	 * 辅助方法：将数组分块
	 */
	private _chunkArray<T>(array: T[], chunkSize: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += chunkSize) {
			chunks.push(array.slice(i, i + chunkSize));
		}
		return chunks;
	}
}

// ============================================================================
// 单例实例
// ============================================================================

let _agentSchedulerInstance: AgentScheduler | null = null;

/**
 * 获取 AgentScheduler 单例
 */
export function getAgentScheduler(): AgentScheduler {
	if (!_agentSchedulerInstance) {
		_agentSchedulerInstance = new AgentScheduler();
	}
	return _agentSchedulerInstance;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 Agent 的增强系统提示词
 * 结合 Agent 定义和用户自定义指令
 */
export function getEnhancedSystemPrompt(
	agentId: string,
	userInstructions?: string,
	additionalContext?: string
): string {
	const agent = getAgentDefinition(agentId);
	if (!agent) {
		return userInstructions || '';
	}

	const parts: string[] = [];

	// Agent 角色描述
	parts.push(`你是 ${agent.name}。${agent.description}`);

	// Agent 专属系统提示词
	if (agent.systemPrompt) {
		parts.push(agent.systemPrompt);
	}

	// 权限说明
	const permissionDesc = getPermissionDescription(agent);
	if (permissionDesc) {
		parts.push(`## 权限\n${permissionDesc}`);
	}

	// 用户自定义指令
	if (userInstructions) {
		parts.push(`## 用户指令\n${userInstructions}`);
	}

	// 额外上下文
	if (additionalContext) {
		parts.push(additionalContext);
	}

	return parts.join('\n\n');
}

/**
 * 获取权限描述文本
 */
function getPermissionDescription(agent: AgentDefinition): string {
	const { permission } = agent;
	const lines: string[] = [];

	if (permission.canRead && permission.canWrite) {
		lines.push('- 可以读取和修改文件');
	} else if (permission.canRead) {
		lines.push('- 只能读取文件，不能修改');
	}

	if (permission.canExecuteTerminal) {
		lines.push('- 可以执行终端命令');
	}

	if (permission.canAccessNetwork) {
		lines.push('- 可以访问网络');
	}

	if (permission.canUseMCP) {
		lines.push('- 可以使用 MCP 工具');
	}

	return lines.join('\n');
}

/**
 * 根据 ChatMode 获取工具过滤函数
 * 用于限制不同模式下可用的工具
 */
export function getToolFilterForMode(chatMode: ChatMode): (toolName: BuiltinToolName) => boolean {
	const composition = getAgentComposition(chatMode);
	const primaryAgent = getAgentDefinition(composition.primaryAgent);

	if (!primaryAgent) {
		return () => true;
	}

	return (toolName: BuiltinToolName) => canAgentUseTool(primaryAgent.id, toolName);
}
