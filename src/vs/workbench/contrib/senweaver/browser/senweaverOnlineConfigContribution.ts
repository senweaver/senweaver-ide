/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import type { ProviderName } from '../common/senweaverSettingsTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ISenweaverUpdateService } from '../common/senweaverUpdateService.js';

// Context Key 用于控制"新版本更新后重启"按钮的显示
export const SENWEAVER_HAS_UPDATE_CONTEXT_KEY = new RawContextKey<boolean>('senweaver.hasUpdate', false);

// 下载状态管理
interface DownloadStatus {
	downloading: boolean;
	downloaded: boolean;
	filePath?: string;
	error?: string;
}

// 全局下载状态，可以被其他模块访问
export let senweaverUpdateDownloadStatus: DownloadStatus = {
	downloading: false,
	downloaded: false
};

// ownProvider 模型访问权限状态
export interface ModelAccessStatus {
	enabled: boolean;      // 是否允许使用模型
	used: number;          // 当前已用次数
	limit: number;         // 总限制次数
	reason: string | null; // 被禁用时的原因
}

// 全局 model_access 状态，用于控制 ownProvider 模型的访问
export let ownProviderModelAccess: ModelAccessStatus = {
	enabled: true,  // 默认允许使用
	used: 0,
	limit: 0,
	reason: null
};

// 全局 WebSocket 实例引用，用于其他模块发送消息
let globalWebSocket: WebSocket | null = null;

// 设置全局 WebSocket 实例（由 SenweaverOnlineConfigContribution 调用）
export function setGlobalWebSocket(ws: WebSocket | null): void {
	globalWebSocket = ws;
}

// 通过 WebSocket 发送模型使用记录
export function sendModelUsageReport(userId: string, modelName: string, inc: number = 1): boolean {
	if (!globalWebSocket || globalWebSocket.readyState !== WebSocket.OPEN) {
		console.warn(`[WebSocket] ⚠️ WebSocket 未连接，无法发送使用记录`);
		return false;
	}

	const message = {
		type: 'model_usage_report',
		user_id: userId,
		model_name: modelName,
		inc: inc
	};

	try {
		globalWebSocket.send(JSON.stringify(message));
		return true;
	} catch (error) {
		console.error(`[WebSocket] ❌ 发送使用记录失败:`, error);
		return false;
	}
}

// 更新 model_access 状态
export function updateModelAccess(access: ModelAccessStatus): void {
	ownProviderModelAccess = { ...access };
}

// 检查 ownProvider 模型是否可用
export function isOwnProviderEnabled(): boolean {
	const enabled = ownProviderModelAccess.enabled;
	return enabled;
}

// 获取 ownProvider 模型访问状态
export function getOwnProviderModelAccess(): ModelAccessStatus {
	return { ...ownProviderModelAccess };
}

function maskKey(key: string | null | undefined): string {
	if (!key) return '<empty>';
	if (key === DISABLED_MARKER) return 'DISABLED';
	const trimmed = String(key);
	if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
	return `${trimmed.slice(0, 2)}…${trimmed.slice(-4)}`;
}

// MD5 哈希函数（用于生成 auth 认证字符串）
function md5(string: string): string {
	function md5cycle(x: number[], k: number[]) {
		let a = x[0], b = x[1], c = x[2], d = x[3];

		a = ff(a, b, c, d, k[0], 7, -680876936);
		d = ff(d, a, b, c, k[1], 12, -389564586);
		c = ff(c, d, a, b, k[2], 17, 606105819);
		b = ff(b, c, d, a, k[3], 22, -1044525330);
		a = ff(a, b, c, d, k[4], 7, -176418897);
		d = ff(d, a, b, c, k[5], 12, 1200080426);
		c = ff(c, d, a, b, k[6], 17, -1473231341);
		b = ff(b, c, d, a, k[7], 22, -45705983);
		a = ff(a, b, c, d, k[8], 7, 1770035416);
		d = ff(d, a, b, c, k[9], 12, -1958414417);
		c = ff(c, d, a, b, k[10], 17, -42063);
		b = ff(b, c, d, a, k[11], 22, -1990404162);
		a = ff(a, b, c, d, k[12], 7, 1804603682);
		d = ff(d, a, b, c, k[13], 12, -40341101);
		c = ff(c, d, a, b, k[14], 17, -1502002290);
		b = ff(b, c, d, a, k[15], 22, 1236535329);

		a = gg(a, b, c, d, k[1], 5, -165796510);
		d = gg(d, a, b, c, k[6], 9, -1069501632);
		c = gg(c, d, a, b, k[11], 14, 643717713);
		b = gg(b, c, d, a, k[0], 20, -373897302);
		a = gg(a, b, c, d, k[5], 5, -701558691);
		d = gg(d, a, b, c, k[10], 9, 38016083);
		c = gg(c, d, a, b, k[15], 14, -660478335);
		b = gg(b, c, d, a, k[4], 20, -405537848);
		a = gg(a, b, c, d, k[9], 5, 568446438);
		d = gg(d, a, b, c, k[14], 9, -1019803690);
		c = gg(c, d, a, b, k[3], 14, -187363961);
		b = gg(b, c, d, a, k[8], 20, 1163531501);
		a = gg(a, b, c, d, k[13], 5, -1444681467);
		d = gg(d, a, b, c, k[2], 9, -51403784);
		c = gg(c, d, a, b, k[7], 14, 1735328473);
		b = gg(b, c, d, a, k[12], 20, -1926607734);

		a = hh(a, b, c, d, k[5], 4, -378558);
		d = hh(d, a, b, c, k[8], 11, -2022574463);
		c = hh(c, d, a, b, k[11], 16, 1839030562);
		b = hh(b, c, d, a, k[14], 23, -35309556);
		a = hh(a, b, c, d, k[1], 4, -1530992060);
		d = hh(d, a, b, c, k[4], 11, 1272893353);
		c = hh(c, d, a, b, k[7], 16, -155497632);
		b = hh(b, c, d, a, k[10], 23, -1094730640);
		a = hh(a, b, c, d, k[13], 4, 681279174);
		d = hh(d, a, b, c, k[0], 11, -358537222);
		c = hh(c, d, a, b, k[3], 16, -722521979);
		b = hh(b, c, d, a, k[6], 23, 76029189);
		a = hh(a, b, c, d, k[9], 4, -640364487);
		d = hh(d, a, b, c, k[12], 11, -421815835);
		c = hh(c, d, a, b, k[15], 16, 530742520);
		b = hh(b, c, d, a, k[2], 23, -995338651);

		a = ii(a, b, c, d, k[0], 6, -198630844);
		d = ii(d, a, b, c, k[7], 10, 1126891415);
		c = ii(c, d, a, b, k[14], 15, -1416354905);
		b = ii(b, c, d, a, k[5], 21, -57434055);
		a = ii(a, b, c, d, k[12], 6, 1700485571);
		d = ii(d, a, b, c, k[3], 10, -1894986606);
		c = ii(c, d, a, b, k[10], 15, -1051523);
		b = ii(b, c, d, a, k[1], 21, -2054922799);
		a = ii(a, b, c, d, k[8], 6, 1873313359);
		d = ii(d, a, b, c, k[15], 10, -30611744);
		c = ii(c, d, a, b, k[6], 15, -1560198380);
		b = ii(b, c, d, a, k[13], 21, 1309151649);
		a = ii(a, b, c, d, k[4], 6, -145523070);
		d = ii(d, a, b, c, k[11], 10, -1120210379);
		c = ii(c, d, a, b, k[2], 15, 718787259);
		b = ii(b, c, d, a, k[9], 21, -343485551);

		x[0] = add32(a, x[0]);
		x[1] = add32(b, x[1]);
		x[2] = add32(c, x[2]);
		x[3] = add32(d, x[3]);
	}

	function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
		a = add32(add32(a, q), add32(x, t));
		return add32((a << s) | (a >>> (32 - s)), b);
	}

	function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn((b & c) | ((~b) & d), a, b, x, s, t);
	}

	function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn((b & d) | (c & (~d)), a, b, x, s, t);
	}

	function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn(b ^ c ^ d, a, b, x, s, t);
	}

	function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn(c ^ (b | (~d)), a, b, x, s, t);
	}

	function md51(s: string) {
		const n = s.length;
		const state = [1732584193, -271733879, -1732584194, 271733878];
		let i;
		for (i = 64; i <= s.length; i += 64) {
			md5cycle(state, md5blk(s.substring(i - 64, i)));
		}
		s = s.substring(i - 64);
		const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		for (i = 0; i < s.length; i++)
			tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
		tail[i >> 2] |= 0x80 << ((i % 4) << 3);
		if (i > 55) {
			md5cycle(state, tail);
			for (i = 0; i < 16; i++) tail[i] = 0;
		}
		tail[14] = n * 8;
		md5cycle(state, tail);
		return state;
	}

	function md5blk(s: string) {
		const md5blks = [];
		for (let i = 0; i < 64; i += 4) {
			md5blks[i >> 2] = s.charCodeAt(i)
				+ (s.charCodeAt(i + 1) << 8)
				+ (s.charCodeAt(i + 2) << 16)
				+ (s.charCodeAt(i + 3) << 24);
		}
		return md5blks;
	}

	const hex_chr = '0123456789abcdef'.split('');

	function rhex(n: number) {
		let s = '';
		for (let j = 0; j < 4; j++)
			s += hex_chr[(n >> (j * 8 + 4)) & 0x0F]
				+ hex_chr[(n >> (j * 8)) & 0x0F];
		return s;
	}

	function hex(x: number[]) {
		for (let i = 0; i < x.length; i++)
			x[i] = rhex(x[i]) as unknown as number;
		return (x as unknown as string[]).join('');
	}

	function add32(a: number, b: number) {
		return (a + b) & 0xFFFFFFFF;
	}

	return hex(md51(string));
}

// 生成 WebSocket 认证字符串
// 原始字符串 = 10位时间戳 + 用户ID + 固定字符串 + 类型（heartbeat/connection）
// auth = md5(原始字符串)
function generateAuth(userId: string, type: 'heartbeat' | 'connection' | 'init', secretKey: string): string {
	const timestamp = Math.floor(Date.now() / 1000).toString(); // 10位时间戳
	const rawString = timestamp + userId + secretKey + type;
	return md5(rawString);
}

// 获取当前10位时间戳
function getTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

// 生成基于电脑唯一标识的用户ID
function generateUserID(): string {
	const storageKey = 'senweaver.user.id';
	let userId = localStorage.getItem(storageKey);

	if (!userId) {
		// 基于系统信息生成唯一ID
		const systemInfo = {
			platform: isWindows ? 'win' : isMacintosh ? 'mac' : isLinux ? 'linux' : 'unknown',
			userAgent: navigator.userAgent,
			timestamp: Date.now(),
			random: Math.random()
		};

		// 生成基础UUID并结合系统信息
		const baseId = generateUuid();
		const hash = btoa(JSON.stringify(systemInfo)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
		userId = `${baseId.substring(0, 8)}-${hash}`;

		localStorage.setItem(storageKey, userId);
	}

	return userId;
}

// 获取当前用户ID
function getCurrentUserID(): string {
	return generateUserID();
}

// WebSocket消息类型定义
// 服务器发送的配置格式
interface ServerModelProvider {
	api_key: string;
	base_url: string;
}

interface ServerModelProviders {
	[key: string]: ServerModelProvider;
}

// 客户端发送的配置格式（用于心跳包和初始化）
interface ClientModelProvider {
	api_key: string;
	base_url: string;
}

interface ClientModelProviders {
	[key: string]: ClientModelProvider;
}

interface WSConnectionMessage {
	type: 'connection';
	message: string;
	client_id: string;
	version: string;
	timestamp: string;
	model_providers: ServerModelProviders;
	model_access?: ModelAccessStatus; // 模型访问权限状态（可选）
}

interface WSHeartbeatMessage {
	type: 'heartbeat';
	version?: string;
	timestamp: string;
}

interface WSModelConfigUpdateMessage {
	type: 'model_config_update';
	timestamp: string;
	model_providers: ServerModelProviders;
}

interface WSErrorMessage {
	type: 'error';
	message: string;
	code?: string;
	timestamp?: string;
}

// model_access 状态更新消息（服务器推送）
interface WSModelAccessUpdateMessage {
	type: 'model_access_update';
	enabled: boolean;      // 最新状态
	used: number;          // 已使用次数
	limit: number;         // 总限制次数
	reason: string | null; // 禁用原因
	timestamp: string;
}

// 有效的提供商名称类型
type ValidProviderName = 'aliBailian' | 'zAi' | 'moonshotAi' | 'ownProvider' | 'anthropic' | 'openAI' | 'deepseek' | 'ollama' | 'vLLM' | 'openRouter' | 'openAICompatible' | 'gemini' | 'groq' | 'xAI' | 'mistral' | 'lmStudio' | 'liteLLM' | 'googleVertex' | 'microsoftAzure' | 'awsBedrock';

// 服务器端到客户端的提供商名称映射（处理命名差异）
const serverToClientProviderNameMap: Record<string, ValidProviderName> = {
	// aliBailian
	'alibailian': 'aliBailian',
	'aliBailian': 'aliBailian',
	// zAi
	'zai': 'zAi',
	'zAi': 'zAi',
	// moonshotAi
	'moonshotai': 'moonshotAi',
	'moonshotAi': 'moonshotAi',
	// ownProvider
	'ownprovider': 'ownProvider',
	'ownProvider': 'ownProvider',
	// openRouter
	'openrouter': 'openRouter',
	'openRouter': 'openRouter',
	// openAI
	'openai': 'openAI',
	'openAI': 'openAI',
	// openAICompatible
	'openaicompatible': 'openAICompatible',
	'openAICompatible': 'openAICompatible',
	// xAI
	'xai': 'xAI',
	'xAI': 'xAI',
	// vLLM
	'vllm': 'vLLM',
	'vLLM': 'vLLM',
	// lmStudio
	'lmstudio': 'lmStudio',
	'lmStudio': 'lmStudio',
	// liteLLM
	'litellm': 'liteLLM',
	'liteLLM': 'liteLLM',
	// googleVertex
	'googlevertex': 'googleVertex',
	'googleVertex': 'googleVertex',
	// microsoftAzure
	'microsoftazure': 'microsoftAzure',
	'microsoftAzure': 'microsoftAzure',
	// awsBedrock
	'awsbedrock': 'awsBedrock',
	'awsBedrock': 'awsBedrock',
};

// 标准化提供商名称（将服务器端命名转换为客户端命名）
function normalizeProviderName(serverName: string): ValidProviderName | null {
	// 先尝试直接映射
	if (serverToClientProviderNameMap[serverName]) {
		const normalized = serverToClientProviderNameMap[serverName];
		return normalized;
	}

	// 如果已经是有效名称，直接返回
	if (isValidProviderName(serverName)) {
		return serverName;
	}

	console.warn(`❌ [名称映射] 无效的提供商名称: "${serverName}"`);
	return null;
}

// 验证是否是有效的提供商名称
function isValidProviderName(name: string): name is ValidProviderName {
	const validNames: ValidProviderName[] = ['aliBailian', 'zAi', 'moonshotAi', 'ownProvider', 'anthropic', 'openAI', 'deepseek', 'ollama', 'vLLM', 'openRouter', 'openAICompatible', 'gemini', 'groq', 'xAI', 'mistral', 'lmStudio', 'liteLLM', 'googleVertex', 'microsoftAzure', 'awsBedrock'];
	return validNames.includes(name as ValidProviderName);
}

// 特殊标记：表示提供商被禁用
const DISABLED_MARKER = 'DISABLED';

// 应用模型配置到设置（处理服务器发送的简化格式）
async function applyModelConfig(SenweaverSettingsService: ISenweaverSettingsService, modelProviders: ServerModelProviders): Promise<void> {
	try {
		// 检查 modelProviders 是否有效
		if (!modelProviders || typeof modelProviders !== 'object') {
			console.warn('无效的 modelProviders 数据:', modelProviders);
			return;
		}


		for (const [serverProviderName, providerConfig] of Object.entries(modelProviders)) {

			const apiKey = providerConfig.api_key;
			const baseUrl = providerConfig.base_url;

			// 标准化提供商名称（处理服务器端和客户端命名差异）
			const providerName = normalizeProviderName(serverProviderName);
			if (!providerName) {
				console.warn(`⚠️ [处理提供商] 跳过无效的提供商: "${serverProviderName}"`);
				continue;
			}

			// 特殊处理：检测 DISABLED 标记（仅针对 ownProvider）
			if (providerName === 'ownProvider' && apiKey === DISABLED_MARKER) {
				console.log('[OnlineConfig] ownProvider apiKey = DISABLED (provider disabled by server)');
				// 更新 model_access 状态为禁用
				updateModelAccess({
					enabled: false,
					used: ownProviderModelAccess.used,  // 保留已有的使用次数
					limit: ownProviderModelAccess.limit, // 保留已有的限制次数
					reason: '提供商已禁用'
				});
				// 不存储 DISABLED 作为 API Key，跳过此提供商
				continue;
			}

			// 打印 ownProvider 下发配置（掩码 key，避免泄露）
			if (providerName === 'ownProvider') {
				console.log('[OnlineConfig] ownProvider config received: ' + JSON.stringify({
					apiKey: maskKey(apiKey),
					baseUrl: baseUrl || '<empty>',
				}));
			}

			// 设置 API Key（所有提供商统一处理，包括 ownProvider）
			if (apiKey) {
				await SenweaverSettingsService.setSettingOfProvider(providerName, 'apiKey', apiKey);

				// 如果 ownProvider 收到有效的 API Key，确保 model_access 是启用状态
				if (providerName === 'ownProvider' && apiKey !== DISABLED_MARKER) {
					// 只有当之前因为 DISABLED 被禁用时才重新启用
					if (!ownProviderModelAccess.enabled && ownProviderModelAccess.reason === '提供商已禁用') {
						updateModelAccess({
							enabled: true,
							used: ownProviderModelAccess.used,
							limit: ownProviderModelAccess.limit,
							reason: null
						});
					}
				}
			}

			// 设置 Base URL（如果提供且提供商支持）
			if (baseUrl) {
				if (providerName === 'openAICompatible' || providerName === 'ollama' || providerName === 'vLLM' || providerName === 'lmStudio') {
					await SenweaverSettingsService.setSettingOfProvider(providerName, 'endpoint', baseUrl);
				} else if (providerName === 'liteLLM' || providerName === 'awsBedrock') {
					await SenweaverSettingsService.setSettingOfProvider(providerName, 'endpoint', baseUrl);
				}
			}
		}

	} catch (error) {
		console.error('应用模型配置失败:', error);
	}
}

// 提供商的默认 base_url 映射（备用字段）
const providerBaseURLMap: Record<string, string> = {
	'openRouter': 'https://openrouter.ai/api/v1',
	'deepseek': 'https://api.deepseek.com',
	'aliBailian': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	'zAi': 'https://open.bigmodel.cn/api/coding/paas/v4',
	'moonshotAi': 'https://api.moonshot.cn/v1',
	'anthropic': 'https://api.anthropic.com',
	'openAI': 'https://api.openai.com/v1',
	'gemini': 'https://generativelanguage.googleapis.com/v1beta',
	'groq': 'https://api.groq.com/openai/v1',
	'xAI': 'https://api.x.ai/v1',
	'mistral': 'https://api.mistral.ai/v1',
	'ollama': 'http://localhost:11434',
	'vLLM': 'http://localhost:8000',
	'lmStudio': 'http://localhost:1234',
	'liteLLM': 'http://localhost:4000',
	'openAICompatible': '',
	'googleVertex': '',
	'microsoftAzure': '',
	'awsBedrock': '',
	'ownProvider': '', // ownProvider 使用 OWN_PROVIDER_BASE_URL 常量
};

// 需要同步到服务器的提供商白名单
const syncProviderWhitelist: string[] = [
	//'openRouter',
	'deepseek',
	//'aliBailian',
	//'zAi',
	//'moonshotAi',
	'ownProvider'
];

// 获取当前模型配置（只包含指定的提供商）
function getCurrentModelConfig(SenweaverSettingsService: ISenweaverSettingsService): ClientModelProviders {
	const providers: ClientModelProviders = {};

	try {
		const state = SenweaverSettingsService.state;
		const settingsOfProvider = state.settingsOfProvider;


		// 只遍历白名单中的提供商
		for (const providerName of syncProviderWhitelist) {
			const settings = settingsOfProvider[providerName as ProviderName];
			if (!settings) {
				console.warn(`🚧 [获取配置] 提供商 ${providerName} 不存在，跳过`);
				continue;
			}
			const apiKey = (settings as any).apiKey || '';
			const baseURL = providerBaseURLMap[providerName] || '';

			// 所有提供商统一处理（包括 ownProvider，现在所有模型共享相同的 apiKey）
			providers[providerName] = {
				api_key: apiKey,
				base_url: baseURL
			};
		}

	} catch (error) {
		console.error('获取当前模型配置失败:', error);
	}

	return providers;
}

// 线上配置加载的workbench contribution - 使用WebSocket
class SenweaverOnlineConfigContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.senweaver.onlineConfig';

	private ws: WebSocket | null = null;
	private heartbeatInterval: number | null = null;
	private userId: string;
	private reconnectTimeout: number | null = null;
	private isConnecting: boolean = false;
	private hasUpdateContextKey: any;
	private localVersion: string;
	private downloadCancellation: CancellationTokenSource | null = null;
	private serverVersion: string = '';
	private readonly apiConfig: { apiBaseUrl: string; wsBaseUrl: string; secretKey: string };

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ISenweaverSettingsService private readonly SenweaverSettingsService: ISenweaverSettingsService,
		@IProductService private readonly productService: IProductService,
		@IFileService private readonly fileService: IFileService,
		@ISenweaverUpdateService private readonly SenweaverUpdateService: ISenweaverUpdateService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
	) {
		super();

		this.userId = getCurrentUserID();
		this.localVersion = this.productService.SenWeaverVersion || '0.0.0';

		// 从 product.json 获取 API 配置
		this.apiConfig = this.productService.senweaverApiConfig || {
			apiBaseUrl: 'https://ide-api.senweaver.com',
			wsBaseUrl: 'wss://ide-api.senweaver.com',
			secretKey: ''
		};

		// 创建 Context Key 用于控制按钮显示
		this.hasUpdateContextKey = SENWEAVER_HAS_UPDATE_CONTEXT_KEY.bindTo(contextKeyService);

		// 异步设置默认的AI指令配置，不阻塞构造函数
		this.setDefaultAIInstructions().catch(err => {
			console.error('设置默认AI指令失败:', err);
		});

		// 延迟5秒后连接WebSocket，确保IDE完全初始化
		const { window } = globalThis;
		const timeoutId = window.setTimeout(() => {
			this.connectWebSocket();
		}, 5000);

		this._register({ dispose: () => window.clearTimeout(timeoutId) });
	}

	private async setDefaultAIInstructions(): Promise<void> {
		try {
			// OPTIMIZED: 大幅简化默认AI指令，减少 token 使用（从~2000字符降至~300字符）
			// 用户可以通过 .SenweaverRules 文件添加更详细的指令
			const defaultAiInstructions = `# 角色
资深程序员，提供专业、简洁的编程帮助。

## 核心技能
1. 解答编程问题：提供清晰解释和代码示例（含注释）
2. 分享最佳实践：根据场景给出技巧和建议
3. 项目建议：架构设计、技术选型、开发流程

## 规则
- 专注编程相关内容
- 代码需含注释，回复简洁
- 中文优先回复`;

			await this.SenweaverSettingsService.setGlobalSetting('aiInstructions', defaultAiInstructions);
		} catch (error) {
			console.error('设置默认AI指令时出错:', error);
		}
	}

	private connectWebSocket(): void {
		if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
			return;
		}

		this.isConnecting = true;

		try {
			// 连接WebSocket并传递userId、timestamp和auth认证
			const timestamp = getTimestamp();
			const auth = generateAuth(this.userId, 'connection', this.apiConfig.secretKey);
			const wsUrl = `${this.apiConfig.wsBaseUrl}/ws?user_id=${encodeURIComponent(this.userId)}&timestamp=${timestamp}&auth=${auth}`;
			this.ws = new WebSocket(wsUrl);

			this.ws.onopen = () => {

				this.isConnecting = false;

				// 设置全局 WebSocket 引用，供其他模块使用
				setGlobalWebSocket(this.ws);

				// 连接成功后恢复模型可用状态（如果之前因网络问题被禁用）
				// 注意：如果是因为认证失败禁用的，不会自动恢复，需要等待服务器返回 model_access 状态
				if (!ownProviderModelAccess.enabled && ownProviderModelAccess.reason !== '认证失败') {
					updateModelAccess({
						enabled: true,
						used: ownProviderModelAccess.used,
						limit: ownProviderModelAccess.limit,
						reason: null
					});
					console.log(`[WebSocket] 连接成功，模型已恢复可用`);
				}

				// 连接成功后立即发送当前的模型配置
				this.sendInitialConfig();
			};

			this.ws.onmessage = (event) => {
				this.handleWebSocketMessage(event.data);
			};

			this.ws.onerror = (error) => {
				this.isConnecting = false;
				// WebSocket 连接错误，只记录日志，不禁用模型
				// 网络错误不应该阻止用户继续对话，系统会自动重连
				console.warn(`[WebSocket] 连接错误，将尝试重连...`);
			};

			this.ws.onclose = (event) => {
				this.isConnecting = false;
				this.stopHeartbeat();

				// 清除全局 WebSocket 引用
				setGlobalWebSocket(null);

				// 断开就禁用模型，后台自动重连，重连成功后恢复
				// WebSocket 关闭码: 1000=正常关闭, 1006=异常关闭, 4001=认证失败, 4002=强制断开
				const reason = event.code === 4001 ? '认证失败' : '连接断开';
				if (ownProviderModelAccess.enabled) {
					updateModelAccess({
						enabled: false,
						used: ownProviderModelAccess.used,
						limit: ownProviderModelAccess.limit,
						reason
					});
					console.warn(`[WebSocket] ${reason}，暂时禁用模型，后台30秒后自动重连...`);
				}

				// 尝试重连（30秒后）
				const { window } = globalThis;
				this.reconnectTimeout = window.setTimeout(() => {
					this.connectWebSocket();
				}, 30000);
			};

		} catch (error) {
			console.error('WebSocket连接失败:', error);
			this.isConnecting = false;
		}
	}

	private handleWebSocketMessage(data: string): void {
		try {
			const message = JSON.parse(data);

			switch (message.type) {
				case 'connection':
					this.handleConnectionMessage(message as WSConnectionMessage);
					break;
				case 'heartbeat':
					this.handleHeartbeatMessage(message as WSHeartbeatMessage);
					break;
				case 'model_config_update':
					this.handleModelConfigUpdate(message as WSModelConfigUpdateMessage);
					break;
				case 'error':
					this.handleErrorMessage(message as WSErrorMessage);
					break;
				case 'model_access_update':
					this.handleModelAccessUpdate(message as WSModelAccessUpdateMessage);
					break;
				case 'init_success':
					// 初始化成功确认消息，无需特殊处理
					break;
				default:
					// 静默忽略未知消息类型，避免控制台警告
					break;
			}
		} catch (error) {
			console.error(' [error] :', error);
		}
	}

	private async handleConnectionMessage(message: WSConnectionMessage): Promise<void> {

		// 处理 model_access 状态
		if (message.model_access) {
			console.log('[OnlineConfig] ownProvider model_access (connection): ' + JSON.stringify(message.model_access));
			updateModelAccess(message.model_access);
		}

		// 检查版本号
		if (message.version) {

			const hasUpdate = message.version !== this.localVersion;
			// 不再立即显示按钮，等待下载完成后再显示
			// this.hasUpdateContextKey.set(hasUpdate);
			if (hasUpdate) {

				this.serverVersion = message.version;

				// 启动后台下载
				this.startBackgroundDownload();
			} else {

				this.hasUpdateContextKey.set(false);
			}
		}

		// 应用模型配置
		await applyModelConfig(this.SenweaverSettingsService, message.model_providers);

		// 开始发送心跳包
		this.startHeartbeat();
	}

	private handleHeartbeatMessage(message: WSHeartbeatMessage): void {

		// 服务器发来的心跳包，可以检查版本号等信息
		if (message.version) {

			// 比较版本号，如果不同则启动下载，但不立即显示按钮
			const hasUpdate = message.version !== this.localVersion;
			// 不再立即显示按钮，等待下载完成后再显示
			// this.hasUpdateContextKey.set(hasUpdate);
			if (hasUpdate && this.serverVersion !== message.version) {

				this.serverVersion = message.version;
				// 启动后台下载
				this.startBackgroundDownload();
			} else if (!hasUpdate) {

				this.hasUpdateContextKey.set(false);
			}
		}
	}

	private async handleModelConfigUpdate(message: WSModelConfigUpdateMessage): Promise<void> {

		// 应用更新的模型配置
		await applyModelConfig(this.SenweaverSettingsService, message.model_providers);
	}

	private handleErrorMessage(message: WSErrorMessage): void {
		console.error('服务器错误:', message.message, message.code ? `(${message.code})` : '');

		// 检查是否是认证失败错误
		const authErrorCodes = ['AUTH_FAILED', 'INVALID_AUTH', 'AUTH_EXPIRED', 'UNAUTHORIZED', 'FORBIDDEN'];
		const isAuthError = message.code && authErrorCodes.includes(message.code.toUpperCase());

		if (isAuthError) {
			updateModelAccess({
				enabled: false,
				used: ownProviderModelAccess.used,
				limit: ownProviderModelAccess.limit,
				reason: message.message || '认证失败'
			});
		}
	}

	private handleModelAccessUpdate(message: WSModelAccessUpdateMessage): void {
		// 更新全局 model_access 状态
		console.log('[OnlineConfig] ownProvider model_access_update: ' + JSON.stringify({
			enabled: message.enabled,
			used: message.used,
			limit: message.limit,
			reason: message.reason,
			timestamp: message.timestamp,
		}));
		updateModelAccess({
			enabled: message.enabled,
			used: message.used,
			limit: message.limit,
			reason: message.reason
		});

	}

	private startHeartbeat(): void {
		// 停止之前的心跳
		this.stopHeartbeat();

		// 每30秒发送一次心跳包
		const { window } = globalThis;
		this.heartbeatInterval = window.setInterval(() => {
			this.sendHeartbeat();
		}, 30000);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatInterval !== null) {
			const { window } = globalThis;
			window.clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	private sendInitialConfig(): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			const modelProviders = getCurrentModelConfig(this.SenweaverSettingsService);
			const timestamp = getTimestamp();
			const auth = generateAuth(this.userId, 'init', this.apiConfig.secretKey);
			const initialData = {
				type: 'init',
				user_id: this.userId,
				timestamp: timestamp,
				auth: auth,
				model_providers: modelProviders
			};

			this.ws.send(JSON.stringify(initialData));
		}
	}

	private sendHeartbeat(): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			const modelProviders = getCurrentModelConfig(this.SenweaverSettingsService);
			const timestamp = getTimestamp();
			const auth = generateAuth(this.userId, 'heartbeat', this.apiConfig.secretKey);
			const heartbeatData = {
				type: 'heartbeat',
				user_id: this.userId,
				timestamp: timestamp,
				auth: auth,
				model_providers: modelProviders
			};

			this.ws.send(JSON.stringify(heartbeatData));
		}
	}

	private async startBackgroundDownload(): Promise<void> {
		// 如果已经在下载或已下载，则不重复下载
		if (senweaverUpdateDownloadStatus.downloading || senweaverUpdateDownloadStatus.downloaded) {
			return;
		}

		try {
			senweaverUpdateDownloadStatus.downloading = true;
			senweaverUpdateDownloadStatus.downloaded = false;
			senweaverUpdateDownloadStatus.error = undefined;
			const downloadUrl = `${this.apiConfig.apiBaseUrl}/download/latest`;

			// 获取临时目录路径
			const tmpDir = this.environmentService.tmpDir;

			// 确定安装包文件名和保存路径
			let installerFileName = 'SenWeaverSetup.exe';
			if (isMacintosh) {
				installerFileName = 'SenWeaver.dmg';
			} else if (isLinux) {
				installerFileName = 'SenWeaver.deb';
			}

			const downloadPath = URI.joinPath(tmpDir, installerFileName);

			// 创建取消令牌
			this.downloadCancellation = new CancellationTokenSource();

			// 先用 requestService 获取最终下载地址（可能 302 到下载站），并尽量强制 https 避免 webview CORS/混合内容拦截
			let finalUrl = downloadUrl;
			try {
				// 主进程下载实现会自行处理重定向，这里保持原始入口 URL 即可
				finalUrl = downloadUrl;
			} catch {
				// ignore: fallback to downloadUrl
			}

			if (finalUrl.startsWith('http://')) {
				finalUrl = 'https://' + finalUrl.slice('http://'.length);
			}


			// 通过 IPC 调用主进程下载，彻底绕开 renderer fetch/CORS。
			// 主进程侧会跟随重定向，并将 http 重定向升级为 https。
			await this.SenweaverUpdateService.download(finalUrl, downloadPath.fsPath);
			// 确保文件确实落盘（download 可能成功但文件被占用/权限异常等）
			await this.fileService.readFile(downloadPath);

			senweaverUpdateDownloadStatus.downloading = false;
			senweaverUpdateDownloadStatus.downloaded = true;
			senweaverUpdateDownloadStatus.filePath = downloadPath.fsPath;

			// 下载完成后，显示更新按钮
			this.hasUpdateContextKey.set(true);

		} catch (error) {
			console.error('[SenweaverUpdate] download failed:', error);
			// 静默处理下载失败（404等情况属于正常，服务器可能暂无更新文件）
			senweaverUpdateDownloadStatus.downloading = false;
			senweaverUpdateDownloadStatus.downloaded = false;
			senweaverUpdateDownloadStatus.error = error instanceof Error ? error.message : String(error);
			// 下载失败时，不显示更新按钮
			this.hasUpdateContextKey.set(false);
		}
	}

	override dispose(): void {
		// 清理WebSocket连接
		this.stopHeartbeat();

		if (this.reconnectTimeout !== null) {
			const { window } = globalThis;
			window.clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		// 取消下载
		if (this.downloadCancellation) {
			this.downloadCancellation.cancel();
			this.downloadCancellation.dispose();
			this.downloadCancellation = null;
		}

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		super.dispose();
	}
}

// 注册workbench contribution，在AfterRestored阶段执行
registerWorkbenchContribution2(SenweaverOnlineConfigContribution.ID, SenweaverOnlineConfigContribution, WorkbenchPhase.AfterRestored);
