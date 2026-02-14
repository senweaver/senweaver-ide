/*--------------------------------------------------------------------------------------
 *  Copyright 2025 SenWeaver. All rights reserved.
 *  APO Service - Automatic Prompt Optimization service (Phase 2: RL APO)
 *  Design principles: fully async, non-blocking, no impact on existing functionality
 *  Core idea: analyze prompt effectiveness based on Phase 1 trace+feedback data, generate optimization segments
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITraceCollectorService, ConversationTrace, UserFeedbackType } from './traceCollectorService.js';

// ==================== Type Definitions ====================

/** Prompt segment category — independently optimizable prompt unit */
export type PromptSegmentCategory =
	| 'core_behavior'       // Core behavior rules (e.g. task completion, tool usage)
	| 'code_quality'        // Code quality rules
	| 'tool_usage'          // Tool usage strategy
	| 'output_format'       // Output format rules
	| 'context_management'  // Context management rules
	| 'mode_specific'       // Mode-specific rules (agent/designer/gather/normal)
	| 'user_instructions';  // User-defined instructions

/** Single prompt segment */
export interface PromptSegment {
	id: string;
	category: PromptSegmentCategory;
	content: string;              // Prompt text content
	isActive: boolean;            // Whether enabled
	isOptimized: boolean;         // Whether APO-optimized version
	originalContent?: string;     // Original content before optimization (for rollback)
	version: number;              // Version number
	createdAt: number;
	updatedAt: number;
}

/** Prompt effectiveness report */
export interface PromptEffectivenessReport {
	id: string;
	generatedAt: number;
	period: { from: number; to: number };

	// Overall statistics
	totalConversations: number;
	goodFeedbackCount: number;
	badFeedbackCount: number;
	noFeedbackCount: number;
	goodRate: number;             // good / (good + bad)

	// Per-mode statistics
	byMode: Record<string, {
		total: number;
		good: number;
		bad: number;
		goodRate: number;
	}>;

	// Issue pattern analysis
	patterns: PromptIssuePattern[];

	// Optimization suggestions
	suggestions: PromptOptimizationSuggestion[];
}

/** Issue pattern — common problems extracted from bad feedback */
export interface PromptIssuePattern {
	id: string;
	description: string;          // Issue description
	frequency: number;            // Occurrence frequency
	severity: 'low' | 'medium' | 'high';
	relatedCategory: PromptSegmentCategory;
	examples: Array<{             // Typical examples (max 3)
		threadId: string;
		userMessagePreview: string;
		assistantMessagePreview: string;
		feedback: UserFeedbackType;
	}>;
}

/** Prompt optimization suggestion */
export interface PromptOptimizationSuggestion {
	id: string;
	targetCategory: PromptSegmentCategory;
	targetSegmentId?: string;     // Target segment (optional)
	type: 'add' | 'modify' | 'remove' | 'reorder';
	priority: 'low' | 'medium' | 'high';
	description: string;          // Suggestion description
	suggestedContent?: string;    // Suggested new prompt content
	reasoning: string;            // Reasoning process
	estimatedImpact: string;      // Estimated impact
	status: 'pending' | 'applied' | 'rejected' | 'reverted';
	appliedAt?: number;
	// Beam Search related (ref: agent-lightning VersionedPromptTemplate)
	promptVersion?: string;       // Source prompt version
	validationScore?: number;     // Validation set score
}

// ==================== Textual Gradient + Beam Search Types (ref: agent-lightning APO) ====================

/** Rollout result (ref: agent-lightning RolloutResultForAPO) */
export interface RolloutResultForAPO {
	traceId: string;
	threadId: string;
	status: 'succeeded' | 'failed' | 'unknown';
	finalReward: number | null;
	rewardDimensions: Array<{ name: string; value: number }>;
	messages: Array<{
		role: 'user' | 'assistant' | 'tool';
		content: string;
		toolName?: string;
		toolSuccess?: boolean;
	}>;
	chatMode: string;
	// Real tool call statistics (from real summary records)
	toolCallStats: {
		totalCalls: number;
		succeeded: number;
		failed: number;
		successRate: number | null;
		byToolName: Record<string, { total: number; succeeded: number; failed: number }>;
		totalDurationMs: number;
	};
	// Real LLM statistics
	llmStats: {
		totalCalls: number;
		totalTokens: number;
	};
}

/** Versioned prompt template (ref: agent-lightning VersionedPromptTemplate) */
export interface VersionedPromptTemplate {
	version: string;              // Version identifier, e.g. 'v0', 'v1', ...
	content: string;              // Prompt template content
	score: number | null;         // Validation set score
	parentVersion?: string;       // Parent version (optimized from which version)
	createdAt: number;
}

/** Textual Gradient (critique) (ref: agent-lightning compute_textual_gradient) */
export interface TextualGradient {
	id: string;
	promptVersion: string;        // Target prompt version
	critique: string;             // LLM-generated critique/improvement suggestions
	rolloutSummary: string;       // Based on which rollout results
	createdAt: number;
}

/** Beam Search state (ref: agent-lightning APO.run beam search) */
export interface BeamSearchState {
	currentRound: number;         // Current round
	totalRounds: number;          // Total rounds
	beam: VersionedPromptTemplate[];  // Current beam candidate prompts
	historyBestPrompt: VersionedPromptTemplate | null;  // History best prompt
	historyBestScore: number;     // History best score
	versionCounter: number;       // Version counter
	startedAt: number;
	lastUpdatedAt: number;
}

/** APO configuration */
export interface APOConfig {
	enabled: boolean;
	autoAnalyzeEnabled: boolean;       // Whether auto-analysis is enabled
	autoAnalyzeIntervalMs: number;     // Auto-analysis interval (default 1 hour)
	minTracesForAnalysis: number;      // Min trace count to trigger analysis (default 20)
	minFeedbacksForAnalysis: number;   // Min feedback count to trigger analysis (default 10)
	autoApplySuggestions: boolean;     // Whether to auto-apply suggestions (default false, requires user confirmation)
	uploadOptimizationsToServer: boolean; // Whether to upload optimization results to backend
	// Beam Search config (ref: agent-lightning APO.__init__)
	beamWidth: number;                 // Beam width (retain top-k candidate prompts)
	branchFactor: number;              // Candidates generated per parent
	beamRounds: number;                // Beam search rounds
	gradientBatchSize: number;         // Rollout sample size for gradient computation
}

/** APO statistics */
export interface APOStats {
	totalReports: number;
	totalSuggestions: number;
	appliedSuggestions: number;
	rejectedSuggestions: number;
	activeSegments: number;
	optimizedSegments: number;
	lastAnalysisTime: number | null;
	currentGoodRate: number | null;
	// Beam Search statistics (ref: agent-lightning)
	beamSearchActive: boolean;
	beamCurrentRound: number | null;
	beamBestScore: number | null;
	totalTextualGradients: number;
	avgFinalReward: number | null;     // Average finalReward of recent traces
}

// ==================== Service Interface ====================

export interface IAPOService {
	readonly _serviceBrand: undefined;

	/** State change event */
	readonly onDidChangeState: Event<void>;

	/** New optimization suggestions generated event */
	readonly onDidGenerateSuggestions: Event<PromptOptimizationSuggestion[]>;

	// --- Analysis & Optimization ---

	/** Analyze current prompt effectiveness (based on trace+feedback data) */
	analyzePromptEffectiveness(): Promise<PromptEffectivenessReport>;

	/** Request optimization suggestions from backend (requires LLM capability) */
	requestOptimizationFromServer(): Promise<PromptOptimizationSuggestion[]>;

	/** Request Textual Gradient (ref: agent-lightning textual_gradient_and_apply_edit) */
	requestTextualGradient(): Promise<TextualGradient | null>;

	// --- Prompt Segment Management ---

	/** Get all active prompt segments */
	getActiveSegments(): PromptSegment[];

	/** Get optimized prompt content for a given category (used by convertToLLMMessageService) */
	getOptimizedPromptForCategory(category: PromptSegmentCategory): string | null;

	/** Get all optimized additional rules (injected into system message) */
	getOptimizedRules(): string[];

	/** Apply an optimization suggestion */
	applySuggestion(suggestionId: string): void;

	/** Reject an optimization suggestion */
	rejectSuggestion(suggestionId: string): void;

	/** Revert an applied optimization */
	revertSuggestion(suggestionId: string): void;

	// --- Queries ---

	/** Get the latest effectiveness report */
	getLatestReport(): PromptEffectivenessReport | null;

	/** Get all pending suggestions */
	getPendingSuggestions(): PromptOptimizationSuggestion[];

	/** Get statistics */
	getStats(): APOStats;

	/** Get configuration */
	getConfig(): APOConfig;

	/** Update configuration */
	setConfig(config: Partial<APOConfig>): void;

	// --- Beam Search Queries (ref: agent-lightning APO) ---

	/** Get current Beam Search state */
	getBeamState(): BeamSearchState | null;

	/** Get recent Textual Gradient list */
	getTextualGradients(limit?: number): TextualGradient[];
}

export const IAPOService = createDecorator<IAPOService>('senweaverAPOService');

// ==================== Service Implementation ====================

const APO_STORAGE_KEY = 'senweaver.apo.data';
const APO_CONFIG_KEY = 'senweaver.apo.config';
const APO_SEGMENTS_KEY = 'senweaver.apo.segments';
const MAX_REPORTS = 50;          // Max 50 reports retained
const MAX_SUGGESTIONS = 200;     // Max 200 suggestions retained

const DEFAULT_APO_CONFIG: APOConfig = {
	enabled: true,
	autoAnalyzeEnabled: true,
	autoAnalyzeIntervalMs: 3600000,    // 1 hour
	minTracesForAnalysis: 20,
	minFeedbacksForAnalysis: 10,
	autoApplySuggestions: false,
	uploadOptimizationsToServer: true,
	// Beam Search defaults (ref: agent-lightning APO defaults)
	beamWidth: 4,                      // Retain top-4 candidate prompts
	branchFactor: 4,                   // 4 candidates per parent
	beamRounds: 3,                     // 3 rounds of beam search
	gradientBatchSize: 4,              // Sample 4 rollouts per gradient
};

class APOService extends Disposable implements IAPOService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onDidGenerateSuggestions = this._register(new Emitter<PromptOptimizationSuggestion[]>());
	readonly onDidGenerateSuggestions: Event<PromptOptimizationSuggestion[]> = this._onDidGenerateSuggestions.event;

	// In-memory data
	private _reports: PromptEffectivenessReport[] = [];
	private _suggestions: PromptOptimizationSuggestion[] = [];
	private _segments: PromptSegment[] = [];
	private _config: APOConfig = { ...DEFAULT_APO_CONFIG };
	private _dirty = false;

	// Beam Search state (ref: agent-lightning APO beam search)
	private _beamState: BeamSearchState | null = null;
	private _textualGradients: TextualGradient[] = [];

	// Timers
	private _autoAnalyzeTimer: ReturnType<typeof setInterval> | null = null;
	private _flushTimer: ReturnType<typeof setInterval> | null = null;

	// API URL
	private readonly _apoApiUrl: string;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IProductService private readonly _productService: IProductService,
		@IRequestService private readonly _requestService: IRequestService,
		@ITraceCollectorService private readonly _traceCollectorService: ITraceCollectorService,
	) {
		super();
		const apiBaseUrl = this._productService.senweaverApiConfig?.apiBaseUrl || 'https://ide-api.senweaver.com';
		this._apoApiUrl = `${apiBaseUrl}/api/apo`;
		this._loadFromStorage();
		this._startAutoFlush();
		this._startAutoAnalyze();
	}

	// --- Internal: Storage ---

	private _loadFromStorage(): void {
		try {
			// Load config
			const configJson = this._storageService.get(APO_CONFIG_KEY, StorageScope.APPLICATION);
			if (configJson) {
				this._config = { ...DEFAULT_APO_CONFIG, ...JSON.parse(configJson) };
			}

			// Load reports and suggestions
			const dataJson = this._storageService.get(APO_STORAGE_KEY, StorageScope.APPLICATION);
			if (dataJson) {
				const data = JSON.parse(dataJson);
				this._reports = data.reports || [];
				this._suggestions = data.suggestions || [];
			}

			// Load prompt segments
			const segmentsJson = this._storageService.get(APO_SEGMENTS_KEY, StorageScope.APPLICATION);
			if (segmentsJson) {
				this._segments = JSON.parse(segmentsJson);
			}

			// Load beam state and textual gradients
			const beamJson = this._storageService.get('senweaver.apo.beamState', StorageScope.APPLICATION);
			if (beamJson) {
				this._beamState = JSON.parse(beamJson);
			}
			const gradientsJson = this._storageService.get('senweaver.apo.gradients', StorageScope.APPLICATION);
			if (gradientsJson) {
				this._textualGradients = JSON.parse(gradientsJson);
			}
		} catch (e) {
			console.warn('[APO] Failed to load from storage:', e);
		}
	}

	private _saveToStorage(): void {
		if (!this._dirty) return;
		try {
			// Limit storage size
			if (this._reports.length > MAX_REPORTS) {
				this._reports = this._reports.slice(-MAX_REPORTS);
			}
			if (this._suggestions.length > MAX_SUGGESTIONS) {
				this._suggestions = this._suggestions.slice(-MAX_SUGGESTIONS);
			}

			this._storageService.store(
				APO_STORAGE_KEY,
				JSON.stringify({ reports: this._reports, suggestions: this._suggestions }),
				StorageScope.APPLICATION, StorageTarget.MACHINE
			);
			this._storageService.store(
				APO_SEGMENTS_KEY,
				JSON.stringify(this._segments),
				StorageScope.APPLICATION, StorageTarget.MACHINE
			);

			// Persist beam state and textual gradients
			if (this._beamState) {
				this._storageService.store(
					'senweaver.apo.beamState',
					JSON.stringify(this._beamState),
					StorageScope.APPLICATION, StorageTarget.MACHINE
				);
			}
			if (this._textualGradients.length > 0) {
				// Cap at 50 gradients
				if (this._textualGradients.length > 50) {
					this._textualGradients = this._textualGradients.slice(-50);
				}
				this._storageService.store(
					'senweaver.apo.gradients',
					JSON.stringify(this._textualGradients),
					StorageScope.APPLICATION, StorageTarget.MACHINE
				);
			}
			this._dirty = false;
		} catch (e) {
			console.warn('[APO] Failed to save to storage:', e);
		}
	}

	private _saveConfig(): void {
		try {
			this._storageService.store(
				APO_CONFIG_KEY,
				JSON.stringify(this._config),
				StorageScope.APPLICATION, StorageTarget.MACHINE
			);
		} catch { /* silent */ }
	}

	private _startAutoFlush(): void {
		this._flushTimer = setInterval(() => this._saveToStorage(), 60000); // 1 minute
		this._register({ dispose: () => { if (this._flushTimer) clearInterval(this._flushTimer); } });
	}

	private _startAutoAnalyze(): void {
		if (!this._config.autoAnalyzeEnabled || !this._config.enabled) return;

		this._autoAnalyzeTimer = setInterval(() => {
			queueMicrotask(() => {
				this._tryAutoAnalyze().catch(() => { /* silent */ });
			});
		}, this._config.autoAnalyzeIntervalMs);

		this._register({
			dispose: () => {
				if (this._autoAnalyzeTimer) {
					clearInterval(this._autoAnalyzeTimer);
					this._autoAnalyzeTimer = null;
				}
			}
		});
	}

	private async _tryAutoAnalyze(): Promise<void> {
		if (!this._config.enabled || !this._config.autoAnalyzeEnabled) return;

		const stats = this._traceCollectorService.getStats();
		if (stats.totalTraces < this._config.minTracesForAnalysis) return;
		if (stats.totalFeedbacks < this._config.minFeedbacksForAnalysis) return;

		// Check if enough time has passed since last analysis
		const lastReport = this._reports[this._reports.length - 1];
		if (lastReport && (Date.now() - lastReport.generatedAt) < this._config.autoAnalyzeIntervalMs) return;

		const report = await this.analyzePromptEffectiveness();

		// If goodRate is low enough and server upload is enabled, also trigger textual gradient
		if (report.goodRate < 0.7 && this._config.uploadOptimizationsToServer && stats.totalFeedbacks >= 15) {
			queueMicrotask(() => {
				this.requestTextualGradient().catch(() => { /* silent */ });
			});
		}
	}

	// --- Core: local analysis ---

	async analyzePromptEffectiveness(): Promise<PromptEffectivenessReport> {
		const traces = this._traceCollectorService.getAllTraces();
		const report = this._buildReport(traces);

		this._reports.push(report);
		this._dirty = true;

		// Async save
		queueMicrotask(() => this._saveToStorage());

		// If upload is configured, async upload report
		if (this._config.uploadOptimizationsToServer) {
			queueMicrotask(() => {
				this._uploadReport(report).catch(() => { /* silent */ });
			});
		}

		this._onDidChangeState.fire();
		return report;
	}

	private _buildReport(traces: ConversationTrace[]): PromptEffectivenessReport {
		const now = Date.now();
		let goodCount = 0;
		let badCount = 0;
		let noFeedbackCount = 0;
		const byMode: Record<string, { total: number; good: number; bad: number; goodRate: number }> = {};
		const badExamples: Array<{ threadId: string; userMsg: string; assistantMsg: string; feedback: UserFeedbackType }> = [];

		let oldestTime = Infinity;
		let newestTime = 0;

		for (const trace of traces) {
			if (trace.startTime < oldestTime) oldestTime = trace.startTime;
			if (trace.startTime > newestTime) newestTime = trace.startTime;

			const feedback = trace.summary.userFeedback;
			if (feedback === 'good') goodCount++;
			else if (feedback === 'bad') badCount++;
			else noFeedbackCount++;

			// Per-mode statistics (extract chatMode from span, if available)
			const modeKey = this._extractMode(trace);
			if (!byMode[modeKey]) {
				byMode[modeKey] = { total: 0, good: 0, bad: 0, goodRate: 0 };
			}
			byMode[modeKey].total++;
			if (feedback === 'good') byMode[modeKey].good++;
			if (feedback === 'bad') byMode[modeKey].bad++;

			// Collect bad examples
			if (feedback === 'bad') {
				const userSpan = trace.spans.find(s => s.type === 'user_message');
				const assistantSpan = trace.spans.find(s => s.type === 'assistant_message');
				badExamples.push({
					threadId: trace.threadId,
					userMsg: userSpan?.data.contentPreview || '',
					assistantMsg: assistantSpan?.data.contentPreview || '',
					feedback,
				});
			}
		}

		// Calculate goodRate
		for (const mode of Object.values(byMode)) {
			const total = mode.good + mode.bad;
			mode.goodRate = total > 0 ? mode.good / total : 0;
		}

		const totalWithFeedback = goodCount + badCount;
		const goodRate = totalWithFeedback > 0 ? goodCount / totalWithFeedback : 0;

		// Calculate multi-dimensional reward aggregate statistics (ref: agent-lightning find_final_reward)
		const tracesWithReward = traces.filter(t => t.summary.finalReward !== null);
		const avgReward = tracesWithReward.length > 0
			? tracesWithReward.reduce((sum, t) => sum + (t.summary.finalReward || 0), 0) / tracesWithReward.length
			: null;

		// Aggregate by reward dimension
		const rewardByDimension: Record<string, { sum: number; count: number; avg: number }> = {};
		for (const trace of tracesWithReward) {
			for (const dim of trace.summary.rewardDimensions) {
				if (!rewardByDimension[dim.name]) {
					rewardByDimension[dim.name] = { sum: 0, count: 0, avg: 0 };
				}
				rewardByDimension[dim.name].sum += dim.value;
				rewardByDimension[dim.name].count++;
			}
		}
		for (const dim of Object.values(rewardByDimension)) {
			dim.avg = dim.count > 0 ? dim.sum / dim.count : 0;
		}

		// Analyze problem patterns
		const patterns = this._analyzePatterns(badExamples, traces);

		// Add additional problem patterns based on reward dimension analysis
		for (const [dimName, dimStats] of Object.entries(rewardByDimension)) {
			if (dimStats.avg < -0.3 && dimStats.count >= 5) {
				const categoryMap: Record<string, PromptSegmentCategory> = {
					'tool_success_rate': 'tool_usage',
					'tool_call_reliability': 'tool_usage',
					'tool_call_efficiency': 'tool_usage',
					'tool_duration_efficiency': 'tool_usage',
					'token_efficiency': 'context_management',
					'response_efficiency': 'core_behavior',
					'conversation_efficiency': 'core_behavior',
					'task_completion': 'core_behavior',
					'user_feedback': 'core_behavior',
				};
				patterns.push({
					id: generateUuid(),
					description: `${dimName} dimension reward signal consistently low (avg: ${dimStats.avg.toFixed(3)})`,
					frequency: dimStats.count,
					severity: dimStats.avg < -0.5 ? 'high' : 'medium',
					relatedCategory: categoryMap[dimName] || 'core_behavior',
					examples: [],
				});
			}
		}

		// Generate local suggestions (enhanced: pass in reward data)
		const suggestions = this._generateLocalSuggestions(goodRate, patterns, byMode, avgReward, rewardByDimension);

		const report: PromptEffectivenessReport = {
			id: generateUuid(),
			generatedAt: now,
			period: { from: oldestTime === Infinity ? now : oldestTime, to: newestTime || now },
			totalConversations: traces.length,
			goodFeedbackCount: goodCount,
			badFeedbackCount: badCount,
			noFeedbackCount: noFeedbackCount,
			goodRate,
			byMode,
			patterns,
			suggestions,
		};

		// Add suggestions to global list
		for (const s of suggestions) {
			this._suggestions.push(s);
		}

		if (suggestions.length > 0) {
			this._onDidGenerateSuggestions.fire(suggestions);
		}

		return report;
	}

	private _extractMode(trace: ConversationTrace): string {
		// Extract chatMode from trace metadata
		if (trace.metadata?.chatMode) {
			return trace.metadata.chatMode as string;
		}
		return 'unknown';
	}

	private _analyzePatterns(
		badExamples: Array<{ threadId: string; userMsg: string; assistantMsg: string; feedback: UserFeedbackType }>,
		traces: ConversationTrace[]
	): PromptIssuePattern[] {
		const patterns: PromptIssuePattern[] = [];

		if (badExamples.length === 0) return patterns;

		// Pattern 1: conversations with high error rate (has error span)
		const errorTraces = traces.filter(t => t.summary.hasErrors && t.summary.userFeedback === 'bad');
		if (errorTraces.length >= 2) {
			patterns.push({
				id: generateUuid(),
				description: 'Users give negative feedback after errors occur in conversations',
				frequency: errorTraces.length,
				severity: errorTraces.length >= 5 ? 'high' : 'medium',
				relatedCategory: 'core_behavior',
				examples: errorTraces.slice(0, 3).map(t => {
					const userSpan = t.spans.find(s => s.type === 'user_message');
					const assistantSpan = t.spans.find(s => s.type === 'assistant_message');
					return {
						threadId: t.threadId,
						userMessagePreview: userSpan?.data.contentPreview || '',
						assistantMessagePreview: assistantSpan?.data.contentPreview || '',
						feedback: t.summary.userFeedback,
					};
				}),
			});
		}

		// Pattern 2: high tool call failure rate
		const toolFailTraces = traces.filter(t => {
			const toolSpans = t.spans.filter(s => s.type === 'tool_call');
			const failedTools = toolSpans.filter(s => s.data.toolSuccess === false);
			return failedTools.length > 0 && t.summary.userFeedback === 'bad';
		});
		if (toolFailTraces.length >= 2) {
			patterns.push({
				id: generateUuid(),
				description: 'Tool call failures lead to user dissatisfaction',
				frequency: toolFailTraces.length,
				severity: toolFailTraces.length >= 5 ? 'high' : 'medium',
				relatedCategory: 'tool_usage',
				examples: toolFailTraces.slice(0, 3).map(t => {
					const userSpan = t.spans.find(s => s.type === 'user_message');
					const failedTool = t.spans.find(s => s.type === 'tool_call' && s.data.toolSuccess === false);
					return {
						threadId: t.threadId,
						userMessagePreview: userSpan?.data.contentPreview || '',
						assistantMessagePreview: `Tool ${failedTool?.data.toolName} failed: ${failedTool?.data.toolResult?.substring(0, 100) || ''}`,
						feedback: t.summary.userFeedback,
					};
				}),
			});
		}

		// Pattern 3: high LLM call token consumption (possibly prompt too long)
		const highTokenTraces = traces.filter(t => {
			return t.summary.totalTokens > 10000 && t.summary.userFeedback === 'bad';
		});
		if (highTokenTraces.length >= 3) {
			patterns.push({
				id: generateUuid(),
				description: 'User feedback is poor in conversations with high token consumption',
				frequency: highTokenTraces.length,
				severity: 'medium',
				relatedCategory: 'context_management',
				examples: highTokenTraces.slice(0, 3).map(t => ({
					threadId: t.threadId,
					userMessagePreview: t.spans.find(s => s.type === 'user_message')?.data.contentPreview || '',
					assistantMessagePreview: `Total tokens: ${t.summary.totalTokens}`,
					feedback: t.summary.userFeedback,
				})),
			});
		}

		// Pattern 4: still bad after multiple LLM calls (retries)
		const multiCallBadTraces = traces.filter(t => {
			return t.summary.totalLLMCalls > 2 && t.summary.userFeedback === 'bad';
		});
		if (multiCallBadTraces.length >= 2) {
			patterns.push({
				id: generateUuid(),
				description: 'Users still dissatisfied after multiple LLM calls (possible retries)',
				frequency: multiCallBadTraces.length,
				severity: 'high',
				relatedCategory: 'core_behavior',
				examples: multiCallBadTraces.slice(0, 3).map(t => ({
					threadId: t.threadId,
					userMessagePreview: t.spans.find(s => s.type === 'user_message')?.data.contentPreview || '',
					assistantMessagePreview: `LLM calls: ${t.summary.totalLLMCalls}`,
					feedback: t.summary.userFeedback,
				})),
			});
		}

		// Pattern 5: Long conversations with many back-and-forth turns (poor first-attempt resolution)
		const longConversationTraces = traces.filter(t => {
			const userMsgs = t.spans.filter(sp => sp.type === 'user_message').length;
			return userMsgs >= 4 && t.summary.userFeedback === 'bad';
		});
		if (longConversationTraces.length >= 2) {
			patterns.push({
				id: generateUuid(),
				description: 'Long conversations with many turns still result in user dissatisfaction',
				frequency: longConversationTraces.length,
				severity: longConversationTraces.length >= 4 ? 'high' : 'medium',
				relatedCategory: 'core_behavior',
				examples: longConversationTraces.slice(0, 3).map(t => ({
					threadId: t.threadId,
					userMessagePreview: t.spans.find(s => s.type === 'user_message')?.data.contentPreview || '',
					assistantMessagePreview: `Conversation turns: ${t.spans.filter(sp => sp.type === 'user_message').length}`,
					feedback: t.summary.userFeedback,
				})),
			});
		}

		// Pattern 6: Slow tool calls causing poor experience
		const slowToolTraces = traces.filter(t => {
			return t.summary.totalToolDurationMs > 15000 && t.summary.userFeedback === 'bad';
		});
		if (slowToolTraces.length >= 2) {
			patterns.push({
				id: generateUuid(),
				description: 'Slow tool execution (>15s total) correlates with user dissatisfaction',
				frequency: slowToolTraces.length,
				severity: 'medium',
				relatedCategory: 'tool_usage',
				examples: slowToolTraces.slice(0, 3).map(t => ({
					threadId: t.threadId,
					userMessagePreview: t.spans.find(s => s.type === 'user_message')?.data.contentPreview || '',
					assistantMessagePreview: `Tool duration: ${(t.summary.totalToolDurationMs / 1000).toFixed(1)}s`,
					feedback: t.summary.userFeedback,
				})),
			});
		}

		return patterns;
	}

	private _generateLocalSuggestions(
		goodRate: number,
		patterns: PromptIssuePattern[],
		_byMode: Record<string, { total: number; good: number; bad: number; goodRate: number }>,
		avgReward?: number | null,
		rewardByDimension?: Record<string, { sum: number; count: number; avg: number }>
	): PromptOptimizationSuggestion[] {
		const suggestions: PromptOptimizationSuggestion[] = [];

		// Generate overall suggestions based on goodRate
		if (goodRate < 0.5 && goodRate > 0) {
			const rewardInfo = avgReward !== null && avgReward !== undefined ? ` (avg reward: ${avgReward.toFixed(3)})` : '';
			suggestions.push({
				id: generateUuid(),
				targetCategory: 'core_behavior',
				type: 'modify',
				priority: 'high',
				description: `Overall approval rate is only ${(goodRate * 100).toFixed(1)}%${rewardInfo}, comprehensive prompt optimization needed`,
				reasoning: `Approval rate below 50% indicates systemic issues with current prompt, recommend requesting backend APO service for deep optimization`,
				estimatedImpact: 'Expected to improve approval rate by 10-20%',
				status: 'pending',
			});
		}

		// Generate targeted suggestions based on reward dimensions (ref: agent-lightning multi-dimensional reward analysis)
		if (rewardByDimension) {
			for (const [dimName, dimStats] of Object.entries(rewardByDimension)) {
				if (dimStats.avg < 0 && dimStats.count >= 3) {
					const categoryMap: Record<string, PromptSegmentCategory> = {
						'tool_success_rate': 'tool_usage',
						'tool_call_reliability': 'tool_usage',
						'tool_call_efficiency': 'tool_usage',
						'tool_duration_efficiency': 'tool_usage',
						'token_efficiency': 'context_management',
						'response_efficiency': 'core_behavior',
						'conversation_efficiency': 'core_behavior',
						'task_completion': 'core_behavior',
						'user_feedback': 'core_behavior',
					};
					const targetCategory = categoryMap[dimName] || 'core_behavior';
					suggestions.push({
						id: generateUuid(),
						targetCategory,
						type: 'modify',
						priority: dimStats.avg < -0.5 ? 'high' : 'medium',
						description: `${dimName} dimension performing poorly (avg: ${dimStats.avg.toFixed(3)}, n=${dimStats.count})`,
						reasoning: `This reward dimension is consistently negative, indicating prompt guidance needs improvement for ${dimName}`,
						estimatedImpact: `Expected to improve ${dimName} dimension reward by 0.2-0.5`,
						status: 'pending',
					});
				}
			}
		}

		// Generate targeted suggestions based on problem patterns
		for (const pattern of patterns) {
			if (pattern.severity === 'high') {
				suggestions.push({
					id: generateUuid(),
					targetCategory: pattern.relatedCategory,
					type: 'modify',
					priority: 'high',
					description: `High-frequency issue: ${pattern.description} (occurred ${pattern.frequency} times)`,
					reasoning: `This problem pattern occurs frequently with high severity, targeted optimization of related prompt rules needed`,
					estimatedImpact: `Expected to reduce ${Math.min(pattern.frequency, 5)} similar issues`,
					status: 'pending',
				});
			}
		}

		// Generate suggestions based on mode differences
		for (const [mode, stats] of Object.entries(_byMode)) {
			if (stats.total >= 5 && stats.goodRate < 0.3) {
				suggestions.push({
					id: generateUuid(),
					targetCategory: 'mode_specific',
					type: 'modify',
					priority: 'medium',
					description: `${mode} mode approval rate is only ${(stats.goodRate * 100).toFixed(1)}%, prompt optimization needed for this mode`,
					reasoning: `This mode's approval rate is significantly below average, mode-specific prompt rules may need adjustment`,
					estimatedImpact: `Expected to improve ${mode} mode approval rate`,
					status: 'pending',
				});
			}
		}

		return suggestions;
	}

	// --- Core: Trace → RolloutResult conversion (ref: agent-lightning get_rollout_results) ---

	private _convertTracesToRolloutResults(traces: ConversationTrace[]): RolloutResultForAPO[] {
		return traces.map(trace => {
			const messages: RolloutResultForAPO['messages'] = [];
			for (const span of trace.spans) {
				if (span.type === 'user_message') {
					messages.push({ role: 'user', content: span.data.contentPreview || '' });
				} else if (span.type === 'assistant_message') {
					messages.push({ role: 'assistant', content: span.data.contentPreview || '' });
				} else if (span.type === 'tool_call') {
					messages.push({
						role: 'tool',
						content: span.data.toolResult || '',
						toolName: span.data.toolName,
						toolSuccess: span.data.toolSuccess,
					});
				}
			}

			const status: RolloutResultForAPO['status'] =
				trace.summary.userFeedback === 'good' ? 'succeeded'
					: trace.summary.userFeedback === 'bad' ? 'failed'
						: trace.summary.hasErrors ? 'failed' : 'unknown';

			const sm = trace.summary;
			const totalToolCalls = sm.toolCallsSucceeded + sm.toolCallsFailed;

			return {
				traceId: trace.id,
				threadId: trace.threadId,
				status,
				finalReward: sm.finalReward,
				rewardDimensions: sm.rewardDimensions || [],
				messages,
				chatMode: this._extractMode(trace),
				toolCallStats: {
					totalCalls: totalToolCalls,
					succeeded: sm.toolCallsSucceeded,
					failed: sm.toolCallsFailed,
					successRate: totalToolCalls > 0 ? sm.toolCallsSucceeded / totalToolCalls : null,
					byToolName: sm.toolCallsByName,
					totalDurationMs: sm.totalToolDurationMs,
				},
				llmStats: {
					totalCalls: sm.totalLLMCalls,
					totalTokens: sm.totalTokens,
				},
			};
		});
	}

	// --- Core: Textual Gradient Prompt template (ref: agent-lightning text_gradient_variant) ---

	private _buildTextualGradientPrompt(
		currentPromptRules: string[],
		rolloutResults: RolloutResultForAPO[]
	): string {
		const promptSection = currentPromptRules.length > 0
			? currentPromptRules.join('\n')
			: '(No optimized prompt rules currently active)';

		const experimentsSection = rolloutResults.map((r, i) => {
			const statusText = r.status === 'succeeded' ? '✅ Succeeded' : r.status === 'failed' ? '❌ Failed' : '❓ Unknown';
			const rewardText = r.finalReward !== null ? r.finalReward.toFixed(3) : 'N/A';
			const msgSummary = r.messages.map(m => `[${m.role}] ${m.content.substring(0, 200)}`).join('\n    ');
			// Actual tool call statistics
			const tc = r.toolCallStats;
			const toolInfo = tc.totalCalls > 0
				? `Tool Calls: ${tc.totalCalls} (${tc.succeeded} succeeded, ${tc.failed} failed, rate: ${tc.successRate !== null ? (tc.successRate * 100).toFixed(0) + '%' : 'N/A'}, duration: ${tc.totalDurationMs.toFixed(0)}ms)`
				: 'Tool Calls: none';
			// Actual reward dimension details
			const rewardDims = r.rewardDimensions.length > 0
				? 'Reward Dims: ' + r.rewardDimensions.map(d => `${d.name}=${d.value.toFixed(2)}`).join(', ')
				: '';
			const llmInfo = `LLM Calls: ${r.llmStats.totalCalls}, Tokens: ${r.llmStats.totalTokens}`;
			return `--- Experiment ${i + 1} ---\nStatus: ${statusText}\nFinal Reward: ${rewardText}\nChat Mode: ${r.chatMode}\n${toolInfo}\n${llmInfo}\n${rewardDims}\nMessages:\n    ${msgSummary}`;
		}).join('\n\n');

		return `You are an expert prompt engineer optimizing a coding IDE assistant's system prompt.

## Current Prompt Rules
${promptSection}

## Sample Runs with Current Prompt
${experimentsSection}

## Your Task
Produce a brief critique listing specific causes for failures or ways to raise reward next time.
Return a bullet list with concrete, testable changes (format, constraints, ordering, definitions).
Focus on:
1. Structural issues: missing goals, contradictions, no stop conditions
2. Instruction quality: vague verbs, lack of hierarchy, overlapping scope
3. Control and behavior: tool limits, uncertainty handling, verbosity
4. Input/output specification: missing defaults, format inconsistency
5. Scope and safety: scope creep, unsafe actions, error handling

Be concise and direct. Less than 350 words.`;
	}

	// --- Core: Apply Edit Prompt template (ref: agent-lightning apply_edit_variant) ---

	private _buildApplyEditPrompt(currentPromptRules: string[], critique: string): string {
		const promptSection = currentPromptRules.length > 0
			? currentPromptRules.join('\n')
			: '(No optimized prompt rules currently active)';

		return `Revise the given prompt rules using the critique as constraints and improvement guide.

## Revision Rules
1. Rewrite or restructure the prompt if critique implies it.
2. Explicitly include any requested output format, structure, or word limit.
3. Prioritize mechanism-first phrasing: define what to do, then how to do it.
4. Keep the new prompt close in tone, length, and structure to the original.
5. Focus on the single most critical issue from the critique.

## Current Prompt Rules
${promptSection}

## Critique
${critique}

Return only the improved prompt rules. Do not include explanations or headers.
Each rule should be on its own line, starting with "- ".`;
	}

	// --- Core: backend optimization request (enhanced, passing complete rollout data + reward signals) ---

	async requestOptimizationFromServer(): Promise<PromptOptimizationSuggestion[]> {
		try {
			const latestReport = this._reports[this._reports.length - 1];
			if (!latestReport) {
				await this.analyzePromptEffectiveness();
			}

			const report = this._reports[this._reports.length - 1];
			if (!report) return [];

			// Get recent traces and convert to RolloutResult format (ref: agent-lightning)
			const allTraces = this._traceCollectorService.getAllTraces();
			const recentTraces = allTraces
				.filter(t => t.summary.userFeedback !== null)
				.sort((a, b) => b.startTime - a.startTime)
				.slice(0, this._config.gradientBatchSize * 4);
			const rolloutResults = this._convertTracesToRolloutResults(recentTraces);

			// Prepare data to send to backend (enhanced: includes complete rollout data)
			const payload = {
				version: '2.0.0',
				report: {
					id: report.id,
					generatedAt: report.generatedAt,
					totalConversations: report.totalConversations,
					goodRate: report.goodRate,
					goodFeedbackCount: report.goodFeedbackCount,
					badFeedbackCount: report.badFeedbackCount,
					byMode: report.byMode,
					patterns: report.patterns,
				},
				// Complete rollout results (ref: agent-lightning RolloutResultForAPO)
				rolloutResults: rolloutResults.slice(0, 20),
				currentSegments: this._segments.filter(s => s.isActive).map(s => ({
					id: s.id,
					category: s.category,
					content: s.content.substring(0, 1000),
					isOptimized: s.isOptimized,
					version: s.version,
				})),
				// Textual Gradient prompt (for backend to use directly or as reference)
				textualGradientPrompt: this._buildTextualGradientPrompt(
					this.getOptimizedRules(),
					rolloutResults.slice(0, this._config.gradientBatchSize)
				),
				// Beam Search config
				beamConfig: {
					beamWidth: this._config.beamWidth,
					branchFactor: this._config.branchFactor,
					beamRounds: this._config.beamRounds,
				},
				// Current beam state (if any)
				beamState: this._beamState ? {
					currentRound: this._beamState.currentRound,
					historyBestScore: this._beamState.historyBestScore,
					beamSize: this._beamState.beam.length,
				} : null,
				badExamples: report.patterns.flatMap(p => p.examples).slice(0, 10),
				// Actual aggregated reward statistics (for backend RL training)
				rewardSummary: (() => {
					const withReward = rolloutResults.filter(r => r.finalReward !== null);
					const avgReward = withReward.length > 0
						? withReward.reduce((sum, r) => sum + (r.finalReward || 0), 0) / withReward.length
						: null;
					// Aggregate average per reward dimension
					const dimAgg: Record<string, { sum: number; count: number }> = {};
					for (const r of withReward) {
						for (const d of r.rewardDimensions) {
							if (!dimAgg[d.name]) dimAgg[d.name] = { sum: 0, count: 0 };
							dimAgg[d.name].sum += d.value;
							dimAgg[d.name].count++;
						}
					}
					const dimAvg: Record<string, number> = {};
					for (const [name, agg] of Object.entries(dimAgg)) {
						dimAvg[name] = agg.count > 0 ? agg.sum / agg.count : 0;
					}
					return {
						totalWithReward: withReward.length,
						avgFinalReward: avgReward,
						rewardDimensionAvg: dimAvg,
					};
				})(),
				// Actual aggregated tool call statistics (for backend analysis of model tool calling capability)
				toolCallSummary: (() => {
					let totalSucceeded = 0, totalFailed = 0, totalDuration = 0;
					const byName: Record<string, { total: number; succeeded: number; failed: number }> = {};
					for (const r of rolloutResults) {
						totalSucceeded += r.toolCallStats.succeeded;
						totalFailed += r.toolCallStats.failed;
						totalDuration += r.toolCallStats.totalDurationMs;
						for (const [name, stats] of Object.entries(r.toolCallStats.byToolName)) {
							if (!byName[name]) byName[name] = { total: 0, succeeded: 0, failed: 0 };
							byName[name].total += stats.total;
							byName[name].succeeded += stats.succeeded;
							byName[name].failed += stats.failed;
						}
					}
					const total = totalSucceeded + totalFailed;
					return {
						totalCalls: total,
						totalSucceeded,
						totalFailed,
						successRate: total > 0 ? totalSucceeded / total : null,
						totalDurationMs: totalDuration,
						byToolName: byName,
					};
				})(),
			};

			const response = await this._requestService.request({
				type: 'POST',
				url: `${this._apoApiUrl}/optimize`,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(payload),
			}, CancellationToken.None);

			if (response.res.statusCode && response.res.statusCode >= 400) {
				console.warn('[APO] Server optimization request failed:', response.res.statusCode);
				return [];
			}

			// Parse backend response (enhanced: supports beam search results)
			const serverResponse = await asJson<{
				suggestions?: PromptOptimizationSuggestion[];
				beamUpdate?: {
					beam?: VersionedPromptTemplate[];
					bestPrompt?: VersionedPromptTemplate;
					bestScore?: number;
					round?: number;
				};
				textualGradient?: {
					critique?: string;
					editedPrompt?: string;
				};
			}>(response);

			const serverSuggestions = serverResponse?.suggestions || [];

			// Merge suggestions to local
			for (const s of serverSuggestions) {
				s.id = s.id || generateUuid();
				s.status = 'pending';
				this._suggestions.push(s);
			}

			// Update Beam Search state (ref: agent-lightning APO._update_best_prompt)
			if (serverResponse?.beamUpdate) {
				const bu = serverResponse.beamUpdate;
				if (!this._beamState) {
					this._beamState = {
						currentRound: 0,
						totalRounds: this._config.beamRounds,
						beam: [],
						historyBestPrompt: null,
						historyBestScore: -Infinity,
						versionCounter: 0,
						startedAt: Date.now(),
						lastUpdatedAt: Date.now(),
					};
				}
				if (bu.beam) {
					this._beamState.beam = bu.beam;
				}
				if (bu.round !== undefined) {
					this._beamState.currentRound = bu.round;
				}
				if (bu.bestPrompt && bu.bestScore !== undefined && bu.bestScore > this._beamState.historyBestScore) {
					this._beamState.historyBestPrompt = bu.bestPrompt;
					this._beamState.historyBestScore = bu.bestScore;
					// Auto-apply best prompt as optimized rules
					this._applyBeamBestPrompt(bu.bestPrompt);
				}
				this._beamState.lastUpdatedAt = Date.now();
			}

			// Save Textual Gradient (ref: agent-lightning compute_textual_gradient)
			if (serverResponse?.textualGradient?.critique) {
				const tg: TextualGradient = {
					id: generateUuid(),
					promptVersion: this._beamState?.historyBestPrompt?.version || 'v0',
					critique: serverResponse.textualGradient.critique,
					rolloutSummary: `Based on ${rolloutResults.length} rollouts`,
					createdAt: Date.now(),
				};
				this._textualGradients.push(tg);
				// Limit storage size
				if (this._textualGradients.length > 50) {
					this._textualGradients = this._textualGradients.slice(-50);
				}

				// If backend returned edited prompt, generate corresponding suggestion
				if (serverResponse.textualGradient.editedPrompt) {
					const editSuggestion: PromptOptimizationSuggestion = {
						id: generateUuid(),
						targetCategory: 'core_behavior',
						type: 'modify',
						priority: 'high',
						description: `Textual Gradient optimization: ${tg.critique.substring(0, 100)}...`,
						suggestedContent: serverResponse.textualGradient.editedPrompt,
						reasoning: tg.critique,
						estimatedImpact: 'Prompt optimization based on Textual Gradient',
						status: 'pending',
						promptVersion: tg.promptVersion,
					};
					serverSuggestions.push(editSuggestion);
					this._suggestions.push(editSuggestion);
				}
			}

			this._dirty = true;
			queueMicrotask(() => this._saveToStorage());

			if (serverSuggestions.length > 0) {
				this._onDidGenerateSuggestions.fire(serverSuggestions);
			}

			this._onDidChangeState.fire();
			return serverSuggestions;
		} catch (e) {
			console.warn('[APO] Server optimization request failed:', e instanceof Error ? e.message : String(e));
			return [];
		}
	}

	// --- Core: Beam Search best prompt application (ref: agent-lightning _update_best_prompt) ---

	private _applyBeamBestPrompt(bestPrompt: VersionedPromptTemplate): void {
		// Auto-apply the best prompt found by beam search as optimized rules
		const rules = bestPrompt.content.split('\n').filter(line => line.trim().startsWith('- '));
		if (rules.length === 0) {
			// If not in rule format, apply as a whole
			const existingSegment = this._segments.find(s => s.category === 'core_behavior' && s.isActive);
			if (existingSegment) {
				existingSegment.originalContent = existingSegment.originalContent || existingSegment.content;
				existingSegment.content = bestPrompt.content;
				existingSegment.isOptimized = true;
				existingSegment.version++;
				existingSegment.updatedAt = Date.now();
			} else {
				this._segments.push({
					id: generateUuid(),
					category: 'core_behavior',
					content: bestPrompt.content,
					isActive: true,
					isOptimized: true,
					version: 1,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			}
		} else {
			// Each rule as an independent segment
			for (const rule of rules) {
				const ruleContent = rule.replace(/^-\s*/, '').trim();
				if (!ruleContent) continue;
				// Check if a similar rule already exists
				const existing = this._segments.find(s => s.isActive && s.content === ruleContent);
				if (!existing) {
					this._segments.push({
						id: generateUuid(),
						category: 'core_behavior',
						content: ruleContent,
						isActive: true,
						isOptimized: true,
						version: 1,
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
				}
			}
		}
	}

	// --- Core: Request Textual Gradient (ref: agent-lightning textual_gradient_and_apply_edit) ---

	async requestTextualGradient(): Promise<TextualGradient | null> {
		try {
			const allTraces = this._traceCollectorService.getAllTraces();
			const recentTraces = allTraces
				.filter(t => t.summary.userFeedback !== null)
				.sort((a, b) => b.startTime - a.startTime)
				.slice(0, this._config.gradientBatchSize);

			if (recentTraces.length < 2) return null;

			const rolloutResults = this._convertTracesToRolloutResults(recentTraces);
			const currentRules = this.getOptimizedRules();

			const payload = {
				version: '2.0.0',
				action: 'textual_gradient',
				textualGradientPrompt: this._buildTextualGradientPrompt(currentRules, rolloutResults),
				applyEditPrompt: this._buildApplyEditPrompt(currentRules, '{{critique_placeholder}}'),
				rolloutResults: rolloutResults,
				currentRules: currentRules,
			};

			const response = await this._requestService.request({
				type: 'POST',
				url: `${this._apoApiUrl}/gradient`,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(payload),
			}, CancellationToken.None);

			if (response.res.statusCode && response.res.statusCode >= 400) {
				return null;
			}

			const result = await asJson<{
				critique?: string;
				editedPrompt?: string;
			}>(response);

			if (!result?.critique) return null;

			const tg: TextualGradient = {
				id: generateUuid(),
				promptVersion: this._beamState?.historyBestPrompt?.version || 'v0',
				critique: result.critique,
				rolloutSummary: `Based on ${rolloutResults.length} rollouts, avg reward: ${(rolloutResults.reduce((sum, r) => sum + (r.finalReward || 0), 0) / rolloutResults.length).toFixed(3)}`,
				createdAt: Date.now(),
			};
			this._textualGradients.push(tg);

			// If backend returned edited prompt, auto-generate suggestion
			if (result.editedPrompt) {
				const suggestion: PromptOptimizationSuggestion = {
					id: generateUuid(),
					targetCategory: 'core_behavior',
					type: 'modify',
					priority: 'high',
					description: `Textual Gradient: ${tg.critique.substring(0, 100)}...`,
					suggestedContent: result.editedPrompt,
					reasoning: tg.critique,
					estimatedImpact: 'Prompt optimization based on Textual Gradient',
					status: 'pending',
					promptVersion: tg.promptVersion,
				};
				this._suggestions.push(suggestion);
				this._onDidGenerateSuggestions.fire([suggestion]);
			}

			this._dirty = true;
			queueMicrotask(() => this._saveToStorage());
			this._onDidChangeState.fire();
			return tg;
		} catch (e) {
			console.warn('[APO] Textual gradient request failed:', e instanceof Error ? e.message : String(e));
			return null;
		}
	}

	private async _uploadReport(report: PromptEffectivenessReport): Promise<void> {
		try {
			await this._requestService.request({
				type: 'POST',
				url: `${this._apoApiUrl}/report`,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify({ version: '1.0.0', report }),
			}, CancellationToken.None);
		} catch {
			// Silent failure
		}
	}

	// --- Prompt segment management ---

	getActiveSegments(): PromptSegment[] {
		return this._segments.filter(s => s.isActive);
	}

	getOptimizedPromptForCategory(category: PromptSegmentCategory): string | null {
		const segment = this._segments.find(s => s.isActive && s.isOptimized && s.category === category);
		return segment?.content || null;
	}

	getOptimizedRules(): string[] {
		return this._segments
			.filter(s => s.isActive && s.isOptimized)
			.map(s => s.content);
	}

	applySuggestion(suggestionId: string): void {
		const suggestion = this._suggestions.find(s => s.id === suggestionId);
		if (!suggestion || suggestion.status !== 'pending') return;

		suggestion.status = 'applied';
		suggestion.appliedAt = Date.now();

		// If suggestion contains specific prompt content, create or update corresponding segment
		if (suggestion.suggestedContent) {
			const existingSegment = suggestion.targetSegmentId
				? this._segments.find(s => s.id === suggestion.targetSegmentId)
				: this._segments.find(s => s.category === suggestion.targetCategory && s.isActive);

			if (existingSegment && suggestion.type === 'modify') {
				existingSegment.originalContent = existingSegment.originalContent || existingSegment.content;
				existingSegment.content = suggestion.suggestedContent;
				existingSegment.isOptimized = true;
				existingSegment.version++;
				existingSegment.updatedAt = Date.now();
			} else if (suggestion.type === 'add') {
				this._segments.push({
					id: generateUuid(),
					category: suggestion.targetCategory,
					content: suggestion.suggestedContent,
					isActive: true,
					isOptimized: true,
					version: 1,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			}
		}

		this._dirty = true;
		queueMicrotask(() => this._saveToStorage());
		this._onDidChangeState.fire();
	}

	rejectSuggestion(suggestionId: string): void {
		const suggestion = this._suggestions.find(s => s.id === suggestionId);
		if (!suggestion || suggestion.status !== 'pending') return;

		suggestion.status = 'rejected';
		this._dirty = true;
		queueMicrotask(() => this._saveToStorage());
		this._onDidChangeState.fire();
	}

	revertSuggestion(suggestionId: string): void {
		const suggestion = this._suggestions.find(s => s.id === suggestionId);
		if (!suggestion || suggestion.status !== 'applied') return;

		// Rollback corresponding segment
		if (suggestion.targetSegmentId) {
			const segment = this._segments.find(s => s.id === suggestion.targetSegmentId);
			if (segment && segment.originalContent) {
				segment.content = segment.originalContent;
				segment.originalContent = undefined;
				segment.isOptimized = false;
				segment.version++;
				segment.updatedAt = Date.now();
			}
		} else if (suggestion.type === 'modify') {
			// Revert modified segment found by category (when no targetSegmentId)
			const segment = this._segments.find(s => s.category === suggestion.targetCategory && s.isActive && s.isOptimized);
			if (segment && segment.originalContent) {
				segment.content = segment.originalContent;
				segment.originalContent = undefined;
				segment.isOptimized = false;
				segment.version++;
				segment.updatedAt = Date.now();
			}
		} else if (suggestion.type === 'add') {
			// Remove the added segment
			this._segments = this._segments.filter(s =>
				!(s.category === suggestion.targetCategory && s.isOptimized && s.content === suggestion.suggestedContent)
			);
		}

		suggestion.status = 'reverted';
		this._dirty = true;
		queueMicrotask(() => this._saveToStorage());
		this._onDidChangeState.fire();
	}

	// --- Query ---

	getLatestReport(): PromptEffectivenessReport | null {
		return this._reports[this._reports.length - 1] || null;
	}

	getPendingSuggestions(): PromptOptimizationSuggestion[] {
		return this._suggestions.filter(s => s.status === 'pending');
	}

	getStats(): APOStats {
		const applied = this._suggestions.filter(s => s.status === 'applied').length;
		const rejected = this._suggestions.filter(s => s.status === 'rejected').length;
		const activeSegments = this._segments.filter(s => s.isActive).length;
		const optimizedSegments = this._segments.filter(s => s.isActive && s.isOptimized).length;
		const latestReport = this._reports[this._reports.length - 1];

		// Calculate average finalReward of recent traces
		let avgFinalReward: number | null = null;
		try {
			const recentTraces = this._traceCollectorService.getAllTraces()
				.filter(t => t.summary.finalReward !== null)
				.sort((a, b) => b.startTime - a.startTime)
				.slice(0, 20);
			if (recentTraces.length > 0) {
				const sum = recentTraces.reduce((acc, t) => acc + (t.summary.finalReward || 0), 0);
				avgFinalReward = sum / recentTraces.length;
			}
		} catch {
			// Silent
		}

		return {
			totalReports: this._reports.length,
			totalSuggestions: this._suggestions.length,
			appliedSuggestions: applied,
			rejectedSuggestions: rejected,
			activeSegments,
			optimizedSegments,
			lastAnalysisTime: latestReport?.generatedAt || null,
			currentGoodRate: latestReport?.goodRate ?? null,
			// Beam Search statistics
			beamSearchActive: this._beamState !== null,
			beamCurrentRound: this._beamState?.currentRound ?? null,
			beamBestScore: this._beamState?.historyBestScore !== -Infinity ? (this._beamState?.historyBestScore ?? null) : null,
			totalTextualGradients: this._textualGradients.length,
			avgFinalReward,
		};
	}

	getConfig(): APOConfig {
		return { ...this._config };
	}

	setConfig(config: Partial<APOConfig>): void {
		this._config = { ...this._config, ...config };
		this._saveConfig();

		// Restart auto-analyze timer
		if (this._autoAnalyzeTimer) {
			clearInterval(this._autoAnalyzeTimer);
			this._autoAnalyzeTimer = null;
		}
		this._startAutoAnalyze();

		this._onDidChangeState.fire();
	}

	// --- Beam Search query (ref: agent-lightning APO) ---

	getBeamState(): BeamSearchState | null {
		return this._beamState;
	}

	getTextualGradients(limit?: number): TextualGradient[] {
		const gradients = [...this._textualGradients].sort((a, b) => b.createdAt - a.createdAt);
		return limit ? gradients.slice(0, limit) : gradients;
	}

	override dispose(): void {
		this._saveToStorage();
		super.dispose();
	}
}

registerSingleton(IAPOService, APOService, InstantiationType.Delayed);
