/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Token Usage Tracker
 * 
 * 追踪和统计Token使用情况，提供详细的使用分析
 * 这是一个功能增强：帮助用户了解Token使用模式，进一步优化
 */

export interface TokenUsageRecord {
	timestamp: number;
	feature: 'Chat' | 'Autocomplete' | 'Agent';
	
	// Token breakdown
	systemMessageTokens: number;
	userMessageTokens: number;
	assistantMessageTokens: number;
	toolMessageTokens: number;
	totalInputTokens: number;
	
	// Optimization effect
	tokensBeforeOptimization: number;
	tokensAfterOptimization: number;
	tokensSaved: number;
	savingsPercentage: number;
	
	// Performance
	preparationTimeMs: number;
	cacheHit: boolean;
	
	// Cost (optional)
	estimatedCost?: number;
}

export interface TokenUsageStats {
	// Totals
	totalRequests: number;
	totalTokensUsed: number;
	totalTokensSaved: number;
	totalSavingsPercentage: number;
	
	// Breakdown by feature
	byFeature: {
		[K in TokenUsageRecord['feature']]: {
			requests: number;
			tokensUsed: number;
			tokensSaved: number;
		}
	};
	
	// Breakdown by message type
	byMessageType: {
		system: number;
		user: number;
		assistant: number;
		tool: number;
	};
	
	// Performance
	avgPreparationTime: number;
	cacheHitRate: number;
	
	// Cost
	totalEstimatedCost: number;
	totalCostSaved: number;
	
	// Time period
	periodStart: number;
	periodEnd: number;
}

/**
 * Token使用追踪器
 * 提供详细的使用统计和分析
 */
export class TokenUsageTracker {
	private records: TokenUsageRecord[] = [];
	private readonly MAX_RECORDS = 1000;
	private enabled: boolean = false;
	
	constructor(enabled: boolean = false) {
		this.enabled = enabled;
	}
	
	setEnabled(enabled: boolean) {
		this.enabled = enabled;
	}
	
	/**
	 * 记录一次Token使用
	 */
	recordUsage(record: Omit<TokenUsageRecord, 'timestamp' | 'tokensSaved' | 'savingsPercentage'>): void {
		if (!this.enabled) return;
		
		const tokensSaved = record.tokensBeforeOptimization - record.tokensAfterOptimization;
		const savingsPercentage = record.tokensBeforeOptimization > 0 
			? (tokensSaved / record.tokensBeforeOptimization) * 100 
			: 0;
		
		const fullRecord: TokenUsageRecord = {
			...record,
			timestamp: Date.now(),
			tokensSaved,
			savingsPercentage,
		};
		
		this.records.push(fullRecord);
		
		// Keep only recent records
		if (this.records.length > this.MAX_RECORDS) {
			this.records.shift();
		}
	}
	
	/**
	 * 获取统计数据
	 */
	getStats(periodMs?: number): TokenUsageStats {
		const now = Date.now();
		const periodStart = periodMs ? now - periodMs : this.records[0]?.timestamp || now;
		
		// Filter records in period
		const periodRecords = this.records.filter(r => r.timestamp >= periodStart);
		
		if (periodRecords.length === 0) {
			return this.getEmptyStats(now, now);
		}
		
		// Calculate totals
		const totalRequests = periodRecords.length;
		const totalTokensUsed = periodRecords.reduce((sum, r) => sum + r.totalInputTokens, 0);
		const totalTokensSaved = periodRecords.reduce((sum, r) => sum + r.tokensSaved, 0);
		const tokensBeforeSum = periodRecords.reduce((sum, r) => sum + r.tokensBeforeOptimization, 0);
		const totalSavingsPercentage = tokensBeforeSum > 0 ? (totalTokensSaved / tokensBeforeSum) * 100 : 0;
		
		// By feature
		const byFeature = this.calculateByFeature(periodRecords);
		
		// By message type
		const byMessageType = {
			system: periodRecords.reduce((sum, r) => sum + r.systemMessageTokens, 0),
			user: periodRecords.reduce((sum, r) => sum + r.userMessageTokens, 0),
			assistant: periodRecords.reduce((sum, r) => sum + r.assistantMessageTokens, 0),
			tool: periodRecords.reduce((sum, r) => sum + r.toolMessageTokens, 0),
		};
		
		// Performance
		const avgPreparationTime = periodRecords.reduce((sum, r) => sum + r.preparationTimeMs, 0) / totalRequests;
		const cacheHits = periodRecords.filter(r => r.cacheHit).length;
		const cacheHitRate = cacheHits / totalRequests;
		
		// Cost
		const totalEstimatedCost = periodRecords.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
		const costPerToken = totalEstimatedCost / totalTokensUsed || 0;
		const totalCostSaved = totalTokensSaved * costPerToken;
		
		return {
			totalRequests,
			totalTokensUsed,
			totalTokensSaved,
			totalSavingsPercentage,
			byFeature,
			byMessageType,
			avgPreparationTime,
			cacheHitRate,
			totalEstimatedCost,
			totalCostSaved,
			periodStart,
			periodEnd: now,
		};
	}
	
	private calculateByFeature(records: TokenUsageRecord[]): TokenUsageStats['byFeature'] {
		const result = {
			Chat: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
			Autocomplete: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
			Agent: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
		};
		
		for (const record of records) {
			const feature = record.feature;
			result[feature].requests++;
			result[feature].tokensUsed += record.totalInputTokens;
			result[feature].tokensSaved += record.tokensSaved;
		}
		
		return result;
	}
	
	private getEmptyStats(start: number, end: number): TokenUsageStats {
		return {
			totalRequests: 0,
			totalTokensUsed: 0,
			totalTokensSaved: 0,
			totalSavingsPercentage: 0,
			byFeature: {
				Chat: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
				Autocomplete: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
				Agent: { requests: 0, tokensUsed: 0, tokensSaved: 0 },
			},
			byMessageType: {
				system: 0,
				user: 0,
				assistant: 0,
				tool: 0,
			},
			avgPreparationTime: 0,
			cacheHitRate: 0,
			totalEstimatedCost: 0,
			totalCostSaved: 0,
			periodStart: start,
			periodEnd: end,
		};
	}
	
	/**
	 * 打印统计报告
	 */
	printReport(periodMs?: number): void {
		const stats = this.getStats(periodMs);
		const periodName = periodMs 
			? `Last ${periodMs / 1000 / 60} minutes` 
			: 'All time';
		
		console.log(`\n📊 Token Usage Report (${periodName})`);
		console.log('='.repeat(60));
		
		// Overall stats
		console.log('\n📈 Overall Statistics:');
		console.log(`  Total Requests: ${stats.totalRequests}`);
		console.log(`  Total Tokens Used: ${stats.totalTokensUsed.toLocaleString()}`);
		console.log(`  Total Tokens Saved: ${stats.totalTokensSaved.toLocaleString()} (${stats.totalSavingsPercentage.toFixed(1)}%)`);
		console.log(`  Average Preparation Time: ${stats.avgPreparationTime.toFixed(0)}ms`);
		console.log(`  Cache Hit Rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
		
		// By feature
		console.log('\n🎯 By Feature:');
		for (const [feature, data] of Object.entries(stats.byFeature)) {
			if (data.requests > 0) {
				const savingsPercent = data.tokensUsed > 0 
					? ((data.tokensSaved / (data.tokensUsed + data.tokensSaved)) * 100).toFixed(1) 
					: '0';
				console.log(`  ${feature}:`);
				console.log(`    Requests: ${data.requests}`);
				console.log(`    Tokens: ${data.tokensUsed.toLocaleString()} (saved ${data.tokensSaved.toLocaleString()}, ${savingsPercent}%)`);
			}
		}
		
		// By message type
		console.log('\n💬 Token Distribution:');
		const total = Object.values(stats.byMessageType).reduce((a, b) => a + b, 0);
		for (const [type, tokens] of Object.entries(stats.byMessageType)) {
			if (tokens > 0) {
				const percentage = ((tokens / total) * 100).toFixed(1);
				console.log(`  ${type.padEnd(10)}: ${tokens.toLocaleString().padStart(10)} (${percentage}%)`);
			}
		}
		
		// Cost
		if (stats.totalEstimatedCost > 0) {
			console.log('\n💰 Cost Analysis:');
			console.log(`  Total Cost: $${stats.totalEstimatedCost.toFixed(4)}`);
			console.log(`  Cost Saved: $${stats.totalCostSaved.toFixed(4)}`);
			console.log(`  Savings Rate: ${((stats.totalCostSaved / (stats.totalEstimatedCost + stats.totalCostSaved)) * 100).toFixed(1)}%`);
		}
		
		console.log('\n' + '='.repeat(60) + '\n');
	}
	
	/**
	 * 导出数据用于分析
	 */
	exportData(): string {
		return JSON.stringify({
			records: this.records,
			stats: this.getStats(),
		}, null, 2);
	}
	
	/**
	 * 清空记录
	 */
	clear(): void {
		this.records = [];
	}
	
	/**
	 * 获取最近的记录
	 */
	getRecentRecords(count: number = 10): TokenUsageRecord[] {
		return this.records.slice(-count);
	}
}

// Singleton instance
export const tokenUsageTracker = new TokenUsageTracker(false);
