/**
 * Test script for fetch URL backend server
 * Usage: node test-fetch-server.js
 */

const http = require('http');

// Test URLs
const testUrls = [
	'https://example.com',
];

/**
 * Send test request to backend server
 */
async function testFetchUrl(url, port = 3001) {
	return new Promise((resolve, reject) => {
		const postData = JSON.stringify({
			url,
			max_length: 1000,
			start_index: 0,
		});

		const options = {
			hostname: 'localhost',
			port,
			path: '/',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData),
			},
		};

		const req = http.request(options, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				try {
					const result = JSON.parse(data);
					resolve(result);
				} catch (error) {
					reject(new Error(`Failed to parse response: ${error.message}`));
				}
			});
		});

		req.on('error', (error) => {
			reject(error);
		});

		req.write(postData);
		req.end();
	});
}

/**
 * Run tests
 */
async function runTests() {
	console.log('🧪 Testing Fetch URL Backend Server\n');
	console.log('Make sure the server is running: node startFetchUrlServer.js\n');

	for (const url of testUrls) {
		console.log(`📄 Testing: ${url}`);
		try {
			const result = await testFetchUrl(url);
			console.log(`   ✅ Status: ${result.statusCode}`);
			console.log(`   📊 Content length: ${result.body?.length || 0} characters`);
			console.log(`   📝 Preview: ${result.body?.substring(0, 100)}...`);
			console.log(`   🔄 Has more: ${result.hasMore ? 'Yes' : 'No'}`);
			console.log('');
		} catch (error) {
			console.log(`   ❌ Error: ${error.message}\n`);
		}
	}

	console.log('✅ Tests complete!');
}

// Run tests
runTests().catch(console.error);
