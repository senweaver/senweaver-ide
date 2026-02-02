/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX, useMemo, useState, useRef, useCallback } from 'react'
import { marked, MarkedToken, Token } from 'marked'
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'

import { convertToVscodeLang, detectLanguage } from '../../../../common/helpers/languageHelpers.js'
import { BlockCodeApplyWrapper } from './ApplyBlockHoverButtons.js'
import { useAccessor } from '../util/services.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { isAbsolute } from '../../../../../../../base/common/path.js'
import { separateOutFirstLine } from '../../../../common/helpers/util.js'
import { BlockCode } from '../util/inputs.js'
import { CodespanLocationLink } from '../../../../common/chatThreadServiceTypes.js'
import { getBasename, getRelative, senweaverOpenFileFn } from '../sidebar-tsx/SidebarChat.js'

// LRU Cache for markdown parsing results to avoid repeated parsing
const MARKDOWN_CACHE_SIZE = 100
const markdownCache = new Map<string, Token[]>()
const markdownCacheOrder: string[] = []

function getCachedTokens(content: string): Token[] {
	const cached = markdownCache.get(content)
	if (cached) {
		// Move to end (most recently used)
		const idx = markdownCacheOrder.indexOf(content)
		if (idx > -1) {
			markdownCacheOrder.splice(idx, 1)
			markdownCacheOrder.push(content)
		}
		return cached
	}

	// Parse and cache
	const tokens = marked.lexer(content)

	// Evict oldest if cache is full
	if (markdownCacheOrder.length >= MARKDOWN_CACHE_SIZE) {
		const oldest = markdownCacheOrder.shift()
		if (oldest) markdownCache.delete(oldest)
	}

	markdownCache.set(content, tokens)
	markdownCacheOrder.push(content)
	return tokens
}


export type ChatMessageLocation = {
	threadId: string;
	messageIdx: number;
}

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string }

export const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${tokenIdx}`
}

function isValidUri(s: string): boolean {
	return s.length > 5 && isAbsolute(s) && !s.includes('//') && !s.includes('/*') // common case that is a false positive is comments like //
}

// renders contiguous string of latex eg $e^{i\pi}$
const LatexRender = ({ latex }: { latex: string }) => {
	return <span className="katex-error text-red-500">{latex}</span>
	// try {
	// 	let formula = latex;
	// 	let displayMode = false;

	// 	// Extract the formula from delimiters
	// 	if (latex.startsWith('$') && latex.endsWith('$')) {
	// 		// Check if it's display math $$...$$
	// 		if (latex.startsWith('$$') && latex.endsWith('$$')) {
	// 			formula = latex.slice(2, -2);
	// 			displayMode = true;
	// 		} else {
	// 			formula = latex.slice(1, -1);
	// 		}
	// 	} else if (latex.startsWith('\\(') && latex.endsWith('\\)')) {
	// 		formula = latex.slice(2, -2);
	// 	} else if (latex.startsWith('\\[') && latex.endsWith('\\]')) {
	// 		formula = latex.slice(2, -2);
	// 		displayMode = true;
	// 	}

	// 	// Render LaTeX
	// 	const html = katex.renderToString(formula, {
	// 		displayMode: displayMode,
	// 		throwOnError: false,
	// 		output: 'html'
	// 	});

	// 	// Sanitize the HTML output with DOMPurify
	// 	const sanitizedHtml = dompurify.sanitize(html, {
	// 		RETURN_TRUSTED_TYPE: true,
	// 		USE_PROFILES: { html: true, svg: true, mathMl: true }
	// 	});

	// 	// Add proper styling based on mode
	// 	const className = displayMode
	// 		? 'katex-block my-2 text-center'
	// 		: 'katex-inline';

	// 	// Use the ref approach to avoid dangerouslySetInnerHTML
	// 	const mathRef = React.useRef<HTMLSpanElement>(null);

	// 	React.useEffect(() => {
	// 		if (mathRef.current) {
	// 			mathRef.current.innerHTML = sanitizedHtml as unknown as string;
	// 		}
	// 	}, [sanitizedHtml]);

	// 	return <span ref={mathRef} className={className}></span>;
	// } catch (error) {
	// 	console.error('KaTeX rendering error:', error);
	// 	return <span className="katex-error text-red-500">{latex}</span>;
	// }
}

const Codespan = ({ text, className, onClick, tooltip }: { text: string, className?: string, onClick?: () => void, tooltip?: string }) => {

	// TODO compute this once for efficiency. we should use `labels.ts/shorten` to display duplicates properly

	return <code
		className={`font-mono font-medium rounded-sm bg-senweaver-bg-1 px-1 ${className}`}
		onClick={onClick}
		{...tooltip ? {
			'data-tooltip-id': 'senweaver-tooltip',
			'data-tooltip-content': tooltip,
			'data-tooltip-place': 'top',
		} : {}}
	>
		{text}
	</code>

}

// Collapsible code block wrapper - all code blocks are collapsible by default
const CollapsibleCodeBlock = ({
	language,
	children
}: {
	language: string,
	children: React.ReactNode
}) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	// Get display label for different code types
	const getLabel = () => {
		if (language === 'plaintext') {
			return '导航配置';
		}
		// Map common language names to display labels
		const languageLabels: Record<string, string> = {
			'html': 'HTML',
			'css': 'CSS',
			'typescript': 'TypeScript',
			'javascript': 'JavaScript',
			'tsx': 'TypeScript React',
			'jsx': 'JavaScript React',
			'python': 'Python',
			'java': 'Java',
			'csharp': 'C#',
			'cpp': 'C++',
			'c': 'C',
			'go': 'Go',
			'rust': 'Rust',
			'php': 'PHP',
			'ruby': 'Ruby',
			'swift': 'Swift',
			'kotlin': 'Kotlin',
			'json': 'JSON',
			'xml': 'XML',
			'yaml': 'YAML',
			'yml': 'YAML',
			'sql': 'SQL',
			'shell': 'Shell',
			'bash': 'Bash',
			'powershell': 'PowerShell',
			'markdown': 'Markdown',
			'md': 'Markdown',
			'vue': 'Vue',
			'svelte': 'Svelte',
			'scss': 'SCSS',
			'sass': 'Sass',
			'less': 'Less'
		};

		const label = languageLabels[language.toLowerCase()] || language.toUpperCase();
		return `${label} 代码`;
	};

	return (
		<div className="relative">
			<button
				onClick={() => setIsCollapsed(!isCollapsed)}
				className="flex items-center gap-1 px-2 py-1 mb-1 text-xs rounded hover:bg-senweaver-bg-1 transition-colors"
				style={{ color: 'var(--vscode-foreground)' }}
			>
				{isCollapsed ? (
					<>
						<ChevronDown size={14} />
						<span>展开 {getLabel()}</span>
					</>
				) : (
					<>
						<ChevronUp size={14} />
						<span>收起 {getLabel()}</span>
					</>
				)}
			</button>
			{!isCollapsed && (
				<div className="transition-all duration-200">
					{children}
				</div>
			)}
		</div>
	);
}

const CodespanWithLink = ({ text, rawText, chatMessageLocation }: { text: string, rawText: string, chatMessageLocation: ChatMessageLocation }) => {

	const accessor = useAccessor()

	const chatThreadService = accessor.get('IChatThreadService')
	const commandService = accessor.get('ICommandService')
	const editorService = accessor.get('ICodeEditorService')

	const { messageIdx, threadId } = chatMessageLocation

	const [didComputeCodespanLink, setDidComputeCodespanLink] = useState<boolean>(false)

	let link: CodespanLocationLink | undefined = undefined
	let tooltip: string | undefined = undefined
	let displayText = text


	if (rawText.endsWith('`')) {
		// get link from cache
		link = chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId })

		if (link === undefined) {
			// if no link, generate link and add to cache
			chatThreadService.generateCodespanLink({ codespanStr: text, threadId })
				.then(link => {
					chatThreadService.addCodespanLink({ newLinkText: text, newLinkLocation: link, messageIdx, threadId })
					setDidComputeCodespanLink(true) // rerender
				})
		}

		if (link?.displayText) {
			displayText = link.displayText
		}

		if (isValidUri(displayText)) {
			tooltip = getRelative(URI.file(displayText), accessor)  // Full path as tooltip
			displayText = getBasename(displayText)
		}
	}


	const onClick = () => {
		if (!link) return;
		// Use the updated SenweaverOpenFileFn to open the file and handle selection
		if (link.selection)
			senweaverOpenFileFn(link.uri, accessor, [link.selection.startLineNumber, link.selection.endLineNumber]);
		else
			senweaverOpenFileFn(link.uri, accessor);
	}

	return <Codespan
		text={displayText}
		onClick={onClick}
		className={link ? 'underline hover:brightness-90 transition-all duration-200 cursor-pointer' : ''}
		tooltip={tooltip || undefined}
	/>
}


const paragraphToLatexSegments = (paragraphText: string) => {

	const segments: React.ReactNode[] = [];

	if (paragraphText
		&& !(paragraphText.includes('#') || paragraphText.includes('`')) // don't process latex if a codespan or header tag
		&& !/^[\w\s.()[\]{}]+$/.test(paragraphText) // don't process latex if string only contains alphanumeric chars, whitespace, periods, and brackets
	) {
		const rawText = paragraphText;
		// Regular expressions to match LaTeX delimiters
		const displayMathRegex = /\$\$(.*?)\$\$/g;  // Display math: $$...$$
		const inlineMathRegex = /\$((?!\$).*?)\$/g; // Inline math: $...$ (but not $$)

		// Check if the paragraph contains any LaTeX expressions
		if (displayMathRegex.test(rawText) || inlineMathRegex.test(rawText)) {
			// Reset the regex state (since we used .test earlier)
			displayMathRegex.lastIndex = 0;
			inlineMathRegex.lastIndex = 0;

			// Parse the text into segments of regular text and LaTeX
			let lastIndex = 0;
			let segmentId = 0;

			// First replace display math ($$...$$)
			let match;
			while ((match = displayMathRegex.exec(rawText)) !== null) {
				const [fullMatch, formula] = match;
				const matchIndex = match.index;

				// Add text before the LaTeX expression
				if (matchIndex > lastIndex) {
					const textBefore = rawText.substring(lastIndex, matchIndex);
					segments.push(
						<span key={`text-${segmentId++}`}>
							{textBefore}
						</span>
					);
				}

				// Add the LaTeX expression
				segments.push(
					<LatexRender key={`latex-${segmentId++}`} latex={fullMatch} />
				);

				lastIndex = matchIndex + fullMatch.length;
			}

			// Add any remaining text (which might contain inline math)
			if (lastIndex < rawText.length) {
				const remainingText = rawText.substring(lastIndex);

				// Process inline math in the remaining text
				lastIndex = 0;
				inlineMathRegex.lastIndex = 0;
				const inlineSegments: React.ReactNode[] = [];

				while ((match = inlineMathRegex.exec(remainingText)) !== null) {
					const [fullMatch] = match;
					const matchIndex = match.index;

					// Add text before the inline LaTeX
					if (matchIndex > lastIndex) {
						const textBefore = remainingText.substring(lastIndex, matchIndex);
						inlineSegments.push(
							<span key={`inline-text-${segmentId++}`}>
								{textBefore}
							</span>
						);
					}

					// Add the inline LaTeX
					inlineSegments.push(
						<LatexRender key={`inline-latex-${segmentId++}`} latex={fullMatch} />
					);

					lastIndex = matchIndex + fullMatch.length;
				}

				// Add any remaining text after all inline math
				if (lastIndex < remainingText.length) {
					inlineSegments.push(
						<span key={`inline-final-${segmentId++}`}>
							{remainingText.substring(lastIndex)}
						</span>
					);
				}

				segments.push(...inlineSegments);
			}


		}
	}


	return segments
}


export type RenderTokenOptions = { isApplyEnabled?: boolean, isLinkDetectionEnabled?: boolean, isDesignerMode?: boolean }
const RenderToken = ({ token, inPTag, codeURI, chatMessageLocation, tokenIdx, ...options }: { token: Token | string, inPTag?: boolean, codeURI?: URI, chatMessageLocation?: ChatMessageLocation, tokenIdx: string, } & RenderTokenOptions): React.ReactNode => {
	const accessor = useAccessor()
	const languageService = accessor.get('ILanguageService')

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.raw.trim() === '') {
		return null;
	}

	if (t.type === 'space') {
		return <span>{t.raw}</span>
	}

	if (t.type === 'code') {
		const [firstLine, remainingContents] = separateOutFirstLine(t.text)
		const firstLineIsURI = isValidUri(firstLine) && !codeURI
		const contents = firstLineIsURI ? (remainingContents?.trimStart() || '') : t.text // exclude first-line URI from contents

		if (!contents) return null

		// figure out langauge and URI
		let uri: URI | null
		let language: string
		if (codeURI) {
			uri = codeURI
		}
		else if (firstLineIsURI) { // get lang from the uri in the first line of the markdown
			uri = URI.file(firstLine)
		}
		else {
			uri = null
		}

		if (t.lang) { // a language was provided. empty string is common so check truthy, not just undefined
			language = convertToVscodeLang(languageService, t.lang) // convert markdown language to language that vscode recognizes (eg markdown doesn't know bash but it does know shell)
		}
		else { // no language provided - fallback - get lang from the uri and contents
			language = detectLanguage(languageService, { uri, fileContents: contents })
		}

		if (options.isApplyEnabled && chatMessageLocation) {
			const isCodeblockClosed = t.raw.trimEnd().endsWith('```') // user should only be able to Apply when the code has been closed (t.raw ends with '```')

			const applyBoxId = getApplyBoxId({
				threadId: chatMessageLocation.threadId,
				messageIdx: chatMessageLocation.messageIdx,
				tokenIdx: tokenIdx,
			})

			const codeBlock = (
				<BlockCode
					initValue={contents.trimEnd()} // \n\n adds a permanent newline which creates a flash
					language={language}
				/>
			);

			// In designer mode, wrap HTML/CSS code blocks with collapsible wrapper
			const wrappedCodeBlock = options.isDesignerMode ? (
				<CollapsibleCodeBlock language={language}>
					{codeBlock}
				</CollapsibleCodeBlock>
			) : codeBlock;

			return <BlockCodeApplyWrapper
				canApply={isCodeblockClosed}
				applyBoxId={applyBoxId}
				codeStr={contents}
				language={language}
				uri={uri || 'current'}
			>
				{wrappedCodeBlock}
			</BlockCodeApplyWrapper>
		}

		const codeBlock = (
			<BlockCode
				initValue={contents}
				language={language}
			/>
		);

		// In designer mode, wrap HTML/CSS code blocks with collapsible wrapper
		return options.isDesignerMode ? (
			<CollapsibleCodeBlock language={language}>
				{codeBlock}
			</CollapsibleCodeBlock>
		) : codeBlock;
	}

	if (t.type === 'heading') {

		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements

		return <HeadingTag>
			<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={t.text} inPTag={true} codeURI={codeURI} {...options} />
		</HeadingTag>
	}

	if (t.type === 'table') {

		return (
			<div>
				<table>
					<thead>
						<tr>
							{t.header.map((h, hIdx: number) => (
								<th key={hIdx}>
									{h.text}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{t.rows.map((row, rowIdx: number) => (
							<tr key={rowIdx}>
								{row.map((r, rIdx: number) => (
									<td key={rIdx} >
										{r.text}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)
		// return (
		// 	<div>
		// 		<table className={'min-w-full border border-senweaver-bg-2'}>
		// 			<thead>
		// 				<tr className='bg-senweaver-bg-1'>
		// 					{t.header.map((cell: any, index: number) => (
		// 						<th
		// 							key={index}
		// 							className='px-4 py-2 border border-senweaver-bg-2 font-semibold'
		// 							style={{ textAlign: t.align[index] || 'left' }}
		// 						>
		// 							{cell.raw}
		// 						</th>
		// 					))}
		// 				</tr>
		// 			</thead>
		// 			<tbody>
		// 				{t.rows.map((row: any[], rowIndex: number) => (
		// 					<tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-senweaver-bg-1'}>
		// 						{row.map((cell: any, cellIndex: number) => (
		// 							<td
		// 								key={cellIndex}
		// 								className={'px-4 py-2 border border-senweaver-bg-2'}
		// 								style={{ textAlign: t.align[cellIndex] || 'left' }}
		// 							>
		// 								{cell.raw}
		// 							</td>
		// 						))}
		// 					</tr>
		// 				))}
		// 			</tbody>
		// 		</table>
		// 	</div>
		// )
	}

	if (t.type === 'hr') {
		return <hr />
	}

	if (t.type === 'blockquote') {
		return <blockquote>{t.text}</blockquote>
	}

	if (t.type === 'list_item') {
		return <li>
			<input type='checkbox' checked={t.checked} readOnly />
			<span>
				<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={t.text} inPTag={true} codeURI={codeURI} {...options} />
			</span>
		</li>
	}

	if (t.type === 'list') {
		const ListTag = t.ordered ? 'ol' : 'ul'

		return (
			<ListTag start={t.start ? t.start : undefined}>
				{t.items.map((item, index) => (
					<li key={index}>
						{item.task && (
							<input type='checkbox' checked={item.checked} readOnly />
						)}
						<span>
							<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={item.text} inPTag={true} {...options} />
						</span>
					</li>
				))}
			</ListTag>
		)
	}

	if (t.type === 'paragraph') {

		// check for latex
		const latexSegments = paragraphToLatexSegments(t.raw)
		if (latexSegments.length !== 0) {
			if (inPTag) {
				return <span className='block'>{latexSegments}</span>;
			}
			return <p>{latexSegments}</p>;
		}

		// if no latex, default behavior
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index}
					token={token}
					tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} // assign a unique tokenId to inPTag components
					chatMessageLocation={chatMessageLocation}
					inPTag={true}
					{...options}
				/>
			))}
		</>

		if (inPTag) return <span className='block'>{contents}</span>
		return <p>{contents}</p>
	}

	if (t.type === 'text' || t.type === 'escape') {
		return <span>{t.raw}</span>
	}

	// HTML标签作为纯文本显示
	if (t.type === 'html') {
		return <span>{t.raw}</span>
	}

	if (t.type === 'def') {
		return <></> // Definitions are typically not rendered
	}

	if (t.type === 'link') {
		return (
			<a
				onClick={() => { window.open(t.href) }}
				href={t.href}
				title={t.title ?? undefined}
				className='underline cursor-pointer hover:brightness-90 transition-all duration-200 text-senweaver-fg-2'
			>
				{t.text}
			</a>
		)
	}

	if (t.type === 'image') {
		return <img
			src={t.href}
			alt={t.text}
			title={t.title ?? undefined}
		/>
	}

	if (t.type === 'strong') {
		return <strong>{t.text}</strong>
	}

	if (t.type === 'em') {
		return <em>{t.text}</em>
	}

	// inline code
	if (t.type === 'codespan') {

		if (options.isLinkDetectionEnabled && chatMessageLocation) {
			return <CodespanWithLink
				text={t.text}
				rawText={t.raw}
				chatMessageLocation={chatMessageLocation}
			/>

		}

		return <Codespan text={t.text} />
	}

	if (t.type === 'br') {
		return <br />
	}

	// strikethrough
	if (t.type === 'del') {
		return <del>{t.text}</del>
	}
	// default
	return (
		<div className='bg-orange-50 rounded-sm overflow-hidden p-2'>
			<span className='text-sm text-orange-500'>Unknown token rendered...</span>
		</div>
	)
}


// Helper to render tokens
const RenderTokens = ({ tokens, inPTag, chatMessageLocation, tokenIdx, options }: { tokens: any[], inPTag?: boolean, chatMessageLocation?: ChatMessageLocation, tokenIdx: string, options: RenderTokenOptions }) => (
	<>
		{tokens.map((token: any, index: number) => (
			<RenderToken key={index} token={token} inPTag={inPTag} chatMessageLocation={chatMessageLocation} tokenIdx={`${tokenIdx}-${index}`} {...options} />
		))}
	</>
)

const ThinkingBlock = ({ children }: { children: React.ReactNode }) => {
	const [isCollapsed, setIsCollapsed] = useState(true);

	return (
		<div className="border-l-2 border-senweaver-border-2 pl-3 my-2 rounded-r bg-senweaver-bg-2 bg-opacity-30 py-1">
			<div
				className="flex items-center cursor-pointer text-senweaver-fg-3 text-xs font-medium select-none opacity-80 hover:opacity-100 transition-opacity"
				onClick={() => setIsCollapsed(!isCollapsed)}
			>
				{isCollapsed ? <ChevronRight size={14} className="mr-1" /> : <ChevronDown size={14} className="mr-1" />}
				<span>思考过程</span>
			</div>
			{!isCollapsed && (
				<div className="text-senweaver-fg-3 text-sm mt-1 italic leading-relaxed thinking-content">
					{children}
				</div>
			)}
		</div>
	)
}

// Helper to render content that might contain <thinking> or <think> tags
// Uses cached markdown tokens to avoid repeated parsing
const renderContentWithThinking = (content: string, props: any) => {
	// 首先清理所有残留的 thinking/think 标签
	let cleanContent = content
		.replace(/<\/(?:thinking|think)>/g, '')  // 移除单独的闭合标签
		.replace(/<(?:thinking|think)>\s*$/g, ''); // 移除末尾未闭合的开始标签

	// 匹配 <thinking> 或 <think> 标签（支持未闭合的标签）
	const thinkingRegex = /<(?:thinking|think)>([\s\S]*?)(?:<\/(?:thinking|think)>|$)/g;

	if (!thinkingRegex.test(cleanContent)) {
		// 没有 thinking 标签，直接渲染清理后的内容
		const tokens = getCachedTokens(cleanContent);
		return <RenderTokens tokens={tokens} {...props} />
	}

	thinkingRegex.lastIndex = 0;
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match;
	let key = 0;

	while ((match = thinkingRegex.exec(cleanContent)) !== null) {
		// Content before thinking
		if (match.index > lastIndex) {
			let before = cleanContent.substring(lastIndex, match.index);
			// 再次清理可能残留的标签
			before = before.replace(/<\/?(?:thinking|think)>/g, '');
			if (before.trim()) {
				const tokens = getCachedTokens(before);
				parts.push(<RenderTokens key={`pre-${key}`} tokens={tokens} {...props} tokenIdx={`pre-${key}`} />);
			}
		}

		// Thinking content
		const thinkingContent = match[1];
		if (thinkingContent.trim()) {
			const thinkingTokens = getCachedTokens(thinkingContent);
			parts.push(
				<ThinkingBlock key={`thinking-${key}`}>
					<RenderTokens tokens={thinkingTokens} {...props} tokenIdx={`thinking-${key}`} />
				</ThinkingBlock>
			);
		}

		lastIndex = match.index + match[0].length;
		key++;
	}

	// Remaining content
	if (lastIndex < cleanContent.length) {
		let after = cleanContent.substring(lastIndex);
		// 再次清理可能残留的标签
		after = after.replace(/<\/?(?:thinking|think)>/g, '');
		if (after.trim()) {
			const tokens = getCachedTokens(after);
			parts.push(<RenderTokens key={`post-${key}`} tokens={tokens} {...props} tokenIdx={`post-${key}`} />);
		}
	}

	return <>{parts}</>;
}


// Pre-compiled regex patterns (moved outside component to avoid recreation)
const IMAGE_ANALYSIS_REGEX = /<<<IMAGE_ANALYSIS_START:([^>]+)>>>\n([\s\S]*?)<<<IMAGE_ANALYSIS_END>>>/g;
const REQUIREMENT_ANALYSIS_REGEX = /<<<REQUIREMENT_ANALYSIS_START:([^>]+)>>>\n([\s\S]*?)<<<REQUIREMENT_ANALYSIS_END>>>/g;
const AUTO_REQUIREMENT_REGEX = /^(?:#{1,2}\s*(?:📋\s*)?|\*{2}📋\s*|▣\s*|📋\s*)需求分析\*{0,2}\s*\n([\s\S]+?)(?=\n\n(?:[^\d\s\-\*\n]|$)|\n#{1,2}\s|\n---|\n\*{3}|\n▣\s|\n📋\s|\n\*{2}[^\n]+\*{2}\s*\n|$(?![\s\S]))/gm;

export const ChatMarkdownRender = ({ string, inPTag = false, chatMessageLocation, ...options }: { string: string, inPTag?: boolean, codeURI?: URI, chatMessageLocation: ChatMessageLocation | undefined } & RenderTokenOptions) => {
	// Memoize string processing and regex tests to avoid repeated work
	const { processedString, hasImageAnalysis, hasRequirementAnalysis, hasAutoRequirement } = useMemo(() => {
		const processed = string.replaceAll('\n•', '\n\n•');
		return {
			processedString: processed,
			hasImageAnalysis: IMAGE_ANALYSIS_REGEX.test(processed),
			hasRequirementAnalysis: REQUIREMENT_ANALYSIS_REGEX.test(processed),
			hasAutoRequirement: AUTO_REQUIREMENT_REGEX.test(processed),
		};
	}, [string]);

	const renderProps = useMemo(() => ({ inPTag, chatMessageLocation, options }), [inPTag, chatMessageLocation, options]);

	// 处理显式需求分析标记
	if (hasRequirementAnalysis) {
		REQUIREMENT_ANALYSIS_REGEX.lastIndex = 0;

		const parts: React.ReactNode[] = [];
		let lastIndex = 0;
		let match;
		let key = 0;

		while ((match = REQUIREMENT_ANALYSIS_REGEX.exec(processedString)) !== null) {
			// 添加前面的普通markdown内容
			if (match.index > lastIndex) {
				const normalContent = processedString.substring(lastIndex, match.index);
				if (normalContent.trim()) {
					parts.push(
						<React.Fragment key={`normal-${key++}`}>
							{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `req-pre-${key}` })}
						</React.Fragment>
					);
				}
			}

			// 添加需求分析结果
			const title = match[1];
			const content = match[2];
			const contentTokens = getCachedTokens(content);

			parts.push(
				<RequirementAnalysisWrapper key={`req-${key++}`} title={title}>
					<RenderTokens tokens={contentTokens} {...renderProps} tokenIdx={`req-analysis-${key}`} />
				</RequirementAnalysisWrapper>
			);

			lastIndex = match.index + match[0].length;
		}

		// 添加剩余的普通markdown内容
		if (lastIndex < processedString.length) {
			const normalContent = processedString.substring(lastIndex);
			if (normalContent.trim()) {
				parts.push(
					<React.Fragment key={`normal-${key++}`}>
						{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `req-post-${key}` })}
					</React.Fragment>
				);
			}
		}

		return <>{parts}</>;
	}

	// 自动检测并处理"需求分析"标题格式
	if (hasAutoRequirement) {
		AUTO_REQUIREMENT_REGEX.lastIndex = 0;

		const parts: React.ReactNode[] = [];
		let lastIndex = 0;
		let match;
		let key = 0;

		while ((match = AUTO_REQUIREMENT_REGEX.exec(processedString)) !== null) {
			// 添加前面的普通markdown内容
			if (match.index > lastIndex) {
				const normalContent = processedString.substring(lastIndex, match.index);
				if (normalContent.trim()) {
					parts.push(
						<React.Fragment key={`normal-${key++}`}>
							{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `auto-req-pre-${key}` })}
						</React.Fragment>
					);
				}
			}

			// 添加需求分析结果（捕获组1是内容）
			const content = match[1];
			const contentTokens = getCachedTokens(content);

			parts.push(
				<RequirementAnalysisWrapper key={`auto-req-${key++}`} title="需求分析">
					<RenderTokens tokens={contentTokens} {...renderProps} tokenIdx={`auto-req-analysis-${key}`} />
				</RequirementAnalysisWrapper>
			);

			lastIndex = match.index + match[0].length;
		}

		// 添加剩余的普通markdown内容
		if (lastIndex < processedString.length) {
			const normalContent = processedString.substring(lastIndex);
			if (normalContent.trim()) {
				parts.push(
					<React.Fragment key={`normal-${key++}`}>
						{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `auto-req-post-${key}` })}
					</React.Fragment>
				);
			}
		}

		return <>{parts}</>;
	}

	if (hasImageAnalysis) {
		// 重置regex lastIndex
		IMAGE_ANALYSIS_REGEX.lastIndex = 0;

		// 分割字符串，提取图片分析部分和普通markdown部分
		const parts: React.ReactNode[] = [];
		let lastIndex = 0;
		let match;
		let key = 0;

		while ((match = IMAGE_ANALYSIS_REGEX.exec(processedString)) !== null) {
			// 添加前面的普通markdown内容 (可能包含 thinking)
			if (match.index > lastIndex) {
				const normalContent = processedString.substring(lastIndex, match.index);
				if (normalContent.trim()) {
					parts.push(
						<React.Fragment key={`normal-${key++}`}>
							{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `img-pre-${key}` })}
						</React.Fragment>
					);
				}
			}

			// 添加图片分析结果（需要动态导入ImageAnalysisWrapper）
			const title = match[1];
			const content = match[2];
			const contentTokens = getCachedTokens(content);

			parts.push(
				<div key={`analysis-${key++}`} className="my-2">
					<ImageAnalysisWrapperPlaceholder title={title}>
						<RenderTokens tokens={contentTokens} {...renderProps} tokenIdx={`img-analysis-${key}`} />
					</ImageAnalysisWrapperPlaceholder>
				</div>
			);

			lastIndex = match.index + match[0].length;
		}

		// 添加剩余的普通markdown内容 (可能包含 thinking)
		if (lastIndex < processedString.length) {
			const normalContent = processedString.substring(lastIndex);
			if (normalContent.trim()) {
				parts.push(
					<React.Fragment key={`normal-${key++}`}>
						{renderContentWithThinking(normalContent, { ...renderProps, tokenIdx: `img-post-${key}` })}
					</React.Fragment>
				);
			}
		}

		return <>{parts}</>;
	}

	// 没有图片分析标记，使用 thinking 解析渲染
	return renderContentWithThinking(processedString, { ...renderProps, tokenIdx: 'main' });
}

// 图片分析可折叠组件，默认收起
const ImageAnalysisWrapperPlaceholder = ({ title, children }: { title: string, children: React.ReactNode }) => {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<div className="border border-senweaver-border-3 rounded px-2 py-1 bg-senweaver-bg-3">
			<div
				className="flex items-center cursor-pointer hover:brightness-125 transition-all duration-150"
				onClick={() => setIsOpen(!isOpen)}
			>
				<ChevronRight className={`text-senweaver-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`} />
				<span className="text-senweaver-fg-3">{title}</span>
			</div>
			{isOpen && (
				<div className="py-1 text-senweaver-fg-4">
					{children}
				</div>
			)}
		</div>
	);
}

// 需求分析可折叠组件，默认收起
const RequirementAnalysisWrapper = ({ title, children }: { title: string, children: React.ReactNode }) => {
	const [isOpen, setIsOpen] = useState(false);
	return (
		<div className="border border-senweaver-border-3 rounded px-2 py-1 bg-senweaver-bg-3 my-2">
			<div
				className="flex items-center cursor-pointer hover:brightness-125 transition-all duration-150"
				onClick={() => setIsOpen(!isOpen)}
			>
				<ChevronRight className={`text-senweaver-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`} />
				<span className="text-senweaver-fg-3 font-medium">📋 {title}</span>
			</div>
			{isOpen && (
				<div className="py-2 text-senweaver-fg-4 text-sm">
					{children}
				</div>
			)}
		</div>
	);
}
