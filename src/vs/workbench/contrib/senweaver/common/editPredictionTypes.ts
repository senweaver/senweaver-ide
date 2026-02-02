/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * Edit Prediction 多位置编辑系统
 *
 * 借鉴 Zed IDE 的 Edit Prediction 设计：
 * - 不仅预测光标位置的补全
 * - 还能预测文件中其他相关位置的编辑
 * - 支持多文件联动编辑预测
 */

// ============================================================================
// 核心类型定义
// ============================================================================

/**
 * 编辑位置
 */
export interface EditLocation {
	uri: URI;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

/**
 * 编辑预测类型
 */
export type EditPredictionType =
	| 'completion'          // 代码补全
	| 'error_fix'           // 错误修复
	| 'warning_fix'         // 警告修复
	| 'security_fix'        // 安全漏洞修复
	| 'optimization'         // 性能优化
	| 'best_practice'        // 最佳实践
	| 'refactor'            // 重构建议
	| 'related';            // 相关编辑

/**
 * 单个编辑预测
 */
export interface EditPredictionItem {
	id: string;
	location: EditLocation;
	oldText: string;
	newText: string;
	confidence: number; // 0-1, 预测置信度
	reason?: string; // 预测原因说明
	type?: EditPredictionType; // 预测类型
	diagnosticId?: string; // 关联的诊断ID（用于错误修复）
}

/**
 * 编辑预测结果
 */
export interface EditPredictionResult {
	id: string;
	timestamp: number;
	cursorPosition: {
		uri: URI;
		line: number;
		column: number;
	};
	predictions: EditPredictionItem[];
	relatedEdits: EditPredictionItem[]; // 相关位置的编辑
	totalConfidence: number;
}

/**
 * 编辑预测触发类型
 */
export type EditPredictionTrigger =
	| 'cursor_idle'      // 光标静止
	| 'text_change'      // 文本变化
	| 'file_change'      // 文件内容变化（5秒抖动）
	| 'file_open'        // 文件打开时触发
	| 'follow_up'        // 后续检查触发
	| 'manual'           // 手动触发
	| 'auto_refresh';    // 自动刷新

/**
 * 编辑预测请求
 */
export interface EditPredictionRequest {
	uri: URI;
	position: { line: number; column: number };
	trigger: EditPredictionTrigger;
	context: {
		prefix: string;
		suffix: string;
		currentLine: string;
		surroundingLines: string[];
		recentEdits?: RecentEdit[];
		diagnostics?: DiagnosticInfo[];
	};
}

/**
 * 最近编辑记录
 */
export interface RecentEdit {
	timestamp: number;
	uri: URI;
	location: EditLocation;
	oldText: string;
	newText: string;
}

/**
 * 诊断信息
 */
export interface DiagnosticInfo {
	id?: string;
	uri: URI;
	line: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	message: string;
	severity: 'error' | 'warning' | 'info';
	source?: string; // 诊断来源（如 typescript, eslint）
	code?: string | number; // 错误代码
}

// ============================================================================
// 编辑预测配置
// ============================================================================

export interface EditPredictionConfig {
	// 是否启用多位置编辑预测
	enableMultiLocationPrediction: boolean;
	// 最大预测位置数
	maxPredictionLocations: number;
	// 最小置信度阈值
	minConfidenceThreshold: number;
	// 是否启用跨文件预测
	enableCrossFilePrediction: boolean;
	// 防抖时间 (ms)
	debounceTime: number;
	// 自动刷新时间 (ms)
	autoRefreshTime: number;
	// 最大缓存大小
	maxCacheSize: number;
	// 是否启用错误检测和修复
	enableErrorDetection: boolean;
	// 是否优先显示错误修复
	prioritizeErrorFixes: boolean;
}

export const DEFAULT_EDIT_PREDICTION_CONFIG: EditPredictionConfig = {
	enableMultiLocationPrediction: true,
	maxPredictionLocations: 5,
	minConfidenceThreshold: 0.3,
	enableCrossFilePrediction: false, // 默认关闭跨文件，性能考虑
	debounceTime: 100, // 减少防抖时间，加快响应
	autoRefreshTime: 5000,
	maxCacheSize: 20,
	enableErrorDetection: true, // 启用错误检测
	prioritizeErrorFixes: true, // 优先显示错误修复
};

// ============================================================================
// 编辑预测事件
// ============================================================================

export interface EditPredictionEvent {
	type: 'prediction_ready' | 'prediction_applied' | 'prediction_rejected';
	result?: EditPredictionResult;
	appliedEdits?: EditPredictionItem[];
}

// ============================================================================
// 编辑预测状态
// ============================================================================

export interface EditPredictionState {
	isLoading: boolean;
	currentResult: EditPredictionResult | null;
	pendingRequest: EditPredictionRequest | null;
	recentEdits: RecentEdit[];
	appliedPredictions: Set<string>;
}

export const INITIAL_EDIT_PREDICTION_STATE: EditPredictionState = {
	isLoading: false,
	currentResult: null,
	pendingRequest: null,
	recentEdits: [],
	appliedPredictions: new Set(),
};
