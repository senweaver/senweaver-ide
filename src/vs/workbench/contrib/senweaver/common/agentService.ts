/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMode } from './senweaverSettingsTypes.js';
import { BuiltinToolName } from './toolsServiceTypes.js';

/**
 * Multi-Agent 系统
 *
 * 设计理念：
 * - 用户界面保持三种模式不变（Chat、Agent with Tools、Designer with Builder）
 * - 后端使用 Multi-Agent 架构，每种模式由一组专业化子代理协作完成
 * - 主代理负责任务分解和调度，子代理并行执行专业任务
 *
 * 参考 OpenCode 的 Agent 系统，但优化为更适合 IDE 集成的架构
 */

// ============================================================================
// Agent 类型定义
// ============================================================================

/**
 * Agent 模式
 * - primary: 主代理，直接响应用户
 * - subagent: 子代理，被主代理调用执行专业任务
 * - system: 系统代理，执行内部任务（如压缩、总结）
 */
export type AgentMode = 'primary' | 'subagent' | 'system';

/**
 * Agent 权限级别
 */
export type AgentPermissionLevel = 'full' | 'read_only' | 'execute_only' | 'none';

/**
 * Agent 权限配置
 */
export interface AgentPermission {
	// 文件操作权限
	canRead: boolean;
	canWrite: boolean;
	canDelete: boolean;
	// 工具使用权限
	allowedTools: BuiltinToolName[] | '*';
	deniedTools: BuiltinToolName[];
	// 外部访问权限
	canAccessNetwork: boolean;
	canExecuteTerminal: boolean;
	canUseMCP: boolean;
}

/**
 * Agent 定义
 */
export interface AgentDefinition {
	id: string;
	name: string;
	description: string;
	mode: AgentMode;
	// 权限配置
	permission: AgentPermission;
	// 系统提示词（可选，用于覆盖默认提示词）
	systemPrompt?: string;
	// 模型配置（可选，用于使用特定模型）
	preferredModel?: {
		providerName: string;
		modelName: string;
	};
	// 温度和其他参数
	temperature?: number;
	topP?: number;
	// 最大步骤数（防止无限循环）
	maxSteps?: number;
	// 是否隐藏（不在 UI 显示）
	hidden?: boolean;
}

/**
 * Agent 执行上下文
 */
export interface AgentExecutionContext {
	agentId: string;
	parentAgentId?: string;
	taskDescription: string;
	depth: number;
	maxDepth: number;
	startTime: number;
	abortSignal?: AbortSignal;
}

/**
 * Agent 执行结果
 */
export interface AgentExecutionResult {
	agentId: string;
	success: boolean;
	output: string;
	error?: string;
	toolCalls?: Array<{
		tool: string;
		params: Record<string, unknown>;
		result: unknown;
	}>;
	subAgentResults?: AgentExecutionResult[];
	executionTime: number;
}

// ============================================================================
// 默认权限配置
// ============================================================================

const DEFAULT_FULL_PERMISSION: AgentPermission = {
	canRead: true,
	canWrite: true,
	canDelete: true,
	allowedTools: '*',
	deniedTools: [],
	canAccessNetwork: true,
	canExecuteTerminal: true,
	canUseMCP: true,
};

const DEFAULT_READ_ONLY_PERMISSION: AgentPermission = {
	canRead: true,
	canWrite: false,
	canDelete: false,
	allowedTools: ['read_file', 'ls_dir', 'get_dir_tree', 'search_pathnames_only', 'search_for_files', 'search_in_file', 'read_lint_errors'],
	deniedTools: ['rewrite_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder', 'run_command'],
	canAccessNetwork: true,
	canExecuteTerminal: false,
	canUseMCP: false,
};

const DEFAULT_EXPLORE_PERMISSION: AgentPermission = {
	canRead: true,
	canWrite: false,
	canDelete: false,
	allowedTools: ['read_file', 'ls_dir', 'get_dir_tree', 'search_pathnames_only', 'search_for_files', 'search_in_file', 'web_search', 'fetch_url'],
	deniedTools: ['rewrite_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder'],
	canAccessNetwork: true,
	canExecuteTerminal: false,
	canUseMCP: false,
};

const DEFAULT_SYSTEM_PERMISSION: AgentPermission = {
	canRead: false,
	canWrite: false,
	canDelete: false,
	allowedTools: [],
	deniedTools: [],
	canAccessNetwork: false,
	canExecuteTerminal: false,
	canUseMCP: false,
};

// ============================================================================
// 内置 Agent 定义
// ============================================================================

/**
 * 内置 Agent 列表
 * 参考 OpenCode 的设计，但针对 IDE 环境优化
 */
export const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
	// ========== 主代理 (Primary Agents) ==========

	/**
	 * Build Agent - 主构建代理
	 * 用于 "Agent with Tools" 模式
	 * 具有完整权限，可以读写文件、执行命令
	 */
	build: {
		id: 'build',
		name: 'Build Agent',
		description: '主构建代理，具有完整权限，可以读写文件、执行命令、调用工具',
		mode: 'primary',
		permission: DEFAULT_FULL_PERMISSION,
		maxSteps: 50,
	},

	/**
	 * Chat Agent - 对话代理
	 * 用于 "Chat" 模式
	 * 主要用于代码讨论，不直接修改文件
	 */
	chat: {
		id: 'chat',
		name: 'Chat Agent',
		description: '对话代理，用于代码讨论和问答，可以读取文件但不直接修改',
		mode: 'primary',
		permission: {
			...DEFAULT_READ_ONLY_PERMISSION,
			canAccessNetwork: true,
		},
		maxSteps: 20,
	},

	/**
	 * Designer Agent - 设计代理
	 * 用于 "Designer with Builder" 模式
	 * 专注于 UI 设计和前后端开发
	 */
	designer: {
		id: 'designer',
		name: 'Designer Agent',
		description: '设计代理，专注于 UI 设计、组件开发和前后端接口设计',
		mode: 'primary',
		permission: DEFAULT_FULL_PERMISSION,
		maxSteps: 100,
	},

	// ========== 子代理 (Sub-Agents) ==========

	/**
	 * Explore Agent - 探索代理
	 * 快速探索代码库，只读操作
	 */
	explore: {
		id: 'explore',
		name: 'Explore Agent',
		description: '快速探索代码库，查找文件、搜索代码、理解项目结构。只读操作，不修改任何文件。',
		mode: 'subagent',
		permission: DEFAULT_EXPLORE_PERMISSION,
		systemPrompt: `你是一个专业的代码探索代理。你的任务是快速、高效地探索代码库。

你可以：
- 搜索文件名和路径 (search_pathnames_only)
- 搜索文件内容 (search_for_files, search_in_file)
- 读取文件 (read_file)
- 查看目录结构 (ls_dir, get_dir_tree)
- 网络搜索 (web_search, fetch_url)

你不能修改任何文件。专注于快速找到相关代码并提供清晰的分析。`,
		maxSteps: 15,
		temperature: 0.3,
	},

	/**
	 * Plan Agent - 规划代理
	 * 分析任务并制定执行计划
	 */
	plan: {
		id: 'plan',
		name: 'Plan Agent',
		description: '分析复杂任务并制定详细的执行计划，将大任务分解为可执行的小步骤',
		mode: 'subagent',
		permission: {
			...DEFAULT_READ_ONLY_PERMISSION,
			allowedTools: ['read_file', 'ls_dir', 'get_dir_tree', 'search_pathnames_only', 'search_for_files'],
		},
		systemPrompt: `你是一个专业的任务规划代理。你的任务是分析用户请求并制定清晰的执行计划。

对于每个任务：
1. 理解用户的最终目标
2. 分析当前代码库状态
3. 制定分步执行计划
4. 识别潜在风险和依赖

输出格式：
## 任务分析
[对任务的理解]

## 执行计划
1. [步骤1]
2. [步骤2]
...

## 注意事项
[潜在风险和依赖]`,
		maxSteps: 10,
		temperature: 0.2,
	},

	/**
	 * Code Agent - 编码代理
	 * 专注于代码编写和修改
	 */
	code: {
		id: 'code',
		name: 'Code Agent',
		description: '专注于代码编写和修改，执行具体的编码任务',
		mode: 'subagent',
		permission: {
			canRead: true,
			canWrite: true,
			canDelete: false,
			allowedTools: ['read_file', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'search_for_files', 'search_in_file', 'read_lint_errors'],
			deniedTools: ['delete_file_or_folder', 'run_command'],
			canAccessNetwork: false,
			canExecuteTerminal: false,
			canUseMCP: false,
		},
		systemPrompt: `你是一个专业的编码代理。你的任务是高质量地完成代码编写和修改任务。

编码原则：
1. 遵循现有代码风格
2. 保持代码简洁清晰
3. 添加必要的错误处理
4. 不要删除现有注释
5. 修改后检查 lint 错误`,
		maxSteps: 30,
		temperature: 0.1,
	},

	/**
	 * Review Agent - 审查代理
	 * 代码审查和质量检查
	 */
	review: {
		id: 'review',
		name: 'Review Agent',
		description: '代码审查代理，检查代码质量、潜在问题和最佳实践',
		mode: 'subagent',
		permission: DEFAULT_READ_ONLY_PERMISSION,
		systemPrompt: `你是一个专业的代码审查代理。你的任务是审查代码并提供改进建议。

审查要点：
1. 代码正确性
2. 性能问题
3. 安全漏洞
4. 代码风格
5. 最佳实践

输出格式：
## 审查结果
[总体评价]

## 发现的问题
- [问题1]: [描述] - [建议]
- [问题2]: [描述] - [建议]

## 改进建议
[可选的优化建议]`,
		maxSteps: 10,
		temperature: 0.2,
	},

	/**
	 * Test Agent - 测试代理
	 * 编写和执行测试
	 */
	test: {
		id: 'test',
		name: 'Test Agent',
		description: '测试代理，编写单元测试、集成测试，验证代码正确性',
		mode: 'subagent',
		permission: {
			canRead: true,
			canWrite: true,
			canDelete: false,
			allowedTools: ['read_file', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'search_for_files', 'run_command'],
			deniedTools: ['delete_file_or_folder'],
			canAccessNetwork: false,
			canExecuteTerminal: true,
			canUseMCP: false,
		},
		maxSteps: 20,
		temperature: 0.1,
	},

	/**
	 * UI Agent - UI 代理
	 * 专注于 UI 设计和组件开发
	 */
	ui: {
		id: 'ui',
		name: 'UI Agent',
		description: 'UI 代理，专注于界面设计、组件开发和样式优化',
		mode: 'subagent',
		permission: {
			canRead: true,
			canWrite: true,
			canDelete: false,
			allowedTools: ['read_file', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'search_for_files', 'web_search', 'fetch_url'],
			deniedTools: ['delete_file_or_folder', 'run_command'],
			canAccessNetwork: true,
			canExecuteTerminal: false,
			canUseMCP: false,
		},
		systemPrompt: `你是一个专业的 UI 设计和开发代理。你的任务是创建美观、易用的用户界面。

设计原则：
1. 现代化设计风格
2. 响应式布局
3. 良好的用户体验
4. 遵循设计系统
5. 可访问性`,
		maxSteps: 30,
		temperature: 0.3,
	},

	/**
	 * API Agent - API 代理
	 * 专注于后端 API 开发
	 */
	api: {
		id: 'api',
		name: 'API Agent',
		description: 'API 代理，专注于后端接口设计、开发和文档',
		mode: 'subagent',
		permission: {
			canRead: true,
			canWrite: true,
			canDelete: false,
			allowedTools: ['read_file', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'search_for_files', 'web_search'],
			deniedTools: ['delete_file_or_folder'],
			canAccessNetwork: true,
			canExecuteTerminal: false,
			canUseMCP: false,
		},
		maxSteps: 25,
		temperature: 0.1,
	},

	// ========== 系统代理 (System Agents) ==========

	/**
	 * Compaction Agent - 压缩代理
	 * 用于会话压缩，生成摘要
	 */
	compaction: {
		id: 'compaction',
		name: 'Compaction Agent',
		description: '会话压缩代理，生成对话历史的简洁摘要',
		mode: 'system',
		permission: DEFAULT_SYSTEM_PERMISSION,
		hidden: true,
		temperature: 0.3,
	},

	/**
	 * Summary Agent - 总结代理
	 * 生成任务执行摘要
	 */
	summary: {
		id: 'summary',
		name: 'Summary Agent',
		description: '总结代理，生成任务执行的摘要报告',
		mode: 'system',
		permission: DEFAULT_SYSTEM_PERMISSION,
		hidden: true,
		temperature: 0.3,
	},

	/**
	 * Title Agent - 标题代理
	 * 生成对话标题
	 */
	title: {
		id: 'title',
		name: 'Title Agent',
		description: '标题代理，为对话生成简洁的标题',
		mode: 'system',
		permission: DEFAULT_SYSTEM_PERMISSION,
		hidden: true,
		temperature: 0.5,
	},
};

// ============================================================================
// ChatMode 到 Agent 组合的映射
// ============================================================================

/**
 * Agent 组合配置
 * 定义每种 ChatMode 使用的主代理和可调用的子代理
 */
export interface AgentComposition {
	// 主代理 ID
	primaryAgent: string;
	// 可用的子代理列表
	availableSubAgents: string[];
	// 是否启用并行执行
	enableParallel: boolean;
	// 最大并行数
	maxParallel: number;
	// 是否自动选择子代理
	autoSelectSubAgents: boolean;
}

/**
 * 每种 ChatMode 的 Agent 组合配置
 */
export const AGENT_COMPOSITIONS: Record<ChatMode, AgentComposition> = {
	// Chat 模式：对话为主，可以探索代码
	normal: {
		primaryAgent: 'chat',
		availableSubAgents: ['explore'],
		enableParallel: false,
		maxParallel: 1,
		autoSelectSubAgents: false,
	},

	// Agent with Tools 模式：完整的代理能力
	agent: {
		primaryAgent: 'build',
		availableSubAgents: ['explore', 'plan', 'code', 'review', 'test'],
		enableParallel: true,
		maxParallel: 3,
		autoSelectSubAgents: true,
	},

	// Designer 模式：专注于 UI 和 API 开发
	designer: {
		primaryAgent: 'designer',
		availableSubAgents: ['explore', 'plan', 'ui', 'api', 'code', 'review'],
		enableParallel: true,
		maxParallel: 4,
		autoSelectSubAgents: true,
	},

	// Gather 模式：只读探索
	gather: {
		primaryAgent: 'chat',
		availableSubAgents: ['explore'],
		enableParallel: false,
		maxParallel: 1,
		autoSelectSubAgents: false,
	},
};

// ============================================================================
// Agent 管理服务
// ============================================================================

/**
 * 获取指定 ChatMode 的 Agent 组合
 */
export function getAgentComposition(chatMode: ChatMode): AgentComposition {
	return AGENT_COMPOSITIONS[chatMode];
}

/**
 * 获取 Agent 定义
 */
export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
	return BUILTIN_AGENTS[agentId];
}

/**
 * 获取所有可见的 Agent 列表
 */
export function getVisibleAgents(): AgentDefinition[] {
	return Object.values(BUILTIN_AGENTS).filter(agent => !agent.hidden);
}

/**
 * 获取指定模式的所有 Agent
 */
export function getAgentsByMode(mode: AgentMode): AgentDefinition[] {
	return Object.values(BUILTIN_AGENTS).filter(agent => agent.mode === mode);
}

/**
 * 检查 Agent 是否有权限使用某个工具
 */
export function canAgentUseTool(agentId: string, toolName: BuiltinToolName): boolean {
	const agent = getAgentDefinition(agentId);
	if (!agent) return false;

	const { permission } = agent;

	// 检查是否在禁止列表中
	if (permission.deniedTools.includes(toolName)) {
		return false;
	}

	// 检查是否允许所有工具
	if (permission.allowedTools === '*') {
		return true;
	}

	// 检查是否在允许列表中
	return permission.allowedTools.includes(toolName);
}

/**
 * 根据任务描述推荐子代理
 * 使用简单的关键词匹配，后续可以升级为 LLM 判断
 */
export function recommendSubAgents(taskDescription: string, chatMode: ChatMode): string[] {
	const composition = getAgentComposition(chatMode);
	if (!composition.autoSelectSubAgents) {
		return [];
	}

	const recommended: string[] = [];
	const lowerTask = taskDescription.toLowerCase();

	// 关键词匹配规则
	const rules: Array<{ keywords: string[]; agent: string }> = [
		{ keywords: ['搜索', '查找', '找到', '探索', 'search', 'find', 'explore', 'locate'], agent: 'explore' },
		{ keywords: ['计划', '规划', '设计方案', 'plan', 'design'], agent: 'plan' },
		{ keywords: ['编写', '修改', '实现', '代码', 'code', 'implement', 'write', 'modify'], agent: 'code' },
		{ keywords: ['审查', '检查', '优化', 'review', 'check', 'optimize'], agent: 'review' },
		{ keywords: ['测试', '验证', 'test', 'verify'], agent: 'test' },
		{ keywords: ['界面', 'ui', '组件', '样式', 'component', 'style', 'layout'], agent: 'ui' },
		{ keywords: ['接口', 'api', '后端', 'backend', 'endpoint'], agent: 'api' },
	];

	for (const rule of rules) {
		if (rule.keywords.some(kw => lowerTask.includes(kw))) {
			if (composition.availableSubAgents.includes(rule.agent)) {
				recommended.push(rule.agent);
			}
		}
	}

	// 去重并限制数量
	return [...new Set(recommended)].slice(0, composition.maxParallel);
}

/**
 * 创建 Agent 执行上下文
 */
export function createAgentExecutionContext(
	agentId: string,
	taskDescription: string,
	options?: {
		parentAgentId?: string;
		depth?: number;
		maxDepth?: number;
		abortSignal?: AbortSignal;
	}
): AgentExecutionContext {
	return {
		agentId,
		parentAgentId: options?.parentAgentId,
		taskDescription,
		depth: options?.depth ?? 0,
		maxDepth: options?.maxDepth ?? 3,
		startTime: Date.now(),
		abortSignal: options?.abortSignal,
	};
}

/**
 * 检查是否应该使用子代理
 * 根据任务复杂度和当前模式决定
 */
export function shouldUseSubAgents(taskDescription: string, chatMode: ChatMode): boolean {
	const composition = getAgentComposition(chatMode);

	// 如果不自动选择子代理，返回 false
	if (!composition.autoSelectSubAgents) {
		return false;
	}

	// 简单任务不需要子代理（少于 50 字符）
	if (taskDescription.length < 50) {
		return false;
	}

	// 检查是否包含复杂任务关键词
	const complexKeywords = [
		'重构', '优化', '实现', '创建', '设计',
		'refactor', 'optimize', 'implement', 'create', 'design',
		'多个文件', '整个项目', '全面',
		'multiple files', 'entire project', 'comprehensive'
	];

	return complexKeywords.some(kw => taskDescription.toLowerCase().includes(kw));
}
