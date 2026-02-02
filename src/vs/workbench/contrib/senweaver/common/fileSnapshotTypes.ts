/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * 修改位置信息
 */
export interface IChangeLocation {
	/** 起始行号 */
	startLine: number;
	/** 结束行号 */
	endLine: number;
	/** 修改类型: insert=插入, delete=删除, modify=修改 */
	type: 'insert' | 'delete' | 'modify';
}

/**
 * 单个文件快照
 */
export interface IFileSnapshot {
	/** 快照ID */
	id: string;
	/** 文件URI */
	uri: URI;
	/** 文件路径 */
	fsPath: string;
	/** 文件名 */
	fileName: string;
	/** 快照内容 */
	content: string;
	/** 创建时间 */
	timestamp: number;
	/** 快照描述/标签 */
	label?: string;
	/** 文件大小（字节） */
	size: number;
	/** 是否是自动创建的快照 */
	isAutoSnapshot: boolean;
	/** 触发快照的会话/来源ID */
	sessionId?: string;
	/** 触发快照的来源描述 (如: "AI编辑", "用户保存", "撤销操作") */
	source?: string;
	/** 修改位置信息 */
	changeLocations?: IChangeLocation[];
}

/**
 * 文件的快照历史
 */
export interface IFileSnapshotHistory {
	/** 文件URI */
	uri: URI;
	/** 文件路径 */
	fsPath: string;
	/** 文件名 */
	fileName: string;
	/** 快照列表（按时间倒序） */
	snapshots: IFileSnapshot[];
	/** 最后修改时间 */
	lastModified: number;
}

/**
 * 快照服务状态
 */
export interface IFileSnapshotServiceState {
	/** 所有文件的快照历史，key是fsPath */
	snapshotsByFile: { [fsPath: string]: IFileSnapshotHistory };
	/** 是否启用自动快照 */
	autoSnapshotEnabled: boolean;
	/** 最大快照数量（每个文件） */
	maxSnapshotsPerFile: number;
}

/**
 * 文件快照服务接口
 */
export interface IFileSnapshotService {
	readonly _serviceBrand: undefined;

	/** 服务状态 */
	readonly state: IFileSnapshotServiceState;

	/**
	 * 为指定文件创建快照
	 * @param uri 文件URI
	 * @param options 快照选项
	 */
	createSnapshot(uri: URI, options?: {
		label?: string;
		isAuto?: boolean;
		sessionId?: string;
		source?: string;
		changeLocations?: IChangeLocation[];
	}): Promise<IFileSnapshot | null>;

	/**
	 * 获取文件的快照历史
	 * @param uri 文件URI
	 */
	getSnapshotHistory(uri: URI): IFileSnapshotHistory | undefined;

	/**
	 * 获取所有有快照的文件列表
	 */
	getAllFilesWithSnapshots(): IFileSnapshotHistory[];

	/**
	 * 恢复到指定快照
	 * @param snapshotId 快照ID
	 */
	restoreSnapshot(snapshotId: string): Promise<boolean>;

	/**
	 * 删除指定快照
	 * @param snapshotId 快照ID
	 */
	deleteSnapshot(snapshotId: string): void;

	/**
	 * 删除文件的所有快照
	 * @param uri 文件URI
	 */
	deleteAllSnapshots(uri: URI): void;

	/**
	 * 清空所有快照
	 */
	clearAllSnapshots(): void;

	/**
	 * 对比快照与当前文件
	 * @param snapshotId 快照ID
	 */
	compareWithCurrent(snapshotId: string): Promise<void>;

	/**
	 * 对比两个快照
	 * @param snapshotId1 快照1 ID
	 * @param snapshotId2 快照2 ID
	 */
	compareTwoSnapshots(snapshotId1: string, snapshotId2: string): Promise<void>;

	/**
	 * 启用/禁用自动快照
	 */
	setAutoSnapshotEnabled(enabled: boolean): void;

	/**
	 * 设置每个文件的最大快照数量
	 */
	setMaxSnapshotsPerFile(max: number): void;

	/**
	 * 根据快照ID获取快照（用于内容提供者）
	 * @param snapshotId 快照ID
	 */
	getSnapshotById(snapshotId: string): IFileSnapshot | undefined;

	/**
	 * 当文件快照变化时触发
	 */
	onDidChangeSnapshots: import('../../../../base/common/event.js').Event<URI | undefined>;
}

export const IFileSnapshotService = createDecorator<IFileSnapshotService>('fileSnapshotService');
