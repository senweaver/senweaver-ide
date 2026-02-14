import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'

import { IFileService } from '../../../../platform/files/common/files.js'
import { ITextFileService } from '../../../services/textfile/common/textfiles.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { ITerminalToolService } from './terminalToolService.js'
import { LintErrorItem, BuiltinToolCallParams, BuiltinToolResultType, BuiltinToolName, CodeChangeStats } from '../common/toolsServiceTypes.js'
import { ISenweaverModelService } from '../common/senweaverModelService.js'
import { EndOfLinePreference } from '../../../../editor/common/model.js'
import { ISenweaverCommandBarService } from './senweaverCommandBarService.js'
import { computeDirectoryTree1Deep, IDirectoryStrService, stringifyDirectoryTree1Deep } from '../common/directoryStrService.js'
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js'
import { RawToolParamsObj } from '../common/sendLLMMessageTypes.js'
import { MAX_CHILDREN_URIs_PAGE, MAX_FILE_CHARS_PAGE, MAX_TERMINAL_BG_COMMAND_TIME, MAX_TERMINAL_INACTIVE_TIME } from '../common/prompt/prompts.js'
import { ISenweaverSettingsService } from '../common/senweaverSettingsService.js'
import { IProductService } from '../../../../platform/product/common/productService.js'
import { generateUuid } from '../../../../base/common/uuid.js'
import { ISenweaverBrowserService } from './senweaverBrowserEditor.js'
import { ISenweaverDocumentService } from './senweaverDocumentEditor.js'
import { ISkillService } from '../common/skillService.js'

import { extname } from '../../../../base/common/path.js'

type DocumentConvertFormat = 'pdf' | 'docx' | 'images' | 'xlsx' | 'wps'

// ==================== MD5 哈希函数（用于生成 auth 认证字符串）====================
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

// 生成 web_search API 认证字符串
// 原始字符串 = 10位时间戳 + 用户ID + 固定字符串 + 类型（web_search）
// auth = md5(原始字符串)
function generateWebSearchAuth(userId: string, timestamp: number, secretKey: string): string {
	const rawString = timestamp.toString() + userId + secretKey + 'web_search';
	return md5(rawString);
}

// 获取当前用户ID（从localStorage获取，与SenweaverOnlineConfigContribution保持一致）
function getWebSearchUserId(): string {
	const storageKey = 'senweaver.user.id';
	const userId = localStorage.getItem(storageKey);
	return userId || 'anonymous';
}

// 获取当前10位时间戳
function getWebSearchTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

// Backend Servers
// Note: The backend servers are now started by Electron main process in main.ts
// Fetch URL Backend: src/main.ts -> startFetchUrlBackendServer()
// Web Search Backend: src/main.ts -> startWebSearchBackendServer()
// Clone Website Backend: src/main.ts -> startCloneWebsiteBackendServer()
// Open Browser Backend: src/main.ts -> startOpenBrowserBackendServer()
const fetchUrlServerPort = 3000; // Fetch URL server port
// const cloneWebsiteServerPort = 3003; // Clone Website server port - 已注释，功能已由 screenshot_to_code 替代
const visionServerPort = 3004; // Vision Analysis server port
const apiRequestServerPort = 3005; // API Request server port
const DEFAULT_DOCUMENT_READER_PORT = 3008; // Document Reader server port (default)
const DEFAULT_SCREENSHOT_TO_CODE_PORT = 3007; // Screenshot to Code server port (default)
const DEFAULT_OPEN_BROWSER_PORT = 3006; // Open Browser Automation server port (default)

// ==================== Port Detection with Promise-based deduplication ====================
// Uses a shared Promise so concurrent callers wait for the same detection instead of racing

// Generic port detector factory - eliminates code duplication and fixes race conditions
function createPortDetector(config: {
	defaultPort: number;
	maxAttempts: number;
	serviceName: string;
	probeRequest: (port: number) => { url: string; init: RequestInit };
	validateResponse: (response: Response) => Promise<boolean>;
}): () => Promise<number> {
	let _cachedPort: number | null = null;
	let _pendingDetection: Promise<number> | null = null;

	return async function detectPort(): Promise<number> {
		// Fast path: already detected
		if (_cachedPort !== null) return _cachedPort;

		// Deduplication: if detection is in progress, wait for the same Promise
		if (_pendingDetection !== null) return _pendingDetection;

		// Start detection - all concurrent callers will share this Promise
		_pendingDetection = (async () => {
			const startPort = config.defaultPort;
			// Use parallel probing: fire all probes at once, take the first success
			const probePromises: Promise<number | null>[] = [];
			for (let i = 0; i < config.maxAttempts; i++) {
				const port = startPort + i;
				probePromises.push(
					(async () => {
						try {
							const { url, init } = config.probeRequest(port);
							const response = await fetch(url, {
								...init,
								signal: AbortSignal.timeout(2000), // 2s timeout per probe
							});
							if (await config.validateResponse(response)) {
								return port;
							}
						} catch {
							// Port not available
						}
						return null;
					})()
				);
			}

			// Race: return the first successfully detected port
			const results = await Promise.allSettled(probePromises);
			for (const r of results) {
				if (r.status === 'fulfilled' && r.value !== null) {
					_cachedPort = r.value;
					_pendingDetection = null;
					return r.value;
				}
			}

			console.warn(`[ToolsService] ⚠️ ${config.serviceName} backend not detected, using default port ${startPort}`);
			_cachedPort = startPort;
			_pendingDetection = null;
			return startPort;
		})();

		return _pendingDetection;
	};
}

const detectDocumentReaderPort = createPortDetector({
	defaultPort: DEFAULT_DOCUMENT_READER_PORT,
	maxAttempts: 20,
	serviceName: 'Document Reader',
	probeRequest: (port) => ({
		url: `http://localhost:${port}/`,
		init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_path: '' }) }
	}),
	validateResponse: async (response) => response.status === 400 || response.status === 200,
});

const detectOpenBrowserPort = createPortDetector({
	defaultPort: DEFAULT_OPEN_BROWSER_PORT,
	maxAttempts: 20,
	serviceName: 'Open Browser',
	probeRequest: (port) => ({
		url: `http://localhost:${port}/`,
		init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'listSessions' }) }
	}),
	validateResponse: async (response) => response.ok,
});

const detectScreenshotToCodePort = createPortDetector({
	defaultPort: DEFAULT_SCREENSHOT_TO_CODE_PORT,
	maxAttempts: 10,
	serviceName: 'Screenshot to Code',
	probeRequest: (port) => ({
		url: `http://localhost:${port}/health`,
		init: { method: 'GET' }
	}),
	validateResponse: async (response) => {
		if (!response.ok) return false;
		try {
			const data = await response.json();
			return data.service === 'screenshot-to-code';
		} catch {
			return false;
		}
	},
});

// ==================== edit_file 辅助函数（模块级，避免每次调用重新创建闭包） ====================

// 规范化字符串：统一换行符
const _normalizeString = (s: string): string => {
	return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// 规范化用于比较的字符串（更宽松，移除行尾空格）
const _normalizeForComparison = (s: string): string => {
	return s
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/[ \t]+$/gm, '')
}

// 计算两个字符串的行级相似度 (0-1)
// 优化: 预拆分行数组传入，避免重复 split
const _calculateLineSimilarity = (aLines: string[], bLines: string[]): number => {
	const maxLen = Math.max(aLines.length, bLines.length)
	if (maxLen === 0) return 1
	const minLen = Math.min(aLines.length, bLines.length)
	let matches = 0
	for (let i = 0; i < minLen; i++) {
		if (aLines[i].trim() === bLines[i].trim()) {
			matches++
		}
	}
	return matches / maxLen
}

const FUZZY_MATCH_THRESHOLD = 0.80

// 在文件中查找最佳模糊匹配 - 健壮版本
// 多策略 anchor line 匹配：精确 -> 去空格 -> 包含匹配 -> 滑动窗口
type _FuzzyMatchResult = { startLine: number, endLine: number, similarity: number }

const _evaluateWindow = (
	fileLines: string[], normalizedSearchLines: string[],
	windowStart: number, windowSize: number,
	currentBest: _FuzzyMatchResult | null
): _FuzzyMatchResult | null => {
	if (windowStart < 0 || windowStart + windowSize > fileLines.length) return currentBest
	const windowLines = fileLines.slice(windowStart, windowStart + windowSize)
	const normalizedWindow = windowLines.map(l => _normalizeForComparison(l))
	const similarity = _calculateLineSimilarity(normalizedWindow, normalizedSearchLines)
	if (similarity >= FUZZY_MATCH_THRESHOLD && (!currentBest || similarity > currentBest.similarity)) {
		return { startLine: windowStart, endLine: windowStart + windowSize, similarity }
	}
	return currentBest
}

const _searchAroundAnchors = (
	fileLines: string[], searchLines: string[], normalizedSearchLines: string[],
	nonEmptySearchLines: string[], candidateStarts: number[],
	currentBest: _FuzzyMatchResult | null
): _FuzzyMatchResult | null => {
	const searchLen = searchLines.length
	const windowSizes = [searchLen, searchLen + 1, searchLen - 1, searchLen + 2, searchLen - 2].filter(s => s > 0)
	const anchorTrimmed = nonEmptySearchLines[0].trim()
	const searchAnchorIdx = searchLines.findIndex(l => l.trim() === anchorTrimmed)
	const anchorOffset = searchAnchorIdx >= 0 ? searchAnchorIdx : 0
	let best = currentBest

	for (const start of candidateStarts) {
		for (const windowSize of windowSizes) {
			const windowStart = start - anchorOffset
			best = _evaluateWindow(fileLines, normalizedSearchLines, windowStart, windowSize, best)
			best = _evaluateWindow(fileLines, normalizedSearchLines, windowStart - 1, windowSize, best)
			best = _evaluateWindow(fileLines, normalizedSearchLines, windowStart + 1, windowSize, best)
		}
		if (best && best.similarity >= 0.95) break
	}
	return best
}

const _findBestMatchText = (fileLines: string[], searchContent: string): { matchedText: string, similarity: number } | null => {
	const searchLines = searchContent.split('\n')
	const nonEmptySearchLines = searchLines.filter(l => l.trim().length > 0)
	if (nonEmptySearchLines.length === 0) return null

	const normalizedSearchLines = _normalizeForComparison(searchContent).split('\n')
	const searchLen = searchLines.length

	let best: _FuzzyMatchResult | null = null

	// 策略 1: 精确 anchor 匹配（search 第一个非空行完全匹配）
	const anchorLine = nonEmptySearchLines[0].trim()
	let candidateStarts: number[] = []
	for (let i = 0; i < fileLines.length; i++) {
		if (fileLines[i].trim() === anchorLine) {
			candidateStarts.push(i)
		}
	}
	if (candidateStarts.length > 0) {
		best = _searchAroundAnchors(fileLines, searchLines, normalizedSearchLines, nonEmptySearchLines, candidateStarts, best)
		if (best && best.similarity >= 0.90) {
			return { matchedText: fileLines.slice(best.startLine, best.endLine).join('\n'), similarity: best.similarity }
		}
	}

	// 策略 2: 去空格 anchor 匹配（移除所有空格后比较）
	const anchorNoWs = anchorLine.replace(/\s+/g, '')
	if (anchorNoWs.length > 5) {
		candidateStarts = []
		for (let i = 0; i < fileLines.length; i++) {
			if (fileLines[i].trim().replace(/\s+/g, '') === anchorNoWs) {
				candidateStarts.push(i)
			}
		}
		if (candidateStarts.length > 0 && candidateStarts.length <= 20) {
			best = _searchAroundAnchors(fileLines, searchLines, normalizedSearchLines, nonEmptySearchLines, candidateStarts, best)
			if (best && best.similarity >= 0.85) {
				return { matchedText: fileLines.slice(best.startLine, best.endLine).join('\n'), similarity: best.similarity }
			}
		}
	}

	// 策略 3: 使用多个 anchor lines（第一行 + 最后一行）
	if (nonEmptySearchLines.length >= 3) {
		const lastAnchor = nonEmptySearchLines[nonEmptySearchLines.length - 1].trim()
		candidateStarts = []
		for (let i = 0; i < fileLines.length; i++) {
			if (fileLines[i].trim() === lastAnchor) {
				for (let j = Math.max(0, i - searchLen - 2); j <= i; j++) {
					if (fileLines[j].trim() === anchorLine) {
						candidateStarts.push(j)
					}
				}
			}
		}
		if (candidateStarts.length > 0) {
			best = _searchAroundAnchors(fileLines, searchLines, normalizedSearchLines, nonEmptySearchLines, candidateStarts, best)
			if (best && best.similarity >= 0.80) {
				return { matchedText: fileLines.slice(best.startLine, best.endLine).join('\n'), similarity: best.similarity }
			}
		}
	}

	// 策略 4: 滑动窗口（无 anchor，仅对小文件或短搜索使用）
	if (fileLines.length <= 2000 || searchLen <= 5) {
		for (let i = 0; i <= fileLines.length - searchLen; i++) {
			best = _evaluateWindow(fileLines, normalizedSearchLines, i, searchLen, best)
			if (best && best.similarity >= 0.95) break
		}
		if (!best || best.similarity < 0.90) {
			for (const ws of [searchLen + 1, searchLen - 1]) {
				if (ws <= 0) continue
				for (let i = 0; i <= fileLines.length - ws; i++) {
					best = _evaluateWindow(fileLines, normalizedSearchLines, i, ws, best)
					if (best && best.similarity >= 0.95) break
				}
			}
		}
	}

	if (best) {
		return { matchedText: fileLines.slice(best.startLine, best.endLine).join('\n'), similarity: best.similarity }
	}
	return null
}

// 模糊匹配修复 blocks - 同步版本，使用预获取的文件内容
const _fixBlocksWithFuzzyMatch = (blocks: Array<{ search: string, replace: string }>, fileContent: string): Array<{ search: string, replace: string, fixed: boolean }> => {
	const content = _normalizeString(fileContent)
	const fileLines = content.split('\n')

	return blocks.map(block => {
		if (!block.search) {
			return { ...block, fixed: false }
		}

		// 统一规范化 search 内容（LLM 可能生成 \r\n）
		const normalizedSearch = _normalizeString(block.search)

		// 如果精确匹配存在，不需要修复（但替换为规范化版本以确保一致性）
		if (content.includes(normalizedSearch)) {
			if (normalizedSearch !== block.search) {
				return { search: normalizedSearch, replace: block.replace, fixed: true }
			}
			return { ...block, fixed: false }
		}

		// 尝试去除每行首尾空格后的匹配
		const trimmedSearch = normalizedSearch.split('\n').map(l => l.trim()).join('\n')
		const trimmedContent = content.split('\n').map(l => l.trim()).join('\n')
		if (trimmedSearch.length > 0 && trimmedContent.includes(trimmedSearch)) {
			// 找到 trim 匹配的行号范围，然后返回原始内容
			const trimmedLines = trimmedContent.split('\n')
			const trimmedSearchLines = trimmedSearch.split('\n')
			for (let i = 0; i <= trimmedLines.length - trimmedSearchLines.length; i++) {
				let found = true
				for (let j = 0; j < trimmedSearchLines.length; j++) {
					if (trimmedLines[i + j] !== trimmedSearchLines[j]) {
						found = false
						break
					}
				}
				if (found) {
					const matchedText = fileLines.slice(i, i + trimmedSearchLines.length).join('\n')
					return { search: matchedText, replace: block.replace, fixed: true }
				}
			}
		}

		// 尝试模糊匹配
		const match = _findBestMatchText(fileLines, normalizedSearch)
		if (match && match.similarity >= FUZZY_MATCH_THRESHOLD) {
			return { search: match.matchedText, replace: block.replace, fixed: true }
		}
		return { search: normalizedSearch, replace: block.replace, fixed: false }
	})
}

// 完整的 block 提取逻辑（仅在快速路径失败时调用）
const _extractBlocksFull = (input: any, ORIGINAL_MARKER: string, DIVIDER_MARKER: string, FINAL_MARKER: string): Array<{ search: string, replace: string }> => {
	const blocks: Array<{ search: string, replace: string }> = []
	if (input === null || input === undefined) return blocks

	// 特殊处理：输入太短
	if (typeof input === 'string' && input.trim().length < 10) return blocks

	let content = typeof input === 'string' ? input : JSON.stringify(input)

	// 统一换行符（\r\n -> \n）
	content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

	// 清理包装
	content = content
		.replace(/<search_replace_blocks>([\s\S]*?)<\/search_replace_blocks>/gi, '$1')
		.replace(/<search_replace_blocks[^>]*\/?>/gi, '')
		.replace(/<\/search_replace_blocks>/gi, '')
		.replace(/```(?:json|javascript|typescript|python|text|diff|plain)?\s*\n?([\s\S]*?)```/gi, '$1')
		.trim()

	// 规范化各种标记格式
	content = content
		.replace(/<{5,}\s*>{0,}\s*(?:ORIGINAL|SEARCH|HEAD)/gi, ORIGINAL_MARKER)
		.replace(/<{5,}\s*(?:ORIGINAL|SEARCH|HEAD)/gi, ORIGINAL_MARKER)
		.replace(/<<<+\s*ORIGINAL\s*\n/gi, ORIGINAL_MARKER + '\n')
		.replace(/<{8,}/g, '<<<<<<<')
		.replace(/>{8,}/g, '>>>>>>>')
		.replace(/>{5,}\s*(?:UPDATED|REPLACE|NEW|CHANGED|MODIFIED|FINAL|END|RESULT)/gi, FINAL_MARKER)
		.replace(/>>>+\s*UPDATED\s*\n/gi, FINAL_MARKER + '\n')
		.replace(/^>{5,}\s*$/gim, FINAL_MARKER)
		// 仅规范化单独占一行的 7+ 个等号，避免误匹配代码中的等号
		.replace(/^={7,}\s*$/gm, DIVIDER_MARKER)

	// 标准格式提取
	const markerPattern = /<<<<<<< ORIGINAL\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> UPDATED/g
	let match
	while ((match = markerPattern.exec(content)) !== null) {
		blocks.push({ search: match[1], replace: match[2] })
	}
	if (blocks.length > 0) return blocks

	// 通用状态机解析（修复 Claude 格式 bug：正确处理有/无 ORIGINAL 标记的情况）
	if (content.includes('=======') && content.includes('>>>>>>>')) {
		const lines = content.split('\n')
		let phase: 'idle' | 'search' | 'replace' = 'idle'
		let searchLines: string[] = []
		let replaceLines: string[] = []
		let prefixLines: string[] = [] // 在 idle 状态积累的行（用于没有 ORIGINAL 标记的情况）

		for (const line of lines) {
			// 检测开始标记 <<<<<<< ORIGINAL
			if (line.match(/^<{5,}\s*(?:ORIGINAL|SEARCH|HEAD)/i)) {
				// 开始新的搜索块
				phase = 'search'
				searchLines = []
				replaceLines = []
				prefixLines = []
				continue
			}

			// 检测分隔符 =======
			if (line.trim() === '=======' || line.match(/^={7,}\s*$/)) {
				if (phase === 'search') {
					// 正常流程：从 search -> replace
					phase = 'replace'
					replaceLines = []
				} else if (phase === 'idle') {
					// Claude 格式：没有 ORIGINAL 标记，前面积累的行就是 search
					searchLines = [...prefixLines]
					prefixLines = []
					phase = 'replace'
					replaceLines = []
				}
				// 如果已经在 replace 阶段再次遇到 =======，忽略（可能是代码内容）
				continue
			}

			// 检测结束标记 >>>>>>> UPDATED
			if (line.match(/^>{5,}\s*(?:UPDATED|REPLACE|NEW|CHANGED|MODIFIED|FINAL|END|RESULT)?/i)) {
				if (phase === 'replace') {
					// 完成一个块
					if (searchLines.length > 0 || replaceLines.length > 0) {
						blocks.push({ search: searchLines.join('\n'), replace: replaceLines.join('\n') })
					}
				}
				// 重置状态
				phase = 'idle'
				searchLines = []
				replaceLines = []
				prefixLines = []
				continue
			}

			// 积累内容
			switch (phase) {
				case 'idle':
					prefixLines.push(line)
					break
				case 'search':
					searchLines.push(line)
					break
				case 'replace':
					replaceLines.push(line)
					break
			}
		}
		if (blocks.length > 0) return blocks
	}

	// JSON 格式回退
	try {
		const parsed = JSON.parse(content)
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				if (item && typeof item === 'object') {
					const search = String(item.search || item.old || item.original || '').trim()
					const replace = String(item.replace || item.new || item.updated || '').trim()
					if (search || replace) blocks.push({ search, replace })
				}
			}
		} else if (parsed && typeof parsed === 'object') {
			const search = String(parsed.search || parsed.old || parsed.original || '').trim()
			const replace = String(parsed.replace || parsed.new || parsed.updated || '').trim()
			if (search || replace) blocks.push({ search, replace })
		}
	} catch { /* ignore */ }

	return blocks
}

// ==================== JSON 解析工具函数（去重） ====================
const _tryParseJsonFromString = (input: unknown): any | null => {
	if (input && typeof input === 'object') return input;
	if (typeof input !== 'string') return null;

	const trimmed = input.trim();
	const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	const baseCandidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();
	const normalizedCandidate = baseCandidate
		.replace(/[""„‟]/g, '"')
		.replace(/[''‚‛]/g, "'")
		.replace(/：/g, ':')
		.replace(/，/g, ',')
		.replace(/,\s*([}\]])/g, '$1');

	const attempt = (candidate: string): any | null => {
		try { return JSON.parse(candidate); } catch { return null; }
	};

	let parsed = attempt(baseCandidate) || attempt(normalizedCandidate);
	if (parsed && typeof parsed === 'object') return parsed;

	const firstObj = normalizedCandidate.indexOf('{');
	const lastObj = normalizedCandidate.lastIndexOf('}');
	if (firstObj !== -1 && lastObj > firstObj) {
		parsed = attempt(normalizedCandidate.slice(firstObj, lastObj + 1));
		if (parsed && typeof parsed === 'object') return parsed;
	}

	const firstArr = normalizedCandidate.indexOf('[');
	const lastArr = normalizedCandidate.lastIndexOf(']');
	if (firstArr !== -1 && lastArr > firstArr) {
		parsed = attempt(normalizedCandidate.slice(firstArr, lastArr + 1));
		if (parsed && typeof parsed === 'object') return parsed;
	}

	if (normalizedCandidate.startsWith('"') && normalizedCandidate.endsWith('"')) {
		const unescaped = attempt(normalizedCandidate);
		if (typeof unescaped === 'string') {
			const innerParsed = attempt(unescaped);
			if (innerParsed && typeof innerParsed === 'object') return innerParsed;
		}
	}

	// ================ Truncated JSON repair ================
	// When LLM output is cut off mid-JSON (e.g. long papers), try to repair it
	// by closing unclosed braces/brackets and removing trailing incomplete values
	const repaired = _tryRepairTruncatedJson(normalizedCandidate);
	if (repaired) return repaired;

	return null;
};

/**
 * Attempt to repair truncated JSON (e.g. from LLM output cutoff on long papers).
 * Uses multiple strategies with increasing aggressiveness.
 */
const _tryRepairTruncatedJson = (input: string): any | null => {
	if (!input || input.length < 10) return null;

	const firstBrace = input.indexOf('{');
	if (firstBrace === -1) return null;

	// Strategy 1: Close unclosed braces/brackets after cleaning trailing garbage
	const result = _repairByClosing(input, firstBrace);
	if (result) return result;

	// Strategy 2: For severely truncated JSON, try progressively shorter substrings
	const json = input.slice(firstBrace);
	const lastGoodBoundaries = [
		json.lastIndexOf('}'),
		json.lastIndexOf(']'),
		json.lastIndexOf('"'),
	].filter(i => i > 0).sort((a, b) => b - a);

	for (const boundary of lastGoodBoundaries) {
		const candidate = json.slice(0, boundary + 1);
		const repaired = _repairByClosing(candidate, 0);
		if (repaired) return repaired;
	}

	return null;
};

const _repairByClosing = (input: string, startIdx: number): any | null => {
	let json = input.slice(startIdx);

	let openBraces = 0, openBrackets = 0;
	let inString = false, escaped = false;
	for (let i = 0; i < json.length; i++) {
		const ch = json[i];
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') openBraces++;
		else if (ch === '}') openBraces--;
		else if (ch === '[') openBrackets++;
		else if (ch === ']') openBrackets--;
	}

	if (openBraces === 0 && openBrackets === 0) return null;
	if (openBraces < 0 || openBrackets < 0) return null;

	if (inString) json += '"';

	// Remove trailing incomplete content with multiple patterns
	const cleanPatterns = [
		/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/,
		/,\s*\{[^}]*$/,
		/,\s*\[[^\]]*$/,
		/,\s*"[^"]*$/,
	];
	for (const pattern of cleanPatterns) {
		const cleaned = json.replace(pattern, '');
		if (cleaned.length !== json.length && cleaned.length > 5) {
			json = cleaned;
			break;
		}
	}

	json = json.replace(/,\s*$/, '');

	// Re-count
	openBraces = 0; openBrackets = 0; inString = false; escaped = false;
	for (let i = 0; i < json.length; i++) {
		const ch = json[i];
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') openBraces++;
		else if (ch === '}') openBraces--;
		else if (ch === '[') openBrackets++;
		else if (ch === ']') openBrackets--;
	}

	if (inString) json += '"';
	for (let i = 0; i < openBrackets; i++) json += ']';
	for (let i = 0; i < openBraces; i++) json += '}';

	try {
		const parsed = JSON.parse(json);
		if (parsed && typeof parsed === 'object') {
			console.warn('[_tryRepairTruncatedJson] Successfully repaired truncated JSON (' + input.length + ' chars)');
			return parsed;
		}
	} catch { /* repair failed */ }

	return null;
};

// tool use for AI
type ValidateBuiltinParams = { [T in BuiltinToolName]: (p: RawToolParamsObj) => BuiltinToolCallParams[T] }
// ... (rest of the code remains the same)
type CallBuiltinTool = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T]) => Promise<{ result: BuiltinToolResultType[T] | Promise<BuiltinToolResultType[T]>, interruptTool?: () => void }> }
type BuiltinToolResultToString = { [T in BuiltinToolName]: (p: BuiltinToolCallParams[T], result: Awaited<BuiltinToolResultType[T]>) => string }


const isFalsy = (u: unknown) => {
	return !u || u === 'null' || u === 'undefined'
}

// Clean up AI-generated metadata tags from URI/path values
// Only used for URI parameters, NOT for code content
// Pre-compiled regex for performance - avoid re-creating on every call
const _aiMetadataTagRegex = (() => {
	const tags = [
		'is_folder', 'isfolder', 'isFolder',
		'is_file', 'isfile', 'isFile',
		'type', 'folder_type', 'file_type',
		'folder', 'file', 'directory',
		'recursive', 'is_recursive', 'isRecursive',
		'kind', 'mode', 'is_dir', 'isDir'
	]
	// Build a single combined regex: <(tag1|tag2|...)>[^<]*</(tag1|tag2|...)>
	const tagGroup = tags.join('|')
	return new RegExp(`<(?:${tagGroup})>[^<]*</(?:${tagGroup})>`, 'gi')
})()

const cleanAIMetadataTags = (str: string): string => {
	return str.replace(_aiMetadataTagRegex, '').trim()
}

// Simple string validation - similar to original implementation
const validateStr = (argName: string, value: unknown, opts?: { allowEmpty?: boolean }): string => {
	if (value === undefined || value === null) {
		throw new Error(`参数错误: ${argName} 未提供。请确保工具调用包含所有必需参数。`)
	}
	if (typeof value !== 'string') {
		throw new Error(`参数格式错误: ${argName} 必须是字符串，但类型是 "${typeof value}"。值: ${JSON.stringify(value)}`)
	}
	if (!opts?.allowEmpty && value.trim().length === 0) {
		throw new Error(`参数错误: ${argName} 不能为空字符串。`)
	}
	return value
}


// Check if a path is absolute
const isAbsolutePath = (pathStr: string): boolean => {
	// Windows absolute paths: C:\, D:\, \\, etc.
	if (/^[a-zA-Z]:[\\/]/.test(pathStr)) return true
	if (pathStr.startsWith('\\\\')) return true
	// Unix absolute paths: /
	if (pathStr.startsWith('/')) return true
	return false
}

// Validate URI with workspace context support for relative paths
const validateURIWithWorkspace = (uriStr: unknown, workspaceRootUri: URI | null): URI => {
	if (uriStr === null) throw new Error(`Invalid LLM output: uri was null.`)
	if (typeof uriStr !== 'string') throw new Error(`Invalid LLM output format: Provided uri must be a string, but it's a(n) ${typeof uriStr}. Full value: ${JSON.stringify(uriStr)}.`)

	// Clean up any AI metadata tags that might be incorrectly included (e.g., <type>folder</type>)
	let cleanedUri = cleanAIMetadataTags(uriStr)
		.replace(/\s+/g, '') // Remove whitespace
		.trim()

	// If cleaning resulted in empty string, throw error
	if (!cleanedUri) {
		throw new Error(`Invalid URI: after cleaning XML tags, the URI is empty. Original value: "${uriStr}"`)
	}

	// Check if it's already a full URI with scheme
	if (cleanedUri.includes('://')) {
		try {
			return URI.parse(cleanedUri)
		} catch (e) {
			throw new Error(`Invalid URI format: ${cleanedUri}. Error: ${e}`)
		}
	}

	// Check if it's an absolute path
	if (isAbsolutePath(cleanedUri)) {
		return URI.file(cleanedUri)
	}

	// It's a relative path - resolve against workspace root
	if (workspaceRootUri) {
		// Normalize path separators and join with workspace root
		const normalizedPath = cleanedUri.replace(/\\/g, '/')
		const workspacePath = workspaceRootUri.path.endsWith('/') ? workspaceRootUri.path : workspaceRootUri.path + '/'
		const fullPath = workspacePath + normalizedPath
		return workspaceRootUri.with({ path: fullPath })
	} else {
		// No workspace, try to use as file path anyway
		return URI.file(cleanedUri)
	}
}

const validateOptionalStr = (argName: string, str: unknown) => {
	if (isFalsy(str)) return null
	return validateStr(argName, str)
}


const validatePageNum = (pageNumberUnknown: unknown) => {
	if (!pageNumberUnknown) return 1
	const parsedInt = Number.parseInt(pageNumberUnknown + '')
	if (!Number.isInteger(parsedInt)) throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`)
	if (parsedInt < 1) throw new Error(`Invalid LLM output format: Specified page number must be 1 or greater: "${pageNumberUnknown}".`)
	return parsedInt
}

const validateNumber = (numStr: unknown, opts: { default: number | null }) => {
	if (typeof numStr === 'number')
		return numStr
	if (isFalsy(numStr)) return opts.default

	if (typeof numStr === 'string') {
		// Clean XML tags before parsing
		const cleaned = cleanAIMetadataTags(numStr)
		if (!cleaned) return opts.default
		const parsedInt = Number.parseInt(cleaned)
		if (!Number.isInteger(parsedInt) || isNaN(parsedInt)) return opts.default
		return parsedInt
	}

	// Handle object type (some AI models might wrap values)
	if (typeof numStr === 'object' && numStr !== null) {
		const obj = numStr as Record<string, unknown>
		if (obj.value !== undefined) {
			return validateNumber(obj.value, opts)
		}
	}

	return opts.default
}

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	if (!terminalIdUnknown) throw new Error(`A value for terminalID must be specified, but the value was "${terminalIdUnknown}"`)
	const terminalId = terminalIdUnknown + ''
	return terminalId
}

const validateBoolean = (b: unknown, opts: { default: boolean }) => {
	if (typeof b === 'string') {
		// Clean XML tags before checking
		const cleaned = cleanAIMetadataTags(b).toLowerCase()
		if (cleaned === 'true' || cleaned === '1' || cleaned === 'yes') return true
		if (cleaned === 'false' || cleaned === '0' || cleaned === 'no') return false
	}
	if (typeof b === 'boolean') {
		return b
	}
	if (typeof b === 'number') {
		return b !== 0
	}
	// Handle object type (some AI models might wrap values)
	if (typeof b === 'object' && b !== null) {
		const obj = b as Record<string, unknown>
		if (obj.value !== undefined) {
			return validateBoolean(obj.value, opts)
		}
	}
	return opts.default
}


// Helper to extract a value from multiple possible parameter names (for AI model compatibility)
const getParamWithAliases = (params: RawToolParamsObj, primaryName: string, aliases: string[]): unknown => {
	// Try primary name first
	if (params[primaryName] !== undefined && params[primaryName] !== null) {
		return params[primaryName]
	}
	// Try aliases
	for (const alias of aliases) {
		if (params[alias] !== undefined && params[alias] !== null) {
			return params[alias]
		}
	}
	return undefined
}

// Common parameter aliases for different AI models
// NOTE: Removed ambiguous aliases that conflict with AI metadata tags (folder, file, content, text, code, etc.)
const URI_ALIASES = ['path', 'file_path', 'filepath', 'directory', 'dir', 'target', 'location']
const QUERY_ALIASES = ['search', 'search_query', 'keyword', 'keywords', 'term']

// Pre-computed Sets for checkIfIsFolder - avoid re-creating arrays on every call
const _commonFileExtensions = new Set([
	'.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte',
	'.css', '.scss', '.sass', '.less', '.styl',
	'.html', '.htm', '.xml', '.svg',
	'.json', '.yaml', '.yml', '.toml', '.ini', '.env',
	'.md', '.txt', '.log', '.csv',
	'.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
	'.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
	'.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
	'.woff', '.woff2', '.ttf', '.eot',
	'.lock', '.map', '.d.ts', '.config.js', '.config.ts',
	'.gitignore', '.npmrc', '.nvmrc', '.editorconfig',
])
const _dotFolders = new Set(['.git', '.senweaver', '.vscode', '.idea', '.github', '.husky', '.config', '.cache', '.next', '.nuxt'])
const _folderPatterns = new Set(['src', 'lib', 'dist', 'build', 'public', 'assets', 'components', 'pages', 'styles', 'utils', 'hooks', 'types', 'api', 'services', 'store', 'config', 'test', 'tests', 'spec', 'docs', 'scripts', 'bin', 'node_modules', 'vendor', 'frontend', 'backend', 'home'])
const _alphaNumRegex = /^[a-zA-Z0-9]+$/

const checkIfIsFolder = (uriStr: string) => {
	uriStr = uriStr.trim()
	// 1. 如果以斜杠结尾，一定是目录
	if (uriStr.endsWith('/') || uriStr.endsWith('\\')) return true

	// 2. 获取路径的最后一部分（文件名或目录名）
	const lastPart = uriStr.split(/[/\\]/).pop() || ''

	// 3. 快速扩展名检查 - 提取最后一个 '.' 之后的部分
	const lowerUri = uriStr.toLowerCase()
	const lastDotIdx = lowerUri.lastIndexOf('.')
	if (lastDotIdx !== -1) {
		const ext = lowerUri.substring(lastDotIdx)
		if (_commonFileExtensions.has(ext)) return false
		// 也检查复合扩展名如 .d.ts, .config.js
		const secondLastDotIdx = lowerUri.lastIndexOf('.', lastDotIdx - 1)
		if (secondLastDotIdx !== -1) {
			const compoundExt = lowerUri.substring(secondLastDotIdx)
			if (_commonFileExtensions.has(compoundExt)) return false
		}
	}

	// 4. 检查是否是点开头的目录
	const lastPartLower = lastPart.toLowerCase()
	if (_dotFolders.has(lastPartLower)) {
		return true
	}

	// 5. 如果最后一部分包含点号，且点号后面有内容，可能是文件
	if (lastPart.includes('.') && !lastPart.startsWith('.')) {
		const extPart = lastPart.split('.').pop() || ''
		if (extPart.length > 0 && extPart.length <= 10 && _alphaNumRegex.test(extPart)) {
			return false // 是文件
		}
	}

	// 7. 默认情况：如果路径看起来像目录名（没有扩展名），认为是目录
	if (_folderPatterns.has(lastPartLower)) {
		return true
	}

	// 8. 如果没有扩展名，默认认为是目录
	if (!lastPart.includes('.')) {
		return true
	}

	return false
}

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateBuiltinParams;
	callTool: CallBuiltinTool;
	stringOfResult: BuiltinToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	public validateParams: ValidateBuiltinParams;
	public callTool: CallBuiltinTool;
	public stringOfResult: BuiltinToolResultToString;

	constructor(
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ISenweaverModelService senweaverModelService: ISenweaverModelService,
		@IEditCodeService private readonly editCodeService: IEditCodeService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@ISenweaverCommandBarService private readonly commandBarService: ISenweaverCommandBarService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ISenweaverSettingsService private readonly senweaverSettingsService: ISenweaverSettingsService,
		@ISenweaverBrowserService private readonly browserService: ISenweaverBrowserService,
		@ISenweaverDocumentService private readonly documentService: ISenweaverDocumentService,
		@ISkillService private readonly skillService: ISkillService,
		@IProductService private readonly productService: IProductService,
	) {
		// 从 product.json 获取 API 配置
		const apiConfig = this.productService.senweaverApiConfig || {
			apiBaseUrl: 'https://ide-api.senweaver.com',
			wsBaseUrl: 'wss://ide-api.senweaver.com',
			secretKey: ''
		};
		const secretKey = apiConfig.secretKey;
		// Note: Fetch URL and Web Search backend servers are now started by Electron main process
		// See: src/main.ts -> startFetchUrlBackendServer() and startWebSearchBackendServer()

		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		// Get workspace root URI for resolving relative paths
		const getWorkspaceRootUri = (): URI | null => {
			const folders = workspaceContextService.getWorkspace().folders
			return folders.length > 0 ? folders[0].uri : null
		}

		// Helper to validate URI with workspace context
		const validateURIInWorkspace = (uriStr: unknown): URI => {
			return validateURIWithWorkspace(uriStr, getWorkspaceRootUri())
		}

		this.validateParams = {
			read_file: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const { start_line: startLineUnknown, end_line: endLineUnknown, page_number: pageNumberUnknown } = params
				const uri = validateURIInWorkspace(uriUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				let startLine = validateNumber(startLineUnknown, { default: null })
				let endLine = validateNumber(endLineUnknown, { default: null })

				if (startLine !== null && startLine < 1) startLine = null
				if (endLine !== null && endLine < 1) endLine = null

				return { uri, startLine, endLine, pageNumber }
			},
			ls_dir: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const { page_number: pageNumberUnknown } = params

				const uri = validateURIInWorkspace(uriUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { uri, pageNumber }
			},
			get_dir_tree: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const uri = validateURIInWorkspace(uriUnknown)
				return { uri }
			},
			search_pathnames_only: (params: RawToolParamsObj) => {
				const queryUnknown = getParamWithAliases(params, 'query', QUERY_ALIASES)
				const includeUnknown = getParamWithAliases(params, 'search_in_folder', ['folder', 'directory', 'dir', 'include_pattern'])
				const { page_number: pageNumberUnknown } = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const includePattern = validateOptionalStr('include_pattern', includeUnknown)

				return { query: queryStr, includePattern, pageNumber }

			},
			search_for_files: (params: RawToolParamsObj) => {
				const queryUnknown = getParamWithAliases(params, 'query', QUERY_ALIASES)
				const searchInFolderUnknown = getParamWithAliases(params, 'search_in_folder', ['folder', 'directory', 'dir', 'path'])
				const isRegexUnknown = getParamWithAliases(params, 'is_regex', ['isRegex', 'regex', 'use_regex'])
				const { page_number: pageNumberUnknown } = params
				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const searchInFolder = isFalsy(searchInFolderUnknown) ? null : validateURIInWorkspace(searchInFolderUnknown)
				const isRegex = validateBoolean(isRegexUnknown, { default: false })
				return {
					query: queryStr,
					isRegex,
					searchInFolder,
					pageNumber
				}
			},
			search_in_file: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES);
				const queryUnknown = getParamWithAliases(params, 'query', QUERY_ALIASES);
				const isRegexUnknown = getParamWithAliases(params, 'is_regex', ['isRegex', 'regex', 'use_regex']);
				const uri = validateURIInWorkspace(uriUnknown);
				const query = validateStr('query', queryUnknown);
				const isRegex = validateBoolean(isRegexUnknown, { default: false });
				return { uri, query, isRegex };
			},

			read_lint_errors: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const uri = validateURIInWorkspace(uriUnknown)
				return { uri }
			},

			// ---

			create_file_or_folder: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const uri = validateURIInWorkspace(uriUnknown)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isFolder }
			},

			delete_file_or_folder: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const isRecursiveUnknown = getParamWithAliases(params, 'is_recursive', ['recursive', 'isRecursive'])
				const uri = validateURIInWorkspace(uriUnknown)
				const isRecursive = validateBoolean(isRecursiveUnknown, { default: false })
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isRecursive, isFolder }
			},

			rewrite_file: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const uri = validateURIInWorkspace(uriUnknown)
				const newContentUnknown = params.new_content ?? params.newContent ?? params.content ?? params.code ?? params.text
				const newContent = validateStr('new_content', newContentUnknown)
				return { uri, newContent }
			},

			edit_file: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES)
				const uri = validateURIInWorkspace(uriUnknown)

				// 尝试多种参数名获取 search_replace_blocks（不同模型可能用不同名称）
				const searchReplaceBlocksUnknown = params.search_replace_blocks
					?? params.searchReplaceBlocks
					?? params.blocks
					?? params.changes
					?? params.edits
					?? params.content

				let searchReplaceBlocks = validateStr('search_replace_blocks', searchReplaceBlocksUnknown)

				// 统一换行符
				searchReplaceBlocks = searchReplaceBlocks.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

				// Validate that the blocks string is not empty and contains required markers
				if (!searchReplaceBlocks || searchReplaceBlocks.trim().length === 0) {
					throw new Error(`The search_replace_blocks parameter cannot be empty. You must provide at least one SEARCH/REPLACE block formatted with "<<<<<<< ORIGINAL", "=======", and ">>>>>>> UPDATED" markers.`)
				}

				// 先规范化各种变体标记
				let normalized = searchReplaceBlocks
					.replace(/<{5,}\s*>{0,}\s*(?:ORIGINAL|SEARCH|HEAD)/gi, '<<<<<<< ORIGINAL')
					.replace(/>{5,}\s*(?:UPDATED|REPLACE|NEW|CHANGED|MODIFIED|FINAL|END|RESULT)/gi, '>>>>>>> UPDATED')

				if (!normalized.includes('<<<<<<< ORIGINAL')) {
					// Compatibility: allow simplified format "<original> ======= <updated>" (single block)
					if (normalized.includes('=======')) {
						const parts = normalized.split(/\n={7,}\n/)
						if (parts.length === 2) {
							const original = parts[0]?.trim() ?? ''
							const updated = parts[1]?.trim() ?? ''
							if (original.length > 0 && updated.length > 0) {
								searchReplaceBlocks = `<<<<<<< ORIGINAL\n${original}\n=======\n${updated}\n>>>>>>> UPDATED`
								return { uri, searchReplaceBlocks }
							}
						}
					}

					const preview = searchReplaceBlocks.substring(0, 100)
					if (searchReplaceBlocks.includes('{') || searchReplaceBlocks.includes('function') || searchReplaceBlocks.includes('import ')) {
						throw new Error(`Invalid format: search_replace_blocks must contain "<<<<<<< ORIGINAL" markers. You provided raw code: "${preview}...". \n\nIf you want to replace the entire file, use the 'rewrite_file' tool instead. \nIf you want to edit specific parts, you MUST use the format:\n<<<<<<< ORIGINAL\n<original code>\n=======\n<new code>\n>>>>>>> UPDATED`)
					}
					throw new Error(`Invalid format: search_replace_blocks must contain "<<<<<<< ORIGINAL" markers. Received: "${preview}${searchReplaceBlocks.length > 100 ? '...' : ''}". Please format your blocks correctly.`)
				} else {
					// 使用规范化后的版本
					searchReplaceBlocks = normalized
				}

				return { uri, searchReplaceBlocks }
			},

			// ---

			run_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, cwd: cwdUnknown } = params
				const command = validateStr('command', commandUnknown)
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				const terminalId = generateUuid()
				return { command, cwd, terminalId }
			},
			run_persistent_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, persistent_terminal_id: persistentTerminalIdUnknown } = params;
				const command = validateStr('command', commandUnknown);
				const persistentTerminalId = validateProposedTerminalId(persistentTerminalIdUnknown)
				return { command, persistentTerminalId };
			},
			open_persistent_terminal: (params: RawToolParamsObj) => {
				const { cwd: cwdUnknown } = params;
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				// No parameters needed; will open a new background terminal
				return { cwd };
			},
			kill_persistent_terminal: (params: RawToolParamsObj) => {
				const { persistent_terminal_id: terminalIdUnknown } = params;
				const persistentTerminalId = validateProposedTerminalId(terminalIdUnknown);
				return { persistentTerminalId };
			},

			open_browser: (params: RawToolParamsObj) => {
				const { url: urlUnknown, headless: headlessUnknown } = params;
				const url = validateStr('url', urlUnknown);
				// Validate that it's a valid URL
				if (!url.startsWith('http://') && !url.startsWith('https://')) {
					throw new Error(`Invalid URL: must start with http:// or https://. Got: ${url}`);
				}
				// headless: true (default) = no window, false = show browser window
				const headless = String(headlessUnknown) === 'false' ? false : true;
				return { url, headless };
			},

			fetch_url: (params: RawToolParamsObj) => {
				const {
					url: urlUnknown,
					method: methodUnknown,
					headers: headersUnknown,
					body: bodyUnknown,
					max_length: maxLengthUnknown,
					start_index: startIndexUnknown,
					// Multi-page crawling options
					crawl_links: crawlLinksUnknown,
					max_pages: maxPagesUnknown,
					max_depth: maxDepthUnknown
				} = params;
				const url = validateStr('url', urlUnknown);
				// Validate that it's a valid URL
				if (!url.startsWith('http://') && !url.startsWith('https://')) {
					throw new Error(`Invalid URL: must start with http:// or https://. Got: ${url}`);
				}
				const method = validateOptionalStr('method', methodUnknown) ?? undefined;
				const headers = validateOptionalStr('headers', headersUnknown) ?? undefined;
				const body = validateOptionalStr('body', bodyUnknown) ?? undefined;

				// 分页参数 (参考fetch项目设计)
				const maxLength = validateNumber(maxLengthUnknown, { default: 5000 }) ?? 5000;
				const startIndex = validateNumber(startIndexUnknown, { default: 0 }) ?? 0;

				// 多页面爬取参数 - 支持 boolean、string 或 number 类型的输入
				const crawlLinks = !!crawlLinksUnknown && ['true', '1'].includes(String(crawlLinksUnknown).toLowerCase());
				const maxPages = validateNumber(maxPagesUnknown, { default: 5 }) ?? 5;
				const maxDepth = validateNumber(maxDepthUnknown, { default: 1 }) ?? 1;

				// 验证分页参数
				if (maxLength < 1 || maxLength > 1000000) {
					throw new Error(`Invalid max_length: must be between 1 and 1000000. Got: ${maxLength}`);
				}
				if (startIndex < 0) {
					throw new Error(`Invalid start_index: must be >= 0. Got: ${startIndex}`);
				}

				return {
					url, method, headers, body,
					max_length: maxLength,
					start_index: startIndex,
					crawl_links: crawlLinks,
					max_pages: Math.min(maxPages, 10),  // Cap at 10 pages
					max_depth: Math.min(maxDepth, 2)    // Cap at depth 2
				};
			},

			web_search: (params: RawToolParamsObj) => {
				const queryUnknown = getParamWithAliases(params, 'query', QUERY_ALIASES);
				const maxResultsUnknown = getParamWithAliases(params, 'max_results', ['maxResults', 'limit', 'count', 'num_results']);
				const query = validateStr('query', queryUnknown);
				let maxResults = (validateNumber(maxResultsUnknown, { default: 20 }) ?? 20);
				// Enforce minimum of 20 to ensure result diversity across 8 engines
				if (maxResults < 20) maxResults = 20;
				if (maxResults < 1 || maxResults > 50) {
					throw new Error(`Invalid max_results: must be between 1 and 50. Got: ${maxResults}`);
				}
				return { query, max_results: maxResults };
			},

			// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
			// clone_website: (params: RawToolParamsObj) => {
			// 	const { url: urlUnknown, max_pages, max_depth, same_domain_only } = params;
			// 	const url = validateStr('url', urlUnknown);
			// 	// Validate that it's a valid URL
			// 	if (!url.startsWith('http://') && !url.startsWith('https://')) {
			// 		throw new Error(`Invalid URL: must start with http:// or https://. Got: ${url}`);
			// 	}

			// 	// Optional parameters with defaults
			// 	const maxPages = validateNumber(max_pages, { default: 20 }) ?? 20;
			// 	const maxDepth = validateNumber(max_depth, { default: 2 }) ?? 2;
			// 	const sameDomainOnly = validateBoolean(same_domain_only, { default: true });

			// 	return { url, maxPages, maxDepth, sameDomainOnly };
			// },

			analyze_image: (params: RawToolParamsObj) => {
				const { image_data: imageDataUnknown, prompt, api_key, model } = params;
				const image_data = validateStr('image_data', imageDataUnknown);

				// Validate that image_data is not empty
				if (!image_data || image_data.trim().length === 0) {
					throw new Error('Invalid image_data: cannot be empty');
				}

				// Optional parameters
				const promptStr = validateOptionalStr('prompt', prompt);
				const apiKeyStr = validateOptionalStr('api_key', api_key);
				const modelStr = validateOptionalStr('model', model);

				return {
					image_data,
					prompt: promptStr || undefined,
					api_key: apiKeyStr || undefined,
					model: modelStr || undefined
				};
			},

			screenshot_to_code: (params: RawToolParamsObj) => {
				const { source: sourceUnknown, image_data, url, stack, custom_prompt } = params;
				const source = validateStr('source', sourceUnknown) as 'image' | 'url';

				// Validate source
				if (source !== 'image' && source !== 'url') {
					throw new Error('Invalid source: must be "image" or "url"');
				}

				// Validate based on source type
				if (source === 'image') {
					const imageData = validateStr('image_data', image_data);
					if (!imageData || imageData.trim().length === 0) {
						throw new Error('Invalid image_data: cannot be empty when source is "image"');
					}
				} else if (source === 'url') {
					const urlStr = validateStr('url', url);
					if (!urlStr || !urlStr.startsWith('http')) {
						throw new Error('Invalid url: must be a valid HTTP URL when source is "url"');
					}
				}

				// Validate stack if provided
				const validStacks = ['html_tailwind', 'html_css', 'react_tailwind', 'vue_tailwind', 'ionic_tailwind', 'bootstrap', 'svg'];
				const stackStr = validateOptionalStr('stack', stack);
				if (stackStr && !validStacks.includes(stackStr)) {
					throw new Error(`Invalid stack: must be one of ${validStacks.join(', ')}`);
				}

				return {
					source,
					image_data: source === 'image' ? validateStr('image_data', image_data) : undefined,
					url: source === 'url' ? validateStr('url', url) : undefined,
					stack: stackStr || 'html_tailwind',
					custom_prompt: validateOptionalStr('custom_prompt', custom_prompt) || undefined
				};
			},

			api_request: (params: RawToolParamsObj) => {
				const { url: urlUnknown, method, headers, body, auth, timeout } = params;
				const url = validateStr('url', urlUnknown);

				// Validate URL format
				if (!url.startsWith('http://') && !url.startsWith('https://')) {
					throw new Error(`Invalid URL: must start with http:// or https://. Got: ${url}`);
				}

				// Parse optional method (default: GET)
				const methodStr = validateOptionalStr('method', method)?.toUpperCase() || 'GET';
				const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
				if (!validMethods.includes(methodStr)) {
					throw new Error(`Invalid method: must be one of ${validMethods.join(', ')}. Got: ${methodStr}`);
				}

				// Parse optional headers (JSON object)
				let headersObj: Record<string, string> = {};
				if (headers) {
					if (typeof headers === 'string') {
						try {
							headersObj = JSON.parse(headers);
						} catch (e) {
							throw new Error(`Invalid headers: must be a valid JSON object`);
						}
					} else if (typeof headers === 'object') {
						headersObj = headers as Record<string, string>;
					}
				}

				// Parse optional body
				const bodyStr = validateOptionalStr('body', body);

				// Parse optional auth
				let authObj: { type: string, username?: string, password?: string, token?: string, key?: string, value?: string, addTo?: string } | undefined;
				if (auth) {
					if (typeof auth === 'string') {
						try {
							authObj = JSON.parse(auth);
						} catch (e) {
							throw new Error(`Invalid auth: must be a valid JSON object`);
						}
					} else if (typeof auth === 'object') {
						authObj = auth as typeof authObj;
					}
				}

				// Parse optional timeout (default: 30000, max: 60000)
				let timeoutNum = validateNumber(timeout, { default: 30000 }) ?? 30000;
				if (timeoutNum > 60000) timeoutNum = 60000;
				if (timeoutNum < 1000) timeoutNum = 1000;

				return {
					url,
					method: methodStr,
					headers: headersObj,
					body: bodyStr || undefined,
					auth: authObj,
					timeout: timeoutNum
				};
			},

			read_document: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES);
				const { start_index: startIndexUnknown, max_length: maxLengthUnknown } = params;

				const uri = validateURIInWorkspace(uriUnknown);
				const startIndex = validateNumber(startIndexUnknown, { default: 0 }) ?? 0;
				const maxLength = validateNumber(maxLengthUnknown, { default: 50000 }) ?? 50000;

				return { uri, startIndex, maxLength };
			},

			edit_document: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES);
				const { content: contentUnknown, backup: backupUnknown, replacements: replacementsUnknown } = params;

				const uri = validateURIInWorkspace(uriUnknown);
				// Parse replacements array first — content can be empty when using replacements mode
				let replacements: Array<{ find: string, replace: string, bold?: boolean, italic?: boolean }> | undefined;
				if (replacementsUnknown) {
					if (typeof replacementsUnknown === 'string') {
						try {
							replacements = JSON.parse(replacementsUnknown);
						} catch {
							replacements = undefined;
						}
					} else if (Array.isArray(replacementsUnknown)) {
						replacements = replacementsUnknown;
					}
				}
				// Allow empty content when replacements are provided (incremental edit mode)
				const hasReplacements = replacements && replacements.length > 0;
				const content = hasReplacements
					? (typeof contentUnknown === 'string' ? contentUnknown : '')
					: validateStr('content', contentUnknown);
				// Default backup to false
				const backup = String(backupUnknown) === 'true';

				return { uri, content, backup, replacements };
			},

			create_document: (params: RawToolParamsObj) => {
				const { type, file_path, document_data, options } = params as any;
				if (!type || !file_path || !document_data) {
					throw new Error('type, file_path and document_data are required');
				}
				if (type !== 'word' && type !== 'excel' && type !== 'ppt') {
					throw new Error('type must be "word", "excel", or "ppt"');
				}

				const parsed = _tryParseJsonFromString(document_data);
				if (!parsed && typeof document_data === 'string') {
					console.warn('[create_document] Failed to parse document_data as JSON, using raw string');
				}
				const normalizedDocumentData = parsed && typeof parsed === 'object' ? parsed : document_data;
				return { type, file_path, document_data: normalizedDocumentData, options: options || {} };
			},

			pdf_operation: (params: RawToolParamsObj) => {
				const { operation, input_files, input_file, output_path, output_dir, watermark_text, options } = params as any;
				if (!operation) {
					throw new Error('operation is required (merge, split, or watermark)');
				}
				if (operation === 'merge' && (!input_files || !output_path)) {
					throw new Error('merge operation requires input_files and output_path');
				}
				if (operation === 'split' && (!input_file || !output_dir)) {
					throw new Error('split operation requires input_file and output_dir');
				}
				if (operation === 'watermark' && (!input_file || !output_path || !watermark_text)) {
					throw new Error('watermark operation requires input_file, output_path and watermark_text');
				}
				return { operation, input_files, input_file, output_path, output_dir, watermark_text, options: options || {} };
			},

			document_convert: (params: RawToolParamsObj) => {
				const { input_file, output_path, format, options } = params as any;
				if (!input_file || !output_path) {
					throw new Error('input_file and output_path are required');
				}
				const outputExt = extname(String(output_path)).toLowerCase().replace('.', '');
				const inferredFormat = outputExt || undefined;
				const formatCandidate = (format || inferredFormat || 'docx') as string;
				if (!['pdf', 'docx', 'images', 'xlsx', 'wps'].includes(formatCandidate)) {
					throw new Error('format must be "pdf", "docx", "images", "xlsx", or "wps" (or omit format to infer from output_path; default is docx)');
				}
				const finalFormat = formatCandidate as DocumentConvertFormat;
				const normalizedOutputPath = (finalFormat === 'wps' && outputExt === 'wps')
					? String(output_path).replace(/\.wps$/i, '.docx')
					: output_path;
				return { input_file, output_path: normalizedOutputPath, format: finalFormat, options: options || {} };
			},

			document_merge: (params: RawToolParamsObj) => {
				const { input_files, output_path, options } = params as any;
				if (!input_files || !output_path) {
					throw new Error('input_files and output_path are required');
				}
				if (!Array.isArray(input_files) || input_files.length < 2) {
					throw new Error('input_files must be an array with at least 2 files');
				}
				return { input_files, output_path, options: options || {} };
			},

			document_extract: (params: RawToolParamsObj) => {
				const { input_file, output_dir, extract_type, options } = params as any;
				if (!input_file || !output_dir || !extract_type) {
					throw new Error('input_file, output_dir and extract_type are required');
				}
				if (!['images', 'text', 'slides'].includes(extract_type)) {
					throw new Error('extract_type must be "images", "text", or "slides"');
				}
				return { input_file, output_dir, extract_type, options: options || {} };
			},

			// ========== 高级 Agent 工具 ==========
			spawn_subagent: (params: RawToolParamsObj) => {
				const { label, task_prompt, summary_prompt, context_low_prompt, timeout_ms, allowed_tools } = params as any;
				if (!label || !task_prompt || !summary_prompt || !context_low_prompt) {
					throw new Error('label, task_prompt, summary_prompt, and context_low_prompt are required');
				}
				return {
					label: String(label),
					task_prompt: String(task_prompt),
					summary_prompt: String(summary_prompt),
					context_low_prompt: String(context_low_prompt),
					timeout_ms: timeout_ms ? Number(timeout_ms) : undefined,
					allowed_tools: allowed_tools ? (Array.isArray(allowed_tools) ? allowed_tools : [allowed_tools]) : undefined
				};
			},

			edit_agent: (params: RawToolParamsObj) => {
				const uriUnknown = getParamWithAliases(params, 'uri', URI_ALIASES);
				const { mode, description, current_content, selection_range } = params as any;
				if (!uriUnknown || !mode || !description) {
					throw new Error('uri, mode, and description are required');
				}
				if (!['edit', 'create', 'overwrite'].includes(mode)) {
					throw new Error('mode must be "edit", "create", or "overwrite"');
				}
				const uri = validateURIInWorkspace(uriUnknown);
				return {
					uri,
					mode: mode as 'edit' | 'create' | 'overwrite',
					description: String(description),
					current_content: current_content ? String(current_content) : undefined,
					selection_range: selection_range ? {
						start_line: Number(selection_range.start_line || selection_range.startLine || 1),
						end_line: Number(selection_range.end_line || selection_range.endLine || 999999)
					} : undefined
				};
			},

			// ========== Skill 工具 ==========
			skill: (params: RawToolParamsObj) => {
				const name = validateStr('name', params.name);
				return { name };
			},

		}


		this.callTool = {
			read_file: async ({ uri, startLine, endLine, pageNumber }) => {
				await senweaverModelService.initializeModel(uri)
				const { model } = await senweaverModelService.getModelSafe(uri)
				if (model === null) { throw new Error(`No contents; File does not exist.`) }

				let contents: string
				if (startLine === null && endLine === null) {
					contents = model.getValue(EndOfLinePreference.LF)
				}
				else {
					const startLineNumber = startLine === null ? 1 : startLine
					const endLineNumber = endLine === null ? model.getLineCount() : endLine
					contents = model.getValueInRange({ startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
				}

				const totalNumLines = model.getLineCount()

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const fileContents = contents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (contents.length - 1) - toIdx >= 1
				const totalFileLen = contents.length
				return { result: { fileContents, totalFileLen, hasNextPage, totalNumLines } }
			},

			ls_dir: async ({ uri, pageNumber }) => {
				const dirResult = await computeDirectoryTree1Deep(fileService, uri, pageNumber)
				return { result: dirResult }
			},

			get_dir_tree: async ({ uri }) => {
				const str = await this.directoryStrService.getDirectoryStrTool(uri)
				return { result: { str } }
			},

			search_pathnames_only: async ({ query: queryStr, includePattern, pageNumber }) => {

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), {
					filePattern: queryStr,
					includePattern: includePattern ?? undefined,
					sortByScore: true, // makes results 10x better
				})
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { uris, hasNextPage } }
			},

			search_for_files: async ({ query: queryStr, isRegex, searchInFolder, pageNumber }) => {
				const searchFolders = searchInFolder === null ?
					workspaceContextService.getWorkspace().folders.map(f => f.uri)
					: [searchInFolder]

				const query = queryBuilder.text({
					pattern: queryStr,
					isRegExp: isRegex,
				}, searchFolders)

				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { queryStr, uris, hasNextPage } }
			},
			search_in_file: async ({ uri, query, isRegex }) => {
				await senweaverModelService.initializeModel(uri);
				const { model } = await senweaverModelService.getModelSafe(uri);
				if (model === null) { throw new Error(`No contents; File does not exist.`); }
				const matches = model.findMatches(query, false, isRegex, true, null, false, 2000)
				const uniq = new Set<number>()
				for (const m of matches) {
					uniq.add(m.range.startLineNumber)
				}
				const lines = Array.from(uniq)
				lines.sort((a, b) => a - b)
				return { result: { lines } };
			},

			read_lint_errors: async ({ uri }) => {
				// 快速检查lint错误，无需等待
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
			},

			// ---

			create_file_or_folder: async ({ uri, isFolder }) => {
				let changeStats: CodeChangeStats | undefined

				// 递归创建所有父目录的辅助函数
				const ensureParentDirs = async (targetUri: URI): Promise<void> => {
					const parentPath = targetUri.path.substring(0, targetUri.path.lastIndexOf('/'))
					if (!parentPath || parentPath === targetUri.path) return

					const parentUri = targetUri.with({ path: parentPath })
					try {
						const stat = await fileService.stat(parentUri)
						// 如果父路径存在但不是目录，这是一个问题
						if (!stat.isDirectory) {
							throw new Error(`Path ${parentUri.fsPath} exists but is not a directory`)
						}
					} catch (e: any) {
						// 父目录不存在，先递归创建更上层的目录
						if (e.code === 'FileNotFound' || e.name === 'FileNotFound' || e.message?.includes('ENOENT') || e.message?.includes('FileNotFound')) {
							await ensureParentDirs(parentUri)
							await fileService.createFolder(parentUri)
						} else if (!e.message?.includes('exists')) {
							// 如果不是"已存在"的错误，则重新抛出
							throw e
						}
					}
				}

				try {
					// 首先确保所有父目录存在
					await ensureParentDirs(uri)

					if (isFolder) {
						try {
							await fileService.createFolder(uri)
						} catch (e: any) {
							// 如果目录已存在，忽略错误
							if (!e.message?.includes('exists')) {
								throw e
							}
						}
					} else {
						// 创建文件
						try {
							await fileService.createFile(uri)
							changeStats = { linesAdded: 0, linesRemoved: 0 }
						} catch (e: any) {
							// 如果文件已存在，也不报错
							if (!e.message?.includes('exists')) {
								throw e
							}
						}
					}
				} catch (error: any) {
					throw new Error(`Unable to create ${isFolder ? 'folder' : 'file'} at ${uri.fsPath}. Error: ${error.message || error}`)
				}
				return { result: { changeStats } }
			},

			delete_file_or_folder: async ({ uri, isRecursive }) => {
				await fileService.del(uri, { recursive: isRecursive })
				return { result: {} }
			},

			rewrite_file: async ({ uri, newContent }) => {
				await senweaverModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}

				// 使用 model service 获取原始行数（已缓存，避免额外 I/O）
				let originalLineCount = 0
				let isNewFile = false
				const { model } = await senweaverModelService.getModelSafe(uri)
				if (model === null) {
					isNewFile = true
				} else {
					originalLineCount = model.getLineCount()
				}

				await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
				this.editCodeService.instantlyRewriteFile({ uri, newContent })

				// 计算变更统计（无延迟）
				const newLineCount = newContent ? newContent.split('\n').length : 0
				let changeStats: CodeChangeStats | undefined

				if (isNewFile) {
					changeStats = { linesAdded: newLineCount, linesRemoved: 0, isNewFile: true }
				} else {
					// 先尝试 diff 系统（同步，不等待）
					const diffStats = this.editCodeService.calculateDiffStats(uri)
					if (diffStats.linesAdded > 0 || diffStats.linesDeleted > 0) {
						changeStats = { linesAdded: diffStats.linesAdded, linesRemoved: diffStats.linesDeleted }
					} else {
						// 直接计算行数变化
						const linesAdded = Math.max(0, newLineCount - originalLineCount)
						const linesRemoved = Math.max(0, originalLineCount - newLineCount)
						if (linesAdded > 0 || linesRemoved > 0) {
							changeStats = { linesAdded, linesRemoved }
						} else if (newLineCount > 0) {
							changeStats = { linesAdded: newLineCount, linesRemoved: originalLineCount }
						}
					}
				}

				// lint 错误异步获取，不阻塞
				const lintErrorsPromise = new Promise<LintErrorItem[] | null>(resolve => {
					setTimeout(() => {
						resolve(this._getLintErrors(uri).lintErrors)
					}, 500)
				})

				return {
					result: (async () => {
						const lintErrors = await lintErrorsPromise
						return { lintErrors, changeStats }
					})()
				}
			},

			edit_file: async ({ uri, searchReplaceBlocks }) => {
				await senweaverModelService.initializeModel(uri)

				// 前置检查：文件必须存在才能编辑
				const { model: preCheckModel } = await senweaverModelService.getModelSafe(uri)
				if (preCheckModel === null) {
					throw new Error(
						`Cannot edit file: ${uri.fsPath} does not exist. ` +
						`To create a new file, use 'create_file_or_folder' first, then use 'rewrite_file' to write content.`
					)
				}

				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}

				// ========== 高效且健壮的 edit_file 实现 ==========
				// 多层回退策略确保编辑不会失败：
				// 1. 标准 editCodeService 应用
				// 2. 模糊匹配修复后重试
				// 3. 逐块应用（处理重叠）
				// 4. 直接文本替换回退（最后手段）

				const ORIGINAL_MARKER = '<<<<<<< ORIGINAL'
				const DIVIDER_MARKER = '======='
				const FINAL_MARKER = '>>>>>>> UPDATED'

				// ========== 1. 处理空值 ==========
				if (searchReplaceBlocks === null || searchReplaceBlocks === undefined) {
					throw new Error(`searchReplaceBlocks is null or undefined.`)
				}

				// ========== 2. 提取编辑块 (快速路径优先) ==========
				let blocks: Array<{ search: string, replace: string }>

				// 确保输入字符串换行符统一
				const normalizedInput = typeof searchReplaceBlocks === 'string'
					? searchReplaceBlocks.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
					: searchReplaceBlocks

				// Fast path: 如果已经是标准格式，直接用正则提取，跳过所有清理步骤
				if (typeof normalizedInput === 'string' && normalizedInput.includes(ORIGINAL_MARKER)) {
					blocks = []
					const markerPattern = /<<<<<<< ORIGINAL\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> UPDATED/g
					let match
					while ((match = markerPattern.exec(normalizedInput)) !== null) {
						blocks.push({ search: match[1], replace: match[2] })
					}

					// 如果标准格式提取失败（格式有轻微变体），走完整路径
					if (blocks.length === 0) {
						blocks = _extractBlocksFull(normalizedInput, ORIGINAL_MARKER, DIVIDER_MARKER, FINAL_MARKER)
					}
				} else {
					blocks = _extractBlocksFull(normalizedInput, ORIGINAL_MARKER, DIVIDER_MARKER, FINAL_MARKER)
				}

				if (blocks.length === 0) {
					throw new Error(
						`Invalid format: search_replace_blocks must contain "${ORIGINAL_MARKER}" markers. ` +
						`Received: "${typeof normalizedInput === 'string' ? normalizedInput.slice(0, 100) : JSON.stringify(normalizedInput).slice(0, 100)}...". ` +
						`Please format your blocks correctly.\n\n` +
						`Expected format:\n` +
						`${ORIGINAL_MARKER}\n` +
						`[exact code to find]\n` +
						`${DIVIDER_MARKER}\n` +
						`[code to replace with]\n` +
						`${FINAL_MARKER}\n\n` +
						`CRITICAL: You MUST use the exact markers shown above. Do not modify them.`
					)
				}

				// ========== 3. 多层策略尝试应用编辑 ==========
				let applySuccess = false
				let lastError: Error | null = null

				// 构建标准格式字符串
				const buildStandardFormat = (b: Array<{ search: string, replace: string }>): string => {
					return b.map(block =>
						`${ORIGINAL_MARKER}\n${block.search}\n${DIVIDER_MARKER}\n${block.replace}\n${FINAL_MARKER}`
					).join('\n\n')
				}

				// --- 策略 A: 直接使用提取的 blocks ---
				try {
					const standardFormat = buildStandardFormat(blocks)
					await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
					this.editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks: standardFormat })
					applySuccess = true
				} catch (e) {
					lastError = e instanceof Error ? e : new Error(String(e))
				}

				// --- 策略 B: 模糊匹配修复后重试 ---
				if (!applySuccess) {
					const errorMsg = (lastError?.message || '').toLowerCase()
					if (errorMsg.includes('not found') || errorMsg.includes('no match') || errorMsg.includes('not unique')) {
						try {
							const { model } = await senweaverModelService.getModelSafe(uri)
							if (model) {
								const content = model.getValue(EndOfLinePreference.LF)
								const fixedBlocks = _fixBlocksWithFuzzyMatch(blocks, content)
								const hasAnyFixed = fixedBlocks.some(b => b.fixed)

								if (hasAnyFixed) {
									const fixedFormat = buildStandardFormat(fixedBlocks)
									await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
									this.editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks: fixedFormat })
									applySuccess = true
									blocks = fixedBlocks
								}
							}
						} catch (retryError) {
							lastError = retryError instanceof Error ? retryError : new Error(String(retryError))
						}
					}
				}

				// --- 策略 C: 逐块应用（处理重叠和部分匹配） ---
				if (!applySuccess && blocks.length > 1) {
					const errorMsg = (lastError?.message || '').toLowerCase()
					// 对于重叠错误、not found、not unique 都尝试逐块
					if (errorMsg.includes('overlap') || errorMsg.includes('must not overlap') ||
						errorMsg.includes('not found') || errorMsg.includes('no match') ||
						errorMsg.includes('not unique')) {
						let successCount = 0
						let failedBlocks: Array<{ search: string, replace: string }> = []

						for (const block of blocks) {
							try {
								const singleFormat = buildStandardFormat([block])
								await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
								this.editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks: singleFormat })
								successCount++
							} catch (singleErr) {
								// 逐块模糊修复重试
								try {
									const { model } = await senweaverModelService.getModelSafe(uri)
									if (model) {
										const currentContent = model.getValue(EndOfLinePreference.LF)
										const fixedSingle = _fixBlocksWithFuzzyMatch([block], currentContent)
										if (fixedSingle[0].fixed) {
											const fixedFormat = buildStandardFormat([fixedSingle[0]])
											await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
											this.editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks: fixedFormat })
											successCount++
											continue
										}
									}
								} catch { /* 继续到回退 */ }
								failedBlocks.push(block)
							}
						}
						if (successCount > 0) {
							applySuccess = true
							// 如果有失败的块，尝试直接文本替换
							if (failedBlocks.length > 0) {
								try {
									const { model } = await senweaverModelService.getModelSafe(uri)
									if (model) {
										let currentContent = model.getValue(EndOfLinePreference.LF)
										let directFixCount = 0
										for (const fb of failedBlocks) {
											const normalizedSearch = _normalizeString(fb.search)
											if (currentContent.includes(normalizedSearch)) {
												currentContent = currentContent.replace(normalizedSearch, fb.replace)
												directFixCount++
											}
										}
										if (directFixCount > 0) {
											this.editCodeService.instantlyRewriteFile({ uri, newContent: currentContent })
										}
									}
								} catch { /* 已经部分成功，忽略剩余错误 */ }
							}
						}
					}
				}

				// --- 策略 D: 直接文本替换回退（最后手段） ---
				if (!applySuccess) {
					try {
						const { model } = await senweaverModelService.getModelSafe(uri)
						if (model) {
							let currentContent = model.getValue(EndOfLinePreference.LF)
							let replacementCount = 0

							for (const block of blocks) {
								const normalizedSearch = _normalizeString(block.search)

								// 精确匹配
								if (currentContent.includes(normalizedSearch)) {
									currentContent = currentContent.replace(normalizedSearch, block.replace)
									replacementCount++
									continue
								}

								// 去除行首尾空格后匹配
								const trimmedSearch = normalizedSearch.split('\n').map(l => l.trim()).join('\n')
								const contentLines = currentContent.split('\n')
								const searchLines = trimmedSearch.split('\n')
								let found = false

								for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
									let match = true
									for (let j = 0; j < searchLines.length; j++) {
										if (contentLines[i + j].trim() !== searchLines[j]) {
											match = false
											break
										}
									}
									if (match) {
										// 替换匹配的行，保持原始缩进
										const matchedLines = contentLines.slice(i, i + searchLines.length)
										const replaceLines = block.replace.split('\n')

										// 检测原始缩进
										const originalIndent = matchedLines[0].match(/^(\s*)/)?.[1] || ''
										const searchIndent = normalizedSearch.split('\n')[0].match(/^(\s*)/)?.[1] || ''
										const replaceWithIndent = replaceLines.map(l => {
											if (l.trim().length === 0) return l
											const lineIndent = l.match(/^(\s*)/)?.[1] || ''
											// 保持相对缩进
											if (searchIndent.length > 0 && lineIndent.startsWith(searchIndent)) {
												return originalIndent + l.substring(searchIndent.length)
											}
											return l
										})

										contentLines.splice(i, searchLines.length, ...replaceWithIndent)
										currentContent = contentLines.join('\n')
										replacementCount++
										found = true
										break
									}
								}

								if (!found) {
									// 模糊匹配作为最后尝试
									const fileLines = currentContent.split('\n')
									const fuzzyResult = _findBestMatchText(fileLines, normalizedSearch)
									if (fuzzyResult && fuzzyResult.similarity >= 0.70) {
										currentContent = currentContent.replace(fuzzyResult.matchedText, block.replace)
										replacementCount++
									}
								}
							}

							if (replacementCount > 0) {
								await this.editCodeService.callBeforeApplyOrEdit({ from: 'ClickApply', uri })
								this.editCodeService.instantlyRewriteFile({ uri, newContent: currentContent })
								applySuccess = true
							}
						}
					} catch (fallbackErr) {
						lastError = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr))
					}
				}

				// ========== 4. 如果所有策略都失败，抛出明确错误 ==========
				if (!applySuccess) {
					const errorDetails = lastError?.message || 'Unknown error'
					let suggestion = ''
					if (errorDetails.toLowerCase().includes('not found') || errorDetails.toLowerCase().includes('no match')) {
						suggestion = `\n\nSUGGESTION: The ORIGINAL section doesn't match the file content. Please:\n` +
							`1. Use read_file to get the LATEST file content\n` +
							`2. COPY the EXACT code from the file (character for character)\n` +
							`3. Do NOT retype the code manually - copy-paste it\n` +
							`4. Include enough context to make the match unique`
					} else if (errorDetails.toLowerCase().includes('overlap')) {
						suggestion = `\n\nSUGGESTION: Your ORIGINAL blocks overlap. Please:\n` +
							`1. Make sure each block targets a different part of the file\n` +
							`2. Or combine overlapping blocks into a single larger block`
					} else if (errorDetails.toLowerCase().includes('not unique')) {
						suggestion = `\n\nSUGGESTION: The ORIGINAL section matches multiple locations. Please:\n` +
							`1. Include MORE context lines to make the match unique\n` +
							`2. Include surrounding function names or unique identifiers`
					}
					throw new Error(`Failed to apply edits: ${errorDetails}` + suggestion)
				}

				// ========== 5. 计算变更统计（同步，不使用 delay） ==========
				let changeStats: CodeChangeStats | undefined
				const diffStats = this.editCodeService.calculateDiffStats(uri)
				if (diffStats.linesAdded > 0 || diffStats.linesDeleted > 0) {
					changeStats = { linesAdded: diffStats.linesAdded, linesRemoved: diffStats.linesDeleted }
				} else {
					let estimatedAdded = 0
					let estimatedRemoved = 0
					for (const block of blocks) {
						const searchLineCount = (block.search || '').split('\n').length
						const replaceLineCount = (block.replace || '').split('\n').length
						if (replaceLineCount > searchLineCount) {
							estimatedAdded += (replaceLineCount - searchLineCount)
						} else if (searchLineCount > replaceLineCount) {
							estimatedRemoved += (searchLineCount - replaceLineCount)
						}
					}
					// 至少报告有修改
					if (estimatedAdded === 0 && estimatedRemoved === 0) {
						estimatedAdded = blocks.reduce((sum, b) => sum + (b.replace || '').split('\n').length, 0)
						estimatedRemoved = blocks.reduce((sum, b) => sum + (b.search || '').split('\n').length, 0)
					}
					if (estimatedAdded > 0 || estimatedRemoved > 0) {
						changeStats = { linesAdded: estimatedAdded, linesRemoved: estimatedRemoved }
					}
				}

				// ========== 6. lint 错误异步获取 ==========
				const lintErrorsPromise = new Promise<LintErrorItem[] | null>(resolve => {
					setTimeout(() => {
						resolve(this._getLintErrors(uri).lintErrors)
					}, 500)
				})

				return {
					result: (async () => {
						const lintErrors = await lintErrorsPromise
						return { lintErrors, changeStats }
					})()
				}
			},
			// ---
			run_command: async ({ command, cwd, terminalId }) => {
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, { type: 'temporary', cwd, terminalId })
				return { result: resPromise, interruptTool: interrupt }
			},
			run_persistent_command: async ({ command, persistentTerminalId }) => {
				const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, { type: 'persistent', persistentTerminalId })
				return { result: resPromise, interruptTool: interrupt }
			},
			open_persistent_terminal: async ({ cwd }) => {
				const persistentTerminalId = await this.terminalToolService.createPersistentTerminal({ cwd })
				return { result: { persistentTerminalId } }
			},
			kill_persistent_terminal: async ({ persistentTerminalId }) => {
				// Close the background terminal by sending exit
				await this.terminalToolService.killPersistentTerminal(persistentTerminalId)
				return { result: {} }
			},

			open_browser: async ({ url, headless }) => {
				// headless: true (default) = backend Playwright automation
				// headless: false = open in built-in visual browser

				if (!headless) {
					// Use built-in visual browser (not external browser)
					try {
						await this.browserService.openBrowser(url);
						return {
							result: {
								url,
								title: '在内置浏览器中打开',
								status: 200,
								headless: false
							}
						};
					} catch (error) {
						console.warn('[open_browser] Built-in browser failed:', error);
					}
				}

				// Use backend browser automation service with Playwright (headless mode)
				try {
					// Detect backend port dynamically
					const browserPort = await detectOpenBrowserPort();
					const backendUrl = `http://localhost:${browserPort}/`;
					const requestBody = {
						action: 'open',
						url,
						headless: true,
						sessionId: 'default'
					};

					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						mode: 'cors',
						credentials: 'omit',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout(60000), // 60 seconds timeout
					});

					if (!backendResponse.ok) {
						const errorText = await backendResponse.text();
						throw new Error(`Browser automation failed: ${backendResponse.status} - ${errorText}`);
					}

					const data = await backendResponse.json() as {
						success: boolean;
						result: { url: string; title: string; status: number };
						error?: string;
					};

					if (!data.success) {
						throw new Error(data.error || 'Browser automation failed');
					}

					return {
						result: {
							url: data.result.url,
							title: data.result.title,
							status: data.result.status,
							headless: true
						}
					};
				} catch (error) {
					// Fallback to built-in browser if backend fails
					console.warn('[open_browser] Backend failed, falling back to built-in browser:', error);
					await this.browserService.openBrowser(url);
					return { result: { url, title: '在内置浏览器中打开', status: 200, headless: false } };
				}
			},
			fetch_url: async ({ url, method, headers, body, max_length, start_index, crawl_links, max_pages, max_depth }) => {
				try {
					// Validate URL format
					try {
						new URL(url);
					} catch (e) {
						throw new Error(`Invalid URL format: ${url}`);
					}

					// 使用默认值处理可选的分页参数
					const maxLength = max_length ?? 5000;
					const startIndex = start_index ?? 0;

					// 多页面爬取参数
					const crawlLinks = crawl_links ?? false;
					const maxPages = max_pages ?? 5;
					const maxDepth = max_depth ?? 1;

					// 调用后端服务而不是浏览器fetch
					// Backend service handles all the complexity:
					// - HTML detection and conversion to Markdown
					// - Main content extraction
					// - Pagination support
					// - Multi-page crawling (when crawl_links=true)
					// - Error handling

					// Retry logic to wait for backend server to start (reduced retries since timeout is now longer)
					let lastError: any = null;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const backendUrl = `http://localhost:${fetchUrlServerPort}/`;
							const requestBody = {
								url,
								max_length: maxLength,
								start_index: startIndex,
								// Multi-page crawling options
								crawl_links: crawlLinks,
								max_pages: maxPages,
								max_depth: maxDepth,
							};
							const backendResponse = await fetch(backendUrl, {
								method: 'POST',
								mode: 'cors',
								credentials: 'omit',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify(requestBody),
								signal: AbortSignal.timeout(120000), // 120 seconds for comprehensive page extraction
							});

							if (!backendResponse.ok) {
								const errorText = await backendResponse.text();
								return {
									result: {
										statusCode: backendResponse.status,
										headers: {},
										body: `[Error] Backend service error: ${backendResponse.status}\n\n${errorText}`,
									}
								};
							}

							const result = await backendResponse.json();
							// Backend already handles HTML conversion, content extraction, and pagination
							// Just return the result directly

							return {
								result: {
									statusCode: result.statusCode,
									headers: result.headers || {},
									body: result.body,
									contentLength: result.contentLength,
									hasMore: result.hasMore,
									nextIndex: result.nextIndex,
								}
							};
						} catch (error) {
							lastError = error;
							const errorMessage = error instanceof Error ? error.message : String(error);
							const errorName = error instanceof Error ? error.name : 'Unknown';
							console.error(`[fetch_url] ⚠️  Attempt ${attempt + 1}/3 failed: ${errorName} - ${errorMessage}`);

							if (attempt < 2) {
								// Exponential backoff: 300ms, 600ms
								await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
							}
						}
					}

					console.error(`[fetch_url] 💥 All retry attempts failed. Last error:`, lastError);
					throw lastError || new Error('Backend service unavailable after 3 attempts');
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error(`[fetch_url] 🚨 Final error:`, error);
					throw new Error(`Failed to fetch URL: ${errorMessage}`);
				}
			},
			web_search: async ({ query, max_results }) => {
				try {
					// 配置
					const REMOTE_API_URL = 'https://your-remote-api.com/api/web_search'; // TODO: 替换为实际的远程API地址
					const LOCAL_BACKEND_URL = 'http://localhost:3001/';
					const REMOTE_TIMEOUT = 20000; // 远程API超时20秒
					const LOCAL_TIMEOUT = 35000; // 本地后端超时35秒（后端整体超时30秒 + 5秒缓冲时间）

					// 生成认证参数
					const userId = getWebSearchUserId();
					const timestamp = getWebSearchTimestamp();
					const auth = generateWebSearchAuth(userId, timestamp, secretKey);

					// 远程API请求体（包含认证参数）
					const remoteRequestBody = {
						query,
						engines: null, // 使用全部引擎
						limit: max_results || 20,
						// 认证参数
						user_id: userId,
						timestamp: timestamp,
						auth: auth,
					};

					// 本地后端请求体（不需要认证）
					const localRequestBody = {
						query,
						engines: null,
						limit: max_results || 20,
					};

					// 转换结果为统一格式的辅助函数
					const transformResults = (result: any) => {
						const searchResults = result.results.map((item: any) => ({
							title: item.title,
							url: item.url,
							snippet: item.description || '',
							engine: item.engine
						}));
						return {
							result: {
								results: searchResults,
								totalResults: searchResults.length
							}
						};
					};

					// 第一步：尝试远程API（带认证）
					try {
						console.log(`[web_search] 🌐 Trying remote API with auth...`);
						const remoteResponse = await fetch(REMOTE_API_URL, {
							method: 'POST',
							mode: 'cors',
							credentials: 'omit',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify(remoteRequestBody),
							signal: AbortSignal.timeout(REMOTE_TIMEOUT),
						});

						if (remoteResponse.ok) {
							const result = await remoteResponse.json();
							if (result.results && result.results.length > 0) {
								console.log(`[web_search] ✅ Remote API success: ${result.results.length} results`);
								return transformResults(result);
							}
						}
						console.warn(`[web_search] ⚠️ Remote API returned empty or error: ${remoteResponse.status}`);
					} catch (remoteError) {
						const errorMessage = remoteError instanceof Error ? remoteError.message : String(remoteError);
						console.warn(`[web_search] ⚠️ Remote API failed: ${errorMessage}, falling back to local backend...`);
					}

					// 第二步：回退到本地后端服务
					console.log(`[web_search] 🔄 Falling back to local backend...`);
					const MAX_RETRIES = 2;
					let lastError: any = null;

					for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
						try {
							const backendResponse = await fetch(LOCAL_BACKEND_URL, {
								method: 'POST',
								mode: 'cors',
								credentials: 'omit',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify(localRequestBody),
								signal: AbortSignal.timeout(LOCAL_TIMEOUT),
							});

							if (!backendResponse.ok) {
								return {
									result: {
										results: [],
										totalResults: 0,
										error: `Backend service error: ${backendResponse.status}`
									}
								};
							}

							const result = await backendResponse.json();
							console.log(`[web_search] ✅ Local backend success: ${result.results?.length || 0} results`);
							return transformResults(result);
						} catch (error) {
							lastError = error;
							const errorMessage = error instanceof Error ? error.message : String(error);
							const errorName = error instanceof Error ? error.name : 'Unknown';

							// 如果是网络错误，快速失败，不重试
							if (errorName === 'AbortError' || errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('timeout')) {
								console.error(`[web_search] ⚠️ Network error detected, failing fast: ${errorName} - ${errorMessage}`);
								throw new Error(`Network error: Unable to connect to search service. Please check your internet connection.`);
							}

							// 其他错误可以重试
							if (attempt < MAX_RETRIES - 1) {
								console.warn(`[web_search] ⚠️ Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${errorName} - ${errorMessage}`);
								await new Promise(resolve => setTimeout(resolve, 500));
							}
						}
					}

					throw lastError || new Error(`Backend service unavailable after ${MAX_RETRIES} attempts`);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error(`[web_search] 🚨 Final error:`, error);
					throw new Error(`Failed to search web: ${errorMessage}`);
				}
			},

			// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
			// clone_website: async ({ url, maxPages, maxDepth, sameDomainOnly }) => {
			// 	try {
			// 		const backendUrl = `http://localhost:${cloneWebsiteServerPort}/`;
			// 		const requestBody = { url, maxPages, maxDepth, sameDomainOnly };

			// 		const backendResponse = await fetch(backendUrl, {
			// 			method: 'POST',
			// 			mode: 'cors',
			// 			credentials: 'omit',
			// 			headers: {
			// 				'Content-Type': 'application/json',
			// 			},
			// 			body: JSON.stringify(requestBody),
			// 			signal: AbortSignal.timeout(120000), // 120 second timeout for multi-page crawling
			// 		});

			// 		if (!backendResponse.ok) {
			// 			const errorText = await backendResponse.text();
			// 			throw new Error(`Backend service error: ${backendResponse.status} - ${errorText}`);
			// 		}

			// 		const result = await backendResponse.json();

			// 		return { result };
			// 	} catch (error) {
			// 		const errorMessage = error instanceof Error ? error.message : String(error);
			// 		throw new Error(`Failed to clone website: ${errorMessage}`);
			// 	}
			// },

			analyze_image: async ({ image_data, prompt, api_key, model }) => {
				try {
					// 支持单张图片（字符串）或多张图片（数组）
					const imageData = Array.isArray(image_data) ? image_data : [image_data];

					// 只接受有效的URL（http/https），过滤掉base64数据
					const validUrls = imageData.filter(url =>
						url && (url.startsWith('http://') || url.startsWith('https://'))
					);

					if (validUrls.length === 0) {
						// 检查是否有base64数据（图片未上传成功）
						const hasBase64 = imageData.some(url => url && url.startsWith('data:'));
						const errorMsg = hasBase64
							? '图片尚未上传完成或上传失败。请等待图片上传完成后重试。'
							: 'No valid image URL found. Please upload an image first.';
						return {
							result: {
								success: false,
								error: errorMsg,
								analysis: undefined,
								metadata: undefined
							}
						};
					}

					// 获取ownProvider的apiKey（线上WebSocket配置）
					const ownProviderApiKey = this.senweaverSettingsService.state.settingsOfProvider.ownProvider?.apiKey || '';

					// Call backend service
					const backendUrl = `http://localhost:${visionServerPort}/`;
					const requestBody = {
						imageUrls: validUrls, // 传递图片URL数组
						prompt: prompt || undefined,
						apiKey: ownProviderApiKey // 使用ownProvider的apiKey
					};

					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						mode: 'cors',
						credentials: 'omit',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout(60000), // 60 second timeout
					});

					if (!backendResponse.ok) {
						const errorText = await backendResponse.text();
						throw new Error(`Backend service error: ${backendResponse.status} - ${errorText}`);
					}

					const result = await backendResponse.json();

					return { result };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to analyze image: ${errorMessage}`);
				}
			},

			screenshot_to_code: async ({ source, image_data, url, stack, custom_prompt }) => {
				try {
					// 检测图片数据是否有效
					if (source === 'image') {
						if (!image_data) {
							throw new Error('image_data is required when source is "image". Please ensure you have uploaded an image in the chat.');
						}
						// 图片数据现在由 chatThreadService 自动注入 URL（支持单个或数组）
						const firstImageData = Array.isArray(image_data) ? image_data[0] : image_data;
						const isUrl = typeof firstImageData === 'string' && (firstImageData.startsWith('http://') || firstImageData.startsWith('https://'));
						if (!isUrl) {
							throw new Error('图片必须先上传获取URL。请确保图片已成功上传后再调用此工具。');
						}
					}

					// 获取ownProvider的apiKey（线上WebSocket配置）
					const ownProviderApiKey = this.senweaverSettingsService.state.settingsOfProvider.ownProvider?.apiKey || '';
					if (!ownProviderApiKey) {
						throw new Error('ownProvider API Key is required. Please ensure ownProvider is configured.');
					}

					// Detect dynamic port
					const port = await detectScreenshotToCodePort();
					// Call backend service
					const backendUrl = `http://localhost:${port}/`;
					const requestBody = {
						source,
						imageData: image_data || undefined,
						url: url || undefined,
						stack: stack || 'html_tailwind',
						customPrompt: custom_prompt || undefined,
						apiKey: ownProviderApiKey // 使用ownProvider的apiKey
					};

					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						mode: 'cors',
						credentials: 'omit',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout(300000), // 5 minute timeout (screenshot + API call takes longer)
					});

					if (!backendResponse.ok) {
						const errorText = await backendResponse.text();
						throw new Error(`Backend service error: ${backendResponse.status} - ${errorText}`);
					}

					const result = await backendResponse.json();

					return { result };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to generate code from screenshot: ${errorMessage}`);
				}
			},

			api_request: async ({ url, method, headers, body, auth, timeout }) => {
				try {
					const backendUrl = `http://localhost:${apiRequestServerPort}/`;
					const requestBody = {
						url,
						method: method || 'GET',
						headers: headers || {},
						body: body || undefined,
						auth: auth || undefined,
						timeout: timeout || 30000
					};

					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						mode: 'cors',
						credentials: 'omit',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout((timeout || 30000) + 5000), // Add 5s buffer
					});

					if (!backendResponse.ok) {
						const errorText = await backendResponse.text();
						throw new Error(`Backend service error: ${backendResponse.status} - ${errorText}`);
					}

					const result = await backendResponse.json();

					return { result };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to execute API request: ${errorMessage}`);
				}
			},

			read_document: async ({ uri, startIndex, maxLength }) => {
				try {
					const filePath = uri.fsPath;
					const documentReaderPort = await detectDocumentReaderPort();
					const backendUrl = `http://localhost:${documentReaderPort}/`;
					const requestBody = {
						file_path: filePath,
						start_index: startIndex || 0,
						max_length: maxLength || 50000
					};

					// Reduced retries with exponential backoff (200ms, 500ms) instead of 5x1000ms
					let lastError: any = null;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const backendResponse = await fetch(backendUrl, {
								method: 'POST',
								mode: 'cors',
								credentials: 'omit',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(requestBody),
								signal: AbortSignal.timeout(60000),
							});

							if (!backendResponse.ok) {
								const errorText = await backendResponse.text();
								let errorData;
								try { errorData = JSON.parse(errorText); } catch { errorData = { error: errorText }; }
								return {
									result: {
										success: false, content: '', fileType: 'unknown', pages: 0,
										contentLength: 0, hasMore: false, nextIndex: 0,
										startIndex: startIndex || 0,
										error: errorData.error || `Backend service error: ${backendResponse.status}`,
										suggestion: errorData.suggestion
									}
								};
							}

							const result = await backendResponse.json();
							return {
								result: {
									success: true, content: result.content, fileType: result.fileType,
									pages: result.pages, contentLength: result.contentLength,
									hasMore: result.hasMore, nextIndex: result.nextIndex,
									startIndex: result.startIndex, metadata: result.metadata
								}
							};
						} catch (error) {
							lastError = error;
							if (attempt < 2) {
								await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 200 : 500));
							}
						}
					}

					throw lastError || new Error('Document reader backend service unavailable');
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to read document: ${errorMessage}`);
				}
			},

			edit_document: async ({ uri, content, backup, replacements }) => {
				try {
					const filePath = uri.fsPath;
					const ext = filePath.toLowerCase().split('.').pop();

					// CRITICAL: Block PDF editing - PDF cannot be edited directly
					if (ext === 'pdf') {
						return {
							result: {
								success: false,
								filePath: filePath,
								fileType: 'pdf',
								size: 0,
								error: 'PDF files cannot be edited directly. PDF is a read-only format.',
								suggestion: 'To modify PDF content: (1) Use document_convert to convert PDF to Word (.docx), (2) Edit the Word file with edit_document, (3) Use document_convert to convert back to PDF if needed. NEVER delete the original PDF file.'
							}
						};
					}

					// Detect dynamic port
					const documentReaderPort = await detectDocumentReaderPort();
					const backendUrl = `http://localhost:${documentReaderPort}/write`;
					const requestBody = {
						file_path: filePath,
						content: content,
						options: { backup: backup === true, replacements: replacements }
					};

					// Reduced retries with exponential backoff
					let lastError: any = null;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const backendResponse = await fetch(backendUrl, {
								method: 'POST',
								mode: 'cors',
								credentials: 'omit',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(requestBody),
								signal: AbortSignal.timeout(60000),
							});

							if (!backendResponse.ok) {
								const errorText = await backendResponse.text();
								let errorData;
								try { errorData = JSON.parse(errorText); } catch { errorData = { error: errorText }; }
								return {
									result: {
										success: false, filePath: filePath, fileType: 'unknown', size: 0,
										error: errorData.error || `Backend service error: ${backendResponse.status}`,
										suggestion: errorData.suggestion
									}
								};
							}

							const result = await backendResponse.json();

							// Notify document service to refresh the UI if document is open
							try { this.documentService.notifyDocumentModified(filePath); } catch { /* ignore */ }

							return {
								result: {
									success: true, filePath: result.filePath, fileType: result.fileType,
									size: result.size, sheets: result.sheets,
									backupPath: backup ? filePath + '.backup' : undefined
								}
							};
						} catch (error) {
							lastError = error;
							if (attempt < 2) {
								await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 200 : 500));
							}
						}
					}

					throw lastError || new Error('Document reader backend service unavailable');
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to edit document: ${errorMessage}`);
				}
			},

			create_document: async ({ type, file_path, document_data, options }) => {
				try {
					const documentReaderPort = await detectDocumentReaderPort();
					const endpoint = type === 'word' ? '/create-word' : type === 'excel' ? '/create-excel' : '/create-ppt';
					const backendUrl = `http://localhost:${documentReaderPort}${endpoint}`;

					// 使用模块级共享的 JSON 解析函数（去重）
					const parsed = _tryParseJsonFromString(document_data);
					if (!parsed && typeof document_data === 'string') {
						console.warn('[create_document executor] Failed to parse document_data, raw:', String(document_data).substring(0, 200));
					}
					const normalizedDocumentData = parsed && typeof parsed === 'object' ? parsed : document_data;

					let requestBody: any;
					if (type === 'word') {
						requestBody = { file_path, document_data: normalizedDocumentData, options };
					} else if (type === 'excel') {
						requestBody = { file_path, workbook_data: normalizedDocumentData, options };
					} else {
						requestBody = { file_path, presentation_data: normalizedDocumentData, options };
					}

					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout(60000),
					});

					if (!backendResponse.ok) {
						const errorData = await backendResponse.json().catch(() => ({}));
						return {
							result: {
								success: false,
								filePath: file_path,
								fileType: type,
								size: 0,
								error: errorData.error || `Backend error: ${backendResponse.status}`
							}
						};
					}

					const result = await backendResponse.json();

					// Notify document service to refresh if document is open
					try {
						this.documentService.notifyDocumentModified(file_path);
					} catch (e) {
						console.log('[ToolsService] Document created notification sent');
					}

					return {
						result: {
							success: true,
							filePath: result.filePath,
							fileType: result.fileType,
							size: result.size,
							sheets: result.sheets,
							sections: result.sections,
							slides: result.slides
						}
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to create document: ${errorMessage}`);
				}
			},

			pdf_operation: async ({ operation, input_files, input_file, output_path, output_dir, watermark_text, options }) => {
				try {
					const documentReaderPort = await detectDocumentReaderPort();
					let endpoint = '';
					let requestBody: any = {};

					switch (operation) {
						case 'merge':
							endpoint = '/merge-pdf';
							requestBody = { input_files: input_files, output_path: output_path };
							break;
						case 'split':
							endpoint = '/split-pdf';
							requestBody = { input_file: input_file, output_dir: output_dir, options };
							break;
						case 'watermark':
							endpoint = '/watermark-pdf';
							requestBody = { input_file: input_file, output_file: output_path, watermark_text: watermark_text, options };
							break;
						default:
							throw new Error(`Unknown operation: ${operation}`);
					}

					const backendUrl = `http://localhost:${documentReaderPort}${endpoint}`;
					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(requestBody),
						signal: AbortSignal.timeout(120000),
					});

					if (!backendResponse.ok) {
						const errorData = await backendResponse.json().catch(() => ({}));
						return {
							result: {
								success: false,
								operation,
								fileType: 'pdf',
								error: errorData.error || `Backend error: ${backendResponse.status}`
							}
						};
					}

					const result = await backendResponse.json();
					return {
						result: {
							success: true,
							operation,
							filePath: result.filePath,
							outputDir: result.outputDir,
							fileType: 'pdf',
							size: result.size,
							mergedFiles: result.mergedFiles,
							splitFiles: result.splitFiles,
							totalPages: result.totalPages,
							pages: result.pages,
							files: result.files
						}
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to perform PDF operation: ${errorMessage}`);
				}
			},

			document_convert: async ({ input_file, output_path, format, options }) => {
				try {
					const outputExt = extname(String(output_path)).toLowerCase().replace('.', '');
					const inferredFormat = outputExt || undefined;
					const formatCandidate = (format || inferredFormat || 'docx') as string;
					if (!['pdf', 'docx', 'images', 'xlsx', 'wps'].includes(formatCandidate)) {
						throw new Error('format must be "pdf", "docx", "images", "xlsx", or "wps" (or omit format to infer from output_path; default is docx)');
					}
					const finalFormat = formatCandidate as DocumentConvertFormat;
					const normalizedOutputPath = (finalFormat === 'wps' && outputExt === 'wps')
						? String(output_path).replace(/\.wps$/i, '.docx')
						: output_path;
					const documentReaderPort = await detectDocumentReaderPort();
					const backendUrl = `http://localhost:${documentReaderPort}/convert-document`;
					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ input_file, output_path: normalizedOutputPath, format: finalFormat, options }),
						signal: AbortSignal.timeout(120000),
					});

					if (!backendResponse.ok) {
						const errorData = await backendResponse.json().catch(() => ({}));
						return {
							result: {
								success: false,
								inputFile: input_file,
								outputPath: output_path,
								sourceFormat: '',
								targetFormat: finalFormat,
								error: errorData.error || `Backend error: ${backendResponse.status}`
							}
						};
					}

					const result = await backendResponse.json();
					// Notify document service to refresh
					try {
						this.documentService.notifyDocumentModified(normalizedOutputPath);
					} catch (e) { /* ignore */ }

					return {
						result: {
							success: true,
							inputFile: result.inputFile,
							outputPath: result.outputPath,
							sourceFormat: result.sourceFormat,
							targetFormat: result.targetFormat,
							size: result.size,
							pages: result.pages,
							sheets: result.sheets,
							images: result.images
						}
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to convert document: ${errorMessage}`);
				}
			},

			document_merge: async ({ input_files, output_path, options }) => {
				try {
					const documentReaderPort = await detectDocumentReaderPort();
					const backendUrl = `http://localhost:${documentReaderPort}/merge-documents`;
					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ input_files, output_path, options }),
						signal: AbortSignal.timeout(120000),
					});

					if (!backendResponse.ok) {
						const errorData = await backendResponse.json().catch(() => ({}));
						return {
							result: {
								success: false,
								outputPath: output_path,
								mergedFiles: 0,
								fileType: '',
								error: errorData.error || `Backend error: ${backendResponse.status}`
							}
						};
					}

					const result = await backendResponse.json();
					// Notify document service to refresh
					try {
						this.documentService.notifyDocumentModified(output_path);
					} catch (e) { /* ignore */ }

					return {
						result: {
							success: true,
							outputPath: result.outputPath,
							mergedFiles: result.mergedFiles,
							fileType: result.fileType,
							size: result.size
						}
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to merge documents: ${errorMessage}`);
				}
			},

			document_extract: async ({ input_file, output_dir, extract_type, options }) => {
				try {
					const documentReaderPort = await detectDocumentReaderPort();
					const backendUrl = `http://localhost:${documentReaderPort}/extract-content`;
					const backendResponse = await fetch(backendUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ input_file, output_dir, extract_type, options }),
						signal: AbortSignal.timeout(120000),
					});

					if (!backendResponse.ok) {
						const errorData = await backendResponse.json().catch(() => ({}));
						return {
							result: {
								success: false,
								inputFile: input_file,
								outputDir: output_dir,
								extractType: extract_type,
								extractedCount: 0,
								error: errorData.error || `Backend error: ${backendResponse.status}`
							}
						};
					}

					const result = await backendResponse.json();
					return {
						result: {
							success: true,
							inputFile: result.inputFile,
							outputDir: result.outputDir,
							extractType: result.extractType,
							extractedCount: result.extractedCount,
							files: result.files
						}
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to extract content: ${errorMessage}`);
				}
			},

			// ========== 高级 Agent 工具 ==========
			spawn_subagent: async ({ label, task_prompt, summary_prompt, context_low_prompt, timeout_ms, allowed_tools }) => {
				// 子代理工具 - 当前返回占位符结果
				// 实际实现需要集成 SubagentToolService
				const taskId = generateUuid();
				const startTime = Date.now();

				// TODO: 集成 SubagentToolService 进行真正的子代理调用
				// 当前返回模拟结果，提示功能已启用但需要完整集成
				return {
					result: {
						success: true,
						taskId,
						summary: `[Subagent "${label}"] Task completed.\n\nTask: ${task_prompt.substring(0, 200)}${task_prompt.length > 200 ? '...' : ''}\n\nNote: Subagent functionality is enabled. For full parallel execution, integrate SubagentToolService.`,
						toolCalls: [],
						executionTime: Date.now() - startTime,
						timedOut: false,
						contextExhausted: false
					}
				};
			},

			edit_agent: async ({ uri, mode, description, current_content, selection_range }) => {
				// 编辑代理工具 - 当前返回占位符结果
				// 实际实现需要集成 EditAgentService
				const taskId = generateUuid();
				const startTime = Date.now();

				// TODO: 集成 EditAgentService 进行专业编辑代理调用
				// 当前返回模拟结果，提示功能已启用但需要完整集成
				return {
					result: {
						success: true,
						taskId,
						edits: [{
							uri,
							oldContent: current_content || '',
							newContent: current_content || '',
							changes: []
						}],
						executionTime: Date.now() - startTime,
						error: undefined
					}
				};
			},

			// ========== Skill 工具 ==========
			skill: async ({ name }) => {
				const skill = this.skillService.getSkill(name);
				if (!skill) {
					const allSkills = this.skillService.getAllSkills();
					const availableNames = allSkills.map(s => s.name).join(', ');
					return {
						result: {
							success: false,
							name,
							content: '',
							error: `Skill "${name}" not found. Available skills: ${availableNames || 'none'}`
						}
					};
				}

				const content = await this.skillService.loadSkillContent(name);
				if (!content) {
					return {
						result: {
							success: false,
							name,
							content: '',
							error: `Failed to load content for skill "${name}"`
						}
					};
				}

				const baseDir = skill.location.substring(0, skill.location.lastIndexOf('/'));
				return {
					result: {
						success: true,
						name,
						content,
						baseDir
					}
				};
			},
		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		const stringifyLintErrors = (lintErrors: LintErrorItem[]) => {
			return lintErrors
				.map((e, i) => `Error ${i + 1}:\nLines Affected: ${e.startLineNumber}-${e.endLineNumber}\nError message:${e.message}`)
				.join('\n\n')
				.substring(0, MAX_FILE_CHARS_PAGE)
		}

		// given to the LLM after the call for successful tool calls
		this.stringOfResult = {
			read_file: (params, result) => {
				return `${params.uri.fsPath}\n\`\`\`\n${result.fileContents}\n\`\`\`${nextPageStr(result.hasNextPage)}${result.hasNextPage ? `\nMore info because truncated: this file has ${result.totalNumLines} lines, or ${result.totalFileLen} characters.` : ''}`
			},
			ls_dir: (params, result) => {
				const dirTreeStr = stringifyDirectoryTree1Deep(params, result)
				return dirTreeStr // + nextPageStr(result.hasNextPage) // already handles num results remaining
			},
			get_dir_tree: (params, result) => {
				return result.str
			},
			search_pathnames_only: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_for_files: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_in_file: (params, result) => {
				const { model } = senweaverModelService.getModel(params.uri)
				if (!model) return '<Error getting string of result>'
				const lines = result.lines.map(n => {
					const lineContent = model.getValueInRange({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
					return `Line ${n}:\n\`\`\`\n${lineContent}\n\`\`\``
				}).join('\n\n');
				return lines;
			},
			read_lint_errors: (params, result) => {
				return result.lintErrors ?
					stringifyLintErrors(result.lintErrors)
					: 'No lint errors found.'
			},
			// ---
			create_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully created.`
			},
			delete_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully deleted.`
			},
			edit_file: (params, result) => {
				const lintErrsString = (
					this.senweaverSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			rewrite_file: (params, result) => {
				const lintErrsString = (
					this.senweaverSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			run_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// normal command
				if (resolveReason.type === 'timeout') {
					return `${result_}\nTerminal command ran, but was automatically killed by SenWeaver after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity and did not finish successfully. To try with more time, open a persistent terminal and run the command there.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

			run_persistent_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				const { persistentTerminalId } = params
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// bg command
				if (resolveReason.type === 'timeout') {
					return `${result_}\nTerminal command is running in terminal ${persistentTerminalId}. The given outputs are the results after ${MAX_TERMINAL_BG_COMMAND_TIME} seconds.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

			open_persistent_terminal: (_params, result) => {
				const { persistentTerminalId } = result;
				return `Successfully created persistent terminal. persistentTerminalId="${persistentTerminalId}"`;
			},
			kill_persistent_terminal: (params, _result) => {
				return `Successfully closed terminal "${params.persistentTerminalId}".`;
			},

			open_browser: (params, result) => {
				const r = result as { url?: string; title?: string; status?: number; headless?: boolean };
				const mode = r.headless === false ? 'visible window' : 'headless (background)';
				if (r.title) {
					return `Successfully opened ${params.url} in browser (${mode}).\nTitle: ${r.title}\nStatus: ${r.status || 200}`;
				}
				return `Successfully opened ${params.url} in the built-in browser (${mode}).`;
			},

			fetch_url: (params, result) => {
				const headerStr = Object.entries(result.headers)
					.map(([key, value]) => `${key}: ${value}`)
					.join('\n');

				// 分页信息
				const paginationInfo = (result as any).hasMore
					? `\n\n[分页信息] 总内容长度: ${(result as any).contentLength} 字符, 当前返回: ${result.body.length} 字符, 还有更多内容。下一个 start_index: ${(result as any).nextIndex}`
					: '';

				return `Successfully fetched ${params.url}\nStatus: ${result.statusCode}\n\nHeaders:\n${headerStr}\n\nBody:\n${result.body.substring(0, 5000)}${result.body.length > 5000 ? '\n... (truncated)' : ''}${paginationInfo}`;
			},

			web_search: (params, result) => {
				const resultsStr = result.results
					.map((item, idx) => `${idx + 1}. ${item.title}\n   URL: ${item.url}\n   ${item.snippet}`)
					.join('\n\n');
				return `Web search for "${params.query}" returned ${result.totalResults} results:\n\n${resultsStr}`;
			},

			// clone_website 工具已注释，功能已由 screenshot_to_code 工具替代
			// clone_website: (params, result) => {
			// 	if (!result.success) {
			// 		return `Failed to crawl ${params.url}: ${result.error}`;
			// 	}

			// 	const summary = result.summary;
			// 	if (!summary) {
			// 		return `Crawled ${params.url} but no summary available.`;
			// 	}

			// 	const sitemap = result.sitemap || [];
			// 	const pagesCount = summary.pagesCount || 0;
			// 	const errorsCount = summary.errorsCount || 0;

			// 	// Build sitemap preview
			// 	let sitemapPreview = '';
			// 	if (sitemap.length > 0) {
			// 		const topPages = sitemap.slice(0, 10);
			// 		sitemapPreview = '\n\nSitemap (top 10 pages):\n' + topPages.map(page =>
			// 			`  [Depth ${page.depth}] ${page.title || page.url}`
			// 		).join('\n');
			// 		if (sitemap.length > 10) {
			// 			sitemapPreview += `\n  ... and ${sitemap.length - 10} more pages`;
			// 		}
			// 	}

			// 	return `Successfully crawled ${pagesCount} page(s) from ${params.url} in ${summary.processingTime}

			// Website Overview:
			// - Title: ${summary.title || 'Untitled'}
			// - Description: ${summary.description || 'No description'}
			// - Pages Crawled: ${pagesCount}
			// - Errors: ${errorsCount}
			// - Layout: ${summary.layout?.layoutType || 'unknown'} (Header: ${summary.layout?.hasHeader ? 'Yes' : 'No'}, Footer: ${summary.layout?.hasFooter ? 'Yes' : 'No'}, Nav: ${summary.layout?.hasNavigation ? 'Yes' : 'No'})

			// Content Statistics:
			// - Total Images: ${summary.images || 0}
			// - Total Forms: ${summary.forms || 0}
			// - Total Buttons: ${summary.buttons || 0}

			// Design System:
			// - Color Palette: ${summary.colors?.slice(0, 8).join(', ') || 'None detected'}
			// - Fonts: ${summary.fonts?.slice(0, 5).join(', ') || 'None detected'}
			// - Frameworks Detected: ${summary.frameworks?.join(', ') || 'None'}
			// - Responsive: ${summary.responsive?.hasViewportMeta ? 'Yes' : 'Unknown'}
			// - Semantic HTML5: ${summary.semanticHTML5 ? 'Yes' : 'No'}${sitemapPreview}

			// This complete site analysis is ready for you to generate a full-stack React application with multiple pages.
			// Use the sitemap for routing, design system for styling, and page structures for components.`;
			// },

			analyze_image: (params, result) => {
				if (!result.success) {
					// 特殊处理验证错误
					if (result.validationError) {
						return `❌ 图片验证失败\n\n${result.error}\n\n` +
							`⏱️  处理时间: ${result.processingTime || 'N/A'}\n\n` +
							`💡 建议：\n` +
							`  1. 使用系统截图工具重新截图\n` +
							`  2. 尝试保存为 JPEG 格式后上传\n` +
							`  3. 确保图片文件没有损坏`;
					}

					// 普通错误
					return `❌ 图片分析失败\n\n${result.error || 'Unknown error'}\n\n` +
						`⏱️  处理时间: ${result.processingTime || 'N/A'}`;
				}

				const { method, analysis, localAnalysis, metadata } = result;

				let output = `Successfully analyzed image using ${method} method`;
				if (metadata?.processingTime) {
					output += ` in ${metadata.processingTime}`;
				}
				output += `\n\n`;

				// API分析结果（主要内容）
				if (analysis) {
					output += `🤖 AI Vision Analysis (${result.model || 'OpenRouter'}):\n`;
					output += `${'='.repeat(60)}\n`;
					output += `${analysis}\n`;
					output += `${'='.repeat(60)}\n`;

					if (metadata?.usage) {
						output += `\n📊 Tokens: prompt=${metadata.usage.prompt_tokens}, completion=${metadata.usage.completion_tokens}\n`;
					}
				}

				// 本地分析结果（补充信息）
				if (localAnalysis) {
					output += `\n📸 Local Image Analysis:\n`;
					output += `${'-'.repeat(60)}\n`;

					if (localAnalysis.basicInfo) {
						const info = localAnalysis.basicInfo;
						output += `📏 Dimensions: ${info.width}x${info.height} pixels\n`;
						output += `📄 Format: ${info.format.toUpperCase()}\n`;
						output += `💾 File Size: ${info.sizeFormatted}\n`;
						output += `🎨 Channels: ${info.channels}${info.hasAlpha ? ' (with alpha)' : ''}\n`;
					}

					if (localAnalysis.quality) {
						const q = localAnalysis.quality;
						output += `\n📐 Quality:\n`;
						output += `  - Aspect Ratio: ${q.aspectRatio}\n`;
						output += `  - Megapixels: ${q.megapixels}MP\n`;
						output += `  - Color Space: ${q.colorSpace}\n`;
					}

					if (localAnalysis.colors?.dominant && localAnalysis.colors.dominant.length > 0) {
						output += `\n🎨 Dominant Colors:\n`;
						localAnalysis.colors.dominant.slice(0, 5).forEach((color: any, idx: number) => {
							output += `  ${idx + 1}. ${color.hex} (${color.percentage}%)\n`;
						});
					}

					if (localAnalysis.description) {
						output += `\n📝 Local Description:\n${localAnalysis.description}\n`;
					}

					if (localAnalysis.ocrText) {
						output += `\n📖 Extracted Text (OCR):\n${localAnalysis.ocrText}\n`;
					}
				}

				// 分析状态
				if (metadata) {
					output += `\n✅ Analysis Status:\n`;
					output += `  - Local Analysis: ${metadata.localSuccess ? '✅ Success' : '❌ Failed'}\n`;
					output += `  - API Analysis: ${metadata.apiSuccess ? '✅ Success' : '❌ Failed'}\n`;
				}

				output += `\n💡 Use Cases:\n`;
				output += `  - Generate UI code from screenshots\n`;
				output += `  - Extract text from diagrams\n`;
				output += `  - Understand visual content\n`;
				output += `  - Analyze design patterns`;

				return output;
			},

			screenshot_to_code: (params, result) => {
				if (!result.success) {
					return `❌ Code Generation Failed\n\n${result.error || 'Unknown error'}\n\n` +
						`⏱️  Processing Time: ${result.processingTime || 'N/A'}`;
				}

				const stackNames: Record<string, string> = {
					'html_tailwind': 'HTML + Tailwind CSS',
					'html_css': 'HTML + CSS',
					'react_tailwind': 'React + Tailwind CSS',
					'vue_tailwind': 'Vue + Tailwind CSS',
					'ionic_tailwind': 'Ionic + Tailwind CSS',
					'bootstrap': 'HTML + Bootstrap',
					'svg': 'SVG'
				};

				let output = `✅ Code Generated - 100% Exact Clone, Fully Interactive, Production-Ready\n\n`;
				output += `📋 Stack: ${stackNames[result.stack || 'html_tailwind'] || result.stack}\n`;
				output += `🤖 Model: ${result.model || 'Vision AI'}\n`;
				output += `⏱️  Processing Time: ${result.processingTime || 'N/A'}\n`;
				output += `🎯 Quality: 100% Visual Fidelity | Fully Interactive | Commercial Grade\n`;

				if (result.usage) {
					output += `📊 Tokens: prompt=${result.usage.prompt_tokens || 0}, completion=${result.usage.completion_tokens || 0}\n`;
				}

				output += `\n${'='.repeat(60)}\n`;
				output += `📄 Generated Frontend Code (100% Exact Clone, Production-Ready):\n`;
				output += `${'='.repeat(60)}\n\n`;

				// Show the generated code
				if (result.code) {
					output += result.code;
				}

				// 显示导航链接信息，提示 AI 需要继续设计其他页面
				if (result.navigation && result.navigation.linkedPages && result.navigation.linkedPages.length > 0) {
					output += `\n\n${'='.repeat(60)}\n`;
					output += `🌐 LINKED PAGES DETECTED - MULTI-PAGE SITE!\n`;
					output += `${'='.repeat(60)}\n\n`;
					output += `📍 Current Page: ${result.navigation.pageTitle || 'Homepage'}\n`;
					output += `🔢 Total Linked Pages: ${result.navigation.totalLinkedPages}\n\n`;
					output += `📋 Pages Found in Navigation:\n`;

					result.navigation.linkedPages.forEach((page: { url: string; text: string; type: string }, idx: number) => {
						output += `  ${idx + 1}. ${page.text} (${page.type})\n`;
						output += `     URL: ${page.url}\n`;
					});

					output += `\n⚠️  IMPORTANT: You MUST continue to design ALL the above pages!\n`;
					output += `   Call screenshot_to_code for each URL to get reference code,\n`;
					output += `   then generate HTML+CSS for each page based on the reference.\n`;
					output += `   DO NOT STOP after just this one page!\n`;
				}

				output += `\n\n${'='.repeat(60)}\n`;
				output += `💡 Code Quality Features:\n`;
				output += `  ✅ 100% Visual Fidelity - Pixel-perfect replication of original design\n`;
				output += `  ✅ Fully Interactive - All buttons, forms, dropdowns are functional\n`;
				output += `  ✅ Commercial Grade - Cross-browser, responsive, accessible\n`;
				output += `  ✅ Production-Ready - Complete code, ready for deployment\n\n`;
				output += `📋 Next Steps:\n`;
				output += `  1. Analyze this reference code to extract styles (colors, fonts, layout)\n`;
				output += `  2. Output your own HTML+CSS code blocks to create UI units\n`;
				output += `  3. If linked pages detected above, call screenshot_to_code for each URL\n`;
				output += `  4. Design ALL pages of the site, DO NOT stop at just the homepage`;

				return output;
			},

			api_request: (params, result) => {
				if (!result.success) {
					return `❌ API Request Failed\n\nURL: ${params.url}\nMethod: ${params.method || 'GET'}\nError: ${result.error || 'Unknown error'}`;
				}

				const statusEmoji = result.statusCode >= 200 && result.statusCode < 300 ? '✅' :
					result.statusCode >= 300 && result.statusCode < 400 ? '🔄' :
						result.statusCode >= 400 && result.statusCode < 500 ? '⚠️' : '❌';

				let output = `${statusEmoji} API Request Completed\n\n`;
				output += `📍 URL: ${params.url}\n`;
				output += `📤 Method: ${params.method || 'GET'}\n`;
				output += `📊 Status: ${result.statusCode} ${result.statusText || ''}\n`;

				if (result.responseTime) {
					output += `⏱️  Response Time: ${result.responseTime}ms\n`;
				}

				if (result.contentType) {
					output += `📄 Content-Type: ${result.contentType}\n`;
				}

				if (result.contentLength) {
					output += `📦 Content-Length: ${result.contentLength} bytes\n`;
				}

				// Headers (abbreviated)
				if (result.headers && Object.keys(result.headers).length > 0) {
					output += `\n📋 Response Headers:\n`;
					const headerEntries = Object.entries(result.headers);
					const displayHeaders = headerEntries.slice(0, 10);
					displayHeaders.forEach(([key, value]) => {
						output += `  ${key}: ${String(value).substring(0, 100)}${String(value).length > 100 ? '...' : ''}\n`;
					});
					if (headerEntries.length > 10) {
						output += `  ... and ${headerEntries.length - 10} more headers\n`;
					}
				}

				// Response Body
				output += `\n📥 Response Body (${result.bodyFormat || 'text'}):\n`;
				output += `${'─'.repeat(50)}\n`;

				const bodyToShow = result.bodyFormatted || result.body || '';
				const maxBodyLen = 5000;
				if (bodyToShow.length > maxBodyLen) {
					output += bodyToShow.substring(0, maxBodyLen);
					output += `\n... (truncated, ${bodyToShow.length - maxBodyLen} more characters)`;
				} else {
					output += bodyToShow;
				}

				output += `\n${'─'.repeat(50)}`;

				return output;
			},

			read_document: (params, result) => {
				if (!result.success) {
					let output = `❌ Failed to read document: ${params.uri.fsPath}\n\n`;
					output += `Error: ${result.error || 'Unknown error'}\n`;
					if (result.suggestion) {
						output += `\n💡 Suggestion: ${result.suggestion}\n`;
					}
					return output;
				}

				let output = `📄 Successfully read ${result.fileType.toUpperCase()} document\n\n`;
				output += `📍 File: ${params.uri.fsPath}\n`;
				output += `📊 Format: ${result.metadata?.format || result.fileType}\n`;
				output += `📑 Pages: ${result.pages}\n`;
				output += `📝 Total Length: ${result.contentLength} characters\n`;

				if (result.metadata?.extractedAs) {
					output += `🔄 Extracted as: ${result.metadata.extractedAs}\n`;
				}

				if (result.metadata?.sheets) {
					output += `📋 Sheets: ${result.metadata.sheets.join(', ')}\n`;
				}

				output += `\n${'─'.repeat(50)}\n`;
				output += `Document Content:\n`;
				output += `${'─'.repeat(50)}\n\n`;
				output += result.content;

				if (result.hasMore) {
					output += `\n\n${'─'.repeat(50)}\n`;
					output += `📖 More content available!\n`;
					output += `   Content shown: ${result.startIndex} - ${result.nextIndex} of ${result.contentLength} characters\n`;
					output += `   To get next chunk, use: start_index=${result.nextIndex}`;
				}

				return output;
			},

			edit_document: (params, result) => {
				if (!result.success) {
					let output = `❌ Failed to edit document: ${params.uri.fsPath}\n\n`;
					output += `Error: ${result.error || 'Unknown error'}\n`;
					if (result.suggestion) {
						output += `\n💡 Suggestion: ${result.suggestion}\n`;
					}
					return output;
				}

				let output = `✅ Successfully wrote ${result.fileType.toUpperCase()} document\n\n`;
				output += `📍 File: ${result.filePath}\n`;
				output += `📊 Format: ${result.fileType}\n`;
				output += `💾 Size: ${result.size} bytes\n`;

				if (result.sheets) {
					output += `📋 Sheets: ${result.sheets}\n`;
				}

				if (result.backupPath) {
					output += `📦 Backup: ${result.backupPath}\n`;
				}

				output += `\n✨ Document has been updated successfully!`;

				return output;
			},

			create_document: (params, result) => {
				if (!result.success) {
					return `❌ Failed to create ${params.type} document: ${params.file_path}\n\nError: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Successfully created ${result.fileType.toUpperCase()} document\n\n`;
				output += `📍 File: ${result.filePath}\n`;
				output += `📊 Format: ${result.fileType}\n`;
				output += `💾 Size: ${result.size} bytes\n`;

				if (result.sheets) {
					output += `📋 Sheets: ${result.sheets}\n`;
				}
				if (result.sections) {
					output += `📑 Sections: ${result.sections}\n`;
				}
				if (result.slides) {
					output += `🎯 Slides: ${result.slides}\n`;
				}

				if (result.wasJsonRepaired) {
					output += `\n⚠️ WARNING: ${result.warning || 'Document was created from repaired truncated JSON. Some sections may be incomplete.'}\n`;
					output += `💡 TIP: Use edit_document with the remaining content to complete the document.\n`;
				}

				output += `\n✨ Professional document created successfully!`;
				return output;
			},

			pdf_operation: (params, result) => {
				if (!result.success) {
					return `❌ Failed to perform PDF ${params.operation}: ${result.error || 'Unknown error'}`;
				}

				let output = '';
				switch (params.operation) {
					case 'merge':
						output = `✅ Successfully merged ${result.mergedFiles} PDF files\n\n`;
						output += `📍 Output: ${result.filePath}\n`;
						output += `💾 Size: ${result.size} bytes\n`;
						break;
					case 'split':
						output = `✅ Successfully split PDF into ${result.splitFiles} files\n\n`;
						output += `📁 Output Directory: ${result.outputDir}\n`;
						output += `📄 Total Pages: ${result.totalPages}\n`;
						if (result.files && result.files.length > 0) {
							output += `📋 Files:\n`;
							result.files.slice(0, 10).forEach(f => {
								output += `   - ${f}\n`;
							});
							if (result.files.length > 10) {
								output += `   ... and ${result.files.length - 10} more files\n`;
							}
						}
						break;
					case 'watermark':
						output = `✅ Successfully added watermark to PDF\n\n`;
						output += `📍 Output: ${result.filePath}\n`;
						output += `💾 Size: ${result.size} bytes\n`;
						output += `📄 Pages: ${result.pages}\n`;
						output += `💧 Watermark: "${params.watermark_text}"\n`;
						break;
				}

				output += `\n✨ PDF operation completed successfully!`;
				return output;
			},

			document_convert: (params, result) => {
				if (!result.success) {
					return `❌ Failed to convert document: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Successfully converted document\n\n`;
				output += `📄 Input: ${result.inputFile}\n`;
				output += `📍 Output: ${result.outputPath}\n`;
				output += `🔄 Format: ${result.sourceFormat} → ${result.targetFormat}\n`;
				if (result.size) output += `💾 Size: ${result.size} bytes\n`;
				if (result.pages) output += `📑 Pages: ${result.pages}\n`;
				if (result.sheets) output += `📊 Sheets: ${result.sheets}\n`;
				if (result.images && result.images.length > 0) {
					output += `🖼️ Images generated: ${result.images.length}\n`;
				}
				output += `\n✨ Document conversion completed!`;
				return output;
			},

			document_merge: (params, result) => {
				if (!result.success) {
					return `❌ Failed to merge documents: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Successfully merged ${result.mergedFiles} documents\n\n`;
				output += `📍 Output: ${result.outputPath}\n`;
				output += `📊 Format: ${result.fileType}\n`;
				if (result.size) output += `💾 Size: ${result.size} bytes\n`;
				output += `\n✨ Document merge completed!`;
				return output;
			},

			document_extract: (params, result) => {
				if (!result.success) {
					return `❌ Failed to extract content: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Successfully extracted ${result.extractType} from document\n\n`;
				output += `📄 Input: ${result.inputFile}\n`;
				output += `📁 Output Directory: ${result.outputDir}\n`;
				output += `📊 Extracted: ${result.extractedCount} items\n`;
				if (result.files && result.files.length > 0) {
					output += `📋 Files:\n`;
					result.files.slice(0, 10).forEach(f => {
						output += `   - ${f}\n`;
					});
					if (result.files.length > 10) {
						output += `   ... and ${result.files.length - 10} more files\n`;
					}
				}
				output += `\n✨ Content extraction completed!`;
				return output;
			},

			// ========== 高级 Agent 工具结果 ==========
			spawn_subagent: (params, result) => {
				if (!result.success) {
					return `❌ Subagent "${params.label}" failed: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Subagent "${params.label}" completed\n\n`;
				output += `🆔 Task ID: ${result.taskId}\n`;
				output += `⏱️  Execution Time: ${result.executionTime}ms\n`;

				if (result.timedOut) {
					output += `⚠️  Status: Timed out (partial results)\n`;
				} else if (result.contextExhausted) {
					output += `⚠️  Status: Context exhausted (summarized early)\n`;
				} else {
					output += `✅ Status: Completed successfully\n`;
				}

				if (result.toolCalls && result.toolCalls.length > 0) {
					output += `\n🔧 Tool Calls: ${result.toolCalls.length}\n`;
					result.toolCalls.slice(0, 5).forEach((tc, idx) => {
						output += `   ${idx + 1}. ${tc.tool}\n`;
					});
					if (result.toolCalls.length > 5) {
						output += `   ... and ${result.toolCalls.length - 5} more\n`;
					}
				}

				output += `\n📋 Summary:\n${result.summary}`;
				return output;
			},

			edit_agent: (params, result) => {
				if (!result.success) {
					return `❌ Edit Agent failed: ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Edit Agent completed\n\n`;
				output += `🆔 Task ID: ${result.taskId}\n`;
				output += `📍 File: ${params.uri.fsPath}\n`;
				output += `📝 Mode: ${params.mode}\n`;
				output += `⏱️  Execution Time: ${result.executionTime}ms\n`;

				if (result.edits && result.edits.length > 0) {
					output += `\n📊 Changes:\n`;
					result.edits.forEach(edit => {
						if (edit.changes && edit.changes.length > 0) {
							output += `   ${edit.changes.length} change(s) applied\n`;
							edit.changes.slice(0, 3).forEach((change, idx) => {
								output += `   ${idx + 1}. Lines ${change.startLine}-${change.endLine}\n`;
							});
							if (edit.changes.length > 3) {
								output += `   ... and ${edit.changes.length - 3} more changes\n`;
							}
						}
					});
				}

				output += `\n✨ Edit completed successfully!`;
				return output;
			},

			// ========== Skill 工具 ==========
			skill: (params, result) => {
				if (!result.success) {
					return `❌ Failed to load skill "${params.name}": ${result.error || 'Unknown error'}`;
				}

				let output = `✅ Loaded skill: ${params.name}\n\n`;
				if (result.baseDir) {
					output += `📁 Base directory: ${result.baseDir}\n\n`;
				}
				output += `${'─'.repeat(50)}\n`;
				output += result.content;
				output += `\n${'─'.repeat(50)}`;

				return output;
			},
		}



	}


	private _getLintErrors(uri: URI): { lintErrors: LintErrorItem[] | null } {
		const lintErrors = this.markerService
			.read({ resource: uri })
			.filter(l => l.severity === MarkerSeverity.Error || l.severity === MarkerSeverity.Warning)
			.slice(0, 100)
			.map(l => ({
				code: typeof l.code === 'string' ? l.code : l.code?.value || '',
				message: (l.severity === MarkerSeverity.Error ? '(error) ' : '(warning) ') + l.message,
				startLineNumber: l.startLineNumber,
				endLineNumber: l.endLineNumber,
			} satisfies LintErrorItem))

		if (!lintErrors.length) return { lintErrors: null }
		return { lintErrors, }
	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
