/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { InternalToolInfo } from './prompt/prompts.js'
import { ToolName, ToolParamName } from './toolsServiceTypes.js'
import { ChatMode, ModelSelection, ModelSelectionOptions, OverridesOfModel, ProviderName, RefreshableProviderName, SettingsOfProvider } from './senweaverSettingsTypes.js'


export const errorDetails = (fullError: Error | null): string | null => {
	if (fullError === null) {
		return null
	}
	else if (typeof fullError === 'object') {
		if (Object.keys(fullError).length === 0) return null
		return JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		return null
	}
	return null
}

// 检查是否为连接相关错误（需要显示友好提示）
export const isConnectionError = (message: string, fullError: Error | null): boolean => {
	const messageStr = message?.toLowerCase() || '';
	const fullErrorStr = fullError ? JSON.stringify(fullError).toLowerCase() : '';

	// 检查 ECONNRESET 连接重置错误
	if (messageStr.includes('econnreset') || fullErrorStr.includes('econnreset')) {
		return true;
	}

	// 检查 Connection error
	if (messageStr.includes('connection error')) {
		return true;
	}

	// 检查 403 防火墙拦截（包含中文"网站防火墙"或"防火墙"）
	if (messageStr.includes('403') && (messageStr.includes('防火墙') || messageStr.includes('<!doctype html>'))) {
		return true;
	}

	// 检查网络超时
	if (messageStr.includes('etimedout') || fullErrorStr.includes('etimedout')) {
		return true;
	}

	// 检查连接拒绝
	if (messageStr.includes('econnrefused') || fullErrorStr.includes('econnrefused')) {
		return true;
	}

	return false;
}

// 获取友好的错误消息
export const getFriendlyErrorMessage = (message: string, fullError: Error | null): string => {
	if (!isConnectionError(message, fullError)) {
		return message;
	}

	const messageStr = message?.toLowerCase() || '';
	const fullErrorStr = fullError ? JSON.stringify(fullError).toLowerCase() : '';

	if (messageStr.includes('econnreset') || fullErrorStr.includes('econnreset')) {
		return '模型连接失败：服务器连接被重置，请稍后重试';
	}

	if (messageStr.includes('403') && (messageStr.includes('防火墙') || messageStr.includes('<!doctype html>'))) {
		return '模型连接失败：请求被服务器拦截，请稍后重试';
	}

	if (messageStr.includes('etimedout') || fullErrorStr.includes('etimedout')) {
		return '模型连接失败：连接超时，请检查网络后重试';
	}

	if (messageStr.includes('econnrefused') || fullErrorStr.includes('econnrefused')) {
		return '模型连接失败：无法连接到服务器，请稍后重试';
	}

	return '模型连接失败：网络异常，请稍后重试';
}

export const getErrorMessage: (error: unknown) => string = (error) => {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return error + ''
}



export type AnthropicLLMChatMessage = {
	role: 'assistant',
	content: string | (AnthropicReasoning | { type: 'text'; text: string }
		| { type: 'tool_use'; name: string; input: Record<string, any>; id: string; }
	)[];
} | {
	role: 'user',
	content: string | (
		{ type: 'text'; text: string; } | { type: 'tool_result'; tool_use_id: string; content: string; }
		| { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string; } }
	)[]
}
export type OpenAILLMChatMessage = {
	role: 'system' | 'user' | 'developer';
	content: string | (
		{ type: 'text'; text: string; } | { type: 'image_url'; image_url: { url: string; } }
	)[];
} | {
	role: 'assistant',
	content: string | (AnthropicReasoning | { type: 'text'; text: string })[];
	tool_calls?: { type: 'function'; id: string; function: { name: string; arguments: string; } }[];
} | {
	role: 'tool',
	content: string;
	tool_call_id: string;
}

export type GeminiLLMChatMessage = {
	role: 'model'
	parts: (
		| { text: string; }
		| { functionCall: { id: string; name: ToolName, args: Record<string, unknown> } }
	)[];
} | {
	role: 'user';
	parts: (
		| { text: string; }
		| { functionResponse: { id: string; name: ToolName, response: { output: string } } }
		| { inlineData: { mimeType: string; data: string; } }
	)[];
}

export type LLMChatMessage = AnthropicLLMChatMessage | OpenAILLMChatMessage | GeminiLLMChatMessage



export type LLMFIMMessage = {
	prefix: string;
	suffix: string;
	stopTokens: string[];
}


export type RawToolParamsObj = {
	[paramName in ToolParamName<ToolName>]?: string;
}
export type RawToolCallObj = {
	name: ToolName;
	rawParams: RawToolParamsObj;
	doneParams: ToolParamName<ToolName>[];
	id: string;
	isDone: boolean;
};

export type AnthropicReasoning = ({ type: 'thinking'; thinking: any; signature: string; } | { type: 'redacted_thinking', data: any })

export type OnText = (p: { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj }) => void
export type OnFinalMessage = (p: { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj; anthropicReasoning: AnthropicReasoning[] | null }) => void // id is tool_use_id
export type OnError = (p: { message: string; fullError: Error | null }) => void
export type OnAbort = () => void
export type AbortRef = { current: (() => void) | null }


// service types
type SendLLMType = {
	messagesType: 'chatMessages';
	messages: LLMChatMessage[]; // the type of raw chat messages that we send to Anthropic, OAI, etc
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
} | {
	messagesType: 'FIMMessage';
	messages: LLMFIMMessage;
	separateSystemMessage?: undefined;
	chatMode?: undefined;
}
export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	modelSelection: ModelSelection | null;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	onAbort: OnAbort;
} & SendLLMType;

// params to the true sendLLMMessage function
export type SendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	abortRef: AbortRef;

	modelSelection: ModelSelection;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;

	settingsOfProvider: SettingsOfProvider;
	mcpTools: InternalToolInfo[] | undefined;
} & SendLLMType



// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'
export type MainSendLLMMessageParams = Omit<SendLLMMessageParams, BlockedMainLLMMessageParams> & { requestId: string } & SendLLMType

export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string }
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }

// service -> main -> internal -> event (back to main)
// (browser)









// These are from 'ollama' SDK
interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export type OllamaModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: Date;
	size_vram: number;
}

export type OpenaiCompatibleModelResponse = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}



// params to the true list fn
export type ModelListParams<ModelResponse> = {
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: string }) => void;
}

// params to the service
export type ServiceModelListParams<modelResponse> = {
	providerName: RefreshableProviderName;
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainModelListParams = 'onSuccess' | 'onError'
export type MainModelListParams<modelResponse> = Omit<ModelListParams<modelResponse>, BlockedMainModelListParams> & { providerName: RefreshableProviderName, requestId: string }

export type EventModelListOnSuccessParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onSuccess']>[0] & { requestId: string }
export type EventModelListOnErrorParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onError']>[0] & { requestId: string }




