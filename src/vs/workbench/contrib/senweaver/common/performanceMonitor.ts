/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Performance Monitor for tracking token usage and response times
 * 
 * This service helps identify performance issues and track optimization effects.
 * It's designed to be lightweight and can be enabled/disabled via settings.
 */

export interface PerformanceMetrics {
	// System message metrics
	systemMessageGenerationTimeMs: number;
	systemMessageLength: number;
	systemMessageEstimatedTokens: number;
	systemMessageCacheHit: boolean;

	// Directory traversal metrics
	directoryTraversalTimeMs: number;
	directoryChars: number;
	directoryFileCount: number;
	directoryCacheHit: boolean;

	// Message processing metrics
	messageTrimmingTimeMs: number;
	messageCount: number;
	charsBeforeTrim: number;
	charsAfterTrim: number;

	// Overall metrics
	totalPreparationTimeMs: number;
	timestamp: number;
}

export interface PerformanceThresholds {
	systemMessageGenerationTimeMs: number;
	systemMessageTokens: number;
	directoryTraversalTimeMs: number;
	messageTrimmingTimeMs: number;
	totalPreparationTimeMs: number;
	minCacheHitRate: number;
}

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
	systemMessageGenerationTimeMs: 2000,  // 2 seconds
	systemMessageTokens: 4000,             // 4000 tokens
	directoryTraversalTimeMs: 2000,        // 2 seconds
	messageTrimmingTimeMs: 200,            // 200ms
	totalPreparationTimeMs: 3000,          // 3 seconds
	minCacheHitRate: 0.5,                  // 50%
};

export class PerformanceMonitor {
	private metrics: PerformanceMetrics[] = [];
	private readonly MAX_METRICS_HISTORY = 100;
	private enabled: boolean = false; // Set to true to enable monitoring

	constructor(enabled: boolean = false) {
		this.enabled = enabled;
	}

	setEnabled(enabled: boolean) {
		this.enabled = enabled;
	}

	recordMetrics(metrics: Partial<PerformanceMetrics>) {
		if (!this.enabled) return;

		const fullMetrics: PerformanceMetrics = {
			systemMessageGenerationTimeMs: 0,
			systemMessageLength: 0,
			systemMessageEstimatedTokens: 0,
			systemMessageCacheHit: false,
			directoryTraversalTimeMs: 0,
			directoryChars: 0,
			directoryFileCount: 0,
			directoryCacheHit: false,
			messageTrimmingTimeMs: 0,
			messageCount: 0,
			charsBeforeTrim: 0,
			charsAfterTrim: 0,
			totalPreparationTimeMs: 0,
			timestamp: Date.now(),
			...metrics,
		};

		this.metrics.push(fullMetrics);

		// Keep only recent metrics
		if (this.metrics.length > this.MAX_METRICS_HISTORY) {
			this.metrics.shift();
		}

		// Check thresholds and log warnings
		this.checkThresholds(fullMetrics);
	}

	private checkThresholds(metrics: PerformanceMetrics) {
		const warnings: string[] = [];

		if (metrics.systemMessageGenerationTimeMs > DEFAULT_THRESHOLDS.systemMessageGenerationTimeMs) {
			warnings.push(`System message generation took ${metrics.systemMessageGenerationTimeMs}ms (threshold: ${DEFAULT_THRESHOLDS.systemMessageGenerationTimeMs}ms)`);
		}

		if (metrics.systemMessageEstimatedTokens > DEFAULT_THRESHOLDS.systemMessageTokens) {
			warnings.push(`System message has ${metrics.systemMessageEstimatedTokens} tokens (threshold: ${DEFAULT_THRESHOLDS.systemMessageTokens})`);
		}

		if (metrics.directoryTraversalTimeMs > DEFAULT_THRESHOLDS.directoryTraversalTimeMs) {
			warnings.push(`Directory traversal took ${metrics.directoryTraversalTimeMs}ms (threshold: ${DEFAULT_THRESHOLDS.directoryTraversalTimeMs}ms)`);
		}

		if (metrics.messageTrimmingTimeMs > DEFAULT_THRESHOLDS.messageTrimmingTimeMs) {
			warnings.push(`Message trimming took ${metrics.messageTrimmingTimeMs}ms (threshold: ${DEFAULT_THRESHOLDS.messageTrimmingTimeMs}ms)`);
		}

		if (metrics.totalPreparationTimeMs > DEFAULT_THRESHOLDS.totalPreparationTimeMs) {
			warnings.push(`Total preparation took ${metrics.totalPreparationTimeMs}ms (threshold: ${DEFAULT_THRESHOLDS.totalPreparationTimeMs}ms)`);
		}

		if (warnings.length > 0) {
			console.warn('⚠️ Performance Threshold Exceeded:', warnings);
		}
	}

	getStats() {
		if (this.metrics.length === 0) {
			return {
				avgSystemMessageTime: 0,
				avgSystemMessageTokens: 0,
				avgDirectoryTime: 0,
				avgTrimmingTime: 0,
				avgTotalTime: 0,
				cacheHitRate: 0,
				dirCacheHitRate: 0,
				sampleCount: 0,
			};
		}

		const sum = this.metrics.reduce((acc, m) => ({
			systemMessageTime: acc.systemMessageTime + m.systemMessageGenerationTimeMs,
			systemMessageTokens: acc.systemMessageTokens + m.systemMessageEstimatedTokens,
			directoryTime: acc.directoryTime + m.directoryTraversalTimeMs,
			trimmingTime: acc.trimmingTime + m.messageTrimmingTimeMs,
			totalTime: acc.totalTime + m.totalPreparationTimeMs,
			cacheHits: acc.cacheHits + (m.systemMessageCacheHit ? 1 : 0),
			dirCacheHits: acc.dirCacheHits + (m.directoryCacheHit ? 1 : 0),
		}), {
			systemMessageTime: 0,
			systemMessageTokens: 0,
			directoryTime: 0,
			trimmingTime: 0,
			totalTime: 0,
			cacheHits: 0,
			dirCacheHits: 0,
		});

		const count = this.metrics.length;

		return {
			avgSystemMessageTime: sum.systemMessageTime / count,
			avgSystemMessageTokens: sum.systemMessageTokens / count,
			avgDirectoryTime: sum.directoryTime / count,
			avgTrimmingTime: sum.trimmingTime / count,
			avgTotalTime: sum.totalTime / count,
			cacheHitRate: sum.cacheHits / count,
			dirCacheHitRate: sum.dirCacheHits / count,
			sampleCount: count,
		};
	}

	printStats() {
		const stats = this.getStats();
		console.log('📊 Performance Statistics (last 100 operations):');
		console.log(`  System Message Generation: ${stats.avgSystemMessageTime.toFixed(2)}ms avg, ${stats.avgSystemMessageTokens.toFixed(0)} tokens avg`);
		console.log(`  Directory Traversal: ${stats.avgDirectoryTime.toFixed(2)}ms avg`);
		console.log(`  Message Trimming: ${stats.avgTrimmingTime.toFixed(2)}ms avg`);
		console.log(`  Total Preparation: ${stats.avgTotalTime.toFixed(2)}ms avg`);
		console.log(`  Cache Hit Rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
		console.log(`  Directory Cache Hit Rate: ${(stats.dirCacheHitRate * 100).toFixed(1)}%`);
		console.log(`  Sample Count: ${stats.sampleCount}`);
	}

	getRecentMetrics(count: number = 10): PerformanceMetrics[] {
		return this.metrics.slice(-count);
	}

	clear() {
		this.metrics = [];
	}

	// Export metrics for analysis
	exportMetrics(): string {
		return JSON.stringify(this.metrics, null, 2);
	}

	// Import metrics from JSON
	importMetrics(json: string) {
		try {
			const imported = JSON.parse(json);
			if (Array.isArray(imported)) {
				this.metrics = imported;
			}
		} catch (e) {
			console.error('Failed to import metrics:', e);
		}
	}
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor(false);

/**
 * Timer utility for measuring operation duration
 * 
 * Usage:
 * const timer = new PerfTimer();
 * // ... do work ...
 * const duration = timer.end();
 */
export class PerfTimer {
	private startTime: number;

	constructor() {
		this.startTime = performance.now();
	}

	end(): number {
		return performance.now() - this.startTime;
	}

	endAndLog(operationName: string) {
		const duration = this.end();
		console.log(`⏱️ ${operationName}: ${duration.toFixed(2)}ms`);
		return duration;
	}
}

/**
 * Token estimation utilities
 */
export const CHARS_PER_TOKEN = 4; // Conservative estimate

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function formatTokenCount(tokens: number): string {
	if (tokens < 1000) {
		return `${tokens} tokens`;
	} else {
		return `${(tokens / 1000).toFixed(1)}K tokens`;
	}
}

/**
 * Performance debugging utilities
 */
export function logPerformance(label: string, data: Record<string, any>) {
	if (performanceMonitor) {
		console.log(`🔍 [${label}]`, data);
	}
}

export function warnSlowOperation(operationName: string, durationMs: number, thresholdMs: number) {
	if (durationMs > thresholdMs) {
		console.warn(`⚠️ Slow operation detected: ${operationName} took ${durationMs.toFixed(2)}ms (threshold: ${thresholdMs}ms)`);
	}
}
