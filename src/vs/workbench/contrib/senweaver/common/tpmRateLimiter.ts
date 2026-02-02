/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * TPM (Tokens Per Minute) Rate Limiter - 响应式限流
 *
 * 参考 Cursor 的处理机制：
 * 1. 默认不预等待，直接发送请求
 * 2. 只在收到 429 错误时才进行退避
 * 3. 从 API 响应头获取实际限流信息
 * 4. 使用指数退避重试
 *
 * 核心原则：宁可偶尔触发 429 重试，也不要让用户长时间等待
 */

export interface TPMConfig {
	// 每分钟 token 限制（输入+输出）- 用于估算，不用于预等待
	tokensPerMinute: number;
	// 每分钟请求限制 - 用于估算，不用于预等待
	requestsPerMinute: number;
	// 是否启用预测式限流（默认 false，只在 429 错误后启用）
	enablePredictiveRateLimiting: boolean;
	// 最小请求间隔（毫秒）- 防止极端情况下的请求轰炸
	minRequestInterval: number;
}

// 不同 provider 的默认 TPM 配置
// 大幅提高限制，因为我们采用响应式限流，不需要保守估计
export const DEFAULT_TPM_CONFIGS: Record<string, TPMConfig> = {
	'anthropic': {
		tokensPerMinute: 200000,     // 大幅提高，让 API 自己限流
		requestsPerMinute: 500,
		enablePredictiveRateLimiting: false,  // 关闭预测式限流
		minRequestInterval: 100,     // 最少间隔100ms，防止请求轰炸
	},
	'openai': {
		tokensPerMinute: 500000,
		requestsPerMinute: 500,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 100,
	},
	'gemini': {
		tokensPerMinute: 200000,
		requestsPerMinute: 500,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 100,
	},
	'openrouter': {
		tokensPerMinute: Infinity,   // OpenRouter 自己管理限流
		requestsPerMinute: Infinity,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 50,
	},
	'deepseek': {
		tokensPerMinute: 500000,
		requestsPerMinute: 500,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 100,
	},
	'ollama': {
		tokensPerMinute: Infinity,   // 本地无限制
		requestsPerMinute: Infinity,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 0,
	},
	'default': {
		tokensPerMinute: 200000,     // 默认也不保守
		requestsPerMinute: 500,
		enablePredictiveRateLimiting: false,
		minRequestInterval: 100,
	}
};

interface ErrorRecord {
	timestamp: number;
	waitUntil: number;  // 等待到什么时候
	retryAfter: number; // API 返回的 retry-after 值
}

/**
 * 响应式 TPM 限流器
 * 核心原则：不预等待，只在 429 错误后才限流
 */
export class TPMRateLimiter {
	private lastRequestTime: Map<string, number> = new Map();
	private errorRecords: Map<string, ErrorRecord> = new Map();
	private consecutiveErrors: Map<string, number> = new Map();

	// 指数退避配置 - 更短的退避时间
	private readonly BASE_BACKOFF = 2_000;     // 基础退避 2 秒
	private readonly MAX_BACKOFF = 30_000;     // 最大退避 30 秒
	private readonly BACKOFF_MULTIPLIER = 1.5; // 退避倍数（更温和）

	constructor() {
		// 定期清理过期记录
		setInterval(() => this.cleanupOldRecords(), 60_000);
	}

	/**
	 * 获取 provider 的 TPM 配置
	 */
	getConfig(providerName: string): TPMConfig {
		return DEFAULT_TPM_CONFIGS[providerName] || DEFAULT_TPM_CONFIGS['default'];
	}

	/**
	 * 检查是否可以发送请求
	 * 返回需要等待的毫秒数（0 表示可以立即发送）
	 *
	 * 核心逻辑：
	 * 1. 检查是否在 429 错误的冷却期内
	 * 2. 检查最小请求间隔（防止请求轰炸）
	 * 3. 不进行预测式限流（除非显式启用）
	 */
	getWaitTime(providerName: string, _estimatedTokens: number): number {
		const config = this.getConfig(providerName);
		const key = providerName;
		const now = Date.now();

		// 1. 检查是否在 429 错误的冷却期内
		const errorRecord = this.errorRecords.get(key);
		if (errorRecord && now < errorRecord.waitUntil) {
			const waitTime = errorRecord.waitUntil - now;
			console.log(`[TPM] Provider ${providerName} is in cooldown, wait ${(waitTime / 1000).toFixed(1)}s`);
			return waitTime;
		}

		// 2. 检查最小请求间隔（防止请求轰炸）
		const lastTime = this.lastRequestTime.get(key) || 0;
		const timeSinceLastRequest = now - lastTime;
		if (timeSinceLastRequest < config.minRequestInterval) {
			return config.minRequestInterval - timeSinceLastRequest;
		}

		// 3. 不进行预测式限流 - 直接返回 0
		// 让 API 自己决定是否限流，我们只响应 429 错误
		return 0;
	}

	/**
	 * 记录请求开始（更新最后请求时间）
	 */
	recordRequestStart(providerName: string): void {
		this.lastRequestTime.set(providerName, Date.now());
	}

	/**
	 * 记录成功请求（重置错误计数）
	 */
	recordSuccess(providerName: string): void {
		this.consecutiveErrors.set(providerName, 0);
		this.errorRecords.delete(providerName);
	}

	/**
	 * 记录 TPM/Rate Limit 错误
	 * @param retryAfterMs API 返回的 retry-after 时间（毫秒），如果有的话
	 */
	recordRateLimitError(providerName: string, retryAfterMs?: number): void {
		const key = providerName;
		const current = this.consecutiveErrors.get(key) || 0;
		this.consecutiveErrors.set(key, current + 1);

		const now = Date.now();

		// 优先使用 API 返回的 retry-after
		let waitTime: number;
		if (retryAfterMs && retryAfterMs > 0) {
			waitTime = retryAfterMs;
			console.log(`[TPM] Using API retry-after: ${(waitTime / 1000).toFixed(1)}s`);
		} else {
			// 使用指数退避
			waitTime = Math.min(
				this.BASE_BACKOFF * Math.pow(this.BACKOFF_MULTIPLIER, current),
				this.MAX_BACKOFF
			);
			console.log(`[TPM] Using exponential backoff (attempt ${current + 1}): ${(waitTime / 1000).toFixed(1)}s`);
		}

		this.errorRecords.set(key, {
			timestamp: now,
			waitUntil: now + waitTime,
			retryAfter: waitTime,
		});
	}

	/**
	 * 检测错误是否是 Rate Limit 相关
	 */
	isRateLimitError(error: any): boolean {
		if (!error) return false;

		// 检查 HTTP 状态码
		if (error.status === 429 || error.statusCode === 429) {
			return true;
		}

		const errorStr = String(error.message || error).toLowerCase();
		const rateLimitPatterns = [
			'rate limit',
			'rate_limit',
			'too many requests',
			'tpm limit',
			'tokens per minute',
			'quota exceeded',
			'429',
			'overloaded',
			'capacity',
			'try again later',
			'resource exhausted',
		];

		return rateLimitPatterns.some(pattern => errorStr.includes(pattern));
	}

	/**
	 * 从错误中提取 retry-after 时间（毫秒）
	 */
	extractRetryAfter(error: any): number | undefined {
		// 1. 检查 HTTP 响应头
		if (error.headers) {
			const retryAfter = error.headers['retry-after'] || error.headers['Retry-After'];
			if (retryAfter) {
				const seconds = parseInt(retryAfter, 10);
				if (!isNaN(seconds)) {
					return seconds * 1000;
				}
			}

			// 检查 x-ratelimit-reset
			const resetTime = error.headers['x-ratelimit-reset'] || error.headers['X-RateLimit-Reset'];
			if (resetTime) {
				const resetTimestamp = parseInt(resetTime, 10);
				if (!isNaN(resetTimestamp)) {
					// 如果是 Unix 时间戳
					if (resetTimestamp > 1000000000000) {
						return Math.max(0, resetTimestamp - Date.now());
					}
					// 如果是秒数
					return resetTimestamp * 1000;
				}
			}
		}

		// 2. 从错误消息中提取
		const errorStr = String(error.message || error);
		const waitMatch = errorStr.match(/try again in (\d+(?:\.\d+)?)\s*(second|minute|sec|min|ms|millisecond)/i);
		if (waitMatch) {
			const value = parseFloat(waitMatch[1]);
			const unit = waitMatch[2].toLowerCase();
			if (unit.startsWith('min')) {
				return value * 60_000;
			}
			if (unit.startsWith('ms') || unit.startsWith('milli')) {
				return value;
			}
			return value * 1000;
		}

		// 3. 检查 error.retryAfter
		if (error.retryAfter) {
			const value = parseInt(error.retryAfter, 10);
			if (!isNaN(value)) {
				return value > 1000 ? value : value * 1000; // 自动判断是秒还是毫秒
			}
		}

		return undefined;
	}

	/**
	 * 处理 Rate Limit 错误
	 * 返回推荐的等待时间
	 */
	handleRateLimitError(providerName: string, error: any): number {
		const retryAfter = this.extractRetryAfter(error);
		this.recordRateLimitError(providerName, retryAfter);

		// 返回实际需要等待的时间
		const errorRecord = this.errorRecords.get(providerName);
		return errorRecord ? errorRecord.retryAfter : this.BASE_BACKOFF;
	}

	/**
	 * 清理过期记录
	 */
	private cleanupOldRecords(): void {
		const now = Date.now();

		// 清理已过期的错误记录
		for (const [key, record] of this.errorRecords.entries()) {
			if (now > record.waitUntil) {
				this.errorRecords.delete(key);
			}
		}

		// 重置长时间没有错误的计数器
		for (const [key, lastTime] of this.lastRequestTime.entries()) {
			if (now - lastTime > 60_000) { // 1分钟没有请求
				this.consecutiveErrors.delete(key);
			}
		}
	}

	/**
	 * 获取当前状态（用于调试/UI显示）
	 */
	getStatus(providerName: string): {
		consecutiveErrors: number;
		isInCooldown: boolean;
		cooldownRemaining: number;
	} {
		const key = providerName;
		const now = Date.now();
		const errorRecord = this.errorRecords.get(key);
		const isInCooldown = errorRecord ? now < errorRecord.waitUntil : false;
		const cooldownRemaining = isInCooldown ? errorRecord!.waitUntil - now : 0;

		return {
			consecutiveErrors: this.consecutiveErrors.get(key) || 0,
			isInCooldown,
			cooldownRemaining,
		};
	}

	/**
	 * 重置 provider 的状态
	 */
	reset(providerName: string): void {
		this.lastRequestTime.delete(providerName);
		this.errorRecords.delete(providerName);
		this.consecutiveErrors.delete(providerName);
	}
}

// 单例实例
export const tpmRateLimiter = new TPMRateLimiter();

/**
 * 估算消息的 token 数（用于显示，不用于限流）
 */
export function estimateMessageTokens(messages: any[]): number {
	let totalChars = 0;

	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			totalChars += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === 'text') {
					totalChars += part.text?.length || 0;
				}
			}
		}
	}

	// 估算：平均 4 字符 = 1 token
	return Math.ceil(totalChars / 4);
}
