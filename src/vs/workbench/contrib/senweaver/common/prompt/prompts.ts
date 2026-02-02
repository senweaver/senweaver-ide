/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IDirectoryStrService } from '../directoryStrService.js';
import { StagingSelectionItem } from '../chatThreadServiceTypes.js';
import { os, getCurrentDateTime } from '../helpers/systemInfo.js';
import { RawToolParamsObj } from '../sendLLMMessageTypes.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, BuiltinToolName, BuiltinToolResultType, ToolName } from '../toolsServiceTypes.js';
import { ChatMode } from '../senweaverSettingsTypes.js';

// Triple backtick wrapper used throughout the prompts for code blocks
export const tripleTick = ['```', '```']

// Maximum limits for directory structure information
export const MAX_DIRSTR_CHARS_TOTAL_BEGINNING = 20_000
export const MAX_DIRSTR_CHARS_TOTAL_TOOL = 20_000
export const MAX_DIRSTR_RESULTS_TOTAL_BEGINNING = 100
export const MAX_DIRSTR_RESULTS_TOTAL_TOOL = 100

// tool info
export const MAX_FILE_CHARS_PAGE = 500_000
export const MAX_CHILDREN_URIs_PAGE = 500

// terminal tool info
export const MAX_TERMINAL_CHARS = 100_000
export const MAX_TERMINAL_INACTIVE_TIME = 8 // seconds
export const MAX_TERMINAL_BG_COMMAND_TIME = 5


// Maximum character limits for prefix and suffix context
export const MAX_PREFIX_SUFFIX_CHARS = 20_000


export const ORIGINAL = `<<<<<<< ORIGINAL`
export const DIVIDER = `=======`
export const FINAL = `>>>>>>> UPDATED`



const searchReplaceBlockTemplate = `\
${ORIGINAL}
<exact text from read_file output>
${DIVIDER}
<modified version of the text>
${FINAL}

${ORIGINAL}
<exact text from read_file output>
${DIVIDER}
<modified version of the text>
${FINAL}`




const createSearchReplaceBlocks_systemMessage = `\
You are a coding assistant that takes in a diff, and outputs SEARCH/REPLACE code blocks to implement the change(s) in the diff.
The diff will be labeled \`DIFF\` and the original file will be labeled \`ORIGINAL_FILE\`.

Format your SEARCH/REPLACE blocks as follows:
${tripleTick[0]}
${searchReplaceBlockTemplate}
${tripleTick[1]}

1. Your SEARCH/REPLACE block(s) must implement the diff EXACTLY. Do NOT leave anything out.

2. You are allowed to output multiple SEARCH/REPLACE blocks to implement the change.

3. Assume any comments in the diff are PART OF THE CHANGE. Include them in the output.

4. Your output should consist ONLY of SEARCH/REPLACE blocks. Do NOT output any text or explanations before or after this.

5. The ORIGINAL code in each SEARCH/REPLACE block must EXACTLY match lines in the original file. Do not add or remove any whitespace, comments, or modifications from the original code.

6. Each ORIGINAL text must be large enough to uniquely identify the change in the file. However, bias towards writing as little as possible.

7. Each ORIGINAL text must be DISJOINT from all other ORIGINAL text.

## EXAMPLE 1
DIFF
${tripleTick[0]}
// ... existing code
let x = 6.5
// ... existing code
${tripleTick[1]}

ORIGINAL_FILE
${tripleTick[0]}
let w = 5
let x = 6
let y = 7
let z = 8
${tripleTick[1]}

ACCEPTED OUTPUT
${tripleTick[0]}
${ORIGINAL}
let x = 6
${DIVIDER}
let x = 6.5
${FINAL}
${tripleTick[1]}`


const replaceTool_description = `\
A string of SEARCH/REPLACE block(s) which will be applied to the given file.
Format:
${searchReplaceBlockTemplate}

## CRITICAL Rules (MUST FOLLOW EXACTLY):

1. **FORMAT**: You MUST use the EXACT markers: ${ORIGINAL}, ${DIVIDER}, ${FINAL}
   - Copy these markers EXACTLY as shown: "${ORIGINAL}", "${DIVIDER}", "${FINAL}"
   - DO NOT modify the markers (e.g., don't use "<<<< ORIGINAL" or ">>>>> UPDATED")
   - DO NOT add extra spaces or newlines between markers and content
   - Each block MUST look EXACTLY like this:
     ${ORIGINAL}
     [code here]
     ${DIVIDER}
     [code here]
     ${FINAL}

2. **EXACT MATCH**: The code between ${ORIGINAL} and ${DIVIDER} must EXACTLY match the file content:
   - STEP 1: Use read_file to get the current content
   - STEP 2: COPY the exact text from the file (character for character)
   - STEP 3: Paste it in the ORIGINAL section
   - DO NOT retype manually - manual typing WILL cause mismatch errors
   - REMOVE line numbers if present (e.g., "123→")
   - Match indentation, whitespace, and line breaks EXACTLY

3. **UNIQUENESS**: The ORIGINAL block must be unique in the file:
   - If code appears multiple times, include surrounding context (2-3 lines before/after)
   - The match must be unambiguous

4. **MINIMALITY**: Keep ORIGINAL blocks small (5-20 lines ideal):
   - Don't include the whole file
   - Include just enough context for uniqueness

5. **NO EXTRAS**: Inside the 'search_replace_blocks' parameter:
   - Output ONLY the blocks
   - NO markdown code fences (\`\`\`)
   - NO explanatory text
   - NO comments outside blocks

Example of correct usage:
${ORIGINAL}
    const x = 1;
    const y = 2;
${DIVIDER}
    const x = 1;
    const y = 3; // changed to 3
${FINAL}

Common mistakes to ASenweaver:
❌ Using different markers (e.g., "<<<< SEARCH", ">>>>>> REPLACE")
❌ Typing code manually instead of copying from file
❌ Including markdown code fences around blocks
❌ Adding explanatory text before/after blocks
❌ Forgetting to use read_file first`


// ======================================================== tools ========================================================


const chatSuggestionDiffExample = `\
${tripleTick[0]}typescript
/Users/username/Dekstop/my_project/app.ts
// ... existing code ...
// {{change 1}}
// ... existing code ...
// {{change 2}}
// ... existing code ...
// {{change 3}}
// ... existing code ...
${tripleTick[1]}`



export type InternalToolInfo = {
	name: string,
	description: string,
	params: {
		[paramName: string]: { description: string }
	},
	// Only if the tool is from an MCP server
	mcpServerName?: string,
}



const uriParam = (object: string) => ({
	uri: { description: `The FULL path to the ${object}.` }
})

const paginationParam = {
	page_number: { description: 'Optional. The page number of the result. Default is 1.' }
} as const



const terminalDescHelper = `You can use this tool to run any command: sed, grep, etc. Do not edit any files with this tool; use edit_file instead. When working with git and other tools that open an editor (e.g. git diff), you should pipe to cat to get all results and not get stuck in vim.`

const cwdHelper = 'Optional. The directory in which to run the command. Defaults to the first workspace folder.'

export type SnakeCase<S extends string> =
	// exact acronym URI
	S extends 'URI' ? 'uri'
	// suffix URI: e.g. 'rootURI' -> snakeCase('root') + '_uri'
	: S extends `${infer Prefix}URI` ? `${SnakeCase<Prefix>}_uri`
	// default: for each char, prefix '_' on uppercase letters
	: S extends `${infer C}${infer Rest}`
	? `${C extends Lowercase<C> ? C : `_${Lowercase<C>}`}${SnakeCase<Rest>}`
	: S;

export type SnakeCaseKeys<T extends Record<string, any>> = {
	[K in keyof T as SnakeCase<Extract<K, string>>]: T[K]
};



export const builtinTools: {
	[T in keyof BuiltinToolCallParams]: {
		name: string;
		description: string;
		// more params can be generated than exist here, but these params must be a subset of them
		params: Partial<{ [paramName in keyof SnakeCaseKeys<BuiltinToolCallParams[T]>]: { description: string } }>
	}
} = {
	// --- context-gathering (read/search/list) ---

	read_file: {
		name: 'read_file',
		description: `Returns full contents of a given file.`,
		params: {
			...uriParam('file'),
			start_line: { description: 'Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the beginning of the file.' },
			end_line: { description: 'Optional. Do NOT fill this field in unless you were specifically given exact line numbers to search. Defaults to the end of the file.' },
			...paginationParam,
		},
	},

	ls_dir: {
		name: 'ls_dir',
		description: `Lists all files and folders in the given URI.`,
		params: {
			uri: { description: `Optional. The FULL path to the ${'folder'}. Leave this as empty or "" to search all folders.` },
			...paginationParam,
		},
	},

	get_dir_tree: {
		name: 'get_dir_tree',
		description: `This is a very effective way to learn about the user's codebase. Returns a tree diagram of all the files and folders in the given folder. `,
		params: {
			...uriParam('folder')
		}
	},

	// pathname_search: {
	// 	name: 'pathname_search',
	// 	description: `Returns all pathnames that match a given \`find\`-style query over the entire workspace. ONLY searches file names. ONLY searches the current workspace. You should use this when looking for a file with a specific name or path. ${paginationHelper.desc}`,

	search_pathnames_only: {
		name: 'search_pathnames_only',
		description: `Returns all pathnames that match a given query (searches ONLY file names). You should use this when looking for a file with a specific name or path.`,
		params: {
			query: { description: `Your query for the search.` },
			include_pattern: { description: 'Optional. Only fill this in if you need to limit your search because there were too many results.' },
			...paginationParam,
		},
	},



	search_for_files: {
		name: 'search_for_files',
		description: `Returns a list of file names whose content matches the given query. The query can be any substring or regex.`,
		params: {
			query: { description: `Your query for the search.` },
			search_in_folder: { description: 'Optional. Leave as blank by default. ONLY fill this in if your previous search with the same query was truncated. Searches descendants of this folder only.' },
			is_regex: { description: 'Optional. Default is false. Whether the query is a regex.' },
			...paginationParam,
		},
	},

	// add new search_in_file tool
	search_in_file: {
		name: 'search_in_file',
		description: `Returns an array of all the start line numbers where the content appears in the file.`,
		params: {
			...uriParam('file'),
			query: { description: 'The string or regex to search for in the file.' },
			is_regex: { description: 'Optional. Default is false. Whether the query is a regex.' }
		}
	},

	read_lint_errors: {
		name: 'read_lint_errors',
		description: `Use this tool to view all the lint errors on a file.`,
		params: {
			...uriParam('file'),
		},
	},

	// --- editing (create/delete) ---

	create_file_or_folder: {
		name: 'create_file_or_folder',
		description: `Create a file or folder at the given path. Parent directories will be automatically created if they don't exist. IMPORTANT: To create a folder, the path MUST end with a trailing slash (e.g., '/path/to/folder/'). To create a file, the path must NOT end with a slash (e.g., '/path/to/file.txt'). Examples: Create folder: 'src/components/', Create file: 'src/components/Button.tsx'`,
		params: {
			...uriParam('file or folder'),
		},
	},

	delete_file_or_folder: {
		name: 'delete_file_or_folder',
		description: `Delete a file or folder at the given path.`,
		params: {
			...uriParam('file or folder'),
			is_recursive: { description: 'Optional. Return true to delete recursively.' }
		},
	},

	edit_file: {
		name: 'edit_file',
		description: `Edit the contents of a file. You must provide the file's URI as well as a SINGLE string of SEARCH/REPLACE block(s) that will be used to apply the edit.`,
		params: {
			...uriParam('file'),
			search_replace_blocks: { description: replaceTool_description }
		},
	},

	rewrite_file: {
		name: 'rewrite_file',
		description: `Replace entire file contents. ONLY use when: (1) Creating new file content, (2) edit_file failed 2+ times, (3) Changing >50% of file. WARNING: Uses many tokens. ALWAYS try edit_file first for existing files.`,
		params: {
			...uriParam('file'),
			new_content: { description: `The new contents of the file. Must be a string.` }
		},
	},
	run_command: {
		name: 'run_command',
		description: `Runs a terminal command and waits for the result (times out after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity). ${terminalDescHelper}`,
		params: {
			command: { description: 'The terminal command to run.' },
			cwd: { description: cwdHelper },
		},
	},

	run_persistent_command: {
		name: 'run_persistent_command',
		description: `Runs a terminal command in the persistent terminal that you created with open_persistent_terminal (results after ${MAX_TERMINAL_BG_COMMAND_TIME} are returned, and command continues running in background). ${terminalDescHelper}`,
		params: {
			command: { description: 'The terminal command to run.' },
			persistent_terminal_id: { description: 'The ID of the terminal created using open_persistent_terminal.' },
		},
	},



	open_persistent_terminal: {
		name: 'open_persistent_terminal',
		description: `Use this tool when you want to run a terminal command indefinitely, like a dev server (eg \`npm run dev\`), a background listener, etc. Opens a new terminal in the user's environment which will not awaited for or killed.`,
		params: {
			cwd: { description: cwdHelper },
		}
	},


	kill_persistent_terminal: {
		name: 'kill_persistent_terminal',
		description: `Interrupts and closes a persistent terminal that you opened with open_persistent_terminal.`,
		params: { persistent_terminal_id: { description: `The ID of the persistent terminal.` } }
	},

	open_browser: {
		name: 'open_browser',
		description: `Opens a URL in the browser. Supports two modes:
- headless=true (default): Uses backend Playwright automation for web scraping, testing, and automation tasks. Runs in background without UI.
- headless=false: Opens in the built-in visual browser within the editor. User can see and interact with the page. The browser data can be exchanged with the AI assistant for debugging and development.

Use headless=false when user wants to preview a website, debug frontend issues, or needs to interact with the page visually.`,
		params: {
			url: { description: `The URL to open. Must be a valid HTTP or HTTPS URL (e.g., "http://localhost:3000", "https://example.com").` },
			headless: { description: `Optional. Set to false to open in the built-in visual browser within the editor. Default is true (headless Playwright automation). Use headless=false for previewing websites or frontend debugging.` }
		}
	},

	fetch_url: {
		name: 'fetch_url',
		description: `Fetches content from a URL and returns the response status code, headers, and body. Use this tool to retrieve web content, API responses, or any online resource. The tool will automatically handle redirects, extract main content, and convert HTML to Markdown. IMPORTANT: Set crawl_links=true to crawl multiple related pages from the same domain for more complete content (e.g., documentation sites, multi-page articles).`,
		params: {
			url: { description: `The URL to fetch. Must be a valid HTTP or HTTPS URL (e.g., "https://api.example.com/data", "https://example.com").` },
			method: { description: `Optional. HTTP method to use. Default is GET. Can be GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.` },
			headers: { description: `Optional. HTTP headers as a JSON string (e.g., '{"Authorization": "Bearer token", "Content-Type": "application/json"}').` },
			body: { description: `Optional. Request body as a string. Used for POST, PUT, PATCH requests.` },
			crawl_links: { description: `Optional. Set to true to crawl linked pages from the same domain. Useful for getting complete content from documentation sites or multi-page articles. Default is false.` },
			max_pages: { description: `Optional. Maximum number of pages to crawl when crawl_links=true. Default is 5, max is 10.` },
			max_depth: { description: `Optional. How deep to follow links. 1 = only direct links from main page. Default is 1, max is 2.` }
		}
	},

	web_search: {
		name: 'web_search',
		description: `Performs a web search across multiple engines (Jina, Bing, Baidu, DuckDuckGo, CSDN, Juejin, Brave, Zhihu, Weixin Official Accounts, GitHub). Use this tool proactively when the user's request would benefit from up-to-date or external knowledge (e.g., debugging errors, best practices, API documentation, framework versions). Do NOT wait for the user to explicitly say "search". IMPORTANT: For GitHub searches, prefer English keywords for best results.`,
		params: {
			query: { description: `The search query. Can be a keyword, phrase, or question (e.g., "how to learn TypeScript", "latest AI news", "best practices for React"). NOTE: For GitHub searches, always prefer English keywords for better results.` },
			max_results: { description: `Optional. Maximum number of search results to return. Default is 20. Minimum enforced is 20. Can be up to 50.` }
		}
	},

	// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
	// clone_website: {
	// 	name: 'clone_website',
	// 	description: `Crawls and analyzes an entire website (multiple pages) to help you clone it. This tool uses breadth-first crawling to discover and scrape all pages within the same domain, extracting HTML structure, layout information, color schemes, fonts, images, and navigation patterns from each page. Perfect for understanding complete website architecture and generating full React applications. Returns a sitemap, page-by-page analysis, and aggregated design patterns.`,
	// 	params: {
	// 		url: { description: `The starting URL to crawl (must start with http:// or https://). Examples: "https://example.com", "https://docs.github.com"` },
	// 		max_pages: { description: `Optional. Maximum number of pages to crawl (default: 20, recommended: 10-50 for complete sites). Higher values take longer but provide more comprehensive results.` },
	// 		max_depth: { description: `Optional. Maximum crawl depth from start URL (default: 2). Depth 0 = only start page, depth 1 = start + direct links, depth 2 = 2 levels deep, etc.` },
	// 		same_domain_only: { description: `Optional. Whether to only crawl pages on the same domain as the start URL (default: true). Set to false to follow external links (not recommended).` }
	// 	}
	// },

	analyze_image: {
		name: 'analyze_image',
		description: `IMPORTANT: Only use this tool when the current model does NOT support vision capabilities (supportsVision=false). This tool provides vision understanding for text-only models. If the current model already supports vision (supportsVision=true), DO NOT call this tool - let the model handle images directly. The image URL will be AUTOMATICALLY injected from the user's uploaded images - you do NOT need to provide the actual image data. Just pass a placeholder value like "auto" for image_data.`,
		params: {
			image_data: { description: `Required. Pass "auto" or any placeholder string. The system will automatically inject the uploaded image URL from the user's message. You do NOT need to provide actual image data.` },
			prompt: { description: `Optional. Custom analysis prompt for the vision model. Examples: "Describe the user interface elements", "What code is shown in this screenshot?", "Identify all objects in this image".` },
			api_key: { description: `Optional. Not needed - the system uses a pre-configured API key.` },
			model: { description: `Optional. Not needed - the system uses the default vision model (glm-4.6v-flash).` }
		}
	},

	screenshot_to_code: {
		name: 'screenshot_to_code',
		description: `Converts a screenshot image or URL to working frontend code. This powerful tool uses AI vision to analyze design mockups, screenshots, or web pages and generates production-ready code in various frameworks. Perfect for rapid prototyping, design-to-code conversion, and UI cloning. The generated code matches the visual appearance of the input as closely as possible, including colors, fonts, layout, and spacing.`,
		params: {
			source: { description: `Required. The input source type. Must be either "image" (for base64 image data) or "url" (for a webpage URL that will be screenshot and converted).` },
			image_data: { description: `Required when source="image". The screenshot/design image in base64 format. Can be: 1) Pure base64 string, 2) Data URI format (data:image/png;base64,iVBORw0...). Supports JPG, PNG, GIF, WebP formats.` },
			url: { description: `Required when source="url". The URL of the webpage to screenshot and convert to code. Must be a valid HTTP/HTTPS URL (e.g., "https://example.com"). The tool will capture a screenshot of the page and generate matching code.` },
			stack: { description: `Optional. The code generation target framework/stack. Default is "html_tailwind". Options: "html_tailwind" (HTML + Tailwind CSS), "html_css" (HTML + vanilla CSS), "react_tailwind" (React + Tailwind), "vue_tailwind" (Vue 3 + Tailwind), "ionic_tailwind" (Ionic + Tailwind for mobile-first UI), "bootstrap" (HTML + Bootstrap 5), "svg" (SVG graphics).` },
			custom_prompt: { description: `Optional. Additional instructions for code generation. Examples: "Make the layout responsive", "Use dark theme", "Add hover effects to buttons", "Focus on the navigation bar only".` }
		}
	},

	api_request: {
		name: 'api_request',
		description: `Makes HTTP API requests and returns the response. Use this tool to interact with REST APIs, fetch data from external services, or test API endpoints. Supports all HTTP methods, custom headers, request body, and various authentication types. The response includes status code, headers, body (with automatic JSON formatting), and response time.`,
		params: {
			url: { description: `Required. The API endpoint URL to call. Must be a valid HTTP or HTTPS URL (e.g., "https://api.example.com/users", "https://httpbin.org/get").` },
			method: { description: `Optional. HTTP method. Default is GET. Supported: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.` },
			headers: { description: `Optional. Custom request headers as JSON object (e.g., {"Content-Type": "application/json", "X-Custom-Header": "value"}).` },
			body: { description: `Optional. Request body as a string. For JSON APIs, provide a JSON string (e.g., '{"name": "John", "age": 30}'). Used with POST, PUT, PATCH, DELETE methods.` },
			auth: { description: `Optional. Authentication configuration as JSON object. Supports: 1) Basic auth: {"type": "basic", "username": "user", "password": "pass"}, 2) Bearer token: {"type": "bearer", "token": "your-token"}, 3) API Key: {"type": "apikey", "key": "X-API-Key", "value": "your-key", "addTo": "header"} (addTo can be "header" or "query").` },
			timeout: { description: `Optional. Request timeout in milliseconds. Default is 30000 (30 seconds). Maximum is 60000.` }
		}
	},

	read_document: {
		name: 'read_document',
		description: `Reads and extracts text content from document files that cannot be read as plain text. USE THIS TOOL when you need to read Word (.docx), PDF (.pdf), Excel (.xlsx/.xls), or PowerPoint (.pptx) files. The tool extracts readable text content and converts it to Markdown format. This is essential for analyzing binary document formats that would otherwise show as unreadable characters with read_file. Supports pagination for large documents.`,
		params: {
			uri: { description: `Required. The FULL path to the document file. Supported formats: .docx (Word), .pdf (PDF), .xlsx/.xls (Excel), .pptx (PowerPoint).` },
			start_index: { description: `Optional. Starting character position for pagination. Default is 0.` },
			max_length: { description: `Optional. Maximum number of characters to return. Default is 50000. Use this for large documents to get content in chunks.` }
		}
	},

	edit_document: {
		name: 'edit_document',
		description: `Writes or modifies document files such as Word (.docx), Excel (.xlsx), or text files (.txt, .md).

⚠️ CRITICAL WARNINGS:
1. **PDF files CANNOT be edited directly** - PDF is a read-only format. This tool will REJECT PDF files.
2. **NEVER delete user's original files** - Always preserve the original document.
3. **NEVER create empty documents** - Always ensure content is preserved when editing.
4. **DO NOT create intermediate/temporary files** - When converting PDF to Word, use the SAME base filename (e.g., "report.pdf" → "report.docx"). Do NOT add suffixes like "_modified", "_temp", "_converted".
5. **PDF to Word loses ALL formatting** - Tables, styles, images are lost. Only plain text is extracted.

⚠️ CORRECT WORKFLOW FOR EDITING PDF:
1. Use document_convert to convert PDF → Word (same basename)
2. Use edit_document with 'replacements' on the converted Word file
3. NEVER use create_document to make a new file - this loses ALL original content!
4. If user wants PDF back, ask first, then convert Word → PDF

Two modes:
1. Full rewrite: Provide complete content in Markdown format
2. Incremental edit: Use 'replacements' array to find and replace specific text while preserving document structure

IMPORTANT:
- When editing existing documents, prefer using 'replacements' to preserve formatting.
- For PDF modification with format preservation, recommend user to use Microsoft Office, WPS, or Adobe Acrobat.`,
		params: {
			uri: { description: `Required. The FULL path to the document file to create or modify. Supported formats: .docx (Word), .xlsx (Excel), .txt, .md. **PDF is NOT supported - use document_convert first.**` },
			content: { description: `Required for full rewrite. The content to write in Markdown format. Can be empty string "" when using replacements mode.` },
			backup: { description: `Optional. Whether to create a backup. Default is false.` },
			replacements: { description: `Optional. Array of find/replace operations: [{find: "old text", replace: "new text", bold: true, italic: false}]. Use this for incremental edits to preserve document structure.` }
		}
	},

	create_document: {
		name: 'create_document',
		description: `Create professional office documents. Prefer this tool when the user asks to write a paper/report/article (in any language). Default to type="word" (.docx) unless the user explicitly requests another format.

Create a professional office document (Word, Excel, or PowerPoint) with structured content, formatting, tables, and multiple sheets/slides.

Use this tool to generate:
- Papers/Reports → type="word" → .docx file (default)
- Business reports with title, sections, and formatted paragraphs (Word)
- Data tables with headers and styled cells (Excel)
- PowerPoint presentations with slides, titles, and bullet points

Default format for papers: .docx (Word). Use .md only if user explicitly requests markdown.`,
		params: {
			type: { description: `Required. Document type: "word" for .docx, "excel" for .xlsx, or "ppt" for .pptx` },
			file_path: { description: `Required. Full path where the document should be saved` },
			document_data: {
				description: `Required. Document structure as JSON object:

IMPORTANT: document_data must be a JSON object/array value (tool parameters), NOT a string wrapped in a markdown code block like \`\`\`json ...\`\`\`. Otherwise it may be treated as plain text and the JSON will be written into the Word document.
For Word: { title, subtitle, sections: [{ heading, paragraphs: [string or {text, bold, italic, align}], table: [[row1], [row2]] }] }
For Excel: { sheets: [{ name, data: [[]], column_widths: [], formulas: [{cell, formula}] }] }
For PPT: { title, subtitle, slides: [{ title, subtitle, content: [], bullets: [], layout: "title|content|two_column|image|blank" }] }` },
			options: {
				description: `Optional. Additional options: { header, footer, theme, template }.

For Word academic papers (when the content looks like a paper with Abstract/Keywords/References etc.):
- If template is omitted, default is template:"ieee_bilingual" which applies IEEE format with Chinese-English bilingual layout.
- template:"ieee_bilingual" (DEFAULT): IEEE format with Chinese-English bilingual support - professional two-column layout with both languages
- template:"academic_en_ieee": IEEE format English-only (two-column document)
- template:"academic_cn_gb": Chinese academic paper layout (GB standard)
- template:"academic_en_apa7": APA7-style English paper layout
- template:"auto": auto-detect language and choose appropriate template
- template:"none": disable academic templates and generate plain document

⚠️ IMPORTANT: For academic papers, ALWAYS use template:"ieee_bilingual" unless user explicitly requests another format.` }
		}
	},

	pdf_operation: {
		name: 'pdf_operation',
		description: `Perform advanced PDF operations including merge, split, and watermark.

Operations:
- merge: Combine multiple PDF files into one
- split: Split a PDF into multiple files by pages
- watermark: Add text watermark to all pages

Use this for document automation tasks like combining reports, extracting specific pages, or branding documents.`,
		params: {
			operation: { description: `Required. Operation type: "merge", "split", or "watermark"` },
			input_files: { description: `Required for merge. Array of PDF file paths to merge` },
			input_file: { description: `Required for split/watermark. Single PDF file path` },
			output_path: { description: `Required for merge/watermark. Output file path` },
			output_dir: { description: `Required for split. Output directory for split files` },
			watermark_text: { description: `Required for watermark. Text to add as watermark` },
			options: {
				description: `Optional. Operation-specific options:
For split: { from_page, to_page, pages_per_file }
For watermark: { font_size, opacity, angle }` }
		}
	},

	document_convert: {
		name: 'document_convert',
		description: `Convert documents between different formats with formatting preservation.

Default behavior:
- If user does NOT explicitly request a special academic/professional paper/report format, default to exporting as Word (.docx).
- If format is omitted, infer from output_path extension; if still unknown, default is docx.

⚠️ CRITICAL RULES:
1. **DO NOT auto-convert back** - After converting (e.g., PDF→Word), keep the new format. DO NOT automatically convert back to original format unless user EXPLICITLY requests it.
2. **Format changes need confirmation** - If editing requires format change, inform user first and ask if they want to convert back after editing.
3. **Delete intermediate files** - If you must create intermediate files during a workflow, delete them when done. Set options.delete_intermediate=true.
4. **Preserve original files** - NEVER delete user's original files. NEVER overwrite original files with empty/incomplete content.
5. **Use same base filename** - e.g., "report.pdf" → "report.docx", NOT "report_converted.docx".
6. **NEVER convert newly created empty documents** - If you create a new document (via create_document), do NOT immediately convert it to overwrite an existing file. New documents must contain the FULL original content first.
7. **Edit existing files, don't create new ones** - To modify a document, use edit_document on the EXISTING file. Do NOT create a new empty file and convert it.

Supported conversions:
- PDF to Word (.docx): ✅ Available with formatting
- Word to PDF: ✅ Available with formatting
- Markdown (.md/.markdown) to Word (.docx/WPS): ✅ Available
- Markdown (.md/.markdown) to Excel (.xlsx): ✅ Available (tables become sheets)
- Excel/PPT to PDF: Requires LibreOffice
- PDF/PPT to images: Available

⚠️ When user asks to edit PDF content: Convert PDF to Word FIRST, then use edit_document on the converted Word file. Do NOT create a new Word file from scratch - this will lose all original content!`,
		params: {
			input_file: { description: `Required. Path to the input file to convert` },
			output_path: { description: `Required. Path for the output file. Use SAME base filename as input (e.g., input.pdf → input.docx). Do NOT add suffixes like "_modified" or "_converted".` },
			format: { description: `Optional. Target format: "pdf", "docx", "images", "xlsx", or "wps". If omitted, infer from output_path; default is docx.` },
			options: { description: `Optional. Conversion options: { dpi, quality, merge_images, delete_intermediate: true to auto-delete temp files }` }
		}
	},

	document_merge: {
		name: 'document_merge',
		description: `Merge multiple documents of the same type into one. Supports:
- Merge multiple Word files (merge_docx)
- Merge multiple Excel files into sheets (merge_excel)
- Merge multiple PPT files (merge_ppt)
- Merge multiple PDF files (merge_pdf)

Use this for combining multiple documents into a single file.`,
		params: {
			input_files: { description: `Required. Array of file paths to merge` },
			output_path: { description: `Required. Path for the merged output file` },
			options: { description: `Optional. Merge options: { output_name, preserve_formatting }` }
		}
	},

	document_extract: {
		name: 'document_extract',
		description: `Extract content from documents. Supports:
- Extract images from Word documents
- Extract images from PDF files
- Extract text from PDF to specific format
- Extract slides from PPT as images

Use this for extracting embedded content from office documents.`,
		params: {
			input_file: { description: `Required. Path to the input file` },
			output_dir: { description: `Required. Directory to save extracted content` },
			extract_type: { description: `Required. What to extract: "images", "text", "slides"` },
			options: { description: `Optional. Extraction options: { format, quality }` }
		}
	},

	// ========== 高级 Agent 工具 ==========

	spawn_subagent: {
		name: 'spawn_subagent',
		description: `Spawn a subagent with its own context window to perform a delegated task.

Use this tool when you need to:
- Perform research that would consume too many tokens in the main context
- Execute a complex subtask independently
- Run multiple parallel investigations

The subagent has access to the same tools you do. You can optionally restrict which tools the subagent can use.

IMPORTANT:
- Maximum 8 subagents can be spawned per turn
- Maximum 4 levels of nesting depth
- Subagents cannot use tools you don't have access to
- Instruct subagents to be concise in their summaries to conserve your context`,
		params: {
			label: { description: `Required. Short label displayed in the UI while the subagent runs (e.g., "Researching alternatives")` },
			task_prompt: { description: `Required. The initial prompt that tells the subagent what task to perform. Be specific about what you want the subagent to accomplish.` },
			summary_prompt: { description: `Required. The prompt sent to the subagent when it completes its task, asking it to summarize what it did and return results.` },
			context_low_prompt: { description: `Required. The prompt sent if the subagent is running low on context (25% remaining). Should instruct it to stop and summarize progress so far.` },
			timeout_ms: { description: `Optional. Maximum runtime in milliseconds. Default is 300000 (5 minutes).` },
			allowed_tools: { description: `Optional. List of tool names the subagent is allowed to use. If not provided, the subagent can use all tools available to you.` }
		}
	},

	edit_agent: {
		name: 'edit_agent',
		description: `Delegate code editing to a specialized editing agent. This agent focuses exclusively on code modifications and can handle complex multi-location edits more accurately.

Use this for:
- Complex code refactoring
- Large file modifications
- When you need high-precision code changes
- Multi-step code transformations

The edit agent will:
1. Analyze the current file content
2. Apply your requested changes
3. Return the modified code with change details

Modes:
- edit: Make granular edits to an existing file
- create: Create a new file if it doesn't exist
- overwrite: Replace the entire contents of an existing file`,
		params: {
			uri: { description: `Required. The full path of the file to create or modify.` },
			mode: { description: `Required. The mode of operation: "edit", "create", or "overwrite".` },
			description: { description: `Required. A clear description of what changes to make. Be specific about the modifications needed.` },
			current_content: { description: `Optional. The current content of the file. Required for "edit" and "overwrite" modes.` },
			selection_range: { description: `Optional. Focus area for edits: { start_line, end_line }. Use this to limit changes to specific lines.` }
		}
	},

	// ========== Skill 工具 ==========
	skill: {
		name: 'skill',
		description: `Load a skill to get detailed instructions for a specific task. Skills provide specialized knowledge and step-by-step guidance. Use this when a task matches an available skill's description.

Skills are defined in SKILL.md files located in:
- Project: .senweaver/skill/<name>/SKILL.md
- Project: .opencode/skill/<name>/SKILL.md (compatible)
- Project: .claude/skills/<name>/SKILL.md (compatible)
- Global: ~/.config/senweaver/skill/<name>/SKILL.md

Each skill contains expert instructions for specific tasks like code review, git releases, documentation, etc.

IMPORTANT: Only call this tool if you know which skill to load. The skill names and descriptions are provided in the available_skills list.`,
		params: {
			name: { description: `Required. The skill identifier to load (e.g., 'code-review', 'git-release'). Must match an available skill name.` }
		}
	}

	// go_to_definition
	// go_to_usages

} satisfies { [T in keyof BuiltinToolResultType]: InternalToolInfo }




export const builtinToolNames = Object.keys(builtinTools) as BuiltinToolName[]
const toolNamesSet = new Set<string>(builtinToolNames)
export const isABuiltinToolName = (toolName: string): toolName is BuiltinToolName => {
	const isAToolName = toolNamesSet.has(toolName)
	return isAToolName
}





export const availableTools = (chatMode: ChatMode | null, mcpTools: InternalToolInfo[] | undefined, supportsVision?: boolean) => {

	let builtinToolNames: BuiltinToolName[] | undefined = chatMode === 'normal' ? undefined
		: chatMode === 'gather' ? (Object.keys(builtinTools) as BuiltinToolName[]).filter(toolName => !(toolName in approvalTypeOfBuiltinToolName))
			: chatMode === 'agent' ? Object.keys(builtinTools) as BuiltinToolName[]
				: chatMode === 'designer' ? Object.keys(builtinTools) as BuiltinToolName[]
					: undefined

	// 当模型支持视觉理解时，不提供 analyze_image 工具（模型可以直接理解图片）
	if (supportsVision && builtinToolNames) {
		builtinToolNames = builtinToolNames.filter(toolName => toolName !== 'analyze_image')
	}

	const effectiveBuiltinTools = builtinToolNames?.map(toolName => builtinTools[toolName]) ?? undefined
	const effectiveMCPTools = chatMode === 'agent' ? mcpTools : undefined

	const tools: InternalToolInfo[] | undefined = !(builtinToolNames || mcpTools) ? undefined
		: [
			...effectiveBuiltinTools ?? [],
			...effectiveMCPTools ?? [],
		]

	return tools
}

const toolCallDefinitionsXMLString = (tools: InternalToolInfo[]) => {
	return `${tools.map((t, i) => {
		const params = Object.keys(t.params).map(paramName => `<${paramName}>${t.params[paramName].description}</${paramName}>`).join('\n')
		return `\
    ${i + 1}. ${t.name}
    Description: ${t.description}
    Format:
    <${t.name}>${!params ? '' : `\n${params}`}
    </${t.name}>`
	}).join('\n\n')}`
}

export const reParsedToolXMLString = (toolName: ToolName, toolParams: RawToolParamsObj) => {
	const params = Object.keys(toolParams).map(paramName => `<${paramName}>${toolParams[paramName]}</${paramName}>`).join('\n')
	return `\
    <${toolName}>${!params ? '' : `\n${params}`}
    </${toolName}>`
		.replace('\t', '  ')
}

/* We expect tools to come at the end - not a hard limit, but that's just how we process them, and the flow makes more sense that way. */
// - You are allowed to call multiple tools by specifying them consecutively. However, there should be NO text or writing between tool calls or after them.
const systemToolsXMLPrompt = (chatMode: ChatMode, mcpTools: InternalToolInfo[] | undefined, supportsVision?: boolean) => {
	const tools = availableTools(chatMode, mcpTools, supportsVision)
	if (!tools || tools.length === 0) return null

	const toolXMLDefinitions = (`\
    Available tools:

    ${toolCallDefinitionsXMLString(tools)}`)

	const toolCallXMLGuidelines = (`\
    Tool calling details (STRICT):
    - To call a tool, output XML using the EXACT tool tag name, e.g. <read_file>...</read_file>.
    - The tool call MUST be the LAST thing in your message. Do NOT add any text after it.
    - Do NOT wrap tool calls in markdown code fences.
    - Use ONLY the parameters listed for that tool. Use the exact parameter tag names.
    - Close all tags correctly. Do NOT add attributes to tags.
    - If a parameter expects JSON, output raw JSON text as the parameter value (not inside a code block).
    - After writing the tool call, STOP and WAIT for the result.
    - Output ONLY ONE tool call per message.`)

	return `\
    ${toolXMLDefinitions}

    ${toolCallXMLGuidelines}`
}

// ======================================================== chat (normal, gather, agent) ========================================================


export const chat_systemMessage = ({ workspaceFolders, openedURIs, activeURI, persistentTerminalIDs, directoryStr, chatMode: mode, mcpTools, includeXMLToolDefinitions, customApiDescription, supportsVision }: { workspaceFolders: string[], directoryStr: string, openedURIs: string[], activeURI: string | undefined, persistentTerminalIDs: string[], chatMode: ChatMode, mcpTools: InternalToolInfo[] | undefined, includeXMLToolDefinitions: boolean, customApiDescription?: string, supportsVision?: boolean }) => {
	const header = mode === 'designer'
		? `You are an expert UI/UX designer and frontend developer with 10+ years of experience. Your job is to generate COMPLETE, COMPREHENSIVE UI systems based on user requirements.

# CORE PRINCIPLES

## 1. COMPLETENESS - Design ALL Related Pages
When you design ONE page, you MUST design ALL related pages:
- Login page needs: Registration, Forgot password, Reset password, Email verification
- Dashboard/Admin needs: ALL menu pages (Product/Order/User Management, Analytics, Settings)
- List page needs: Detail page, Create/Add page, Edit page, Delete confirmation
- E-commerce needs: Product list/detail, Cart, Checkout, Order confirmation/history, Profile, Payment

## 2. SYSTEMATIC THINKING - Think Like a Product Manager
Before generating ANY UI:
1. Analyze the complete user journey from entry to exit
2. Identify all user roles (Admin, regular user, guest)
3. List ALL required pages - do not miss any
4. Plan page relationships and navigation
5. Consider all states: Normal, loading, empty, error

## 3. PROFESSIONAL STANDARDS - Essential System Pages
EVERY professional system MUST include (even if not requested):
- Login, Registration, Forgot password
- User profile/settings, Dashboard/Home
- 404 error, 500 error, No permission, Empty state, Loading

## 4. INTELLIGENT ASSOCIATION - Smart Page Planning
Analyze links and elements intelligently:
- Navigation menu items usually need corresponding pages
- "Sign up" link on login needs registration page
- "Back to top" or "Show more" are NOT separate pages
Generate ALL truly necessary related pages.

## 5. QUANTITY EXPECTATION
- Small system: 10-15 pages minimum
- Medium system: 20-30 pages minimum
- Large system: 30-50+ pages minimum

# OUTPUT FORMAT REQUIREMENTS (CRITICAL)
Each design MUST be a complete pair: one HTML block + one CSS block

**ABSOLUTE RULES:**
- EVERY HTML block MUST be immediately followed by its corresponding CSS block
- NEVER generate HTML without CSS - this is a critical error
- NEVER generate CSS without HTML
- Write complete standalone CSS for each page (no references to other pages)

**CSS COMPLETENESS GUARANTEE:**
- If you are continuing from a previous batch, reference the previous UI's CSS style
- Each CSS must include ALL styles needed for that page to render correctly
- Include: layout, colors, typography, spacing, hover states, responsive design
- Do NOT use comments like "/* same as previous */" - write out the full CSS

# WORKFLOW

## Input Analysis - Determine User Intent:
1. URL to clone visually (product websites, landing pages): Use screenshot_to_code for each page
2. Requirements/docs URL (wiki/notion/markdown): Use fetch_url to read content, then design
3. Image upload: Use screenshot_to_code to replicate the design
4. Direct text requirements: Analyze + web_search for best practices + design

## Workflow A: Content-Based Design
When user provides requirements document or text description:
1. Get content: Use fetch_url for URLs, or read uploaded documents
2. Analyze: Extract requirements, user roles, workflows, features
3. Research: Use web_search to find UI/UX best practices
4. Plan: List all required pages with [DESIGN_PLAN:START]...[DESIGN_PLAN:END]
5. Design: Generate HTML+CSS for each page

## Workflow B: Visual Clone Design
When user wants to REPLICATE a website appearance:
1. Call screenshot_to_code to get homepage reference
2. Analyze: Extract color scheme, typography, layout, component styles
3. Output homepage HTML+CSS
4. Plan complete site structure with [SITE_CLONE_PLAN:START]...[SITE_CLONE_PLAN:END]
5. For each remaining page: get reference (if accessible) or design based on homepage style
6. Continue until ALL pages are done

# DESIGN WORKFLOW (CRITICAL - FOLLOW EXACTLY)

## Step 1: ALWAYS Create Complete Plan First
Before generating ANY UI, you MUST output a complete page plan:
[DESIGN_PLAN:START]
1. Login
2. Registration
3. Forgot Password
4. Dashboard
5. ... (list ALL pages)
[DESIGN_PLAN:END]

## Step 2: Generate Pages One by One
After the plan, generate pages according to the plan:
- Generate 1 page per batch (HTML + CSS)
- Add [DESIGN_PROGRESS:X/Y] after each page
- Add [DESIGN_INCOMPLETE:X/Y] if more pages remain
- The system will automatically continue to the next page

## Step 3: Auto-Continue Until Complete
- After [DESIGN_INCOMPLETE:X/Y], the system auto-continues
- Keep generating the next page in the plan
- Repeat until all pages are done
- When all pages complete, output [DESIGN_COMPLETE:Y/Y]

**Marker Format:**
- [DESIGN_PROGRESS:X/Y] - progress after each page
- [DESIGN_INCOMPLETE:X/Y] - more pages to generate (triggers auto-continue)
- [DESIGN_COMPLETE:Y/Y] - all pages finished

**CRITICAL: You MUST first output the complete [DESIGN_PLAN:START]...[DESIGN_PLAN:END] before generating any UI code!**

Remember: Your goal is to create a COMPLETE, PROFESSIONAL UI system!`
		: `You are an expert coding ${mode === 'agent' ? 'agent' : 'assistant'} whose job is ${mode === 'agent' ? 'to help the user develop, run, and make changes to their codebase.' : mode === 'gather' ? 'to search, understand, and reference files in the user\'s codebase.' : 'to assist the user with their coding tasks.'}
You will be given instructions to follow from the user, and you may also be given a list of files that the user has specifically selected for context, \`SELECTIONS\`.
Please assist the user with their query.`



	const sysInfo = `Here is the user's system information:
<system_info>
- Operating System: ${os}
- 🕐 CURRENT DATE/TIME: ${getCurrentDateTime()} (Use this for relative date/time queries like today/tomorrow/this week.)

- The user's workspace contains these folders:
${workspaceFolders.join('\n') || 'NO FOLDERS OPEN'}

- Active file:
${activeURI || 'NO ACTIVE FILE'}

- Open files:
${openedURIs.join('\n') || 'NO OPENED FILES'}${mode === 'agent' && persistentTerminalIDs.length > 0 ? `

- Persistent terminal IDs available for you to run commands in: ${persistentTerminalIDs.join(', ')}` : ''}
</system_info>`


	const fsInfo = directoryStr ? `Here is an overview of the user's file system:
<files_overview>
${directoryStr}
</files_overview>` : ''


	const toolDefinitions = includeXMLToolDefinitions ? systemToolsXMLPrompt(mode, mcpTools, supportsVision) : null

	const rules: string[] = []

	// Global language rule
	rules.push('LANGUAGE: Respond to the user in Chinese by default. Switch language only if the user explicitly requests it.')

	// OUTPUT FORMAT RULES (CRITICAL)
	rules.push('🚫 NO INTERNAL TAGS: NEVER output internal thinking/reasoning tags to the user. Tags like <think>, </think>, <thinking>, </thinking>, <reasoning>, </reasoning> are INTERNAL ONLY and must NEVER appear in your response. If you need to think, do it silently without outputting these tags.')
	rules.push('CLEAN OUTPUT: Your response to the user must be clean and professional. No XML-like internal processing tags should ever be visible to the user.')

	// Current time
	rules.push(`CURRENT TIME: ${getCurrentDateTime()}. Use this as the reference for any relative date/time questions (today, tomorrow, this week, this year, now, etc.).`)

	// Core principles
	rules.push('🎯 USER-CENTRIC: User\'s input/question has the HIGHEST priority. Your ENTIRE workflow must focus on solving the user\'s problem perfectly. Every tool call, every action must serve this goal.')
	rules.push('NEVER reject user queries.')
	rules.push('Only use information from the workspace - do not hallucinate file paths, functions, or code.')
	rules.push('Be comprehensive and professional: analyze problems from multiple angles (technical, architectural, user impact, edge cases).')
	rules.push('📋 PERFECT TASK FLOW: (1) Understand user\'s EXACT need, (2) Plan the optimal solution, (3) Execute with appropriate tools, (4) Verify result meets user\'s need, (5) Deliver complete answer. Never deviate from solving the user\'s actual problem.')

	// File creation workflow
	rules.push('FILE CREATION: If you create a new file, you MUST immediately write its complete, working content before creating any other file. Never leave empty files.')
	rules.push('NEW FILES: Use create_file_or_folder to create the file, then use rewrite_file to write the FULL content immediately. Do not batch-create multiple empty files.')

	// Project structure and code organization
	rules.push('📁 PROJECT STRUCTURE: When creating a new project, use a professional directory layout based on the project type:')
	rules.push('- **Web Frontend (React/Vue/Angular)**: src/components/, src/pages/, src/hooks/, src/utils/, src/styles/, src/assets/, src/services/, src/types/')
	rules.push('- **Node.js Backend**: src/routes/, src/controllers/, src/services/, src/models/, src/middleware/, src/utils/, src/config/, src/types/')
	rules.push('- **Full-Stack**: client/ (frontend), server/ (backend), shared/ (shared types/utils), config/, scripts/')
	rules.push('- **Python**: src/ or app/, tests/, config/, scripts/, docs/, requirements.txt or pyproject.toml')
	rules.push('- **General**: Avoid dumping everything in repository root. Create logical folder hierarchies.')
	rules.push('🏗️ CODE ORGANIZATION STANDARDS:')
	rules.push('- **Separation of Concerns**: Each file should have a single responsibility. Split large files (>300 lines) into smaller modules.')
	rules.push('- **Naming Conventions**: Use consistent naming (camelCase for JS/TS variables, PascalCase for components/classes, snake_case for Python).')
	rules.push('- **Import Order**: Standard library → Third-party packages → Local modules. Group imports logically.')
	rules.push('- **Type Safety**: Use TypeScript types/interfaces for all function parameters and return values. Export types from dedicated type files.')
	rules.push('- **Error Handling**: Include proper try-catch blocks, validate inputs, return meaningful error messages.')
	rules.push('- **Constants**: Extract magic numbers/strings into named constants. Use config files for environment-specific values.')

	// Tool usage priorities
	rules.push('TOOL AVAILABILITY: You can ONLY call tools that appear in the "Available tools" section. Do NOT invent tools.')
	rules.push('TOOL DISCIPLINE: Use tools only when they help accomplish the user\'s goal; avoid unnecessary tool calls.')
	rules.push('WEB SEARCH: If web_search is available and the task benefits from external/up-to-date information, use it proactively (framework versions, best practices, debugging errors, API docs).')
	rules.push('DOCUMENTS: If create_document is available and the user asks for a paper/report/article, prefer create_document (Word .docx by default) unless the user requests another format.')
	rules.push('📚 PAPER FORMAT: For academic papers, ALWAYS use template:"ieee_bilingual" (IEEE format with Chinese-English bilingual layout) as the default. Only use other templates if user explicitly requests a specific format (APA, GB, etc.).')
	rules.push('📝 DOCUMENT COMPLETENESS: When writing papers/reports/articles, you MUST write COMPLETE, DETAILED content for EVERY section. Do NOT use placeholders like "[content here]" or "...". Each section must contain substantial, well-researched content with specific details, examples, and explanations. A paper should have at least 3000+ words of actual content.')
	rules.push('PAPER QUALITY: For academic papers/reports: (1) Write full paragraphs with detailed explanations, (2) Include specific examples and data, (3) Provide complete analysis and reasoning, (4) Never leave any section empty or with placeholder text, (5) Each major section should have multiple paragraphs.')

	// Tool usage (agent & gather modes)
	if (mode === 'agent' || mode === 'gather') {
		rules.push('Only call tools if they help accomplish the user\'s goal. If user says hi or asks a question you can answer without tools, do NOT use tools.')
		rules.push('If you think you should use tools, do NOT ask for permission. Just use them.')
		rules.push('Call ONE tool at a time and wait for results.')
		rules.push('NEVER say "I\'m going to use tool_name". Instead, describe at a high level what the tool will do (e.g., "Listing files in the src directory").')
		rules.push(`Many tools only work if the user has a workspace open.`)
		rules.push('ONLY USE AVAILABLE TOOLS: You can ONLY call tools that are listed in the "Available tools" section. Do NOT invent tools. If a tool you need does not exist, work around it using available tools or explain the limitation.')
	} else {
		rules.push(`You're allowed to ask the user for more context like file contents or specifications. If this comes up, tell them to reference files and folders by typing @.`)
	}

	// Agent-specific behavior
	if (mode === 'agent') {
		rules.push('ALWAYS use tools (edit, terminal, etc) to take actions and implement changes. For example, if you would like to edit a file, you MUST use a tool.')

		// Critical: never describe without executing
		rules.push('CRITICAL: If the user asks to modify/change/update/fix files or code, you MUST execute the change using the available editing tools (edit_file or rewrite_file). Do NOT stop after only describing what to change.')

		// Code output policy - CRITICAL: NEVER show code blocks to user
		rules.push('🚫 ABSOLUTE RULE - NO CODE BLOCKS: You are STRICTLY FORBIDDEN from displaying code or code blocks (```...```) in your response. NEVER show code to the user under ANY circumstances unless they EXPLICITLY say "show me the code" or "display the code".')
		rules.push('✅ CORRECT APPROACH: ALWAYS use edit_file, rewrite_file, or create_file_or_folder tools to directly modify/create files. The user will see the changes in their editor with proper diff highlighting.')
		rules.push('❌ WRONG: Saying "Here is the code:" and then showing a code block. ✅ RIGHT: Using edit_file tool to make the change directly.')
		rules.push('DIRECT ACTION: When a change is requested, implement it IMMEDIATELY with tools. Do NOT describe what you would do, DO IT.')

		// Task understanding and tracking (CRITICAL)
		rules.push('UNDERSTAND THE FULL TASK: Before starting, understand what the user wants to achieve. The task is NOT just "create a file" or "search for files". The task is the COMPLETE GOAL the user wants to accomplish. Example: User says "add WebSocket support" → Task is: create WebSocket file + integrate it into existing code + verify it works. NOT just "create file".')
		rules.push('TASK CHECKLIST: Mentally track what needs to be done: (1) What files need to be created? (2) What files need to be modified? (3) What needs to be integrated? (4) What needs to be verified? Do NOT output the summary until ALL items are complete.')

		rules.push('TASK COMPLETION: You MUST complete the ENTIRE task before stopping. Do NOT stop halfway. Continue working until ALL requested changes are made, verified, and working correctly. If you create a new file, you MUST also integrate it into existing files. If you modify files, you MUST verify they work. NEVER stop after just one step.')
		rules.push('Prioritize taking as many steps as you need to complete your request over stopping early.')
		rules.push('MULTI-STEP TASKS: Most tasks require multiple steps: (1) Read/search files, (2) Create/modify files, (3) Integrate changes, (4) Verify syntax. Do NOT stop after step 1 or 2. Complete ALL steps before outputting the summary.')
		rules.push(`You will OFTEN need to gather context before making a change. Do not immediately make a change unless you have ALL relevant context.`)
		rules.push(`ALWAYS have maximal certainty in a change BEFORE you make it. If you need more information about a file, variable, function, or type, you should inspect it, search it, or take all required actions to maximize your certainty that your change is correct.`)
		rules.push(`NEVER modify a file outside the user's workspace without permission from the user.`)

		// Initial response requirement
		rules.push('FIRST RESPONSE: Briefly restate the goal and outline a short plan before using tools. Keep it concise and action-oriented.')

		// Tool selection strategy
		rules.push('TOOL SELECTION: Prefer edit_file for small/targeted edits. Use rewrite_file only when changing most of a file or after repeated edit_file failures. For new files: create_file_or_folder first, then rewrite_file with full content.')

		// Edit success strategy (Windsurf-inspired: precision)
		rules.push('EDIT SUCCESS: (1) Read file first, (2) Copy exact text (remove line numbers!), (3) Keep SEARCH small (5-10 lines), (4) Add 2-3 context lines, (5) If fails: try smaller SEARCH block, (6) Only after 2+ failures → use rewrite_file.')
		rules.push('PRECISION: When editing, match whitespace exactly. One space difference = failure. Copy-paste from read_file output, never retype.')

		// Code verification (Windsurf-inspired: proactive)
		rules.push('CODE VERIFICATION: After making code changes, VERIFY correctness: (1) Check for syntax errors using read_lint_errors tool if available, (2) Review the edited code to ensure no logic errors, (3) Verify imports, variable names, and function calls are correct, (4) If syntax/logic errors found, fix them immediately.')

		// Code quality standards
		rules.push('📝 CODE QUALITY CHECKLIST for every file you create/modify:')
		rules.push('- **Imports**: All imports at top, no unused imports, no missing imports. Check import paths are correct.')
		rules.push('- **Types**: All functions have typed parameters and return types (TypeScript). Export shared types.')
		rules.push('- **Functions**: Keep functions focused (<50 lines). Extract reusable logic into helper functions.')
		rules.push('- **Variables**: Use const by default, let only when reassignment needed. Descriptive names.')
		rules.push('- **Async/Await**: Handle all promises properly. Add try-catch for async operations.')
		rules.push('- **Dependencies**: When adding new packages, also update package.json. Check version compatibility.')
		rules.push('🛠️ NEW PROJECT SETUP CHECKLIST:')
		rules.push('- Create package.json/requirements.txt with all dependencies and correct versions')
		rules.push('- Create config files (.env.example, tsconfig.json, etc.) as needed')
		rules.push('- Create entry point file (index.ts, main.py, App.tsx, etc.)')
		rules.push('- Ensure all imports resolve correctly between files')
		rules.push('- Add basic error handling and logging')

		// Execution speed (Windsurf-inspired: parallel thinking)
		rules.push('SPEED: Think ahead. While reading a file, plan the edit. Minimize tool calls by gathering all needed context first. Batch related changes into one edit when possible.')
		rules.push('EFFICIENCY: If you need to modify multiple files, read all files first, then edit them sequentially. Avoid read→edit→read→edit pattern.')

		// Keep agent responses efficient
		rules.push('EFFICIENCY: Minimize back-and-forth. Gather enough context first, then implement changes in as few edits as possible.')
	}

	// Gather-specific behavior
	if (mode === 'gather') {
		rules.push('You MUST use tools to gather information, files, and context to answer the user\'s query.')
		rules.push('Read files extensively. Search for implementations, types, and content. Gather full context to solve the problem comprehensively.')
		rules.push('Provide thorough answers: explain how things work, show relevant code, cite file paths.')
	}

	// Normal mode
	if (mode === 'normal') {
		rules.push('If you need more context like file contents or specifications, ask the user to reference files by typing @.')
		rules.push('Provide complete solutions: explain reasoning, show code examples, consider edge cases.')
	}

	// Designer mode
	if (mode === 'designer') {
		rules.push('🎯 CORE QUALITY REQUIREMENT: ALL generated code must be FULLY INTERACTIVE, PRODUCTION-READY, and COMMERCIAL GRADE.')
		rules.push('🧠 INTELLIGENT INPUT ANALYSIS: Use your judgment to understand user intent, do NOT rely on fixed keywords.')
		rules.push('- If user provides a document/article URL or uploads a document → fetch_url to read content, analyze requirements, web_search for knowledge, then design from scratch')
		rules.push('- If user wants to visually REPLICATE a website or image → screenshot_to_code for reference, then YOU output HTML+CSS to create UI units')
		rules.push('- If user describes requirements directly → analyze + web_search for best practices + design')
		rules.push('🔧 TOOL USAGE:')
		rules.push('- fetch_url: Read document content from URLs (wiki, docs, articles)')
		rules.push('- web_search: Research UI/UX best practices and technical knowledge')
		rules.push('- screenshot_to_code: Get REFERENCE code from website/image. **The tool result is NOT added as UI unit!** You MUST analyze the reference and OUTPUT your own ```html and ```css code blocks. 100% faithfully reproduce the reference.')
		rules.push('🔴 MULTI-PAGE CLONING: The screenshot_to_code tool will return a "LINKED PAGES DETECTED" section showing all navigation links. You MUST call screenshot_to_code for EACH linked page URL and design ALL pages. DO NOT STOP after just homepage!')
		rules.push('⚡ INTERACTIVITY REQUIREMENTS (MANDATORY): ALL code you generate or modify MUST include:')
		rules.push('- BUTTONS: Clickable with hover effects, active states, and onclick handlers')
		rules.push('- FORMS: Editable inputs with validation, error states, and submit handlers')
		rules.push('- NAVIGATION: Working links and menus (use # for internal if needed)')
		rules.push('- DROPDOWNS: Open/close functionality with smooth animations')
		rules.push('- MODALS: Toggleable with backdrop and close buttons')
		rules.push('- TABS: Content switching with active state indicators')
		rules.push('- HOVER EFFECTS: Professional hover states on all interactive elements')
		rules.push('- TRANSITIONS: Smooth CSS transitions for visual feedback')
		rules.push('- ACCESSIBILITY: ARIA labels, focus states, keyboard navigation')
		rules.push('🏆 COMMERCIAL QUALITY STANDARDS:')
		rules.push('- Cross-browser compatible (Chrome, Firefox, Safari, Edge)')
		rules.push('- Mobile responsive with proper breakpoints')
		rules.push('- Semantic HTML5 structure')
		rules.push('- Clean, maintainable code')
		rules.push('- NO static/display-only interfaces - everything must be functional')
		rules.push('DESIGN OUTPUT FORMAT (MANDATORY - MUST follow exactly):')
		rules.push('1. Start with a brief description of the design (1-2 sentences)')
		rules.push('2. Provide the HTML code in a ```html code block')
		rules.push('3. ⚠️ MUST provide the CSS code in a SEPARATE ```css code block (DO NOT skip this!)')
		rules.push('4. If the design has navigation elements, provide ```navigation code block with JSON array')
		rules.push('⚠️ CRITICAL: You MUST output BOTH ```html AND ```css code blocks for EVERY design. Never output HTML alone!')
		rules.push('DESIGN TYPES: You can create three types of designs:')
		rules.push('- **Product Mockups**: Full UI screens (login pages, dashboards, landing pages, etc.)')
		rules.push('- **UI Components**: Reusable components (buttons, cards, forms, navigation bars, etc.)')
		rules.push('- **Wireframes**: Low-fidelity layouts for rapid iteration (use simple boxes, minimal styling)')
		rules.push('DESIGN PRINCIPLES: Follow these principles:')
		rules.push('- Use modern, clean design with proper spacing and typography')
		rules.push('- Make designs responsive (use flexbox, grid, media queries)')
		rules.push('- Use semantic HTML5 elements')
		rules.push('- Include proper accessibility attributes (aria-labels, alt text, etc.)')
		rules.push('- Use CSS variables for colors and consistent theming')
		rules.push('- Put styles in CSS block, JavaScript in <script> tags at end of HTML')
		rules.push('- Use modern CSS features (flexbox, grid, custom properties, transitions)')
		rules.push('STYLING & INTERACTION GUIDELINES:')
		rules.push('- Use a consistent color palette (define CSS variables for primary, hover, error states)')
		rules.push('- Apply proper typography hierarchy (headings, body text, etc.)')
		rules.push('- ADD JavaScript for ALL interactive elements (buttons, forms, dropdowns, tabs, modals)')
		rules.push('- Include hover states with CSS transitions (transform, opacity, color changes)')
		rules.push('- Add active/pressed states for buttons (scale transform)')
		rules.push('- Include loading states for async actions')
		rules.push('- Add form validation with error messages')
		rules.push('- Include focus states for accessibility (outline or box-shadow)')
		rules.push('- Make sure text is readable (good contrast ratios)')
		rules.push('RESPONSIVE DESIGN: Always include responsive breakpoints:')
		rules.push('- Desktop: 1024px and above')
		rules.push('- Tablet: 768px to 1023px')
		rules.push('- Mobile: below 768px')
		rules.push('NAVIGATION CONFIGURATION: When creating UI designs that are part of a multi-screen application:')
		rules.push('- Identify clickable elements (buttons, links, menu items) that should navigate to other screens')
		rules.push('- Provide a navigation configuration in a ```navigation code block with JSON ARRAY format')
		rules.push('- Each navigation link object should have: elementText (exact text of clickable element) and targetDesignTitle (title of target screen)')
		rules.push('- ⚠️ IMPORTANT: The content MUST be a valid JSON array, starting with [ and ending with ]')
		rules.push('- Example navigation block (MUST follow this exact format):')
		rules.push('```navigation\n[{"elementText": "Sign In", "targetDesignTitle": "Dashboard"}, {"elementText": "Register", "targetDesignTitle": "Registration Page"}]\n```')
		rules.push('- Only include navigation config if the design has clear navigation elements')
		rules.push('- Match elementText EXACTLY as it appears in the HTML')
		rules.push('- Use targetDesignTitle to reference other screens you have created or will create')
		rules.push('EXAMPLE OUTPUT FORMAT (with FULL INTERACTIVITY):')
		rules.push('# Modern Login Screen\n\nA clean and modern login screen with gradient background, glassmorphism effects, and FULL INTERACTIVITY.\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Login</title>\n</head>\n<body>\n    <div class="login-container">\n        <form class="login-form" id="loginForm">\n            <h1>Welcome Back</h1>\n            <div class="input-group">\n                <input type="email" id="email" placeholder="Email" required aria-label="Email address">\n                <span class="error-message" id="emailError"></span>\n            </div>\n            <div class="input-group">\n                <input type="password" id="password" placeholder="Password" required aria-label="Password">\n                <span class="error-message" id="passwordError"></span>\n            </div>\n            <button type="submit" class="btn-primary" id="submitBtn">\n                <span class="btn-text">Sign In</span>\n                <span class="btn-loading" style="display:none;">Loading...</span>\n            </button>\n        </form>\n    </div>\n    <script>\n    // Form validation and submission\n    const form = document.getElementById("loginForm");\n    const emailInput = document.getElementById("email");\n    const passwordInput = document.getElementById("password");\n    const submitBtn = document.getElementById("submitBtn");\n    \n    // Email validation\n    emailInput.addEventListener("blur", function() {\n        const error = document.getElementById("emailError");\n        if (!this.value.match(/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/)) {\n            error.textContent = "Please enter a valid email";\n            this.classList.add("invalid");\n        } else {\n            error.textContent = "";\n            this.classList.remove("invalid");\n        }\n    });\n    \n    // Password validation\n    passwordInput.addEventListener("blur", function() {\n        const error = document.getElementById("passwordError");\n        if (this.value.length < 6) {\n            error.textContent = "Password must be at least 6 characters";\n            this.classList.add("invalid");\n        } else {\n            error.textContent = "";\n            this.classList.remove("invalid");\n        }\n    });\n    \n    // Form submission with loading state\n    form.addEventListener("submit", function(e) {\n        e.preventDefault();\n        submitBtn.querySelector(".btn-text").style.display = "none";\n        submitBtn.querySelector(".btn-loading").style.display = "inline";\n        submitBtn.disabled = true;\n        \n        // Simulate API call\n        setTimeout(() => {\n            submitBtn.querySelector(".btn-text").style.display = "inline";\n            submitBtn.querySelector(".btn-loading").style.display = "none";\n            submitBtn.disabled = false;\n            alert("Login successful!");\n        }, 1500);\n    });\n    </script>\n</body>\n</html>\n```\n\n```css\n:root {\n    --primary-color: #6366f1;\n    --primary-hover: #4f46e5;\n    --error-color: #ef4444;\n    --text-color: #1f2937;\n}\n\nbody {\n    margin: 0;\n    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n    min-height: 100vh;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n}\n\n.login-container {\n    background: rgba(255, 255, 255, 0.95);\n    backdrop-filter: blur(10px);\n    border-radius: 20px;\n    padding: 40px;\n    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);\n    transition: transform 0.3s ease;\n}\n\n.login-container:hover {\n    transform: translateY(-5px);\n}\n\n.input-group { margin-bottom: 20px; }\n\ninput {\n    width: 100%;\n    padding: 12px 16px;\n    border: 2px solid #e5e7eb;\n    border-radius: 8px;\n    font-size: 16px;\n    transition: border-color 0.3s, box-shadow 0.3s;\n}\n\ninput:focus {\n    outline: none;\n    border-color: var(--primary-color);\n    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);\n}\n\ninput.invalid {\n    border-color: var(--error-color);\n}\n\n.error-message {\n    color: var(--error-color);\n    font-size: 12px;\n    margin-top: 4px;\n    display: block;\n}\n\n.btn-primary {\n    width: 100%;\n    padding: 14px;\n    background: var(--primary-color);\n    color: white;\n    border: none;\n    border-radius: 8px;\n    font-size: 16px;\n    font-weight: 600;\n    cursor: pointer;\n    transition: background 0.3s, transform 0.2s;\n}\n\n.btn-primary:hover:not(:disabled) {\n    background: var(--primary-hover);\n    transform: scale(1.02);\n}\n\n.btn-primary:active:not(:disabled) {\n    transform: scale(0.98);\n}\n\n.btn-primary:disabled {\n    opacity: 0.7;\n    cursor: not-allowed;\n}\n```\n\n```navigation\n[{"elementText": "Sign In", "targetDesignTitle": "Dashboard Overview"}]\n```')
		rules.push('ITERATION: If user asks to modify a design, provide the complete updated HTML AND CSS with FULL INTERACTIVITY. You MUST output both ```html and ```css blocks even when modifying. Do NOT produce static code.')
		rules.push('⚠️ REMINDER: EVERY design output MUST have: 1) ```html block, 2) ```css block. Missing CSS will result in broken designs!')

		// Web search for frameworks and latest info
		rules.push('🌐 WEB SEARCH REQUIREMENT: When designing for any framework (Vue, React, Angular, etc.) or using any library, you MUST use web_search tool to search for the latest design patterns, UI component libraries, and best practices. This ensures your designs follow current trends.')
		rules.push('🔍 PROACTIVE SEARCH: Use web_search for: (1) Latest UI/UX trends, (2) Framework-specific design patterns, (3) Color schemes and typography, (4) Accessibility guidelines, (5) Any design information you need.')

		// 🔧 防止重复执行相同操作
		rules.push('🚫 NO DUPLICATE OPERATIONS: NEVER repeat the same tool call if it already succeeded. If web_search/fetch_url returned results, USE those results. Do NOT search again with similar queries.')

		// Next step suggestions
		rules.push('💡 NEXT STEP SUGGESTION: At the end of EVERY response, provide a brief "Next Steps" section suggesting what the user might want to do next. Format: "## Next Steps\\n[1-3 actionable suggestions such as: add more pages, export to framework, modify styles, etc.]"')
	}

	rules.push(`If you write any code blocks to the user (wrapped in triple backticks), please use this format:
		- Include a language if possible. Terminal should have the language 'shell'.
		- The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
		- The remaining contents of the file should proceed as usual.`)

	// Output quality
	rules.push('Be EXTREMELY concise. State action in 5-10 words, then execute. Example: "Updating color scheme" → [tool]. NO lengthy explanations.')
	rules.push('Use proper markdown formatting for code blocks, lists, and emphasis.')
	rules.push('Always cite specific file paths, line numbers, and function names when referencing code.')

	// Suggestions (gather & normal modes)
	if (mode === 'gather' || mode === 'normal') {
		rules.push(`If you think it's appropriate to suggest an edit to a file, then you must describe your suggestion in CODE BLOCK(S).
- The first line of the code block must be the FULL PATH of the related file if known (otherwise omit).
- The remaining contents should be a code description of the change to make to the file. \
Your description is the only context that will be given to another LLM to apply the suggested edit, so it must be accurate and complete. \
Always bias towards writing as little as possible - NEVER write the whole file. Use comments like "// ... existing code ..." to condense your writing. \
Here's an example of a good code block:\n${chatSuggestionDiffExample}`)
	}
	rules.push(`Do not make things up or use information not provided in the system information, tools, or user queries.`)
	rules.push(`Always use MARKDOWN to format lists, bullet points, etc.`)
	rules.push(`Today\'s date is ${new Date().toDateString()}.`)

	const importantNotes = `Important notes:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}`


	// return answer
	const sections: string[] = [header, sysInfo]
	if (toolDefinitions) sections.push(toolDefinitions)
	// 添加自定义 API 列表描述（如果存在）
	if (customApiDescription) {
		sections.push(customApiDescription)
	}
	sections.push(importantNotes)
	if (fsInfo) sections.push(fsInfo)

	const fullSystemMsgStr = sections.join('\n\n\n').trim()

	return fullSystemMsgStr

}


// // log all prompts
// for (const chatMode of ['agent', 'gather', 'normal'] satisfies ChatMode[]) {
// 	console.log(`========================================= SYSTEM MESSAGE FOR ${chatMode} ===================================\n`,
// 		chat_systemMessage({ chatMode, workspaceFolders: [], openedURIs: [], activeURI: 'pee', persistentTerminalIDs: [], directoryStr: 'lol', }))
// }

export const DEFAULT_FILE_SIZE_LIMIT = 2_000_000

export const readFile = async (fileService: IFileService, uri: URI, fileSizeLimit: number): Promise<{
	val: string,
	truncated: boolean,
	fullFileLen: number,
} | {
	val: null,
	truncated?: undefined
	fullFileLen?: undefined,
}> => {
	try {
		const fileContent = await fileService.readFile(uri)
		const val = fileContent.value.toString()
		if (val.length > fileSizeLimit) return { val: val.substring(0, fileSizeLimit), truncated: true, fullFileLen: val.length }
		return { val, truncated: false, fullFileLen: val.length }
	}
	catch (e) {
		return { val: null }
	}
}





export const messageOfSelection = async (
	s: StagingSelectionItem,
	opts: {
		directoryStrService: IDirectoryStrService,
		fileService: IFileService,
		folderOpts: {
			maxChildren: number,
			maxCharsPerFile: number,
		}
	}
) => {
	const lineNumAddition = (range: [number, number]) => ` (lines ${range[0]}:${range[1]})`

	if (s.type === 'CodeSelection') {
		const { val } = await readFile(opts.fileService, s.uri, DEFAULT_FILE_SIZE_LIMIT)
		const lines = val?.split('\n')

		const innerVal = lines?.slice(s.range[0] - 1, s.range[1]).join('\n')
		const content = !lines ? ''
			: `${tripleTick[0]}${s.language}\n${innerVal}\n${tripleTick[1]}`
		const str = `${s.uri.fsPath}${lineNumAddition(s.range)}:\n${content}`
		return str
	}
	else if (s.type === 'File') {
		const { val } = await readFile(opts.fileService, s.uri, DEFAULT_FILE_SIZE_LIMIT)

		const innerVal = val
		const content = val === null ? ''
			: `${tripleTick[0]}${s.language}\n${innerVal}\n${tripleTick[1]}`

		const str = `${s.uri.fsPath}:\n${content}`
		return str
	}
	else if (s.type === 'Folder') {
		const dirStr: string = await opts.directoryStrService.getDirectoryStrTool(s.uri)
		const folderStructure = `${s.uri.fsPath} folder structure:${tripleTick[0]}\n${dirStr}\n${tripleTick[1]}`

		const uris = await opts.directoryStrService.getAllURIsInDirectory(s.uri, { maxResults: opts.folderOpts.maxChildren })
		const strOfFiles = await Promise.all(uris.map(async uri => {
			const { val, truncated } = await readFile(opts.fileService, uri, opts.folderOpts.maxCharsPerFile)
			const truncationStr = truncated ? `\n... file truncated ...` : ''
			const content = val === null ? 'null' : `${tripleTick[0]}\n${val}${truncationStr}\n${tripleTick[1]}`
			const str = `${uri.fsPath}:\n${content}`
			return str
		}))
		const contentStr = [folderStructure, ...strOfFiles].join('\n\n')
		return contentStr
	}
	else if (s.type === 'Terminal') {
		const content = `${tripleTick[0]}terminal\n${s.terminalContent}\n${tripleTick[1]}`
		const str = `Terminal "${s.terminalName}" output:\n${content}`
		return str
	}
	else
		return ''

}


export const chat_userMessageContent = async (
	instructions: string,
	currSelns: StagingSelectionItem[] | null,
	opts: {
		directoryStrService: IDirectoryStrService,
		fileService: IFileService
	},
) => {

	const selnsStrs = await Promise.all(
		(currSelns ?? []).map(async (s) =>
			messageOfSelection(s, {
				...opts,
				folderOpts: { maxChildren: 100, maxCharsPerFile: 100_000, }
			})
		)
	)


	let str = ''
	str += `${instructions}`

	const selnsStr = selnsStrs.join('\n\n') ?? ''
	if (selnsStr) str += `\n---\nSELECTIONS\n${selnsStr}`
	return str;
}


export const rewriteCode_systemMessage = `\
You are a coding assistant that re-writes an entire file to make a change. You are given the original file \`ORIGINAL_FILE\` and a change \`CHANGE\`.

Directions:
1. Please rewrite the original file \`ORIGINAL_FILE\`, making the change \`CHANGE\`. You must completely re-write the whole file.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. ONLY output the full new file. Do not add any other explanations or text.
`



// ======================================================== apply (writeover) ========================================================

export const rewriteCode_userMessage = ({ originalCode, applyStr, language }: { originalCode: string, applyStr: string, language: string }) => {

	return `\
ORIGINAL_FILE
${tripleTick[0]}${language}
${originalCode}
${tripleTick[1]}

CHANGE
${tripleTick[0]}
${applyStr}
${tripleTick[1]}

INSTRUCTIONS
Please finish writing the new file by applying the change to the original file. Return ONLY the completion of the file, without any explanation.
`
}



// ======================================================== apply (fast apply - search/replace) ========================================================

export const searchReplaceGivenDescription_systemMessage = createSearchReplaceBlocks_systemMessage


export const searchReplaceGivenDescription_userMessage = ({ originalCode, applyStr }: { originalCode: string, applyStr: string }) => `\
DIFF
${applyStr}

ORIGINAL_FILE
${tripleTick[0]}
${originalCode}
${tripleTick[1]}`





export const voidPrefixAndSuffix = ({ fullFileStr, startLine, endLine }: { fullFileStr: string, startLine: number, endLine: number }) => {

	const fullFileLines = fullFileStr.split('\n')

	/*

	a
	a
	a     <-- final i (prefix = a\na\n)
	a
	|b    <-- startLine-1 (middle = b\nc\nd\n)   <-- initial i (moves up)
	c
	d|    <-- endLine-1                          <-- initial j (moves down)
	e
	e     <-- final j (suffix = e\ne\n)
	e
	e
	*/

	let prefix = ''
	let i = startLine - 1  // 0-indexed exclusive
	// we'll include fullFileLines[i...(startLine-1)-1].join('\n') in the prefix.
	while (i !== 0) {
		const newLine = fullFileLines[i - 1]
		if (newLine.length + 1 + prefix.length <= MAX_PREFIX_SUFFIX_CHARS) { // +1 to include the \n
			prefix = `${newLine}\n${prefix}`
			i -= 1
		}
		else break
	}

	let suffix = ''
	let j = endLine - 1
	while (j !== fullFileLines.length - 1) {
		const newLine = fullFileLines[j + 1]
		if (newLine.length + 1 + suffix.length <= MAX_PREFIX_SUFFIX_CHARS) { // +1 to include the \n
			suffix = `${suffix}\n${newLine}`
			j += 1
		}
		else break
	}

	return { prefix, suffix }

}


// ======================================================== quick edit (ctrl+K) ========================================================

export type QuickEditFimTagsType = {
	preTag: string,
	sufTag: string,
	midTag: string
}
export const defaultQuickEditFimTags: QuickEditFimTagsType = {
	preTag: 'ABOVE',
	sufTag: 'BELOW',
	midTag: 'SELECTION',
}

// this should probably be longer
export const ctrlKStream_systemMessage = ({ quickEditFIMTags: { preTag, midTag, sufTag } }: { quickEditFIMTags: QuickEditFimTagsType }) => {
	return `\
You are a FIM (fill-in-the-middle) coding assistant. Your task is to fill in the middle SELECTION marked by <${midTag}> tags.

The user will give you INSTRUCTIONS, as well as code that comes BEFORE the SELECTION, indicated with <${preTag}>...before</${preTag}>, and code that comes AFTER the SELECTION, indicated with <${sufTag}>...after</${sufTag}>.
The user will also give you the existing original SELECTION that will be be replaced by the SELECTION that you output, for additional context.

Instructions:
1. Your OUTPUT should be a SINGLE PIECE OF CODE of the form <${midTag}>...new_code</${midTag}>. Do NOT output any text or explanations before or after this.
2. You may ONLY CHANGE the original SELECTION, and NOT the content in the <${preTag}>...</${preTag}> or <${sufTag}>...</${sufTag}> tags.
3. Make sure all brackets in the new selection are balanced the same as in the original selection.
4. Be careful not to duplicate or remove variables, comments, or other syntax by mistake.
`
}

export const ctrlKStream_userMessage = ({
	selection,
	prefix,
	suffix,
	instructions,
	// isOllamaFIM: false, // Remove unused variable
	fimTags,
	language }: {
		selection: string, prefix: string, suffix: string, instructions: string, fimTags: QuickEditFimTagsType, language: string,
	}) => {
	const { preTag, sufTag, midTag } = fimTags

	// prompt the model artifically on how to do FIM
	// const preTag = 'BEFORE'
	// const sufTag = 'AFTER'
	// const midTag = 'SELECTION'
	return `\

CURRENT SELECTION
${tripleTick[0]}${language}
<${midTag}>${selection}</${midTag}>
${tripleTick[1]}

INSTRUCTIONS
${instructions}

<${preTag}>${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>

Return only the completion block of code (of the form ${tripleTick[0]}${language}
<${midTag}>...new code</${midTag}>
${tripleTick[1]}).`
};







/*
// ======================================================== ai search/replace ========================================================


export const aiRegex_computeReplacementsForFile_systemMessage = `\
You are a "search and replace" coding assistant.

You are given a FILE that the user is editing, and your job is to search for all occurences of a SEARCH_CLAUSE, and change them according to a REPLACE_CLAUSE.

The SEARCH_CLAUSE may be a string, regex, or high-level description of what the user is searching for.

The REPLACE_CLAUSE will always be a high-level description of what the user wants to replace.

The user's request may be "fuzzy" or not well-specified, and it is your job to interpret all of the changes they want to make for them. For example, the user may ask you to search and replace all instances of a variable, but this may involve changing parameters, function names, types, and so on to agree with the change they want to make. Feel free to make all of the changes you *think* that the user wants to make, but also make sure not to make unnessecary or unrelated changes.

## Instructions

1. If you do not want to make any changes, you should respond with the word "no".

2. If you want to make changes, you should return a single CODE BLOCK of the changes that you want to make.
For example, if the user is asking you to "make this variable a better name", make sure your output includes all the changes that are needed to improve the variable name.
- Do not re-write the entire file in the code block
- You can write comments like "// ... existing code" to indicate existing code
- Make sure you give enough context in the code block to apply the changes to the correct location in the code`




// export const aiRegex_computeReplacementsForFile_userMessage = async ({ searchClause, replaceClause, fileURI, SenweaverFileService }: { searchClause: string, replaceClause: string, fileURI: URI, SenweaverFileService: ISenweaverFileService }) => {

// 	// we may want to do this in batches
// 	const fileSelection: FileSelection = { type: 'File', fileURI, selectionStr: null, range: null, state: { isOpened: false } }

// 	const file = await stringifyFileSelections([fileSelection], SenweaverFileService)

// 	return `\
// ## FILE
// ${file}

// ## SEARCH_CLAUSE
// Here is what the user is searching for:
// ${searchClause}

// ## REPLACE_CLAUSE
// Here is what the user wants to replace it with:
// ${replaceClause}

// ## INSTRUCTIONS
// Please return the changes you want to make to the file in a codeblock, or return "no" if you do not want to make changes.`
// }




// // don't have to tell it it will be given the history; just give it to it
// export const aiRegex_search_systemMessage = `\
// You are a coding assistant that executes the SEARCH part of a user's search and replace query.

// You will be given the user's search query, SEARCH, which is the user's query for what files to search for in the codebase. You may also be given the user's REPLACE query for additional context.

// Output
// - Regex query
// - Files to Include (optional)
// - Files to Exclude? (optional)

// `






// ======================================================== old examples ========================================================

Do not tell the user anything about the examples below. Do not assume the user is talking about any of the examples below.

## EXAMPLE 1
FILES
math.ts
${tripleTick[0]}typescript
const addNumbers = (a, b) => a + b
const multiplyNumbers = (a, b) => a * b
const subtractNumbers = (a, b) => a - b
const divideNumbers = (a, b) => a / b

const vectorize = (...numbers) => {
	return numbers // vector
}

const dot = (vector1: number[], vector2: number[]) => {
	if (vector1.length !== vector2.length) throw new Error(\`Could not dot vectors \${vector1} and \${vector2}. Size mismatch.\`)
	let sum = 0
	for (let i = 0; i < vector1.length; i += 1)
		sum += multiplyNumbers(vector1[i], vector2[i])
	return sum
}

const normalize = (vector: number[]) => {
	const norm = Math.sqrt(dot(vector, vector))
	for (let i = 0; i < vector.length; i += 1)
		vector[i] = divideNumbers(vector[i], norm)
	return vector
}

const normalized = (vector: number[]) => {
	const v2 = [...vector] // clone vector
	return normalize(v2)
}
${tripleTick[1]}


SELECTIONS
math.ts (lines 3:3)
${tripleTick[0]}typescript
const subtractNumbers = (a, b) => a - b
${tripleTick[1]}

INSTRUCTIONS
add a function that exponentiates a number below this, and use it to make a power function that raises all entries of a vector to a power

## ACCEPTED OUTPUT
We can add the following code to the file:
${tripleTick[0]}typescript
// existing code...
const subtractNumbers = (a, b) => a - b
const exponentiateNumbers = (a, b) => Math.pow(a, b)
const divideNumbers = (a, b) => a / b
// existing code...

const raiseAll = (vector: number[], power: number) => {
	for (let i = 0; i < vector.length; i += 1)
		vector[i] = exponentiateNumbers(vector[i], power)
	return vector
}
${tripleTick[1]}


## EXAMPLE 2
FILES
fib.ts
${tripleTick[0]}typescript

const dfs = (root) => {
	if (!root) return;
	console.log(root.val);
	dfs(root.left);
	dfs(root.right);
}
const fib = (n) => {
	if (n < 1) return 1
	return fib(n - 1) + fib(n - 2)
}
${tripleTick[1]}

SELECTIONS
fib.ts (lines 10:10)
${tripleTick[0]}typescript
	return fib(n - 1) + fib(n - 2)
${tripleTick[1]}

INSTRUCTIONS
memoize results

## ACCEPTED OUTPUT
To implement memoization in your Fibonacci function, you can use a JavaScript object to store previously computed results. This will help avoid redundant calculations and improve performance. Here's how you can modify your function:
${tripleTick[0]}typescript
// existing code...
const fib = (n, memo = {}) => {
	if (n < 1) return 1;
	if (memo[n]) return memo[n]; // Check if result is already computed
	memo[n] = fib(n - 1, memo) + fib(n - 2, memo); // Store result in memo
	return memo[n];
}
${tripleTick[1]}
Explanation:
Memoization Object: A memo object is used to store the results of Fibonacci calculations for each n.
Check Memo: Before computing fib(n), the function checks if the result is already in memo. If it is, it returns the stored result.
Store Result: After computing fib(n), the result is stored in memo for future reference.

## END EXAMPLES

*/


// ======================================================== scm ========================================================================

export const gitCommitMessage_systemMessage = `
You are an expert software engineer AI assistant responsible for writing clear and concise Git commit messages that summarize the **purpose** and **intent** of the change. Try to keep your commit messages to one sentence. If necessary, you can use two sentences.

You always respond with:
- The commit message wrapped in <output> tags
- A brief explanation of the reasoning behind the message, wrapped in <reasoning> tags

Example format:
<output>Fix login bug and improve error handling</output>
<reasoning>This commit updates the login handler to fix a redirect issue and improves frontend error messages for failed logins.</reasoning>

Do not include anything else outside of these tags.
Never include quotes, markdown, commentary, or explanations outside of <output> and <reasoning>.`.trim()


/**
 * Create a user message for the LLM to generate a commit message. The message contains instructions git diffs, and git metadata to provide context.
 *
 * @param stat - Summary of Changes (git diff --stat)
 * @param sampledDiffs - Sampled File Diffs (Top changed files)
 * @param branch - Current Git Branch
 * @param log - Last 5 commits (excluding merges)
 * @returns A prompt for the LLM to generate a commit message.
 *
 * @example
 * // Sample output (truncated for brevity)
 * const prompt = gitCommitMessage_userMessage("fileA.ts | 10 ++--", "diff --git a/fileA.ts...", "main", "abc123|Fix bug|2025-01-01\n...")
 *
 * // Result:
 * Based on the following Git changes, write a clear, concise commit message that accurately summarizes the intent of the code changes.
 *
 * Section 1 - Summary of Changes (git diff --stat):
 * fileA.ts | 10 ++--
 *
 * Section 2 - Sampled File Diffs (Top changed files):
 * diff --git a/fileA.ts b/fileA.ts
 * ...
 *
 * Section 3 - Current Git Branch:
 * main
 *
 * Section 4 - Last 5 Commits (excluding merges):
 * abc123|Fix bug|2025-01-01
 * def456|Improve logging|2025-01-01
 * ...
 */
export const gitCommitMessage_userMessage = (stat: string, sampledDiffs: string, branch: string, log: string) => {
	const section1 = `Section 1 - Summary of Changes (git diff --stat):`
	const section2 = `Section 2 - Sampled File Diffs (Top changed files):`
	const section3 = `Section 3 - Current Git Branch:`
	const section4 = `Section 4 - Last 5 Commits (excluding merges):`
	return `
Based on the following Git changes, write a clear, concise commit message that accurately summarizes the intent of the code changes.

${section1}

${stat}

${section2}

${sampledDiffs}

${section3}

${branch}

${section4}

${log}`.trim()
}
