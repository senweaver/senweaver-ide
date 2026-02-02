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



const CHARS_PER_TOKEN = 4 // assume abysmal chars per token
const TRIM_TO_LEN = 500 // 增加裁剪后保留的长度，保持更多上下文




// convert messages as if about to send to openai
/*
reference - https://platform.openai.com/docs/guides/function-calling#function-calling-steps
openai MESSAGE (role=assistant):
"tool_calls":[{
	"type": "function",
	"id": "call_12345xyz",
	"function": {
	"name": "get_weather",
	"arguments": "{\"latitude\":48.8566,\"longitude\":2.3522}"
}]

openai RESPONSE (role=user):
{   "role": "tool",
	"tool_call_id": tool_call.id,
	"content": str(result)    }

also see
openai on prompting - https://platform.openai.com/docs/guides/reasoning#advice-on-prompting
openai on developer system message - https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command
*/


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

	// 智能计算输出 token 保留空间：
	// - 对于大模型（>100k tokens），保留 20-25% 用于输出
	// - 对于小模型，至少保留 4k-8k tokens
	// - 最多保留 16k tokens（避免过度占用输入空间）
	reservedOutputTokenSpace = Math.max(
		Math.min(
			contextWindow * 0.20, // 保留 20% 的上下文用于输出（而不是之前的 50%！）
			16_000 // 最多保留 16k tokens
		),
		reservedOutputTokenSpace ?? 4_096 // 默认至少 4096
	)
	let messages: (SimpleLLMMessage | { role: 'system', content: string })[] = deepClone(messages_)

	// ================ system message ================
	// A COMPLETE HACK: last message is system message for context purposes

	const sysMsgParts: string[] = []
	if (aiInstructions) sysMsgParts.push(`GUIDELINES (from the user's .SenweaverRules file):\n${aiInstructions}`)
	if (systemMessage) sysMsgParts.push(systemMessage)
	const combinedSystemMessage = sysMsgParts.join('\n\n')

	messages.unshift({ role: 'system', content: combinedSystemMessage })

	// ================ trim ================
	messages = messages.map(m => ({ ...m, content: m.role !== 'tool' ? m.content.trim() : m.content }))

	type MesType = (typeof messages)[0]

	// ================ 第一阶段：激进的消息删除（如果消息数量过多） ================
	const MAX_MESSAGES_BEFORE_AGGRESSIVE_PRUNE = 50 // 如果超过 50 条消息，先进行激进删除
	if (messages.length > MAX_MESSAGES_BEFORE_AGGRESSIVE_PRUNE) {
		// 保留：前 2 条（system + first user）+ 最后 15 条
		const keepStart = messages.slice(0, 2)
		const keepEnd = messages.slice(-15)
		messages = [...keepStart, ...keepEnd]
	}

	// ================ fit into context ================

	// the higher the weight, the higher the desire to truncate - TRIM HIGHEST WEIGHT MESSAGES
	const alreadyTrimmedIdxes = new Set<number>()
	const weight = (message: MesType, messages: MesType[], idx: number) => {
		const base = message.content.length

		let multiplier: number
		multiplier = 1 + (messages.length - 1 - idx) / messages.length // slow rampdown from 2 to 1 as index increases
		if (message.role === 'user') {
			multiplier *= 1
		}
		else if (message.role === 'system') {
			multiplier *= .01 // very low weight
		}
		else {
			multiplier *= 10 // llm tokens are far less valuable than user tokens
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

	// ================ 第二阶段：精细修剪（字符级） ================
	let totalLen = 0
	for (const m of messages) { totalLen += m.content.length }
	const availableInputTokens = contextWindow - reservedOutputTokenSpace
	const availableInputChars = availableInputTokens * CHARS_PER_TOKEN
	const charsNeedToTrim = totalLen - Math.max(
		availableInputChars,
		20_000 // 确保至少保留 20k 字符（约 5k tokens）的对话历史
	)

	// 如果还需要修剪
	if (charsNeedToTrim > 0) {
		let remainingCharsToTrim = charsNeedToTrim
		let i = 0
		const MAX_TRIM_ITERATIONS = 100 // 进一步降低迭代次数

		while (remainingCharsToTrim > 0 && i < MAX_TRIM_ITERATIONS) {
			i += 1

			const trimIdx = _findLargestByWeight(messages)

			// 安全检查：如果找不到可修剪的消息，强制退出
			if (trimIdx === -1 || !messages[trimIdx]) {
				break
			}

			const m = messages[trimIdx]

			// 安全检查：如果消息太短，跳过
			if (m.content.length <= TRIM_TO_LEN) {
				alreadyTrimmedIdxes.add(trimIdx)
				// 如果所有消息都已经很短了，还是超出上下文，那就强制删除一些
				if (alreadyTrimmedIdxes.size >= messages.length - 3) {
					if (messages.length > 10) {
						const keepStart = messages.slice(0, 2)
						const keepEnd = messages.slice(-5)
						messages = [...keepStart, ...keepEnd]
					}
					break
				}
				continue
			}

			// if can finish here, do
			const numCharsWillTrim = m.content.length - TRIM_TO_LEN
			if (numCharsWillTrim > remainingCharsToTrim) {
				// trim remainingCharsToTrim + '...'.length chars
				m.content = m.content.slice(0, m.content.length - remainingCharsToTrim - '...'.length).trim() + '...'
				break
			}

			remainingCharsToTrim -= numCharsWillTrim
			m.content = m.content.substring(0, TRIM_TO_LEN - '...'.length) + '...'
			alreadyTrimmedIdxes.add(trimIdx)
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

	// 优化：缓存系统消息，避免重复生成
	private _cachedSystemMessage: string | null = null;
	private _cachedSystemMessageKey: string = '';
	private _cachedSystemMessageTimestamp: number = 0;
	private readonly SYSTEM_MESSAGE_CACHE_TTL = 300000; // 300秒（5分钟）缓存，大幅提高命中率

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
	) {
		super()
		// 优化：监听文件变化，但只在真正影响系统消息时才清除缓存
		// 只监听文件夹的创建/删除和工作区变化，不监听文件内容变化
		// 使用防抖，避免频繁清除缓存
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		this._register(this.fileService.onDidFilesChange((e) => {
			// 检查是否有文件的创建/删除（不包括文件内容更新）
			// 文件编辑（UPDATED）不应该影响系统消息缓存，所以我们可以忽略 UPDATED
			const hasDirectoryChange = e.rawAdded.length > 0 || e.rawDeleted.length > 0

			// 如果没有目录结构变化（只有文件内容更新），不清除缓存
			if (!hasDirectoryChange) {
				return
			}

			// 防抖：2秒内多次变化只清除一次缓存（目录结构变化不频繁）
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			debounceTimer = setTimeout(() => {
				this._cachedSystemMessage = null;
				debounceTimer = null;
			}, 2000); // 增加到2秒防抖，因为目录结构变化不频繁
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
		// 优化：生成缓存键，基于可能影响系统消息的所有因素
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)
		const openedURIs = this.modelService.getModels().filter(m => m.isAttachedToEditor()).map(m => m.uri.fsPath) || [];
		const activeURI = this.editorService.activeEditor?.resource?.fsPath;
		const mcpTools = this.mcpService.getMCPTools()
		const persistentTerminalIDs = this.terminalToolService.listPersistentTerminalIds()

		// 优化：简化缓存键，只包含真正影响系统消息的因素
		// 移除 openedURIs 和 activeURI，因为它们变化频繁但影响不大
		const cacheKey = JSON.stringify({
			workspaceFolders,
			chatMode,
			specialToolFormat,
			mcpToolsCount: mcpTools?.length || 0,
			persistentTerminalIDsCount: persistentTerminalIDs.length
		})

		const now = Date.now()

		// 检查缓存是否有效
		if (this._cachedSystemMessage !== null &&
			this._cachedSystemMessageKey === cacheKey &&
			(now - this._cachedSystemMessageTimestamp) < this.SYSTEM_MESSAGE_CACHE_TTL) {
			return this._cachedSystemMessage
		}

		// 添加超时保护，避免 getAllDirectoriesStr 卡住
		const DIRECTORY_STR_TIMEOUT = 10000 // 10秒超时
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
			// 如果超时或失败，使用一个简单的目录字符串
			directoryStr = workspaceFolders.length > 0
				? `Workspace: ${workspaceFolders.join(', ')}\n(Directory listing unavailable - use list_dir tool if needed)`
				: '(NO WORKSPACE OPEN)'
		}

		const includeXMLToolDefinitions = !specialToolFormat

		const baseSystemMessage = chat_systemMessage({ workspaceFolders, openedURIs, directoryStr, activeURI, persistentTerminalIDs, chatMode, mcpTools, includeXMLToolDefinitions })

		// Multi-Agent 系统：根据 chatMode 获取对应的主 Agent，并添加其系统提示词
		const agentComposition = getAgentComposition(chatMode)
		const primaryAgent = getAgentDefinition(agentComposition.primaryAgent)

		let systemMessage = baseSystemMessage

		if (primaryAgent) {
			// 构建 Agent 增强提示词
			const agentParts: string[] = []

			// Agent 角色说明
			agentParts.push(`\n## Agent 角色\n你当前作为 **${primaryAgent.name}** 运行。${primaryAgent.description}`)

			// Agent 专属系统提示词
			if (primaryAgent.systemPrompt) {
				agentParts.push(`\n## Agent 专属指令\n${primaryAgent.systemPrompt}`)
			}

			// 可用子代理说明（如果有）
			if (agentComposition.availableSubAgents.length > 0 && agentComposition.autoSelectSubAgents) {
				const subAgentDescriptions = agentComposition.availableSubAgents
					.map((id: string) => {
						const subAgent = getAgentDefinition(id)
						return subAgent ? `- **${subAgent.name}**: ${subAgent.description}` : null
					})
					.filter(Boolean)
					.join('\n')

				if (subAgentDescriptions) {
					agentParts.push(`\n## 可调用的专业子代理\n对于复杂任务，你可以将子任务分解给以下专业代理并行执行：\n${subAgentDescriptions}\n\n提示：对于涉及多个文件或需要探索代码库的复杂任务，考虑先使用探索代理了解项目结构，再进行编码。`)
				}
			}

			// 并行执行说明
			if (agentComposition.enableParallel) {
				agentParts.push(`\n## 并行执行能力\n你支持最多 ${agentComposition.maxParallel} 个子任务并行执行。对于可以独立完成的子任务，优先考虑并行处理以提高效率。`)
			}

			// 合并到系统消息
			if (agentParts.length > 0) {
				systemMessage = baseSystemMessage + '\n\n# Multi-Agent 系统' + agentParts.join('')
			}
		}

		// 更新缓存
		this._cachedSystemMessage = systemMessage
		this._cachedSystemMessageKey = cacheKey
		this._cachedSystemMessageTimestamp = now

		return systemMessage
	}




	// --- LLM Chat messages ---

	/**
	 * 清理可能触发 WAF 的敏感内容
	 * WAF 会检测 XSS 攻击模式
	 */
	private _sanitizeForWAF(content: string): string {
		let sanitized = content;
		// 移除 script 标签
		sanitized = sanitized.replace(/<script[\s\S]*?<\/script>/gi, '');
		sanitized = sanitized.replace(/<script[^>]*>/gi, '');
		// 移除事件处理器
		sanitized = sanitized.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
		// 移除 javascript: URL
		sanitized = sanitized.replace(/javascript\s*:/gi, '');
		// 移除 iframe
		sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
		sanitized = sanitized.replace(/<iframe[^>]*>/gi, '');
		return sanitized;
	}

	/**
	 * 压缩 Designer 模式历史消息，只保留进度信息
	 */
	private _compressDesignerHistory(content: string, keepCss: boolean): string {
		// 提取设计规划
		const planMatch = content.match(/\[DESIGN_PLAN:START\][\s\S]*?\[DESIGN_PLAN:END\]/);
		const plan = planMatch ? planMatch[0] : '';

		// 提取进度标记
		const markers: string[] = [];
		const progress = content.match(/\[DESIGN_PROGRESS:\d+\/\d+\]/g);
		const incomplete = content.match(/\[DESIGN_INCOMPLETE:\d+\/\d+\]/g);
		const complete = content.match(/\[DESIGN_COMPLETE:\d+\/\d+\]/g);
		if (progress) markers.push(...progress);
		if (incomplete) markers.push(...incomplete);
		if (complete) markers.push(...complete);

		if (keepCss) {
			// 移除 HTML，保留 CSS
			let result = content.replace(/```html\s*\n[\s\S]*?```/gi, '[HTML已保存]');
			result = result.replace(/```\n([\s\S]*?)```/gi, (match, code) => {
				if (code.includes('<!DOCTYPE') || code.includes('<html')) {
					return '[HTML已保存]';
				}
				return this._sanitizeForWAF(match);
			});
			return this._sanitizeForWAF(result);
		}

		// 完全移除代码，只保留进度
		const parts: string[] = [];
		if (plan) parts.push(plan);
		if (markers.length > 0) parts.push(markers.join(' '));

		if (parts.length > 0) return parts.join('\n');
		return '[UI已完成]';
	}

	/**
	 * 智能压缩历史消息（类似 Cursor 的方式）
	 * 保留最近的消息，压缩较旧的消息
	 */
	private _compressHistoryMessage(content: string, role: 'assistant' | 'tool' | 'user', toolName?: string): string {
		const MAX_COMPRESSED_LENGTH = 300 // 压缩后最大长度

		if (role === 'user') {
			// 用户消息：如果太长，保留开头和结尾
			if (content.length <= MAX_COMPRESSED_LENGTH) return content
			const half = Math.floor(MAX_COMPRESSED_LENGTH / 2)
			return content.slice(0, half) + '\n...[message truncated]...\n' + content.slice(-half)
		}

		if (role === 'tool') {
			// 工具调用结果：只保留摘要
			if (content.length <= MAX_COMPRESSED_LENGTH) return content

			// 特殊处理：如果是文件内容，只保留文件路径和行数
			if (toolName === 'read_file' || toolName === 'list_dir' || toolName === 'glob') {
				const lines = content.split('\n')
				if (lines.length > 10) {
					return `${lines.slice(0, 5).join('\n')}\n...[${lines.length - 10} lines omitted]...\n${lines.slice(-5).join('\n')}`
				}
			}

			// 默认压缩：保留开头
			return content.slice(0, MAX_COMPRESSED_LENGTH) + '\n...[result truncated]...'
		}

		if (role === 'assistant') {
			// Assistant 消息：保留开头和关键信息
			if (content.length <= MAX_COMPRESSED_LENGTH) return content

			// 尝试提取代码块标题
			const codeBlockMatches = content.match(/```[\w]*\n/g)
			const hasCode = codeBlockMatches && codeBlockMatches.length > 0

			let summary = content.slice(0, MAX_COMPRESSED_LENGTH)
			if (hasCode) {
				summary += `\n...[contains ${codeBlockMatches.length} code block(s), truncated]...`
			} else {
				summary += '\n...[message truncated]...'
			}

			return summary
		}

		return content
	}

	private _chatMessagesToSimpleMessages(chatMessages: ChatMessage[], chatMode?: string): SimpleLLMMessage[] {
		const simpleLLMMessages: SimpleLLMMessage[] = []
		const isDesigner = chatMode === 'designer';
		const total = chatMessages.length;

		// ========== 智能压缩配置（类似 Cursor） ==========
		// 保留最近的 N 条完整消息，压缩更早的消息
		const KEEP_RECENT_COUNT = 10 // 保留最近 10 条完整消息
		const shouldCompress = (index: number) => {
			// 总是保留最近的消息
			if (index >= total - KEEP_RECENT_COUNT) return false
			// 如果消息总数很少，不压缩
			if (total <= KEEP_RECENT_COUNT * 1.5) return false
			return true
		}

		// 找最后一条 assistant 消息（用于 Designer 模式）
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

				// Designer 模式特殊处理
				if (isDesigner) {
					const isRecent = i >= total - 2 || i === lastAsstIdx;
					content = this._compressDesignerHistory(content, isRecent);
				}
				// 普通模式：如果不是最近的消息，进行压缩
				else if (shouldCompress(i)) {
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

				// 智能上下文管理: 检查工具输出是否已被裁剪
				if (enhancedContextManager.isToolPruned(m.id)) {
					content = enhancedContextManager.getPrunedToolContent(m.name);
				}
				// 如果不是最近的工具调用，进行压缩
				else if (shouldCompress(i)) {
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

				// 用户消息相对重要，但也可以适度压缩
				if (shouldCompress(i)) {
					content = this._compressHistoryMessage(content, 'user');
				}

				simpleLLMMessages.push({
					role: m.role,
					content: m.content, // 实际上用户消息通常不长，保持原样
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

		// 添加整体超时保护，防止消息准备卡住
		const TOTAL_TIMEOUT = 30000 // 30秒总超时
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

					// 智能会话压缩：在消息转换前检查是否需要裁剪历史工具输出
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

						// 执行工具输出裁剪
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
				// 返回一个最小的有效响应，而不是让整个系统卡死
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
		// FIM 请求不添加指令前缀，因为：
		// 1. FIM 是代码补全，需要保持原始代码上下文不被污染
		// 2. `// Instructions:` 这样的注释对 Python 等语言是语法错误
		// 3. 模型应该根据纯粹的代码上下文来补全

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



