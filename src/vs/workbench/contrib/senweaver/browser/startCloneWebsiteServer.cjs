/**
 * Clone Website Backend Server V2
 * Multi-page crawler for complete website cloning
 * Features: Breadth-first crawl, same-domain filtering, resource download
 */

const http = require('http');
const { URL } = require('url');

// Try to load optional dependencies
let axios, cheerio;
try {
	axios = require('axios');
	cheerio = require('cheerio');
} catch (error) {

}

/**
 * URL utilities
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

function isSameDomain(url1, url2) {
	try {
		const domain1 = new URL(url1).hostname;
		const domain2 = new URL(url2).hostname;
		return domain1 === domain2;
	} catch {
		return false;
	}
}

function isValidUrl(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Fetch website HTML
 */
async function fetchWebsite(url) {
	if (!axios) throw new Error('axios not available');

	try {
		const response = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
			timeout: 30000,
			maxRedirects: 5,
			validateStatus: () => true
		});

		return {
			html: response.data,
			statusCode: response.status,
			finalUrl: response.request.res?.responseUrl || url
		};
	} catch (error) {
		throw new Error(`Fetch failed: ${error.message}`);
	}
}

/**
 * Extract links from HTML
 */
function extractLinks(html, baseUrl) {
	if (!cheerio) return [];

	const $ = cheerio.load(html);
	const links = new Set();

	$('a[href]').each((i, element) => {
		const href = $(element).attr('href');
		if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
			try {
				const absoluteUrl = new URL(href, baseUrl).href;
				if (isValidUrl(absoluteUrl)) {
					links.add(normalizeUrl(absoluteUrl));
				}
			} catch { }
		}
	});

	return Array.from(links);
}

/**
 * Analyze a single page
 */
function analyzePage(html, url) {
	if (!cheerio) return null;

	const $ = cheerio.load(html);

	// Meta info
	const meta = {
		title: $('title').text() || '',
		description: $('meta[name="description"]').attr('content') || '',
		keywords: $('meta[name="keywords"]').attr('content') || '',
	};

	// Structure
	const headings = [];
	$('h1, h2, h3').each((i, el) => {
		if (i < 20) headings.push({ level: el.name, text: $(el).text().trim() });
	});

	const images = [];
	$('img').each((i, el) => {
		if (i < 10) images.push({
			src: $(el).attr('src') || '',
			alt: $(el).attr('alt') || ''
		});
	});

	// Layout detection
	const layout = {
		hasHeader: $('header').length > 0,
		hasFooter: $('footer').length > 0,
		hasNav: $('nav').length > 0
	};

	// Extract colors
	const colors = new Set();
	$('[style]').each((i, el) => {
		const style = $(el).attr('style') || '';
		const colorMatches = style.match(/#[0-9A-Fa-f]{3,6}|rgba?\([^)]+\)/g);
		if (colorMatches) colorMatches.forEach(c => colors.add(c));
	});

	return {
		url,
		meta,
		headings,
		images,
		layout,
		colors: Array.from(colors).slice(0, 10),
		htmlLength: html.length
	};
}

/**
 * Main crawler - breadth-first multi-page crawl
 */
async function crawlWebsite(startUrl, options = {}) {
	const {
		maxPages = 20,
		maxDepth = 2,
		sameDomainOnly = true
	} = options;

	const normalizedStart = normalizeUrl(startUrl);
	const visited = new Set();
	const queue = [{ url: normalizedStart, depth: 0 }];
	const pages = [];
	const errors = [];

	const startTime = Date.now();

	try {
		while (queue.length > 0 && pages.length < maxPages) {
			const { url: currentUrl, depth } = queue.shift();

			// Skip conditions
			if (visited.has(currentUrl)) continue;
			if (depth > maxDepth) continue;
			if (sameDomainOnly && !isSameDomain(currentUrl, normalizedStart)) continue;

			visited.add(currentUrl);

			try {
				// Fetch page
				const { html, statusCode, finalUrl } = await fetchWebsite(currentUrl);

				if (statusCode >= 400) {
					errors.push({ url: currentUrl, error: `HTTP ${statusCode}` });
					continue;
				}

				// Analyze page
				const pageData = analyzePage(html, finalUrl || currentUrl);
				if (pageData) {
					pageData.depth = depth;
					pageData.statusCode = statusCode;
					pages.push(pageData);
				}

				// Extract and queue links
				if (depth < maxDepth) {
					const links = extractLinks(html, finalUrl || currentUrl);
					for (const link of links) {
						if (!visited.has(link)) {
							queue.push({ url: link, depth: depth + 1 });
						}
					}
				}

				// Respectful delay
				await new Promise(resolve => setTimeout(resolve, 300));

			} catch (error) {
				errors.push({ url: currentUrl, error: error.message });
			}
		}

		const processingTime = Date.now() - startTime;

		// Generate summary
		const firstPage = pages[0] || {};
		const allColors = new Set();
		pages.forEach(p => p.colors?.forEach(c => allColors.add(c)));

		const summary = {
			url: normalizedStart,
			title: firstPage.meta?.title || '',
			description: firstPage.meta?.description || '',
			pagesCount: pages.length,
			errorsCount: errors.length,
			totalImages: pages.reduce((sum, p) => sum + (p.images?.length || 0), 0),
			colors: Array.from(allColors).slice(0, 15),
			layout: firstPage.layout || {},
			processingTime: `${(processingTime / 1000).toFixed(2)}s`
		};

		// Create sitemap
		const sitemap = pages.map(p => ({
			url: p.url,
			title: p.meta?.title || '',
			depth: p.depth
		}));

		return {
			success: true,
			url: normalizedStart,
			summary,
			pages: pages.map(p => ({
				url: p.url,
				title: p.meta?.title || '',
				description: p.meta?.description || '',
				headings: p.headings?.slice(0, 10) || [],
				images: p.images?.length || 0,
				colors: p.colors || [],
				layout: p.layout,
				depth: p.depth
			})),
			sitemap,
			errors,
			metadata: {
				startUrl: normalizedStart,
				pagesCount: pages.length,
				maxPages,
				maxDepth,
				sameDomainOnly,
				processingTime: summary.processingTime,
				timestamp: new Date().toISOString()
			}
		};

	} catch (error) {
		return {
			success: false,
			error: error.message,
			url: normalizedStart,
			pagesCount: pages.length,
			errorsCount: errors.length
		};
	}
}

/**
 * HTTP Server
 */
function createServer(port = 3003) {
	const server = http.createServer(async (req, res) => {
		// CORS
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(200);
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
			return;
		}

		// Parse body
		let body = '';
		req.on('data', chunk => body += chunk.toString());

		req.on('end', async () => {
			try {
				const { url, maxPages, maxDepth, sameDomainOnly } = JSON.parse(body);

				if (!url) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'URL is required' }));
					return;
				}

				// Validate URL
				try {
					new URL(url);
				} catch {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid URL' }));
					return;
				}

				// Crawl
				const result = await crawlWebsite(url, { maxPages, maxDepth, sameDomainOnly });

				res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));

			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: error.message }));
			}
		});
	});

	// Try to listen on the specified port, with automatic fallback
	let currentPort = port;
	const maxAttempts = 10;

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {

			if (!axios || !cheerio) {
				console.warn(`⚠️  Warning: Enhanced features disabled. Install: npm install axios cheerio`);
			}
		});

		server.once('error', (error) => {
			if (error.code === 'EADDRINUSE') {

				currentPort++;
				server.removeAllListeners('error');
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
const port = process.argv[2] ? parseInt(process.argv[2]) : 3003;
createServer(port);
