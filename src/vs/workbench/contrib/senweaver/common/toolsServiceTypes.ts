import { URI } from '../../../../base/common/uri.js'
import { RawMCPToolCall } from './mcpServiceTypes.js';
import { builtinTools } from './prompt/prompts.js';
import { RawToolParamsObj } from './sendLLMMessageTypes.js';



export type TerminalResolveReason = { type: 'timeout' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// 代码变更统计
export type CodeChangeStats = {
	linesAdded: number;
	linesRemoved: number;
	isNewFile?: boolean; // 标记是否为新创建的文件
}

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}


export const approvalTypeOfBuiltinToolName: Partial<{ [T in BuiltinToolName]?: 'edits' | 'terminal' | 'MCP tools' }> = {
	'create_file_or_folder': 'edits',
	'delete_file_or_folder': 'edits',
	'rewrite_file': 'edits',
	'edit_file': 'edits',
	'run_command': 'terminal',
	'run_persistent_command': 'terminal',
	'open_persistent_terminal': 'terminal',
	'kill_persistent_terminal': 'terminal',
}


export type ToolApprovalType = NonNullable<(typeof approvalTypeOfBuiltinToolName)[keyof typeof approvalTypeOfBuiltinToolName]>;


export const toolApprovalTypes = new Set<ToolApprovalType>([
	...Object.values(approvalTypeOfBuiltinToolName),
	'MCP tools',
])




// PARAMS OF TOOL CALL
export type BuiltinToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, pageNumber: number },
	'ls_dir': { uri: URI, pageNumber: number },
	'get_dir_tree': { uri: URI },
	'search_pathnames_only': { query: string, includePattern: string | null, pageNumber: number },
	'search_for_files': { query: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	'search_in_file': { uri: URI, query: string, isRegex: boolean },
	'read_lint_errors': { uri: URI },
	// ---
	'rewrite_file': { uri: URI, newContent: string },
	'edit_file': { uri: URI, searchReplaceBlocks: string },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	// ---
	'run_command': { command: string; cwd: string | null, terminalId: string },
	'open_persistent_terminal': { cwd: string | null },
	'run_persistent_command': { command: string; persistentTerminalId: string },
	'kill_persistent_terminal': { persistentTerminalId: string },
	// ---
	'open_browser': { url: string, headless: boolean },
	'fetch_url': { url: string, method?: string, headers?: string, body?: string, max_length?: number, start_index?: number, crawl_links?: boolean, max_pages?: number, max_depth?: number },
	'web_search': { query: string, max_results?: number },
	// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
	// 'clone_website': { url: string, maxPages?: number, maxDepth?: number, sameDomainOnly?: boolean },
	'analyze_image': { image_data: string, prompt?: string, api_key?: string, model?: string },
	'screenshot_to_code': { source: 'image' | 'url', image_data?: string, url?: string, stack?: string, custom_prompt?: string },
	'api_request': { url: string, method?: string, headers?: Record<string, string>, body?: string, auth?: { type: string, username?: string, password?: string, token?: string, key?: string, value?: string, addTo?: string }, timeout?: number },
	'read_document': { uri: URI, startIndex?: number, maxLength?: number },
	'edit_document': { uri: URI, content: string, backup?: boolean, replacements?: Array<{ find: string, replace: string, bold?: boolean, italic?: boolean }> },
	'create_document': {
		type: 'word' | 'excel' | 'ppt',
		file_path: string,
		document_data: {
			title?: string,
			subtitle?: string,
			sections?: Array<{
				heading?: string,
				paragraphs?: Array<string | { text: string, bold?: boolean, italic?: boolean, align?: string }>,
				table?: string[][]
			}>,
			sheets?: Array<{
				name?: string,
				data?: any[][],
				json?: any[],
				column_widths?: number[],
				formulas?: Array<{ cell: string, formula: string }>
			}>,
			slides?: Array<{
				title?: string,
				subtitle?: string,
				content?: string[],
				bullets?: string[],
				image?: string,
				layout?: 'title' | 'content' | 'two_column' | 'image' | 'blank'
			}>
		},
		options?: { header?: string, footer?: string, theme?: string, template?: 'auto' | 'none' | 'academic_cn_gb' | 'academic_en_apa7' | 'academic_en_ieee' }
	},
	'pdf_operation': {
		operation: 'merge' | 'split' | 'watermark',
		input_files?: string[],
		input_file?: string,
		output_path?: string,
		output_dir?: string,
		watermark_text?: string,
		options?: {
			from_page?: number,
			to_page?: number,
			pages_per_file?: number,
			font_size?: number,
			opacity?: number,
			angle?: number
		}
	},
	'document_convert': {
		input_file: string,
		output_path: string,
		format?: 'pdf' | 'docx' | 'images' | 'xlsx' | 'wps',
		options?: { dpi?: number, quality?: number, merge_images?: boolean }
	},
	'document_merge': {
		input_files: string[],
		output_path: string,
		options?: { output_name?: string, preserve_formatting?: boolean }
	},
	'document_extract': {
		input_file: string,
		output_dir: string,
		extract_type: 'images' | 'text' | 'slides',
		options?: { format?: string, quality?: number }
	},
	// ========== 高级 Agent 工具 ==========
	'spawn_subagent': {
		label: string,
		task_prompt: string,
		summary_prompt: string,
		context_low_prompt: string,
		timeout_ms?: number,
		allowed_tools?: string[]
	},
	'edit_agent': {
		uri: URI,
		mode: 'edit' | 'create' | 'overwrite',
		description: string,
		current_content?: string,
		selection_range?: { start_line: number, end_line: number }
	},
	// ========== Skill 工具 ==========
	'skill': {
		name: string,
	},
}

// RESULT OF TOOL CALL
export type BuiltinToolResultType = {
	'read_file': { fileContents: string, totalFileLen: number, totalNumLines: number, hasNextPage: boolean },
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_tree': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_for_files': { uris: URI[], hasNextPage: boolean },
	'search_in_file': { lines: number[]; },
	'read_lint_errors': { lintErrors: LintErrorItem[] | null },
	// ---
	'rewrite_file': Promise<{ lintErrors: LintErrorItem[] | null, changeStats?: CodeChangeStats }>,
	'edit_file': Promise<{ lintErrors: LintErrorItem[] | null, changeStats?: CodeChangeStats }>,
	'create_file_or_folder': { changeStats?: CodeChangeStats },
	'delete_file_or_folder': {},
	// ---
	'run_command': { result: string; resolveReason: TerminalResolveReason; },
	'run_persistent_command': { result: string; resolveReason: TerminalResolveReason; },
	'open_persistent_terminal': { persistentTerminalId: string },
	'kill_persistent_terminal': {},
	// ---
	'open_browser': { url?: string, title?: string, status?: number, headless?: boolean },
	'fetch_url': { statusCode: number, headers: Record<string, string>, body: string, contentLength?: number, hasMore?: boolean, nextIndex?: number },
	'web_search': { results: Array<{ title: string, url: string, snippet: string, engine?: string }>, totalResults: number },
	// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
	// 'clone_website': {
	// 	success: boolean,
	// 	url: string,
	// 	summary?: {
	// 		title: string,
	// 		description: string,
	// 		pagesCount: number,
	// 		errorsCount: number,
	// 		images: number,
	// 		forms: number,
	// 		buttons: number,
	// 		colors: string[],
	// 		fonts: string[],
	// 		frameworks: string[],
	// 		layout?: any,
	// 		responsive?: any,
	// 		semanticHTML5?: boolean,
	// 		processingTime: string
	// 	},
	// 	pages?: Array<{ url: string, title: string, description: string, headings: any[], images: number, colors: string[], layout: any, depth: number }>,
	// 	sitemap?: Array<{ url: string, title: string, depth: number }>,
	// 	resources?: Array<{ url: string, contentType: string, size: number }>,
	// 	errors?: Array<{ url: string, error: string }>,
	// 	metadata?: any,
	// 	error?: string
	// },
	'analyze_image': {
		success: boolean,
		method?: string,
		// API分析结果（主要）
		analysis?: string,
		model?: string,
		// 本地分析结果（补充）
		localAnalysis?: {
			basicInfo?: {
				width: number,
				height: number,
				format: string,
				size: number,
				sizeFormatted: string,
				channels: number,
				hasAlpha: boolean,
				orientation: number
			},
			quality?: {
				aspectRatio: string,
				megapixels: string,
				colorSpace: string,
				density: string | number
			},
			colors?: {
				channels?: Array<{ channel: string, mean: number, min: number, max: number, stdDev: number }>,
				dominant?: Array<{ rgb: string, hex: string, percentage: string }>
			},
			description?: string,
			ocrText?: string
		},
		// 元数据
		metadata?: {
			localSuccess: boolean,
			apiSuccess: boolean,
			usage?: any,
			processingTime: string
		},
		// 错误信息
		validationError?: boolean,
		// 向后兼容（旧格式）
		basicInfo?: {
			width: number,
			height: number,
			format: string,
			size: number,
			sizeFormatted: string,
			channels: number,
			hasAlpha: boolean,
			orientation: number
		},
		quality?: {
			aspectRatio: string,
			megapixels: string,
			colorSpace: string,
			density: string | number
		},
		colors?: {
			channels?: Array<{ channel: string, mean: number, min: number, max: number, stdDev: number }>,
			dominant?: Array<{ rgb: string, hex: string, percentage: string }>
		},
		description?: string,
		ocrText?: string,
		usage?: any,
		processingTime?: string,
		error?: string
	},
	'screenshot_to_code': {
		success: boolean,
		code?: string,
		stack?: string,
		model?: string,
		usage?: any,
		processingTime?: string,
		error?: string,
		// 多页面导航信息
		navigation?: {
			pageTitle?: string,
			pageUrl?: string,
			linkedPages: Array<{ url: string, text: string, type: string }>,
			totalLinkedPages: number
		},
		// 源码提取信息
		sourceExtracted?: {
			colors: number,
			fonts: number,
			layout?: any,
			cssClasses: number
		}
	},
	'api_request': {
		success: boolean,
		statusCode: number,
		statusText?: string,
		headers: Record<string, any>,
		body: string,
		bodyFormatted?: string,
		bodyParsed?: any,
		bodyFormat?: string,
		responseTime?: number,
		contentType?: string,
		contentLength?: number,
		error?: string
	},
	'read_document': {
		success: boolean,
		content: string,
		fileType: string,
		pages: number,
		contentLength: number,
		hasMore: boolean,
		nextIndex: number,
		startIndex: number,
		metadata?: {
			format: string,
			extractedAs: string,
			sheets?: string[],
			info?: any
		},
		error?: string,
		suggestion?: string
	},
	'edit_document': {
		success: boolean,
		filePath: string,
		fileType: string,
		size: number,
		sheets?: number,
		backupPath?: string,
		error?: string,
		suggestion?: string
	},
	'create_document': {
		success: boolean,
		filePath: string,
		fileType: string,
		size: number,
		sheets?: number,
		sections?: number,
		slides?: number,
		error?: string,
		warning?: string,
		wasJsonRepaired?: boolean,
	},
	'pdf_operation': {
		success: boolean,
		operation: string,
		filePath?: string,
		outputDir?: string,
		fileType: string,
		size?: number,
		mergedFiles?: number,
		splitFiles?: number,
		totalPages?: number,
		pages?: number,
		files?: string[],
		error?: string
	},
	'document_convert': {
		success: boolean,
		inputFile: string,
		outputPath: string,
		sourceFormat: string,
		targetFormat: string,
		size?: number,
		pages?: number,
		sheets?: number,
		images?: string[],
		error?: string
	},
	'document_merge': {
		success: boolean,
		outputPath: string,
		mergedFiles: number,
		fileType: string,
		size?: number,
		error?: string
	},
	'document_extract': {
		success: boolean,
		inputFile: string,
		outputDir: string,
		extractType: string,
		extractedCount: number,
		files?: string[],
		error?: string
	},
	// ========== 高级 Agent 工具结果 ==========
	'spawn_subagent': {
		success: boolean,
		taskId: string,
		summary: string,
		toolCalls: Array<{ tool: string, params: unknown, result: unknown }>,
		executionTime: number,
		timedOut?: boolean,
		contextExhausted?: boolean,
		error?: string
	},
	'edit_agent': {
		success: boolean,
		taskId: string,
		edits?: Array<{
			uri: URI,
			oldContent: string,
			newContent: string,
			changes: Array<{ startLine: number, endLine: number, oldText: string, newText: string }>
		}>,
		executionTime: number,
		error?: string
	},
	// ========== Skill 工具结果 ==========
	'skill': {
		success: boolean,
		name: string,
		content: string,
		baseDir?: string,
		error?: string
	},
}


export type ToolCallParams<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolCallParams[T] : RawToolParamsObj
export type ToolResult<T extends BuiltinToolName | (string & {})> = T extends BuiltinToolName ? BuiltinToolResultType[T] : RawMCPToolCall

export type BuiltinToolName = keyof BuiltinToolResultType

type BuiltinToolParamNameOfTool<T extends BuiltinToolName> = keyof (typeof builtinTools)[T]['params']
export type BuiltinToolParamName = { [T in BuiltinToolName]: BuiltinToolParamNameOfTool<T> }[BuiltinToolName]


export type ToolName = BuiltinToolName | (string & {})
export type ToolParamName<T extends ToolName> = T extends BuiltinToolName ? BuiltinToolParamNameOfTool<T> : string
