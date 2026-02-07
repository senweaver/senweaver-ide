/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * 智能上下文管理器
 *
 * 核心功能：
 * 1. 动态滑动窗口 - 根据可用 token 自动调整保留的对话轮数
 * 2. 优先级机制 - 不同类型的上下文有不同优先级
 * 3. 智能压缩 - 对话历史和工具结果的智能压缩/摘要
 * 4. 代码感知 - 智能选择相关代码片段
 *
 * 目标：实现无限对话能力，同时保持上下文相关性，避免 TPM 限制
 */

// ============ 配置参数 ============
export const SMART_CONTEXT_CONFIG = {
	// Token 限制配置
	DEFAULT_MAX_TOKENS: 15000,
	MIN_CONTEXT_TOKENS: 5000,
	RESERVED_OUTPUT_TOKENS: 4000,

	// 滑动窗口配置
	MIN_RECENT_TURNS: 4,
	MAX_RECENT_TURNS: 8,
	RECENT_TOKEN_RATIO: 0.6,

	// 优先级配置（0-100，越高越重要）
	PRIORITY: {
		SYSTEM_PROMPT: 100,          // 系统提示词 - 永不删除
		CURRENT_INPUT: 99,           // 当前用户输入 - 永不删除
		RECENT_2_TURNS: 95,          // 最近2轮对话
		RECENT_4_TURNS: 85,          // 最近4轮对话
		CODE_CONTEXT: 75,            // 代码上下文
		OLDER_HISTORY: 50,           // 较早历史
		TOOL_RESULTS: 40,            // 工具结果
		COMPRESSED_SUMMARY: 60,      // 压缩摘要
	},

	// 压缩配置
	COMPRESSION: {
		ENABLE: true,
		THRESHOLD_MESSAGES: 10,      // 更早触发压缩
		SUMMARY_MAX_LENGTH: 400,     // 减少摘要长度
		TOOL_RESULT_MAX_LENGTH: 3000, // 减少工具结果长度
		ASSISTANT_MAX_LENGTH: 4000,  // 减少助手回复长度
	},

	// 动态调整
	ADAPTIVE: {
		ENABLE: true,
		TOKEN_BUFFER_RATIO: 0.15,
	},

	// ========== OpenCode Session Compaction 增强配置 ==========
	// Token溢出检测阈值
	OVERFLOW_THRESHOLD: 0.55,        // 55%时触发压缩（更早触发，留出更大的安全余量）

	// 工具输出裁剪配置 (Prune)
	PRUNE: {
		PROTECT_TOKENS: 20000,       // 保护最近的token数量（降低以更积极裁剪）
		MINIMUM_TOKENS: 15000,       // 最小裁剪量（降低门槛，使小量裁剪也能生效）
		PROTECT_RECENT_TURNS: 3,     // 保护最近N轮对话
		// 受保护的工具（输出不会被裁剪）
		// 注意：read_file 和 get_dir_tree 不再被保护！它们产生最大的输出，
		// 旧的读取结果应该被裁剪，助手可以在需要时重新读取
		PROTECTED_TOOLS: ['search_pathnames_only'] as string[],
		// 大输出裁剪阈值：超过此字符数的工具输出即使在保护轮次内也会被压缩
		LARGE_OUTPUT_THRESHOLD: 50_000,  // 50K chars ≈ 12.5K tokens
	},

	// 模型Context限制（用于动态调整）
	MODEL_CONTEXT_LIMITS: {
		'gpt-4': 128000,
		'gpt-4-turbo': 128000,
		'gpt-4o': 128000,
		'gpt-4o-mini': 128000,
		'gpt-3.5-turbo': 16385,
		'claude-3-opus': 200000,
		'claude-3-sonnet': 200000,
		'claude-3-haiku': 200000,
		'claude-3.5-sonnet': 200000,
		'claude-3.5-haiku': 200000,
		'claude-4-sonnet': 200000,
		'gemini-pro': 1000000,
		'gemini-1.5-pro': 1000000,
		'gemini-1.5-flash': 1000000,
		'gemini-2.0-flash': 1000000,
		'deepseek-chat': 64000,
		'deepseek-coder': 64000,
		'deepseek-reasoner': 64000,
		'qwen-turbo': 128000,
		'qwen-plus': 128000,
		'qwen-max': 128000,
		'glm-4': 128000,
		'glm-4-flash': 128000,
		'default': 128000,
	} as Record<string, number>,
} as const;

// ============ 类型定义 ============
export interface ContextPart {
	type: 'system' | 'user' | 'assistant' | 'tool' | 'code' | 'summary';
	content: string;
	tokens: number;
	priority: number;
	timestamp?: number;
	compressible: boolean;
	metadata?: {
		turnIndex?: number;
		toolName?: string;
		filePath?: string;
		isRecent?: boolean;
	};
}

export interface ContextBuildResult {
	parts: ContextPart[];
	totalTokens: number;
	originalTokens: number;
	compressionRatio: number;
	removedCount: number;
	summaryGenerated: boolean;
}

export interface MessageInput {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	timestamp?: number;
	toolName?: string;
	toolId?: string;
}

// ============ Token 估算器 ============
export class TokenEstimator {
	private static readonly CHARS_PER_TOKEN = 3.5;
	private cache = new Map<string, number>();

	estimate(text: string): number {
		if (!text) return 0;

		// 使用缓存
		const cacheKey = text.length > 100 ? text.substring(0, 100) + text.length : text;
		if (this.cache.has(cacheKey)) {
			return this.cache.get(cacheKey)!;
		}

		// 基础估算
		let tokens = Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN);

		// 代码通常 token 密度更高
		if (this.looksLikeCode(text)) {
			tokens = Math.ceil(tokens * 1.2);
		}

		// 缓存结果
		if (this.cache.size > 1000) {
			// 清理一半缓存
			const keys = Array.from(this.cache.keys());
			keys.slice(0, 500).forEach(k => this.cache.delete(k));
		}
		this.cache.set(cacheKey, tokens);

		return tokens;
	}

	private looksLikeCode(text: string): boolean {
		const codeIndicators = [
			/function\s+\w+/,
			/class\s+\w+/,
			/import\s+/,
			/export\s+/,
			/const\s+\w+\s*=/,
			/let\s+\w+\s*=/,
			/=>/,
			/\{\s*\n/,
		];
		return codeIndicators.some(regex => regex.test(text));
	}
}

// ============ 智能压缩器 ============
export class SmartCompressor {

	/**
	 * 压缩对话历史为摘要
	 * 🔧 修复：不再包含"执行操作"信息，避免误导 AI 继续执行不相关的任务
	 */
	compressHistoryToSummary(messages: MessageInput[]): string {
		if (messages.length === 0) return '';

		const topics = new Set<string>();
		// 🔧 只提取用户问题的关键词，不提取 AI 回复中的操作信息
		const userQuestions: string[] = [];

		for (const msg of messages) {
			// 只从用户消息中提取主题关键词
			if (msg.role === 'user') {
				const keywords = this.extractKeywords(msg.content);
				keywords.forEach(k => topics.add(k));
				// 保留用户问题的简短摘要
				if (msg.content.length < 100) {
					userQuestions.push(msg.content.trim());
				}
			}
		}

		const summaryParts: string[] = [];

		// 🔧 只显示用户讨论的主题，不显示 AI 的操作
		if (userQuestions.length > 0) {
			summaryParts.push(`用户问题: ${userQuestions.slice(-2).join('; ')}`);
		} else if (topics.size > 0) {
			summaryParts.push(`讨论主题: ${Array.from(topics).slice(0, 3).join(', ')}`);
		}
		summaryParts.push(`(已压缩 ${messages.length} 条早期对话)`);

		return summaryParts.join('\n');
	}

	/**
	 * 压缩工具结果
	 */
	compressToolResult(content: string, maxLength: number): string {
		if (content.length <= maxLength) return content;

		// 提取关键信息
		const lines = content.split('\n');
		const important: string[] = [];
		let currentLength = 0;

		for (const line of lines) {
			// 优先保留：错误信息、文件路径、关键数据
			const isImportant =
				line.includes('error') ||
				line.includes('Error') ||
				line.includes('warning') ||
				/[\/\\][\w\/\\.-]+\.\w+/.test(line) || // 文件路径
				line.trim().startsWith('•') ||
				line.trim().startsWith('-') ||
				line.trim().startsWith('*');

			if (isImportant || currentLength < maxLength * 0.3) {
				important.push(line);
				currentLength += line.length;
			}

			if (currentLength >= maxLength * 0.8) break;
		}

		if (important.length < lines.length) {
			important.push(`\n... (省略 ${lines.length - important.length} 行)`);
		}

		return important.join('\n').substring(0, maxLength);
	}

	/**
	 * 压缩 AI 回复
	 */
	compressAssistantMessage(content: string, maxLength: number): string {
		if (content.length <= maxLength) return content;

		// 保留代码块完整
		const codeBlocks: string[] = [];
		let textContent = content.replace(/```[\s\S]*?```/g, (match) => {
			codeBlocks.push(match);
			return `[CODE_BLOCK_${codeBlocks.length - 1}]`;
		});

		// 截断文本部分
		if (textContent.length > maxLength * 0.6) {
			textContent = textContent.substring(0, maxLength * 0.6) + '...';
		}

		// 恢复代码块（可能需要截断）
		const remainingLength = maxLength - textContent.length;
		const codePerBlock = Math.floor(remainingLength / Math.max(codeBlocks.length, 1));

		codeBlocks.forEach((block, idx) => {
			const truncatedBlock = block.length > codePerBlock
				? block.substring(0, codePerBlock - 20) + '\n... (代码已截断)\n```'
				: block;
			textContent = textContent.replace(`[CODE_BLOCK_${idx}]`, truncatedBlock);
		});

		return textContent.substring(0, maxLength);
	}

	private extractKeywords(text: string): string[] {
		const keywords: string[] = [];

		// 提取技术术语
		const techTerms = text.match(/\b(function|class|component|service|api|database|error|bug|feature|test|deploy)\b/gi);
		if (techTerms) keywords.push(...techTerms.map(t => t.toLowerCase()));

		// 提取文件类型
		const fileTypes = text.match(/\.(ts|js|tsx|jsx|py|java|go|rs|vue|css|html|json|md)\b/g);
		if (fileTypes) keywords.push(...fileTypes);

		return Array.from(new Set(keywords)).slice(0, 10);
	}
}

// ============ 智能上下文管理器 ============
export class SmartContextManager {
	private tokenEstimator = new TokenEstimator();
	private compressor = new SmartCompressor();
	private config = SMART_CONTEXT_CONFIG;

	/**
	 * 构建优化后的上下文
	 *
	 * @param messages - 所有消息历史
	 * @param systemPrompt - 系统提示词
	 * @param currentInput - 当前用户输入
	 * @param maxTokens - 最大允许的 token 数
	 */
	buildContext(
		messages: MessageInput[],
		systemPrompt: string,
		currentInput: string,
		maxTokens: number = this.config.DEFAULT_MAX_TOKENS
	): ContextBuildResult {
		const parts: ContextPart[] = [];
		const originalTokens = this.calculateTotalTokens(messages, systemPrompt, currentInput);

		// 计算实际可用 token（预留输出空间和安全缓冲）
		const availableTokens = Math.max(
			this.config.MIN_CONTEXT_TOKENS,
			maxTokens - this.config.RESERVED_OUTPUT_TOKENS
		) * (1 - this.config.ADAPTIVE.TOKEN_BUFFER_RATIO);

		// 阶段1：添加必要的上下文部分
		// ---------------------------------

		// 1.1 系统提示词（最高优先级，永不删除）
		const systemTokens = this.tokenEstimator.estimate(systemPrompt);
		parts.push({
			type: 'system',
			content: systemPrompt,
			tokens: systemTokens,
			priority: this.config.PRIORITY.SYSTEM_PROMPT,
			compressible: false,
		});

		// 1.2 当前用户输入（高优先级）
		const inputTokens = this.tokenEstimator.estimate(currentInput);
		parts.push({
			type: 'user',
			content: currentInput,
			tokens: inputTokens,
			priority: this.config.PRIORITY.CURRENT_INPUT,
			compressible: false,
			metadata: { isRecent: true },
		});

		// 计算剩余可用 token
		let usedTokens = systemTokens + inputTokens;
		const remainingTokens = availableTokens - usedTokens;

		// 阶段2：智能选择历史消息
		// ---------------------------------
		const historyParts = this.selectHistoryMessages(messages, remainingTokens);
		parts.push(...historyParts);

		// 阶段3：如果仍然超限，执行优化
		// ---------------------------------
		let totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
		let removedCount = 0;
		let summaryGenerated = false;

		if (totalTokens > availableTokens) {
			const optimized = this.optimizeContext(parts, availableTokens);
			parts.length = 0;
			parts.push(...optimized.parts);
			totalTokens = optimized.totalTokens;
			removedCount = optimized.removedCount;
			summaryGenerated = optimized.summaryGenerated;
		}

		// 阶段4：按逻辑顺序排序
		// ---------------------------------
		this.sortByLogicalOrder(parts);

		return {
			parts,
			totalTokens,
			originalTokens,
			compressionRatio: totalTokens / Math.max(originalTokens, 1),
			removedCount,
			summaryGenerated,
		};
	}

	/**
	 * 智能选择历史消息
	 */
	private selectHistoryMessages(messages: MessageInput[], maxTokens: number): ContextPart[] {
		const parts: ContextPart[] = [];
		const totalMessages = messages.length;

		if (totalMessages === 0) return parts;

		// 计算动态窗口大小
		const windowSize = this.calculateDynamicWindow(messages, maxTokens);

		// 分组消息：最近的和较早的
		const recentCount = Math.min(windowSize * 2, totalMessages); // 对话对
		const recentMessages = messages.slice(-recentCount);
		const olderMessages = messages.slice(0, -recentCount);

		let usedTokens = 0;
		const recentTokenBudget = maxTokens * this.config.RECENT_TOKEN_RATIO;

		// 添加最近的消息（高优先级）
		for (let i = recentMessages.length - 1; i >= 0 && usedTokens < recentTokenBudget; i--) {
			const msg = recentMessages[i];
			const turnIndex = Math.floor((recentMessages.length - 1 - i) / 2);
			const isVeryRecent = turnIndex < 2;

			let content = msg.content;
			let tokens = this.tokenEstimator.estimate(content);

			// 如果单条消息太长，更激进地压缩它
			if (msg.role === 'tool' && tokens > this.config.COMPRESSION.TOOL_RESULT_MAX_LENGTH / 4) {
				content = this.compressor.compressToolResult(content, this.config.COMPRESSION.TOOL_RESULT_MAX_LENGTH);
				tokens = this.tokenEstimator.estimate(content);
			} else if (msg.role === 'assistant' && tokens > this.config.COMPRESSION.ASSISTANT_MAX_LENGTH / 4) {
				content = this.compressor.compressAssistantMessage(content, this.config.COMPRESSION.ASSISTANT_MAX_LENGTH);
				tokens = this.tokenEstimator.estimate(content);
			}

			parts.unshift({
				type: msg.role as ContextPart['type'],
				content,
				tokens,
				priority: isVeryRecent
					? this.config.PRIORITY.RECENT_2_TURNS
					: this.config.PRIORITY.RECENT_4_TURNS,
				timestamp: msg.timestamp,
				compressible: !isVeryRecent,
				metadata: {
					turnIndex,
					toolName: msg.toolName,
					isRecent: true,
				},
			});

			usedTokens += tokens;
		}

		// 处理较早的消息
		if (olderMessages.length > 0 && usedTokens < maxTokens * 0.8) {
			const remainingBudget = maxTokens - usedTokens;

			// 如果较早消息很多，生成摘要
			if (olderMessages.length > this.config.COMPRESSION.THRESHOLD_MESSAGES) {
				const summary = this.compressor.compressHistoryToSummary(olderMessages);
				const summaryTokens = this.tokenEstimator.estimate(summary);

				if (summaryTokens < remainingBudget * 0.3) {
					parts.unshift({
						type: 'summary',
						content: `[历史对话摘要]\n${summary}`,
						tokens: summaryTokens,
						priority: this.config.PRIORITY.COMPRESSED_SUMMARY,
						compressible: true,
					});
					usedTokens += summaryTokens;
				}
			} else {
				// 较早消息不多，尝试添加一些
				for (const msg of olderMessages.slice(-4)) {
					const tokens = this.tokenEstimator.estimate(msg.content);
					if (usedTokens + tokens > maxTokens * 0.9) break;

					parts.unshift({
						type: msg.role as ContextPart['type'],
						content: msg.content,
						tokens,
						priority: this.config.PRIORITY.OLDER_HISTORY,
						timestamp: msg.timestamp,
						compressible: true,
					});
					usedTokens += tokens;
				}
			}
		}

		return parts;
	}

	/**
	 * 计算动态窗口大小
	 */
	private calculateDynamicWindow(messages: MessageInput[], availableTokens: number): number {
		const avgTokensPerMessage = 150; // 预估平均值
		const idealTurns = Math.floor(availableTokens / avgTokensPerMessage / 2);

		return Math.max(
			this.config.MIN_RECENT_TURNS,
			Math.min(
				idealTurns,
				this.config.MAX_RECENT_TURNS,
				Math.ceil(messages.length / 2)
			)
		);
	}

	/**
	 * 优化上下文（当超限时）
	 */
	private optimizeContext(
		parts: ContextPart[],
		maxTokens: number
	): { parts: ContextPart[]; totalTokens: number; removedCount: number; summaryGenerated: boolean } {
		// 按优先级排序（低优先级在前，方便移除）
		const sorted = [...parts].sort((a, b) => a.priority - b.priority);

		let totalTokens = sorted.reduce((sum, p) => sum + p.tokens, 0);
		let removedCount = 0;
		let summaryGenerated = false;
		const removedMessages: ContextPart[] = [];

		// 从低优先级开始移除/压缩
		while (totalTokens > maxTokens && sorted.length > 0) {
			const part = sorted[0];

			// 不能移除高优先级项
			if (part.priority >= this.config.PRIORITY.RECENT_2_TURNS) {
				break;
			}

			// 尝试压缩
			if (part.compressible && part.type === 'tool') {
				const compressed = this.compressor.compressToolResult(
					part.content,
					Math.floor(part.tokens * 0.3 * 3.5)
				);
				const newTokens = this.tokenEstimator.estimate(compressed);
				if (newTokens < part.tokens * 0.5) {
					totalTokens -= (part.tokens - newTokens);
					part.content = compressed;
					part.tokens = newTokens;
					continue;
				}
			}

			// 移除
			totalTokens -= part.tokens;
			removedMessages.push(sorted.shift()!);
			removedCount++;
		}

		// 如果移除了很多消息，生成摘要
		if (removedMessages.length > 3) {
			const messagesForSummary = removedMessages
				.filter(p => p.type === 'user' || p.type === 'assistant')
				.map(p => ({ role: p.type, content: p.content } as MessageInput));

			if (messagesForSummary.length > 0) {
				const summary = this.compressor.compressHistoryToSummary(messagesForSummary);
				const summaryTokens = this.tokenEstimator.estimate(summary);

				if (totalTokens + summaryTokens <= maxTokens) {
					sorted.unshift({
						type: 'summary',
						content: `[早期对话摘要]\n${summary}`,
						tokens: summaryTokens,
						priority: this.config.PRIORITY.COMPRESSED_SUMMARY,
						compressible: true,
					});
					totalTokens += summaryTokens;
					summaryGenerated = true;
				}
			}
		}

		return { parts: sorted, totalTokens, removedCount, summaryGenerated };
	}

	/**
	 * 按逻辑顺序排序
	 */
	private sortByLogicalOrder(parts: ContextPart[]): void {
		const typeOrder: Record<ContextPart['type'], number> = {
			system: 0,
			summary: 1,
			user: 2,
			assistant: 3,
			tool: 4,
			code: 5,
		};

		parts.sort((a, b) => {
			// 系统消息始终在最前
			if (a.type === 'system') return -1;
			if (b.type === 'system') return 1;

			// 摘要在系统消息之后
			if (a.type === 'summary') return -1;
			if (b.type === 'summary') return 1;

			// 其他按时间戳排序
			if (a.timestamp && b.timestamp) {
				return a.timestamp - b.timestamp;
			}

			return typeOrder[a.type] - typeOrder[b.type];
		});
	}

	/**
	 * 计算总 token 数
	 */
	private calculateTotalTokens(
		messages: MessageInput[],
		systemPrompt: string,
		currentInput: string
	): number {
		let total = this.tokenEstimator.estimate(systemPrompt);
		total += this.tokenEstimator.estimate(currentInput);

		for (const msg of messages) {
			total += this.tokenEstimator.estimate(msg.content);
		}

		return total;
	}

	/**
	 * 将构建结果转换为消息数组
	 */
	toMessages(result: ContextBuildResult): Array<{ role: string; content: string }> {
		return result.parts.map(part => ({
			role: part.type === 'summary' ? 'system' : part.type,
			content: part.content,
		}));
	}
}

// ============ 压缩状态追踪器（OpenCode风格） ============
export interface CompactionState {
	isCompacting: boolean;
	lastCompactionTime: number | null;
	totalPrunedTokens: number;
	compactionCount: number;
	prunedToolIds: Set<string>;
}

export interface TokenUsageInfo {
	totalTokens: number;
	contextLimit: number;
	usagePercentage: number;
	needsCompaction: boolean;
	availableTokens: number;
}

export interface PruneResult {
	prunedCount: number;
	prunedTokens: number;
	remainingTokens: number;
}

// ============ 增强版智能上下文管理器 ============
/**
 * 增强版智能上下文管理器
 *
 * 整合了 OpenCode Session Compaction 的优势：
 * 1. Token溢出检测 - 基于模型context限制动态检测
 * 2. 工具输出裁剪 (Prune) - 智能裁剪旧的工具输出
 * 3. 压缩状态追踪 - 记录已压缩的工具，避免重复处理
 * 4. 动态窗口调整 - 根据可用token自动调整
 *
 * 比 OpenCode 更优秀的地方：
 * 1. 优先级机制 - 不同类型内容有不同优先级
 * 2. 智能摘要 - 生成有意义的历史摘要
 * 3. 代码感知 - 保留代码结构完整性
 * 4. 多层压缩 - 渐进式压缩策略
 */
export class EnhancedContextManager {
	private tokenEstimator = new TokenEstimator();
	private compressor = new SmartCompressor();
	private config = SMART_CONTEXT_CONFIG;

	// 压缩状态追踪
	private compactionState: CompactionState = {
		isCompacting: false,
		lastCompactionTime: null,
		totalPrunedTokens: 0,
		compactionCount: 0,
		prunedToolIds: new Set(),
	};

	/**
	 * 获取模型的context限制
	 */
	getModelContextLimit(modelName: string): number {
		const lowerName = modelName.toLowerCase();
		for (const [key, limit] of Object.entries(this.config.MODEL_CONTEXT_LIMITS)) {
			if (lowerName.includes(key.toLowerCase())) {
				return limit;
			}
		}
		return this.config.MODEL_CONTEXT_LIMITS['default'];
	}

	/**
	 * 检查是否需要压缩（OpenCode风格的溢出检测）
	 */
	checkNeedsCompaction(messages: MessageInput[], modelName: string): TokenUsageInfo {
		const totalTokens = messages.reduce(
			(sum, m) => sum + this.tokenEstimator.estimate(m.content),
			0
		);
		const contextLimit = this.getModelContextLimit(modelName);
		const availableTokens = contextLimit - this.config.RESERVED_OUTPUT_TOKENS;
		const usagePercentage = totalTokens / availableTokens;
		const needsCompaction = usagePercentage >= this.config.OVERFLOW_THRESHOLD;

		return {
			totalTokens,
			contextLimit,
			usagePercentage,
			needsCompaction,
			availableTokens,
		};
	}

	/**
	 * 智能裁剪工具输出（增强版）
	 *
	 * 策略：
	 * 1. 从后往前遍历，保护最近的对话
	 * 2. 受保护的工具不被裁剪（但大输出仍可能被压缩）
	 * 3. 超过保护阈值的旧工具输出被标记为已裁剪
	 * 4. 即使在保护轮次内，超大的工具输出也会被压缩（防止单次读取撑爆 context）
	 * 5. 返回裁剪统计信息
	 */
	pruneToolOutputs(messages: MessageInput[]): PruneResult {
		const config = this.config.PRUNE;
		const largeOutputThreshold = (config as any).LARGE_OUTPUT_THRESHOLD ?? 50_000;
		let totalTokens = 0;
		let prunedTokens = 0;
		let prunedCount = 0;
		let userTurns = 0;

		// 第一遍：压缩所有超大的工具输出（即使在保护轮次内）
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === 'tool' && msg.toolId && !this.compactionState.prunedToolIds.has(msg.toolId)) {
				// 超大输出即使在保护轮次内也需要裁剪
				if (msg.content.length > largeOutputThreshold) {
					const tokens = this.tokenEstimator.estimate(msg.content);
					prunedTokens += tokens;
					prunedCount++;
					this.compactionState.prunedToolIds.add(msg.toolId);
				}
			}
		}

		// 第二遍：标准裁剪逻辑（从后往前遍历）
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];

			// 计算用户消息轮数
			if (msg.role === 'user') {
				userTurns++;
			}

			// 保护最近N轮对话（大输出已在第一遍中处理）
			if (userTurns < config.PROTECT_RECENT_TURNS) {
				continue;
			}

			// 只处理工具消息
			if (msg.role === 'tool' && msg.toolId) {
				// 检查是否已被裁剪
				if (this.compactionState.prunedToolIds.has(msg.toolId)) {
					continue;
				}

				// 检查是否是受保护的工具
				if (msg.toolName && config.PROTECTED_TOOLS.includes(msg.toolName)) {
					continue;
				}

				// 估算token数
				const tokens = this.tokenEstimator.estimate(msg.content);
				totalTokens += tokens;

				// 超过保护阈值的部分需要裁剪
				if (totalTokens > config.PROTECT_TOKENS) {
					prunedTokens += tokens;
					prunedCount++;
					this.compactionState.prunedToolIds.add(msg.toolId);
				}
			}
		}

		// 如果裁剪量不够最小阈值，不执行裁剪（但大输出裁剪始终执行）
		if (prunedTokens < config.MINIMUM_TOKENS) {
			return {
				prunedCount: 0,
				prunedTokens: 0,
				remainingTokens: this.estimateTotalTokens(messages),
			};
		}

		// 更新统计
		this.compactionState.totalPrunedTokens += prunedTokens;
		this.compactionState.compactionCount++;
		this.compactionState.lastCompactionTime = Date.now();

		console.log(`[SmartContext] Pruned ${prunedCount} tool outputs, saved ${prunedTokens.toLocaleString()} tokens`);

		return {
			prunedCount,
			prunedTokens,
			remainingTokens: this.estimateTotalTokens(messages) - prunedTokens,
		};
	}

	/**
	 * 检查工具是否已被裁剪
	 */
	isToolPruned(toolId: string): boolean {
		return this.compactionState.prunedToolIds.has(toolId);
	}

	/**
	 * 获取裁剪后的工具摘要内容
	 * 不是简单地标记为"已删除"，而是提供有用的上下文提示
	 */
	getPrunedToolContent(toolName: string, originalContent?: string): string {
		// 根据工具类型生成不同的摘要
		if (toolName === 'read_file' && originalContent) {
			const lines = originalContent.split('\n')
			const filePath = lines[0] || 'unknown file'
			return `[Previously read: ${filePath} (${lines.length} lines) - content pruned. Use read_file to re-read if needed.]`
		}
		if (toolName === 'search_for_files' || toolName === 'search_pathnames_only') {
			return `[Previous search results pruned. Re-run search if needed.]`
		}
		if (toolName === 'run_command') {
			return `[Previous command output pruned.]`
		}
		if (toolName === 'ls_dir' || toolName === 'get_dir_tree') {
			return `[Previous directory listing pruned. Use ls_dir to re-list if needed.]`
		}
		if (toolName === 'edit_file' || toolName === 'rewrite_file') {
			return `[Previous edit result - change was applied successfully.]`
		}
		return `[${toolName} output pruned to save context space.]`
	}

	/**
	 * 估算总token数
	 */
	private estimateTotalTokens(messages: MessageInput[]): number {
		return messages.reduce(
			(sum, m) => sum + this.tokenEstimator.estimate(m.content),
			0
		);
	}

	/**
	 * 构建优化后的上下文（整合原有功能和OpenCode优势）
	 */
	buildOptimizedContext(
		messages: MessageInput[],
		systemPrompt: string,
		currentInput: string,
		modelName: string = 'default'
	): ContextBuildResult {
		// 获取模型的context限制
		const contextLimit = this.getModelContextLimit(modelName);
		const maxTokens = Math.min(
			contextLimit - this.config.RESERVED_OUTPUT_TOKENS,
			this.config.DEFAULT_MAX_TOKENS
		);

		// 检查是否需要裁剪
		const usageInfo = this.checkNeedsCompaction(messages, modelName);
		if (usageInfo.needsCompaction) {
			console.log(`[SmartContext] ⚠️ Token usage at ${(usageInfo.usagePercentage * 100).toFixed(1)}%`);
			this.pruneToolOutputs(messages);
		}

		// 使用原有的智能上下文构建逻辑
		const manager = new SmartContextManager();
		return manager.buildContext(messages, systemPrompt, currentInput, maxTokens);
	}

	/**
	 * 压缩消息内容（用于被裁剪的工具输出）
	 */
	compressMessage(content: string, role: 'assistant' | 'tool' | 'user', toolName?: string): string {
		if (role === 'tool') {
			return this.compressor.compressToolResult(content, this.config.COMPRESSION.TOOL_RESULT_MAX_LENGTH);
		}
		if (role === 'assistant') {
			return this.compressor.compressAssistantMessage(content, this.config.COMPRESSION.ASSISTANT_MAX_LENGTH);
		}
		return content;
	}

	/**
	 * 生成会话摘要（用于长对话压缩）
	 */
	generateSummary(messages: MessageInput[]): string {
		return this.compressor.compressHistoryToSummary(messages);
	}

	/**
	 * 获取压缩状态
	 */
	getCompactionState(): CompactionState {
		return { ...this.compactionState };
	}

	/**
	 * 重置压缩状态（新对话时调用）
	 */
	reset(): void {
		this.compactionState = {
			isCompacting: false,
			lastCompactionTime: null,
			totalPrunedTokens: 0,
			compactionCount: 0,
			prunedToolIds: new Set(),
		};
	}

	/**
	 * 打印统计信息
	 */
	printStats(): void {
		const state = this.compactionState;
		console.log('\n📊 Smart Context Manager Stats');
		console.log('='.repeat(40));
		console.log(`  Compaction Count: ${state.compactionCount}`);
		console.log(`  Total Pruned Tokens: ${state.totalPrunedTokens.toLocaleString()}`);
		console.log(`  Pruned Tools: ${state.prunedToolIds.size}`);
		if (state.lastCompactionTime) {
			console.log(`  Last Compaction: ${new Date(state.lastCompactionTime).toLocaleString()}`);
		}
		console.log('='.repeat(40) + '\n');
	}
}

// 单例实例（保留原有的 SmartContextManager）
export const smartContextManager = new SmartContextManager();

// 增强版单例实例
export const enhancedContextManager = new EnhancedContextManager();
