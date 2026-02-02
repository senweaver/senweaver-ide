/**
 * Screenshot to Code Backend Server
 * 图片/URL 转代码服务
 *
 * 功能:
 * - 完全使用图片URL（不使用base64）
 * - source='image': 接收前端上传的图片URL
 * - source='url': 截取网页截图后上传获取URL
 * - 使用glm-4.6v-flash视觉模型分析图片
 * - 生成对应的代码（HTML+Tailwind, HTML+CSS, React+Tailwind, Vue+Tailwind等）
 * - 动态端口分配（3007起）
 * - apiKey从前端传入（ownProvider配置）
 *
 * 参考项目: screenshot-to-code, startVisionServer.cjs
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 从 product.json 加载 API 配置
let senweaverApiConfig = {
	apiBaseUrl: 'https://ide-api.senweaver.com',
	wsBaseUrl: 'wss://ide-api.senweaver.com',
	secretKey: ''
};

try {
	// 尝试加载 product.json
	const productJsonPath = path.resolve(__dirname, '../../../../../../product.json');
	if (fs.existsSync(productJsonPath)) {
		const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
		if (productJson.senweaverApiConfig) {
			senweaverApiConfig = { ...senweaverApiConfig, ...productJson.senweaverApiConfig };
		}
	}
} catch (e) {
	console.warn('[Screenshot2Code] Failed to load product.json config, using defaults');
}

// =============================================
// Configuration
// =============================================

// 自有API配置（与助手使用的模型一致）
const OWN_API_BASE_URL = 'https://api.newpoc.com/v1';
const VISION_MODEL = 'glm-4.6v-flash'; // 视觉理解模型
const SENWEAVER_UNIFIED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SenWeaver/1.0 Chrome/121.0.0.0 Safari/537.36';

// 默认端口
const DEFAULT_PORT = 3007;

// 支持的代码生成类型（Stack）
const STACKS = {
	'html_tailwind': 'HTML + Tailwind CSS',
	'html_css': 'HTML + CSS',
	'react_tailwind': 'React + Tailwind CSS',
	'vue_tailwind': 'Vue + Tailwind CSS',
	'ionic_tailwind': 'Ionic + Tailwind CSS',
	'bootstrap': 'HTML + Bootstrap',
	'svg': 'SVG'
};

// =============================================
// System Prompts - 100% Exact Clone, No Creativity
// =============================================

// Core requirement: exact clone of screenshot with full interactivity - Production-Ready Commercial Quality
const CLONE_REQUIREMENTS = `
## CORE PRINCIPLE - Production-Ready 100% Exact Clone
Create a 100% EXACT clone of the screenshot that is:
- FULLY FUNCTIONAL and INTERACTIVE
- PRODUCTION-READY for commercial use
- 100% COMPLETE pixel-perfect replication

Do NOT add any creative modifications. The code must be ready for immediate commercial deployment.

## MUST FOLLOW (MANDATORY)
1. EXACT CLONE: Include exactly what's in the screenshot - nothing more, nothing less
2. EXACT TEXT: Copy all text character-by-character - do NOT translate or modify
3. EXACT COLORS: Extract precise color values from the screenshot
4. EXACT LAYOUT: Replicate the exact layout structure
5. EXACT ELEMENTS: Include every icon, button, divider, badge visible
6. EXACT SPACING: Match padding, margin, gap precisely

## INTERACTIVITY REQUIREMENTS (CRITICAL)
The generated code MUST be a REAL, FUNCTIONAL interface for COMMERCIAL USE:
1. BUTTONS: All buttons must be clickable with hover effects, loading states, and click handlers
2. FORMS: All input fields must be editable with proper validation, error messages, and form submission
3. NAVIGATION: All links/menus must work correctly (use # for internal links if needed)
4. DROPDOWNS: All dropdown menus must open/close smoothly and be selectable
5. MODALS: Any modal/popup elements must be toggleable with backdrop and close button
6. TABS: Tab navigation must switch content with proper active states
7. ACCORDIONS: Expandable sections must expand/collapse with animations
8. HOVER STATES: Add professional hover effects to all interactive elements
9. FORM VALIDATION: Add complete client-side validation with error feedback
10. STATE MANAGEMENT: Use JavaScript/framework state for dynamic UI elements
11. ACCESSIBILITY: Include proper ARIA labels, focus states, keyboard navigation
12. ANIMATIONS: Add smooth CSS transitions for professional feel

## COMMERCIAL QUALITY STANDARDS
- Cross-browser compatible (Chrome, Firefox, Safari, Edge)
- Mobile responsive (works on all screen sizes)
- Fast loading (optimized assets)
- Semantic HTML5 structure
- SEO-friendly markup
- Accessibility compliant (WCAG 2.1)
- Clean, maintainable code structure
- Professional visual polish

## STRICTLY FORBIDDEN
- Do NOT create static/display-only interfaces
- Do NOT add elements not in the screenshot
- Do NOT modify any text content
- Do NOT "beautify" or "improve" the design
- Do NOT use placeholder comments like "<!-- more items -->"
- Do NOT omit any elements
- Do NOT leave buttons/forms non-functional
- Do NOT produce incomplete or partial code

## IMAGES
- Replace images with https://placehold.co/WIDTHxHEIGHT matching exact dimensions`;

const SYSTEM_PROMPTS = {
	html_tailwind: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using HTML + Tailwind CSS that is FULLY FUNCTIONAL and INTERACTIVE.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use Tailwind CSS for styling
- Use Font Awesome for icons
- Use vanilla JavaScript for interactivity
- Output a complete HTML file

## INTERACTIVITY IMPLEMENTATION
- Add onclick handlers for buttons
- Use JavaScript to toggle classes for dropdowns/modals
- Implement form validation with JavaScript
- Add event listeners for tab switching
- Use CSS transitions for smooth hover/toggle effects

## MUST INCLUDE
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	html_css: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using HTML + CSS that is FULLY FUNCTIONAL and INTERACTIVE.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use pure CSS in <style> tags
- Use Font Awesome for icons
- Use vanilla JavaScript for interactivity
- Output a complete HTML file

## INTERACTIVITY IMPLEMENTATION
- Add onclick handlers for buttons
- Use JavaScript to toggle classes for dropdowns/modals
- Implement form validation with JavaScript
- Add event listeners for tab switching
- Use CSS transitions for smooth hover/toggle effects

## MUST INCLUDE
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	react_tailwind: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using React + Tailwind CSS that is FULLY FUNCTIONAL and INTERACTIVE.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use React via CDN
- Use Tailwind CSS for styling
- Use Font Awesome for icons
- Use components and loops for repeating elements
- Use React hooks (useState, useEffect) for state management

## INTERACTIVITY IMPLEMENTATION
- Use useState for component state (modals, dropdowns, tabs, form data)
- Use onClick handlers for buttons and interactive elements
- Implement controlled form inputs with onChange
- Add form validation before submission
- Use conditional rendering for show/hide elements

## MUST INCLUDE
<script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	vue_tailwind: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using Vue + Tailwind CSS that is FULLY FUNCTIONAL and INTERACTIVE.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use Vue 3 via CDN
- Use Tailwind CSS for styling
- Use Font Awesome for icons
- Use v-for for repeating elements
- Use Vue reactive data for state management

## INTERACTIVITY IMPLEMENTATION
- Use ref() and reactive() for component state
- Use @click for button handlers
- Use v-model for form inputs (two-way binding)
- Use v-if/v-show for conditional rendering (modals, dropdowns)
- Implement form validation in methods
- Use computed properties where appropriate

## MUST INCLUDE
<script src="https://registry.npmmirror.com/vue/3.3.11/files/dist/vue.global.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	ionic_tailwind: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using Ionic + Tailwind CSS.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use Ionic components
- Use Tailwind CSS for styling
- Use ionicons for icons

## MUST INCLUDE
<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css">
<script src="https://cdn.tailwindcss.com"></script>

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	bootstrap: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot using Bootstrap that is FULLY FUNCTIONAL and INTERACTIVE.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Use Bootstrap 5
- Use Font Awesome for icons
- Use Bootstrap JavaScript components for interactivity

## INTERACTIVITY IMPLEMENTATION
- Use Bootstrap's built-in JS components (Modal, Dropdown, Collapse, Tab, etc.)
- Add data-bs-* attributes for Bootstrap interactivity
- Use JavaScript for custom interactions
- Implement form validation using Bootstrap's validation classes

## MUST INCLUDE
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

## OUTPUT FORMAT
Output ONLY the <html>...</html> code. No markdown code blocks. No explanations.`,

	svg: `You are a screenshot-to-code expert. Your task is to create a 100% exact clone of the screenshot as SVG.
${CLONE_REQUIREMENTS}

## TECHNICAL REQUIREMENTS
- Output pure SVG code
- Match shapes, colors, positions exactly

## OUTPUT FORMAT
Output ONLY the <svg>...</svg> code. No markdown code blocks. No explanations.`
};

// =============================================
// Utility Functions
// =============================================

/**
 * 上传图片到服务器并获取 URL
 * 使用原生方式构建 multipart/form-data，不依赖 form-data 包
 * @param {Buffer} imageBuffer - 图片 Buffer
 * @param {string} apiKey - API Key
 * @returns {Promise<string>} 图片 URL
 */
async function uploadImageAndGetUrl(imageBuffer, apiKey) {
	const fetch = (await import('node-fetch')).default;

	// 获取图片格式
	const validation = validateImageBuffer(imageBuffer);
	if (!validation.valid) {
		throw new Error(`Image validation failed: ${validation.reason}`);
	}

	// 使用原生方式构建 multipart/form-data
	const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
	const filename = `screenshot.${validation.format.toLowerCase()}`;
	const mimeType = validation.mimeType;

	// 构建请求体
	const header = Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
		`Content-Type: ${mimeType}\r\n\r\n`
	);
	const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
	const body = Buffer.concat([header, imageBuffer, footer]);

	// 上传到图片服务器
	const response = await fetch(`${senweaverApiConfig.apiBaseUrl}/v1/upload/image`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
			'Content-Length': body.length.toString()
		},
		body: body,
		timeout: 60000
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to upload image: ${response.status} - ${error}`);
	}

	const result = await response.json();
	if (!result.url) {
		throw new Error('Upload succeeded but no URL returned');
	}

	return result.url;
}

/**
 * 检查是否为有效的图片 URL
 */
function isImageUrl(str) {
	return str && (str.startsWith('http://') || str.startsWith('https://'));
}

/**
 * 验证图片 Buffer 是否有效（完全参考 VisionServer）
 */
function validateImageBuffer(buffer) {
	if (!buffer || buffer.length < 8) {
		return { valid: false, reason: 'Image data too small (< 8 bytes)' };
	}

	// PNG signature: 89 50 4E 47 0D 0A 1A 0A
	const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	// JPEG signature: FF D8 FF
	const jpegSignature = Buffer.from([0xFF, 0xD8, 0xFF]);
	// GIF signature: 47 49 46
	const gifSignature = Buffer.from([0x47, 0x49, 0x46]);
	// WebP signature: 52 49 46 46 (RIFF)
	const webpSignature = Buffer.from([0x52, 0x49, 0x46, 0x46]);

	// 检查文件头
	if (buffer.slice(0, 8).equals(pngSignature)) {
		return { valid: true, format: 'PNG', mimeType: 'image/png' };
	} else if (buffer.slice(0, 3).equals(jpegSignature)) {
		return { valid: true, format: 'JPEG', mimeType: 'image/jpeg' };
	} else if (buffer.slice(0, 3).equals(gifSignature)) {
		return { valid: true, format: 'GIF', mimeType: 'image/gif' };
	} else if (buffer.slice(0, 4).equals(webpSignature)) {
		return { valid: true, format: 'WebP', mimeType: 'image/webp' };
	}

	return {
		valid: false,
		reason: `Invalid image format (first 8 bytes: ${buffer.slice(0, 8).toString('hex')})`
	};
}

/**
 * 提取HTML内容
 */
function extractHtmlContent(text) {
	// 移除markdown代码块标记
	let content = text.replace(/```html\s*/gi, '').replace(/```\s*/g, '');

	// 尝试提取<html>标签内容
	const htmlMatch = content.match(/<html[\s\S]*<\/html>/i);
	if (htmlMatch) {
		return htmlMatch[0];
	}

	// 尝试提取<svg>标签内容
	const svgMatch = content.match(/<svg[\s\S]*<\/svg>/i);
	if (svgMatch) {
		return svgMatch[0];
	}

	// 如果没有找到完整的HTML/SVG，返回原始内容
	return content.trim();
}

// =============================================
// Optional Dependencies (爬虫功能)
// =============================================

let axios = null;
let cheerio = null;

try {
	axios = require('axios');
	cheerio = require('cheerio');
} catch (e) {
	console.warn('[Screenshot2Code] ⚠️ Crawler dependencies not available - source code extraction disabled');
}

// =============================================
// Screenshot Capture (for URL input)
// =============================================

let playwright = null;

// 尝试加载Playwright
try {
	playwright = require('playwright-core');
} catch (e) {
	try {
		playwright = require('playwright');
	} catch (e2) {
		console.warn('[Screenshot2Code] ⚠️ Playwright not available - URL screenshot disabled');
	}
}

// =============================================
// Page Source Crawler (参考 startCloneWebsiteServer.cjs 和 startFetchUrlServer.cjs)
// =============================================

/**
 * 获取网页源码和样式信息
 * @param {string} url - 网页URL
 * @returns {Object} 包含 HTML、CSS、颜色、布局等信息
 */
async function fetchPageSource(url) {
	if (!axios || !cheerio) {
		return null;
	}

	const startTime = Date.now();

	try {
		const response = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
			timeout: 30000,
			maxRedirects: 5,
			responseType: 'arraybuffer' // 支持各种编码
		});

		// 解码内容
		const contentType = response.headers['content-type'] || '';
		let html;
		try {
			// 尝试检测编码
			const charsetMatch = contentType.match(/charset=([^;\s]+)/i);
			if (charsetMatch && (charsetMatch[1].toLowerCase() === 'gbk' || charsetMatch[1].toLowerCase() === 'gb2312')) {
				const iconv = require('iconv-lite');
				html = iconv.decode(response.data, charsetMatch[1]);
			} else {
				html = response.data.toString('utf-8');
			}
		} catch (e) {
			html = response.data.toString('utf-8');
		}

		const $ = cheerio.load(html);

		// 提取关键信息
		const result = {
			url: url,
			title: $('title').text().trim(),
			meta: {
				description: $('meta[name="description"]').attr('content') || '',
				keywords: $('meta[name="keywords"]').attr('content') || '',
				viewport: $('meta[name="viewport"]').attr('content') || ''
			},
			// 提取内联样式中的颜色
			colors: extractColors($),
			// 提取字体
			fonts: extractFonts($),
			// 提取布局信息
			layout: {
				hasHeader: $('header').length > 0 || $('[class*="header"]').length > 0,
				hasFooter: $('footer').length > 0 || $('[class*="footer"]').length > 0,
				hasNav: $('nav').length > 0 || $('[class*="nav"]').length > 0,
				hasSidebar: $('aside').length > 0 || $('[class*="sidebar"]').length > 0
			},
			// 提取关键 CSS 类名
			cssClasses: extractCssClasses($),
			// 提取内联 CSS
			inlineStyles: extractInlineStyles($),
			// 提取外部 CSS 链接
			cssLinks: [],
			// 简化的 HTML 结构
			htmlStructure: extractHtmlStructure($),
			processingTime: `${Date.now() - startTime}ms`
		};

		// 提取外部 CSS 链接
		$('link[rel="stylesheet"]').each((i, el) => {
			const href = $(el).attr('href');
			if (href && result.cssLinks.length < 10) {
				result.cssLinks.push(href);
			}
		});

		return result;

	} catch (error) {
		console.warn(`[Screenshot2Code] Failed to fetch source: ${error.message}`);
		return null;
	}
}

/**
 * 提取颜色
 */
function extractColors($) {
	const colors = new Set();

	// 从 style 属性提取
	$('[style]').each((i, el) => {
		const style = $(el).attr('style') || '';
		// 匹配 hex 颜色
		const hexMatches = style.match(/#[0-9A-Fa-f]{3,6}/g);
		if (hexMatches) hexMatches.forEach(c => colors.add(c));
		// 匹配 rgb/rgba
		const rgbMatches = style.match(/rgba?\([^)]+\)/g);
		if (rgbMatches) rgbMatches.forEach(c => colors.add(c));
	});

	// 从 <style> 标签提取
	$('style').each((i, el) => {
		const css = $(el).html() || '';
		const hexMatches = css.match(/#[0-9A-Fa-f]{3,6}/g);
		if (hexMatches) hexMatches.forEach(c => colors.add(c));
		const rgbMatches = css.match(/rgba?\([^)]+\)/g);
		if (rgbMatches) rgbMatches.forEach(c => colors.add(c));
	});

	return Array.from(colors).slice(0, 20);
}

/**
 * 提取字体
 */
function extractFonts($) {
	const fonts = new Set();

	// 从 style 属性提取
	$('[style*="font-family"]').each((i, el) => {
		const style = $(el).attr('style') || '';
		const fontMatch = style.match(/font-family:\s*([^;]+)/i);
		if (fontMatch) fonts.add(fontMatch[1].trim());
	});

	// 从 <style> 标签提取
	$('style').each((i, el) => {
		const css = $(el).html() || '';
		const fontMatches = css.match(/font-family:\s*([^;{}]+)/gi);
		if (fontMatches) {
			fontMatches.forEach(m => {
				const value = m.replace(/font-family:\s*/i, '').trim();
				fonts.add(value);
			});
		}
	});

	// 从 Google Fonts 链接提取
	$('link[href*="fonts.googleapis.com"]').each((i, el) => {
		const href = $(el).attr('href') || '';
		const familyMatch = href.match(/family=([^&]+)/);
		if (familyMatch) fonts.add(familyMatch[1].replace(/\+/g, ' '));
	});

	return Array.from(fonts).slice(0, 10);
}

/**
 * 提取常用 CSS 类名
 */
function extractCssClasses($) {
	const classCount = {};

	$('[class]').each((i, el) => {
		const classes = ($(el).attr('class') || '').split(/\s+/).filter(c => c);
		classes.forEach(c => {
			// 过滤掉看起来是随机生成的类名
			if (c.length > 2 && c.length < 30 && !/^[a-z]{1,2}\d+$/i.test(c)) {
				classCount[c] = (classCount[c] || 0) + 1;
			}
		});
	});

	// 返回最常用的类名
	return Object.entries(classCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 30)
		.map(([name, count]) => ({ name, count }));
}

/**
 * 提取内联样式模式
 */
function extractInlineStyles($) {
	const styles = [];

	$('[style]').each((i, el) => {
		if (styles.length >= 20) return;
		const style = $(el).attr('style') || '';
		const tag = el.tagName?.toLowerCase() || 'div';
		if (style.length > 10 && style.length < 500) {
			styles.push({ tag, style: style.trim() });
		}
	});

	return styles;
}

/**
 * 提取简化的 HTML 结构
 */
function extractHtmlStructure($) {
	const structure = [];

	// 提取主要容器结构
	const mainSelectors = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer'];
	mainSelectors.forEach(selector => {
		$(selector).each((i, el) => {
			if (structure.length >= 15) return;
			const $el = $(el);
			const classes = $el.attr('class') || '';
			const id = $el.attr('id') || '';
			structure.push({
				tag: selector,
				id: id,
				classes: classes.split(/\s+/).filter(c => c).slice(0, 5).join(' '),
				childCount: $el.children().length
			});
		});
	});

	return structure;
}

// =============================================
// Multi-Page Crawling (多页面爬取)
// =============================================

/**
 * 规范化 URL
 */
function normalizeUrl(url) {
	try {
		const parsed = new URL(url);
		parsed.hash = '';
		let pathname = parsed.pathname;
		if (pathname.endsWith('/') && pathname !== '/') {
			pathname = pathname.slice(0, -1);
		}
		parsed.pathname = pathname;
		return parsed.href;
	} catch {
		return url;
	}
}

/**
 * 检查是否同域名
 */
function isSameDomain(url1, url2) {
	try {
		const domain1 = new URL(url1).hostname;
		const domain2 = new URL(url2).hostname;
		return domain1 === domain2;
	} catch {
		return false;
	}
}

/**
 * 检查是否为有效的页面 URL（排除资源文件）
 */
function isValidPageUrl(url) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

		// 排除资源文件
		const excludeExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
			'.css', '.js', '.pdf', '.zip', '.rar', '.mp3', '.mp4', '.avi', '.mov',
			'.woff', '.woff2', '.ttf', '.eot', '.otf'];
		const pathname = parsed.pathname.toLowerCase();
		for (const ext of excludeExtensions) {
			if (pathname.endsWith(ext)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * 从页面中提取导航链接
 * @param {string} html - 页面 HTML
 * @param {string} baseUrl - 基础 URL
 * @returns {Array<{url: string, text: string, type: string}>} 链接数组
 */
function extractPageLinks(html, baseUrl) {
	if (!cheerio) return [];

	const $ = cheerio.load(html);
	const links = new Map(); // 用 Map 去重，保留链接信息

	// 优先提取导航栏中的链接
	const navSelectors = ['nav a', 'header a', '[class*="nav"] a', '[class*="menu"] a',
		'[role="navigation"] a', '.navbar a', '#navbar a', '.header a'];

	navSelectors.forEach(selector => {
		$(selector).each((i, el) => {
			const href = $(el).attr('href');
			const text = $(el).text().trim();
			if (href && !href.startsWith('#') && !href.startsWith('mailto:') &&
				!href.startsWith('tel:') && !href.startsWith('javascript:')) {
				try {
					const absoluteUrl = new URL(href, baseUrl).href;
					const normalizedUrl = normalizeUrl(absoluteUrl);
					if (isValidPageUrl(normalizedUrl) && isSameDomain(normalizedUrl, baseUrl)) {
						if (!links.has(normalizedUrl)) {
							links.set(normalizedUrl, { url: normalizedUrl, text: text || 'Unknown', type: 'navigation' });
						}
					}
				} catch { }
			}
		});
	});

	// 提取主要按钮链接（登录、注册等）
	const buttonSelectors = ['a[class*="btn"]', 'a[class*="button"]', 'a[class*="login"]',
		'a[class*="signup"]', 'a[class*="register"]', 'a[class*="signin"]'];

	buttonSelectors.forEach(selector => {
		$(selector).each((i, el) => {
			const href = $(el).attr('href');
			const text = $(el).text().trim();
			if (href && !href.startsWith('#') && !href.startsWith('mailto:')) {
				try {
					const absoluteUrl = new URL(href, baseUrl).href;
					const normalizedUrl = normalizeUrl(absoluteUrl);
					if (isValidPageUrl(normalizedUrl) && isSameDomain(normalizedUrl, baseUrl)) {
						if (!links.has(normalizedUrl)) {
							links.set(normalizedUrl, { url: normalizedUrl, text: text || 'Button', type: 'button' });
						}
					}
				} catch { }
			}
		});
	});

	return Array.from(links.values());
}

/**
 * 获取页面的导航链接信息（不生成代码，仅提取链接）
 * @param {string} url - 页面 URL
 * @returns {Object} 包含链接信息的对象
 */
async function getPageNavigationInfo(url) {
	if (!axios || !cheerio) {
		return { links: [], error: 'Crawler not available' };
	}

	try {
		const response = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
			timeout: 30000,
			maxRedirects: 5,
			responseType: 'arraybuffer'
		});

		// 解码内容
		const contentType = response.headers['content-type'] || '';
		let html;
		try {
			const charsetMatch = contentType.match(/charset=([^;\s]+)/i);
			if (charsetMatch && (charsetMatch[1].toLowerCase() === 'gbk' || charsetMatch[1].toLowerCase() === 'gb2312')) {
				const iconv = require('iconv-lite');
				html = iconv.decode(response.data, charsetMatch[1]);
			} else {
				html = response.data.toString('utf-8');
			}
		} catch (e) {
			html = response.data.toString('utf-8');
		}

		const $ = cheerio.load(html);
		const title = $('title').text().trim();
		const links = extractPageLinks(html, url);


		return {
			success: true,
			title,
			url,
			links,
			totalLinks: links.length
		};

	} catch (error) {
		console.warn(`[Screenshot2Code] Failed to extract navigation: ${error.message}`);
		return { links: [], error: error.message };
	}
}

/**
 * 获取系统浏览器路径
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
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
		);
	} else {
		commonPaths.push(
			'/usr/bin/google-chrome',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser'
		);
	}

	for (const p of commonPaths) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}

/**
 * 滚动页面以加载所有懒加载内容
 * 完全参考 startOpenBrowserServer.cjs 中经过测试成功的实现
 */
async function scrollToLoadAll(page) {
	// First, scroll using Playwright's built-in method (more reliable)
	let previousHeight = 0;
	let currentHeight = await page.evaluate(() => document.body.scrollHeight);
	let attempts = 0;
	const maxAttempts = 20;

	// Keep scrolling until no new content loads
	while (attempts < maxAttempts) {
		// Scroll to bottom using keyboard (triggers more lazy loaders)
		await page.keyboard.press('End');
		await new Promise(r => setTimeout(r, 500));

		// Also use mouse wheel scroll
		await page.mouse.wheel(0, 3000);
		await new Promise(r => setTimeout(r, 500));

		// Check new height
		const newHeight = await page.evaluate(() => {
			return Math.max(
				document.body.scrollHeight,
				document.documentElement.scrollHeight
			);
		});

		if (newHeight === currentHeight && newHeight === previousHeight) {
			// Height hasn't changed for 2 iterations, probably done
			break;
		}

		previousHeight = currentHeight;
		currentHeight = newHeight;
		attempts++;
	}

	// Do a complete scroll from top to bottom to ensure everything is loaded
	await page.evaluate(async () => {
		const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
		const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
		const step = window.innerHeight;

		for (let y = 0; y <= totalHeight; y += step) {
			window.scrollTo(0, y);
			await delay(150);
		}

		// Scroll to absolute bottom
		window.scrollTo(0, totalHeight);
		await delay(300);
	});

	// Final height check
	const finalHeight = await page.evaluate(() => {
		return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
	});

	// Scroll back to top
	await page.evaluate(() => window.scrollTo(0, 0));
	await new Promise(r => setTimeout(r, 300));
}

/**
 * 截取URL的截图（完整页面）
 */
async function captureUrlScreenshot(url) {
	if (!playwright) {
		throw new Error('Playwright not available. Please install playwright-core.');
	}

	let browser = null;
	try {
		const launchOptions = {
			headless: true,
			timeout: 30000,
			args: [
				'--disable-blink-features=AutomationControlled',
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu'
			]
		};

		// 优先使用系统浏览器
		const systemBrowserPath = getSystemBrowserPath();
		if (systemBrowserPath) {
			browser = await playwright.chromium.launch({
				...launchOptions,
				executablePath: systemBrowserPath
			});
		} else {
			browser = await playwright.chromium.launch(launchOptions);
		}

		// 使用较小的视口以减少图片大小，加快 API 处理速度
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
			deviceScaleFactor: 1
		});

		const page = await context.newPage();

		// 导航到页面
		await page.goto(url, {
			waitUntil: 'networkidle',
			timeout: 30000
		}).catch(async () => {
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: 15000
			});
		});

		// 等待初始渲染
		await page.waitForTimeout(1000);

		// 滚动加载所有懒加载内容（完全参考 startOpenBrowserServer.cjs）
		await scrollToLoadAll(page);

		// 获取完整页面尺寸（完全参考 startOpenBrowserServer.cjs）
		const dimensions = await page.evaluate(() => {
			return {
				width: Math.max(
					document.body.scrollWidth,
					document.documentElement.scrollWidth,
					document.body.offsetWidth,
					document.documentElement.offsetWidth,
					document.body.clientWidth,
					document.documentElement.clientWidth
				),
				height: Math.max(
					document.body.scrollHeight,
					document.documentElement.scrollHeight,
					document.body.offsetHeight,
					document.documentElement.offsetHeight,
					document.body.clientHeight,
					document.documentElement.clientHeight
				)
			};
		});

		// 设置视口为完整页面大小（有合理上限以控制图片大小）
		const maxHeight = 8000;  // 限制高度以控制图片大小
		const maxWidth = 1920;   // 限制宽度以控制图片大小
		const viewportHeight = Math.min(dimensions.height, maxHeight);
		const viewportWidth = Math.min(Math.max(dimensions.width, 1280), maxWidth);

		await page.setViewportSize({
			width: viewportWidth,
			height: viewportHeight
		});

		// Wait for any reflow
		await new Promise(r => setTimeout(r, 500));

		// 截取完整页面
		const screenshotBuffer = await page.screenshot({
			type: 'jpeg',  // 使用 JPEG 格式减小文件大小
			quality: 80,   // 80% 质量足够用于代码生成
			fullPage: true
		});

		// Reset viewport after screenshot
		await page.setViewportSize({ width: 1280, height: 800 });

		await browser.close();

		const base64 = screenshotBuffer.toString('base64');
		const imageSizeKB = Math.round(base64.length * 0.75 / 1024);  // Base64 overhead

		return `data:image/jpeg;base64,${base64}`;

	} catch (error) {
		if (browser) await browser.close();
		throw error;
	}
}

// =============================================
// 智谱 AI API 调用
// =============================================

/**
 * 调用视觉模型 API（使用自有API，从前端传入apiKey）
 * 完全使用图片 URL，不使用 base64（参考 startVisionServer.cjs）
 * @param {string} imageUrl - 图片 URL（http/https 开头）
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userPrompt - 用户提示词
 * @param {string} apiKey - ownProvider的apiKey（从前端传入）
 */
async function callVisionAPI(imageUrl, systemPrompt, userPrompt, apiKey) {
	if (!apiKey) {
		throw new Error('API Key is required. Please ensure ownProvider is configured.');
	}

	if (!imageUrl) {
		throw new Error('Image URL is required.');
	}

	// 验证是否为有效的图片 URL
	if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
		throw new Error('请提供图片URL。图片应由前端上传后传递URL给后端。');
	}

	const fetch = (await import('node-fetch')).default;

	// 超时控制：300 秒
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 300000);

	try {
		const response = await fetch(`${OWN_API_BASE_URL}/chat/completions`, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'User-Agent': SENWEAVER_UNIFIED_UA,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: VISION_MODEL,
				messages: [
					{
						role: 'system',
						content: systemPrompt
					},
					{
						role: 'user',
						content: [
							{
								type: 'image_url',
								image_url: {
									url: imageUrl
								}
							},
							{
								type: 'text',
								text: userPrompt
							}
						]
					}
				],
				temperature: 0.1,  // 低温度确保稳定输出
				max_tokens: 4096  // 视觉模型 token 限制
			})
		});
		clearTimeout(timeout);

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Vision API 错误: ${response.status} - ${error}`);
		}

		const result = await response.json();

		// 处理智谱返回格式
		let content = '';
		if (result.choices && result.choices[0]) {
			content = result.choices[0].message?.content || '';
		}

		return {
			content: content,
			model: VISION_MODEL,
			usage: result.usage
		};
	} catch (error) {
		clearTimeout(timeout);
		if (error.name === 'AbortError') {
			throw new Error('API 请求超时 (> 300s)，复杂页面生成需要较长时间。');
		}
		throw error;
	}
}

/**
 * 格式化页面源码信息为 prompt 补充
 * @param {Object} pageSource - 爬取的页面源码信息
 * @returns {string} 格式化的源码信息
 */
function formatPageSourceForPrompt(pageSource) {
	if (!pageSource) return '';

	const parts = [];

	parts.push('\n\n---\n## Reference Data (extracted from original page, use screenshot as primary source):');

	if (pageSource.colors && pageSource.colors.length > 0) {
		parts.push(`Colors: ${pageSource.colors.join(', ')}`);
	}

	if (pageSource.fonts && pageSource.fonts.length > 0) {
		parts.push(`Fonts: ${pageSource.fonts.join(', ')}`);
	}

	if (pageSource.layout) {
		const layoutParts = [];
		if (pageSource.layout.hasHeader) layoutParts.push('header');
		if (pageSource.layout.hasNav) layoutParts.push('nav');
		if (pageSource.layout.hasSidebar) layoutParts.push('sidebar');
		if (pageSource.layout.hasFooter) layoutParts.push('footer');
		if (layoutParts.length > 0) {
			parts.push(`Layout: ${layoutParts.join(', ')}`);
		}
	}

	return parts.join('\n');
}

/**
 * 使用视觉 AI 生成代码（完全使用图片 URL）
 * @param {string} imageUrl - 图片 URL（http/https 开头）
 * @param {string} stack - 代码类型
 * @param {string} customPrompt - 自定义提示词
 * @param {Object} pageSource - 爬取的页面源码信息（可选）
 * @param {string} apiKey - ownProvider的apiKey（从前端传入）
 */
async function generateCodeFromImage(imageUrl, stack, customPrompt = '', pageSource = null, apiKey = null) {
	const systemPrompt = SYSTEM_PROMPTS[stack];
	if (!systemPrompt) {
		throw new Error(`Unsupported stack: ${stack}. Supported: ${Object.keys(SYSTEM_PROMPTS).join(', ')}`);
	}

	// User prompt - 100% exact clone with full interactivity
	let defaultPrompt = stack === 'svg'
		? `Create a 100% exact clone of this screenshot as SVG code. Do NOT add any creative modifications.`
		: `Create a 100% exact clone of this screenshot as complete, FULLY FUNCTIONAL and INTERACTIVE HTML code.

Requirements:
1. Include exactly what's in the screenshot - nothing more, nothing less
2. Copy all text exactly - do NOT translate or modify
3. Match colors, layout, spacing exactly
4. Include every element - do NOT omit anything
5. Replace images with https://placehold.co/WIDTHxHEIGHT

CRITICAL - INTERACTIVITY:
- ALL buttons must be clickable with proper click handlers
- ALL forms must be functional with input validation
- ALL dropdowns/menus must open and close
- ALL tabs must switch content
- ALL modals must be toggleable
- Add hover effects to interactive elements
- This must be a REAL working interface, NOT just a visual display`;

	// Add source data as reference if available
	if (pageSource) {
		defaultPrompt += formatPageSourceForPrompt(pageSource);
	}

	const userPrompt = customPrompt || defaultPrompt;

	const startTime = Date.now();

	// 调用视觉 AI 模型（使用自有API，完全使用图片 URL）
	const result = await callVisionAPI(imageUrl, systemPrompt, userPrompt, apiKey);

	// 提取HTML代码
	const code = extractHtmlContent(result.content);

	return {
		success: true,
		code: code,
		stack: stack,
		model: result.model,
		usage: result.usage,
		processingTime: `${Date.now() - startTime}ms`,
		hasSourceContext: !!pageSource
	};
}

// =============================================
// Main Handler
// =============================================

/**
 * 主处理函数（完全使用图片 URL，不使用 base64）
 * @param {Object} params - 请求参数
 * @param {string} params.source - 图片来源: 'image' (图片URL) 或 'url' (网页URL截图)
 * @param {string} params.imageData - 图片URL (当source='image'时，必须是http/https开头的URL)
 * @param {string} params.url - 网页URL地址 (当source='url'时，截取网页截图后上传获取URL)
 * @param {string} params.stack - 代码类型: 'html_tailwind', 'html_css', 'react_tailwind', 'vue_tailwind', 'bootstrap', 'svg'
 * @param {string} params.customPrompt - 自定义提示词（可选）
 * @param {boolean} params.fetchSource - 是否获取页面源码（默认 true，仅 URL 模式有效）
 * @param {boolean} params.extractNavigation - 是否提取导航链接用于多页面爬取（默认 true）
 * @param {string} params.apiKey - ownProvider的apiKey（从前端传入）
 */
async function handleScreenshotToCode(params) {
	const { source, imageData, url, stack = 'html_tailwind', customPrompt, fetchSource = true, extractNavigation = true, apiKey } = params;

	// 验证参数
	if (!apiKey) {
		throw new Error('Missing required parameter: apiKey. Please ensure ownProvider is configured.');
	}

	if (!source) {
		throw new Error('Missing required parameter: source (should be "image" or "url")');
	}

	if (!SYSTEM_PROMPTS[stack]) {
		throw new Error(`Unsupported stack: ${stack}. Supported: ${Object.keys(SYSTEM_PROMPTS).join(', ')}`);
	}

	let imageUrl; // 图片 URL（http/https 开头）
	let pageSource = null; // 页面源码信息

	// 处理不同的输入源
	if (source === 'url') {
		if (!url) {
			throw new Error('Missing required parameter: url');
		}

		// 检查 Playwright 是否可用
		if (!playwright) {
			throw new Error('URL mode requires Playwright, but it is not available. Please install playwright-core or playwright.');
		}

		// 并行获取截图和源码，提高效率
		const [screenshotResult, sourceResult] = await Promise.allSettled([
			captureUrlScreenshot(url),
			fetchSource ? fetchPageSource(url) : Promise.resolve(null)
		]);

		// 处理截图结果
		if (screenshotResult.status === 'rejected') {
			throw new Error(`Screenshot failed: ${screenshotResult.reason?.message || 'Unknown error'}`);
		}

		// 获取截图的 data URI，然后上传获取 URL
		const dataUri = screenshotResult.value;
		// 从 data URI 提取 buffer
		const base64Data = dataUri.replace(/^data:image\/\w+;base64,/, '');
		const imageBuffer = Buffer.from(base64Data, 'base64');

		// 上传截图获取 URL
		imageUrl = await uploadImageAndGetUrl(imageBuffer, apiKey);

		// 处理源码结果（可选，失败不影响主流程）
		if (sourceResult.status === 'fulfilled' && sourceResult.value) {
			pageSource = sourceResult.value;
		}

	} else if (source === 'image') {
		if (!imageData) {
			throw new Error('Missing required parameter: imageData');
		}

		// 支持单个 URL 或 URL 数组（取第一个）
		const firstImageData = Array.isArray(imageData) ? imageData[0] : imageData;

		// 必须是图片 URL（http/https 开头）
		if (!isImageUrl(firstImageData)) {
			throw new Error('imageData must be a valid image URL (http:// or https://). Base64 data is no longer supported.');
		}

		imageUrl = firstImageData;
		// 图片模式无法获取源码
		pageSource = null;
	} else {
		throw new Error(`Invalid source: ${source}. Should be "image" or "url"`);
	}

	// 生成代码（传入图片 URL、可选的源码信息和 apiKey）
	const result = await generateCodeFromImage(imageUrl, stack, customPrompt, pageSource, apiKey);

	// 添加源码信息到结果
	if (pageSource) {
		result.sourceExtracted = {
			colors: pageSource.colors?.length || 0,
			fonts: pageSource.fonts?.length || 0,
			layout: pageSource.layout,
			cssClasses: pageSource.cssClasses?.length || 0
		};
	}

	// 提取导航链接用于多页面爬取（仅 URL 模式）
	if (source === 'url' && extractNavigation) {
		try {
			const navInfo = await getPageNavigationInfo(url);
			if (navInfo.success && navInfo.links && navInfo.links.length > 0) {
				result.navigation = {
					pageTitle: navInfo.title,
					pageUrl: url,
					linkedPages: navInfo.links.map(link => ({
						url: link.url,
						text: link.text,
						type: link.type
					})),
					totalLinkedPages: navInfo.links.length
				};
			}
		} catch (navError) {
			console.warn(`[Screenshot2Code] ⚠️ Navigation extraction failed: ${navError.message}`);
		}
	}


	return result;
}

// =============================================
// HTTP Server
// =============================================

function createServer(port = DEFAULT_PORT) {
	const server = http.createServer(async (req, res) => {
		// CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(200);
			res.end();
			return;
		}

		// Health check
		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				status: 'ok',
				service: 'screenshot-to-code',
				model: VISION_MODEL,
				api: OWN_API_BASE_URL,
				supportedStacks: Object.keys(STACKS),
				features: {
					playwright: !!playwright,
					crawler: !!(axios && cheerio)
				}
			}));
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
			return;
		}

		// 解析请求体
		let body = '';
		req.on('data', chunk => body += chunk.toString());

		req.on('end', async () => {
			try {
				const params = JSON.parse(body);
				const result = await handleScreenshotToCode(params);

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));

			} catch (error) {
				console.error('[Screenshot2Code] Error:', error.message);
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					success: false,
					error: error.message
				}));
			}
		});

		req.on('error', (error) => {
			console.error('[Screenshot2Code] Request error:', error);
			try {
				if (!res.headersSent) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						success: false,
						error: 'Request processing error'
					}));
				}
			} catch (e) {
				console.error('[Screenshot2Code] Failed to send error response:', e);
			}
		});
	});

	// 动态端口分配
	let currentPort = port;
	const maxAttempts = 10;

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			console.error(`[Screenshot2Code] ❌ Failed to find available port after ${maxAttempts} attempts`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {

			// 输出端口号供父进程读取
			console.log(`SCREENSHOT_TO_CODE_PORT=${currentPort}`);
		});

		server.once('error', (error) => {
			if (error.code === 'EADDRINUSE') {
				currentPort++;
				server.removeAllListeners('error');
				tryListen(attempt + 1);
			} else {
				console.error(`[Screenshot2Code] Server error: ${error.message}`);
				process.exit(1);
			}
		});
	};

	tryListen();
	return server;
}

// 全局错误处理
process.on('uncaughtException', (error) => {
	console.error('[Screenshot2Code] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('[Screenshot2Code] Unhandled Rejection:', reason);
});

// 进程退出处理
process.on('SIGTERM', () => {
	process.exit(0);
});

process.on('SIGINT', () => {
	process.exit(0);
});

// 启动服务器
const port = process.argv[2] ? parseInt(process.argv[2]) : DEFAULT_PORT;
createServer(port);
