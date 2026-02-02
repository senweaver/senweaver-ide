/**
 * Web Search Backend Server
 * Supports multiple search engines: Baidu, Bing, DuckDuckGo, CSDN, Juejin, Weixin, GitHub
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 30000; // 单个引擎超时30秒，给每个引擎足够时间
const MAX_RETRIES = 2;
const OVERALL_SEARCH_TIMEOUT = 30000; // 整体搜索超时30秒，所有引擎并行执行

// Try to load optional dependencies
let axios, cheerio;
try {
	axios = require('axios');
	cheerio = require('cheerio');
} catch (error) {
	console.warn('⚠️  Enhanced libraries not available');
	console.warn('   To enable, install: npm install axios cheerio');
}

/**
 * Search Baidu
 */
async function searchBaidu(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Baidu search');
	}

	try {
		const response = await axios.get('https://www.baidu.com/s', {
			params: {
				wd: query,
				pn: '0',
				ie: 'utf-8',
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		$('#content_left').children().each((i, element) => {
			if (results.length >= limit) return false;

			const titleElement = $(element).find('h3');
			const linkElement = $(element).find('a');
			const snippetElement = $(element).find('.c-font-normal.c-color-text').first();

			if (titleElement.length && linkElement.length) {
				const url = linkElement.attr('href');
				if (url && url.startsWith('http')) {
					results.push({
						title: titleElement.text().trim(),
						url: url,
						description: snippetElement.attr('aria-label') || snippetElement.text().trim() || '',
						engine: 'baidu'
					});
				}
			}
		});

		return results;
	} catch (error) {
		console.error('❌ Baidu search error:', error.message);
		return [];
	}
}

/**
 * Search Jina (Commercial Grade Aggregator)
 * Uses s.jina.ai which aggregates results and returns LLM-friendly markdown
 */
async function searchJina(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for Jina search');
	}

	try {
		// Jina Search endpoint
		// We use specific headers to get JSON or parseable Markdown
		// Actually s.jina.ai returns Markdown by default.
		// We can use 'Accept': 'application/json' if they support it, but often they return stream/text.
		// Let's use the standard GET and parse the Markdown results which are high quality.

		const response = await axios.get(`https://s.jina.ai/${encodeURIComponent(query)}`, {
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'text/plain', // We want the raw markdown text
				'X-With-Generated-Alt': 'true'
			},
			timeout: DEFAULT_TIMEOUT // Jina使用默认超时时间
		});

		const text = response.data;
		const results = [];

		// Parse Jina's Markdown format
		// Format usually:
		// [1] Title
		// URL: https://...
		// Content...
		//
		// [2] ...

		const entries = text.split(/\n\[\d+\] /).slice(1); // Split by [1], [2]...

		for (const entry of entries) {
			if (results.length >= limit) break;

			const lines = entry.split('\n');
			const title = lines[0].trim();
			const urlLine = lines.find(l => l.startsWith('URL: '));
			const url = urlLine ? urlLine.replace('URL: ', '').trim() : '';

			// Extract snippet (everything after URL)
			let snippet = '';
			const urlIndex = lines.indexOf(urlLine);
			if (urlIndex !== -1 && urlIndex < lines.length - 1) {
				snippet = lines.slice(urlIndex + 1).join(' ').trim();
				// Clean up snippet (remove markdown formatting chars if heavy)
				snippet = snippet.substring(0, 300) + '...';
			}

			if (url && title) {
				results.push({
					title,
					url,
					description: snippet || 'No description available',
					engine: 'jina'
				});
			}
		}

		return results;
	} catch (error) {
		console.error('❌ Jina search error:', error.message);
		return [];
	}
}

/**
 * Search Bing (Optimized with Reference Project Headers)
 */
async function searchBing(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Bing search');
	}

	try {
		const response = await axios.get('https://www.bing.com/search', {
			params: {
				q: query,
				count: limit,
				first: 1
			},
			headers: {
				"authority": "www.bing.com",
				"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
				"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
				"cache-control": "no-cache",
				"pragma": "no-cache",
				"sec-ch-ua": '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
				"sec-ch-ua-mobile": "?0",
				"sec-ch-ua-platform": '"Windows"',
				"sec-fetch-dest": "document",
				"sec-fetch-mode": "navigate",
				"sec-fetch-site": "none",
				"sec-fetch-user": "?1",
				"upgrade-insecure-requests": "1",
				"user-agent": DEFAULT_USER_AGENT,
				"cookie": "SRCHHPGROWTH=0; _EDGE_S=F=1; MUID=00000000000000000000000000000000" // Minimal cookie to bypass some checks
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		// Updated selectors based on reference project
		$('#b_results > .b_algo').each((i, element) => {
			if (results.length >= limit) return false;

			const titleElement = $(element).find('h2 a');
			const snippetElement = $(element).find('.b_caption p, .b_snippet');
			const sourceElement = $(element).find('.b_attribution cite');

			if (titleElement.length) {
				const url = titleElement.attr('href');
				if (url && url.startsWith('http')) {
					results.push({
						title: titleElement.text().trim(),
						url: url,
						description: snippetElement.text().trim() || '',
						source: sourceElement.text().trim() || 'Bing',
						engine: 'bing'
					});
				}
			}
		});

		return results;
	} catch (error) {
		console.error('❌ Bing search error:', error.message);
		return [];
	}
}

/**
 * Search DuckDuckGo (using html version for stability)
 */
async function searchDuckDuckGo(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for DuckDuckGo search');
	}

	try {
		// Use html.duckduckgo.com instead of lite, sometimes better for stability with right headers
		const response = await axios.post('https://html.duckduckgo.com/html/',
			`q=${encodeURIComponent(query)}&kl=wt-wt`, // No region
			{
				headers: {
					'User-Agent': DEFAULT_USER_AGENT,
					'Content-Type': 'application/x-www-form-urlencoded',
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Origin': 'https://html.duckduckgo.com',
					'Referer': 'https://html.duckduckgo.com/'
				},
				timeout: DEFAULT_TIMEOUT,
			}
		);

		const $ = cheerio.load(response.data);
		const results = [];

		$('.result').each((i, element) => {
			if (results.length >= limit) return false;

			const linkElement = $(element).find('a.result__a');
			const snippetElement = $(element).find('a.result__snippet');

			if (linkElement.length) {
				const url = linkElement.attr('href');
				const title = linkElement.text().trim();

				if (url && title && url.startsWith('http')) {
					results.push({
						title: title,
						url: url,
						description: snippetElement.text().trim() || '',
						engine: 'duckduckgo'
					});
				}
			}
		});

		return results;
	} catch (error) {
		console.error('❌ DuckDuckGo search error:', error.message);
		return [];
	}
}

/**
 * Search CSDN (using API)
 */
async function searchCSDN(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for CSDN search');
	}

	try {
		// Use CSDN search API
		const response = await axios.get('https://so.csdn.net/api/v3/search', {
			params: {
				q: query,
				t: 'blog',
				p: 1,
				s: 0,
				tm: 0,
				lv: -1,
				ft: 0,
				l: '',
				u: '',
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/json, text/plain, */*',
				'Referer': 'https://so.csdn.net/',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const results = [];
		const data = response.data?.result_vos || [];

		for (const item of data) {
			if (results.length >= limit) break;

			if (item.url && item.title) {
				results.push({
					title: item.title,
					url: item.url,
					description: item.description || item.summary || '',
					engine: 'csdn'
				});
			}
		}

		return results;
	} catch (error) {
		console.error('❌ CSDN search error:', error.message);
		return [];
	}
}

/**
 * Search Juejin
 */
async function searchJuejin(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for Juejin search');
	}

	try {
		const response = await axios.post('https://api.juejin.cn/search_api/v1/search', {
			key_word: query,
			page_no: 0,
			page_size: limit,
			search_type: 0,
		}, {
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Content-Type': 'application/json',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const results = [];
		const data = response.data?.data || [];

		for (const item of data) {
			if (results.length >= limit) break;

			if (item.result_model && item.result_model.article_info) {
				const article = item.result_model.article_info;
				results.push({
					title: article.title || '',
					url: `https://juejin.cn/post/${article.article_id}`,
					description: article.brief_content || '',
					engine: 'juejin'
				});
			}
		}

		return results;
	} catch (error) {
		console.error('❌ Juejin search error:', error.message);
		return [];
	}
}

/**
 * Search Brave
 */
async function searchBrave(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Brave search');
	}

	try {
		const response = await axios.get('https://search.brave.com/search', {
			params: {
				q: query,
				source: 'web',
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		$('.snippet').each((i, element) => {
			if (results.length >= limit) return false;

			const titleElement = $(element).find('.title');
			const linkElement = $(element).find('a.heading-serpresult');
			const snippetElement = $(element).find('.snippet-description');

			if (linkElement.length) {
				const url = linkElement.attr('href');
				if (url && url.startsWith('http')) {
					results.push({
						title: titleElement.text().trim() || 'No title',
						url: url,
						description: snippetElement.text().trim() || '',
						engine: 'brave'
					});
				}
			}
		});

		return results;
	} catch (error) {
		console.error('❌ Brave search error:', error.message);
		return [];
	}
}

/**
 * Search WeChat/Weixin via Sogou (搜狗微信搜索)
 * Reference: WechatSogou project - wechatsogou/request.py, wechatsogou/structuring.py
 */
async function searchWeixin(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Weixin search');
	}

	try {
		// Use Sogou Weixin search: type=2 for articles
		// Reference: gen_search_article_url() in request.py
		const response = await axios.get('https://weixin.sogou.com/weixin', {
			params: {
				type: '2',  // 2 = article search, 1 = account search
				page: '1',
				ie: 'utf8',
				query: query,
			},
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				'Referer': 'https://weixin.sogou.com/',
				'Cookie': 'ABTEST=0|1700000000|v1',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		// Reference: get_article_by_search() in structuring.py
		// Parse search results from ul.news-list > li
		$('ul.news-list > li').each((i, element) => {
			if (results.length >= limit) return false;

			try {
				// Try different DOM structures (Sogou may have variations)
				let url = $(element).find('div.txt-box h3 a').attr('href') ||
					$(element).find('h3 a').attr('href') ||
					$(element).find('a').first().attr('href');

				let title = $(element).find('div.txt-box h3 a').text().trim() ||
					$(element).find('h3 a').text().trim() ||
					$(element).find('h3').text().trim();

				let abstract = $(element).find('p.txt-info').text().trim() ||
					$(element).find('.txt-box p').text().trim() ||
					$(element).find('p').first().text().trim();

				let gzhName = $(element).find('a.account').text().trim() ||
					$(element).find('.s-p a').text().trim() || '';

				// Clean up title and abstract (remove red_beg/red_end markers)
				title = title.replace(/red_beg/g, '').replace(/red_end/g, '').trim();
				abstract = abstract.replace(/red_beg/g, '').replace(/red_end/g, '').trim();

				if (url && title) {
					// Sogou uses redirect URLs, try to get direct URL or use as-is
					if (!url.startsWith('http')) {
						url = 'https://weixin.sogou.com' + url;
					}

					results.push({
						title: title,
						url: url,
						description: gzhName ? `[${gzhName}] ${abstract}` : abstract,
						engine: 'weixin'
					});
				}
			} catch (e) {
				// Skip malformed items
			}
		});

		return results;
	} catch (error) {
		console.error('❌ Weixin search error:', error.message);
		return [];
	}
}

/**
 * Search GitHub
 * Uses GitHub's search API for code, repositories, and issues
 * Reference: https://github.com/search/advanced
 */
async function searchGitHub(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for GitHub search');
	}

	try {
		// Note: GitHub works best with English keywords
		// The AI assistant is instructed to use English keywords for GitHub searches via the tool description in prompts.ts

		// Use GitHub web search (more reliable without API token)
		// type=repositories for repo search, type=code for code search
		const response = await axios.get('https://github.com/search', {
			params: {
				q: query,
				type: 'repositories',  // repositories, code, issues, discussions
			},
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		// Parse repository search results
		// GitHub uses data-testid or specific classes for search results
		$('[data-testid="results-list"] > div, .repo-list-item, .search-results .repo-list-item, .Box-row').each((i, element) => {
			if (results.length >= limit) return false;

			try {
				// Try different selectors for repository name/link
				let linkElement = $(element).find('a.v-align-middle, a.Link--primary, .text-bold a, a[data-hydro-click]').first();
				if (!linkElement.length) {
					linkElement = $(element).find('h3 a, .f4 a').first();
				}

				let url = linkElement.attr('href');
				let title = linkElement.text().trim();

				// Description
				let description = $(element).find('p.mb-1, p.pinned-item-desc, .text-gray, p.color-fg-muted').first().text().trim();

				// Stars, language, etc.
				let stars = $(element).find('[aria-label*="star"], .octicon-star').parent().text().trim() ||
					$(element).find('.mr-3').first().text().trim();
				let language = $(element).find('[itemprop="programmingLanguage"], .text-gray span').first().text().trim();

				if (url && title) {
					if (!url.startsWith('http')) {
						url = 'https://github.com' + url;
					}

					// Build description with metadata
					let fullDesc = description;
					if (language || stars) {
						const meta = [language, stars].filter(Boolean).join(' · ');
						fullDesc = meta ? `[${meta}] ${description}` : description;
					}

					results.push({
						title: title,
						url: url,
						description: fullDesc || 'No description',
						engine: 'github'
					});
				}
			} catch (e) {
				// Skip malformed items
			}
		});

		// If no results from repo search, try searching "code" or fallback parsing
		if (results.length === 0) {
			// Try alternative parsing for newer GitHub layout
			$('article.Box-row, .search-result-item').each((i, element) => {
				if (results.length >= limit) return false;

				try {
					let linkElement = $(element).find('a').first();
					let url = linkElement.attr('href');
					let title = linkElement.text().trim();
					let description = $(element).find('p').first().text().trim();

					if (url && title && !url.includes('/search')) {
						if (!url.startsWith('http')) {
							url = 'https://github.com' + url;
						}
						results.push({
							title: title,
							url: url,
							description: description || 'GitHub repository',
							engine: 'github'
						});
					}
				} catch (e) { }
			});
		}

		return results;
	} catch (error) {
		console.error('❌ GitHub search error:', error.message);
		return [];
	}
}

/**
 * Search Google Scholar (Academic Search)
 * Web scraping approach - no official API available
 * Uses rotating User-Agents and careful request timing to avoid blocking
 */
async function searchGoogleScholar(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Google Scholar search');
	}

	try {
		// Rotating User-Agents to reduce blocking risk
		const userAgents = [
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		];
		const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

		// Google Scholar search URL
		const response = await axios.get('https://scholar.google.com/scholar', {
			params: {
				q: query,
				hl: 'en',
				num: Math.min(limit, 20)  // Google Scholar max per page
			},
			headers: {
				'User-Agent': randomUA,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9',
				'Accept-Encoding': 'gzip, deflate, br',
				'Connection': 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
				'Cache-Control': 'max-age=0'
			},
			timeout: DEFAULT_TIMEOUT,
			maxRedirects: 5
		});

		const $ = cheerio.load(response.data);
		const results = [];

		// Parse search results
		// Each result is in a div with class .gs_r.gs_or.gs_scl
		$('.gs_r.gs_or.gs_scl').each((i, element) => {
			if (results.length >= limit) return false;

			try {
				// Title and link - in .gs_rt
				const titleElement = $(element).find('.gs_rt');
				const linkElement = titleElement.find('a');

				let title = titleElement.text().trim();
				// Remove [PDF], [HTML], [BOOK] prefixes
				title = title.replace(/^\[\w+\]\s*/i, '').trim();

				let url = linkElement.attr('href') || '';

				// Author/publication info - in .gs_a
				const authorInfo = $(element).find('.gs_a').text().trim();

				// Snippet - in .gs_rs
				const snippet = $(element).find('.gs_rs').text().trim().replace(/\s+/g, ' ');

				// Citation count - look for "Cited by X"
				let citedBy = '';
				$(element).find('.gs_fl a').each((j, link) => {
					const text = $(link).text();
					if (text.includes('Cited by')) {
						citedBy = text;
					}
				});

				// If no direct URL, try to construct from Google Scholar
				if (!url && linkElement.attr('data-clk')) {
					// Some results link to Google Scholar cluster pages
					const id = linkElement.attr('id');
					if (id) {
						url = `https://scholar.google.com/scholar?cluster=${id}`;
					}
				}

				if (title && (url || authorInfo)) {
					// Build description
					let description = '';
					if (authorInfo) description += `[${authorInfo}] `;
					if (citedBy) description += `(${citedBy}) `;
					if (snippet) description += snippet.substring(0, 200) + (snippet.length > 200 ? '...' : '');

					results.push({
						title: title,
						url: url || `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`,
						description: description || 'Academic Publication',
						engine: 'googlescholar'
					});
				}
			} catch (e) {
				// Skip malformed entries
			}
		});

		// Fallback: try alternative selector if no results
		if (results.length === 0) {
			$('.gs_ri').each((i, element) => {
				if (results.length >= limit) return false;

				try {
					const titleElement = $(element).find('.gs_rt a');
					const title = titleElement.text().trim();
					const url = titleElement.attr('href') || '';
					const authorInfo = $(element).find('.gs_a').text().trim();
					const snippet = $(element).find('.gs_rs').text().trim();

					if (title) {
						results.push({
							title: title,
							url: url || `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`,
							description: `[${authorInfo}] ${snippet}`.substring(0, 300),
							engine: 'googlescholar'
						});
					}
				} catch (e) {
					// Skip
				}
			});
		}

		return results;
	} catch (error) {
		// Handle common errors silently
		const msg = error.message || '';
		if (msg.includes('429') || msg.includes('blocked') || msg.includes('captcha')) {
			// Rate limited or blocked - expected for Google Scholar
			return [];
		}
		console.error('❌ Google Scholar search error:', error.message);
		return [];
	}
}

/**
 * Search PubMed (Biomedical Literature)
 * Uses NCBI E-utilities API: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 * Free API, no key required (but rate limited)
 */
async function searchPubMed(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for PubMed search');
	}

	try {
		// Step 1: ESearch to get PMIDs
		const searchResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
			params: {
				db: 'pubmed',
				term: query,
				retmax: limit,
				retmode: 'json',
				sort: 'relevance'
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/json'
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const pmids = searchResponse.data?.esearchresult?.idlist || [];
		if (pmids.length === 0) {
			return [];
		}

		// Step 2: ESummary to get article details
		const summaryResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
			params: {
				db: 'pubmed',
				id: pmids.join(','),
				retmode: 'json'
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/json'
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const results = [];
		const summaryResult = summaryResponse.data?.result || {};

		for (const pmid of pmids) {
			if (results.length >= limit) break;

			try {
				const article = summaryResult[pmid];
				if (!article) continue;

				const title = article.title || '';
				const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

				// Get authors (max 3)
				const authors = article.authors || [];
				const authorStr = authors.slice(0, 3).map(a => a.name).join(', ') + (authors.length > 3 ? ' et al.' : '');

				// Publication info
				const pubDate = article.pubdate || '';
				const source = article.source || '';  // Journal name
				const volume = article.volume || '';
				const issue = article.issue || '';

				if (title) {
					// Build description with metadata
					let description = '';
					if (authorStr) description += `[${authorStr}] `;
					if (pubDate) description += `(${pubDate}) `;
					if (source) {
						description += `[${source}`;
						if (volume) description += ` ${volume}`;
						if (issue) description += `(${issue})`;
						description += '] ';
					}

					results.push({
						title: title,
						url: url,
						description: description || 'Biomedical Publication',
						engine: 'pubmed'
					});
				}
			} catch (e) {
				// Skip malformed entries
			}
		}

		return results;
	} catch (error) {
		console.error('❌ PubMed search error:', error.message);
		return [];
	}
}

/**
 * Search DBLP (Computer Science Bibliography)
 * Uses DBLP Search API: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
 * Free API, no key required
 */
async function searchDBLP(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for DBLP search');
	}

	try {
		// DBLP Publication Search API
		// https://dblp.org/search/publ/api?q=query&format=json&h=limit
		const response = await axios.get('https://dblp.org/search/publ/api', {
			params: {
				q: query,
				format: 'json',
				h: limit,
				c: 0  // Disable completions for faster response
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/json'
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const results = [];
		const hits = response.data?.result?.hits?.hit || [];

		for (const hit of hits) {
			if (results.length >= limit) break;

			try {
				const info = hit.info || {};
				const title = info.title || '';
				const url = info.url || info.ee || '';

				// Get authors
				let authorStr = '';
				if (info.authors?.author) {
					const authors = Array.isArray(info.authors.author) ? info.authors.author : [info.authors.author];
					authorStr = authors.slice(0, 3).map(a => typeof a === 'string' ? a : a.text).join(', ');
					if (authors.length > 3) authorStr += ' et al.';
				}

				// Year and venue
				const year = info.year ? `(${info.year})` : '';
				const venue = info.venue || '';
				const type = info.type || '';

				if (url && title) {
					// Build description with metadata
					let description = '';
					if (authorStr) description += `[${authorStr}] `;
					if (year) description += `${year} `;
					if (venue) description += `[${venue}] `;
					if (type) description += `(${type})`;

					results.push({
						title: title,
						url: url,
						description: description || 'Computer Science Publication',
						engine: 'dblp'
					});
				}
			} catch (e) {
				// Skip malformed entries
			}
		}

		return results;
	} catch (error) {
		console.error('❌ DBLP search error:', error.message);
		return [];
	}
}

/**
 * Search Semantic Scholar (AI-Powered Academic Search)
 * Uses Semantic Scholar Academic Graph API: https://api.semanticscholar.org/api-docs/graph
 * Free API, no key required for basic usage
 */
async function searchSemanticScholar(query, limit = 10) {
	if (!axios) {
		throw new Error('axios is required for Semantic Scholar search');
	}

	try {
		// Semantic Scholar Academic Graph API - Paper Relevance Search
		// This endpoint uses their custom-trained ranker for keyword search
		const response = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
			params: {
				query: query,
				limit: limit,
				fields: 'title,url,abstract,authors,year,citationCount,openAccessPdf'
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/json'
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const results = [];
		const papers = response.data?.data || [];

		for (const paper of papers) {
			if (results.length >= limit) break;

			try {
				const title = paper.title || '';
				// Use the semantic scholar URL or openAccessPdf if available
				const url = paper.url || (paper.openAccessPdf?.url) || `https://www.semanticscholar.org/paper/${paper.paperId}`;
				const abstract = paper.abstract || '';

				// Get authors (max 3)
				const authors = paper.authors || [];
				const authorStr = authors.slice(0, 3).map(a => a.name).join(', ') + (authors.length > 3 ? ' et al.' : '');

				// Year and citation count
				const year = paper.year ? `(${paper.year})` : '';
				const citations = paper.citationCount ? `[${paper.citationCount} citations]` : '';

				if (url && title) {
					// Build description with metadata
					let description = '';
					if (authorStr) description += `[${authorStr}] `;
					if (year) description += `${year} `;
					if (citations) description += `${citations} `;
					description += abstract.substring(0, 200) + (abstract.length > 200 ? '...' : '');

					results.push({
						title: title,
						url: url,
						description: description || 'No abstract available',
						engine: 'semanticscholar'
					});
				}
			} catch (e) {
				// Skip malformed entries
			}
		}

		return results;
	} catch (error) {
		console.error('❌ Semantic Scholar search error:', error.message);
		return [];
	}
}

/**
 * Search arXiv (Academic Papers)
 * Uses arXiv API: https://arxiv.org/help/api/
 * Reference: arxiv-mcp-server project
 */
async function searchArxiv(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for arXiv search');
	}

	try {
		// arXiv API endpoint
		// search_query supports: all, ti (title), au (author), abs (abstract), cat (category)
		// sortBy: relevance, lastUpdatedDate, submittedDate
		const response = await axios.get('http://export.arxiv.org/api/query', {
			params: {
				search_query: `all:${query}`,
				start: 0,
				max_results: limit,
				sortBy: 'relevance',
				sortOrder: 'descending'
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'application/atom+xml'
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data, { xmlMode: true });
		const results = [];

		// Parse Atom feed entries
		$('entry').each((i, element) => {
			if (results.length >= limit) return false;

			try {
				const title = $(element).find('title').text().trim().replace(/\s+/g, ' ');
				const summary = $(element).find('summary').text().trim().replace(/\s+/g, ' ');
				const published = $(element).find('published').text().trim();

				// Get the abstract page URL (not PDF)
				let url = '';
				$(element).find('link').each((j, link) => {
					const href = $(link).attr('href');
					const type = $(link).attr('type');
					// Prefer the abstract page (text/html) over PDF
					if (type === 'text/html' && href) {
						url = href;
					} else if (!url && href && href.includes('arxiv.org/abs')) {
						url = href;
					}
				});

				// Fallback to PDF URL if no abstract URL found
				if (!url) {
					$(element).find('link').each((j, link) => {
						const href = $(link).attr('href');
						if (href && href.includes('arxiv.org')) {
							url = href;
							return false;
						}
					});
				}

				// Get authors
				const authors = [];
				$(element).find('author name').each((j, authorEl) => {
					authors.push($(authorEl).text().trim());
				});
				const authorStr = authors.slice(0, 3).join(', ') + (authors.length > 3 ? ' et al.' : '');

				// Get categories
				const categories = [];
				$(element).find('category').each((j, catEl) => {
					const term = $(catEl).attr('term');
					if (term) categories.push(term);
				});
				const categoryStr = categories.slice(0, 3).join(', ');

				// Format published date
				const pubDate = published ? published.split('T')[0] : '';

				if (url && title) {
					// Build description with metadata
					let description = '';
					if (authorStr) description += `[${authorStr}] `;
					if (pubDate) description += `(${pubDate}) `;
					if (categoryStr) description += `[${categoryStr}] `;
					description += summary.substring(0, 200) + (summary.length > 200 ? '...' : '');

					results.push({
						title: title,
						url: url,
						description: description,
						engine: 'arxiv'
					});
				}
			} catch (e) {
				// Skip malformed entries
			}
		});

		return results;
	} catch (error) {
		console.error('❌ arXiv search error:', error.message);
		return [];
	}
}

/**
 * Search Zhihu
 */
async function searchZhihu(query, limit = 10) {
	if (!axios || !cheerio) {
		throw new Error('axios and cheerio are required for Zhihu search');
	}

	try {
		const response = await axios.get('https://www.zhihu.com/search', {
			params: {
				type: 'content',
				q: query,
			},
			headers: {
				'User-Agent': DEFAULT_USER_AGENT,
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			},
			timeout: DEFAULT_TIMEOUT,
		});

		const $ = cheerio.load(response.data);
		const results = [];

		$('.List-item').each((i, element) => {
			if (results.length >= limit) return false;

			const titleElement = $(element).find('.ContentItem-title a');
			const snippetElement = $(element).find('.RichContent-inner');

			if (titleElement.length) {
				const url = titleElement.attr('href');
				if (url) {
					const fullUrl = url.startsWith('http') ? url : `https://www.zhihu.com${url}`;
					results.push({
						title: titleElement.text().trim(),
						url: fullUrl,
						description: snippetElement.text().trim().substring(0, 200) || '',
						engine: 'zhihu'
					});
				}
			}
		});

		return results;
	} catch (error) {
		console.error('❌ Zhihu search error:', error.message);
		return [];
	}
}

/**
 * Deduplicate results by URL
 */
function deduplicateResults(results) {
	const seen = new Set();
	return results.filter(result => {
		if (seen.has(result.url)) {
			return false;
		}
		seen.add(result.url);
		return true;
	});
}

/**
 * Filter results by relevance to query keywords
 * Removes results that don't contain any query keywords in title or description
 */
function filterByRelevance(results, query) {
	// Extract meaningful keywords from query (ignore common words)
	const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
		'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
		'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
		'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
		'through', 'during', 'before', 'after', 'above', 'below', 'between',
		'and', 'or', 'but', 'if', 'because', 'while', 'although', 'though',
		'的', '是', '在', '了', '和', '与', '或', '则', '而', '但', '可以', '如何', '什么', '怎么',
		'这', '那', '一个', '一些', '有', '要', '从', '用', '为', '以', '到', '就', '上', '下']);

	const keywords = query.toLowerCase()
		.split(/[\s,.，。？！；：]+/)
		.filter(w => w.length > 1 && !stopWords.has(w));

	if (keywords.length === 0) return results; // No filtering if no keywords

	return results.filter(result => {
		const text = `${result.title || ''} ${result.description || ''}`.toLowerCase();
		// Result must contain at least one keyword
		return keywords.some(kw => text.includes(kw));
	});
}

/**
 * Perform multi-engine search
 * If no engines specified, use ALL available engines
 * Limit per engine to ensure diversity
 */
async function performSearch(query, engines = null, limit = 16) {
	// Default: use all available engines for maximum coverage
	const allEngines = ['jina', 'bing', 'baidu', 'duckduckgo', 'csdn', 'juejin', 'brave', 'zhihu', 'weixin', 'github', 'arxiv', 'semanticscholar', 'dblp', 'pubmed', 'googlescholar'];
	const selectedEngines = engines && engines.length > 0 ? engines : allEngines;

	// Calculate per-engine limit to keep total reasonable
	// With 10 engines, limit each to ~3 results to get ~16-20 total after dedup
	const perEngineLimit = Math.max(2, Math.ceil(limit / selectedEngines.length) + 1);

	const searchPromises = [];

	// Create search promises for each engine with LIMITED results
	for (const engine of selectedEngines) {
		switch (engine.toLowerCase()) {
			case 'jina':
				searchPromises.push(searchJina(query, perEngineLimit));
				break;
			case 'baidu':
				searchPromises.push(searchBaidu(query, perEngineLimit));
				break;
			case 'bing':
				searchPromises.push(searchBing(query, perEngineLimit));
				break;
			case 'duckduckgo':
			case 'ddg':
				searchPromises.push(searchDuckDuckGo(query, perEngineLimit));
				break;
			case 'csdn':
				searchPromises.push(searchCSDN(query, perEngineLimit));
				break;
			case 'juejin':
				searchPromises.push(searchJuejin(query, perEngineLimit));
				break;
			case 'brave':
				searchPromises.push(searchBrave(query, perEngineLimit));
				break;
			case 'zhihu':
				searchPromises.push(searchZhihu(query, perEngineLimit));
				break;
			case 'weixin':
			case 'wechat':
				searchPromises.push(searchWeixin(query, perEngineLimit));
				break;
			case 'github':
			case 'gh':
				searchPromises.push(searchGitHub(query, perEngineLimit));
				break;
			case 'arxiv':
				searchPromises.push(searchArxiv(query, perEngineLimit));
				break;
			case 'semanticscholar':
			case 's2':
				searchPromises.push(searchSemanticScholar(query, perEngineLimit));
				break;
			case 'dblp':
				searchPromises.push(searchDBLP(query, perEngineLimit));
				break;
			case 'pubmed':
				searchPromises.push(searchPubMed(query, perEngineLimit));
				break;
			case 'googlescholar':
			case 'scholar':
			case 'gscholar':
				searchPromises.push(searchGoogleScholar(query, perEngineLimit));
				break;
			default:
				console.warn(`⚠️  Unknown engine: ${engine}`);
		}
	}

	// Execute all searches in parallel (所有引擎同时并行执行)
	// Promise.allSettled 确保所有引擎并行执行，不会串行阻塞
	// 每个搜索引擎函数内部已经有超时设置（通过axios的timeout参数），所以不需要额外包装

	// 使用整体超时控制：如果超过OVERALL_SEARCH_TIMEOUT，返回已获得的结果
	const overallTimeoutPromise = new Promise((resolve) => {
		setTimeout(() => resolve('overall_timeout'), OVERALL_SEARCH_TIMEOUT);
	});

	// 执行所有搜索（并行），设置整体超时
	const searchResultsPromise = Promise.allSettled(searchPromises);

	let results;
	const raceResult = await Promise.race([searchResultsPromise, overallTimeoutPromise]);

	if (raceResult === 'overall_timeout') {
		// 整体超时，等待一小段时间（500ms）让部分请求完成，然后返回已获得的结果
		console.warn(`⚠️  Search overall timeout after ${OVERALL_SEARCH_TIMEOUT}ms, returning partial results`);
		await new Promise(resolve => setTimeout(resolve, 500));

		// 获取当前已完成的结果（不等待未完成的）
		// 为每个promise添加快速超时（50ms），只获取已完成的结果
		results = await Promise.allSettled(searchPromises.map(p =>
			Promise.race([
				p,
				new Promise((resolve) => {
					setTimeout(() => resolve([]), 50); // 快速超时，返回空数组表示未完成
				})
			])
		));
	} else {
		results = raceResult;
	}

	// Collect successful results by engine
	const resultsByEngine = {};
	const engineStats = {};

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const engineName = selectedEngines[i];

		if (result.status === 'fulfilled' && result.value) {
			resultsByEngine[engineName] = result.value;
			engineStats[engineName] = result.value.length;
		} else {
			resultsByEngine[engineName] = [];
			engineStats[engineName] = 0;

			// Error handling: Suppress known/expected errors to keep logs clean
			const errorMsg = result.reason?.message || 'Unknown error';
			const isJina401 = engineName === 'jina' && errorMsg.includes('401');
			const isZhihu403 = engineName === 'zhihu' && errorMsg.includes('403');
			const isWeixinAntiSpider = engineName === 'weixin' && (errorMsg.includes('antispider') || errorMsg.includes('403'));
			const isGitHubRateLimit = engineName === 'github' && (errorMsg.includes('429') || errorMsg.includes('rate limit'));
			const isTimeout = errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout');

			if (!isJina401 && !isZhihu403 && !isWeixinAntiSpider && !isGitHubRateLimit && !isTimeout) {
				console.error(`❌ ${engineName} search failed:`, errorMsg);
			}
		}
	}


	// Interleave results (Round-robin) to ensure diversity
	// [Bing1, Baidu1, Jina1, Bing2, Baidu2, Jina2, ...]
	let allResults = [];
	const maxResultsPerEngine = Math.max(...Object.values(resultsByEngine).map(r => r.length));

	for (let i = 0; i < maxResultsPerEngine; i++) {
		for (const engine of selectedEngines) {
			const engineResults = resultsByEngine[engine];
			if (engineResults && engineResults[i]) {
				allResults.push(engineResults[i]);
			}
		}
	}

	// Deduplicate results
	allResults = deduplicateResults(allResults);

	// Filter by relevance to query
	allResults = filterByRelevance(allResults, query);

	// Limit total results
	allResults = allResults.slice(0, limit);

	return allResults;
}

/**
 * Create HTTP server
 */
function createServer(port = 3001) {
	const server = http.createServer(async (req, res) => {
		// Enable CORS
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		// Handle OPTIONS request
		if (req.method === 'OPTIONS') {
			res.writeHead(200);
			res.end();
			return;
		}

		// Only handle POST requests
		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
			return;
		}

		// Parse request body
		let body = '';
		req.on('data', chunk => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				const params = JSON.parse(body);
				const { query, engines, limit } = params;

				if (!query) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Query parameter is required' }));
					return;
				}

				// Perform search - default engines include weixin and github
				// Default limit is 16 to match frontend display limit
				const defaultEngines = ['jina', 'bing', 'baidu', 'duckduckgo', 'csdn', 'juejin', 'brave', 'zhihu', 'weixin', 'github', 'arxiv', 'semanticscholar', 'dblp', 'pubmed', 'googlescholar'];
				const results = await performSearch(
					query,
					engines || defaultEngines,
					limit || 16
				);

				// Return results
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					query,
					engines: engines || defaultEngines,
					total: results.length,
					results
				}));
			} catch (error) {
				console.error('❌ Request error:', error);
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
			console.error(`❌ Failed to find an available port after ${maxAttempts} attempts`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {
			console.log(`✅ Web Search server listening on port ${currentPort}`);
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
const port = process.argv[2] ? parseInt(process.argv[2]) : 3001;
createServer(port);
