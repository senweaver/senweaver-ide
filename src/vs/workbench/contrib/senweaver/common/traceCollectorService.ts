/*--------------------------------------------------------------------------------------
 *  Copyright 2025 SenWeaver. All rights reserved.
 *  Trace Collector Service - Async data collection service (Phase 1: RL data infrastructure)
 *  Design principles: fully async, non-blocking, no impact on existing functionality
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

// ==================== Type Definitions ====================

/** Trace Span type */
export type TraceSpanType =
	| 'llm_call'           // LLM call
	| 'tool_call'          // Tool call
	| 'user_message'       // User message
	| 'assistant_message'  // Assistant response
	| 'user_feedback'      // User feedback (good/bad)
	| 'edit_prediction'    // Edit prediction
	| 'checkpoint'         // Checkpoint
	| 'error';             // Error

/** User feedback type */
export type UserFeedbackType = 'good' | 'bad' | null;

/** Multi-dimensional reward signal (ref: agent-lightning RewardDimension) */
export interface RewardDimension {
	name: string;    // Dimension name, e.g. 'task_completion', 'code_quality', 'efficiency'
	value: number;   // Reward value, range [-1, 1]
}

/** Single Trace Span */
export interface TraceSpan {
	id: string;
	traceId: string;        // Parent Trace ID
	threadId: string;       // Chat thread ID
	messageIdx: number;     // Message index
	type: TraceSpanType;
	timestamp: number;
	duration?: number;      // Duration (ms)

	// Content data
	data: {
		// LLM call related
		model?: string;
		provider?: string;
		inputTokens?: number;
		outputTokens?: number;
		temperature?: number;

		// Message content (truncated to avoid excessive storage)
		contentPreview?: string;   // First 500 characters
		contentLength?: number;    // Original length

		// Tool call related
		toolName?: string;
		toolParams?: string;       // JSON string (truncated)
		toolResult?: string;       // JSON string (truncated)
		toolSuccess?: boolean;

		// User feedback
		feedback?: UserFeedbackType;

		// Multi-dimensional reward signals (ref: agent-lightning emit_reward)
		rewardDimensions?: RewardDimension[];

		// Error info
		errorMessage?: string;

		// Extra metadata
		metadata?: Record<string, unknown>;
	};
}

/** A complete conversation turn Trace */
export interface ConversationTrace {
	id: string;
	threadId: string;
	startTime: number;
	endTime?: number;
	spans: TraceSpan[];

	// Context metadata (e.g. chatMode, used by APO analysis)
	metadata?: Record<string, unknown>;

	// Aggregated info
	summary: {
		totalLLMCalls: number;
		totalToolCalls: number;
		totalTokens: number;
		userFeedback: UserFeedbackType;
		hasErrors: boolean;
		// Real tool call statistics
		toolCallsSucceeded: number;          // Tool call success count
		toolCallsFailed: number;             // Tool call failure count
		toolCallsByName: Record<string, { total: number; succeeded: number; failed: number }>; // Per-tool-name stats
		totalToolDurationMs: number;         // Total tool call duration (ms)
		// Multi-dimensional reward aggregation (ref: agent-lightning find_final_reward)
		finalReward: number | null;          // Final reward value (weighted composite)
		rewardDimensions: RewardDimension[];  // Per-dimension reward details
	};
}

/** Trace collector statistics */
export interface TraceCollectorStats {
	totalTraces: number;
	totalSpans: number;
	totalFeedbacks: number;
	goodFeedbacks: number;
	badFeedbacks: number;
	storageUsedBytes: number;
	oldestTraceTime: number | null;
	newestTraceTime: number | null;
	// Aggregated tool call statistics (real data)
	totalToolCalls: number;
	totalToolSucceeded: number;
	totalToolFailed: number;
	toolSuccessRate: number | null;
	// Aggregated reward statistics (real data)
	avgFinalReward: number | null;
	tracesWithReward: number;
}

// ==================== Service Interface ====================

export interface ITraceCollectorService {
	readonly _serviceBrand: undefined;

	/** State change event */
	readonly onDidChangeState: Event<void>;

	// --- Trace Lifecycle ---

	/** Start a new conversation turn Trace */
	startTrace(threadId: string, metadata?: Record<string, unknown>): string;

	/** End a conversation turn Trace */
	endTrace(traceId: string): void;

	/** End the currently active Trace for a given thread */
	endTraceForThread(threadId: string): void;

	// --- Span Recording (all async, fire-and-forget) ---

	/** Record user message */
	recordUserMessage(threadId: string, messageIdx: number, content: string): void;

	/** Record assistant response */
	recordAssistantMessage(threadId: string, messageIdx: number, content: string, model?: string, provider?: string): void;

	/** Record LLM call */
	recordLLMCall(threadId: string, messageIdx: number, data: {
		model?: string;
		provider?: string;
		inputTokens?: number;
		outputTokens?: number;
		temperature?: number;
		duration?: number;
	}): void;

	/** Record tool call */
	recordToolCall(threadId: string, messageIdx: number, data: {
		toolName: string;
		toolParams?: string;
		toolResult?: string;
		toolSuccess: boolean;
		duration?: number;
	}): void;

	/** Record user feedback (good/bad) */
	recordUserFeedback(threadId: string, messageIdx: number, feedback: UserFeedbackType): void;

	/** Record error */
	recordError(threadId: string, messageIdx: number, errorMessage: string): void;

	// --- Queries ---

	/** Get feedback status for a given thread */
	getFeedback(threadId: string, messageIdx: number): UserFeedbackType;

	/** Get statistics */
	getStats(): TraceCollectorStats;

	/** Get all Traces (for export) */
	getAllTraces(): ConversationTrace[];

	/** Export data as JSON */
	exportData(): string;

	/** Clear all data */
	clearAllData(): void;

	// --- Backend Upload (required for Phase 2 training) ---

	/** Upload Trace data to backend server (uses apiBaseUrl from product.json + /api/traces) */
	uploadToServer(): Promise<{ success: boolean; message: string; uploadedCount: number }>;

	/** Set auto-upload config (toggle + interval, URL auto-resolved from product.json) */
	setAutoUploadConfig(config: { enabled: boolean; intervalMs?: number }): void;

	/** Get current upload config */
	getAutoUploadConfig(): { enabled: boolean; intervalMs: number; traceApiUrl: string };
}

export const ITraceCollectorService = createDecorator<ITraceCollectorService>('senweaverTraceCollectorService');

// ==================== Service Implementation ====================

const TRACE_STORAGE_KEY = 'senweaver.traceCollector.data';
const TRACE_FEEDBACK_KEY = 'senweaver.traceCollector.feedbacks';
const MAX_CONTENT_PREVIEW = 500;
const MAX_TRACES = 1000;        // Max 1000 traces retained
const MAX_SPANS_PER_TRACE = 200; // Max 200 spans per trace
const FLUSH_INTERVAL = 30000;   // Auto-flush every 30 seconds

class TraceCollectorService extends Disposable implements ITraceCollectorService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	// In-memory data
	private _traces: Map<string, ConversationTrace> = new Map();
	private _activeTraces: Map<string, string> = new Map(); // threadId -> traceId
	private _feedbacks: Map<string, UserFeedbackType> = new Map(); // `${threadId}:${messageIdx}` -> feedback
	private _dirty = false;
	private _flushTimer: ReturnType<typeof setInterval> | null = null;

	private readonly _traceApiUrl: string;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IProductService private readonly _productService: IProductService,
		@IRequestService private readonly _requestService: IRequestService,
	) {
		super();
		// Read apiBaseUrl from product.json, append /api/traces
		const apiBaseUrl = this._productService.senweaverApiConfig?.apiBaseUrl || 'https://ide-api.senweaver.com';
		this._traceApiUrl = `${apiBaseUrl}/api/traces`;
		this._loadFromStorage();
		this._loadUploadConfig();
		this._loadUploadedIds();
		this._startAutoFlush();
	}

	// --- Internal Utility Methods ---

	private _feedbackKey(threadId: string, messageIdx: number): string {
		return `${threadId}:${messageIdx}`;
	}

	private _truncate(str: string | undefined, maxLen: number = MAX_CONTENT_PREVIEW): string {
		if (!str) return '';
		return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
	}

	private _getOrCreateTrace(threadId: string): ConversationTrace {
		let traceId = this._activeTraces.get(threadId);
		if (traceId && this._traces.has(traceId)) {
			return this._traces.get(traceId)!;
		}
		// Auto-create
		const newTraceId = this.startTrace(threadId);
		return this._traces.get(newTraceId)!;
	}

	private _addSpan(trace: ConversationTrace, span: TraceSpan): void {
		if (trace.spans.length >= MAX_SPANS_PER_TRACE) {
			return; // Prevent memory overflow
		}
		trace.spans.push(span);
		this._dirty = true;
	}

	private _createSpan(traceId: string, threadId: string, messageIdx: number, type: TraceSpanType, data: TraceSpan['data']): TraceSpan {
		return {
			id: generateUuid(),
			traceId,
			threadId,
			messageIdx,
			type,
			timestamp: Date.now(),
			data,
		};
	}

	// --- Storage ---

	private _loadFromStorage(): void {
		try {
			const tracesJson = this._storageService.get(TRACE_STORAGE_KEY, StorageScope.APPLICATION, '[]');
			const traces: ConversationTrace[] = JSON.parse(tracesJson);
			for (const trace of traces) {
				this._traces.set(trace.id, trace);
			}

			const feedbacksJson = this._storageService.get(TRACE_FEEDBACK_KEY, StorageScope.APPLICATION, '{}');
			const feedbacks: Record<string, UserFeedbackType> = JSON.parse(feedbacksJson);
			for (const [key, value] of Object.entries(feedbacks)) {
				this._feedbacks.set(key, value);
			}
		} catch (e) {
			// Silent failure, does not affect normal functionality
			console.warn('[TraceCollector] Failed to load from storage:', e);
		}
	}

	private _loadUploadConfig(): void {
		try {
			const configJson = this._storageService.get('senweaver.traceCollector.uploadConfig', StorageScope.APPLICATION);
			if (configJson) {
				const config = JSON.parse(configJson);
				if (config.enabled) {
					this.setAutoUploadConfig({ enabled: config.enabled, intervalMs: config.intervalMs });
				} else {
					this._autoUploadConfig = { enabled: false, intervalMs: config.intervalMs ?? 300000 };
				}
			}
		} catch {
			// Silent failure
		}
	}

	private _saveToStorage(): void {
		if (!this._dirty) return;

		try {
			// Limit storage size
			const allTraces = Array.from(this._traces.values());
			if (allTraces.length > MAX_TRACES) {
				// Sort by time, keep the newest
				allTraces.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
				const toKeep = allTraces.slice(0, MAX_TRACES);
				this._traces.clear();
				for (const t of toKeep) {
					this._traces.set(t.id, t);
				}
			}

			const tracesJson = JSON.stringify(Array.from(this._traces.values()));
			this._storageService.store(TRACE_STORAGE_KEY, tracesJson, StorageScope.APPLICATION, StorageTarget.MACHINE);

			const feedbacksObj: Record<string, UserFeedbackType> = {};
			this._feedbacks.forEach((v, k) => { feedbacksObj[k] = v; });
			const feedbacksJson = JSON.stringify(feedbacksObj);
			this._storageService.store(TRACE_FEEDBACK_KEY, feedbacksJson, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this._dirty = false;
		} catch (e) {
			console.warn('[TraceCollector] Failed to save to storage:', e);
		}
	}

	private _startAutoFlush(): void {
		this._flushTimer = setInterval(() => {
			this._saveToStorage();
		}, FLUSH_INTERVAL);

		this._register({
			dispose: () => {
				if (this._flushTimer) {
					clearInterval(this._flushTimer);
					this._flushTimer = null;
				}
				// Final save
				this._saveToStorage();
			}
		});
	}

	// --- Trace Lifecycle ---

	startTrace(threadId: string, metadata?: Record<string, unknown>): string {
		const traceId = generateUuid();
		const trace: ConversationTrace = {
			id: traceId,
			threadId,
			startTime: Date.now(),
			spans: [],
			summary: {
				totalLLMCalls: 0,
				totalToolCalls: 0,
				totalTokens: 0,
				userFeedback: null,
				hasErrors: false,
				toolCallsSucceeded: 0,
				toolCallsFailed: 0,
				toolCallsByName: {},
				totalToolDurationMs: 0,
				finalReward: null,
				rewardDimensions: [],
			},
			metadata,
		};
		this._traces.set(traceId, trace);
		this._activeTraces.set(threadId, traceId);
		this._dirty = true;
		return traceId;
	}

	endTrace(traceId: string): void {
		const trace = this._traces.get(traceId);
		if (trace) {
			trace.endTime = Date.now();
			// Auto-compute multi-dimensional reward signals (ref: agent-lightning find_final_reward)
			this._computeRewardSignals(trace);
			this._dirty = true;
			// Async save
			queueMicrotask(() => this._saveToStorage());
		}
	}

	endTraceForThread(threadId: string): void {
		const traceId = this._activeTraces.get(threadId);
		if (traceId) {
			this.endTrace(traceId);
		}
	}

	// --- Span Recording (all fire-and-forget) ---

	recordUserMessage(threadId: string, messageIdx: number, content: string): void {
		queueMicrotask(() => {
			try {
				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'user_message', {
					contentPreview: this._truncate(content),
					contentLength: content.length,
				});
				this._addSpan(trace, span);
			} catch { /* silent */ }
		});
	}

	recordAssistantMessage(threadId: string, messageIdx: number, content: string, model?: string, provider?: string): void {
		queueMicrotask(() => {
			try {
				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'assistant_message', {
					contentPreview: this._truncate(content),
					contentLength: content.length,
					model,
					provider,
				});
				this._addSpan(trace, span);
				// Note: totalLLMCalls is incremented in recordLLMCall only, to avoid double-counting
				// when both recordAssistantMessage and recordLLMCall are called for the same turn
			} catch { /* silent */ }
		});
	}

	recordLLMCall(threadId: string, messageIdx: number, data: {
		model?: string;
		provider?: string;
		inputTokens?: number;
		outputTokens?: number;
		temperature?: number;
		duration?: number;
	}): void {
		queueMicrotask(() => {
			try {
				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'llm_call', {
					model: data.model,
					provider: data.provider,
					inputTokens: data.inputTokens,
					outputTokens: data.outputTokens,
					temperature: data.temperature,
				});
				span.duration = data.duration;
				this._addSpan(trace, span);
				trace.summary.totalLLMCalls++;
				trace.summary.totalTokens += (data.inputTokens || 0) + (data.outputTokens || 0);
			} catch { /* silent */ }
		});
	}

	recordToolCall(threadId: string, messageIdx: number, data: {
		toolName: string;
		toolParams?: string;
		toolResult?: string;
		toolSuccess: boolean;
		duration?: number;
	}): void {
		queueMicrotask(() => {
			try {
				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'tool_call', {
					toolName: data.toolName,
					toolParams: this._truncate(data.toolParams),
					toolResult: this._truncate(data.toolResult),
					toolSuccess: data.toolSuccess,
				});
				span.duration = data.duration;
				this._addSpan(trace, span);

				// Real tool call success/failure statistics
				trace.summary.totalToolCalls++;
				if (data.toolSuccess) {
					trace.summary.toolCallsSucceeded++;
				} else {
					trace.summary.toolCallsFailed++;
				}

				// Per-tool-name grouped statistics
				const toolStats = trace.summary.toolCallsByName[data.toolName] || { total: 0, succeeded: 0, failed: 0 };
				toolStats.total++;
				if (data.toolSuccess) {
					toolStats.succeeded++;
				} else {
					toolStats.failed++;
				}
				trace.summary.toolCallsByName[data.toolName] = toolStats;

				// Accumulate tool call duration
				if (data.duration && data.duration > 0) {
					trace.summary.totalToolDurationMs += data.duration;
				}

				this._dirty = true;
			} catch { /* silent */ }
		});
	}

	recordUserFeedback(threadId: string, messageIdx: number, feedback: UserFeedbackType): void {
		queueMicrotask(() => {
			try {
				const key = this._feedbackKey(threadId, messageIdx);
				this._feedbacks.set(key, feedback);

				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'user_feedback', {
					feedback,
				});
				this._addSpan(trace, span);
				trace.summary.userFeedback = feedback;
				this._dirty = true;

				// After feedback change, async recompute reward signals (feedback is the most important reward dimension)
				this._computeRewardSignals(trace);

				// Notify UI immediately on feedback change
				this._onDidChangeState.fire();

				// Persist feedback data immediately
				this._saveToStorage();
			} catch { /* silent */ }
		});
	}

	recordError(threadId: string, messageIdx: number, errorMessage: string): void {
		queueMicrotask(() => {
			try {
				const trace = this._getOrCreateTrace(threadId);
				const span = this._createSpan(trace.id, threadId, messageIdx, 'error', {
					errorMessage: this._truncate(errorMessage, 1000),
				});
				this._addSpan(trace, span);
				trace.summary.hasErrors = true;
			} catch { /* silent */ }
		});
	}

	// --- Queries ---

	getFeedback(threadId: string, messageIdx: number): UserFeedbackType {
		return this._feedbacks.get(this._feedbackKey(threadId, messageIdx)) ?? null;
	}

	getStats(): TraceCollectorStats {
		let totalSpans = 0;
		let goodFeedbacks = 0;
		let badFeedbacks = 0;
		let oldestTime: number | null = null;
		let newestTime: number | null = null;

		for (const trace of this._traces.values()) {
			totalSpans += trace.spans.length;
			if (oldestTime === null || trace.startTime < oldestTime) oldestTime = trace.startTime;
			if (newestTime === null || trace.startTime > newestTime) newestTime = trace.startTime;
		}

		for (const fb of this._feedbacks.values()) {
			if (fb === 'good') goodFeedbacks++;
			if (fb === 'bad') badFeedbacks++;
		}

		// Aggregate tool call and reward statistics (from real summary data)
		let totalToolCalls = 0;
		let totalToolSucceeded = 0;
		let totalToolFailed = 0;
		let rewardSum = 0;
		let tracesWithReward = 0;

		for (const trace of this._traces.values()) {
			totalToolCalls += trace.summary.totalToolCalls;
			totalToolSucceeded += trace.summary.toolCallsSucceeded;
			totalToolFailed += trace.summary.toolCallsFailed;
			if (trace.summary.finalReward !== null) {
				rewardSum += trace.summary.finalReward;
				tracesWithReward++;
			}
		}

		return {
			totalTraces: this._traces.size,
			totalSpans,
			totalFeedbacks: goodFeedbacks + badFeedbacks,
			goodFeedbacks,
			badFeedbacks,
			storageUsedBytes: this._estimateStorageBytes(),
			oldestTraceTime: oldestTime,
			newestTraceTime: newestTime,
			totalToolCalls,
			totalToolSucceeded,
			totalToolFailed,
			toolSuccessRate: totalToolCalls > 0 ? totalToolSucceeded / totalToolCalls : null,
			avgFinalReward: tracesWithReward > 0 ? rewardSum / tracesWithReward : null,
			tracesWithReward,
		};
	}

	getAllTraces(): ConversationTrace[] {
		return Array.from(this._traces.values());
	}

	exportData(): string {
		return JSON.stringify({
			version: '1.0.0',
			exportTime: new Date().toISOString(),
			stats: this.getStats(),
			traces: this.getAllTraces(),
			feedbacks: Object.fromEntries(this._feedbacks),
		}, null, 2);
	}

	clearAllData(): void {
		this._traces.clear();
		this._activeTraces.clear();
		this._feedbacks.clear();
		this._dirty = true;
		this._saveToStorage();
		this._onDidChangeState.fire();
	}

	// --- Storage Size Estimation ---

	private _estimateStorageBytes(): number {
		try {
			const tracesJson = JSON.stringify(Array.from(this._traces.values()));
			const feedbacksJson = JSON.stringify(Object.fromEntries(this._feedbacks));
			// Estimate byte length using string length (UTF-8, mostly ASCII in JSON so ~= length)
			return tracesJson.length + feedbacksJson.length;
		} catch {
			return 0;
		}
	}

	// --- Multi-dimensional Reward Signal Computation (ref: agent-lightning find_final_reward + emit_reward) ---

	private _computeRewardSignals(trace: ConversationTrace): void {
		const dims: RewardDimension[] = [];
		const s = trace.summary;

		// Detect chat mode for adaptive thresholds
		const chatMode = (trace.metadata?.chatMode as string) || 'normal';
		const isAgentMode = chatMode === 'agent';

		// Dimension 1: User feedback (highest weight, direct signal)
		const feedbackScore = s.userFeedback === 'good' ? 1.0
			: s.userFeedback === 'bad' ? -1.0 : 0.0;
		dims.push({ name: 'user_feedback', value: feedbackScore });

		// Dimension 2: Task completion (based on errors and normal termination)
		let completionScore = 0.5; // Default neutral
		if (trace.endTime && !s.hasErrors) {
			completionScore = 0.8; // Completed normally
		}
		if (s.hasErrors) {
			completionScore = -0.5; // Has errors
		}
		if (s.userFeedback === 'good') {
			completionScore = 1.0; // User confirmed completion
		}
		dims.push({ name: 'task_completion', value: completionScore });

		// Dimensions 3-5: Tool call related (adaptive thresholds based on chatMode)
		if (s.totalToolCalls > 0) {
			// Dimension 3: Tool call success rate
			const toolSuccessRate = s.toolCallsSucceeded / s.totalToolCalls; // 0~1
			dims.push({ name: 'tool_success_rate', value: toolSuccessRate * 2 - 1 }); // Map to [-1, 1]

			// Dimension 4: Tool call failure penalty (adaptive: agent mode tolerates more failures)
			let toolFailPenalty = 1.0;
			const failThresholds = isAgentMode
				? { severe: 5, moderate: 3, minor: 2 }  // Agent mode: more tool calls expected
				: { severe: 3, moderate: 2, minor: 1 };  // Normal mode: strict
			if (s.toolCallsFailed >= failThresholds.severe) toolFailPenalty = -1.0;
			else if (s.toolCallsFailed >= failThresholds.moderate) toolFailPenalty = -0.5;
			else if (s.toolCallsFailed >= failThresholds.minor) toolFailPenalty = -0.2;
			dims.push({ name: 'tool_call_reliability', value: toolFailPenalty });

			// Dimension 5: Tool call efficiency (adaptive: agent mode expects more calls)
			const countThresholds = isAgentMode
				? { excellent: 8, good: 15, fair: 25 }   // Agent mode: complex multi-step tasks
				: { excellent: 3, good: 6, fair: 10 };   // Normal mode: fewer calls expected
			let toolCountScore = 1.0;
			if (s.totalToolCalls > countThresholds.fair) toolCountScore = -0.8;
			else if (s.totalToolCalls > countThresholds.good) toolCountScore = -0.3;
			else if (s.totalToolCalls > countThresholds.excellent) toolCountScore = 0.3;
			dims.push({ name: 'tool_call_efficiency', value: toolCountScore });

			// Dimension 5b: Tool call duration efficiency (slow tools indicate problems)
			if (s.totalToolDurationMs > 0) {
				const avgDuration = s.totalToolDurationMs / s.totalToolCalls;
				// <1s=1.0, 1-3s=0.5, 3-10s=0, >10s=-0.5
				let durationScore = 1.0;
				if (avgDuration > 10000) durationScore = -0.5;
				else if (avgDuration > 3000) durationScore = 0.0;
				else if (avgDuration > 1000) durationScore = 0.5;
				dims.push({ name: 'tool_duration_efficiency', value: durationScore });
			}
		}

		// Dimension 6: Response efficiency (based on LLM call count, adaptive)
		if (s.totalLLMCalls > 0) {
			const llmThreshold = isAgentMode ? 3 : 1; // Agent mode: multi-turn LLM calls expected
			const efficiencyScore = Math.max(-1, 1 - Math.max(0, s.totalLLMCalls - llmThreshold) * 0.4);
			dims.push({ name: 'response_efficiency', value: efficiencyScore });
		}

		// Dimension 7: Token efficiency (adaptive thresholds)
		if (s.totalTokens > 0) {
			const tokenThresholds = isAgentMode
				? { excellent: 5000, good: 15000, fair: 30000 }  // Agent mode: higher token budget
				: { excellent: 2000, good: 5000, fair: 10000 };  // Normal mode
			let tokenScore = 1.0;
			if (s.totalTokens > tokenThresholds.fair) tokenScore = -0.5;
			else if (s.totalTokens > tokenThresholds.good) tokenScore = 0.0;
			else if (s.totalTokens > tokenThresholds.excellent) tokenScore = 0.5;
			dims.push({ name: 'token_efficiency', value: tokenScore });
		}

		// Dimension 8: Conversation depth (many back-and-forth turns indicate poor resolution)
		const userMsgCount = trace.spans.filter(sp => sp.type === 'user_message').length;
		const assistantMsgCount = trace.spans.filter(sp => sp.type === 'assistant_message').length;
		const conversationTurns = Math.min(userMsgCount, assistantMsgCount);
		if (conversationTurns > 0) {
			const turnThreshold = isAgentMode ? 3 : 2;
			// Within threshold=1.0, slightly over=0.3, double=−0.3, triple+=−0.8
			let turnScore = 1.0;
			if (conversationTurns > turnThreshold * 3) turnScore = -0.8;
			else if (conversationTurns > turnThreshold * 2) turnScore = -0.3;
			else if (conversationTurns > turnThreshold) turnScore = 0.3;
			dims.push({ name: 'conversation_efficiency', value: turnScore });
		}

		// Compute composite finalReward (weighted average, user feedback has highest weight)
		const weights: Record<string, number> = {
			'user_feedback': 0.25,
			'task_completion': 0.18,
			'tool_success_rate': 0.12,
			'tool_call_reliability': 0.08,
			'tool_call_efficiency': 0.05,
			'tool_duration_efficiency': 0.05,
			'response_efficiency': 0.08,
			'token_efficiency': 0.08,
			'conversation_efficiency': 0.11,
		};
		let weightedSum = 0;
		let totalWeight = 0;
		for (const dim of dims) {
			const w = weights[dim.name] ?? 0.05;
			weightedSum += dim.value * w;
			totalWeight += w;
		}
		const finalReward = totalWeight > 0 ? weightedSum / totalWeight : null;

		trace.summary.rewardDimensions = dims;
		trace.summary.finalReward = finalReward;
	}

	// --- Backend Upload (required for Phase 2 training) ---

	private _autoUploadConfig = { enabled: false, intervalMs: 300000 }; // Default 5 minutes
	private _autoUploadTimer: ReturnType<typeof setInterval> | null = null;
	private _lastUploadedTraceIds = new Set<string>();
	private static readonly UPLOADED_IDS_KEY = 'senweaver.traceCollector.uploadedIds';

	async uploadToServer(): Promise<{ success: boolean; message: string; uploadedCount: number }> {
		try {
			// Only upload traces not yet uploaded (incremental upload)
			const newTraces = Array.from(this._traces.values()).filter(t => !this._lastUploadedTraceIds.has(t.id));
			if (newTraces.length === 0) {
				return { success: true, message: 'No new traces to upload', uploadedCount: 0 };
			}

			// Aggregate reward summary (real stats, for backend training)
			const tracesWithReward = newTraces.filter(t => t.summary.finalReward !== null);
			const avgFinalReward = tracesWithReward.length > 0
				? tracesWithReward.reduce((sum, t) => sum + (t.summary.finalReward || 0), 0) / tracesWithReward.length
				: null;

			// Aggregate tool call statistics
			let totalToolSucceeded = 0;
			let totalToolFailed = 0;
			let totalToolDuration = 0;
			const globalToolByName: Record<string, { total: number; succeeded: number; failed: number }> = {};
			for (const t of newTraces) {
				totalToolSucceeded += t.summary.toolCallsSucceeded;
				totalToolFailed += t.summary.toolCallsFailed;
				totalToolDuration += t.summary.totalToolDurationMs;
				for (const [name, stats] of Object.entries(t.summary.toolCallsByName)) {
					if (!globalToolByName[name]) {
						globalToolByName[name] = { total: 0, succeeded: 0, failed: 0 };
					}
					globalToolByName[name].total += stats.total;
					globalToolByName[name].succeeded += stats.succeeded;
					globalToolByName[name].failed += stats.failed;
				}
			}

			// Aggregate average per reward dimension
			const rewardDimAgg: Record<string, { sum: number; count: number }> = {};
			for (const t of tracesWithReward) {
				for (const dim of t.summary.rewardDimensions) {
					if (!rewardDimAgg[dim.name]) {
						rewardDimAgg[dim.name] = { sum: 0, count: 0 };
					}
					rewardDimAgg[dim.name].sum += dim.value;
					rewardDimAgg[dim.name].count++;
				}
			}
			const rewardDimensionAvg: Record<string, number> = {};
			for (const [name, agg] of Object.entries(rewardDimAgg)) {
				rewardDimensionAvg[name] = agg.count > 0 ? agg.sum / agg.count : 0;
			}

			const payload = {
				version: '2.0.0',
				uploadTime: new Date().toISOString(),
				traces: newTraces,
				feedbacks: Object.fromEntries(
					Array.from(this._feedbacks.entries()).filter(([key]) => {
						const threadId = key.split(':')[0];
						return newTraces.some(t => t.threadId === threadId);
					})
				),
				// Multi-dimensional reward aggregation summary (real stats, for backend RL training)
				rewardSummary: {
					totalTracesWithReward: tracesWithReward.length,
					avgFinalReward,
					rewardDimensionAvg,
				},
				// Aggregated tool call statistics (real data, for backend model tool call capability analysis)
				toolCallSummary: {
					totalToolCalls: totalToolSucceeded + totalToolFailed,
					totalSucceeded: totalToolSucceeded,
					totalFailed: totalToolFailed,
					successRate: (totalToolSucceeded + totalToolFailed) > 0
						? totalToolSucceeded / (totalToolSucceeded + totalToolFailed)
						: null,
					totalDurationMs: totalToolDuration,
					byToolName: globalToolByName,
				},
			};

			// Use apiBaseUrl from product.json + /api/traces
			const response = await this._requestService.request({
				type: 'POST',
				url: this._traceApiUrl,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(payload),
			}, CancellationToken.None);

			if (response.res.statusCode && response.res.statusCode >= 400) {
				return { success: false, message: `Server returned ${response.res.statusCode}`, uploadedCount: 0 };
			}

			// Mark as uploaded and persist
			for (const t of newTraces) {
				this._lastUploadedTraceIds.add(t.id);
			}
			this._saveUploadedIds();

			return { success: true, message: 'Upload successful', uploadedCount: newTraces.length };
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			console.warn('[TraceCollector] Upload failed:', errMsg);
			return { success: false, message: `Upload failed: ${errMsg}`, uploadedCount: 0 };
		}
	}

	setAutoUploadConfig(config: { enabled: boolean; intervalMs?: number }): void {
		this._autoUploadConfig = {
			enabled: config.enabled,
			intervalMs: config.intervalMs ?? 300000,
		};

		// Clear old timer
		if (this._autoUploadTimer) {
			clearInterval(this._autoUploadTimer);
			this._autoUploadTimer = null;
		}

		// Start auto-upload
		if (config.enabled) {
			this._autoUploadTimer = setInterval(() => {
				this.uploadToServer().catch(() => { /* silent */ });
			}, this._autoUploadConfig.intervalMs);

			this._register({
				dispose: () => {
					if (this._autoUploadTimer) {
						clearInterval(this._autoUploadTimer);
						this._autoUploadTimer = null;
					}
				}
			});
		}

		// Persist config
		try {
			this._storageService.store(
				'senweaver.traceCollector.uploadConfig',
				JSON.stringify(this._autoUploadConfig),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch { /* silent */ }
	}

	getAutoUploadConfig(): { enabled: boolean; intervalMs: number; traceApiUrl: string } {
		return { ...this._autoUploadConfig, traceApiUrl: this._traceApiUrl };
	}

	private _loadUploadedIds(): void {
		try {
			const json = this._storageService.get(TraceCollectorService.UPLOADED_IDS_KEY, StorageScope.APPLICATION);
			if (json) {
				const ids: string[] = JSON.parse(json);
				this._lastUploadedTraceIds = new Set(ids);
			}
		} catch { /* silent */ }
	}

	private _saveUploadedIds(): void {
		try {
			// Only keep IDs that still exist in traces (avoid unbounded growth)
			const validIds = Array.from(this._lastUploadedTraceIds).filter(id => this._traces.has(id));
			this._lastUploadedTraceIds = new Set(validIds);
			this._storageService.store(
				TraceCollectorService.UPLOADED_IDS_KEY,
				JSON.stringify(validIds),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} catch { /* silent */ }
	}
}

registerSingleton(ITraceCollectorService, TraceCollectorService, InstantiationType.Delayed);
