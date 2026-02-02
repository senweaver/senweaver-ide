/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Message Compression Service
 * 
 * Provides intelligent message compression and summarization
 * to reduce token usage while preserving context quality.
 */

import { MESSAGE_COMPRESSION } from './tokenOptimizationConfig.js';

export interface CompressibleMessage {
	role: 'user' | 'assistant' | 'tool' | 'system';
	content: string;
	metadata?: {
		isCode?: boolean;
		hasToolCall?: boolean;
		importance?: number; // 0-1, higher = more important
	};
}

export interface CompressionResult {
	compressed: string;
	originalLength: number;
	compressedLength: number;
	compressionRatio: number;
	method: 'truncate' | 'summarize' | 'none';
}

/**
 * Smart message compressor that preserves important context
 */
export class MessageCompressor {
	
	/**
	 * Compress a single message using the appropriate strategy
	 * 
	 * @param message - The message to compress
	 * @param targetLength - Target length in characters
	 * @param preserveStructure - If true, prioritize preserving code/structure over compression
	 */
	compress(message: CompressibleMessage, targetLength: number, preserveStructure: boolean = true): CompressionResult {
		const original = message.content;
		const originalLength = original.length;

		// Don't compress if already under target
		if (originalLength <= targetLength) {
			return {
				compressed: original,
				originalLength,
				compressedLength: originalLength,
				compressionRatio: 1.0,
				method: 'none'
			};
		}

		// Choose compression method based on content
		let compressed: string;
		let method: CompressionResult['method'];

		// 🔒 Safety: If preserveStructure is true and content has code, use gentler compression
		const hasCode = message.metadata?.isCode || original.includes('function') || original.includes('class') || original.includes('```');
		const shouldPreserve = preserveStructure && hasCode;

		if (MESSAGE_COMPRESSION.ENABLE_SMART_SUMMARY && originalLength > MESSAGE_COMPRESSION.SUMMARY_THRESHOLD && !shouldPreserve) {
			compressed = this.summarize(original, targetLength, message.metadata);
			method = 'summarize';
		} else {
			compressed = this.truncate(original, targetLength);
			method = 'truncate';
		}

		return {
			compressed,
			originalLength,
			compressedLength: compressed.length,
			compressionRatio: compressed.length / originalLength,
			method
		};
	}

	/**
	 * Simple truncation with ellipsis
	 */
	private truncate(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength - 3) + '...';
	}

	/**
	 * Intelligent summarization that preserves key information
	 */
	private summarize(text: string, targetLength: number, metadata?: CompressibleMessage['metadata']): string {
		// For code content, preserve structure
		if (metadata?.isCode) {
			return this.summarizeCode(text, targetLength);
		}

		// For tool results, extract key information
		if (metadata?.hasToolCall) {
			return this.summarizeToolResult(text, targetLength);
		}

		// For general text, use extractive summarization
		return this.summarizeText(text, targetLength);
	}

	/**
	 * Summarize code by preserving function signatures and key structures
	 */
	private summarizeCode(code: string, targetLength: number): string {
		const lines = code.split('\n');
		const important: string[] = [];
		
		// Keep lines with: function/class definitions, imports, exports
		const importantPatterns = [
			/^import\s/,
			/^export\s/,
			/^(function|class|interface|type|const|let|var)\s+\w+/,
			/^\s*(public|private|protected)\s+/,
		];

		for (const line of lines) {
			if (importantPatterns.some(p => p.test(line))) {
				important.push(line);
			}
		}

		let summary = important.join('\n');
		if (summary.length > targetLength) {
			summary = summary.substring(0, targetLength - 30) + '\n// ... (code truncated)';
		}

		return summary || this.truncate(code, targetLength);
	}

	/**
	 * Summarize tool results by extracting key findings
	 */
	private summarizeToolResult(result: string, targetLength: number): string {
		// Extract file paths
		const pathMatches = result.match(/[\/\\][\w\/\\.-]+\.\w+/g) || [];
		const uniquePaths = [...new Set(pathMatches)].slice(0, 10);
		
		// Build compact summary
		let summary = '';
		if (uniquePaths.length > 0) {
			summary += `Files: ${uniquePaths.slice(0, 5).join(', ')}`;
			if (uniquePaths.length > 5) summary += ` (+${uniquePaths.length - 5} more)`;
			summary += '\n';
		}

		// Add first few lines of actual content
		const lines = result.split('\n').slice(0, 5);
		summary += lines.join('\n');

		if (summary.length > targetLength) {
			summary = summary.substring(0, targetLength - 20) + '\n... (truncated)';
		}

		return summary;
	}

	/**
	 * Summarize general text by keeping first and last parts
	 */
	private summarizeText(text: string, targetLength: number): string {
		// Keep first 60% and last 20% to maintain context flow
		const keepStart = Math.floor(targetLength * 0.6);
		const keepEnd = Math.floor(targetLength * 0.2);

		const start = text.substring(0, keepStart);
		const end = text.substring(text.length - keepEnd);

		return `${start}\n... (content summarized) ...\n${end}`;
	}

	/**
	 * Compress a batch of messages to fit within token limit
	 */
	compressMessages(
		messages: CompressibleMessage[],
		maxTotalLength: number
	): CompressibleMessage[] {
		let currentTotal = messages.reduce((sum, m) => sum + m.content.length, 0);
		
		if (currentTotal <= maxTotalLength) {
			return messages; // No compression needed
		}

		const compressed: CompressibleMessage[] = [];
		const charsToRemove = currentTotal - maxTotalLength;
		let removedSoFar = 0;

		// Calculate compression weight for each message
		const weights = messages.map((m, idx) => ({
			index: idx,
			weight: this.calculateCompressionWeight(m, idx, messages.length),
			originalLength: m.content.length
		}));

		// Sort by weight (highest weight = compress first)
		weights.sort((a, b) => b.weight - a.weight);

		// Compress messages in order of weight
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			const weightInfo = weights.find(w => w.index === i)!;
			
			if (removedSoFar < charsToRemove && weightInfo.weight > 0) {
				// Calculate how much to compress this message
				const compressionTarget = Math.max(
					MESSAGE_COMPRESSION.TRIM_TO_LENGTH,
					msg.content.length - (charsToRemove - removedSoFar)
				);

				const result = this.compress(msg, compressionTarget);
				compressed.push({
					...msg,
					content: result.compressed
				});
				removedSoFar += (result.originalLength - result.compressedLength);
			} else {
				compressed.push(msg);
			}
		}

		return compressed;
	}

	/**
	 * Calculate how much a message should be compressed (higher = compress more)
	 */
	private calculateCompressionWeight(
		message: CompressibleMessage,
		index: number,
		totalMessages: number
	): number {
		let weight = 1.0;

		// Recent messages have lower weight (compress less)
		const recency = (totalMessages - index) / totalMessages;
		weight *= (1 - recency * 0.5); // Recent messages: 50% less likely to compress

		// Apply role-based multipliers
		const roleMultipliers = MESSAGE_COMPRESSION.WEIGHT_MULTIPLIERS;
		const roleKey = message.role as keyof typeof roleMultipliers;
		if (roleKey in roleMultipliers) {
			weight *= roleMultipliers[roleKey];
		}

		// Important messages have lower weight
		if (message.metadata?.importance) {
			weight *= (1 - message.metadata.importance * 0.7);
		}

		// Preserve recent messages (last N messages)
		if (index >= totalMessages - MESSAGE_COMPRESSION.PRESERVE_RECENT_MESSAGES) {
			weight *= 0.1; // 90% less likely to compress
		}

		// Preserve first message
		if (MESSAGE_COMPRESSION.PRESERVE_FIRST_MESSAGE && index <= 1) {
			weight *= 0.1;
		}

		return weight;
	}
}

/**
 * Estimate tokens from character count
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / MESSAGE_COMPRESSION.CHARS_PER_TOKEN);
}

/**
 * Check if compression is needed
 */
export function needsCompression(
	messages: CompressibleMessage[],
	maxTokens: number
): boolean {
	const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
	const estimatedTokens = Math.ceil(totalChars / MESSAGE_COMPRESSION.CHARS_PER_TOKEN);
	return estimatedTokens > maxTokens;
}

// Singleton instance
export const messageCompressor = new MessageCompressor();
