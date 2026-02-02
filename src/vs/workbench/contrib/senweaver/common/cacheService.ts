/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Multi-Layer Cache Service
 *
 * Provides intelligent caching for system messages, directory structures,
 * file contents, and other frequently accessed data.
 */

import { CACHE_OPTIMIZATION } from './tokenOptimizationConfig.js';

export interface CacheEntry<T> {
	data: T;
	timestamp: number;
	hits: number;
}

export interface CacheStats {
	size: number;
	hits: number;
	misses: number;
	hitRate: number;
	evictions: number;
}

/**
 * Generic LRU Cache with TTL support
 */
export class LRUCache<K, V> {
	private cache = new Map<K, CacheEntry<V>>();
	private accessOrder: K[] = [];

	constructor(
		private maxSize: number,
		private ttlMs: number
	) { }

	private stats = {
		hits: 0,
		misses: 0,
		evictions: 0
	};

	get(key: K): V | null {
		const entry = this.cache.get(key);

		if (!entry) {
			this.stats.misses++;
			return null;
		}

		// Check if expired
		const now = Date.now();
		if (now - entry.timestamp > this.ttlMs) {
			this.cache.delete(key);
			this.removeFromAccessOrder(key);
			this.stats.misses++;
			return null;
		}

		// Update access order
		this.updateAccessOrder(key);
		entry.hits++;
		this.stats.hits++;

		return entry.data;
	}

	set(key: K, value: V): void {
		const now = Date.now();

		// If exists, update
		if (this.cache.has(key)) {
			const entry = this.cache.get(key)!;
			entry.data = value;
			entry.timestamp = now;
			this.updateAccessOrder(key);
			return;
		}

		// Evict if at capacity
		if (this.cache.size >= this.maxSize) {
			this.evictLRU();
		}

		// Add new entry
		this.cache.set(key, { data: value, timestamp: now, hits: 0 });
		this.accessOrder.push(key);
	}

	has(key: K): boolean {
		const entry = this.cache.get(key);
		if (!entry) return false;

		const now = Date.now();
		if (now - entry.timestamp > this.ttlMs) {
			this.cache.delete(key);
			this.removeFromAccessOrder(key);
			return false;
		}

		return true;
	}

	delete(key: K): boolean {
		const deleted = this.cache.delete(key);
		if (deleted) {
			this.removeFromAccessOrder(key);
		}
		return deleted;
	}

	clear(): void {
		this.cache.clear();
		this.accessOrder = [];
		this.stats = { hits: 0, misses: 0, evictions: 0 };
	}

	getStats(): CacheStats {
		const total = this.stats.hits + this.stats.misses;
		return {
			size: this.cache.size,
			hits: this.stats.hits,
			misses: this.stats.misses,
			hitRate: total > 0 ? this.stats.hits / total : 0,
			evictions: this.stats.evictions
		};
	}

	private evictLRU(): void {
		if (this.accessOrder.length === 0) return;

		const lruKey = this.accessOrder.shift()!;
		this.cache.delete(lruKey);
		this.stats.evictions++;
	}

	private updateAccessOrder(key: K): void {
		this.removeFromAccessOrder(key);
		this.accessOrder.push(key);
	}

	private removeFromAccessOrder(key: K): void {
		const index = this.accessOrder.indexOf(key);
		if (index > -1) {
			this.accessOrder.splice(index, 1);
		}
	}
}

/**
 * Multi-layer cache manager for different types of data
 */
export class MultiLayerCacheService {
	// L1: System messages (frequently accessed, medium TTL)
	private systemMessageCache = new LRUCache<string, string>(
		10, // max 10 different system messages
		CACHE_OPTIMIZATION.SYSTEM_MESSAGE_CACHE_TTL
	);

	// L2: Directory structures (expensive to compute, longer TTL)
	private directoryCache = new LRUCache<string, string>(
		20, // max 20 directories
		CACHE_OPTIMIZATION.DIRECTORY_CACHE_TTL
	);

	// L3: File contents (large data, shorter TTL)
	private fileContentCache = new LRUCache<string, string>(
		CACHE_OPTIMIZATION.FILE_CONTENT_CACHE_MAX_SIZE,
		CACHE_OPTIMIZATION.FILE_CONTENT_CACHE_TTL
	);

	// L4: Tool definitions (static, never expires)
	private toolDefinitionCache = new Map<string, any>();

	/**
	 * Get or compute system message
	 */
	async getSystemMessage(
		key: string,
		computer: () => Promise<string>
	): Promise<string> {
		const cached = this.systemMessageCache.get(key);
		if (cached !== null) {
			return cached;
		}

		const computed = await computer();
		this.systemMessageCache.set(key, computed);
		return computed;
	}

	/**
	 * Get or compute directory structure
	 */
	async getDirectory(
		path: string,
		computer: () => Promise<string>
	): Promise<string> {
		const cached = this.directoryCache.get(path);
		if (cached !== null) {
			return cached;
		}

		const computed = await computer();
		this.directoryCache.set(path, computed);
		return computed;
	}

	/**
	 * Get or read file content
	 */
	async getFileContent(
		uri: string,
		reader: () => Promise<string>
	): Promise<string> {
		const cached = this.fileContentCache.get(uri);
		if (cached !== null) {
			return cached;
		}

		const content = await reader();
		this.fileContentCache.set(uri, content);
		return content;
	}

	/**
	 * Invalidate file content cache (call when file changes)
	 */
	invalidateFile(uri: string): void {
		this.fileContentCache.delete(uri);
	}

	/**
	 * Invalidate directory cache (call when directory changes)
	 */
	invalidateDirectory(path: string): void {
		this.directoryCache.delete(path);
	}

	/**
	 * Get tool definition from cache
	 */
	getToolDefinition(toolName: string): any | null {
		return this.toolDefinitionCache.get(toolName) || null;
	}

	/**
	 * Cache tool definition
	 */
	setToolDefinition(toolName: string, definition: any): void {
		this.toolDefinitionCache.set(toolName, definition);
	}

	/**
	 * Get overall cache statistics
	 */
	getStats() {
		return {
			systemMessage: this.systemMessageCache.getStats(),
			directory: this.directoryCache.getStats(),
			fileContent: this.fileContentCache.getStats(),
			toolDefinitions: {
				size: this.toolDefinitionCache.size,
				hits: 0,
				misses: 0,
				hitRate: 0,
				evictions: 0
			}
		};
	}

	/**
	 * Print cache statistics to console
	 */
	printStats(): void {
		const stats = this.getStats();
		console.log('📦 Multi-Layer Cache Statistics:');
		console.log('  L1 (System Messages):', stats.systemMessage);
		console.log('  L2 (Directory):', stats.directory);
		console.log('  L3 (File Content):', stats.fileContent);
		console.log('  L4 (Tool Definitions):', stats.toolDefinitions);
	}

	/**
	 * Clear all caches
	 */
	clearAll(): void {
		this.systemMessageCache.clear();
		this.directoryCache.clear();
		this.fileContentCache.clear();
		this.toolDefinitionCache.clear();
	}
}

// Singleton instance
export const cacheService = new MultiLayerCacheService();
