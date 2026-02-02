/**
 * API Request Backend Server
 * Provides a robust API testing tool for the AI assistant
 *
 * Features:
 * - Supports all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Custom headers support
 * - Request body support (JSON, form-data, raw text, etc.)
 * - Authentication support (Basic, Bearer, API Key)
 * - Response parsing and formatting
 * - Timeout control
 * - Error handling
 *
 * Usage: node startApiRequestServer.cjs [port]
 * Default port: 3005
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Try to load axios for better HTTP handling
let axios;
try {
	axios = require('axios');
} catch (error) {
	console.warn('⚠️  axios not available, using native http/https');
}

/**
 * Parse content type to determine response format
 */
function parseContentType(contentType) {
	if (!contentType) return 'text';
	contentType = contentType.toLowerCase();

	if (contentType.includes('application/json')) return 'json';
	if (contentType.includes('application/xml') || contentType.includes('text/xml')) return 'xml';
	if (contentType.includes('text/html')) return 'html';
	if (contentType.includes('text/plain')) return 'text';
	if (contentType.includes('application/x-www-form-urlencoded')) return 'form';
	if (contentType.includes('multipart/form-data')) return 'multipart';

	return 'text';
}

/**
 * Format response body based on content type
 */
function formatResponseBody(body, contentType) {
	const format = parseContentType(contentType);

	if (format === 'json') {
		try {
			// Parse and re-stringify for pretty formatting
			const parsed = typeof body === 'string' ? JSON.parse(body) : body;
			return {
				formatted: JSON.stringify(parsed, null, 2),
				parsed: parsed,
				format: 'json'
			};
		} catch (e) {
			return { formatted: body, parsed: null, format: 'text' };
		}
	}

	return { formatted: body, parsed: null, format: format };
}

/**
 * Build authentication header
 */
function buildAuthHeader(auth) {
	if (!auth || !auth.type) return null;

	switch (auth.type.toLowerCase()) {
		case 'basic':
			if (auth.username && auth.password) {
				const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
				return `Basic ${credentials}`;
			}
			break;
		case 'bearer':
			if (auth.token) {
				return `Bearer ${auth.token}`;
			}
			break;
		case 'apikey':
			// API Key is usually added as a header, handled separately
			return null;
	}
	return null;
}

/**
 * Execute API request using axios
 */
async function executeRequestWithAxios(config) {
	const { url, method, headers, body, auth, timeout } = config;

	// Build request headers
	const requestHeaders = {
		'User-Agent': DEFAULT_USER_AGENT,
		...headers
	};

	// Add authentication
	if (auth) {
		const authHeader = buildAuthHeader(auth);
		if (authHeader) {
			requestHeaders['Authorization'] = authHeader;
		}
		// Handle API Key auth
		if (auth.type === 'apikey' && auth.key && auth.value) {
			if (auth.addTo === 'header') {
				requestHeaders[auth.key] = auth.value;
			}
		}
	}

	// Prepare request config
	const axiosConfig = {
		url,
		method: method.toUpperCase(),
		headers: requestHeaders,
		timeout: timeout || DEFAULT_TIMEOUT,
		validateStatus: () => true, // Accept all status codes
		maxRedirects: 5,
	};

	// Add body for methods that support it
	if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
		// Try to parse as JSON if it looks like JSON
		if (typeof body === 'string') {
			try {
				axiosConfig.data = JSON.parse(body);
				if (!requestHeaders['Content-Type']) {
					requestHeaders['Content-Type'] = 'application/json';
				}
			} catch (e) {
				axiosConfig.data = body;
			}
		} else {
			axiosConfig.data = body;
		}
	}

	// Add query params for API Key auth
	if (auth && auth.type === 'apikey' && auth.addTo === 'query' && auth.key && auth.value) {
		const urlObj = new URL(url);
		urlObj.searchParams.set(auth.key, auth.value);
		axiosConfig.url = urlObj.toString();
	}

	const startTime = Date.now();
	const response = await axios(axiosConfig);
	const endTime = Date.now();

	// Get response body
	let responseBody = response.data;
	if (typeof responseBody === 'object') {
		responseBody = JSON.stringify(responseBody);
	}

	return {
		success: true,
		statusCode: response.status,
		statusText: response.statusText,
		headers: response.headers,
		body: responseBody,
		responseTime: endTime - startTime,
		contentType: response.headers['content-type'] || 'text/plain',
		contentLength: response.headers['content-length'] || responseBody.length,
	};
}

/**
 * Execute API request using native http/https
 */
async function executeRequestNative(config) {
	const { url, method, headers, body, auth, timeout } = config;

	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const isHttps = urlObj.protocol === 'https:';
		const httpModule = isHttps ? https : http;

		// Build request headers
		const requestHeaders = {
			'User-Agent': DEFAULT_USER_AGENT,
			...headers
		};

		// Add authentication
		if (auth) {
			const authHeader = buildAuthHeader(auth);
			if (authHeader) {
				requestHeaders['Authorization'] = authHeader;
			}
		}

		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || (isHttps ? 443 : 80),
			path: urlObj.pathname + urlObj.search,
			method: method.toUpperCase(),
			headers: requestHeaders,
			timeout: timeout || DEFAULT_TIMEOUT,
		};

		const startTime = Date.now();

		const req = httpModule.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				const endTime = Date.now();
				resolve({
					success: true,
					statusCode: res.statusCode,
					statusText: res.statusMessage,
					headers: res.headers,
					body: data,
					responseTime: endTime - startTime,
					contentType: res.headers['content-type'] || 'text/plain',
					contentLength: res.headers['content-length'] || data.length,
				});
			});
		});

		req.on('error', (error) => {
			reject(error);
		});

		req.on('timeout', () => {
			req.destroy();
			reject(new Error('Request timeout'));
		});

		// Send body if present
		if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
			req.write(typeof body === 'object' ? JSON.stringify(body) : body);
		}

		req.end();
	});
}

/**
 * Execute API request
 */
async function executeRequest(config) {
	try {
		// Validate URL
		try {
			new URL(config.url);
		} catch (e) {
			return {
				success: false,
				error: `Invalid URL: ${config.url}`,
				statusCode: 0,
			};
		}

		// Execute request
		let result;
		if (axios) {
			result = await executeRequestWithAxios(config);
		} else {
			result = await executeRequestNative(config);
		}

		// Format response body
		const formatted = formatResponseBody(result.body, result.contentType);

		return {
			...result,
			bodyFormatted: formatted.formatted,
			bodyParsed: formatted.parsed,
			bodyFormat: formatted.format,
		};
	} catch (error) {
		return {
			success: false,
			error: error.message || 'Unknown error',
			statusCode: error.response?.status || 0,
			statusText: error.response?.statusText || 'Error',
		};
	}
}

/**
 * Create HTTP server
 */
function createServer(port = 3005) {
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
				const { url, method = 'GET', headers = {}, body: requestBody, auth, timeout } = params;

				if (!url) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'URL is required' }));
					return;
				}

				// Execute the API request
				const result = await executeRequest({
					url,
					method,
					headers,
					body: requestBody,
					auth,
					timeout,
				});

				// Return results
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
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
			console.log(`✅ API Request server listening on port ${currentPort}`);
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
const port = process.argv[2] ? parseInt(process.argv[2]) : 3005;
createServer(port);
