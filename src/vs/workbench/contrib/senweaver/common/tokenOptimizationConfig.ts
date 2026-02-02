/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Token Optimization Configuration
 *
 * 这个配置文件集中管理所有与 Token 优化相关的参数
 * 目标：在保持或增强功能的同时，大幅降低 Token 使用量
 */

// ============ 目录结构优化配置 ============
export const DIRECTORY_OPTIMIZATION = {
	// 缓存配置
	CACHE_TTL_MS: 60_000, // 缓存有效期：60秒（从30秒增加）
	CACHE_MAX_SIZE: 5, // 最多缓存5个目录结构

	// 目录深度和项目限制（更激进的限制）
	MAX_DEPTH_INITIAL: 2,
	MAX_DEPTH_TOOL: 3,
	MAX_ITEMS_PER_DIR_INITIAL: 8, // 从15降至8
	MAX_ITEMS_PER_DIR_TOOL: 12, // 从15降至12

	// 字符限制（更严格）
	MAX_CHARS_BEGINNING: 6_000, // 从8000降至6000，节省约500 tokens
	MAX_CHARS_TOOL: 10_000, // 从12000降至10000，节省约500 tokens

	// 智能过滤
	ENABLE_SMART_FILTERING: true, // 启用智能文件过滤
	PRIORITY_EXTENSIONS: ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs'], // 优先显示的文件类型
} as const;

// ============ 系统消息优化配置 ============
export const SYSTEM_MESSAGE_OPTIMIZATION = {
	// 打开文件列表限制
	MAX_OPENED_FILES: 8, // 从10降至8
	MAX_OPENED_FILES_CHARS: 500, // 每个文件路径最多显示字符数

	// 简化系统信息
	COMPACT_MODE: true, // 使用紧凑格式
	SHOW_FULL_PATHS: false, // 使用相对路径而非完整路径

	// 目录结构延迟加载（最激进的优化）
	LAZY_LOAD_DIRECTORY: true, // 不在系统消息中包含目录结构，让 AI 按需使用工具获取
	INCLUDE_DIRECTORY_HINT: true, // 提示 AI 可以使用工具查看目录

	// 工具定义优化
	LAZY_LOAD_TOOLS: false, // 按需加载工具定义（设为false以保持兼容性）
	COMPACT_TOOL_DESCRIPTIONS: true, // 使用紧凑的工具描述
	COMMON_TOOLS_ONLY: ['read_file', 'edit_file', 'search_for_files', 'run_command'], // 最常用的工具
} as const;

// ============ 消息历史压缩配置 ============
export const MESSAGE_COMPRESSION = {
	// 压缩策略（激进模式 - 防止 TPM 限制）
	AGGRESSIVE_TRIM: true, // 🔧 启用激进压缩，防止 TPM 限制
	TRIM_TO_LENGTH: 100, // 🔧 降低到100
	CHARS_PER_TOKEN: 3.5, // 更准确的估算

	// 🔧 保留策略 - 平衡上下文和 TPM 限制
	PRESERVE_RECENT_MESSAGES: 6, // 🔧 降至6条（3轮对话），减少 token
	PRESERVE_FIRST_MESSAGE: true, // 保留第一条用户消息

	// 压缩权重（越高越容易被压缩）
	WEIGHT_MULTIPLIERS: {
		system: 0.01, // 系统消息权重很低（不容易被压缩）
		user: 0.3, // 🔧 用户消息也可以适度压缩
		assistant: 8.0, // 🔧 AI回复更激进压缩
		tool: 20.0, // 🔧 工具结果最优先压缩
	},

	// 智能摘要
	ENABLE_SMART_SUMMARY: true, // 启用智能摘要
	SUMMARY_THRESHOLD: 500, // 🔧 降低到500

	// 长对话支持 - 消息移除（更激进）
	ENABLE_MESSAGE_REMOVAL: true, // 启用消息移除
	MIN_MESSAGES_TO_KEEP: 8, // 🔧 降至8条
	REMOVAL_BATCH_SIZE: 6, // 🔧 每次移除6条最旧的消息
	GENERATE_SUMMARY_ON_REMOVAL: true, // 移除消息时生成摘要
	MAX_SUMMARY_LENGTH: 300, // 🔧 摘要最大300字符
	MAX_REQUEST_BODY_CHARS: 200_000, // 🔧 加大到200K，有静默重试保底

	// TPM 优化配置（宽松模式 - 有静默重试逻辑保底）
	TPM_SAFE_MODE: true, // 启用 TPM 安全模式
	TPM_SAFE_MAX_CHARS: 150_000, // 🔧 加大到150K，TPM错误会静默重试
	TOOL_RESULT_AGGRESSIVE_COMPRESSION: true, // 工具结果激进压缩
	MAX_TOOL_RESULT_IN_HISTORY: 5000, // 🔧 加大到5K

	// 无限对话配置
	INFINITE_CHAT_MODE: true, // 启用无限对话模式
	AUTO_COMPRESS_THRESHOLD: 8, // 🔧 降至8条就开始压缩
	KEEP_RECENT_TOOL_RESULTS: 2, // 🔧 只保留最近2个工具结果完整
} as const;

// ============ 用户消息内容优化 ============
export const USER_MESSAGE_OPTIMIZATION = {
	// 文件选择限制（更严格）
	MAX_FILE_SIZE: 1_500_000, // 从2MB降至1.5MB
	MAX_CODE_SELECTION_SIZE: 800_000, // 从无限制降至800KB

	// Folder 选择限制
	MAX_FOLDER_CHILDREN: 50, // 从100降至50
	MAX_CHARS_PER_FILE_IN_FOLDER: 50_000, // 从100K降至50K

	// 智能截断
	ENABLE_SMART_TRUNCATION: true,
	SHOW_TRUNCATION_INFO: true, // 显示截断信息
	TRUNCATION_MESSAGE: '...(内容过长已截断，使用工具查看完整内容)...',
} as const;

// ============ AI 指令优化 ============
export const AI_INSTRUCTIONS_OPTIMIZATION = {
	// 压缩默认指令
	USE_COMPACT_INSTRUCTIONS: true,
	MAX_INSTRUCTIONS_LENGTH: 1_500, // 默认指令最多1500字符

	// 智能加载
	LOAD_SenweaverRules_ONLY: false, // 仅加载 .SenweaverRules，忽略默认指令（可选）
	MERGE_INSTRUCTIONS: true, // 合并并去重指令
} as const;

// ============ Context Window 优化 ============
export const CONTEXT_WINDOW_OPTIMIZATION = {
	// 更保守的输出空间预留
	OUTPUT_RESERVE_RATIO: 0.20, // 预留20%而非25%
	MIN_OUTPUT_TOKENS: 2048, // 最小输出token（从4096降至2048）

	// 自适应调整
	ENABLE_ADAPTIVE_RESERVE: true, // 根据模型能力自适应调整
} as const;

// ============ 缓存和性能优化 ============
export const CACHE_OPTIMIZATION = {
	// 系统消息缓存
	SYSTEM_MESSAGE_CACHE_TTL: 45_000, // 45秒

	// 目录结构缓存
	DIRECTORY_CACHE_TTL: 60_000, // 60秒

	// 文件内容缓存
	FILE_CONTENT_CACHE_TTL: 30_000, // 30秒
	FILE_CONTENT_CACHE_MAX_SIZE: 20, // 最多缓存20个文件
} as const;

// ============ 工具结果优化 ============
export const TOOL_RESULT_OPTIMIZATION = {
	// 工具结果大小限制（更激进以避免 TPM 限制）
	MAX_TOOL_RESULT_CHARS: 15_000, // 🔧 降至15K，大幅减少 token

	// 智能截断策略
	TRUNCATE_LARGE_RESULTS: true,
	SHOW_RESULT_STATS: true, // 显示结果统计信息（如文件数量）

	// 特殊工具优化
	SEARCH_RESULT_MAX_MATCHES: 10, // 🔧 降至10
	LS_DIR_MAX_ITEMS: 20, // 🔧 降至20

	// 🆕 工具结果智能压缩（更激进）
	WEB_SEARCH_MAX_CHARS: 8_000, // 🔧 降至8K
	FETCH_URL_MAX_CHARS: 10_000, // 🔧 降至10K
	FILE_READ_MAX_CHARS: 15_000, // 🔧 降至15K
	TERMINAL_OUTPUT_MAX_CHARS: 5_000, // 🔧 降至5K

	// 🆕 连续工具调用优化
	CONSECUTIVE_TOOL_COMPRESSION: true, // 连续工具调用时更激进压缩
	CONSECUTIVE_COMPRESSION_RATIO: 0.4, // 🔧 连续调用时压缩到40%
} as const;

// ============ 总体优化目标 ============
export const OPTIMIZATION_TARGETS = {
	// Token 减少目标
	TARGET_REDUCTION: 0.60, // 目标减少60%的token使用

	// 性能指标
	MAX_PREPARATION_TIME_MS: 2000, // 最大准备时间2秒

	// 质量保证
	PRESERVE_CONTEXT_QUALITY: true, // 确保上下文质量
	ENABLE_MONITORING: true, // 启用性能监控

	// 🔒 代码编辑安全模式（核心功能保护）
	CODE_EDITING_SAFE_MODE: true, // 启用后，代码相关消息压缩更保守
} as const;

// ============ 代码编辑安全配置 ============
export const CODE_EDITING_SAFETY = {
	// 当检测到代码编辑场景时的特殊保护
	DETECT_CODE_EDITING: true, // 自动检测代码编辑场景

	// 代码编辑场景的标识
	CODE_KEYWORDS: [
		'edit_file', 'rewrite_file', 'create_file',
		'refactor', 'implement', 'fix bug', '修复', '重构',
		'class', 'function', 'component', '组件'
	],

	// 代码编辑场景下的保护措施
	PRESERVE_CODE_MESSAGES: 5, // 保留最近5条（而非3条）
	CODE_COMPRESSION_MULTIPLIER: 0.5, // 代码消息压缩减半
	PRESERVE_CODE_STRUCTURE: true, // 强制保留代码结构
} as const;

// ============ 辅助函数 ============

/**
 * 计算字符串的估算 token 数
 */
export function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / MESSAGE_COMPRESSION.CHARS_PER_TOKEN);
}

/**
 * 智能截断文本
 */
export function smartTruncate(text: string, maxLength: number, showInfo: boolean = true): string {
	if (text.length <= maxLength) return text;

	const truncated = text.substring(0, maxLength);
	return showInfo
		? `${truncated}\n${USER_MESSAGE_OPTIMIZATION.TRUNCATION_MESSAGE}`
		: truncated;
}

/**
 * 获取相对路径（用于减少路径长度）
 */
export function getRelativePath(fullPath: string, basePath: string): string {
	if (!fullPath.startsWith(basePath)) return fullPath;
	return fullPath.substring(basePath.length).replace(/^[\/\\]/, '');
}

/**
 * 压缩文件路径列表
 */
export function compressPathList(paths: string[], basePath: string, maxPaths: number = 10): string {
	const relativePaths = paths.map(p => getRelativePath(p, basePath));

	if (relativePaths.length <= maxPaths) {
		return relativePaths.join('\n');
	}

	const shown = relativePaths.slice(0, maxPaths);
	const remaining = relativePaths.length - maxPaths;
	return `${shown.join('\n')}\n...(${remaining} more files)`;
}

/**
 * 判断文件是否为优先类型
 */
export function isPriorityFile(filename: string): boolean {
	if (!DIRECTORY_OPTIMIZATION.ENABLE_SMART_FILTERING) return true;

	const ext = filename.substring(filename.lastIndexOf('.'));
	return DIRECTORY_OPTIMIZATION.PRIORITY_EXTENSIONS.includes(ext as any);
}
