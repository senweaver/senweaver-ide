/**
 * Open Browser Backend Server
 * A commercial-grade browser automation service with Playwright
 * Inspired by Skyvern's browser automation capabilities
 *
 * Features:
 * - Persistent browser sessions
 * - Click, type, scroll actions
 * - Screenshot capture
 * - Element detection
 * - Anti-detection measures
 * - Download handling
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Server configuration
const DEFAULT_PORT = 3006;
const MAX_SESSIONS = 10;

// Browser sessions storage
const browserSessions = new Map();

// Random User Agents for anti-detection
const USER_AGENTS = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function getRandomUserAgent() {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Load Playwright
let playwright = null;
try {
	playwright = require('playwright-core');
} catch (e) {
	try {
		playwright = require('playwright');
	} catch (e2) {
		console.warn('[Browser] ⚠️ Playwright not available');
	}
}

/**
 * Get system browser path (Chrome/Edge)
 */
function getSystemBrowserPath() {
	const platform = process.platform;
	const possiblePaths = [];

	if (platform === 'win32') {
		possiblePaths.push(
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
			path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
			path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
		);
	} else if (platform === 'darwin') {
		possiblePaths.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/Applications/Chromium.app/Contents/MacOS/Chromium'
		);
	} else {
		possiblePaths.push(
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
			'/snap/bin/chromium',
			'/usr/bin/microsoft-edge'
		);
	}

	for (const browserPath of possiblePaths) {
		try {
			if (fs.existsSync(browserPath)) {
				return browserPath;
			}
		} catch (e) { }
	}
	return null;
}

/**
 * Browser Session Class
 * Manages a persistent browser session with all automation capabilities
 */
class BrowserSession {
	constructor(sessionId) {
		this.sessionId = sessionId;
		this.browser = null;
		this.context = null;
		this.page = null;
		this.createdAt = Date.now();
		this.lastActivity = Date.now();
		this.downloadDir = path.join(os.tmpdir(), `browser_downloads_${sessionId}`);
		this.networkRequests = [];
		this.consoleMessages = [];
		this.networkRecording = true;
	}

	async initialize(options = {}) {
		if (!playwright) {
			throw new Error('Playwright not available');
		}

		// Create download directory
		if (!fs.existsSync(this.downloadDir)) {
			fs.mkdirSync(this.downloadDir, { recursive: true });
		}

		const launchOptions = {
			headless: options.headless !== false,
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
				'--start-maximized',
				'--disable-extensions',
				'--disable-background-networking',
				'--disable-sync',
				'--disable-translate',
				'--metrics-recording-only',
				'--mute-audio',
				'--no-default-browser-check',
				'--disable-web-security',
				'--disable-features=IsolateOrigins,site-per-process',
				// 禁用 ServiceWorker 以避免 webview 环境中的错误
				'--disable-features=ServiceWorker',
				'--disable-service-worker',
				'--disable-notifications',
				'--disable-background-timer-throttling',
				'--disable-backgrounding-occluded-windows',
				'--disable-renderer-backgrounding'
			],
			ignoreDefaultArgs: ['--enable-automation']
		};

		// Try system browser first
		const systemBrowserPath = getSystemBrowserPath();
		if (systemBrowserPath) {
			try {
				this.browser = await playwright.chromium.launch({
					...launchOptions,
					executablePath: systemBrowserPath
				});
			} catch (e) {
				console.warn(`[Browser] System browser failed: ${e.message}`);
			}
		}

		// Fallback to bundled browser
		if (!this.browser) {
			this.browser = await playwright.chromium.launch(launchOptions);
		}

		// Create context with anti-detection
		this.context = await this.browser.newContext({
			userAgent: getRandomUserAgent(),
			viewport: { width: 1920, height: 1080 },
			deviceScaleFactor: 1,
			isMobile: false,
			hasTouch: false,
			ignoreHTTPSErrors: true,
			acceptDownloads: true
		});

		// Anti-detection scripts
		await this.context.addInitScript(() => {
			// Hide webdriver
			Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

			// Mock plugins
			Object.defineProperty(navigator, 'plugins', {
				get: () => [1, 2, 3, 4, 5]
			});

			// Mock languages
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en', 'zh-CN']
			});

			// Mock permissions
			const originalQuery = window.navigator.permissions.query;
			window.navigator.permissions.query = (parameters) => (
				parameters.name === 'notifications' ?
					Promise.resolve({ state: Notification.permission }) :
					originalQuery(parameters)
			);
		});

		this.page = await this.context.newPage();

		// Handle downloads
		this.page.on('download', async (download) => {
			const filePath = path.join(this.downloadDir, download.suggestedFilename());
			await download.saveAs(filePath);
		});

		// Handle console messages
		this.page.on('console', msg => {
			const type = msg.type();
			this.consoleMessages.push({
				level: type === 'warning' ? 'warn' : type,
				message: msg.text(),
				time: new Date().toISOString()
			});
			// Keep only last 500 messages
			if (this.consoleMessages.length > 500) {
				this.consoleMessages = this.consoleMessages.slice(-500);
			}
		});

		// Handle network requests
		this.page.on('request', request => {
			if (!this.networkRecording) return;
			const requestData = {
				id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
				url: request.url(),
				method: request.method(),
				type: request.resourceType(),
				startTime: Date.now(),
				status: null,
				size: null,
				time: null
			};
			this.networkRequests.push(requestData);
			// Keep only last 500 requests
			if (this.networkRequests.length > 500) {
				this.networkRequests = this.networkRequests.slice(-500);
			}
		});

		this.page.on('response', response => {
			if (!this.networkRecording) return;
			const url = response.url();
			const request = this.networkRequests.find(r => r.url === url && r.status === null);
			if (request) {
				request.status = response.status();
				request.time = Date.now() - request.startTime;
				response.body().then(buffer => {
					request.size = buffer.length;
				}).catch(() => { });
			}
		});

		return this;
	}

	async navigate(url) {
		this.lastActivity = Date.now();

		const response = await this.page.goto(url, {
			waitUntil: 'networkidle',
			timeout: 60000
		}).catch(async () => {
			return await this.page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: 30000
			});
		});

		// Wait for content
		await this.page.waitForTimeout(2000);

		return {
			url: this.page.url(),
			title: await this.page.title(),
			status: response ? response.status() : 200
		};
	}

	async click(selector, options = {}) {
		this.lastActivity = Date.now();

		try {
			await this.page.click(selector, {
				timeout: options.timeout || 10000,
				button: options.button || 'left',
				clickCount: options.clickCount || 1
			});
			return { success: true };
		} catch (e) {
			// Try by text content
			try {
				await this.page.getByText(selector).click({ timeout: 5000 });
				return { success: true };
			} catch (e2) {
				throw new Error(`Failed to click: ${e.message}`);
			}
		}
	}

	async type(selector, text, options = {}) {
		this.lastActivity = Date.now();

		try {
			await this.page.fill(selector, text, { timeout: options.timeout || 10000 });
			return { success: true };
		} catch (e) {
			// Try click first then type
			try {
				await this.page.click(selector, { timeout: 5000 });
				await this.page.keyboard.type(text, { delay: options.delay || 50 });
				return { success: true };
			} catch (e2) {
				throw new Error(`Failed to type: ${e.message}`);
			}
		}
	}

	async scroll(options = {}) {
		this.lastActivity = Date.now();
		const { direction = 'down', amount = 500 } = options;

		await this.page.evaluate(({ direction, amount }) => {
			if (direction === 'down') {
				window.scrollBy(0, amount);
			} else if (direction === 'up') {
				window.scrollBy(0, -amount);
			} else if (direction === 'left') {
				window.scrollBy(-amount, 0);
			} else if (direction === 'right') {
				window.scrollBy(amount, 0);
			}
		}, { direction, amount });

		return { success: true };
	}

	async screenshot(options = {}) {
		this.lastActivity = Date.now();

		// If fullPage, scroll through entire page to trigger lazy loading
		if (options.fullPage) {
			await this.scrollToLoadAll();

			// Get the full page dimensions
			const dimensions = await this.page.evaluate(() => {
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

			// Set viewport to full page size (with reasonable max)
			const maxHeight = 32000;  // Chromium limit is around 16384, but we try higher
			const viewportHeight = Math.min(dimensions.height, maxHeight);
			const viewportWidth = Math.max(dimensions.width, 1920);

			await this.page.setViewportSize({
				width: viewportWidth,
				height: viewportHeight
			});

			// Wait for any reflow
			await new Promise(r => setTimeout(r, 500));
		}

		const screenshotOptions = {
			type: 'png',
			fullPage: options.fullPage || false
		};

		if (options.selector) {
			const element = await this.page.$(options.selector);
			if (element) {
				return await element.screenshot(screenshotOptions);
			}
		}

		const screenshot = await this.page.screenshot(screenshotOptions);

		// Reset viewport after screenshot
		if (options.fullPage) {
			await this.page.setViewportSize({ width: 1920, height: 1080 });
		}

		return screenshot;
	}

	// Scroll through entire page to load all lazy-loaded content
	async scrollToLoadAll() {
		// First, scroll using Playwright's built-in method (more reliable)
		let previousHeight = 0;
		let currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
		let attempts = 0;
		const maxAttempts = 20;

		// Keep scrolling until no new content loads
		while (attempts < maxAttempts) {
			// Scroll to bottom using keyboard (triggers more lazy loaders)
			await this.page.keyboard.press('End');
			await new Promise(r => setTimeout(r, 500));

			// Also use mouse wheel scroll
			await this.page.mouse.wheel(0, 3000);
			await new Promise(r => setTimeout(r, 500));

			// Check new height
			const newHeight = await this.page.evaluate(() => {
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
		await this.page.evaluate(async () => {
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
		const finalHeight = await this.page.evaluate(() => {
			return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
		});

		// Scroll back to top
		await this.page.evaluate(() => window.scrollTo(0, 0));
		await new Promise(r => setTimeout(r, 300));
	}

	async getContent() {
		this.lastActivity = Date.now();

		const html = await this.page.content();
		const text = await this.page.evaluate(() => document.body.innerText);
		const url = this.page.url();
		const title = await this.page.title();

		return { html, text, url, title };
	}

	async evaluate(script) {
		this.lastActivity = Date.now();
		return await this.page.evaluate(script);
	}

	async waitForSelector(selector, options = {}) {
		this.lastActivity = Date.now();
		await this.page.waitForSelector(selector, {
			timeout: options.timeout || 30000,
			state: options.state || 'visible'
		});
		return { success: true };
	}

	async getElements(selector) {
		this.lastActivity = Date.now();

		const elements = await this.page.$$eval(selector, els => els.map((el, i) => ({
			index: i,
			tagName: el.tagName.toLowerCase(),
			text: el.innerText?.substring(0, 100) || '',
			href: el.href || null,
			id: el.id || null,
			className: el.className || null
		})));

		return elements;
	}

	// ==================== 代理模式实时交互 API ====================

	/**
	 * 快速截图 - 用于代理模式的实时预览
	 * 不进行滚动加载，直接截取当前视口
	 */
	async quickScreenshot(options = {}) {
		this.lastActivity = Date.now();

		const quality = options.quality || 80;
		const format = options.format || 'jpeg';  // jpeg 更快

		const screenshot = await this.page.screenshot({
			type: format,
			quality: format === 'jpeg' ? quality : undefined,
			fullPage: false
		});

		return screenshot;
	}

	/**
	 * 鼠标事件处理 - 代理模式下的鼠标交互
	 */
	async mouseEvent(eventType, x, y, options = {}) {
		this.lastActivity = Date.now();

		const mouse = this.page.mouse;

		switch (eventType) {
			case 'click':
				await mouse.click(x, y, {
					button: options.button || 'left',
					clickCount: options.clickCount || 1,
					delay: options.delay || 0
				});
				break;
			case 'dblclick':
				await mouse.dblclick(x, y, { button: options.button || 'left' });
				break;
			case 'move':
				await mouse.move(x, y, { steps: options.steps || 1 });
				break;
			case 'down':
				await mouse.down({ button: options.button || 'left' });
				break;
			case 'up':
				await mouse.up({ button: options.button || 'left' });
				break;
			case 'wheel':
				await mouse.wheel(options.deltaX || 0, options.deltaY || 0);
				break;
			default:
				throw new Error(`Unknown mouse event: ${eventType}`);
		}

		return { success: true };
	}

	/**
	 * 键盘事件处理 - 代理模式下的键盘交互
	 */
	async keyboardEvent(eventType, key, options = {}) {
		this.lastActivity = Date.now();

		const keyboard = this.page.keyboard;

		switch (eventType) {
			case 'press':
				await keyboard.press(key, { delay: options.delay || 0 });
				break;
			case 'down':
				await keyboard.down(key);
				break;
			case 'up':
				await keyboard.up(key);
				break;
			case 'type':
				await keyboard.type(key, { delay: options.delay || 50 });
				break;
			case 'insertText':
				await keyboard.insertText(key);
				break;
			default:
				throw new Error(`Unknown keyboard event: ${eventType}`);
		}

		return { success: true };
	}

	/**
	 * 获取视口信息 - 用于坐标转换
	 */
	async getViewportInfo() {
		this.lastActivity = Date.now();

		const viewportSize = this.page.viewportSize();
		const pageInfo = await this.page.evaluate(() => {
			return {
				scrollX: window.scrollX,
				scrollY: window.scrollY,
				documentWidth: document.documentElement.scrollWidth,
				documentHeight: document.documentElement.scrollHeight,
				devicePixelRatio: window.devicePixelRatio
			};
		});

		return {
			viewport: viewportSize,
			...pageInfo
		};
	}

	/**
	 * 设置视口大小
	 */
	async setViewport(width, height) {
		this.lastActivity = Date.now();
		await this.page.setViewportSize({ width, height });
		return { success: true, width, height };
	}

	async pressKey(key) {
		this.lastActivity = Date.now();
		await this.page.keyboard.press(key);
		return { success: true };
	}

	async selectOption(selector, value) {
		this.lastActivity = Date.now();
		await this.page.selectOption(selector, value);
		return { success: true };
	}

	// Get network requests
	getNetworkRequests() {
		this.lastActivity = Date.now();
		return this.networkRequests.filter(r => r.status !== null);
	}

	// Clear network requests
	clearNetworkRequests() {
		this.lastActivity = Date.now();
		this.networkRequests = [];
		return { success: true };
	}

	// Toggle network recording
	setNetworkRecording(enabled) {
		this.lastActivity = Date.now();
		this.networkRecording = enabled;
		return { success: true, recording: enabled };
	}

	// Get console messages
	getConsoleMessages() {
		this.lastActivity = Date.now();
		return this.consoleMessages;
	}

	// Clear console messages
	clearConsoleMessages() {
		this.lastActivity = Date.now();
		this.consoleMessages = [];
		return { success: true };
	}

	async close() {
		try {
			if (this.page) await this.page.close().catch(() => { });
			if (this.context) await this.context.close().catch(() => { });
			if (this.browser) await this.browser.close().catch(() => { });
		} catch (e) {
			console.error(`[Browser] Error closing session: ${e.message}`);
		}
	}
}

/**
 * Session Manager
 * @param {string} sessionId - Session identifier
 * @param {object} options - Session options
 * @param {boolean} options.headless - Whether to run in headless mode (default: true)
 */
async function getOrCreateSession(sessionId, options = {}) {
	if (browserSessions.has(sessionId)) {
		const session = browserSessions.get(sessionId);
		session.lastActivity = Date.now();
		return session;
	}

	// Cleanup old sessions if at limit
	if (browserSessions.size >= MAX_SESSIONS) {
		let oldestId = null;
		let oldestTime = Date.now();
		for (const [id, session] of browserSessions) {
			if (session.lastActivity < oldestTime) {
				oldestTime = session.lastActivity;
				oldestId = id;
			}
		}
		if (oldestId) {
			const oldSession = browserSessions.get(oldestId);
			await oldSession.close();
			browserSessions.delete(oldestId);
		}
	}

	const session = new BrowserSession(sessionId);
	await session.initialize(options);
	browserSessions.set(sessionId, session);
	return session;
}

async function closeSession(sessionId) {
	if (browserSessions.has(sessionId)) {
		const session = browserSessions.get(sessionId);
		await session.close();
		browserSessions.delete(sessionId);
		return true;
	}
	return false;
}

/**
 * 反向代理请求处理
 * 用于绕过 X-Frame-Options 限制，允许在 iframe 中显示任意网页
 *
 * 使用方式: GET /proxy?url=https://example.com
 */
async function handleProxyRequest(req, res) {
	const url = require('url');
	const https = require('https');
	const http = require('http');

	try {
		const parsedUrl = url.parse(req.url, true);
		let targetUrl = parsedUrl.query.url;

		// 获取代理服务器的完整地址（用于注入脚本）
		const proxyHost = req.headers.host || 'localhost:3006';
		const proxyOrigin = 'http://' + proxyHost;

		// 如果请求路径不是 /proxy，尝试从 Referer 推断目标网站
		if (!targetUrl && parsedUrl.pathname !== '/proxy' && parsedUrl.pathname !== '/') {
			const referer = req.headers.referer || req.headers.referrer;
			if (referer) {
				// 从 Referer 中提取原始目标网站
				// Referer 格式: http://localhost:3006/proxy?url=https%3A%2F%2Fwww.baidu.com
				try {
					const refererUrl = new URL(referer);
					const originalUrl = refererUrl.searchParams.get('url');
					if (originalUrl) {
						const originalParsed = new URL(originalUrl);
						// 构建完整的目标 URL
						targetUrl = originalParsed.origin + req.url;
						// 重定向到代理 URL
						res.writeHead(302, {
							'Location': proxyOrigin + '/proxy?url=' + encodeURIComponent(targetUrl)
						});
						res.end();
						return;
					}
				} catch (e) {
					// 忽略解析错误
				}
			}
		}

		if (!targetUrl) {
			// 如果没有 url 参数，返回简单的状态页
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<html><body><h1>Browser Proxy Server Running</h1><p>Use: /proxy?url=https://example.com</p></body></html>');
			return;
		}

		console.log('[Browser] Proxying:', targetUrl);

		// 解析目标 URL
		const target = url.parse(targetUrl);
		const isHttps = target.protocol === 'https:';
		const httpModule = isHttps ? https : http;

		const proxyReq = httpModule.request({
			hostname: target.hostname,
			port: target.port || (isHttps ? 443 : 80),
			path: target.path,
			method: 'GET',
			headers: {
				'User-Agent': getRandomUserAgent(),
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				'Accept-Encoding': 'identity',  // 不压缩，方便修改
				'Connection': 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
			},
			rejectUnauthorized: false,  // 忽略 SSL 证书错误
			timeout: 30000,
		}, (proxyRes) => {
			// 处理重定向
			if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
				let redirectUrl = proxyRes.headers.location;
				// 处理相对路径重定向
				if (!redirectUrl.startsWith('http')) {
					redirectUrl = target.protocol + '//' + target.host + redirectUrl;
				}
				res.writeHead(302, { 'Location': '/proxy?url=' + encodeURIComponent(redirectUrl) });
				res.end();
				return;
			}

			// 修改响应头 - 移除阻止 iframe 嵌入的头
			const headers = { ...proxyRes.headers };
			delete headers['x-frame-options'];
			delete headers['content-security-policy'];
			delete headers['content-security-policy-report-only'];
			delete headers['x-content-type-options'];

			// 添加允许嵌入的头
			headers['access-control-allow-origin'] = '*';

			// 收集响应体
			const chunks = [];
			proxyRes.on('data', chunk => chunks.push(chunk));
			proxyRes.on('end', () => {
				let body = Buffer.concat(chunks);
				const contentType = proxyRes.headers['content-type'] || '';

				// 对 HTML 内容进行处理
				if (contentType.includes('text/html')) {
					let html = body.toString('utf-8');

					// 注入 base 标签，修复相对路径
					const baseUrl = target.protocol + '//' + target.host;
					const baseTag = '<base href="' + baseUrl + '/" target="_self">';

					// 移除所有 target="_blank" 属性，让链接在当前页面打开
					html = html.replace(/target\s*=\s*["']_blank["']/gi, 'target="_self"');
					html = html.replace(/target\s*=\s*["']_parent["']/gi, 'target="_self"');
					html = html.replace(/target\s*=\s*["']_top["']/gi, 'target="_self"');

					// 注入导航拦截脚本 - 使用完整的代理服务器地址
					const proxyScript = `
<script>
(function() {
	var PROXY_ORIGIN = '${proxyOrigin}';
	var TARGET_ORIGIN = '${baseUrl}';

	// 辅助函数：将 URL 转换为完整 URL
	function toFullUrl(url) {
		if (!url) return null;
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}
		if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('blob:') || url === '#') {
			return null;
		}
		try {
			return new URL(url, TARGET_ORIGIN).href;
		} catch(e) {
			return null;
		}
	}

	// 辅助函数：将 URL 转换为代理 URL（用于导航）
	function toProxyUrl(url) {
		var fullUrl = toFullUrl(url);
		if (!fullUrl) return null;
		// 如果已经是代理 URL，不再处理
		if (fullUrl.includes(PROXY_ORIGIN)) return null;
		return PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
	}

	// ==================== 拦截 XMLHttpRequest ====================
	var OriginalXHR = window.XMLHttpRequest;
	window.XMLHttpRequest = function() {
		var xhr = new OriginalXHR();
		var originalOpen = xhr.open;
		xhr.open = function(method, url, async, user, password) {
			var fullUrl = toFullUrl(url);
			if (fullUrl && !fullUrl.startsWith(PROXY_ORIGIN)) {
				// 将请求重定向到代理
				var proxyUrl = PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
				return originalOpen.call(this, method, proxyUrl, async !== false, user, password);
			}
			return originalOpen.apply(this, arguments);
		};
		return xhr;
	};
	// 复制静态属性
	Object.keys(OriginalXHR).forEach(function(key) {
		try { window.XMLHttpRequest[key] = OriginalXHR[key]; } catch(e) {}
	});
	window.XMLHttpRequest.prototype = OriginalXHR.prototype;

	// ==================== 拦截 fetch ====================
	var originalFetch = window.fetch;
	window.fetch = function(input, init) {
		var url = typeof input === 'string' ? input : (input && input.url);
		var fullUrl = toFullUrl(url);
		if (fullUrl && !fullUrl.startsWith(PROXY_ORIGIN)) {
			var proxyUrl = PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
			if (typeof input === 'string') {
				return originalFetch.call(this, proxyUrl, init);
			} else if (input && input.url) {
				var newRequest = new Request(proxyUrl, input);
				return originalFetch.call(this, newRequest, init);
			}
		}
		return originalFetch.apply(this, arguments);
	};

	// ==================== 拦截链接点击 ====================
	document.addEventListener('click', function(e) {
		var link = e.target.closest('a');
		if (link && link.href) {
			var proxyUrl = toProxyUrl(link.href);
			if (proxyUrl) {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = proxyUrl;
				return false;
			}
		}
	}, true);

	// ==================== 拦截 window.open ====================
	var originalOpen = window.open;
	window.open = function(url, target, features) {
		var proxyUrl = toProxyUrl(url);
		if (proxyUrl) {
			window.location.href = proxyUrl;
			return window;
		}
		return originalOpen.apply(this, arguments);
	};

	// ==================== 拦截表单提交 ====================
	document.addEventListener('submit', function(e) {
		var form = e.target;
		if (!form) return;

		// 修改 target 属性
		if (form.target && (form.target === '_blank' || form.target === '_parent' || form.target === '_top')) {
			form.target = '_self';
		}

		// 获取表单 action URL
		var actionUrl = form.action || window.location.href;
		var fullUrl = toFullUrl(actionUrl);
		if (!fullUrl || fullUrl.startsWith(PROXY_ORIGIN)) return;

		// 处理 GET 表单
		if (!form.method || form.method.toUpperCase() === 'GET') {
			var formData = new FormData(form);
			var params = new URLSearchParams(formData).toString();
			var separator = fullUrl.includes('?') ? '&' : '?';
			fullUrl = fullUrl + separator + params;

			e.preventDefault();
			window.location.href = PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
			return false;
		}

		// 处理 POST 表单 - 修改 action
		form.action = PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
	}, true);

	// ==================== 拦截 location 修改 ====================
	// 保存原始 location 对象的引用
	var locationProxy = {};
	['href', 'assign', 'replace'].forEach(function(prop) {
		if (prop === 'href') {
			Object.defineProperty(locationProxy, prop, {
				get: function() { return location.href; },
				set: function(url) {
					var proxyUrl = toProxyUrl(url);
					if (proxyUrl) {
						location.href = proxyUrl;
					} else {
						location.href = url;
					}
				}
			});
		}
	});

	// 拦截 location.assign 和 location.replace
	var originalAssign = location.assign;
	location.assign = function(url) {
		var proxyUrl = toProxyUrl(url);
		if (proxyUrl) {
			return originalAssign.call(this, proxyUrl);
		}
		return originalAssign.call(this, url);
	};

	var originalReplace = location.replace;
	location.replace = function(url) {
		var proxyUrl = toProxyUrl(url);
		if (proxyUrl) {
			return originalReplace.call(this, proxyUrl);
		}
		return originalReplace.call(this, url);
	};

	// ==================== 拦截 history API ====================
	var originalPushState = history.pushState;
	history.pushState = function(state, title, url) {
		if (url) {
			var proxyUrl = toProxyUrl(url);
			if (proxyUrl) {
				return originalPushState.call(this, state, title, proxyUrl);
			}
		}
		return originalPushState.apply(this, arguments);
	};

	var originalReplaceState = history.replaceState;
	history.replaceState = function(state, title, url) {
		if (url) {
			var proxyUrl = toProxyUrl(url);
			if (proxyUrl) {
				return originalReplaceState.call(this, state, title, proxyUrl);
			}
		}
		return originalReplaceState.apply(this, arguments);
	};

	// ==================== 修改 DOM 元素 ====================
	function processElement(el) {
		if (!el || el.nodeType !== 1) return;

		// 处理链接
		if (el.tagName === 'A') {
			if (el.target === '_blank' || el.target === '_parent' || el.target === '_top') {
				el.target = '_self';
			}
		}

		// 处理表单
		if (el.tagName === 'FORM') {
			if (el.target === '_blank' || el.target === '_parent' || el.target === '_top') {
				el.target = '_self';
			}
			if (el.action) {
				var fullUrl = toFullUrl(el.action);
				if (fullUrl && !fullUrl.startsWith(PROXY_ORIGIN)) {
					el.action = PROXY_ORIGIN + '/proxy?url=' + encodeURIComponent(fullUrl);
				}
			}
		}

		// 递归处理子元素
		if (el.querySelectorAll) {
			el.querySelectorAll('a[target], form').forEach(processElement);
		}
	}

	// 处理现有元素
	document.querySelectorAll('a[target]').forEach(processElement);
	document.querySelectorAll('form').forEach(processElement);

	// 监听动态添加的元素
	var observer = new MutationObserver(function(mutations) {
		mutations.forEach(function(mutation) {
			mutation.addedNodes.forEach(processElement);
		});
	});
	if (document.body) {
		observer.observe(document.body, { childList: true, subtree: true });
	} else {
		document.addEventListener('DOMContentLoaded', function() {
			observer.observe(document.body, { childList: true, subtree: true });
		});
	}

	// ==================== 拦截 Image/Script/Link 等资源加载 ====================
	// 这些资源通常可以跨域加载，不需要代理

	console.log('[Proxy] Navigation interception initialized for: ' + TARGET_ORIGIN);
})();
</script>`;

					if (html.includes('<head>')) {
						html = html.replace('<head>', '<head>' + baseTag);
					} else if (html.includes('<HEAD>')) {
						html = html.replace('<HEAD>', '<HEAD>' + baseTag);
					} else if (html.includes('<html>')) {
						html = html.replace('<html>', '<html><head>' + baseTag + '</head>');
					}

					// 在 body 结束前注入脚本
					if (html.includes('</body>')) {
						html = html.replace('</body>', proxyScript + '</body>');
					} else if (html.includes('</BODY>')) {
						html = html.replace('</BODY>', proxyScript + '</BODY>');
					} else if (html.includes('</html>')) {
						html = html.replace('</html>', proxyScript + '</html>');
					} else {
						html += proxyScript;
					}

					body = Buffer.from(html, 'utf-8');
					headers['content-length'] = body.length;
				}

				res.writeHead(proxyRes.statusCode, headers);
				res.end(body);
			});
		});

		proxyReq.on('error', (e) => {
			console.error('[Browser] Proxy error:', e.message);
			res.writeHead(502, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
		});

		proxyReq.on('timeout', () => {
			proxyReq.destroy();
			res.writeHead(504, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Proxy timeout' }));
		});

		proxyReq.end();

	} catch (e) {
		console.error('[Browser] Proxy error:', e.message);
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: e.message }));
	}
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
	// CORS headers - 允许 iframe 嵌入
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	// GET 请求：反向代理模式
	if (req.method === 'GET') {
		await handleProxyRequest(req, res);
		return;
	}

	if (req.method !== 'POST') {
		res.writeHead(405);
		res.end(JSON.stringify({ error: 'Method not allowed' }));
		return;
	}

	let body = '';
	for await (const chunk of req) {
		body += chunk;
	}

	try {
		const request = JSON.parse(body);
		const { action, sessionId, ...params } = request;

		if (!action) {
			throw new Error('Action is required');
		}

		let result;
		const sid = sessionId || 'default';

		switch (action) {
			case 'open':
			case 'navigate': {
				// Support headless option: { headless: false } to show browser window
				const sessionOptions = { headless: params.headless !== false };
				const session = await getOrCreateSession(sid, sessionOptions);
				result = await session.navigate(params.url);
				result.headless = sessionOptions.headless;
				break;
			}

			case 'click': {
				const session = await getOrCreateSession(sid);
				result = await session.click(params.selector, params);
				break;
			}

			case 'type': {
				const session = await getOrCreateSession(sid);
				result = await session.type(params.selector, params.text, params);
				break;
			}

			case 'scroll': {
				const session = await getOrCreateSession(sid);
				result = await session.scroll(params);
				break;
			}

			case 'screenshot': {
				const session = await getOrCreateSession(sid, { headless: true });
				// If URL is provided and different from current, navigate first
				if (params.url) {
					const currentUrl = session.page ? await session.page.url() : null;
					if (currentUrl !== params.url) {
						await session.navigate(params.url);
						// Wait for network to be idle (faster than fixed timeout)
						try {
							await session.page.waitForLoadState('networkidle', { timeout: 5000 });
						} catch (e) {
							// Timeout is ok, continue with screenshot
						}
					}
				}
				const screenshot = await session.screenshot(params);
				res.writeHead(200, { 'Content-Type': 'image/png' });
				res.end(screenshot);
				return;
			}

			case 'getContent': {
				const session = await getOrCreateSession(sid);
				result = await session.getContent();
				break;
			}

			case 'evaluate': {
				const session = await getOrCreateSession(sid);
				result = await session.evaluate(params.script);
				break;
			}

			case 'waitForSelector': {
				const session = await getOrCreateSession(sid);
				result = await session.waitForSelector(params.selector, params);
				break;
			}

			case 'getElements': {
				const session = await getOrCreateSession(sid);
				result = await session.getElements(params.selector);
				break;
			}

			case 'pressKey': {
				const session = await getOrCreateSession(sid);
				result = await session.pressKey(params.key);
				break;
			}

			case 'selectOption': {
				const session = await getOrCreateSession(sid);
				result = await session.selectOption(params.selector, params.value);
				break;
			}

			// ==================== 代理模式实时交互 API ====================

			case 'quickScreenshot': {
				const session = await getOrCreateSession(sid, { headless: true });
				// 如果提供了 URL 且与当前不同，先导航
				if (params.url) {
					const currentUrl = session.page ? await session.page.url() : null;
					if (currentUrl !== params.url) {
						await session.navigate(params.url);
					}
				}
				const screenshot = await session.quickScreenshot(params);
				// 直接返回图片
				res.writeHead(200, { 'Content-Type': params.format === 'png' ? 'image/png' : 'image/jpeg' });
				res.end(screenshot);
				return;
			}

			case 'mouseEvent': {
				const session = await getOrCreateSession(sid);
				result = await session.mouseEvent(params.eventType, params.x, params.y, params);
				break;
			}

			case 'keyboardEvent': {
				const session = await getOrCreateSession(sid);
				result = await session.keyboardEvent(params.eventType, params.key, params);
				break;
			}

			case 'getViewportInfo': {
				const session = await getOrCreateSession(sid);
				result = await session.getViewportInfo();
				break;
			}

			case 'setViewport': {
				const session = await getOrCreateSession(sid);
				result = await session.setViewport(params.width, params.height);
				break;
			}

			case 'getNetworkRequests': {
				const session = await getOrCreateSession(sid);
				result = session.getNetworkRequests();
				break;
			}

			case 'clearNetworkRequests': {
				const session = await getOrCreateSession(sid);
				result = session.clearNetworkRequests();
				break;
			}

			case 'setNetworkRecording': {
				const session = await getOrCreateSession(sid);
				result = session.setNetworkRecording(params.enabled !== false);
				break;
			}

			case 'getConsoleMessages': {
				const session = await getOrCreateSession(sid);
				result = session.getConsoleMessages();
				break;
			}

			case 'clearConsoleMessages': {
				const session = await getOrCreateSession(sid);
				result = session.clearConsoleMessages();
				break;
			}

			case 'close': {
				const closed = await closeSession(sid);
				result = { closed };
				break;
			}

			case 'listSessions': {
				result = Array.from(browserSessions.keys());
				break;
			}

			default:
				throw new Error(`Unknown action: ${action}`);
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: true, result }));

	} catch (error) {
		console.error('[Browser] Error:', error.message);
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: false, error: error.message }));
	}
}

/**
 * Cleanup all browser sessions
 */
async function cleanupAllSessions() {
	for (const [id, session] of browserSessions) {
		try {
			await session.close();
		} catch (e) {
			console.error(`[Browser] ⚠️ Error closing session ${id}:`, e.message);
		}
	}
	browserSessions.clear();
}

/**
 * Get port file path for IPC
 */
function getPortFilePath() {
	return path.join(os.tmpdir(), 'senweaver-browser-server-port.txt');
}

/**
 * Write actual port to file for other processes to read
 */
function writePortFile(port) {
	try {
		const portFile = getPortFilePath();
		fs.writeFileSync(portFile, String(port), 'utf8');
		console.log(`[Browser] 📝 Port file written: ${portFile}`);
	} catch (e) {
		console.error(`[Browser] ⚠️ Failed to write port file: ${e.message}`);
	}
}

/**
 * Create and start HTTP server with dynamic port allocation
 * Consistent with other backend services (fetch_url, web_search, etc.)
 */
function startServer(startPort = DEFAULT_PORT) {
	const server = http.createServer(handleRequest);

	// Try to listen on the specified port, with automatic fallback to next available port
	let currentPort = startPort;
	const maxAttempts = 20; // Try up to 20 ports

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			console.error(`❌ Failed to find an available port after ${maxAttempts} attempts (ports ${startPort}-${currentPort})`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {
			// Store the actual port for reference
			server.actualPort = currentPort;

			// Output port in a parseable format for main.ts to capture
			console.log(`[Browser] ✅ Server started on port ${currentPort}`);
			console.log(`BROWSER_SERVER_PORT=${currentPort}`);

			// Write port to file for voidBrowserEditor to read
			writePortFile(currentPort);
		});

		server.once('error', (error) => {
			if (error.code === 'EADDRINUSE') {
				console.log(`[Browser] ⚠️ Port ${currentPort} is in use, trying ${currentPort + 1}...`);
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

	// Cleanup on SIGTERM
	process.on('SIGTERM', async () => {
		await cleanupAllSessions();
		server.close(() => {
			process.exit(0);
		});
	});

	// Cleanup on SIGINT (Ctrl+C)
	process.on('SIGINT', async () => {
		await cleanupAllSessions();
		server.close(() => {
			process.exit(0);
		});
	});

	// Cleanup on uncaught exception
	process.on('uncaughtException', async (error) => {
		console.error('[Browser] 💥 Uncaught exception:', error);
		await cleanupAllSessions();
		process.exit(1);
	});

	return server;
}

// Auto-start if run directly
const port = process.argv[2] ? parseInt(process.argv[2]) : DEFAULT_PORT;
startServer(port);

module.exports = { startServer, DEFAULT_PORT, cleanupAllSessions, getPortFilePath };
