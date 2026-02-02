/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { CheckCircle, Circle, Loader2 } from 'lucide-react';

export interface DesignTaskProgress {
	totalCount: number | null;      // Total number of UIs to design (null if unknown)
	completedCount: number;  // Number of completed UIs
	phase: 'planning' | 'designing' | 'completed' | 'navigation' | 'navigation_completed'; // Current phase
}

interface DesignTaskProgressIndicatorProps {
	progress: DesignTaskProgress;
	isStreaming?: boolean;
}

/**
 * Task progress indicator for designer mode
 * Shows planning, progress, and completion status
 */
export const DesignTaskProgressIndicator: React.FC<DesignTaskProgressIndicatorProps> = ({
	progress,
	isStreaming = false
}) => {
	const { totalCount, completedCount, phase } = progress;

	// Planning phase - show at the beginning
	if (phase === 'planning') {
		// When totalCount is null, we don't know the total, so just show current progress
		// completedCount is the number of designs completed BEFORE this one starts
		const taskText = totalCount === null
			? completedCount === 0
				? `📋 任务规划：开始设计第1个UI界面...`
				: `📋 任务规划：已完成${completedCount}个UI，开始设计第${completedCount + 1}个UI界面...`
			: totalCount === 1 
				? `📋 任务规划：开始设计1个UI界面...`
				: `📋 任务规划：已完成${completedCount}个UI，开始设计第${completedCount + 1}个UI界面（共${totalCount}个）...`;
		return (
			<div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-senweaver-bg-1 border border-senweaver-border">
				<Loader2 size={16} className="animate-spin text-blue-500" />
				<span className="text-sm text-senweaver-foreground">
					{taskText}
				</span>
			</div>
		);
	}

	// Designing phase - show progress after each completion
	if (phase === 'designing') {
		const progressText = totalCount === null
			? `✅ 生产完成${completedCount}/1，现在开始自动规划导航...`
			: totalCount === 1
				? '✅ 生产完成1/1，现在开始自动规划导航...'
				: completedCount < totalCount
					? `✅ 生产完成${completedCount}/${totalCount}，现在开始下一个UI设计...`
					: `✅ 生产完成${completedCount}/${totalCount}，现在开始自动规划导航...`;
		return (
			<div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
				<CheckCircle size={16} className="text-blue-500" />
				<span className="text-sm text-senweaver-foreground">
					{progressText}
				</span>
			</div>
		);
	}

	// Navigation planning phase - in progress
	if (phase === 'navigation') {
		return (
			<div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
				<Loader2 size={16} className="animate-spin text-purple-500" />
				<span className="text-sm text-senweaver-foreground">
					🔗 正在智能规划UI导航关系...
				</span>
			</div>
		);
	}

	// Navigation planning completed phase
	if (phase === 'navigation_completed') {
		return (
			<div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
				<CheckCircle size={16} className="text-green-500" />
				<span className="text-sm text-senweaver-foreground">
					✅ 完成智能规划UI导航关系
				</span>
			</div>
		);
	}

	// Completed phase - show final summary
	if (phase === 'completed') {
		// completedCount includes the current completed design
		const summaryText = totalCount === null
			? `✅ 完成第${completedCount}个UI设计`
			: completedCount < totalCount
				? `✅ 完成第${completedCount}个UI设计（共${totalCount}个）`
				: `✅ 全部${totalCount}个UI设计已完成`;
		return (
			<div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
				<CheckCircle size={16} className="text-green-500" />
				<span className="text-sm text-senweaver-foreground">
					{summaryText}
				</span>
			</div>
		);
	}

	return null;
};

/**
 * Extract task progress from AI reasoning or response
 */
export const extractTaskProgressFromMessage = (content: string): DesignTaskProgress | null => {
	// Try to detect planning phase - various patterns
	const planningPatterns = [
		/(?:将设计|需要设计|共设计|设计)\s*(\d+)\s*(?:个|页|个页面|界面)/i,
		/(\d+)\s*(?:个|页|界面).*?(?:设计|UI)/i,
		/为您设计\s*(\d+)/i,
	];

	for (const pattern of planningPatterns) {
		const match = content.match(pattern);
		if (match) {
			const totalCount = parseInt(match[1], 10);
			if (totalCount >= 1) { // Track all UI tasks including single UI
				return {
					totalCount,
					completedCount: 0,
					phase: 'planning'
				};
			}
		}
	}

	// Try to detect completion/progress in message
	const progressPatterns = [
		/(?:完成|已完成|完成了)\s*(\d+)\s*(?:个|页|界面)/i,
		/(\d+)\s*(?:个|页|界面).*?(?:完成|设计完成)/i,
		/(?:第|当前)\s*(\d+)\s*(?:个|页|界面)/i,
	];

	for (const pattern of progressPatterns) {
		const match = content.match(pattern);
		if (match) {
			const completedCount = parseInt(match[1], 10);
			return {
				totalCount: completedCount, // Will be updated by context
				completedCount,
				phase: 'designing'
			};
		}
	}

	// Detect navigation planning
	if (content.includes('导航') && (content.includes('规划') || content.includes('链接'))) {
		return {
			totalCount: 0,
			completedCount: 0,
			phase: 'navigation'
		};
	}

	return null;
};

/**
 * Calculate task progress based on actual design history
 */
export const calculateTaskProgress = (
	designCount: number,
	expectedTotal: number | null,
	isStreaming: boolean
): DesignTaskProgress | null => {
	if (designCount === 0 && !expectedTotal) return null;

	// If we have an expected total (including single UI)
	if (expectedTotal && expectedTotal >= 1) {
		if (designCount >= expectedTotal) {
			return {
				totalCount: expectedTotal,
				completedCount: expectedTotal,
				phase: 'completed'
			};
		} else {
			return {
				totalCount: expectedTotal,
				completedCount: designCount,
				phase: 'designing'
			};
		}
	}

	// If we have designs but no expected total
	if (designCount >= 1) {
		return {
			totalCount: designCount,
			completedCount: designCount,
			phase: isStreaming ? 'designing' : 'completed'
		};
	}

	return null;
};
