/**
 * Start Fetch URL Server - Enhanced Version
 * This script starts the backend server for handling URL fetches
 *
 * Features:
 * - Uses axios for HTTP requests with automatic redirect following
 * - Uses jsdom + @mozilla/readability for intelligent content extraction
 * - Uses turndown for high-quality HTML to Markdown conversion
 * - Supports pagination (start_index, max_length)
 * - Proper error handling and timeout control
 *
 * Usage: node startFetchUrlServer.js [port]
 * Default port: 3000
 */

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES = 3; // Retry failed requests

// User Agents for rotation (Anti-blocking) - Extended pool based on WechatSogou reference
// Includes Chinese browsers (QQ, 360, Sogou, LBBROWSER) for better domestic site compatibility
const USER_AGENTS = [
	// Modern Chrome/Edge
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
	// Firefox
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	// Chinese Browsers (better for WeChat/Sogou/Baidu)
	'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36',
	'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/21.0.1180.71 Safari/537.1 LBBROWSER',
	'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.25 Safari/537.36 Core/1.70.3877.400 QQBrowser/10.8.4559.400',
	'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/535.11 (KHTML, like Gecko) Chrome/17.0.963.84 Safari/535.11 LBBROWSER',
	'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C; .NET4.0E; QQBrowser/7.0.3698.400)',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
	'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.11 (KHTML, like Gecko) Chrome/23.0.1271.64 Safari/537.11',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36 360SE',
	'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; WOW64; Trident/6.0; SLCC2; .NET CLR 2.0.50727; .NET CLR 3.5.30729; .NET CLR 3.0.30729; Media Center PC 6.0; .NET4.0C; .NET4.0E)',
	// Safari
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// Try to load optional dependencies
let axios, JSDOM, Readability, TurndownService, cheerio, playwright;
try {
	axios = require('axios');
	const jsdom = require('jsdom');
	JSDOM = jsdom.JSDOM;
	Readability = require('@mozilla/readability').Readability;
	TurndownService = require('turndown');
	cheerio = require('cheerio');
} catch (error) {
	console.warn('⚠️  Enhanced libraries not available, using fallback implementation');
	console.warn('   To enable enhanced features, install: npm install axios jsdom @mozilla/readability turndown cheerio playwright');
}

// Try to load Playwright (prefer playwright-core for smaller size in production)
// playwright-core: ~5MB, uses system browsers
// playwright: ~150MB, includes bundled browser downloads
try {
	playwright = require('playwright-core');
} catch (e) {
	try {
		playwright = require('playwright');
	} catch (e2) {
		console.warn('[Playwright] ⚠️ Playwright not installed - headless browser features unavailable');
		console.warn('   Install with: npm install playwright-core');
	}
}

/**
 * Check if content is HTML
 */
function isHtmlContent(content, contentType) {
	if (!content) return false;
	const preview = content.substring(0, 500).toLowerCase();
	return (
		preview.includes('<html') ||
		preview.includes('<!doctype') ||
		preview.includes('<head') ||
		preview.includes('<body') ||
		(contentType && (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/xhtml')))
	);
}

/**
 * Check if content is JSON
 */
function isJsonContent(content, contentType) {
	if (!content) return false;
	if (contentType && contentType.toLowerCase().includes('application/json')) return true;
	const trimmed = content.trim();
	return (trimmed.startsWith('{') || trimmed.startsWith('['));
}

/**
 * Detect and decode content encoding
 */
function decodeContent(buffer, contentType) {
	try {
		// Try to detect encoding from content-type
		const charsetMatch = contentType && contentType.match(/charset=([^;\s]+)/i);
		if (charsetMatch) {
			const charset = charsetMatch[1].toLowerCase();
			if (charset === 'utf-8' || charset === 'utf8') {
				return buffer.toString('utf-8');
			} else if (charset === 'gbk' || charset === 'gb2312') {
				try {
					const iconv = require('iconv-lite');
					return iconv.decode(buffer, charset);
				} catch (e) { }
			}
		}
		return buffer.toString('utf-8');
	} catch (error) {
		return buffer.toString('utf-8');
	}
}

/**
 * Extract main content using Cheerio + Readability
 */
function extractMainContent(html, url) {
	// 边界情况处理
	if (!html || typeof html !== 'string' || html.length === 0) {
		console.warn('[Extract] ⚠️ Empty or invalid HTML input');
		return html || '';
	}

	try {
		// 1. Pre-process with Cheerio (Cleaner and faster than Regex)
		let cleanHtml = html;
		if (cheerio) {
			const $ = cheerio.load(html);
			const isWeChat = url.includes('mp.weixin.qq.com');
			const isFeishu = url.includes('feishu.cn') || url.includes('larksuite.com');

			// ===== 飞书文档特殊处理 =====
			if (isFeishu) {

				try {
					let feishuContent = '';
					let feishuTitle = '';

					// 尝试获取标题
					const titleEl = $('title').text() || $('h1').first().text() || $('.wiki-title').text();
					feishuTitle = titleEl.replace(/- 飞书云文档/g, '').replace(/- Lark Docs/g, '').trim();

					// ====== 方法1：提取所有 .ace-line 内容（飞书文档的核心行内容） ======
					const aceLines = [];
					const seenTexts = new Set();  // 用于去重

					$('.ace-line').each((i, el) => {
						const lineText = $(el).text().trim();
						if (lineText && lineText.length > 0 && !seenTexts.has(lineText)) {
							seenTexts.add(lineText);
							aceLines.push(lineText);
						}
					});

					if (aceLines.length > 0) {
						feishuContent = aceLines.join('\n');
					}

					// ====== 方法2：提取所有 [data-block-id] 文本块 ======
					if (!feishuContent || feishuContent.length < 2000) {
						const textBlocks = [];
						$('[data-block-id]').each((i, el) => {
							const blockText = $(el).text().trim();
							if (blockText && blockText.length > 5 && !seenTexts.has(blockText)) {
								seenTexts.add(blockText);
								textBlocks.push(blockText);
							}
						});

						if (textBlocks.length > 0) {
							const newContent = textBlocks.join('\n\n');
							if (newContent.length > feishuContent.length) {
								feishuContent = newContent;
							}
						}
					}

					// ====== 方法3：提取主要内容容器 ======
					if (!feishuContent || feishuContent.length < 2000) {
						// 飞书文档的主要内容容器选择器
						const mainContainerSelectors = [
							'.wiki-content',
							'.wiki-page-content',
							'.doc-content',
							'.docx-editor-container',
							'.lark-editor-core',
							'.ud__doc__content',
							'[data-content-editable-root]',
							'.wiki-container',
							'.doc-body',
							'.suite-markdown-container',
							'[data-testid="wiki-content"]',
							'[data-testid="doc-content"]'
						];

						for (const selector of mainContainerSelectors) {
							const el = $(selector);
							if (el.length > 0) {
								const text = el.text().trim();
								if (text.length > feishuContent.length) {
									feishuContent = text;
								}
							}
						}
					}

					// ====== 方法4：收集所有 .render-unit-wrapper 内容 ======
					if (!feishuContent || feishuContent.length < 2000) {
						const renderUnits = [];
						$('.render-unit-wrapper, .render-unit, [class*="render-unit"]').each((i, el) => {
							const unitText = $(el).text().trim();
							if (unitText && unitText.length > 10 && !seenTexts.has(unitText)) {
								seenTexts.add(unitText);
								renderUnits.push(unitText);
							}
						});

						if (renderUnits.length > 0) {
							const newContent = renderUnits.join('\n\n');
							if (newContent.length > feishuContent.length) {
								feishuContent = newContent;
							}
						}
					}

					// ====== 方法5：直接从原始 body 提取文本（总是执行） ======
					// 重要：不删除 DOM 元素（可能误删内容），只做文本清理
					{

						// 直接从原始 $ 实例获取 body 文本（不删除任何元素）
						let bodyText = $('body').text() || '';

						// 文本清理（不改变 DOM，只处理提取出的文本）
						bodyText = bodyText
							// 基础清理
							.replace(/[\u200B-\u200D\uFEFF]/g, '')  // 零宽字符
							.replace(/\t+/g, ' ')  // Tab转空格
							.replace(/ {2,}/g, ' ')  // 多空格合并
							.replace(/\n{3,}/g, '\n\n')  // 多换行合并
							.replace(/(.)\1{30,}/g, '$1$1$1')  // 去除超长重复字符（30+）
							// 移除完整的 JS 代码块（更精确的模式）
							.replace(/\(function\s*\([^)]*\)\s*\{[\s\S]{0,500}?\}\)\s*\([^)]*\)/g, '')  // IIFE
							.replace(/function\s+\w+\s*\([^)]*\)\s*\{[\s\S]{0,300}?\}/g, '')  // 命名函数
							.replace(/=>\s*\{[\s\S]{0,200}?\}/g, '')  // 箭头函数体
							// 移除常见的 JS 语句
							.replace(/window\.__\w+\s*=\s*[^;]+;/g, '')  // window.__xxx = ...;
							.replace(/window\.\w+\s*=\s*\{[\s\S]{0,300}?\};/g, '')  // window.xxx = {...};
							.replace(/document\.cookie\s*=\s*[^;]+;/g, '')  // document.cookie = ...;
							.replace(/try\s*\{[\s\S]{0,500}?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,200}?\}/g, '')  // try-catch
							.replace(/if\s*\([^)]+\)\s*\{[\s\S]{0,100}?\}/g, '')  // 短 if 语句
							// 移除错误监控代码
							.replace(/\.pcErr\s*=\s*function[\s\S]*?;/g, '')  // pcErr 函数
							.replace(/\.pcRej\s*=\s*function[\s\S]*?;/g, '')  // pcRej 函数
							.replace(/\baddEventListener\s*\([^)]+,\s*[a-zA-Z.]+,\s*true\s*\)/g, '')  // addEventListener(..., true)
							.replace(/\b\w+\.observer\s*=\s*new\b[\s\S]*?$/g, '')  // observer = new ... 到末尾
							.replace(/d\.getElementsByTagName\([^)]+\)[\s\S]*?;/g, '')  // DOM 操作
							.replace(/e\.target\s*\|\|\s*e\.srcElement[\s\S]*?;/g, '')  // 事件目标获取
							.replace(/'use-credentials'[\s\S]*?;/g, '')  // CORS 配置
							.replace(/'anonymous'[\s\S]*?;/g, '')  // CORS 配置
							// 移除末尾的代码块残留
							.replace(/\}\s*\}\s*\}\s*;+\s*$/g, '')  // 多层闭合括号
							.replace(/true\s*\)\s*;+\s*;+\s*$/g, '')  // true);; 结尾
							// 移除监控/跟踪代码标识
							.replace(/\bslardar\b|\bibytedapm\b|\bPerformanceObserver\b|\bPerformanceLongTaskTiming\b/gi, '')
							.replace(/\blongtask\b|\blargest-contentful-paint\b|\blayout-shift\b/g, '')
							// 移除常见 UI 文本
							.replace(/登录|注册|分享|举报|登陆/g, match => `\n${match}\n`)  // 保留但加换行分隔
							// 最终清理
							.replace(/ {2,}/g, ' ')
							.replace(/\n{3,}/g, '\n\n')
							.trim();


						// 总是选择最长的内容
						if (bodyText.length > feishuContent.length) {
							feishuContent = bodyText;
						}
					}

					// ====== 清理和格式化内容 ======
					if (feishuContent && feishuContent.length > 100) {
						// 清理多余空白和特殊字符
						feishuContent = feishuContent
							.replace(/[\u200B-\u200D\uFEFF]/g, '')  // 零宽字符
							.replace(/\t+/g, ' ')  // Tab转空格
							.replace(/ {3,}/g, '  ')  // 多空格合并
							.replace(/\n{4,}/g, '\n\n\n')  // 多换行合并
							.trim();

						// 最终清理：移除末尾可能残留的 JS 代码
						// 查找最后一个正常内容结束的位置（中文句号、问号、感叹号、或英文标点后跟换行）
						const contentEndPatterns = [
							/[。！？\.\!\?]["'》）\)]*\s*$/,  // 正常句子结尾
							/\d+\s*$/,  // 数字结尾（如版本号、时间）
							/[a-zA-Z]\s*$/,  // 英文字母结尾
							/[\u4e00-\u9fa5]\s*$/  // 中文字符结尾
						];

						// 检测并移除末尾的 JS 代码片段
						const jsCodePatterns = [
							/Of\(['"][^'"]+['"]\)\s*>/,  // Of('...') >
							/getElementsByTagName/,
							/appendChild/,
							/srcElement/,
							/\.observer\s*=\s*new/,
							/\bfunction\s*\(\s*\w*\s*\)\s*\{/,
							/\breturn\s+[a-z_$]/i,
							/\}\s*\)\s*;+\s*;*/  // }); 或 });;
						];

						// 如果末尾包含 JS 代码特征，尝试截断
						const last2000 = feishuContent.slice(-2000);
						for (const pattern of jsCodePatterns) {
							const match = last2000.match(pattern);
							if (match) {
								// 找到 JS 代码开始位置
								const jsStart = feishuContent.length - 2000 + last2000.indexOf(match[0]);
								// 向前查找最后一个正常内容结束点
								const beforeJs = feishuContent.slice(Math.max(0, jsStart - 500), jsStart);
								const lastGoodEnd = beforeJs.search(/[。！？\.\!\?]["'》）\)]*\s*[^\S\n]*$/);
								if (lastGoodEnd !== -1) {
									const cutPoint = Math.max(0, jsStart - 500) + lastGoodEnd + 1;
									feishuContent = feishuContent.slice(0, cutPoint).trim();
									break;
								}
							}
						}

						// 格式化输出
						const result = feishuTitle
							? `# ${feishuTitle}\n\n${feishuContent}`
							: feishuContent;

						// 直接返回文本，跳过后续的 Readability 处理
						return `<div class="feishu-content">${result.replace(/\n/g, '<br/>')}</div>`;
					}
				} catch (e) {
					console.warn('[Extract] ⚠️ Feishu special extraction failed:', e.message);
				}
			}

			// Optimize Lazy Images (WeChat/Medium/etc use data-src)
			$('img').each((i, el) => {
				const $el = $(el);
				const dataSrc = $el.attr('data-src') || $el.attr('data-original-src') || $el.attr('data-url') || $el.attr('data-croporisrc');
				if (dataSrc) {
					$el.attr('src', dataSrc);
					$el.removeAttr('data-src');
					$el.removeAttr('data-original-src');
					$el.removeAttr('data-croporisrc');
				}

				// Fix WeChat image format
				if (isWeChat) {
					let src = $el.attr('src');
					if (src && src.includes('wx_fmt=')) {
						// Replace non-standard formats with standard ones (or 'web' as per reference)
						// Actually 'jpeg' or 'png' is safer for Markdown renderers than 'web'
						// But reference uses 'web', let's use 'jpeg' or 'png' if possible, or just strip it?
						// WeChat CDN handles 'wx_fmt=jpeg' fine usually.
						// Reference says: replace("wx_fmt=jpeg", "wx_fmt=web")
						// Let's trust the reference project optimization
						$el.attr('src', src.replace(/wx_fmt=[a-zA-Z0-9]+/, 'wx_fmt=web'));
					}
				}
			});

			// WeChat Specific Processing - Based on WechatSogou reference project
			// Reference: wechatsogou/structuring.py -> get_article_detail()
			if (isWeChat) {
				try {
					const title = $('#activity-name').text().trim();
					const account = $('.profile_nickname').text().trim() || $('#js_name').text().trim();

					// Try to extract date from script (ct = create_time)
					let dateStr = '';
					const scriptContent = $('script').text();
					const ctMatch = scriptContent.match(/ct\s*=\s*"(\d+)"/);
					if (ctMatch) {
						const timestamp = parseInt(ctMatch[1]);
						const date = new Date(timestamp * 1000);
						dateStr = `\n**发布时间**: ${date.toLocaleDateString()}`;
					}

					// Get main content container
					const $content = $('#js_content, .rich_media_content').first();

					if ($content.length) {
						// === WechatSogou optimizations ===

						// 1. Remove QQ Music elements (qqmusic tag and its parent)
						$content.find('qqmusic').each((i, el) => {
							$(el).parent().remove();
						});

						// 2. Remove voice/audio elements (mpvoice tag and its parent)
						$content.find('mpvoice').each((i, el) => {
							$(el).parent().remove();
						});

						// 3. Remove video placeholders that can't be played
						$content.find('.video_iframe, .js_tx_video_container').remove();

						// 4. Fix lazy-loaded images (data-src -> src)
						$content.find('img').each((i, el) => {
							const $img = $(el);
							const dataSrc = $img.attr('data-src') || $img.attr('data-croporisrc');
							if (dataSrc) {
								// Fix WeChat image format for better compatibility
								let fixedSrc = dataSrc.replace(/wx_fmt=[a-zA-Z0-9]+/, 'wx_fmt=web');
								$img.attr('src', fixedSrc);
								$img.removeAttr('data-src');
								$img.removeAttr('data-croporisrc');
							}
						});

						// 5. Extract background-image URLs and convert to img tags
						// Reference: backgroud_image_p = re.compile('background-image:[ ]+url\(\"([\w\W]+?)\"\)')
						$content.find('[style*="background-image"]').each((i, el) => {
							const $el = $(el);
							const style = $el.attr('style') || '';
							const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
							if (bgMatch && bgMatch[1]) {
								// Create an img tag to replace or append
								const imgUrl = bgMatch[1].replace(/wx_fmt=[a-zA-Z0-9]+/, 'wx_fmt=web');
								$el.append(`<img src="${imgUrl}" alt="背景图片" />`);
								$el.removeAttr('data-src');
								$el.removeAttr('data-wxurl');
							}
						});

						// 6. Fix iframe src (data-src -> src)
						$content.find('iframe[data-src]').each((i, el) => {
							const $iframe = $(el);
							const dataSrc = $iframe.attr('data-src');
							if (dataSrc) {
								$iframe.attr('src', dataSrc);
								$iframe.removeAttr('data-src');
							}
						});

						// 7. Remove QR codes and extra areas
						$('.qr_code_pc, #js_pc_qr_code, .rich_media_area_extra, .rich_media_meta_list').remove();

						// Reconstruct clean HTML with metadata
						const contentHtml = $content.html();
						return `
							<h1>${title}</h1>
							<p><strong>公众号</strong>: ${account}${dateStr}</p>
							<hr/>
							${contentHtml}
						`;
					}
				} catch (e) {
					console.warn('WeChat extraction optimization failed:', e.message);
				}
			}

			// Remove unwanted elements - Based on Firecrawl's excludeNonMainTags
			// Reference: firecrawl/apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts
			const excludeNonMainTags = [
				// Structural navigation elements
				'header', 'footer', 'nav', 'aside',
				'.header', '.top', '.navbar', '#header',
				'.footer', '.bottom', '#footer',
				'.sidebar', '.side', '.aside', '#sidebar',
				// Modals and popups
				'.modal', '.popup', '#modal', '.overlay',
				// Ads
				'.ad', '.ads', '.advert', '#ad',
				// Language selectors (critical for SPA sites like Feishu)
				'.lang-selector', '.language', '#language-selector',
				'.language-switch', '.lang-switch', '.locale-switch',
				'[class*="language"]', '[class*="locale"]', '[class*="lang-"]',
				// Social and sharing
				'.social', '.social-media', '.social-links', '#social',
				'.share', '#share',
				// Navigation and menus
				'.menu', '.navigation', '#nav',
				'.breadcrumbs', '#breadcrumbs',
				'[role="navigation"]', '[role="menu"]', '[role="menubar"]',
				// Widgets and misc
				'.widget', '#widget',
				'.cookie', '#cookie',
				'.comment', '.comments', '#comments',
				'.related', '.related-posts',
				// Scripts and styles
				'script', 'style', 'noscript', 'iframe', 'svg',
				// Forms (usually not main content)
				'form:not([role="search"])',
				// WeChat specific
				'.qr_code_pc', '#js_pc_qr_code', '.rich_media_area_extra'
			];
			$(excludeNonMainTags.join(',')).remove();

			// Remove elements that look like language selectors (contain multiple language names)
			const langPatterns = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
				'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português', 'Русский', 'Tiếng Việt',
				'ภาษาไทย', 'العربية', 'हिन्दी', 'Türkçe', 'Polski'];
			$('ul, div, select, nav').each((i, el) => {
				const $el = $(el);
				const text = $el.text().trim();
				const langCount = langPatterns.filter(lang => text.includes(lang)).length;
				// If element has 3+ language names and is small, it's a language selector
				if (langCount >= 3 && text.length < 800) {
					$el.remove();
				}
			});

			cleanHtml = $.html();
		}

		// 2. Use Readability if available
		if (JSDOM && Readability) {
			const dom = new JSDOM(cleanHtml, { url });
			const reader = new Readability(dom.window.document, {
				// Increase content weight for common main content IDs
				nbTopCandidates: 5,
				charThreshold: 200,
				classesToPreserve: ['js_content', 'rich_media_content'] // Preserve WeChat content class
			});
			const article = reader.parse();
			if (article && article.content && article.content.length > 200) {
				// Validate that Readability didn't just pick up navigation/language menu
				const contentText = article.textContent || '';
				const langPatterns = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
					'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português', 'Русский'];
				const first500 = contentText.substring(0, 500);
				const langCount = langPatterns.filter(lang => first500.includes(lang)).length;

				// If the first 500 chars have 3+ languages, it's likely a language menu
				if (langCount >= 3) {
					console.log('[Extract] ⚠️ Readability extracted language menu, skipping...');
				} else {
					// Valid content
					return article.content;
				}
			}
		}

		// 3. Fallback to body extraction using Cheerio (Targeted Selectors)
		if (cheerio) {
			const $ = cheerio.load(cleanHtml);
			// Try to find main content container (Priority ordered)
			const selectors = [
				'#js_content', // WeChat
				'.rich_media_content', // WeChat Legacy
				// Feishu selectors
				'.wiki-content',
				'.doc-content',
				'.lark-editor',
				'.ud__doc__content',
				'.render-unit-wrapper',
				'.wiki-page-content',
				'.docx-container',
				// Common selectors
				'article',
				'main',
				'#content',
				'.content',
				'#main',
				'.main',
				'.post-content',
				'.entry-content',
				'.article-body'
			];

			// Language patterns for validation
			const langPatterns = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
				'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português', 'Русский'];

			for (const selector of selectors) {
				const el = $(selector);
				if (el.length > 0) {
					// If multiple matches, take the longest one that's NOT a language menu
					let bestEl = null;
					let bestLen = 0;

					el.each((i, e) => {
						const $e = $(e);
						const text = $e.text().trim();
						const first300 = text.substring(0, 300);
						const langCount = langPatterns.filter(lang => first300.includes(lang)).length;

						// Skip if it looks like a language selector
						if (langCount >= 3) return;

						if (text.length > bestLen && text.length > 100) {
							bestEl = $e;
							bestLen = text.length;
						}
					});

					if (bestEl) {
						return bestEl.html();
					}
				}
			}

			// Last resort: get body but try to filter out navigation
			return $('body').html() || html;
		}

		return html;
	} catch (error) {
		console.warn('Error extracting main content:', error);
		return html;
	}
}

/**
 * Convert HTML to Markdown using Turndown
 */
function convertHtmlToMarkdown(html) {
	// 边界情况处理
	if (!html || typeof html !== 'string' || html.length === 0) {
		return html || '';
	}

	// 检测是否为飞书文档的特殊格式（已预处理的纯文本）
	if (html.includes('class="feishu-content"')) {
		// 飞书文档已经是纯文本格式，只需要清理 HTML 标签
		let text = html
			.replace(/<br\s*\/?>/gi, '\n')  // br 转换为换行
			.replace(/<\/?(div|p|span)[^>]*>/gi, '\n')  // 块级元素转换为换行
			.replace(/<[^>]+>/g, '')  // 移除其他 HTML 标签
			.replace(/\n{3,}/g, '\n\n')  // 多个换行合并为两个
			.trim();
		return text;
	}

	if (TurndownService) {
		try {
			const turndownService = new TurndownService({
				headingStyle: 'atx',
				codeBlockStyle: 'fenced',
				bulletListMarker: '-',
				emDelimiter: '*',
				strongDelimiter: '**',
			});

			// Custom rules
			turndownService.addRule('removeImages', {
				filter: 'img',
				replacement: (content, node) => {
					const alt = node.getAttribute('alt') || '';
					const src = node.getAttribute('src') || '';
					// WeChat images often have no extension or complex URLs, keep them
					return src ? `![${alt}](${src})` : ''; // Standard Markdown Image
				}
			});

			// 保留 br 标签为换行
			turndownService.addRule('lineBreaks', {
				filter: 'br',
				replacement: () => '\n'
			});

			return turndownService.turndown(html);
		} catch (e) {
			console.warn('[Convert] ⚠️ Turndown failed:', e.message);
		}
	}
	// Simple regex fallback if Turndown fails
	return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

/**
 * Attempt to find a system-installed Chrome or Edge browser
 * This allows using Playwright without downloading the bundled browsers
 */
function getSystemBrowserPath() {
	const platform = os.platform();
	const commonPaths = [];

	if (platform === 'win32') {
		const suffixes = [
			'\\Google\\Chrome\\Application\\chrome.exe',
			'\\Microsoft\\Edge\\Application\\msedge.exe',
			'\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
		];
		const prefixes = [
			process.env.LOCALAPPDATA,
			process.env.PROGRAMFILES,
			process.env['PROGRAMFILES(X86)']
		].filter(Boolean);

		prefixes.forEach(prefix => {
			suffixes.forEach(suffix => {
				commonPaths.push(path.join(prefix, suffix));
			});
		});
	} else if (platform === 'darwin') {
		commonPaths.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
			'/Applications/Chromium.app/Contents/MacOS/Chromium'
		);
	} else {
		// Linux
		commonPaths.push(
			'/usr/bin/google-chrome',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
			'/usr/bin/microsoft-edge'
		);
	}

	for (const p of commonPaths) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}

/**
 * Fetch URL using Jina Reader API (Excellent for WeChat/Blocked sites)
 * Returns Markdown directly
 */
async function fetchWithJina(urlString) {
	if (!axios) throw new Error('Axios not available');

	const jinaUrl = `https://r.jina.ai/${urlString}`;

	const response = await axios.get(jinaUrl, {
		headers: {
			'User-Agent': getRandomUserAgent(),
			'Accept': 'text/markdown, text/plain, */*',
			'X-With-Generated-Alt': 'true' // Get AI generated alt text for images
		},
		timeout: 45000, // Give Jina some time
		validateStatus: status => status < 500,
		responseType: 'text' // Force text response to avoid auto JSON parsing
	});

	// Ensure body is always a string
	let body = response.data;
	if (typeof body !== 'string') {
		body = JSON.stringify(body, null, 2);
	}

	return {
		statusCode: response.status,
		headers: response.headers,
		body: body,
		isMarkdown: true // Flag to skip html-to-markdown conversion
	};
}

/**
 * Comprehensive page content extraction for all website types
 * Handles: SPA, lazy loading, virtual scroll, iframes, accordions, tabs, etc.
 */
async function extractAllPageContent(page) {
	return await page.evaluate(async () => {
		const results = {
			mainContent: '',
			iframeContent: [],
			expandedContent: [],
			allText: ''
		};

		// 1. Expand all collapsible/accordion content
		const expandCollapsibles = async () => {
			const expandSelectors = [
				// Accordion patterns
				'[class*="collapse"]:not(.show)', '[class*="accordion"]:not(.active)',
				'[class*="expand"]', '[class*="toggle"]',
				'[aria-expanded="false"]', '[data-toggle="collapse"]',
				// Details/Summary
				'details:not([open])',
				// Common expand buttons
				'button[class*="more"]', 'button[class*="expand"]',
				'[class*="show-more"]', '[class*="load-more"]', '[class*="read-more"]',
				// Tree views
				'[class*="tree-node"]:not(.expanded)', '[class*="folder"]:not(.open)'
			];

			for (const selector of expandSelectors) {
				const elements = document.querySelectorAll(selector);
				for (const el of elements) {
					try {
						el.click();
						await new Promise(r => setTimeout(r, 200));
					} catch (e) { }
				}
			}
		};

		// 2. Click all "Load More" buttons
		const clickLoadMore = async () => {
			const loadMoreSelectors = [
				'button:contains("加载更多")', 'button:contains("查看更多")',
				'button:contains("Load More")', 'button:contains("Show More")',
				'button:contains("View More")', 'button:contains("See More")',
				'[class*="load-more"]', '[class*="show-more"]', '[class*="view-more"]',
				'a[class*="more"]', 'span[class*="more"]'
			];

			for (const selector of loadMoreSelectors) {
				try {
					const elements = document.querySelectorAll(selector);
					for (const el of elements) {
						if (el.offsetParent !== null) { // visible
							el.click();
							await new Promise(r => setTimeout(r, 500));
						}
					}
				} catch (e) { }
			}
		};

		// 3. Switch through all tabs
		const switchTabs = async () => {
			const tabSelectors = [
				'[role="tab"]', '[class*="tab-item"]', '[class*="tab-header"]',
				'.nav-tabs a', '.nav-tabs button', '[data-toggle="tab"]'
			];

			for (const selector of tabSelectors) {
				const tabs = document.querySelectorAll(selector);
				for (const tab of tabs) {
					try {
						tab.click();
						await new Promise(r => setTimeout(r, 300));
					} catch (e) { }
				}
			}
		};

		// 4. Enhanced scroll to bottom - Reference: firecrawl project
		// Handles: lazy loading, infinite scroll, dynamic content loading
		const scrollToBottomCompletely = async () => {
			// Strategy: Scroll incrementally and wait for new content to load
			// This handles infinite scroll pages and lazy-loaded content

			let previousHeight = 0;
			let currentHeight = document.body.scrollHeight;
			let scrollAttempts = 0;
			const maxScrollAttempts = 50; // Prevent infinite loops
			const scrollStep = 800; // Pixels to scroll each step
			const scrollDelay = 300; // Milliseconds between scrolls

			// Phase 1: Scroll to absolute bottom with content detection
			while (scrollAttempts < maxScrollAttempts) {
				// Scroll down
				window.scrollBy(0, scrollStep);

				// Also trigger scroll event for frameworks that listen to it
				window.dispatchEvent(new Event('scroll'));
				document.dispatchEvent(new Event('scroll'));

				await new Promise(r => setTimeout(r, scrollDelay));

				// Check if we've reached the bottom
				const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
				const windowHeight = window.innerHeight;
				currentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

				// If we're at the bottom and no new content loaded
				if (scrollTop + windowHeight >= currentHeight - 10) {
					// Wait a bit longer for potential lazy content
					await new Promise(r => setTimeout(r, 500));

					// Re-check height after waiting
					const newHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

					if (newHeight === currentHeight) {
						// No new content, we're done
						if (previousHeight === currentHeight) {
							break; // Truly at the bottom
						}
					}
					previousHeight = currentHeight;
					currentHeight = newHeight;
				}

				scrollAttempts++;
			}

			// Phase 2: Handle horizontal scroll (for wide content like tables, code blocks)
			const totalWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
			if (totalWidth > window.innerWidth + 100) {
				// Scroll horizontally to load any lazy content
				for (let pos = 0; pos < totalWidth; pos += 500) {
					window.scrollTo(pos, 0);
					await new Promise(r => setTimeout(r, 100));
				}
				window.scrollTo(0, 0);
			}

			// Phase 3: Quick scroll back up and down to trigger any remaining lazy loads
			window.scrollTo(0, 0);
			await new Promise(r => setTimeout(r, 200));

			// Final scroll to bottom
			window.scrollTo(0, document.body.scrollHeight);
			await new Promise(r => setTimeout(r, 500));

			// Scroll back to top for content extraction
			window.scrollTo(0, 0);
		};

		// 5. Scroll all scrollable containers (sidebars, nested scrolls, horizontal scrolls)
		const scrollAllContainers = async () => {
			// Common selectors for sidebars and menus
			const sidebarSelectors = [
				// Left sidebars
				'[class*="sidebar"]', '[class*="sidenav"]', '[class*="left-menu"]',
				'[class*="leftbar"]', '[class*="left-nav"]', '[class*="left-panel"]',
				'nav[class*="left"]', 'aside[class*="left"]', '.aside-left',
				// Right sidebars
				'[class*="right-menu"]', '[class*="rightbar"]', '[class*="right-nav"]',
				'[class*="right-panel"]', 'aside[class*="right"]', '.aside-right',
				// Generic
				'[role="navigation"]', '[role="complementary"]', 'aside', 'nav',
				'.menu', '.navigation', '.toc', '.table-of-contents',
				// Documentation sites
				'.docs-sidebar', '.api-sidebar', '.nav-sidebar'
			];

			// Find all scrollable elements
			const allElements = document.querySelectorAll('*');
			const verticalScrollable = [];
			const horizontalScrollable = [];

			for (const el of allElements) {
				if (el === document.body || el === document.documentElement) continue;

				const style = window.getComputedStyle(el);
				const rect = el.getBoundingClientRect();

				// Skip invisible elements
				if (rect.width === 0 || rect.height === 0) continue;

				// Check vertical scrollable
				const isVerticalScrollable = (
					style.overflow === 'auto' || style.overflow === 'scroll' ||
					style.overflowY === 'auto' || style.overflowY === 'scroll'
				) && el.scrollHeight > el.clientHeight + 30;

				// Check horizontal scrollable
				const isHorizontalScrollable = (
					style.overflow === 'auto' || style.overflow === 'scroll' ||
					style.overflowX === 'auto' || style.overflowX === 'scroll'
				) && el.scrollWidth > el.clientWidth + 30;

				if (isVerticalScrollable) {
					verticalScrollable.push(el);
				}
				if (isHorizontalScrollable) {
					horizontalScrollable.push(el);
				}
			}

			// Also find sidebars by selector
			for (const selector of sidebarSelectors) {
				try {
					const elements = document.querySelectorAll(selector);
					for (const el of elements) {
						if (el.scrollHeight > el.clientHeight + 30 && !verticalScrollable.includes(el)) {
							verticalScrollable.push(el);
						}
						if (el.scrollWidth > el.clientWidth + 30 && !horizontalScrollable.includes(el)) {
							horizontalScrollable.push(el);
						}
					}
				} catch (e) { }
			}

			// Scroll all vertical scrollable containers
			for (const el of verticalScrollable) {
				try {
					const maxScroll = el.scrollHeight;
					// Scroll down
					for (let pos = 0; pos < maxScroll; pos += 200) {
						el.scrollTop = pos;
						el.dispatchEvent(new Event('scroll', { bubbles: true }));
						await new Promise(r => setTimeout(r, 80));
					}
					// Scroll back to top
					el.scrollTop = 0;
				} catch (e) { }
			}

			// Scroll all horizontal scrollable containers
			for (const el of horizontalScrollable) {
				try {
					const maxScroll = el.scrollWidth;
					// Scroll right
					for (let pos = 0; pos < maxScroll; pos += 200) {
						el.scrollLeft = pos;
						el.dispatchEvent(new Event('scroll', { bubbles: true }));
						await new Promise(r => setTimeout(r, 80));
					}
					// Scroll back to left
					el.scrollLeft = 0;
				} catch (e) { }
			}
		};

		// Execute all content loading strategies in optimal order
		// 1. First scroll to bottom to trigger all lazy loading (most important)
		try { await scrollToBottomCompletely(); } catch (e) { }

		// 2. Expand collapsibles after scroll (they might be lazy loaded)
		try { await expandCollapsibles(); } catch (e) { }

		// 3. Click load more buttons
		try { await clickLoadMore(); } catch (e) { }

		// 4. Switch tabs to load their content
		try { await switchTabs(); } catch (e) { }

		// 5. Scroll nested containers
		try { await scrollAllContainers(); } catch (e) { }

		// 6. Final scroll to ensure everything is loaded
		try { await scrollToBottomCompletely(); } catch (e) { }

		// Wait for any triggered content to load
		await new Promise(r => setTimeout(r, 1500));

		// Collect all text content
		results.allText = document.body.innerText || '';

		return results;
	});
}

/**
 * Fetch URL using Playwright (Headless Browser)
 * Optimized for all website types: SPA, lazy loading, virtual scroll, etc.
 * Returns { statusCode, headers, body } or throws
 */
async function fetchWithPlaywright(urlString) {
	if (!playwright) throw new Error('Playwright not available');

	let browser;
	const launchOptions = {
		headless: true,
		timeout: 30000,
		args: [
			'--disable-blink-features=AutomationControlled',
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-accelerated-2d-canvas',
			'--no-first-run',
			'--no-zygote',
			'--disable-gpu',
			'--disable-extensions',
			'--disable-background-networking',
			'--disable-sync',
			'--disable-translate',
			'--metrics-recording-only',
			'--mute-audio',
			'--no-default-browser-check',
			'--disable-web-security', // Allow cross-origin for iframes
			'--disable-features=IsolateOrigins,site-per-process' // For iframe access
		]
	};

	const startTime = Date.now();  // 定义在 try 块外，确保 catch 块能访问

	try {

		// Priority: System browser first (users already have Chrome/Edge), then bundled browser
		// This ensures end users don't need to install Playwright browsers separately

		const systemBrowserPath = getSystemBrowserPath();

		if (systemBrowserPath) {
			// Use system browser (Chrome/Edge) - no additional installation needed
			try {
				browser = await playwright.chromium.launch({
					...launchOptions,
					executablePath: systemBrowserPath,
					channel: undefined
				});
			} catch (systemError) {
				console.warn(`[Playwright] ⚠️ System browser failed: ${systemError.message}, trying bundled...`);
				// Fall through to try bundled browser
				browser = null;
			}
		}

		// If system browser failed or not found, try bundled Playwright browser
		if (!browser) {
			try {
				browser = await playwright.chromium.launch(launchOptions);
			} catch (bundledError) {
				throw new Error(`No browser available. Install Chrome/Edge or run 'npx playwright install chromium'`);
			}
		}

		// 随机视口尺寸，更像真实用户
		const viewports = [
			{ width: 1920, height: 1080 },
			{ width: 1536, height: 864 },
			{ width: 1440, height: 900 },
			{ width: 1366, height: 768 },
			{ width: 1280, height: 720 }
		];
		const randomViewport = viewports[Math.floor(Math.random() * viewports.length)];

		const context = await browser.newContext({
			userAgent: getRandomUserAgent(),
			viewport: randomViewport,
			deviceScaleFactor: 1,
			isMobile: false,
			hasTouch: false,
			ignoreHTTPSErrors: true,
			locale: 'zh-CN',
			timezoneId: 'Asia/Shanghai',
			geolocation: { longitude: 116.4074, latitude: 39.9042 },  // 北京
			permissions: ['geolocation']
		});

		// Add init script to hide automation and simulate real browser
		await context.addInitScript(() => {
			// 隐藏 webdriver 标识
			Object.defineProperty(navigator, 'webdriver', {
				get: () => undefined
			});

			// 模拟真实浏览器属性
			Object.defineProperty(navigator, 'languages', {
				get: () => ['zh-CN', 'zh', 'en-US', 'en']
			});

			Object.defineProperty(navigator, 'plugins', {
				get: () => [
					{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
					{ name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
					{ name: 'Native Client', filename: 'internal-nacl-plugin' }
				]
			});

			// 覆盖 chrome runtime
			window.chrome = {
				runtime: {},
				loadTimes: function () { },
				csi: function () { },
				app: {}
			};

			// 模拟真实的权限 API
			const originalQuery = window.navigator.permissions?.query;
			if (originalQuery) {
				window.navigator.permissions.query = (parameters) => (
					parameters.name === 'notifications' ?
						Promise.resolve({ state: Notification.permission }) :
						originalQuery(parameters)
				);
			}
		});

		const page = await context.newPage();

		// Block media and ads to speed up loading
		await page.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm,font,woff,woff2}', route => route.abort());
		await page.route('**/*', route => {
			const url = route.request().url();
			const adDomains = [
				'google-analytics.com', 'doubleclick.net', 'googlesyndication.com',
				'adservice.google.com', 'adnxs.com'
			];
			if (adDomains.some(d => url.includes(d))) {
				return route.abort();
			}
			return route.continue();
		});

		// Go to page and wait for content
		// 飞书等 SPA 网站使用 domcontentloaded，然后手动等待内容
		const navStartTime = Date.now();

		// 检测是否为飞书文档（提前检测以选择正确的等待策略）
		const isFeishuUrl = urlString.includes('feishu.cn') || urlString.includes('larksuite.com');

		let response;
		try {
			if (isFeishuUrl) {
				// 飞书文档使用 domcontentloaded + 手动等待，避免 networkidle 超时
				response = await page.goto(urlString, {
					waitUntil: 'domcontentloaded',
					timeout: 30000
				});
			} else {
				// 其他网站尝试 networkidle
				response = await page.goto(urlString, {
					waitUntil: 'networkidle',
					timeout: 45000
				});
			}
		} catch (e) {
			// 如果超时，不要再次 goto，而是继续处理当前页面
			response = null;
		}

		// ============================================
		// COMPREHENSIVE CONTENT LOADING STRATEGIES
		// Handles all website types: SPA, lazy load, virtual scroll, etc.
		// ============================================

		// 使用已检测的飞书 URL 标志（避免重复检测）
		const isFeishuDoc = isFeishuUrl;

		// ============================================
		// 模拟人类行为函数
		// ============================================
		const simulateHumanBehavior = async () => {
			// 1. 随机鼠标移动
			const moveMouseRandomly = async () => {
				for (let i = 0; i < 5; i++) {
					const x = Math.floor(Math.random() * randomViewport.width * 0.8) + 100;
					const y = Math.floor(Math.random() * randomViewport.height * 0.8) + 100;
					await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) });
					await page.waitForTimeout(100 + Math.floor(Math.random() * 300));
				}
			};

			// 2. 随机滚动
			const scrollRandomly = async () => {
				for (let i = 0; i < 3; i++) {
					const scrollAmount = 200 + Math.floor(Math.random() * 400);
					await page.mouse.wheel(0, scrollAmount);
					await page.waitForTimeout(500 + Math.floor(Math.random() * 1000));
				}
			};

			// 3. 模拟阅读行为（鼠标悬停）
			const simulateReading = async () => {
				const textElements = await page.$$('p, h1, h2, h3, .ace-line, [data-block-id]');
				const elementsToHover = textElements.slice(0, Math.min(5, textElements.length));
				for (const el of elementsToHover) {
					try {
						await el.hover();
						await page.waitForTimeout(300 + Math.floor(Math.random() * 700));
					} catch (e) { }
				}
			};

			await moveMouseRandomly();
			await scrollRandomly();
			await simulateReading();
		};

		// 1. Initial wait for JavaScript frameworks to initialize
		// 飞书文档需要更长的等待时间
		if (isFeishuDoc) {

			// 先等待页面基础加载
			await page.waitForTimeout(3000);

			// 模拟人类行为
			await simulateHumanBehavior();

			// 再等待内容加载
			await page.waitForTimeout(5000);

			// 等待飞书文档的内容容器出现
			const feishuContentSelectors = [
				'.ace-line',
				'.wiki-page-content',
				'[data-block-id]',
				'.doc-content',
				'.wiki-content',
				'[data-content-editable-root]'
			];

			try {
				await page.waitForSelector(feishuContentSelectors.join(', '), { timeout: 15000 });
			} catch (e) {
				// Feishu content container not found, continue anyway
			}
		} else {
			await page.waitForTimeout(2000);
		}

		// 2. Wait for common loading indicators to disappear
		try {
			await page.waitForFunction(() => {
				const loadingSelectors = [
					'.loading', '.spinner', '.skeleton', '[class*="loading"]', '[class*="spinner"]',
					'[class*="skeleton"]', '[aria-busy="true"]', '[data-loading="true"]'
				];
				const loadingElements = document.querySelectorAll(loadingSelectors.join(','));
				for (const el of loadingElements) {
					if (el.offsetParent !== null) return false; // Still loading
				}

				const bodyText = document.body.innerText || '';
				const loadingText = ['加载中', 'Loading...', '请稍候', '正在加载', 'Please wait'];
				if (loadingText.some(t => bodyText.includes(t)) && bodyText.length < 1000) return false;

				return true;
			}, { timeout: 10000 });
		} catch (e) {
			console.log('[Playwright] Loading wait timeout, continuing...');
		}

		// 3. Comprehensive content extraction (scroll, expand, click load more, etc.)
		try {
			await extractAllPageContent(page);
		} catch (e) {
			console.log('[Playwright] Content extraction error (ignored):', e.message);
		}

		// 3.5. 飞书文档特殊处理：模拟人类浏览行为并加载所有内容
		if (isFeishuDoc) {
			try {
				// 第一阶段：模拟人类鼠标移动和点击
				await page.mouse.move(500, 300, { steps: 20 });
				await page.waitForTimeout(500);

				// 点击页面主体区域（模拟用户点击进入阅读模式）
				try {
					await page.click('.docx-editor-container, .wiki-content, .doc-content, body', { timeout: 2000 });
				} catch (e) { }
				await page.waitForTimeout(1000);

				// 第二阶段：展开所有可折叠内容
				await page.evaluate(async () => {
					const expandSelectors = [
						'[class*="expand"]',
						'[class*="collapse"]',
						'[class*="fold"]',
						'.toggle-button',
						'.wiki-tree-item-arrow',
						'[data-testid="toggle"]'
					];

					for (const selector of expandSelectors) {
						document.querySelectorAll(selector).forEach(el => {
							try { el.click(); } catch (e) { }
						});
					}
				});
				await page.waitForTimeout(1500);

				// 第三阶段：人性化滚动（带随机延迟和速度）
				const scrollResult = await page.evaluate(async () => {
					// 飞书文档的内容可能在可滚动容器中
					const scrollContainers = [
						'.wiki-content',
						'.wiki-page-content',
						'.doc-content',
						'.docx-editor-container',
						'.catalog-container',
						'[data-content-editable-root]',
						'.lark-editor-core',
						'.suite-doc-content',
						'.wiki-body',
						'[class*="editor-container"]',
						'[class*="content-wrapper"]'
					];

					let scrolled = false;
					let totalScrolled = 0;

					// 人性化滚动函数
					const humanScroll = async (element, maxHeight) => {
						let currentPos = 0;
						while (currentPos < maxHeight) {
							// 随机滚动步长（200-500像素）
							const step = 200 + Math.floor(Math.random() * 300);
							// 随机延迟（50-200ms）
							const delay = 50 + Math.floor(Math.random() * 150);

							currentPos += step;
							if (element === window) {
								window.scrollTo({ top: currentPos, behavior: 'smooth' });
							} else {
								element.scrollTop = currentPos;
							}
							await new Promise(r => setTimeout(r, delay));

							// 偶尔暂停（模拟阅读）
							if (Math.random() < 0.1) {
								await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
							}
						}
					};

					// 尝试滚动所有可能的内容容器
					for (const selector of scrollContainers) {
						const containers = document.querySelectorAll(selector);
						for (const container of containers) {
							if (container && container.scrollHeight > container.clientHeight + 100) {
								scrolled = true;

								// 人性化滚动2轮
								for (let round = 0; round < 2; round++) {
									await humanScroll(container, container.scrollHeight);
									await new Promise(r => setTimeout(r, 800));
									totalScrolled += container.scrollHeight;
								}
								container.scrollTop = 0;
							}
						}
					}

					// 同时人性化滚动主窗口
					const totalHeight = Math.max(
						document.body.scrollHeight,
						document.documentElement.scrollHeight,
						document.body.offsetHeight
					);

					// 主窗口滚动2轮
					for (let round = 0; round < 2; round++) {
						await humanScroll(window, totalHeight);
						await new Promise(r => setTimeout(r, 1000));
						totalScrolled += totalHeight;
					}
					window.scrollTo(0, 0);

					// 获取当前内容统计
					const aceLineCount = document.querySelectorAll('.ace-line').length;
					const blockIdCount = document.querySelectorAll('[data-block-id]').length;
					const bodyTextLength = document.body.innerText?.length || 0;

					return { scrolled, totalScrolled, aceLineCount, blockIdCount, bodyTextLength };
				});

				// 第四阶段：再次模拟阅读行为
				await simulateHumanBehavior();

				// 第五阶段：等待额外内容渲染
				await page.waitForTimeout(3000);

				// 第四阶段：检查是否有"加载更多"按钮并点击
				await page.evaluate(async () => {
					const loadMoreSelectors = [
						'[class*="load-more"]',
						'[class*="show-more"]',
						'button:contains("更多")',
						'button:contains("展开")',
						'[class*="expand-all"]'
					];

					for (const selector of loadMoreSelectors) {
						try {
							const btns = document.querySelectorAll(selector);
							btns.forEach(btn => {
								if (btn && btn.offsetParent !== null) {
									btn.click();
								}
							});
						} catch (e) { }
					}
				});

				await page.waitForTimeout(2000);

			} catch (e) {
				console.log('[Playwright] ⚠️ Feishu content loading error:', e.message);
			}
		}

		// 4. Handle iframes - extract content from all accessible iframes
		try {
			const frames = page.frames();
			if (frames.length > 1) {
				for (const frame of frames) {
					try {
						await frame.evaluate(async () => {
							// Scroll within iframe
							const scrollHeight = document.body?.scrollHeight || 0;
							for (let pos = 0; pos < scrollHeight; pos += 300) {
								window.scrollTo(0, pos);
								await new Promise(r => setTimeout(r, 50));
							}
						});
					} catch (e) { } // Cross-origin frames will fail, that's ok
				}
			}
		} catch (e) { }

		// 5. Final wait for any async content
		await page.waitForTimeout(1000);

		// 6. Detect if we have meaningful content
		const contentCheck = await page.evaluate(() => {
			const bodyText = document.body.innerText || '';
			const langKeywords = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
				'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português'];
			const langCount = langKeywords.filter(lang => bodyText.substring(0, 500).includes(lang)).length;
			const isOnlyNavigation = langCount >= 3 && bodyText.length < 3000;

			return {
				textLength: bodyText.length,
				isOnlyNavigation,
				hasSubstantialContent: bodyText.length > 1000 && !isOnlyNavigation
			};
		});

		// 7. If still no content, try aggressive scroll with multiple techniques
		if (!contentCheck.hasSubstantialContent) {
			try {
				await page.evaluate(async () => {
					// Technique 1: Simulate human-like scrolling with variable speed
					const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
					let currentPosition = 0;

					while (currentPosition < totalHeight) {
						// Variable scroll amount (human-like)
						const scrollAmount = 300 + Math.random() * 400;
						window.scrollBy(0, scrollAmount);
						currentPosition += scrollAmount;

						// Trigger multiple scroll events for different frameworks
						window.dispatchEvent(new Event('scroll', { bubbles: true }));
						document.dispatchEvent(new WheelEvent('wheel', { deltaY: scrollAmount, bubbles: true }));

						// Variable delay (human-like)
						await new Promise(r => setTimeout(r, 150 + Math.random() * 150));
					}

					// Technique 2: Click on the page body to focus (some sites need this)
					document.body.click();
					await new Promise(r => setTimeout(r, 100));

					// Technique 3: Simulate keyboard scroll (Page Down)
					for (let i = 0; i < 10; i++) {
						document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true }));
						await new Promise(r => setTimeout(r, 200));
					}

					// Final: scroll to very bottom
					window.scrollTo(0, document.body.scrollHeight);
					await new Promise(r => setTimeout(r, 1000));

					// Then back to top
					window.scrollTo(0, 0);
				});
				await page.waitForTimeout(2000);
			} catch (e) {
				console.log('[Playwright] Aggressive scroll failed (ignored):', e.message);
			}
		}

		const content = await page.content();
		const status = response ? response.status() : 200;
		const headers = response ? response.headers() : {};

		await browser.close();

		// 确保 content 是有效字符串
		const finalContent = content || '';

		return {
			statusCode: status,
			headers,
			body: finalContent
		};
	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`[Playwright] ❌ Failed after ${totalTime}ms:`, error.message);
		if (browser) await browser.close();
		throw error;
	}
}

/**
 * Main fetch function with Strategy Pattern (Playwright -> Axios -> Jina)
 * Priority: Playwright first (most robust), then Axios (fast), then Jina (fallback)
 */
async function fetchUrl(urlString, timeout = DEFAULT_TIMEOUT) {
	// Strategy: 1. Try Playwright first (most robust for JS-heavy sites)
	// 2. If Playwright fails, try Axios (fast, good for simple sites)
	// 3. If Axios fails, try Jina Reader (external service fallback)

	const tryAxios = async () => {
		if (!axios) throw new Error('Axios not available');

		// Enhanced headers based on WechatSogou reference
		// Reference: wechatsogou/api.py -> __get(), __set_cookie()
		const isChineseSite = urlString.includes('.qq.com') ||
			urlString.includes('.weixin.') ||
			urlString.includes('sogou.com') ||
			urlString.includes('baidu.com') ||
			urlString.includes('.cn/');

		const headers = {
			'User-Agent': getRandomUserAgent(),
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			'Accept-Language': isChineseSite ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9,zh-CN;q=0.8',
			'Accept-Encoding': 'gzip, deflate, br',
			'Cache-Control': 'no-cache',
			'Pragma': 'no-cache',
			'Upgrade-Insecure-Requests': '1',
			'Sec-Fetch-Dest': 'document',
			'Sec-Fetch-Mode': 'navigate',
			'Sec-Fetch-Site': 'none',
			'Sec-Fetch-User': '?1',
			'DNT': '1',
			'Connection': 'keep-alive'
		};

		// Add Referer for WeChat/Sogou to appear more legitimate
		if (urlString.includes('mp.weixin.qq.com')) {
			headers['Referer'] = 'https://mp.weixin.qq.com/';
		} else if (urlString.includes('sogou.com')) {
			headers['Referer'] = 'https://weixin.sogou.com/';
		}

		const response = await axios.get(urlString, {
			headers,
			timeout,
			maxRedirects: 5,
			responseType: 'arraybuffer', // Use arraybuffer to handle encodings manually
			validateStatus: status => status < 500, // Accept 4xx to handle them manually
			// Preserve cookies across redirects
			withCredentials: false,
			decompress: true
		});

		const contentType = response.headers['content-type'] || '';
		let body = decodeContent(Buffer.from(response.data), contentType);

		return {
			statusCode: response.status,
			headers: response.headers,
			body,
			contentType
		};
	};

	let result;
	let usedMethod = 'none';

	// Strategy 1: Try Playwright first (most robust)
	if (playwright) {
		try {
			result = await fetchWithPlaywright(urlString);
			usedMethod = 'playwright';
		} catch (pwError) {
			console.warn('[Fetch] ⚠️ Playwright failed:', pwError.message);
		}
	} else {
		console.log('[Fetch] ⚠️ Playwright not available, skipping...');
	}

	// Strategy 2: Try Axios if Playwright failed
	if (usedMethod === 'none') {
		try {
			result = await tryAxios();

			// 确保 result.body 是字符串
			if (!result.body || typeof result.body !== 'string') {
				result.body = '';
			}

			// Enhanced anti-crawler detection based on WechatSogou reference
			// Reference: wechatsogou/api.py -> __get_by_unlock()
			const bodyLower = result.body.toLowerCase();

			// 1. HTTP status code blocking
			const isHttpBlocked = result.statusCode === 403 || result.statusCode === 429 || result.statusCode === 503;

			// 2. Captcha/verification page detection
			const hasCaptcha = bodyLower.includes('captcha') ||
				bodyLower.includes('验证码') ||
				bodyLower.includes('请输入验证码') ||
				bodyLower.includes('security check') ||
				bodyLower.includes('security verification');

			// 3. Anti-spider page detection (Sogou specific)
			// Reference: if 'antispider' in resp.url or '请输入验证码' in resp.text
			const isAntiSpider = bodyLower.includes('antispider') ||
				result.body.includes('/antispider/') ||
				bodyLower.includes('异常访问') ||
				bodyLower.includes('访问过于频繁');

			// 4. JavaScript-required page detection
			const needsJs = bodyLower.includes('please enable javascript') ||
				bodyLower.includes('javascript is required') ||
				bodyLower.includes('启用javascript') ||
				(result.body.length < 5000 && bodyLower.includes('<noscript>'));

			// 5. WAF/CDN blocking detection
			const isWafBlocked = bodyLower.includes('waf') ||
				bodyLower.includes('cloudflare') ||
				bodyLower.includes('access denied') ||
				bodyLower.includes('forbidden');

			// 6. WeChat specific validation page
			const isWeChatValidation = urlString.includes('mp.weixin.qq.com') &&
				(bodyLower.includes('验证') || bodyLower.includes('verify') ||
					bodyLower.includes('环境异常') || result.body.length < 10000);

			// 7. Sogou search specific blocking
			const isSogouBlocked = urlString.includes('sogou.com') &&
				(bodyLower.includes('antispider') || bodyLower.includes('请输入验证码'));

			const isBlocked = isHttpBlocked || hasCaptcha || isAntiSpider || needsJs || isWafBlocked || isWeChatValidation || isSogouBlocked;

			if (!isBlocked) {
				usedMethod = 'axios';
			}
		} catch (axiosError) {
			console.warn('[Fetch] ⚠️ Axios failed:', axiosError.message);
		}
	}

	// Strategy 3: Try Jina Reader as last resort
	if (usedMethod === 'none') {
		try {
			result = await fetchWithJina(urlString);
			usedMethod = 'jina';
		} catch (jinaError) {
			console.error('[Fetch] ❌ Jina Reader failed:', jinaError.message);
			throw new Error(`All fetch methods failed for URL: ${urlString}`);
		}
	}

	// Process Content
	let { body, headers, statusCode, isMarkdown } = result;
	const contentType = headers['content-type'] || '';

	// 确保 body 始终是字符串
	if (body === null || body === undefined) {
		body = '';
		console.warn('[Fetch] ⚠️ Body is null/undefined, using empty string');
	} else if (typeof body !== 'string') {
		try {
			body = typeof body === 'object' ? JSON.stringify(body, null, 2) : String(body);
		} catch (e) {
			body = '';
			console.error('[Fetch] ❌ Failed to convert body to string:', e.message);
		}
	}

	// 保存原始 HTML 用于链接提取
	const rawHtml = body;

	if (isMarkdown) {
		// Jina returns markdown, no processing needed
		console.log('[Fetch] ✅ Content is already Markdown (from Jina)');
	} else if (isJsonContent(body, contentType)) {
		try {
			body = JSON.stringify(JSON.parse(body), null, 2);
		} catch (e) { }
	} else if (isHtmlContent(body, contentType)) {
		const rawHtml = body; // Save original HTML for fallback
		const mainContent = extractMainContent(body, urlString);

		body = convertHtmlToMarkdown(mainContent);

		// Check if extracted content looks like navigation/menu instead of actual content
		const looksLikeNavigation = (() => {
			const langPatterns = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
				'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português', 'Русский', 'Tiếng Việt'];
			const langCount = langPatterns.filter(lang => body.includes(lang)).length;
			// If content has 3+ language names in the first 500 chars, it's likely a language menu
			const first500 = body.substring(0, 500);
			const langCountInFirst500 = langPatterns.filter(lang => first500.includes(lang)).length;
			return langCountInFirst500 >= 3;
		})();

		// UNIVERSAL FALLBACK: If smart extraction failed OR got navigation content
		if ((body.length < 200 || looksLikeNavigation) && cheerio) {
			try {
				const $ = cheerio.load(rawHtml);

				// Aggressively remove ALL navigation and non-content elements
				const removeAll = [
					'script', 'style', 'noscript', 'iframe', 'svg', 'link', 'meta', 'head',
					'nav', 'header', 'footer', 'aside', 'form',
					'[role="navigation"]', '[role="menu"]', '[role="menubar"]', '[role="banner"]',
					'[class*="nav"]', '[class*="menu"]', '[class*="toolbar"]', '[class*="header"]',
					'[class*="footer"]', '[class*="sidebar"]', '[class*="language"]', '[class*="locale"]'
				];
				$(removeAll.join(',')).remove();

				// Remove language selector lists
				const langPatterns = ['English', '日本語', '한국어', 'Deutsch', 'Français', 'Español',
					'简体中文', '繁體中文', 'Bahasa', 'Italiano', 'Português', 'Русский', 'Tiếng Việt'];
				$('ul, div, select').each((i, el) => {
					const $el = $(el);
					const text = $el.text().trim();
					const langCount = langPatterns.filter(lang => text.includes(lang)).length;
					if (langCount >= 3 && text.length < 500) {
						$el.remove();
					}
				});

				// Get title
				const title = $('title').text().trim() || $('h1').first().text().trim() || '';

				// Try to find the largest content block
				let bestContent = '';
				const contentCandidates = $('article, main, [role="main"], .content, #content, div[class*="content"], div[class*="doc"], div[class*="wiki"], div[class*="page"]');

				contentCandidates.each((i, el) => {
					const text = $(el).text().trim();
					// Skip if it looks like navigation
					const navCount = langPatterns.filter(lang => text.substring(0, 300).includes(lang)).length;
					if (navCount < 3 && text.length > bestContent.length) {
						bestContent = text;
					}
				});

				// If no good content container found, use body text
				if (bestContent.length < 200) {
					bestContent = $('body').text().trim();
				}

				// Clean up whitespace
				bestContent = bestContent.replace(/\s+/g, ' ').trim();
				// Break into paragraphs at sentence boundaries
				bestContent = bestContent.replace(/([。！？.!?])\s+/g, '$1\n\n');

				if (bestContent.length > 100) {
					body = title ? `# ${title}\n\n${bestContent}` : bestContent;
				}
			} catch (e) {
				console.warn('[Fetch] ⚠️ Universal text extraction failed:', e.message);
			}
		}

	}

	// Check if content extraction failed (body is too short or looks like error)
	if (body.length < 100) {
		console.warn(`[Fetch] ⚠️ Content seems too short (${body.length} chars), might have extraction issues`);
	}

	return { statusCode, headers, body, usedMethod, rawHtml };
}

/**
 * Extract links from HTML content
 * Filters links to same domain and relevant content pages
 */
function extractRelevantLinks(html, baseUrl) {
	if (!cheerio) return [];

	try {
		const $ = cheerio.load(html);
		const baseUrlObj = new URL(baseUrl);
		const baseDomain = baseUrlObj.hostname;
		const links = new Set();

		// Find all anchor tags
		$('a[href]').each((i, el) => {
			try {
				const href = $(el).attr('href');
				if (!href) return;

				// Skip anchors, javascript, mailto, tel links
				if (href.startsWith('#') || href.startsWith('javascript:') ||
					href.startsWith('mailto:') || href.startsWith('tel:')) {
					return;
				}

				// Resolve relative URLs
				let fullUrl;
				try {
					fullUrl = new URL(href, baseUrl).href;
				} catch (e) {
					return;
				}

				const urlObj = new URL(fullUrl);

				// Only same domain links
				if (urlObj.hostname !== baseDomain) return;

				// Skip common non-content patterns
				const skipPatterns = [
					'/login', '/signin', '/signup', '/register', '/auth',
					'/search', '/cart', '/checkout', '/account', '/profile',
					'/static/', '/assets/', '/images/', '/img/', '/css/', '/js/',
					'.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf',
					'.zip', '.rar', '.exe', '.dmg', '.mp3', '.mp4', '.avi',
					'/api/', '/feed', '/rss', '.xml', '/sitemap'
				];

				const pathLower = urlObj.pathname.toLowerCase();
				if (skipPatterns.some(p => pathLower.includes(p))) return;

				// Remove query parameters and fragments for deduplication
				urlObj.search = '';
				urlObj.hash = '';
				links.add(urlObj.href);
			} catch (e) { }
		});

		// Remove the base URL itself
		links.delete(baseUrl);
		links.delete(baseUrl + '/');

		return Array.from(links);
	} catch (e) {
		console.error('[Crawl] Error extracting links:', e.message);
		return [];
	}
}

/**
 * Crawl multiple pages starting from a base URL
 * Fetches main page + relevant linked pages for complete content
 */
async function crawlMultiplePages(baseUrl, options = {}) {
	const {
		maxPages = 5,           // Maximum number of pages to crawl
		maxDepth = 1,           // How deep to follow links (1 = only direct links)
		includeLinks = true,    // Whether to follow links
		timeout = 30000
	} = options;

	const visited = new Set();
	const results = [];
	const queue = [{ url: baseUrl, depth: 0 }];

	while (queue.length > 0 && results.length < maxPages) {
		const { url, depth } = queue.shift();

		// Skip if already visited
		if (visited.has(url)) continue;
		visited.add(url);

		try {
			const response = await fetchUrl(url, timeout);

			if (response.statusCode < 400 && response.body) {
				results.push({
					url,
					depth,
					content: response.body,
					statusCode: response.statusCode
				});

				// Extract and queue links if within depth limit
				if (includeLinks && depth < maxDepth && results.length < maxPages) {
					const rawHtml = response.rawHtml || response.body;
					const links = extractRelevantLinks(rawHtml, url);

					// Prioritize links that look like content pages
					const prioritizedLinks = links.sort((a, b) => {
						// Prefer longer paths (usually more specific content)
						const aPath = new URL(a).pathname;
						const bPath = new URL(b).pathname;
						return bPath.length - aPath.length;
					});

					// Add links to queue (limit to prevent explosion)
					const linksToAdd = prioritizedLinks.slice(0, Math.min(10, maxPages - results.length));
					for (const link of linksToAdd) {
						if (!visited.has(link)) {
							queue.push({ url: link, depth: depth + 1 });
						}
					}

				}
			}
		} catch (error) {
			console.warn(`[Crawl] Failed to fetch ${url}:`, error.message);
		}

		// Small delay between requests to be polite
		if (queue.length > 0) {
			await new Promise(r => setTimeout(r, 500));
		}
	}

	return results;
}

/**
 * Combine multiple page contents into a single document
 */
function combinePageContents(pages) {
	if (pages.length === 0) return '';
	if (pages.length === 1) return pages[0].content;

	let combined = '';

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		const separator = i === 0 ? '' : '\n\n---\n\n';
		const header = `## 📄 Page ${i + 1}: ${page.url}\n\n`;
		combined += separator + header + page.content;
	}

	// Add summary at the beginning
	const summary = `# 📚 Multi-Page Content (${pages.length} pages)\n\n` +
		`**Pages crawled:**\n` +
		pages.map((p, i) => `${i + 1}. ${p.url}`).join('\n') +
		'\n\n---\n\n';

	return summary + combined;
}

/**
 * Handle fetch request with pagination and optional multi-page crawling
 */
async function handleFetchRequest(url, maxLength = 5000, startIndex = 0, crawlOptions = null) {
	try {
		let response;
		let combinedContent = '';

		// If crawl options provided, do multi-page crawl
		if (crawlOptions && crawlOptions.crawlLinks) {
			const pages = await crawlMultiplePages(url, {
				maxPages: crawlOptions.maxPages || 5,
				maxDepth: crawlOptions.maxDepth || 1,
				includeLinks: true
			});

			combinedContent = combinePageContents(pages);
			response = {
				statusCode: 200,
				headers: {},
				body: combinedContent,
				pagesCrawled: pages.length
			};
		} else {
			response = await fetchUrl(url);
		}

		if (response.statusCode >= 400) {
			return {
				statusCode: response.statusCode,
				headers: response.headers,
				body: `HTTP Error: ${response.statusCode} (Method: ${response.usedMethod})`,
			};
		}

		// 确保 body 存在且是字符串
		if (!response.body || typeof response.body !== 'string') {
			response.body = '';
			console.warn('[Handler] ⚠️ Response body is empty or invalid');
		}

		const originalLength = response.body.length;

		if (startIndex >= originalLength) {
			return {
				statusCode: 200,
				headers: response.headers,
				body: '',
				contentLength: originalLength,
				hasMore: false,
				nextIndex: originalLength,
			};
		}

		const paginatedContent = response.body.substring(startIndex, startIndex + maxLength);
		const hasMore = (startIndex + maxLength) < originalLength;
		const nextIndex = startIndex + paginatedContent.length;

		return {
			statusCode: response.statusCode,
			headers: response.headers,
			body: paginatedContent,
			contentLength: originalLength,
			hasMore,
			nextIndex,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`[Handler] ❌ Error: ${errorMessage}`);
		return {
			statusCode: 500,
			headers: {},
			body: `[Error] ${errorMessage}`,
		};
	}
}

/**
 * Create and start HTTP server with dynamic port allocation
 * If the specified port is in use, automatically try the next available port
 */
function startServer(startPort = 3000) {
	const server = http.createServer(async (req, res) => {
		// Enable CORS
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		res.setHeader('Access-Control-Max-Age', '86400');

		if (req.method === 'OPTIONS') {
			res.writeHead(200, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Max-Age': '86400'
			});
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
			return;
		}

		let body = '';
		req.on('data', (chunk) => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				const params = JSON.parse(body);
				const {
					url,
					max_length = 5000,
					start_index = 0,
					// Multi-page crawling options
					crawl_links = false,      // Enable multi-page crawling
					max_pages = 5,            // Maximum pages to crawl
					max_depth = 1             // Depth of link following (1 = direct links only)
				} = params;

				if (!url) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'URL is required' }));
					return;
				}

				// Build crawl options if multi-page crawling is enabled
				const crawlOptions = crawl_links ? {
					crawlLinks: true,
					maxPages: Math.min(max_pages, 10),  // Cap at 10 pages for safety
					maxDepth: Math.min(max_depth, 2)    // Cap at depth 2
				} : null;

				const result = await handleFetchRequest(url, max_length, start_index, crawlOptions);

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: errorMessage }));
			}
		});
	});

	// Try to listen on the specified port, with automatic fallback to next available port
	let currentPort = startPort;
	const maxAttempts = 10; // Try up to 10 ports

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			console.error(`❌ Failed to find an available port after ${maxAttempts} attempts (ports ${startPort}-${currentPort})`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {
			// Store the actual port for reference
			server.actualPort = currentPort;
		});

		server.once('error', (error) => {
			if (error.code === 'EADDRINUSE') {
				currentPort++;
				// Remove all listeners to avoid multiple error handlers
				server.removeAllListeners('error');
				// Try next port
				tryListen(attempt + 1);
			} else {
				console.error(`❌ Server error: ${error.message}`);
				process.exit(1);
			}
		});
	};

	tryListen();
	return server;
}

// Start server
const port = process.argv[2] ? parseInt(process.argv[2]) : 3000;
startServer(port);
