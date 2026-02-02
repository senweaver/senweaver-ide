/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState, useCallback } from 'react';
import { useAccessor, useIsDark } from '../util/services.js';
import '../styles.css';
import { Check, X, ChevronDown, ChevronUp, Sparkles, FileEdit, GitBranch, Search, ShieldCheck } from 'lucide-react';

/**
 * EditPrediction 多位置编辑预测 UI 组件
 *
 * 借鉴 Zed IDE 的设计：
 * - 显示当前位置的预测编辑
 * - 显示相关位置的联动编辑建议
 * - 支持一键应用所有预测
 * - 支持选择性应用部分预测
 */

export type EditPredictionType =
	| 'completion'     // 代码补全
	| 'error_fix'      // 错误修复
	| 'warning_fix'    // 警告修复
	| 'refactor'       // 重构建议
	| 'related';       // 相关编辑

export interface EditPredictionItem {
	id: string;
	location: {
		uri: { fsPath: string };
		startLine: number;
		startColumn: number;
		endLine: number;
		endColumn: number;
	};
	oldText: string;
	newText: string;
	confidence: number;
	reason?: string;
	type?: EditPredictionType; // 预测类型
	diagnosticId?: string; // 关联的诊断ID
}

export interface EditPredictionResult {
	id: string;
	predictions: EditPredictionItem[];
	relatedEdits: EditPredictionItem[];
	totalConfidence: number;
}

export interface EditPredictionWidgetProps {
	result: EditPredictionResult | null;
	onApply: (predictionId: string, itemIds?: string[]) => void;
	onReject: (predictionId: string) => void;
	onItemSelect?: (itemId: string, selected: boolean) => void;
}

export const EditPredictionWidgetMain = (props: EditPredictionWidgetProps) => {
	const isDark = useIsDark();

	return (
		<div className={`@@senweaver-scope ${isDark ? 'dark' : ''}`}>
			<EditPredictionWidget {...props} />
		</div>
	);
};

/**
 * 计算编辑统计信息
 */
const calculateEditStats = (items: EditPredictionItem[]) => {
	const fileStats: Map<string, { added: number; removed: number }> = new Map();

	for (const item of items) {
		const fileName = item.location.uri.fsPath.split(/[/\\]/).pop() || 'unknown';
		const oldLines = item.oldText ? item.oldText.split('\n').length : 0;
		const newLines = item.newText.split('\n').length;
		const added = Math.max(0, newLines - oldLines);
		const removed = Math.max(0, oldLines - newLines);

		const existing = fileStats.get(fileName) || { added: 0, removed: 0 };
		fileStats.set(fileName, {
			added: existing.added + added,
			removed: existing.removed + removed,
		});
	}

	const files = Array.from(fileStats.entries()).map(([fileName, stats]) => ({
		fileName,
		added: stats.added,
		removed: stats.removed,
	}));

	return {
		fileCount: files.length,
		totalAdded: files.reduce((sum, f) => sum + f.added, 0),
		totalRemoved: files.reduce((sum, f) => sum + f.removed, 0),
		files,
	};
};

const EditPredictionWidget = ({
	result,
	onApply,
	onReject,
	onItemSelect,
}: EditPredictionWidgetProps) => {
	const [expanded, setExpanded] = useState(false);
	const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
	const [hoveredItem, setHoveredItem] = useState<string | null>(null);

	// 初始化选中所有预测
	useEffect(() => {
		if (result) {
			const allIds = new Set([
				...result.predictions.map(p => p.id),
				...result.relatedEdits.map(p => p.id),
			]);
			setSelectedItems(allIds);
		}
	}, [result?.id]);

	// 计算选中项的编辑统计
	const editStats = React.useMemo(() => {
		if (!result) return null;
		const allItems = [...result.predictions, ...result.relatedEdits];
		const selectedItemsList = allItems.filter(item => selectedItems.has(item.id));
		return calculateEditStats(selectedItemsList);
	}, [result, selectedItems]);

	const handleItemToggle = useCallback((itemId: string) => {
		setSelectedItems(prev => {
			const newSet = new Set(prev);
			if (newSet.has(itemId)) {
				newSet.delete(itemId);
			} else {
				newSet.add(itemId);
			}
			onItemSelect?.(itemId, newSet.has(itemId));
			return newSet;
		});
	}, [onItemSelect]);

	const handleApplySelected = useCallback(() => {
		if (result) {
			const itemIds = Array.from(selectedItems);
			onApply(result.id, itemIds.length > 0 ? itemIds : undefined);
		}
	}, [result, selectedItems, onApply]);

	const handleApplyAll = useCallback(() => {
		if (result) {
			onApply(result.id);
		}
	}, [result, onApply]);

	const handleReject = useCallback(() => {
		if (result) {
			onReject(result.id);
		}
	}, [result, onReject]);

	if (!result || (result.predictions.length === 0 && result.relatedEdits.length === 0)) {
		return null;
	}

	const totalPredictions = result.predictions.length + result.relatedEdits.length;
	const confidencePercent = Math.round(result.totalConfidence * 100);

	return (
		<div className="
			pointer-events-auto select-none
			z-[1000]
			rounded-md shadow-lg
			border border-senweaver-border-3 bg-senweaver-bg-2
			transition-all duration-200
			overflow-hidden
			${expanded ? 'min-w-[280px] max-w-[400px]' : 'w-auto'}
		">
			{/* 头部 - 最小化时只显示图标和置信度 */}
			{!expanded ? (
				<div
					className="
						flex items-center gap-1.5
						px-2 py-1
						bg-senweaver-bg-3/50
						cursor-pointer
						hover:bg-senweaver-bg-3/70
						transition-colors
						rounded-md
					"
					onClick={() => setExpanded(true)}
					title="Click to expand Inspector"
				>
					<ShieldCheck className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
					<span className="text-[11px] text-senweaver-fg-2 font-medium whitespace-nowrap">
						{confidencePercent}% confidence
					</span>
					<ChevronDown className="w-3 h-3 text-senweaver-fg-3 flex-shrink-0" />
				</div>
			) : (
				<div
					className="
						flex items-center justify-between
						px-3 py-2
						bg-senweaver-bg-3/50
						border-b border-senweaver-border-3
						cursor-pointer
					"
					onClick={() => setExpanded(false)}
				>
					<div className="flex items-center gap-2">
						<Sparkles className="w-4 h-4 text-amber-400" />
						<span className="font-medium text-sm">
							Inspector
						</span>
						<span className="
							px-1.5 py-0.5 rounded-full
							bg-blue-500/20 text-blue-400
							text-xs font-medium
						">
							{totalPredictions}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs text-senweaver-fg-3">
							{confidencePercent}% confidence
						</span>
						<ChevronUp className="w-4 h-4 text-senweaver-fg-3" />
					</div>
				</div>
			)}

			{/* 预测列表 */}
			{expanded && (
				<div className="max-h-[300px] overflow-y-auto">
					{/* 当前位置预测 */}
					{result.predictions.length > 0 && (
						<div className="px-2 py-1.5">
							<div className="flex items-center gap-1.5 px-1 py-1 text-xs text-senweaver-fg-3">
								<FileEdit className="w-3 h-3" />
								<span>Current Location</span>
							</div>
							{result.predictions.map(item => (
								<PredictionItem
									key={item.id}
									item={item}
									selected={selectedItems.has(item.id)}
									hovered={hoveredItem === item.id}
									onToggle={() => handleItemToggle(item.id)}
									onHover={setHoveredItem}
								/>
							))}
						</div>
					)}

					{/* 相关位置编辑 */}
					{result.relatedEdits.length > 0 && (
						<div className="px-2 py-1.5 border-t border-senweaver-border-3/50">
							<div className="flex items-center gap-1.5 px-1 py-1 text-xs text-senweaver-fg-3">
								<GitBranch className="w-3 h-3" />
								<span>Related Edits</span>
							</div>
							{result.relatedEdits.map(item => (
								<PredictionItem
									key={item.id}
									item={item}
									selected={selectedItems.has(item.id)}
									hovered={hoveredItem === item.id}
									onToggle={() => handleItemToggle(item.id)}
									onHover={setHoveredItem}
								/>
							))}
						</div>
					)}
				</div>
			)}

			{/* 修改统计 - 显示选中的修改处数（仅展开时显示） */}
			{expanded && selectedItems.size > 0 && (
				<div className="
					px-3 py-2
					border-t border-senweaver-border-3
					bg-senweaver-bg-3/20
				">
					<div className="flex items-center justify-between text-xs">
						<div className="flex items-center gap-2">
							<Sparkles className="w-3.5 h-3.5 text-amber-400" />
							<span className="text-senweaver-fg-2">
								{selectedItems.size} edit{selectedItems.size > 1 ? 's' : ''} selected
							</span>
							{editStats && editStats.totalAdded > 0 && (
								<span className="text-green-400 font-medium">+{editStats.totalAdded}</span>
							)}
							{editStats && editStats.totalRemoved > 0 && (
								<span className="text-red-400 font-medium">-{editStats.totalRemoved}</span>
							)}
						</div>
					</div>
				</div>
			)}

			{/* 操作按钮（仅展开时显示） */}
			{expanded && (
				<div className="
					flex items-center justify-between
					px-3 py-2
					border-t border-senweaver-border-3
					bg-senweaver-bg-3/30
				">
				<button
					className="
						flex items-center gap-1
						px-2 py-1 rounded
						text-xs text-senweaver-fg-3
						hover:bg-senweaver-bg-3 hover:text-senweaver-fg-1
						transition-colors
					"
					onClick={handleReject}
				>
					<X className="w-3.5 h-3.5" />
					Dismiss
				</button>
				<div className="flex items-center gap-2">
					{expanded && selectedItems.size > 0 && selectedItems.size < totalPredictions && (
						<button
							className="
								px-2 py-1 rounded
								text-xs
								bg-blue-500/20 text-blue-400
								hover:bg-blue-500/30
								transition-colors
							"
							onClick={handleApplySelected}
						>
							Apply Selected ({selectedItems.size})
						</button>
					)}
					<button
						className="
							flex items-center gap-1
							px-3 py-1 rounded
							text-xs font-medium
							bg-blue-500 text-white
							hover:bg-blue-600
							transition-colors
						"
						onClick={handleApplyAll}
					>
						<Check className="w-3.5 h-3.5" />
						Apply All
					</button>
				</div>
			</div>
			)}
		</div>
	);
};

interface PredictionItemProps {
	item: EditPredictionItem;
	selected: boolean;
	hovered: boolean;
	onToggle: () => void;
	onHover: (id: string | null) => void;
}

const PredictionItem = ({
	item,
	selected,
	hovered,
	onToggle,
	onHover,
}: PredictionItemProps) => {
	const confidenceColor = item.confidence >= 0.7
		? 'text-green-400'
		: item.confidence >= 0.5
			? 'text-yellow-400'
			: 'text-orange-400';

	const fileName = item.location.uri.fsPath.split(/[/\\]/).pop() || '';
	const lineInfo = item.location.startLine === item.location.endLine
		? `L${item.location.startLine}`
		: `L${item.location.startLine}-${item.location.endLine}`;

	// 类型标签配置
	const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
		'error_fix': { label: 'Fix', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: '🔧' },
		'warning_fix': { label: 'Warn', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: '⚠️' },
		'completion': { label: 'Code', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: '✨' },
		'refactor': { label: 'Refactor', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: '🔄' },
		'related': { label: 'Related', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: '🔗' },
		// 🔥 新增strix风格的安全和代码质量类型
		'security_fix': { label: 'Security', color: 'bg-red-600/20 text-red-400 border-red-500/30', icon: '🔒' },
		'code_quality': { label: 'Quality', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', icon: '📋' },
	};
	const typeInfo = typeConfig[item.type || 'completion'] || typeConfig['completion'];

	return (
		<div
			className={`
				flex items-start gap-2
				px-2 py-1.5 mx-1 my-0.5
				rounded cursor-pointer
				transition-colors
				${hovered ? 'bg-senweaver-bg-3' : 'hover:bg-senweaver-bg-3/50'}
				${selected ? 'border-l-2 border-blue-400' : 'border-l-2 border-transparent'}
			`}
			onClick={onToggle}
			onMouseEnter={() => onHover(item.id)}
			onMouseLeave={() => onHover(null)}
		>
			{/* 选择框 */}
			<div className={`
				w-4 h-4 mt-0.5 rounded border
				flex items-center justify-center
				transition-colors
				${selected
					? 'bg-blue-500 border-blue-500'
					: 'border-senweaver-border-3 hover:border-blue-400'
				}
			`}>
				{selected && <Check className="w-3 h-3 text-white" />}
			</div>

			{/* 内容 */}
			<div className="flex-1 min-w-0">
				{/* 类型标签和位置信息 */}
				<div className="flex items-center gap-2 text-xs flex-wrap">
					{/* 类型标签 */}
					<span className={`
						px-1.5 py-0.5 rounded text-[10px] font-medium border
						${typeInfo.color}
					`}>
						{typeInfo.icon} {typeInfo.label}
					</span>
					<span className="text-senweaver-fg-2 truncate">{fileName}</span>
					<span className="text-senweaver-fg-3">{lineInfo}</span>
					<span className={`${confidenceColor} text-[10px]`}>
						{Math.round(item.confidence * 100)}%
					</span>
				</div>

				{/* 编辑预览 */}
				<div className="mt-1 text-xs font-mono">
					{item.oldText && (
						<div className="text-red-400/80 line-through truncate">
							{item.oldText.slice(0, 50)}{item.oldText.length > 50 ? '...' : ''}
						</div>
					)}
					<div className="text-green-400/80 truncate">
						{item.newText.slice(0, 50)}{item.newText.length > 50 ? '...' : ''}
					</div>
				</div>

				{/* 原因说明 */}
				{item.reason && (
					<div className="mt-1 text-[10px] text-senweaver-fg-3 truncate">
						{item.reason}
					</div>
				)}
			</div>
		</div>
	);
};

export default EditPredictionWidget;
