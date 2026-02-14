import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ChatMessage } from '../common/chatThreadServiceTypes.js';
import { getIsReasoningEnabledState, getReservedOutputTokenSpace, getModelCapabilities } from '../common/modelCapabilities.js';
import { reParsedToolXMLString, chat_systemMessage } from '../common/prompt/prompts.js';
import { AnthropicLLMChatMessage, AnthropicReasoning, GeminiLLMChatMessage, LLMChatMessage, LLMFIMMessage, OpenAILLMChatMessage, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js';
import { ChatMode, FeatureName, ModelSelection, ProviderName } from '../common/senweaverSettingsTypes.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { ITerminalToolService } from './terminalToolService.js';
import { ISenweaverModelService } from '../common/senweaverModelService.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { ToolName } from '../common/toolsServiceTypes.js';
import { IMCPService } from '../common/mcpService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { enhancedContextManager } from '../common/smartContextManager.js';
import { getAgentComposition, getAgentDefinition } from '../common/agentService.js';
import { IAPOService } from '../common/apoService.js';

export const EMPTY_MESSAGE = '(empty message)'



type SimpleLLMMessage = {
	role: 'tool';
	content: string;
	id: string;
	name: ToolName;
	rawParams: RawToolParamsObj;
} | {
	role: 'user';
	content: string;
} | {
	role: 'assistant';
	content: string;
	anthropicReasoning: AnthropicReasoning[] | null;
}


// More precise token estimation: 3.5 chars/token (for mixed Chinese/English text)
// Previously using 4 would underestimate token usage by ~14%, causing context overflow
const CHARS_PER_TOKEN = 3.5
const TRIM_TO_LEN = 500 // Length to keep after trimming

const prepareMessages_openai_tools = (messages: SimpleLLMMessage[]): AnthropicOrOpenAILLMMessage[] => {

	const newMessages: OpenAILLMChatMessage[] = [];

	for (let i = 0; i < messages.length; i += 1) {
		const currMsg = messages[i]

		if (currMsg.role !== 'tool') {
			newMessages.push(currMsg)
			continue
		}

		// edit previous assistant message to have called the tool
		const prevMsg = 0 <= i - 1 && i - 1 <= newMessages.length ? newMessages[i - 1] : undefined
		if (prevMsg?.role === 'assistant') {
			prevMsg.tool_calls = [{
				type: 'function',
				id: currMsg.id,
				function: {
					name: currMsg.name,
					arguments: JSON.stringify(currMsg.rawParams)
				}
			}]
		}

		// add the tool
		newMessages.push({
			role: 'tool',
			tool_call_id: currMsg.id,
			content: currMsg.content,
		})
	}
	return newMessages

}



// convert messages as if about to send to anthropic
/*
https://docs.anthropic.com/en/docs/build-with-claude/tool-use#tool-use-examples
anthropic MESSAGE (role=assistant):
"content": [{
	"type": "text",
	"text": "<thinking>I need to call the get_weather function, and the user wants SF, which is likely San Francisco, CA.</thinking>"
}, {
	"type": "tool_use",
	"id": "toolu_01A09q90qw90lq917835lq9",
	"name": "get_weather",
	"input": { "location": "San Francisco, CA", "unit": "celsius" }
}]
anthropic RESPONSE (role=user):
"content": [{
	"type": "tool_result",
	"tool_use_id": "toolu_01A09q90qw90lq917835lq9",
	"content": "15 degrees"
}]


Converts:
assistant: ...content
tool: (id, name, params)
->
assistant: ...content, call(name, id, params)
user: ...content, result(id, content)
*/

type AnthropicOrOpenAILLMMessage = AnthropicLLMChatMessage | OpenAILLMChatMessage

const prepareMessages_anthropic_tools = (messages: SimpleLLMMessage[], supportsAnthropicReasoning: boolean): AnthropicOrOpenAILLMMessage[] => {
	const newMessages: (AnthropicLLMChatMessage | (SimpleLLMMessage & { role: 'tool' }))[] = messages;

	for (let i = 0; i < messages.length; i += 1) {
		const currMsg = messages[i]

		// add anthropic reasoning
		if (currMsg.role === 'assistant') {
			if (currMsg.anthropicReasoning && supportsAnthropicReasoning) {
				const content = currMsg.content
				newMessages[i] = {
					role: 'assistant',
					content: content ? [...currMsg.anthropicReasoning, { type: 'text' as const, text: content }] : currMsg.anthropicReasoning
				}
			}
			else {
				newMessages[i] = {
					role: 'assistant',
					content: currMsg.content,
					// strip away anthropicReasoning
				}
			}
			continue
		}

		if (currMsg.role === 'user') {
			newMessages[i] = {
				role: 'user',
				content: currMsg.content,
			}
			continue
		}

		if (currMsg.role === 'tool') {
			// add anthropic tools
			const prevMsg = 0 <= i - 1 && i - 1 <= newMessages.length ? newMessages[i - 1] : undefined

			// make it so the assistant called the tool
			if (prevMsg?.role === 'assistant') {
				if (typeof prevMsg.content === 'string') prevMsg.content = [{ type: 'text', text: prevMsg.content }]
				prevMsg.content.push({ type: 'tool_use', id: currMsg.id, name: currMsg.name, input: currMsg.rawParams })
			}

			// turn each tool into a user message with tool results at the end
			newMessages[i] = {
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: currMsg.id, content: currMsg.content }]
			}
			continue
		}

	}

	// we just removed the tools
	return newMessages as AnthropicLLMChatMessage[]
}


const prepareMessages_XML_tools = (messages: SimpleLLMMessage[], supportsAnthropicReasoning: boolean): AnthropicOrOpenAILLMMessage[] => {

	const llmChatMessages: AnthropicOrOpenAILLMMessage[] = [];
	for (let i = 0; i < messages.length; i += 1) {

		const c = messages[i]
		const next = 0 <= i + 1 && i + 1 <= messages.length - 1 ? messages[i + 1] : null

		if (c.role === 'assistant') {
			// if called a tool (message after it), re-add its XML to the message
			// alternatively, could just hold onto the original output, but this way requires less piping raw strings everywhere
			let content: AnthropicOrOpenAILLMMessage['content'] = c.content
			if (next?.role === 'tool') {
				content = `${content}\n\n${reParsedToolXMLString(next.name, next.rawParams)}`
			}

			// anthropic reasoning
			if (c.anthropicReasoning && supportsAnthropicReasoning) {
				content = content ? [...c.anthropicReasoning, { type: 'text' as const, text: content }] : c.anthropicReasoning
			}
			llmChatMessages.push({
				role: 'assistant',
				content
			})
		}
		// add user or tool to the previous user message
		else if (c.role === 'user' || c.role === 'tool') {
			if (c.role === 'tool')
				c.content = `<${c.name}_result>\n${c.content}\n</${c.name}_result>`

			if (llmChatMessages.length === 0 || llmChatMessages[llmChatMessages.length - 1].role !== 'user')
				llmChatMessages.push({
					role: 'user',
					content: c.content
				})
			else
				llmChatMessages[llmChatMessages.length - 1].content += '\n\n' + c.content
		}
	}
	return llmChatMessages
}


// --- CHAT ---

const prepareOpenAIOrAnthropicMessages = ({
	messages: messages_,
	systemMessage,
	aiInstructions,
	supportsSystemMessage,
	specialToolFormat,
	supportsAnthropicReasoning,
	contextWindow,
	reservedOutputTokenSpace,
}: {
	messages: SimpleLLMMessage[],
	systemMessage: string,
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
	specialToolFormat: 'openai-style' | 'anthropic-style' | undefined,
	supportsAnthropicReasoning: boolean,
	contextWindow: number,
	reservedOutputTokenSpace: number | null | undefined,
}): { messages: AnthropicOrOpenAILLMMessage[], separateSystemMessage: string | undefined } => {

	// Smart output token reservation:
	// - For large models (>100k tokens), reserve 20-25% for output
	// - For small models, reserve at least 4k-8k tokens
	// - Max 16k tokens reserved (avoid over-consuming input space)
	reservedOutputTokenSpace = Math.max(
		Math.min(
			contextWindow * 0.20, // Reserve 20% of context for output (not 50% as before!)
			16_000 // Max 16k tokens reserved
		),
		reservedOutputTokenSpace ?? 4_096 // Default minimum 4096
	)
	let messages: (SimpleLLMMessage | { role: 'system', content: string })[] = deepClone(messages_)

	// ================ system message ================
	// A COMPLETE HACK: last message is system message for context purposes

	const sysMsgParts: string[] = []
	if (aiInstructions) sysMsgParts.push(`GUIDELINES (from the user's .SenweaverRules file):\n${aiInstructions}`)
	if (systemMessage) sysMsgParts.push(systemMessage)
	let combinedSystemMessage = sysMsgParts.join('\n\n')

	// ================ System message budget control ================
	// Prevent system message (including APO/RL rules) from consuming too much context
	// Budget: max 30% of available input chars, with a hard cap
	const availableInputCharsForBudget = (contextWindow - (reservedOutputTokenSpace ?? 4096)) * CHARS_PER_TOKEN
	const SYSTEM_MSG_MAX_RATIO = 0.30 // System message can use at most 30% of input space
	const SYSTEM_MSG_HARD_CAP = 60_000 // Hard cap: ~17k tokens
	const systemMsgBudget = Math.min(availableInputCharsForBudget * SYSTEM_MSG_MAX_RATIO, SYSTEM_MSG_HARD_CAP)

	if (combinedSystemMessage.length > systemMsgBudget) {
		// Truncate system message, preserving the beginning (core instructions) over the end (APO rules etc.)
		combinedSystemMessage = combinedSystemMessage.substring(0, Math.floor(systemMsgBudget) - 40) + '\n...[system prompt truncated for context budget]...'
	}

	messages.unshift({ role: 'system', content: combinedSystemMessage })

	// ================ trim ================
	messages = messages.map(m => ({ ...m, content: m.role !== 'tool' ? m.content.trim() : m.content }))

	type MesType = (typeof messages)[0]

	// ================ Locate the LAST user message (current input) — MUST be protected at all costs ================
	let lastUserMsgIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			lastUserMsgIdx = i;
			break;
		}
	}

	// ================ Phase 1: Aggressive message deletion (if too many messages) ================
	const MAX_MESSAGES_BEFORE_AGGRESSIVE_PRUNE = 50
	if (messages.length > MAX_MESSAGES_BEFORE_AGGRESSIVE_PRUNE) {
		// Keep: system (idx 0) + last user message + last 15 messages
		const keepSet = new Set<number>();
		for (let i = 0; i < Math.min(2, messages.length); i++) keepSet.add(i);
		if (lastUserMsgIdx >= 0) keepSet.add(lastUserMsgIdx);
		for (let i = Math.max(0, messages.length - 15); i < messages.length; i++) keepSet.add(i);
		messages = messages.filter((_, i) => keepSet.has(i));
		// Recalculate lastUserMsgIdx after filtering
		lastUserMsgIdx = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === 'user') { lastUserMsgIdx = i; break; }
		}
	}

	// ================ fit into context ================

	// the higher the weight, the higher the desire to truncate - TRIM HIGHEST WEIGHT MESSAGES
	const alreadyTrimmedIdxes = new Set<number>()
	const weight = (message: MesType, messages: MesType[], idx: number) => {
		// CRITICAL: The last user message (current input) has weight 0 — NEVER trim it
		if (idx === lastUserMsgIdx) return 0

		const base = message.content.length

		let multiplier: number
		multiplier = 1 + (messages.length - 1 - idx) / messages.length // slow rampdown from 2 to 1 as index increases
		if (message.role === 'user') {
			multiplier *= 0.5 // user messages are more valuable, lower trim priority
		}
		else if (message.role === 'system') {
			multiplier *= .01 // very low weight
		}
		else {
			multiplier *= 10 // assistant/tool tokens are far less valuable than user tokens
		}

		// any already modified message should not be trimmed again
		if (alreadyTrimmedIdxes.has(idx)) {
			multiplier = 0
		}
		// 1st and last messages should be very low weight
		if (idx <= 1 || idx >= messages.length - 1 - 3) {
			multiplier *= .05
		}
		return base * multiplier
	}

	const _findLargestByWeight = (messages_: MesType[]) => {
		let largestIndex = -1
		let largestWeight = -Infinity
		for (let i = 0; i < messages.length; i += 1) {
			const m = messages[i]
			const w = weight(m, messages_, i)
			if (w > largestWeight) {
				largestWeight = w
				largestIndex = i
			}
		}
		return largestIndex
	}

	// ================ Phase 2: Fine-grained trimming (character-level) ================
	let totalLen = 0
	for (const m of messages) { totalLen += m.content.length }
	const availableInputTokens = contextWindow - reservedOutputTokenSpace
	const availableInputChars = availableInputTokens * CHARS_PER_TOKEN
	const charsNeedToTrim = totalLen - Math.max(
		availableInputChars,
		20_000 // Ensure at least 20k chars (~5k tokens) of conversation history are kept
	)

	// If trimming is still needed
	if (charsNeedToTrim > 0) {
		let remainingCharsToTrim = charsNeedToTrim
		let i = 0
		const MAX_TRIM_ITERATIONS = 100

		while (remainingCharsToTrim > 0 && i < MAX_TRIM_ITERATIONS) {
			i += 1

			const trimIdx = _findLargestByWeight(messages)

			// Safety check: if no trimmable message found, force exit
			if (trimIdx === -1 || !messages[trimIdx]) {
				break
			}

			// CRITICAL: Never trim the last user message
			if (trimIdx === lastUserMsgIdx) {
				alreadyTrimmedIdxes.add(trimIdx)
				continue
			}

			const m = messages[trimIdx]

			// Safety check: if message is too short, skip
			if (m.content.length <= TRIM_TO_LEN) {
				alreadyTrimmedIdxes.add(trimIdx)
				// If all messages are already short but still exceed context, force delete some
				if (alreadyTrimmedIdxes.size >= messages.length - 3) {
					if (messages.length > 10) {
						// Keep system + last user message + last 3 messages
						const keepIdxs = new Set<number>();
						for (let j = 0; j < Math.min(2, messages.length); j++) keepIdxs.add(j);
						if (lastUserMsgIdx >= 0) keepIdxs.add(lastUserMsgIdx);
						for (let j = Math.max(0, messages.length - 3); j < messages.length; j++) keepIdxs.add(j);
						messages = messages.filter((_, j) => keepIdxs.has(j));
						// Recalculate lastUserMsgIdx
						lastUserMsgIdx = -1;
						for (let j = messages.length - 1; j >= 0; j--) {
							if (messages[j].role === 'user') { lastUserMsgIdx = j; break; }
						}
					}
					break
				}
				continue
			}

			// if can finish here, do
			const numCharsWillTrim = m.content.length - TRIM_TO_LEN
			if (numCharsWillTrim > remainingCharsToTrim) {
				m.content = m.content.slice(0, m.content.length - remainingCharsToTrim - '...'.length).trim() + '...'
				break
			}

			remainingCharsToTrim -= numCharsWillTrim
			m.content = m.content.substring(0, TRIM_TO_LEN - '...'.length) + '...'
			alreadyTrimmedIdxes.add(trimIdx)
		}
	}

	// ================ Phase 3: Final safety check ================
	let finalTotalLen = 0
	for (const m of messages) { finalTotalLen += m.content.length }

	const SAFETY_MARGIN = 0.85 // Leave 15% safety margin (more conservative)
	const safeInputChars = availableInputChars * SAFETY_MARGIN

	if (finalTotalLen > safeInputChars) {
		// Emergency trimming: proportionally reduce all non-system/non-lastUser messages
		const excessRatio = safeInputChars / finalTotalLen
		const EMERGENCY_KEEP_CHARS = 200

		for (let idx = 1; idx < messages.length; idx++) {
			const m = messages[idx]
			if (m.role === 'system') continue
			// CRITICAL: Never truncate the last user message
			if (idx === lastUserMsgIdx) continue
			const targetLen = Math.max(EMERGENCY_KEEP_CHARS, Math.floor(m.content.length * excessRatio))
			if (m.content.length > targetLen) {
				m.content = m.content.substring(0, targetLen - 30) + '\n...[emergency truncation]...'
			}
		}

		// If still too large, keep only system + last user message + last 3 messages
		let recheckLen = 0
		for (const m of messages) { recheckLen += m.content.length }
		if (recheckLen > safeInputChars && messages.length > 4) {
			const keepIdxs = new Set<number>();
			keepIdxs.add(0); // system
			if (lastUserMsgIdx >= 0) keepIdxs.add(lastUserMsgIdx);
			for (let j = Math.max(0, messages.length - 3); j < messages.length; j++) keepIdxs.add(j);
			messages = messages.filter((_, j) => keepIdxs.has(j));
			lastUserMsgIdx = -1;
			for (let j = messages.length - 1; j >= 0; j--) {
				if (messages[j].role === 'user') { lastUserMsgIdx = j; break; }
			}
		}
	}

	// ================ Phase 4: Ultimate fallback — guarantee no context overflow ================
	// If STILL too large after all phases, keep only system message + last user message
	// This ensures the assistant ALWAYS responds to the user's current question
	{
		let ultimateLen = 0
		for (const m of messages) { ultimateLen += m.content.length }
		if (ultimateLen > availableInputChars) {
			console.warn('[prepareMessages] Phase 4 ultimate fallback: keeping only system + last user message')
			const sysMsg = messages.find(m => m.role === 'system')
			const lastUserMsg = lastUserMsgIdx >= 0 ? messages[lastUserMsgIdx] : messages[messages.length - 1]
			messages = []
			if (sysMsg) {
				// Trim system message if needed to make room for user message
				const userMsgLen = lastUserMsg.content.length
				const maxSysMsgLen = Math.max(2000, availableInputChars - userMsgLen - 1000)
				if (sysMsg.content.length > maxSysMsgLen) {
					sysMsg.content = sysMsg.content.substring(0, maxSysMsgLen - 30) + '\n...[system message truncated]...'
				}
				messages.push(sysMsg)
			}
			messages.push(lastUserMsg)
			lastUserMsgIdx = messages.length - 1
		}
	}

	// ================ system message hack ================
	const newSysMsg = messages.shift()!.content


	// ================ tools and anthropicReasoning ================
	// SYSTEM MESSAGE HACK: we shifted (removed) the system message role, so now SimpleLLMMessage[] is valid

	let llmChatMessages: AnthropicOrOpenAILLMMessage[] = []
	if (!specialToolFormat) { // XML tool behavior
		llmChatMessages = prepareMessages_XML_tools(messages as SimpleLLMMessage[], supportsAnthropicReasoning)
	}
	else if (specialToolFormat === 'anthropic-style') {
		llmChatMessages = prepareMessages_anthropic_tools(messages as SimpleLLMMessage[], supportsAnthropicReasoning)
	}
	else if (specialToolFormat === 'openai-style') {
		llmChatMessages = prepareMessages_openai_tools(messages as SimpleLLMMessage[])
	}
	const llmMessages = llmChatMessages


	// ================ system message add as first llmMessage ================

	let separateSystemMessageStr: string | undefined = undefined

	// if supports system message
	if (supportsSystemMessage) {
		if (supportsSystemMessage === 'separated')
			separateSystemMessageStr = newSysMsg
		else if (supportsSystemMessage === 'system-role')
			llmMessages.unshift({ role: 'system', content: newSysMsg }) // add new first message
		else if (supportsSystemMessage === 'developer-role')
			llmMessages.unshift({ role: 'developer', content: newSysMsg }) // add new first message
	}
	// if does not support system message
	else {
		const newFirstMessage = {
			role: 'user',
			content: `<SYSTEM_MESSAGE>\n${newSysMsg}\n</SYSTEM_MESSAGE>\n${llmMessages[0].content}`
		} as const
		llmMessages.splice(0, 1) // delete first message
		llmMessages.unshift(newFirstMessage) // add new first message
	}


	// ================ no empty message ================
	for (let i = 0; i < llmMessages.length; i += 1) {
		const currMsg: AnthropicOrOpenAILLMMessage = llmMessages[i]
		const nextMsg: AnthropicOrOpenAILLMMessage | undefined = llmMessages[i + 1]

		if (currMsg.role === 'tool') continue

		// if content is a string, replace string with empty msg
		if (typeof currMsg.content === 'string') {
			currMsg.content = currMsg.content || EMPTY_MESSAGE
		}
		else {
			// allowed to be empty if has a tool in it or following it
			if (currMsg.content.find(c => c.type === 'tool_result' || c.type === 'tool_use')) {
				currMsg.content = currMsg.content.filter(c => !(c.type === 'text' && !c.text)) as any
				continue
			}
			if (nextMsg?.role === 'tool') continue

			// replace any empty text entries with empty msg, and make sure there's at least 1 entry
			for (const c of currMsg.content) {
				if (c.type === 'text') c.text = c.text || EMPTY_MESSAGE
			}
			if (currMsg.content.length === 0) currMsg.content = [{ type: 'text', text: EMPTY_MESSAGE }]
		}
	}

	return {
		messages: llmMessages,
		separateSystemMessage: separateSystemMessageStr,
	} as const
}




type GeminiUserPart = (GeminiLLMChatMessage & { role: 'user' })['parts'][0]
type GeminiModelPart = (GeminiLLMChatMessage & { role: 'model' })['parts'][0]
const prepareGeminiMessages = (messages: AnthropicLLMChatMessage[]) => {
	let latestToolName: ToolName | undefined = undefined
	const messages2: GeminiLLMChatMessage[] = messages.map((m): GeminiLLMChatMessage | null => {
		if (m.role === 'assistant') {
			if (typeof m.content === 'string') {
				return { role: 'model', parts: [{ text: m.content }] }
			}
			else {
				const parts: GeminiModelPart[] = m.content.map((c): GeminiModelPart | null => {
					if (c.type === 'text') {
						return { text: c.text }
					}
					else if (c.type === 'tool_use') {
						latestToolName = c.name
						return { functionCall: { id: c.id, name: c.name, args: c.input } }
					}
					else return null
				}).filter(m => !!m)
				return { role: 'model', parts, }
			}
		}
		else if (m.role === 'user') {
			if (typeof m.content === 'string') {
				return { role: 'user', parts: [{ text: m.content }] } satisfies GeminiLLMChatMessage
			}
			else {
				const parts: GeminiUserPart[] = m.content.map((c): GeminiUserPart | null => {
					if (c.type === 'text') {
						return { text: c.text }
					}
					else if (c.type === 'tool_result') {
						if (!latestToolName) return null
						return { functionResponse: { id: c.tool_use_id, name: latestToolName, response: { output: c.content } } }
					}
					else return null
				}).filter(m => !!m)
				return { role: 'user', parts, }
			}

		}
		else return null
	}).filter(m => !!m)

	return messages2
}


const prepareMessages = (params: {
	messages: SimpleLLMMessage[],
	systemMessage: string,
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
	specialToolFormat: 'openai-style' | 'anthropic-style' | 'gemini-style' | undefined,
	supportsAnthropicReasoning: boolean,
	contextWindow: number,
	reservedOutputTokenSpace: number | null | undefined,
	providerName: ProviderName
}): { messages: LLMChatMessage[], separateSystemMessage: string | undefined } => {

	const specialFormat = params.specialToolFormat // this is just for ts stupidness

	// if need to convert to gemini style of messaes, do that (treat as anthropic style, then convert to gemini style)
	if (params.providerName === 'gemini' || specialFormat === 'gemini-style') {
		const res = prepareOpenAIOrAnthropicMessages({ ...params, specialToolFormat: specialFormat === 'gemini-style' ? 'anthropic-style' : undefined })
		const messages = res.messages as AnthropicLLMChatMessage[]
		const messages2 = prepareGeminiMessages(messages)
		return { messages: messages2, separateSystemMessage: res.separateSystemMessage }
	}

	return prepareOpenAIOrAnthropicMessages({ ...params, specialToolFormat: specialFormat })
}




export interface IConvertToLLMMessageService {
	readonly _serviceBrand: undefined;
	prepareLLMSimpleMessages: (opts: { simpleMessages: SimpleLLMMessage[], systemMessage: string, modelSelection: ModelSelection | null, featureName: FeatureName }) => { messages: LLMChatMessage[], separateSystemMessage: string | undefined }
	prepareLLMChatMessages: (opts: { chatMessages: ChatMessage[], chatMode: ChatMode, modelSelection: ModelSelection | null }) => Promise<{ messages: LLMChatMessage[], separateSystemMessage: string | undefined }>
	prepareFIMMessage(opts: { messages: LLMFIMMessage, }): { prefix: string, suffix: string, stopTokens: string[] }
}

export const IConvertToLLMMessageService = createDecorator<IConvertToLLMMessageService>('ConvertToLLMMessageService');


class ConvertToLLMMessageService extends Disposable implements IConvertToLLMMessageService {
	_serviceBrand: undefined;

	// Optimization: cache system message to avoid repeated generation
	private _cachedSystemMessage: string | null = null;
	private _cachedSystemMessageKey: string = '';
	private _cachedSystemMessageTimestamp: number = 0;
	private readonly SYSTEM_MESSAGE_CACHE_TTL = 300000; // 300s (5 min) cache, greatly improves hit rate

	constructor(
		@IModelService private readonly modelService: IModelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@ISenweaverSettingsService private readonly senweaverSettingsService: ISenweaverSettingsService,
		@ISenweaverModelService private readonly senweaverModelService: ISenweaverModelService,
		@IMCPService private readonly mcpService: IMCPService,
		@IFileService private readonly fileService: IFileService,
		@IAPOService private readonly apoService: IAPOService,
	) {
		super()
		// Optimization: listen for file changes, but only clear cache when it truly affects system message
		// Only listen for folder creation/deletion and workspace changes, not file content changes
		// Use debounce to avoid frequent cache clearing
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		this._register(this.fileService.onDidFilesChange((e) => {
			// Check for file creation/deletion (not including file content updates)
			// File edits (UPDATED) should not affect system message cache, so we can ignore UPDATED
			const hasDirectoryChange = e.rawAdded.length > 0 || e.rawDeleted.length > 0

			// If no directory structure change (only file content updates), don't clear cache
			if (!hasDirectoryChange) {
				return
			}

			// Debounce: multiple changes within 2s only clear cache once (directory structure changes are infrequent)
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			debounceTimer = setTimeout(() => {
				this._cachedSystemMessage = null;
				debounceTimer = null;
			}, 2000); // Increased to 2s debounce since directory structure changes are infrequent
		}))
	}

	// Read .SenweaverRules files from workspace folders
	private _getSenweaverRulesFileContents(): string {
		try {
			const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
			let senweaverRules = '';
			for (const folder of workspaceFolders) {
				const uri = URI.joinPath(folder.uri, '.SenweaverRules')
				const { model } = this.senweaverModelService.getModel(uri)
				if (!model) continue
				senweaverRules += model.getValue(EndOfLinePreference.LF) + '\n\n';
			}
			return senweaverRules.trim();
		}
		catch (e) {
			return ''
		}
	}

	// Get combined AI instructions from settings and .SenweaverRules files
	private _getCombinedAIInstructions(): string {
		const globalAIInstructions = this.senweaverSettingsService.state.globalSettings.aiInstructions;
		const senweaverRulesFileContent = this._getSenweaverRulesFileContents();

		const ans: string[] = []
		if (globalAIInstructions) ans.push(globalAIInstructions)
		if (senweaverRulesFileContent) ans.push(senweaverRulesFileContent)
		return ans.join('\n\n')
	}


	// system message
	private _generateChatMessagesSystemMessage = async (chatMode: ChatMode, specialToolFormat: 'openai-style' | 'anthropic-style' | 'gemini-style' | undefined) => {
		// Optimization: generate cache key based on all factors that may affect system message
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)
		const openedURIs = this.modelService.getModels().filter(m => m.isAttachedToEditor()).map(m => m.uri.fsPath) || [];
		const activeURI = this.editorService.activeEditor?.resource?.fsPath;
		const mcpTools = this.mcpService.getMCPTools()
		const persistentTerminalIDs = this.terminalToolService.listPersistentTerminalIds()

		// Optimization: simplify cache key, only include factors that truly affect system message
		// Remove openedURIs and activeURI since they change frequently but have minimal impact
		const cacheKey = JSON.stringify({
			workspaceFolders,
			chatMode,
			specialToolFormat,
			mcpToolsCount: mcpTools?.length || 0,
			persistentTerminalIDsCount: persistentTerminalIDs.length
		})

		const now = Date.now()

		// Check if cache is valid
		if (this._cachedSystemMessage !== null &&
			this._cachedSystemMessageKey === cacheKey &&
			(now - this._cachedSystemMessageTimestamp) < this.SYSTEM_MESSAGE_CACHE_TTL) {
			return this._cachedSystemMessage
		}

		// Add timeout protection to prevent getAllDirectoriesStr from hanging
		const DIRECTORY_STR_TIMEOUT = 10000 // 10 second timeout
		let directoryStr: string
		try {
			directoryStr = await Promise.race([
				this.directoryStrService.getAllDirectoriesStr({
					cutOffMessage: chatMode === 'agent' || chatMode === 'gather' ?
						`...Directories string cut off, use tools to read more...`
						: `...Directories string cut off, ask user for more if necessary...`
				}),
				new Promise<string>((_, reject) =>
					setTimeout(() => reject(new Error('getAllDirectoriesStr timeout')), DIRECTORY_STR_TIMEOUT)
				)
			])
		} catch (error) {
			console.error('[ConvertToLLMMessageService] getAllDirectoriesStr failed or timed out:', error)
			// If timeout or failure, use a simple directory string
			directoryStr = workspaceFolders.length > 0
				? `Workspace: ${workspaceFolders.join(', ')}\n(Directory listing unavailable - use list_dir tool if needed)`
				: '(NO WORKSPACE OPEN)'
		}

		const includeXMLToolDefinitions = !specialToolFormat

		const baseSystemMessage = chat_systemMessage({ workspaceFolders, openedURIs, directoryStr, activeURI, persistentTerminalIDs, chatMode, mcpTools, includeXMLToolDefinitions })

		// Multi-Agent system: get the primary Agent for the chatMode and add its system prompt
		const agentComposition = getAgentComposition(chatMode)
		const primaryAgent = getAgentDefinition(agentComposition.primaryAgent)

		let systemMessage = baseSystemMessage

		if (primaryAgent) {
			// Build Agent-enhanced prompt
			const agentParts: string[] = []

			// Agent role description
			agentParts.push(`\n## Agent Role\nYou are currently running as **${primaryAgent.name}**. ${primaryAgent.description}`)

			// Agent-specific system prompt
			if (primaryAgent.systemPrompt) {
				agentParts.push(`\n## Agent-Specific Instructions\n${primaryAgent.systemPrompt}`)
			}

			// Available sub-agents description (if any)
			if (agentComposition.availableSubAgents.length > 0 && agentComposition.autoSelectSubAgents) {
				const subAgentDescriptions = agentComposition.availableSubAgents
					.map((id: string) => {
						const subAgent = getAgentDefinition(id)
						return subAgent ? `- **${subAgent.name}**: ${subAgent.description}` : null
					})
					.filter(Boolean)
					.join('\n')

				if (subAgentDescriptions) {
					agentParts.push(`\n## Available Specialized Sub-Agents\nFor complex tasks, you can decompose sub-tasks to the following specialized agents for parallel execution:\n${subAgentDescriptions}\n\nTip: For complex tasks involving multiple files or requiring codebase exploration, consider using the exploration agent to understand project structure first, then proceed with coding.`)
				}
			}

			// Parallel execution description
			if (agentComposition.enableParallel) {
				agentParts.push(`\n## Parallel Execution Capability\nYou support up to ${agentComposition.maxParallel} sub-tasks running in parallel. For sub-tasks that can be completed independently, prefer parallel processing to improve efficiency.`)
			}

			// Merge into system message
			if (agentParts.length > 0) {
				systemMessage = baseSystemMessage + '\n\n# Multi-Agent System' + agentParts.join('')
			}
		}

		// [APO] Inject optimized prompt rules with budget control
		// Budget prevents RL-optimized rules from bloating system message and causing context overflow
		try {
			const APO_RULES_MAX_CHARS = 2000; // ~570 tokens max for APO rules
			const apoRules = this.apoService.getOptimizedRules();
			if (apoRules.length > 0) {
				let apoContent = '';
				let rulesIncluded = 0;
				for (const rule of apoRules) {
					const candidate = apoContent + (apoContent ? '\n' : '') + rule;
					if (candidate.length > APO_RULES_MAX_CHARS) break;
					apoContent = candidate;
					rulesIncluded++;
				}
				if (apoContent) {
					const truncNote = rulesIncluded < apoRules.length ? ` (${rulesIncluded}/${apoRules.length} rules, budget limited)` : '';
					systemMessage += `\n\n# APO Optimized Rules${truncNote}\n` + apoContent;
				}
			}
		} catch {
			// APO service exception does not affect normal functionality
		}

		// Update cache
		this._cachedSystemMessage = systemMessage
		this._cachedSystemMessageKey = cacheKey
		this._cachedSystemMessageTimestamp = now

		return systemMessage
	}




	// --- LLM Chat messages ---

	/**
	 * Sanitize content that may trigger WAF
	 * WAF detects XSS attack patterns
	 */
	private _sanitizeForWAF(content: string): string {
		let sanitized = content;
		// Remove script tags
		sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, '');
		sanitized = sanitized.replace(/<script[^>]*>/gi, '');
		// Remove event handlers
		sanitized = sanitized.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
		// Remove javascript: URLs
		sanitized = sanitized.replace(/javascript\s*:/gi, '');
		// Remove iframes
		sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
		sanitized = sanitized.replace(/<iframe[^>]*>/gi, '');
		return sanitized;
	}

	/**
	 * Compress Designer mode history messages, only keep progress info
	 */
	private _compressDesignerHistory(content: string, keepCss: boolean): string {
		// Extract design plan
		const planMatch = content.match(/\[DESIGN_PLAN:START\][\s\S]*?\[DESIGN_PLAN:END\]/);
		const plan = planMatch ? planMatch[0] : '';

		// Extract progress markers
		const markers: string[] = [];
		const progress = content.match(/\[DESIGN_PROGRESS:\d+\/\d+\]/g);
		const incomplete = content.match(/\[DESIGN_INCOMPLETE:\d+\/\d+\]/g);
		const complete = content.match(/\[DESIGN_COMPLETE:\d+\/\d+\]/g);
		if (progress) markers.push(...progress);
		if (incomplete) markers.push(...incomplete);
		if (complete) markers.push(...complete);

		if (keepCss) {
			// Remove HTML, keep CSS
			let result = content.replace(/```html\s*\n[\s\S]*?```/gi, '[HTML saved]');
			result = result.replace(/```\n([\s\S]*?)```/gi, (match, code) => {
				if (code.includes('<!DOCTYPE') || code.includes('<html')) {
					return '[HTML saved]';
				}
				return this._sanitizeForWAF(match);
			});
			return this._sanitizeForWAF(result);
		}

		// Completely remove code, only keep progress
		const parts: string[] = [];
		if (plan) parts.push(plan);
		if (markers.length > 0) parts.push(markers.join(' '));

		if (parts.length > 0) return parts.join('\n');
		return '[UI completed]';
	}

	/**
	 * Smart history message compression
	 * Keep recent messages, compress older messages
	 */
	/**
	 * Smart history message compression
	 *
	 * Core idea: compression is not simple truncation, but extracting useful semantic summaries
	 * - read_file → keep file path + line count + export/function/class name list
	 * - edit_file / rewrite_file → keep operation description
	 * - search → keep search result file list
	 * - other → keep head + tail
	 */
	private _compressHistoryMessage(content: string, role: 'assistant' | 'tool' | 'user', toolName?: string): string {
		const MAX_COMPRESSED_LENGTH = 500 // Keep more context (500 chars vs 300)

		if (role === 'user') {
			if (content.length <= MAX_COMPRESSED_LENGTH) return content
			// User messages: keep head and tail, as user instructions are usually at the head, selected filenames at the tail
			const headLen = Math.floor(MAX_COMPRESSED_LENGTH * 0.6)
			const tailLen = Math.floor(MAX_COMPRESSED_LENGTH * 0.3)
			return content.slice(0, headLen) + '\n...[message truncated]...\n' + content.slice(-tailLen)
		}

		if (role === 'tool') {
			if (content.length <= MAX_COMPRESSED_LENGTH) return content

			// read_file: semantic summary — keep file path + line count + extract key identifiers
			if (toolName === 'read_file') {
				const lines = content.split('\n')
				const filePath = lines[0] || '' // First line is usually the file path

				// Extract key code identifiers (export, function, class, interface, const/let exports)
				const keyIdentifiers: string[] = []
				for (const line of lines) {
					// export declarations
					const exportMatch = line.match(/^export\s+(?:default\s+)?(?:function|class|interface|type|const|let|var|enum|abstract)\s+(\w+)/);
					if (exportMatch) { keyIdentifiers.push(exportMatch[1]); continue }
					// function/class declarations
					const declMatch = line.match(/^(?:async\s+)?(?:function|class|interface)\s+(\w+)/);
					if (declMatch) { keyIdentifiers.push(declMatch[1]); continue }
					// React component
					const reactMatch = line.match(/^(?:export\s+)?(?:const|function)\s+(\w+)\s*[=:]\s*(?:\(|React)/);
					if (reactMatch) { keyIdentifiers.push(reactMatch[1]); continue }

					if (keyIdentifiers.length >= 20) break // Extract at most 20 identifiers
				}

				const identifierStr = keyIdentifiers.length > 0
					? `\nKey identifiers: ${keyIdentifiers.join(', ')}`
					: ''
				return `[Previously read] ${filePath} (${lines.length} lines)${identifierStr}\n(Use read_file to re-read if needed)`
			}

			// search_for_files / search_pathnames_only: keep file list
			if (toolName === 'search_for_files' || toolName === 'search_pathnames_only') {
				const lines = content.split('\n').filter(l => l.trim())
				if (lines.length > 10) {
					return `[Search results: ${lines.length} files]\n${lines.slice(0, 8).join('\n')}\n... and ${lines.length - 8} more files`
				}
				return content
			}

			// ls_dir / get_dir_tree: keep first few lines of directory structure
			if (toolName === 'ls_dir' || toolName === 'get_dir_tree') {
				const lines = content.split('\n')
				if (lines.length > 15) {
					return `${lines.slice(0, 12).join('\n')}\n... [${lines.length - 12} more entries]`
				}
				return content
			}

			// edit_file / rewrite_file: these results are usually short, keep complete
			if (toolName === 'edit_file' || toolName === 'rewrite_file' || toolName === 'create_file_or_folder') {
				return content.slice(0, MAX_COMPRESSED_LENGTH)
			}

			// run_command: keep head and tail (command output head/tail are usually most useful)
			if (toolName === 'run_command') {
				const lines = content.split('\n')
				if (lines.length > 20) {
					return `${lines.slice(0, 8).join('\n')}\n...[${lines.length - 16} lines omitted]...\n${lines.slice(-8).join('\n')}`
				}
			}

			// Default compression: keep beginning
			return content.slice(0, MAX_COMPRESSED_LENGTH) + '\n...[result truncated]...'
		}

		if (role === 'assistant') {
			if (content.length <= MAX_COMPRESSED_LENGTH) return content

			// Assistant messages: keep beginning as summary
			let summary = content.slice(0, MAX_COMPRESSED_LENGTH)
			// Try to truncate at sentence or paragraph boundary
			const lastPeriod = summary.lastIndexOf('。')
			const lastNewline = summary.lastIndexOf('\n')
			const cutAt = Math.max(lastPeriod, lastNewline)
			if (cutAt > MAX_COMPRESSED_LENGTH * 0.5) {
				summary = summary.slice(0, cutAt + 1)
			}
			return summary + '\n...[response truncated]...'
		}

		return content
	}

	private _chatMessagesToSimpleMessages(chatMessages: ChatMessage[], chatMode?: string): SimpleLLMMessage[] {
		const simpleLLMMessages: SimpleLLMMessage[] = []
		const isDesigner = chatMode === 'designer';
		const total = chatMessages.length;

		// ========== Smart compression config ==========
		// Keep the most recent N messages complete, compress older messages
		const KEEP_RECENT_COUNT = 10

		// CRITICAL: Find the LAST user message index — this is the user's current input
		// and must NEVER be compressed or truncated under any circumstances
		let lastUserMsgIdx = -1;
		for (let i = total - 1; i >= 0; i--) {
			if (chatMessages[i].role === 'user') {
				lastUserMsgIdx = i;
				break;
			}
		}

		const shouldCompress = (index: number, role: string) => {
			// RULE 1: The last user message (current input) is NEVER compressed
			if (role === 'user' && index === lastUserMsgIdx) return false
			// RULE 2: Always keep the most recent messages uncompressed
			if (index >= total - KEEP_RECENT_COUNT) return false
			// RULE 3: If total message count is small, don't compress
			if (total <= KEEP_RECENT_COUNT * 1.5) return false
			return true
		}

		// Find last assistant message (for Designer mode)
		let lastAsstIdx = -1;
		if (isDesigner) {
			for (let i = total - 1; i >= 0; i--) {
				if (chatMessages[i].role === 'assistant') {
					lastAsstIdx = i;
					break;
				}
			}
		}

		for (let i = 0; i < total; i++) {
			const m = chatMessages[i];
			if (m.role === 'checkpoint') continue
			if (m.role === 'interrupted_streaming_tool') continue

			if (m.role === 'assistant') {
				let content = m.displayContent;

				// Designer mode special handling
				if (isDesigner) {
					const isRecent = i >= total - 2 || i === lastAsstIdx;
					content = this._compressDesignerHistory(content, isRecent);
				}
				// Normal mode: if not a recent message, compress
				else if (shouldCompress(i, 'assistant')) {
					content = this._compressHistoryMessage(content, 'assistant');
				}

				simpleLLMMessages.push({
					role: m.role,
					content: content,
					anthropicReasoning: m.anthropicReasoning,
				})
			}
			else if (m.role === 'tool') {
				let content = m.content;

				// Smart context management: check if tool output has been pruned (pass original content for semantic summary generation)
				if (enhancedContextManager.isToolPruned(m.id)) {
					content = enhancedContextManager.getPrunedToolContent(m.name, m.content);
				}
				// If not a recent tool call, compress
				else if (shouldCompress(i, 'tool')) {
					content = this._compressHistoryMessage(content, 'tool', m.name);
				}

				simpleLLMMessages.push({
					role: m.role,
					content: content,
					name: m.name,
					id: m.id,
					rawParams: m.rawParams,
				})
			}
			else if (m.role === 'user') {
				let content = m.content;

				// The LAST user message (current input) is NEVER compressed — highest priority
				// Historical user messages can be moderately compressed
				if (shouldCompress(i, 'user')) {
					content = this._compressHistoryMessage(content, 'user');
				}

				simpleLLMMessages.push({
					role: m.role,
					content: content,
				})
			}
		}
		return simpleLLMMessages
	}

	prepareLLMSimpleMessages: IConvertToLLMMessageService['prepareLLMSimpleMessages'] = ({ simpleMessages, systemMessage, modelSelection, featureName }) => {
		if (modelSelection === null) return { messages: [], separateSystemMessage: undefined }

		const { overridesOfModel } = this.senweaverSettingsService.state

		const { providerName, modelName } = modelSelection
		const {
			specialToolFormat,
			contextWindow,
			supportsSystemMessage,
		} = getModelCapabilities(providerName, modelName, overridesOfModel)

		const modelSelectionOptions = this.senweaverSettingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]

		// Get combined AI instructions
		const aiInstructions = this._getCombinedAIInstructions();

		const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)
		const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, { isReasoningEnabled, overridesOfModel })

		const { messages, separateSystemMessage } = prepareMessages({
			messages: simpleMessages,
			systemMessage,
			aiInstructions,
			supportsSystemMessage,
			specialToolFormat,
			supportsAnthropicReasoning: providerName === 'anthropic',
			contextWindow,
			reservedOutputTokenSpace,
			providerName,
		})
		return { messages, separateSystemMessage };
	}
	prepareLLMChatMessages: IConvertToLLMMessageService['prepareLLMChatMessages'] = async ({ chatMessages, chatMode, modelSelection }) => {
		if (modelSelection === null) return { messages: [], separateSystemMessage: undefined }

		// Add overall timeout protection to prevent message preparation from hanging
		const TOTAL_TIMEOUT = 30000 // 30 second total timeout
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('prepareLLMChatMessages total timeout')), TOTAL_TIMEOUT)
		)

		try {
			const result = await Promise.race([
				(async () => {
					const { overridesOfModel } = this.senweaverSettingsService.state

					const { providerName, modelName } = modelSelection
					const {
						specialToolFormat,
						contextWindow,
						supportsSystemMessage,
					} = getModelCapabilities(providerName, modelName, overridesOfModel)

					const { disableSystemMessage } = this.senweaverSettingsService.state.globalSettings;
					const fullSystemMessage = await this._generateChatMessagesSystemMessage(chatMode, specialToolFormat)
					const systemMessage = disableSystemMessage ? '' : fullSystemMessage;

					const modelSelectionOptions = this.senweaverSettingsService.state.optionsOfModelSelection['Chat'][modelSelection.providerName]?.[modelSelection.modelName]

					// Get combined AI instructions
					const aiInstructions = this._getCombinedAIInstructions();

					const isReasoningEnabled = getIsReasoningEnabledState('Chat', providerName, modelName, modelSelectionOptions, overridesOfModel)
					const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, { isReasoningEnabled, overridesOfModel })

					// Smart conversation compression: check if historical tool outputs need pruning before message conversion
					const usageInfo = enhancedContextManager.checkNeedsCompaction(
						chatMessages
							.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
							.map(m => ({
								role: m.role as 'user' | 'assistant' | 'tool',
								content: m.role === 'user' ? m.content :
									m.role === 'assistant' ? m.displayContent :
										m.role === 'tool' ? m.content : '',
								toolId: m.role === 'tool' ? m.id : undefined,
								toolName: m.role === 'tool' ? m.name : undefined,
							})),
						modelName
					);

					if (usageInfo.needsCompaction) {

						// Execute tool output pruning
						enhancedContextManager.pruneToolOutputs(
							chatMessages
								.filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
								.map(m => ({
									role: m.role as 'user' | 'assistant' | 'tool',
									content: m.role === 'user' ? m.content :
										m.role === 'assistant' ? m.displayContent :
											m.role === 'tool' ? m.content : '',
									toolId: m.role === 'tool' ? m.id : undefined,
									toolName: m.role === 'tool' ? m.name : undefined,
								}))
						);
					}

					const llmMessages = this._chatMessagesToSimpleMessages(chatMessages, chatMode)

					const { messages, separateSystemMessage } = prepareMessages({
						messages: llmMessages,
						systemMessage,
						aiInstructions,
						supportsSystemMessage,
						specialToolFormat,
						supportsAnthropicReasoning: providerName === 'anthropic',
						contextWindow,
						reservedOutputTokenSpace,
						providerName,
					})

					return { messages, separateSystemMessage };
				})(),
				timeoutPromise
			])
			return result
		} catch (error) {
			if (error instanceof Error && error.message.includes('timeout')) {
				console.error('[ConvertToLLMMessageService] prepareLLMChatMessages timed out. Returning minimal messages.')
				// Return a minimal valid response instead of letting the entire system hang
				return {
					messages: [{
						role: 'user' as const,
						content: chatMessages.filter(m => m.role === 'user').slice(-1)[0]?.content || 'Continue...'
					}],
					separateSystemMessage: undefined
				}
			}
			throw error
		}
	}


	// --- FIM ---

	prepareFIMMessage: IConvertToLLMMessageService['prepareFIMMessage'] = ({ messages }) => {
		// FIM requests don't add instruction prefix because:
		// 1. FIM is code completion, needs to keep original code context unpolluted
		// 2. `// Instructions:` style comments are syntax errors for Python etc.
		// 3. Model should complete based on pure code context

		const prefix = messages.prefix
		const suffix = messages.suffix
		const stopTokens = messages.stopTokens
		return { prefix, suffix, stopTokens }
	}


}


registerSingleton(IConvertToLLMMessageService, ConvertToLLMMessageService, InstantiationType.Eager);








/*
Gemini has this, but they're openai-compat so we don't need to implement this
gemini request:
{   "role": "assistant",
	"content": null,
	"function_call": {
		"name": "get_weather",
		"arguments": {
			"latitude": 48.8566,
			"longitude": 2.3522
		}
	}
}

gemini response:
{   "role": "assistant",
	"function_response": {
		"name": "get_weather",
			"response": {
			"temperature": "15°C",
				"condition": "Cloudy"
		}
	}
}
*/



