/**
 * Vision Analysis Backend Server
 * 图片理解和分析服务
 *
 * 功能:
 * - 接收前端已上传的图片URL（推荐）或base64数据（兼容）
 * - 使用glm-4.6v-flash模型进行视觉理解（与助手使用的模型一致）
 * - 动态端口分配（3004起）
 */

const http = require('http');

// 自有API配置（与助手使用的模型一致）
const OWN_API_BASE_URL = 'https://api.newpoc.com/v1';
const VISION_MODEL = 'glm-4.6v-flash'; // 视觉理解模型
const SENWEAVER_UNIFIED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SenWeaver/1.0 Chrome/121.0.0.0 Safari/537.36';

/**
 * 使用glm-4.6v-flash模型分析图片（通过URL，不传base64）
 * 与助手使用的模型一致
 * @param {string[]} imageUrls - 图片URL数组（支持多张图片）
 * @param {string} prompt - 提示词
 * @param {string} apiKey - ownProvider的apiKey（从前端传入，线上WebSocket配置获取）
 */
async function analyzeImageWithAPI(imageUrls, prompt, apiKey) {
	if (!apiKey) {
		throw new Error('API Key is required. Please ensure ownProvider is configured.');
	}

	if (!imageUrls || imageUrls.length === 0) {
		throw new Error('At least one image URL is required.');
	}

	try {
		const fetch = (await import('node-fetch')).default;

		// 添加超时控制（60秒，因为需要等待模型处理图片）
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60000);

		// 构建消息内容：文本 + 所有图片
		const contentParts = [
			{
				type: 'text',
				text: prompt || '请详细分析这些图片的内容、构图、色彩、风格和可能的用途。'
			}
		];

		// 添加所有图片
		for (const imageUrl of imageUrls) {
			contentParts.push({
				type: 'image_url',
				image_url: {
					url: imageUrl
				}
			});
		}

		try {
			const response = await fetch(`${OWN_API_BASE_URL}/chat/completions`, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': SENWEAVER_UNIFIED_UA,
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: VISION_MODEL,
					messages: [
						{
							role: 'user',
							content: contentParts
						}
					],
					max_tokens: 4096
				})
			});
			clearTimeout(timeout);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Vision API error: ${response.status} - ${error}`);
			}

			const result = await response.json();

			return {
				method: 'api',
				model: VISION_MODEL,
				imageUrls: imageUrls,
				imageCount: imageUrls.length,
				analysis: result.choices[0].message.content,
				usage: result.usage
			};
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		if (error.name === 'AbortError') {
			throw new Error('API request timeout (> 60s)');
		}
		throw new Error(`Vision API analysis failed: ${error.message}`);
	}
}

/**
 * 主分析函数
 * 接收前端已上传的图片URL数组，使用glm-4.6v-flash模型进行视觉理解
 * @param {string[]} imageUrls - 图片URL数组（前端已上传）
 * @param {Object} options - 选项
 * @param {string} options.prompt - 提示词
 * @param {string} options.apiKey - ownProvider的apiKey（从前端传入）
 */
async function analyzeImage(imageUrls, options = {}) {
	const startTime = Date.now();

	try {
		// 验证apiKey
		if (!options.apiKey) {
			throw new Error('API Key is required. Please ensure ownProvider is configured via WebSocket.');
		}

		// 验证图片URL数组
		if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
			throw new Error('请提供图片URL数组。图片应由前端上传后传递URL给后端。');
		}

		// 验证每个URL格式
		for (const url of imageUrls) {
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				throw new Error(`无效的图片URL: ${url.substring(0, 50)}...`);
			}
		}

		const apiResult = await analyzeImageWithAPI(imageUrls, options.prompt, options.apiKey);

		const result = {
			success: true,
			analysis: apiResult.analysis,
			model: apiResult.model,
			imageUrls: imageUrls,
			imageCount: imageUrls.length,
			metadata: {
				usage: apiResult.usage,
				processingTime: `${Date.now() - startTime}ms`
			}
		};

		return result;

	} catch (error) {
		console.error(`[Vision] Error: ${error.message}`);
		return {
			success: false,
			error: error.message,
			processingTime: `${Date.now() - startTime}ms`
		};
	}
}

/**
 * HTTP Server
 */
function createServer(port = 3004) {
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
				const { imageUrls, prompt, apiKey } = JSON.parse(body);

				if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'imageUrls array is required' }));
					return;
				}

				if (!apiKey) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'apiKey is required (ownProvider apiKey from WebSocket config)' }));
					return;
				}

				const result = await analyzeImage(imageUrls, { prompt, apiKey });

				res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));

			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					success: false,
					error: error.message,
					stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
				}));
			}
		});

		// 处理请求错误，防止崩溃
		req.on('error', (error) => {
			console.error('[Server] ❌ Request stream error:', error);
			try {
				if (!res.headersSent) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						success: false,
						error: 'Request processing error'
					}));
				}
			} catch (e) {
				console.error('[Server] Failed to send error response:', e);
			}
		});
	});

	// 动态端口分配
	let currentPort = port;
	const maxAttempts = 10;

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			console.error(`❌ Failed to find an available port after ${maxAttempts} attempts (ports ${port}-${currentPort})`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {
			console.log(`🖼️  Vision Analysis Server listening on http://localhost:${currentPort}`);
			console.log(`✨ Vision Model: ${VISION_MODEL}`);
			console.log(`🌐 API: ${OWN_API_BASE_URL}`);
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

// 全局错误处理器 - 防止未捕获的异常导致服务崩溃
process.on('uncaughtException', (error) => {
	console.error('🚨 [CRITICAL] Uncaught Exception:', error);
	console.error('Stack:', error.stack);
	// 不退出进程，继续运行
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('🚨 [CRITICAL] Unhandled Promise Rejection at:', promise);
	console.error('Reason:', reason);
	// 不退出进程，继续运行
});

// Start server
const port = process.argv[2] ? parseInt(process.argv[2]) : 3004;
createServer(port);
