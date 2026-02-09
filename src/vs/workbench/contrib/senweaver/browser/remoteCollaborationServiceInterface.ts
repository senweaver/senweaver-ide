/*--------------------------------------------------------------------------------------
 *  Copyright 2025 SenWeaver. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

// ==================== 类型定义 ====================

/** 远程连接状态 */
export type RemoteConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** 远程对端信息 */
export interface RemotePeerInfo {
	peerId: string;
	deviceCode: string;
	deviceName: string;
	status: 'online' | 'offline';
	connectedAt: number;
}

/** 远程同步的聊天消息（简化格式，适合跨设备传输） */
export interface RemoteChatMessage {
	role: 'user' | 'assistant' | 'tool';
	content: string;
	displayContent?: string;
	type?: string;       // tool 消息的 type (running_now, result, etc.)
	toolName?: string;   // 工具名称
	reasoning?: string;  // 思考过程
	timestamp?: number;
	isRemote?: boolean;  // 标识是否来自远端
}

/** 远程同步的流式状态 */
export interface RemoteStreamState {
	isRunning: string | undefined;  // 'LLM' | 'tool' | 'idle' | 'awaiting_user' | undefined
	displayContentSoFar?: string;   // 流式输出的当前内容（完整，不截断）
	reasoningSoFar?: string;        // 思考过程
	toolName?: string;              // 当前正在执行的工具名
	toolContent?: string;           // 工具执行内容
	errorMessage?: string;          // 错误信息
}

/** 远程消息类型 */
export type RemoteMessageType =
	| { type: 'handshake'; deviceCode: string; deviceName: string; }
	| { type: 'handshake_ack'; deviceCode: string; deviceName: string; }
	| { type: 'chat_command'; message: string; commandId: string; }
	| { type: 'chat_command_ack'; commandId: string; status: 'received' | 'executing' | 'completed' | 'error'; detail?: string; }
	| { type: 'chat_state_full'; threadId: string; messages: RemoteChatMessage[]; streamState: RemoteStreamState | null; totalMessages: number; }
	| { type: 'chat_state_delta'; threadId: string; newMessages: RemoteChatMessage[]; streamState: RemoteStreamState | null; fromIndex: number; }
	| { type: 'chat_stream_chunk'; threadId: string; streamState: RemoteStreamState; }
	| { type: 'chat_thread_switch'; threadId: string; threadName: string; }
	| { type: 'request_full_state'; }
	| { type: 'chat_screen_snapshot'; html: string; timestamp: number; }
	| { type: 'ping'; timestamp: number; }
	| { type: 'pong'; timestamp: number; }
	| { type: 'disconnect'; reason?: string; };

/** 信令消息（通过信令服务器交换） */
export interface SignalingMessage {
	from: string;
	to: string;
	type: 'offer' | 'answer' | 'ice-candidate';
	data: any;
}

/** 远程协作事件 */
export interface RemoteCollaborationEvent {
	type: 'connected' | 'disconnected' | 'message' | 'error' | 'chat_command';
	peerId?: string;
	data?: any;
	error?: string;
}

// ==================== 远程协作服务接口 ====================

export interface IRemoteCollaborationService {
	readonly _serviceBrand: undefined;

	/** 当前连接状态 */
	readonly connectionStatus: RemoteConnectionStatus;

	/** 已连接的对端列表 */
	readonly connectedPeers: RemotePeerInfo[];

	/** 本设备码 */
	readonly deviceCode: string;

	/** 本设备名称 */
	readonly deviceName: string;

	/** 是否接受远程连接（开关） */
	readonly acceptingConnections: boolean;

	/** 事件监听 */
	readonly onDidChangeConnectionStatus: Event<RemoteConnectionStatus>;
	readonly onDidReceiveChatCommand: Event<{ peerId: string; message: string; commandId: string; }>;
	readonly onDidUpdatePeers: Event<RemotePeerInfo[]>;
	readonly onDidChangeAcceptingConnections: Event<boolean>;

	/** 初始化服务（注册到信令服务器） */
	initialize(): Promise<void>;

	/** 设置是否接受远程连接（true=开启，false=关闭并断开已有连接） */
	setAcceptingConnections(accepting: boolean): void;

	/** 连接到远程设备 */
	connectToDevice(remoteDeviceCode: string): Promise<void>;

	/** 断开与远程设备的连接 */
	disconnectFromDevice(peerId: string): void;

	/** 断开所有连接 */
	disconnectAll(): void;

	/** 发送聊天页面快照给远端 */
	sendChatSnapshot(html: string): void;

	/** 发送完整聊天状态给远端 */
	sendChatStateUpdate(threadId: string, messages: any[], streamState: any): void;

	/** 请求发送完整状态给所有远端 */
	sendFullStateToAll(): void;

	/** 向远端发送命令执行状态 */
	sendCommandAck(peerId: string, commandId: string, status: 'received' | 'executing' | 'completed' | 'error', detail?: string): void;

	/** 设置自定义信令服务器地址 */
	setSignalingUrl(url: string): void;

	/** 销毁服务 */
	destroy(): void;
}

export const IRemoteCollaborationService = createDecorator<IRemoteCollaborationService>('senweaverRemoteCollaborationService');
