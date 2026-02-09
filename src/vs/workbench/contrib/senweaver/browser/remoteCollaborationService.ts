/*--------------------------------------------------------------------------------------
 *  Copyright 2025 SenWeaver. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IChatThreadService } from './chatThreadService.js';
import {
	IRemoteCollaborationService,
	RemoteConnectionStatus,
	RemotePeerInfo,
	RemoteChatMessage,
	RemoteStreamState,
	RemoteMessageType,
	SignalingMessage,
} from './remoteCollaborationServiceInterface.js';

// 从接口文件重新导出所有类型，保持向后兼容
export type { RemoteCollaborationEvent } from './remoteCollaborationServiceInterface.js';
export {
	IRemoteCollaborationService,
	RemoteConnectionStatus,
	RemotePeerInfo,
	RemoteChatMessage,
	RemoteStreamState,
	RemoteMessageType,
	SignalingMessage,
} from './remoteCollaborationServiceInterface.js';

// ==================== 信令服务 ====================

/**
 * 基于 WebSocket 的简单信令服务
 * 使用设备码作为房间标识，实现 offer/answer/ICE 交换
 */
class SignalingService {
	private ws: WebSocket | null = null;
	private deviceCode: string = '';
	private onMessageCallback: ((msg: SignalingMessage) => void) | null = null;
	private onConnectedCallback: (() => void) | null = null;
	private onErrorCallback: ((error: string) => void) | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private isDestroyed = false;

	// Default to SenWeaver official signaling server
	// Can be customized via localStorage: localStorage.setItem('senweaver.signaling.url', 'wss://your-server.com/ws/signaling')
	private signalingUrl = 'wss://ide-api.senweaver.com/ws/signaling';

	constructor() {
		// Try to read custom signaling server URL from localStorage
		const customUrl = localStorage.getItem('senweaver.signaling.url');
		if (customUrl) {
			this.signalingUrl = customUrl;
		}
	}

	/**
	 * Connect to signaling server and register device code
	 */
	async connect(deviceCode: string): Promise<void> {
		this.deviceCode = deviceCode;
		this.isDestroyed = false;

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.signalingUrl);

				this.ws.onopen = () => {
					this.reconnectAttempts = 0;
					// Register device code
					this.ws?.send(JSON.stringify({
						type: 'register',
						deviceCode: this.deviceCode,
					}));
					// Start heartbeat (send ping every 30 seconds)
					this._startHeartbeat();
					this.onConnectedCallback?.();
					resolve();
				};

				this.ws.onmessage = (event) => {
					try {
						const msg = JSON.parse(event.data);
						
						switch (msg.type) {
							case 'registered':
								// Device registration successful
								console.log('[RemoteCollab] Device registered:', msg.deviceCode);
								break;
							
							case 'signal':
								// WebRTC signaling message (offer/answer/ice-candidate)
								if (this.onMessageCallback) {
									this.onMessageCallback(msg.data as SignalingMessage);
								}
								break;
							
							case 'device_online':
								// Other device online notification (optional, for displaying online device list)
								console.log('[RemoteCollab] Device online:', msg.deviceCode);
								break;
							
							case 'device_offline':
								// Other device offline notification (optional)
								console.log('[RemoteCollab] Device offline:', msg.deviceCode);
								break;
							
							case 'error':
								// Server error message
								console.error('[RemoteCollab] Signaling error:', msg.message);
								this.onErrorCallback?.(msg.message || 'Signaling server error');
								break;
							
							case 'pong':
								// Heartbeat reply
								break;
							
							default:
								console.log('[RemoteCollab] Unknown message type:', msg.type);
						}
					} catch (e) {
						console.error('[RemoteCollab] Failed to parse signaling message:', e);
					}
				};

				this.ws.onerror = (event) => {
					console.error('[RemoteCollab] WebSocket error:', event);
					this.onErrorCallback?.('Signaling server connection failed');
				};

				this.ws.onclose = () => {
					this._stopHeartbeat();
					if (!this.isDestroyed) {
						this._tryReconnect();
					}
				};

				// Timeout handling
				setTimeout(() => {
					if (this.ws?.readyState !== WebSocket.OPEN) {
						this.ws?.close();
						reject(new Error('Signaling server connection timeout'));
					}
				}, 10000);

			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Send message to target device via signaling server
	 */
	send(targetDeviceCode: string, message: SignalingMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({
				type: 'signal',
				to: targetDeviceCode,
				data: message,
			}));
		}
	}

	onMessage(callback: (msg: SignalingMessage) => void): void {
		this.onMessageCallback = callback;
	}

	onConnected(callback: () => void): void {
		this.onConnectedCallback = callback;
	}

	onError(callback: (error: string) => void): void {
		this.onErrorCallback = callback;
	}

	private _tryReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts || this.isDestroyed) {
			this.onErrorCallback?.('Signaling server reconnection failed');
			return;
		}
		this.reconnectAttempts++;
		const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
		this.reconnectTimer = setTimeout(() => {
			// Heartbeat will be automatically started on reconnect (in connect's onopen)
			this.connect(this.deviceCode).catch(() => { });
		}, delay);
	}

	get isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	private _startHeartbeat(): void {
		this._stopHeartbeat();
		// Send heartbeat every 30 seconds
		this.heartbeatTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, 30000);
	}

	private _stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	destroy(): void {
		this.isDestroyed = true;
		this._stopHeartbeat();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		this.ws?.close();
		this.ws = null;
	}
}

// ==================== 备用信令：LocalStorage 轮询（同一设备/局域网场景） ====================

/**
 * 备用信令方案：使用 BroadcastChannel + localStorage 实现本地信令
 * 当 WebSocket 信令服务器不可用时自动降级使用
 */
class LocalSignalingService {
	private channel: BroadcastChannel | null = null;
	private deviceCode: string = '';
	private onMessageCallback: ((msg: SignalingMessage) => void) | null = null;
	private pollingTimer: ReturnType<typeof setInterval> | null = null;

	connect(deviceCode: string): void {
		this.deviceCode = deviceCode;

		// 使用 BroadcastChannel 实现同源页面间通信
		try {
			this.channel = new BroadcastChannel('senweaver-remote-signaling');
			this.channel.onmessage = (event) => {
				const msg = event.data;
				if (msg.to === this.deviceCode && this.onMessageCallback) {
					this.onMessageCallback(msg.data as SignalingMessage);
				}
			};
		} catch {
			// BroadcastChannel 不可用，使用 localStorage 轮询
			this._startPolling();
		}
	}

	send(targetDeviceCode: string, message: SignalingMessage): void {
		if (this.channel) {
			this.channel.postMessage({
				to: targetDeviceCode,
				data: message,
			});
		} else {
			// localStorage 备用方案
			const key = `senweaver-signal-${targetDeviceCode}-${Date.now()}`;
			localStorage.setItem(key, JSON.stringify(message));
			// 清理旧消息
			setTimeout(() => localStorage.removeItem(key), 30000);
		}
	}

	onMessage(callback: (msg: SignalingMessage) => void): void {
		this.onMessageCallback = callback;
	}

	private _startPolling(): void {
		this.pollingTimer = setInterval(() => {
			const prefix = `senweaver-signal-${this.deviceCode}-`;
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith(prefix)) {
					const data = localStorage.getItem(key);
					if (data && this.onMessageCallback) {
						try {
							this.onMessageCallback(JSON.parse(data));
						} catch { }
						localStorage.removeItem(key);
					}
				}
			}
		}, 500);
	}

	destroy(): void {
		this.channel?.close();
		this.channel = null;
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
		}
	}
}

// ==================== ICE Server Configuration ====================

/**
 * Fetch ICE server configuration from server, fallback to default on failure
 */
async function getIceServers(): Promise<RTCIceServer[]> {
	// Default ICE server configuration (Google STUN servers)
	const defaultIceServers: RTCIceServer[] = [
		{ urls: 'stun:stun.l.google.com:19302' },
		{ urls: 'stun:stun1.l.google.com:19302' },
		{ urls: 'stun:stun2.l.google.com:19302' },
		{ urls: 'stun:stun3.l.google.com:19302' },
		{ urls: 'stun:stun4.l.google.com:19302' },
	];

	try {
		// Try to fetch ICE server configuration from server
		const response = await fetch('https://ide-api.senweaver.com/api/signaling/ice-servers');
		if (response.ok) {
			const data = await response.json();
			if (data.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
				console.log('[RemoteCollab] Using server-provided ICE configuration');
				return data.iceServers;
			}
		}
	} catch (error) {
		console.warn('[RemoteCollab] Failed to fetch ICE server configuration, using default:', error);
	}

	return defaultIceServers;
}

// ==================== WebRTC 连接管理器 ====================

class WebRTCConnection {
	private pc: RTCPeerConnection | null = null;
	private dataChannel: RTCDataChannel | null = null;
	private onMessageCallback: ((data: RemoteMessageType) => void) | null = null;
	private onStateChangeCallback: ((state: RTCPeerConnectionState) => void) | null = null;
	private sendQueue: RemoteMessageType[] = [];
	private _isChannelOpen = false;
	private iceServers: RTCIceServer[] | null = null;

	constructor(
		private readonly localDeviceCode: string,
		private readonly remoteDeviceCode: string,
		private readonly sendSignaling: (msg: SignalingMessage) => void,
	) { }

	/**
	 * Initialize ICE server configuration (async fetch)
	 */
	private async _ensureIceServers(): Promise<RTCIceServer[]> {
		if (!this.iceServers) {
			this.iceServers = await getIceServers();
		}
		return this.iceServers;
	}

	/**
	 * Create offer (called by the initiator)
	 */
	async createOffer(): Promise<void> {
		const iceServers = await this._ensureIceServers();
		this.pc = this._createPeerConnection(iceServers);

		// Initiator creates DataChannel
		this.dataChannel = this.pc.createDataChannel('senweaver-remote', {
			ordered: true,
		});
		this._setupDataChannel(this.dataChannel);

		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);

		this.sendSignaling({
			from: this.localDeviceCode,
			to: this.remoteDeviceCode,
			type: 'offer',
			data: offer,
		});
	}

	/**
	 * Handle remote offer and create answer
	 */
	async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
		const iceServers = await this._ensureIceServers();
		this.pc = this._createPeerConnection(iceServers);

		// Responder listens for DataChannel
		this.pc.ondatachannel = (event) => {
			this.dataChannel = event.channel;
			this._setupDataChannel(this.dataChannel);
		};

		await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
		const answer = await this.pc.createAnswer();
		await this.pc.setLocalDescription(answer);

		this.sendSignaling({
			from: this.localDeviceCode,
			to: this.remoteDeviceCode,
			type: 'answer',
			data: answer,
		});
	}

	/**
	 * 处理远端 answer
	 */
	async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
		if (this.pc) {
			await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
		}
	}

	/**
	 * 处理 ICE candidate
	 */
	async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		if (this.pc) {
			await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
		}
	}

	/**
	 * 发送数据
	 * 对于大数据，内部会自动异步分片
	 */
	send(data: RemoteMessageType): boolean {
		if (!this._isChannelOpen || !this.dataChannel) {
			this.sendQueue.push(data);
			return false;
		}

		try {
			// 检查 DataChannel 缓冲区 — 如果积压过多，延迟发送避免阻塞
			if (this.dataChannel.bufferedAmount > 1024 * 1024) { // 1MB 缓冲上限
				// 缓冲区过大，放入队列延迟发送
				this.sendQueue.push(data);
				this._drainSendQueue();
				return true;
			}

			const json = JSON.stringify(data);
			return this._sendJsonString(json);
		} catch (error) {
			console.error('[RemoteCollab] 发送数据失败:', error);
			return false;
		}
	}

	/**
	 * 发送预先序列化好的 JSON 字符串（用于广播场景避免重复 stringify）
	 */
	sendPreSerialized(json: string): boolean {
		if (!this._isChannelOpen || !this.dataChannel) {
			// 无法队列化原始 JSON，降级反序列化后入队
			try {
				this.sendQueue.push(JSON.parse(json));
			} catch { /* 忽略 */ }
			return false;
		}

		if (this.dataChannel.bufferedAmount > 1024 * 1024) {
			try {
				this.sendQueue.push(JSON.parse(json));
			} catch { /* 忽略 */ }
			this._drainSendQueue();
			return true;
		}

		return this._sendJsonString(json);
	}

	/**
	 * 内部方法：发送已序列化的 JSON 字符串
	 */
	private _sendJsonString(json: string): boolean {
		try {
			// 超大数据分片发送（异步）
			if (json.length > 60000) {
				this._sendChunked(json);
			} else {
				this.dataChannel!.send(json);
			}
			return true;
		} catch (error) {
			console.error('[RemoteCollab] 发送数据失败:', error);
			return false;
		}
	}

	/**
	 * 延迟排空发送队列（当缓冲区恢复后逐个发送）
	 */
	private _drainSendQueue(): void {
		if (this.sendQueue.length === 0 || !this.dataChannel || !this._isChannelOpen) return;

		// 等待缓冲区降低后重试
		setTimeout(() => {
			if (!this.dataChannel || !this._isChannelOpen) return;
			if (this.dataChannel.bufferedAmount < 512 * 1024 && this.sendQueue.length > 0) {
				const msg = this.sendQueue.shift()!;
				this.send(msg);
			}
			if (this.sendQueue.length > 0) {
				this._drainSendQueue();
			}
		}, 50);
	}

	onMessage(callback: (data: RemoteMessageType) => void): void {
		this.onMessageCallback = callback;
	}

	onStateChange(callback: (state: RTCPeerConnectionState) => void): void {
		this.onStateChangeCallback = callback;
	}

	get isConnected(): boolean {
		return this._isChannelOpen && this.pc?.connectionState === 'connected';
	}

	destroy(): void {
		this._isChannelOpen = false;
		this.dataChannel?.close();
		this.pc?.close();
		this.dataChannel = null;
		this.pc = null;
		this.sendQueue = [];
	}

	// ==================== 私有方法 ====================

	private _createPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
		const pc = new RTCPeerConnection({
			iceServers: iceServers,
		});

		// ICE candidate 收集
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				this.sendSignaling({
					from: this.localDeviceCode,
					to: this.remoteDeviceCode,
					type: 'ice-candidate',
					data: event.candidate.toJSON(),
				});
			}
		};

		// 连接状态变化
		pc.onconnectionstatechange = () => {
			console.log('[RemoteCollab] 连接状态:', pc.connectionState);
			this.onStateChangeCallback?.(pc.connectionState);
		};

		pc.oniceconnectionstatechange = () => {
			console.log('[RemoteCollab] ICE 状态:', pc.iceConnectionState);
		};

		return pc;
	}

	private _setupDataChannel(channel: RTCDataChannel): void {
		channel.onopen = () => {
			console.log('[RemoteCollab] DataChannel 已打开');
			this._isChannelOpen = true;

			// 异步逐个排空队列，不阻塞主线程
			this._drainSendQueue();
		};

		channel.onclose = () => {
			console.log('[RemoteCollab] DataChannel 已关闭');
			this._isChannelOpen = false;
		};

		// 分片消息缓存
		let chunkedBuffer: { [id: string]: string[] } = {};

		channel.onmessage = (event) => {
			try {
				const raw = JSON.parse(event.data);

				// 处理分片消息
				if (raw.__chunked) {
					const { id, index, total, data } = raw;
					if (!chunkedBuffer[id]) {
						chunkedBuffer[id] = new Array(total);
					}
					chunkedBuffer[id][index] = data;

					// 检查是否所有分片都到齐
					const allReceived = chunkedBuffer[id].every(chunk => chunk !== undefined);
					if (allReceived) {
						const fullData = JSON.parse(chunkedBuffer[id].join(''));
						delete chunkedBuffer[id];
						this.onMessageCallback?.(fullData);
					}
					return;
				}

				this.onMessageCallback?.(raw as RemoteMessageType);
			} catch (error) {
				console.error('[RemoteCollab] 解析消息失败:', error);
			}
		};

		channel.onerror = (event) => {
			console.error('[RemoteCollab] DataChannel 错误:', event);
		};
	}

	/**
	 * 分片发送大数据（异步逐片发送，避免一帧内连续调用多次 send 阻塞主线程）
	 */
	private _sendChunked(json: string): void {
		const chunkSize = 50000;
		const totalChunks = Math.ceil(json.length / chunkSize);
		const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		let index = 0;
		const sendNextChunk = () => {
			if (index >= totalChunks || !this.dataChannel || !this._isChannelOpen) return;

			const start = index * chunkSize;
			const chunk = json.slice(start, start + chunkSize);

			try {
				this.dataChannel.send(JSON.stringify({
					__chunked: true,
					id,
					index,
					total: totalChunks,
					data: chunk,
				}));
			} catch (e) {
				console.error('[RemoteCollab] 分片发送失败:', e);
				return;
			}

			index++;
			if (index < totalChunks) {
				// 每发一片让出主线程，防止连续 send 阻塞
				setTimeout(sendNextChunk, 0);
			}
		};

		sendNextChunk();
	}
}

// ==================== 远程协作服务实现 ====================

class RemoteCollaborationService extends Disposable implements IRemoteCollaborationService {
	_serviceBrand: undefined;

	private _connectionStatus: RemoteConnectionStatus = 'disconnected';
	private _connectedPeers: RemotePeerInfo[] = [];
	private _deviceCode: string = '';
	private _deviceName: string = '';
	private _connections: Map<string, WebRTCConnection> = new Map();

	private _signalingService: SignalingService;
	private _localSignaling: LocalSignalingService;
	private _useLocalSignaling = false;

	// 心跳
	private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	// 聊天状态同步
	private _chatSnapshotTimer: ReturnType<typeof setInterval> | null = null;
	private _lastSnapshotHtml: string = '';

	// 事件
	private readonly _onDidChangeConnectionStatus = new Emitter<RemoteConnectionStatus>();
	readonly onDidChangeConnectionStatus: Event<RemoteConnectionStatus> = this._onDidChangeConnectionStatus.event;

	private readonly _onDidReceiveChatCommand = new Emitter<{ peerId: string; message: string; commandId: string; }>();
	readonly onDidReceiveChatCommand: Event<{ peerId: string; message: string; commandId: string; }> = this._onDidReceiveChatCommand.event;

	private readonly _onDidUpdatePeers = new Emitter<RemotePeerInfo[]>();
	readonly onDidUpdatePeers: Event<RemotePeerInfo[]> = this._onDidUpdatePeers.event;

	private _acceptingConnections = false; // 默认关闭，需用户手动开启
	private readonly _onDidChangeAcceptingConnections = new Emitter<boolean>();
	readonly onDidChangeAcceptingConnections: Event<boolean> = this._onDidChangeAcceptingConnections.event;

	get connectionStatus(): RemoteConnectionStatus { return this._connectionStatus; }
	get connectedPeers(): RemotePeerInfo[] { return this._connectedPeers; } // 返回引用，React 侧在 hook 中 copy
	get deviceCode(): string { return this._deviceCode; }
	get deviceName(): string { return this._deviceName; }
	get acceptingConnections(): boolean { return this._acceptingConnections; }

	/** 是否有活跃的远程连接（快速检查，避免不必要的计算） */
	get hasActiveConnections(): boolean { return this._connections.size > 0; }

	// 增量同步追踪
	private _lastSyncedMessageCount: Map<string, number> = new Map();
	// 流式输出节流（使用 rAF 避免阻塞主线程渲染）
	private _streamSyncRAF: number | null = null;
	private _streamThrottleTimer: ReturnType<typeof setTimeout> | null = null;
	private _lastStreamSyncTime = 0;
	private static readonly STREAM_SYNC_MIN_INTERVAL = 150; // 最小 150ms 间隔（比渲染帧率低，绝不干扰 UI）
	// 异步任务队列（确保所有远程同步操作不阻塞主线程）
	private _asyncQueue: Promise<void> = Promise.resolve();

	constructor(
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
	) {
		super();
		this._signalingService = new SignalingService();
		this._localSignaling = new LocalSignalingService();

		// 从 localStorage 读取设备名称
		this._deviceName = localStorage.getItem('senweaver.device.name') || this._generateDeviceName();

		// 生成设备码
		const userId = this._getCurrentUserId();
		this._deviceCode = this._generateDeviceCode(userId);

		// 监听聊天流式状态变化 — 使用 rAF 延迟执行，绝不阻塞当前帧的渲染
		this._register(this._chatThreadService.onDidChangeStreamState(({ threadId }) => {
			// 快速 bail out：没有远程连接时立即返回，零开销
			if (this._connections.size === 0) return;
			this._scheduleStreamSync(threadId);
		}));

		// 监听线程切换 — 异步执行，不阻塞 UI
		this._register(this._chatThreadService.onDidChangeCurrentThread(() => {
			if (this._connections.size === 0) return;
			this._enqueueAsync(() => {
				const threadId = this._chatThreadService.state.currentThreadId;
				const thread = this._chatThreadService.state.allThreads[threadId];
				if (thread) {
					this._broadcastToAll({
						type: 'chat_thread_switch',
						threadId,
						threadName: `Thread ${threadId.slice(0, 8)}`,
					});
					this._sendFullChatStateAsync(threadId);
				}
			});
		}));
	}

	/**
	 * 将任务放入异步队列，确保顺序执行且不阻塞主线程
	 */
	private _enqueueAsync(task: () => void | Promise<void>): void {
		this._asyncQueue = this._asyncQueue.then(() => {
			return Promise.resolve().then(task);
		}).catch(err => {
			console.error('[RemoteCollab] 异步任务错误:', err);
		});
	}

	/**
	 * 使用 rAF 调度流式同步，确保在浏览器空闲时执行
	 */
	private _scheduleStreamSync(threadId: string): void {
		// 如果已有 rAF 排队，跳过（合并多次触发）
		if (this._streamSyncRAF !== null) return;

		this._streamSyncRAF = requestAnimationFrame(() => {
			this._streamSyncRAF = null;
			this._syncStreamStateToRemote(threadId);
		});
	}

	/**
	 * 初始化远程协作服务
	 */
	async initialize(): Promise<void> {
		this._setConnectionStatus('connecting');

		try {
			// 首先尝试 WebSocket 信令服务器
			await this._signalingService.connect(this._deviceCode);
			this._useLocalSignaling = false;

			this._signalingService.onMessage((msg) => this._handleSignalingMessage(msg));
			this._signalingService.onError((error) => {
				console.warn('[RemoteCollab] 信令服务器错误，降级到本地信令:', error);
				this._fallbackToLocalSignaling();
			});

		} catch (error) {
			console.warn('[RemoteCollab] WebSocket 信令不可用，使用本地信令:', error);
			this._fallbackToLocalSignaling();
		}

		// 启动心跳
		this._startHeartbeat();

		this._setConnectionStatus('disconnected'); // 信令就绪，但还没有 P2P 连接
	}

	/**
	 * 连接到远程设备
	 * 注意：每个 IDE 只允许连接一台远程设备，新连接会自动断开已有连接
	 */
	async connectToDevice(remoteDeviceCode: string): Promise<void> {
		if (remoteDeviceCode === this._deviceCode) {
			throw new Error('不能连接到自己');
		}

		// 检查是否已连接到目标设备
		if (this._connections.has(remoteDeviceCode)) {
			const existing = this._connections.get(remoteDeviceCode)!;
			if (existing.isConnected) {
				return; // 已经连接到该设备
			}
			existing.destroy();
			this._connections.delete(remoteDeviceCode);
		}

		// 单设备限制：断开所有已有连接，确保只有一台设备连接
		if (this._connections.size > 0) {
			console.log('[RemoteCollab] 单设备限制：断开已有连接，切换到新设备', remoteDeviceCode);
			this._disconnectAllSilent();
		}

		this._setConnectionStatus('connecting');

		const connection = new WebRTCConnection(
			this._deviceCode,
			remoteDeviceCode,
			(msg) => this._sendSignaling(remoteDeviceCode, msg),
		);

		connection.onMessage((data) => this._handleRemoteMessage(remoteDeviceCode, data));
		connection.onStateChange((state) => this._handleConnectionStateChange(remoteDeviceCode, state));

		this._connections.set(remoteDeviceCode, connection);

		// 创建 offer
		await connection.createOffer();
	}

	/**
	 * 断开与特定设备的连接
	 */
	disconnectFromDevice(peerId: string): void {
		const connection = this._connections.get(peerId);
		if (connection) {
			connection.send({ type: 'disconnect', reason: '用户主动断开' });
			connection.destroy();
			this._connections.delete(peerId);
			this._removePeer(peerId);
		}
	}

	/**
	 * 断开所有连接
	 */
	disconnectAll(): void {
		this._connections.forEach((conn, peerId) => {
			conn.send({ type: 'disconnect', reason: '用户主动断开' });
			conn.destroy();
		});
		this._connections.clear();
		this._connectedPeers = [];
		this._onDidUpdatePeers.fire([]);
		this._setConnectionStatus('disconnected');
	}

	/**
	 * 设置是否接受远程连接
	 * true: 开启，允许 App 通过设备码连接
	 * false: 关闭，拒绝所有新连接，并断开已有连接
	 */
	setAcceptingConnections(accepting: boolean): void {
		if (this._acceptingConnections === accepting) return;
		this._acceptingConnections = accepting;
		this._onDidChangeAcceptingConnections.fire(accepting);
		console.log('[RemoteCollab] 远程连接开关:', accepting ? '已开启' : '已关闭');

		if (!accepting) {
			// 关闭时断开所有已有连接
			if (this._connections.size > 0) {
				this.disconnectAll();
			}
		} else {
			// 开启时自动初始化信令服务（如果尚未初始化）
			if (!this._deviceCode) {
				this.initialize().catch(err => {
					console.warn('[RemoteCollab] 开启时初始化失败:', err);
				});
			}
		}
	}

	/**
	 * 内部方法：断开所有已有连接但不改变连接状态
	 * 用于单设备限制场景：切换到新设备前清理旧连接
	 */
	private _disconnectAllSilent(): void {
		this._connections.forEach((conn, peerId) => {
			conn.send({ type: 'disconnect', reason: '已有新设备连入，当前连接被断开（单设备限制）' });
			conn.destroy();
		});
		this._connections.clear();
		this._connectedPeers = [];
		this._onDidUpdatePeers.fire([]);
	}

	/**
	 * 发送聊天页面快照
	 */
	sendChatSnapshot(html: string): void {
		// 避免发送相同的快照
		if (html === this._lastSnapshotHtml) return;
		this._lastSnapshotHtml = html;

		this._broadcastToAll({
			type: 'chat_screen_snapshot',
			html,
			timestamp: Date.now(),
		});
	}

	/**
	 * 发送聊天状态更新（完整状态）
	 */
	sendChatStateUpdate(threadId: string, messages: any[], streamState: any): void {
		this._broadcastToAll({
			type: 'chat_state_full',
			threadId,
			messages,
			streamState,
			totalMessages: messages.length,
		});
	}

	/**
	 * 发送命令执行确认
	 */
	sendCommandAck(peerId: string, commandId: string, status: 'received' | 'executing' | 'completed' | 'error', detail?: string): void {
		const conn = this._connections.get(peerId);
		if (conn) {
			conn.send({
				type: 'chat_command_ack',
				commandId,
				status,
				detail,
			});
		}
	}

	/**
	 * 发送完整状态给所有远端（异步）
	 */
	sendFullStateToAll(): void {
		const threadId = this._chatThreadService.state.currentThreadId;
		this._sendFullChatStateAsync(threadId);
	}

	/**
	 * 设置自定义信令服务器地址
	 */
	setSignalingUrl(url: string): void {
		localStorage.setItem('senweaver.signaling.url', url);
	}

	/**
	 * 销毁服务
	 */
	destroy(): void {
		this.disconnectAll();
		this._stopHeartbeat();
		this._stopSnapshotSync();
		this._signalingService.destroy();
		this._localSignaling.destroy();

		// 清理异步任务
		if (this._streamSyncRAF !== null) {
			cancelAnimationFrame(this._streamSyncRAF);
			this._streamSyncRAF = null;
		}
		if (this._streamThrottleTimer) {
			clearTimeout(this._streamThrottleTimer);
			this._streamThrottleTimer = null;
		}
	}

	// ==================== 私有方法 ====================

	private _setConnectionStatus(status: RemoteConnectionStatus): void {
		if (this._connectionStatus !== status) {
			this._connectionStatus = status;
			this._onDidChangeConnectionStatus.fire(status);
		}
	}

	private _fallbackToLocalSignaling(): void {
		this._useLocalSignaling = true;
		this._localSignaling.connect(this._deviceCode);
		this._localSignaling.onMessage((msg) => this._handleSignalingMessage(msg));
	}

	private _sendSignaling(targetDeviceCode: string, msg: SignalingMessage): void {
		if (this._useLocalSignaling) {
			this._localSignaling.send(targetDeviceCode, msg);
		} else {
			this._signalingService.send(targetDeviceCode, msg);
		}
	}

	/**
	 * 处理信令消息
	 */
	private async _handleSignalingMessage(msg: SignalingMessage): Promise<void> {
		const { from, type, data } = msg;

		switch (type) {
			case 'offer': {
				// 检查是否允许接受连接
				if (!this._acceptingConnections) {
					console.log('[RemoteCollab] 远程连接未开启，拒绝来自', from, '的连接请求');
					// 通知对方连接被拒绝（通过信令返回一个自定义消息，对方收不到 answer 会超时）
					return;
				}
				// 收到连接请求，创建 answer
				// 单设备限制：断开所有已有连接（来自其他设备的），只允许一台设备连接
				if (this._connections.size > 0) {
					// 如果已有到同一设备的连接，只清理该连接
					// 如果是来自不同设备的连接，先断开所有已有连接
					const existingFromSameDevice = this._connections.get(from);
					if (existingFromSameDevice) {
						existingFromSameDevice.destroy();
						this._connections.delete(from);
					}
					// 断开来自其他设备的连接
					if (this._connections.size > 0) {
						console.log('[RemoteCollab] 单设备限制：新设备连入，断开已有连接', from);
						this._disconnectAllSilent();
					}
				}

				const connection = new WebRTCConnection(
					this._deviceCode,
					from,
					(sigMsg) => this._sendSignaling(from, sigMsg),
				);

				connection.onMessage((data) => this._handleRemoteMessage(from, data));
				connection.onStateChange((state) => this._handleConnectionStateChange(from, state));

				this._connections.set(from, connection);
				await connection.handleOffer(data);
				break;
			}

			case 'answer': {
				const connection = this._connections.get(from);
				if (connection) {
					await connection.handleAnswer(data);
				}
				break;
			}

			case 'ice-candidate': {
				const connection = this._connections.get(from);
				if (connection) {
					await connection.handleIceCandidate(data);
				}
				break;
			}
		}
	}

	/**
	 * 处理 WebRTC 连接状态变化
	 */
	private _handleConnectionStateChange(peerId: string, state: RTCPeerConnectionState): void {
		if (state === 'connected') {
			// P2P 连接建立成功，发送握手
			const conn = this._connections.get(peerId);
			if (conn) {
				conn.send({
					type: 'handshake',
					deviceCode: this._deviceCode,
					deviceName: this._deviceName,
				});
			}
			this._setConnectionStatus('connected');

			// 启动聊天快照同步
			this._startSnapshotSync();
		} else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
			this._removePeer(peerId);
			const connection = this._connections.get(peerId);
			if (connection) {
				connection.destroy();
				this._connections.delete(peerId);
			}

			if (this._connections.size === 0) {
				this._setConnectionStatus('disconnected');
				this._stopSnapshotSync();
			}
		}
	}

	/**
	 * 处理远端发来的消息
	 * 轻量消息（ping/pong/ack）直接处理，重操作（握手状态同步、指令执行）异步延迟
	 */
	private _handleRemoteMessage(peerId: string, data: RemoteMessageType): void {
		switch (data.type) {
			// ---- 轻量消息：立即处理（O(1) 操作，不阻塞） ----

			case 'ping': {
				const conn = this._connections.get(peerId);
				if (conn) {
					conn.send({ type: 'pong', timestamp: data.timestamp });
				}
				break;
			}

			case 'pong': {
				// 仅记录日志，几乎零开销
				const latency = Date.now() - data.timestamp;
				console.log(`[RemoteCollab] 与 ${peerId} 的延迟: ${latency}ms`);
				break;
			}

			case 'chat_command_ack': {
				console.log('[RemoteCollab] 收到命令确认:', data.commandId, data.status, data.detail);
				break;
			}

			case 'disconnect': {
				console.log('[RemoteCollab] 远端断开连接:', data.reason);
				this._removePeer(peerId);
				const conn = this._connections.get(peerId);
				if (conn) {
					conn.destroy();
					this._connections.delete(peerId);
				}
				if (this._connections.size === 0) {
					this._setConnectionStatus('disconnected');
				}
				break;
			}

			// ---- 重操作：异步延迟处理，防止 DataChannel onmessage 阻塞 ----

			case 'handshake': {
				// 先做轻量的状态更新（同步、O(1)）
				this._addPeer({
					peerId,
					deviceCode: data.deviceCode,
					deviceName: data.deviceName,
					status: 'online',
					connectedAt: Date.now(),
				});

				// 回复 ack（轻量发送，O(1)）
				const conn = this._connections.get(peerId);
				if (conn) {
					conn.send({
						type: 'handshake_ack',
						deviceCode: this._deviceCode,
						deviceName: this._deviceName,
					});
				}

				// 重操作（全状态同步）延迟到下一个微任务
				setTimeout(() => {
					const currentThreadId = this._chatThreadService.state.currentThreadId;
					this._broadcastToAll({
						type: 'chat_thread_switch',
						threadId: currentThreadId,
						threadName: `Thread ${currentThreadId.slice(0, 8)}`,
					});
					this._sendFullChatStateAsync(currentThreadId, peerId);
				}, 0);
				break;
			}

			case 'handshake_ack': {
				this._addPeer({
					peerId,
					deviceCode: data.deviceCode,
					deviceName: data.deviceName,
					status: 'online',
					connectedAt: Date.now(),
				});

				// 全状态同步延迟
				setTimeout(() => {
					const threadId = this._chatThreadService.state.currentThreadId;
					this._sendFullChatStateAsync(threadId, peerId);
				}, 0);
				break;
			}

			case 'request_full_state': {
				// 全状态同步延迟
				setTimeout(() => {
					const tid = this._chatThreadService.state.currentThreadId;
					this._sendFullChatStateAsync(tid, peerId);
				}, 0);
				break;
			}

			case 'chat_command': {
				// 发送接收确认（轻量，O(1)）
				this.sendCommandAck(peerId, data.commandId, 'received');

				// 触发事件
				this._onDidReceiveChatCommand.fire({
					peerId,
					message: data.message,
					commandId: data.commandId,
				});

				// 指令执行是重操作 — 通过串行队列异步执行，防止并发竞争
				this._enqueueAsync(() => this._executeChatCommand(peerId, data.message, data.commandId));
				break;
			}
		}
	}

	/**
	 * 执行远端发来的聊天指令
	 */
	private async _executeChatCommand(peerId: string, message: string, commandId: string): Promise<void> {
		try {
			this.sendCommandAck(peerId, commandId, 'executing');

			const threadId = this._chatThreadService.state.currentThreadId;
			const thread = this._chatThreadService.state.allThreads[threadId];
			if (!thread) {
				this.sendCommandAck(peerId, commandId, 'error', '没有活跃的聊天线程');
				return;
			}

			// 检查当前是否有正在运行的任务
			const streamState = this._chatThreadService.streamState[threadId];
			if (streamState?.isRunning && streamState.isRunning !== 'idle') {
				// 等待当前任务完成
				this.sendCommandAck(peerId, commandId, 'executing', '等待当前任务完成...');
				await this._chatThreadService.abortRunning(threadId);
				// 等待一小段时间确保状态更新
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			// 发送消息给助手
			await this._chatThreadService.addUserMessageAndStreamResponse({
				userMessage: message,
				displayMessage: `[远程] ${message}`,
				threadId,
			});

			this.sendCommandAck(peerId, commandId, 'completed');

		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			this.sendCommandAck(peerId, commandId, 'error', errMsg);
			console.error('[RemoteCollab] 执行远程指令失败:', error);
		}
	}

	/**
	 * 将 ChatMessage 转换为远程传输格式
	 * 使用 try-catch 保护，确保任何异常数据都不会阻塞调用方
	 */
	private _convertMessage(msg: any): RemoteChatMessage {
		try {
			const role = msg?.role || 'user';
			const result: RemoteChatMessage = {
				role,
				content: '',
				timestamp: Date.now(),
			};

			if (role === 'user') {
				result.content = typeof msg.content === 'string' ? msg.content : '';
				result.displayContent = typeof msg.displayContent === 'string' ? msg.displayContent : result.content;
				result.isRemote = typeof result.displayContent === 'string' && result.displayContent.startsWith('[远程]');
			} else if (role === 'assistant') {
				result.content = typeof msg.displayContent === 'string' ? msg.displayContent : '';
				result.displayContent = result.content;
				result.reasoning = typeof msg.reasoning === 'string' ? msg.reasoning : '';
			} else if (role === 'tool') {
				result.content = typeof msg.content === 'string' ? msg.content : '';
				result.type = typeof msg.type === 'string' ? msg.type : '';
				result.toolName = typeof msg.name === 'string' ? msg.name : '';
			}

			return result;
		} catch (e) {
			// 返回安全的空消息，绝不抛出
			return { role: 'user', content: '[消息转换失败]', timestamp: Date.now() };
		}
	}

	/**
	 * 构建远程流式状态
	 * 使用 try-catch 保护，确保不会因为意外的 streamState 结构抛出异常
	 */
	private _buildRemoteStreamState(threadId: string): RemoteStreamState | null {
		try {
			const streamState = this._chatThreadService.streamState[threadId];
			if (!streamState) return null;

			return {
				isRunning: streamState.isRunning ?? undefined,
				displayContentSoFar: streamState.isRunning === 'LLM' && streamState.llmInfo
					? streamState.llmInfo.displayContentSoFar  // 不截断，保留完整内容
					: undefined,
				reasoningSoFar: streamState.isRunning === 'LLM' && streamState.llmInfo
					? streamState.llmInfo.reasoningSoFar
					: undefined,
				toolName: streamState.isRunning === 'tool' && streamState.toolInfo
					? streamState.toolInfo.toolName
					: undefined,
				toolContent: streamState.isRunning === 'tool' && streamState.toolInfo
					? streamState.toolInfo.content
					: undefined,
				errorMessage: streamState.error?.message,
			};
		} catch (e) {
			console.error('[RemoteCollab] 构建流式状态失败:', e);
			return null;
		}
	}

	/**
	 * 发送完整聊天状态（异步版本，用于事件回调中）
	 */
	private _sendFullChatStateAsync(threadId: string, targetPeerId?: string): void {
		this._enqueueAsync(() => this._sendFullChatState(threadId, targetPeerId));
	}

	/**
	 * 发送完整聊天状态（首次连接/线程切换时使用）
	 * 使用分批处理避免阻塞主线程
	 */
	private _sendFullChatState(threadId: string, targetPeerId?: string): void {
		const thread = this._chatThreadService.state.allThreads[threadId];
		if (!thread) return;

		const totalMessages = thread.messages.length;

		// 对大对话分批转换消息，避免同步遍历几百条消息阻塞主线程
		// 100 条以下直接处理（<1ms），100 条以上分批
		const BATCH_SIZE = 100;

		if (totalMessages <= BATCH_SIZE) {
			// 小对话：直接处理
			const messages = thread.messages.map(msg => this._convertMessage(msg));
			this._doSendFullState(threadId, messages, totalMessages, targetPeerId);
		} else {
			// 大对话：异步分批处理
			const allMessages: RemoteChatMessage[] = [];
			let processed = 0;

			const processBatch = () => {
				const end = Math.min(processed + BATCH_SIZE, totalMessages);
				for (let i = processed; i < end; i++) {
					allMessages.push(this._convertMessage(thread.messages[i]));
				}
				processed = end;

				if (processed < totalMessages) {
					// 还有剩余，下一帧继续
					setTimeout(processBatch, 0);
				} else {
					// 全部完成，发送
					this._doSendFullState(threadId, allMessages, totalMessages, targetPeerId);
				}
			};
			processBatch();
		}
	}

	private _doSendFullState(threadId: string, messages: RemoteChatMessage[], totalMessages: number, targetPeerId?: string): void {
		const streamState = this._buildRemoteStreamState(threadId);

		const data: RemoteMessageType = {
			type: 'chat_state_full',
			threadId,
			messages,
			streamState,
			totalMessages,
		};

		if (targetPeerId) {
			const conn = this._connections.get(targetPeerId);
			if (conn?.isConnected) {
				conn.send(data);
			}
		} else {
			this._broadcastToAll(data);
		}

		this._lastSyncedMessageCount.set(threadId, totalMessages);
	}

	/**
	 * 实时同步流式状态（节流 + 全异步，绝不阻塞 UI 渲染）
	 *
	 * 性能保证：
	 * 1. 已在 rAF 回调中执行（_scheduleStreamSync），不占用当前帧
	 * 2. 最小 150ms 间隔节流，远低于 60fps 渲染频率
	 * 3. 消息转换和发送都通过 setTimeout(0) 异步化
	 * 4. 没有远程连接时在入口处 bail out（零开销）
	 */
	private _syncStreamStateToRemote(threadId: string): void {
		// 二次 bail out（第一次在事件监听器中）
		if (this._connections.size === 0) return;

		const thread = this._chatThreadService.state.allThreads[threadId];
		if (!thread) return;

		const now = Date.now();

		// 检查是否有新消息（增量同步）
		const lastCount = this._lastSyncedMessageCount.get(threadId) || 0;
		const currentCount = thread.messages.length;

		if (currentCount > lastCount) {
			// 有新消息 — 异步转换和发送，不阻塞当前帧
			const newMsgs = thread.messages.slice(lastCount);
			this._lastSyncedMessageCount.set(threadId, currentCount);
			this._lastStreamSyncTime = now;

			// 异步处理消息转换和发送
			setTimeout(() => {
				const converted = newMsgs.map(msg => this._convertMessage(msg));
				const streamState = this._buildRemoteStreamState(threadId);
				this._broadcastToAll({
					type: 'chat_state_delta',
					threadId,
					newMessages: converted,
					streamState,
					fromIndex: lastCount,
				});
			}, 0);
			return;
		}

		// 流式输出状态更新（节流：至少 150ms 间隔）
		const streamState = this._buildRemoteStreamState(threadId);

		if (streamState && streamState.isRunning === 'LLM') {
			const elapsed = now - this._lastStreamSyncTime;
			if (elapsed >= RemoteCollaborationService.STREAM_SYNC_MIN_INTERVAL) {
				this._lastStreamSyncTime = now;
				// 异步发送，不阻塞
				setTimeout(() => {
					this._broadcastToAll({
						type: 'chat_stream_chunk',
						threadId,
						streamState,
					});
				}, 0);
			} else if (!this._streamThrottleTimer) {
				// 延迟发送（在节流间隔结束后）
				this._streamThrottleTimer = setTimeout(() => {
					this._streamThrottleTimer = null;
					const latestStreamState = this._buildRemoteStreamState(threadId);
					if (latestStreamState && this._connections.size > 0) {
						this._broadcastToAll({
							type: 'chat_stream_chunk',
							threadId,
							streamState: latestStreamState,
						});
					}
					this._lastStreamSyncTime = Date.now();
				}, RemoteCollaborationService.STREAM_SYNC_MIN_INTERVAL - elapsed);
			}
			return;
		}

		// 其他状态变化（工具执行完成、错误等）— 异步发送
		if (streamState) {
			this._lastStreamSyncTime = now;
			setTimeout(() => {
				this._broadcastToAll({
					type: 'chat_stream_chunk',
					threadId,
					streamState,
				});
			}, 0);
		}
	}

	/**
	 * 启动聊天快照定时同步（按需开启，使用 rAF 避免阻塞）
	 * 注意：仅在远端明确请求快照时才启用，默认使用结构化数据同步
	 */
	private _startSnapshotSync(): void {
		// 默认不启用 HTML 快照同步
		// 结构化数据同步（chat_state_full/delta/stream_chunk）已经足够远端渲染
		// HTML 快照会触发 DOM reflow，影响主线程性能
	}

	private _stopSnapshotSync(): void {
		if (this._chatSnapshotTimer) {
			clearInterval(this._chatSnapshotTimer);
			this._chatSnapshotTimer = null;
		}
	}

	/**
	 * 心跳检测
	 */
	private _startHeartbeat(): void {
		this._heartbeatTimer = setInterval(() => {
			this._connections.forEach((conn, peerId) => {
				if (conn.isConnected) {
					conn.send({ type: 'ping', timestamp: Date.now() });
				}
			});
		}, 30000); // 每 30 秒
	}

	private _stopHeartbeat(): void {
		if (this._heartbeatTimer) {
			clearInterval(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}
	}

	private _addPeer(peer: RemotePeerInfo): void {
		const existing = this._connectedPeers.findIndex(p => p.peerId === peer.peerId);
		if (existing >= 0) {
			this._connectedPeers[existing] = peer;
		} else {
			this._connectedPeers.push(peer);
		}
		this._onDidUpdatePeers.fire([...this._connectedPeers]);
	}

	private _removePeer(peerId: string): void {
		this._connectedPeers = this._connectedPeers.filter(p => p.peerId !== peerId);
		this._onDidUpdatePeers.fire([...this._connectedPeers]);
	}

	/**
	 * 广播消息给所有已连接的远端
	 * 对大消息预先序列化一次，避免 N 次重复 JSON.stringify 阻塞主线程
	 */
	private _broadcastToAll(data: RemoteMessageType): void {
		const activeConns: WebRTCConnection[] = [];
		this._connections.forEach((conn) => {
			if (conn.isConnected) {
				activeConns.push(conn);
			}
		});
		if (activeConns.length === 0) return;

		// 只有一个连接时直接发，避免额外开销
		if (activeConns.length === 1) {
			activeConns[0].send(data);
			return;
		}

		// 多连接时，预先序列化一次，所有连接共享同一 JSON 字符串
		// 这里调用 sendPreSerialized 避免每个 peer 重复 stringify
		try {
			const json = JSON.stringify(data);
			for (const conn of activeConns) {
				conn.sendPreSerialized(json);
			}
		} catch (e) {
			console.error('[RemoteCollab] 广播序列化失败:', e);
		}
	}

	// ==================== 辅助方法 ====================

	private _getCurrentUserId(): string {
		const storageKey = 'senweaver.user.id';
		let userId = localStorage.getItem(storageKey);
		if (!userId) {
			userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			localStorage.setItem(storageKey, userId);
		}
		return userId;
	}

	private _generateDeviceCode(userId: string): string {
		let hash = 0;
		for (let i = 0; i < userId.length; i++) {
			const char = userId.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		const positiveHash = Math.abs(hash);
		return ((positiveHash % 90000000) + 10000000).toString();
	}

	private _generateDeviceName(): string {
		const platform = navigator.platform || 'Unknown';
		const name = `SenWeaver-${platform}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
		localStorage.setItem('senweaver.device.name', name);
		return name;
	}
}

registerSingleton(IRemoteCollaborationService, RemoteCollaborationService, InstantiationType.Delayed);
