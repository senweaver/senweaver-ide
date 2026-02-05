/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'original-fs';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { configurePortable } from './bootstrap-node.js';
import { bootstrapESM } from './bootstrap-esm.js';
import { fileURLToPath } from 'url';
import { app, protocol, crashReporter, Menu, contentTracing } from 'electron';
import minimist from 'minimist';
import { product } from './bootstrap-meta.js';
import { parse } from './vs/base/common/jsonc.js';
import { getUserDataPath } from './vs/platform/environment/node/userDataPath.js';
import * as perf from './vs/base/common/performance.js';
import { resolveNLSConfiguration } from './vs/base/node/nls.js';
import { getUNCHost, addUNCHostToAllowlist } from './vs/base/node/unc.js';
import { INLSConfiguration } from './vs/nls.js';
import { NativeParsedArgs } from './vs/platform/environment/common/argv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

perf.mark('code/didStartMain');

perf.mark('code/willLoadMainBundle', {
	startTime: Math.floor(performance.timeOrigin)
});
perf.mark('code/didLoadMainBundle');

// Enable portable support
const portable = configurePortable(product);

const args = parseCLIArgs();
// Configure static command line arguments
const argvConfig = configureCommandlineSwitchesSync(args);
if (args['sandbox'] &&
	!args['disable-chromium-sandbox'] &&
	!argvConfig['disable-chromium-sandbox']) {
	app.enableSandbox();
} else if (app.commandLine.hasSwitch('no-sandbox') &&
	!app.commandLine.hasSwitch('disable-gpu-sandbox')) {
	// Disable GPU sandbox whenever --no-sandbox is used.
	app.commandLine.appendSwitch('disable-gpu-sandbox');
} else {
	app.commandLine.appendSwitch('no-sandbox');
	app.commandLine.appendSwitch('disable-gpu-sandbox');
}

// Set userData path before app 'ready' event
const userDataPath = getUserDataPath(args, product.nameShort ?? 'code-oss-dev');
if (process.platform === 'win32') {
	const userDataUNCHost = getUNCHost(userDataPath);
	if (userDataUNCHost) {
		addUNCHostToAllowlist(userDataUNCHost); // enables to use UNC paths in userDataPath
	}
}
app.setPath('userData', userDataPath);

// Resolve code cache path
const codeCachePath = getCodeCachePath();
Menu.setApplicationMenu(null);

// Configure crash reporter
perf.mark('code/willStartCrashReporter');
if (args['crash-reporter-directory'] || (argvConfig['enable-crash-reporter'] && !args['disable-crash-reporter'])) {
	configureCrashReporter();
}
perf.mark('code/didStartCrashReporter');
if (portable && portable.isPortable) {
	app.setAppLogsPath(path.join(userDataPath, 'logs'));
}

// Register custom schemes with privileges
protocol.registerSchemesAsPrivileged([
	{
		scheme: 'vscode-webview',
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true, codeCache: true }
	},
	{
		scheme: 'vscode-file',
		privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, codeCache: true }
	}
]);

// Global app listeners
registerListeners();

/**
 * We can resolve the NLS configuration early if it is defined
 * in argv.json before `app.ready` event. Otherwise we can only
 * resolve NLS after `app.ready` event to resolve the OS locale.
 */
let nlsConfigurationPromise: Promise<INLSConfiguration> | undefined = undefined;
const osLocale = processZhLocale((app.getPreferredSystemLanguages()?.[0] ?? 'en').toLowerCase());
const userLocale = getUserDefinedLocale(argvConfig) || 'en';
nlsConfigurationPromise = resolveNLSConfiguration({
	userLocale,
	osLocale,
	commit: product.commit,
	userDataPath,
	nlsMetadataPath: __dirname
});

if (process.platform === 'win32' || process.platform === 'linux') {
	const electronLocale = (!userLocale || userLocale === 'qps-ploc') ? 'en' : userLocale;
	app.commandLine.appendSwitch('lang', electronLocale);
}

// Load our code once ready
app.once('ready', function () {
	if (args['trace']) {
		let traceOptions: Electron.TraceConfig | Electron.TraceCategoriesAndOptions;
		if (args['trace-memory-infra']) {
			const customCategories = args['trace-category-filter']?.split(',') || [];
			customCategories.push('disabled-by-default-memory-infra', 'disabled-by-default-memory-infra.v8.code_stats');
			traceOptions = {
				included_categories: customCategories,
				excluded_categories: ['*'],
				memory_dump_config: {
					allowed_dump_modes: ['light', 'detailed'],
					triggers: [
						{
							type: 'periodic_interval',
							mode: 'detailed',
							min_time_between_dumps_ms: 10000
						},
						{
							type: 'periodic_interval',
							mode: 'light',
							min_time_between_dumps_ms: 1000
						}
					]
				}
			};
		} else {
			traceOptions = {
				categoryFilter: args['trace-category-filter'] || '*',
				traceOptions: args['trace-options'] || 'record-until-full,enable-sampling'
			};
		}

		contentTracing.startRecording(traceOptions).finally(() => onReady());
	} else {
		onReady();
	}
});

async function onReady() {
	perf.mark('code/mainAppReady');

	try {
		const [, nlsConfig] = await Promise.all([
			mkdirpIgnoreError(codeCachePath),
			resolveNlsConfiguration()
		]);

		await startup(codeCachePath, nlsConfig);
	} catch (error) {
		console.error(error);
	}
}

/**
 * Main startup routine
 */
async function startup(codeCachePath: string | undefined, nlsConfig: INLSConfiguration): Promise<void> {
	process.env['VSCODE_NLS_CONFIG'] = JSON.stringify(nlsConfig);
	process.env['VSCODE_CODE_CACHE_PATH'] = codeCachePath || '';

	// Start Fetch URL Backend Server (don't await, let it run in background)
	startFetchUrlBackendServer().catch(err => {
		console.error('[fetch_url_backend] Failed to start:', err);
	});

	// Start Web Search Backend Server (don't await, let it run in background)
	startWebSearchBackendServer().catch(err => {
		console.error('[web_search_backend] Failed to start:', err);
	});

	// Start Vision Backend Server (don't await, let it run in background)
	startVisionBackendServer().catch(err => {
		console.error('[vision_backend] Failed to start:', err);
	});

	// Start API Request Backend Server (don't await, let it run in background)
	startApiRequestBackendServer().catch(err => {
		console.error('[api_request_backend] Failed to start:', err);
	});

	// Start Open Browser Backend Server (don't await, let it run in background)
	startOpenBrowserBackendServer().catch(err => {
		console.error('[open_browser_backend] Failed to start:', err);
	});

	// Start Screenshot to Code Backend Server (don't await, let it run in background)
	startScreenshotToCodeBackendServer().catch(err => {
		console.error('[screenshot_to_code_backend] Failed to start:', err);
	});

	// Start Document Reader Backend Server (don't await, let it run in background)
	startDocumentReaderBackendServer().catch(err => {
		console.error('[document_reader_backend] Failed to start:', err);
	});

	// Register process cleanup handlers for unexpected exits
	const cleanupBackendServers = () => {
		stopFetchUrlBackendServer();
		stopWebSearchBackendServer();
		// stopCloneWebsiteBackendServer(); // 已注释
		stopVisionBackendServer();
		stopApiRequestBackendServer();
		stopOpenBrowserBackendServer();
		stopScreenshotToCodeBackendServer();
		stopDocumentReaderBackendServer();
	};

	process.on('SIGINT', () => {
		cleanupBackendServers();
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		cleanupBackendServers();
		process.exit(0);
	});

	process.on('uncaughtException', (error) => {
		console.error('[backend] 💥 Uncaught exception:', error);
		cleanupBackendServers();
		process.exit(1);
	});

	// Bootstrap ESM
	await bootstrapESM();

	// Load Main
	await import('./vs/code/electron-main/main.js');
	perf.mark('code/didRunMainBundle');
}

// Global reference to backend server processes
let fetchUrlBackendProcess: any = null;
let webSearchBackendProcess: any = null;
// let cloneWebsiteBackendProcess: any = null; // 已注释
let visionBackendProcess: any = null;
let apiRequestBackendProcess: any = null;
let openBrowserBackendProcess: any = null;
let screenshotToCodeBackendProcess: any = null;
let documentReaderBackendProcess: any = null;

/**
 * Start Fetch URL Backend Server
 */
async function startFetchUrlBackendServer(): Promise<void> {
	try {
		// Use dynamic import for ES modules
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		// Try multiple possible paths
		const possiblePaths = [
			// Development path (src)
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startFetchUrlServer.cjs'),
			// Compiled path (out)
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startFetchUrlServer.cjs'),
			// Source path
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startFetchUrlServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[fetch_url_backend] ❌ Server file not found in any of the expected locations');
			console.error('[fetch_url_backend] 📋 Tried paths:', possiblePaths);
			return;
		}

		// Spawn the server process with stdio: 'inherit' to see output directly
		const serverProcess = spawn('node', [serverPath, '3000'], {
			detached: false,  // Keep attached to parent process
			stdio: 'inherit'  // Inherit stdio to see all output
		});

		// Store global reference
		fetchUrlBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[fetch_url_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			fetchUrlBackendProcess = null;
		});

	} catch (error) {
		console.error('[fetch_url_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Start Web Search Backend Server
 */
async function startWebSearchBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startWebSearchServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startWebSearchServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startWebSearchServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[web_search_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3001'], {
			detached: false,
			stdio: 'inherit'
		});

		webSearchBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[web_search_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {

			webSearchBackendProcess = null;
		});


	} catch (error) {
		console.error('[web_search_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop Fetch URL Backend Server
 */
function stopFetchUrlBackendServer(): void {
	if (fetchUrlBackendProcess) {
		try {
			// Try SIGTERM first
			fetchUrlBackendProcess.kill('SIGTERM');

			// Force kill after 2 seconds if still alive
			setTimeout(() => {
				if (fetchUrlBackendProcess && !fetchUrlBackendProcess.killed) {
					fetchUrlBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[fetch_url_backend] ⚠️  Error stopping backend server:', error);
			// Force kill if SIGTERM failed
			try {
				if (fetchUrlBackendProcess) {
					fetchUrlBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[fetch_url_backend] ❌ Failed to force kill:', killError);
			}
		}
		fetchUrlBackendProcess = null;
	}
}

/**
 * Stop Web Search Backend Server
 */
function stopWebSearchBackendServer(): void {
	if (webSearchBackendProcess) {
		try {
			// Try SIGTERM first
			webSearchBackendProcess.kill('SIGTERM');

			// Force kill after 2 seconds if still alive
			setTimeout(() => {
				if (webSearchBackendProcess && !webSearchBackendProcess.killed) {
					webSearchBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[web_search_backend] ⚠️  Error stopping backend server:', error);
			// Force kill if SIGTERM failed
			try {
				if (webSearchBackendProcess) {
					webSearchBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[web_search_backend] ❌ Failed to force kill:', killError);
			}
		}
		webSearchBackendProcess = null;
	}
}

/**
 * Start Vision Backend Server
 */
async function startVisionBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startVisionServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startVisionServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startVisionServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[vision_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3004'], {
			detached: false,
			stdio: 'inherit'
		});

		visionBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[vision_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			visionBackendProcess = null;
		});

	} catch (error) {
		console.error('[vision_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop Vision Backend Server
 */
function stopVisionBackendServer(): void {
	if (visionBackendProcess) {
		try {
			// Try SIGTERM first
			visionBackendProcess.kill('SIGTERM');

			// Force kill after 2 seconds if still alive
			setTimeout(() => {
				if (visionBackendProcess && !visionBackendProcess.killed) {
					visionBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[vision_backend] ⚠️  Error stopping backend server:', error);
			// Force kill if SIGTERM failed
			try {
				if (visionBackendProcess) {
					visionBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[vision_backend] ❌ Failed to force kill:', killError);
			}
		}
		visionBackendProcess = null;
	}
}

/**
 * Start API Request Backend Server
 */
async function startApiRequestBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startApiRequestServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startApiRequestServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startApiRequestServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[api_request_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3005'], {
			detached: false,
			stdio: 'inherit'
		});

		apiRequestBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[api_request_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			apiRequestBackendProcess = null;
		});

	} catch (error) {
		console.error('[api_request_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop API Request Backend Server
 */
function stopApiRequestBackendServer(): void {
	if (apiRequestBackendProcess) {
		try {
			apiRequestBackendProcess.kill('SIGTERM');

			setTimeout(() => {
				if (apiRequestBackendProcess && !apiRequestBackendProcess.killed) {
					apiRequestBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[api_request_backend] ⚠️  Error stopping backend server:', error);
			try {
				if (apiRequestBackendProcess) {
					apiRequestBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[api_request_backend] ❌ Failed to force kill:', killError);
			}
		}
		apiRequestBackendProcess = null;
	}
}

/**
 * Start Open Browser Backend Server
 * Commercial-grade browser automation with Playwright
 */
async function startOpenBrowserBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startOpenBrowserServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startOpenBrowserServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startOpenBrowserServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[open_browser_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3006'], {
			detached: false,
			stdio: 'inherit'
		});

		openBrowserBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[open_browser_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			openBrowserBackendProcess = null;
		});

	} catch (error) {
		console.error('[open_browser_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop Open Browser Backend Server
 */
function stopOpenBrowserBackendServer(): void {
	if (openBrowserBackendProcess) {
		try {
			openBrowserBackendProcess.kill('SIGTERM');

			setTimeout(() => {
				if (openBrowserBackendProcess && !openBrowserBackendProcess.killed) {
					openBrowserBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[open_browser_backend] ⚠️  Error stopping backend server:', error);
			try {
				if (openBrowserBackendProcess) {
					openBrowserBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[open_browser_backend] ❌ Failed to force kill:', killError);
			}
		}
		openBrowserBackendProcess = null;
	}
}

/**
 * Start Screenshot to Code Backend Server
 */
async function startScreenshotToCodeBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startScreenshotToCodeServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startScreenshotToCodeServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startScreenshotToCodeServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[screenshot_to_code_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3007'], {
			detached: false,
			stdio: 'inherit'
		});

		screenshotToCodeBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[screenshot_to_code_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			screenshotToCodeBackendProcess = null;
		});

	} catch (error) {
		console.error('[screenshot_to_code_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop Screenshot to Code Backend Server
 */
function stopScreenshotToCodeBackendServer(): void {
	if (screenshotToCodeBackendProcess) {
		try {
			screenshotToCodeBackendProcess.kill('SIGTERM');

			setTimeout(() => {
				if (screenshotToCodeBackendProcess && !screenshotToCodeBackendProcess.killed) {
					screenshotToCodeBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[screenshot_to_code_backend] ⚠️  Error stopping backend server:', error);
			try {
				if (screenshotToCodeBackendProcess) {
					screenshotToCodeBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[screenshot_to_code_backend] ❌ Failed to force kill:', killError);
			}
		}
		screenshotToCodeBackendProcess = null;
	}
}

/**
 * Start Document Reader Backend Server
 */
async function startDocumentReaderBackendServer(): Promise<void> {
	try {
		const { spawn } = await import('child_process');
		const pathModule = await import('path');
		const fsModule = await import('fs');

		const possiblePaths = [
			pathModule.join(__dirname, 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startDocumentReaderServer.cjs'),
			pathModule.join(process.cwd(), 'out', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startDocumentReaderServer.cjs'),
			pathModule.join(process.cwd(), 'src', 'vs', 'workbench', 'contrib', 'senweaver', 'browser', 'startDocumentReaderServer.cjs'),
		];

		let serverPath: string | null = null;
		for (const testPath of possiblePaths) {
			if (fsModule.existsSync(testPath)) {
				serverPath = testPath;
				break;
			}
		}

		if (!serverPath) {
			console.error('[document_reader_backend] ❌ Server file not found');
			return;
		}

		const serverProcess = spawn('node', [serverPath, '3008'], {
			detached: false,
			stdio: 'inherit'
		});

		documentReaderBackendProcess = serverProcess;

		serverProcess.on('error', (error: Error) => {
			console.error('[document_reader_backend] 💥 Process error:', error);
		});

		serverProcess.on('exit', (code: number | null, signal: string | null) => {
			documentReaderBackendProcess = null;
		});

	} catch (error) {
		console.error('[document_reader_backend] 🚨 Failed to start backend server:', error);
	}
}

/**
 * Stop Document Reader Backend Server
 */
function stopDocumentReaderBackendServer(): void {
	if (documentReaderBackendProcess) {
		try {
			documentReaderBackendProcess.kill('SIGTERM');

			setTimeout(() => {
				if (documentReaderBackendProcess && !documentReaderBackendProcess.killed) {
					documentReaderBackendProcess.kill('SIGKILL');
				}
			}, 2000);

		} catch (error) {
			console.error('[document_reader_backend] ⚠️  Error stopping backend server:', error);
			try {
				if (documentReaderBackendProcess) {
					documentReaderBackendProcess.kill('SIGKILL');
				}
			} catch (killError) {
				console.error('[document_reader_backend] ❌ Failed to force kill:', killError);
			}
		}
		documentReaderBackendProcess = null;
	}
}

function configureCommandlineSwitchesSync(cliArgs: NativeParsedArgs) {
	const SUPPORTED_ELECTRON_SWITCHES = [

		// alias from us for --disable-gpu
		'disable-hardware-acceleration',

		// override for the color profile to use
		'force-color-profile',

		// disable LCD font rendering, a Chromium flag
		'disable-lcd-text',

		// bypass any specified proxy for the given semi-colon-separated list of hosts
		'proxy-bypass-list'
	];

	if (process.platform === 'linux') {

		// Force enable screen readers on Linux via this flag
		SUPPORTED_ELECTRON_SWITCHES.push('force-renderer-accessibility');

		// override which password-store is used on Linux
		SUPPORTED_ELECTRON_SWITCHES.push('password-store');
	}

	const SUPPORTED_MAIN_PROCESS_SWITCHES = [

		// Persistently enable proposed api via argv.json: https://github.com/microsoft/vscode/issues/99775
		'enable-proposed-api',

		// Log level to use. Default is 'info'. Allowed values are 'error', 'warn', 'info', 'debug', 'trace', 'off'.
		'log-level',

		// Use an in-memory storage for secrets
		'use-inmemory-secretstorage'
	];

	// Read argv config
	const argvConfig = readArgvConfigSync();

	Object.keys(argvConfig).forEach(argvKey => {
		const argvValue = argvConfig[argvKey];

		// Append Electron flags to Electron
		if (SUPPORTED_ELECTRON_SWITCHES.indexOf(argvKey) !== -1) {
			if (argvValue === true || argvValue === 'true') {
				if (argvKey === 'disable-hardware-acceleration') {
					app.disableHardwareAcceleration(); // needs to be called explicitly
				} else {
					app.commandLine.appendSwitch(argvKey);
				}
			} else if (typeof argvValue === 'string' && argvValue) {
				if (argvKey === 'password-store') {
					// Password store
					// TODO@TylerLeonhardt: Remove this migration in 3 months
					let migratedArgvValue = argvValue;
					if (argvValue === 'gnome' || argvValue === 'gnome-keyring') {
						migratedArgvValue = 'gnome-libsecret';
					}
					app.commandLine.appendSwitch(argvKey, migratedArgvValue);
				} else {
					app.commandLine.appendSwitch(argvKey, argvValue);
				}
			}
		}

		// Append main process flags to process.argv
		else if (SUPPORTED_MAIN_PROCESS_SWITCHES.indexOf(argvKey) !== -1) {
			switch (argvKey) {
				case 'enable-proposed-api':
					if (Array.isArray(argvValue)) {
						argvValue.forEach(id => id && typeof id === 'string' && process.argv.push('--enable-proposed-api', id));
					} else {
						console.error(`Unexpected value for \`enable-proposed-api\` in argv.json. Expected array of extension ids.`);
					}
					break;

				case 'log-level':
					if (typeof argvValue === 'string') {
						process.argv.push('--log', argvValue);
					} else if (Array.isArray(argvValue)) {
						for (const value of argvValue) {
							process.argv.push('--log', value);
						}
					}
					break;

				case 'use-inmemory-secretstorage':
					if (argvValue) {
						process.argv.push('--use-inmemory-secretstorage');
					}
					break;
			}
		}
	});

	// Following features are enabled from the runtime:
	// `DocumentPolicyIncludeJSCallStacksInCrashReports` - https://www.electronjs.org/docs/latest/api/web-frame-main#framecollectjavascriptcallstack-experimental
	const featuresToEnable =
		`DocumentPolicyIncludeJSCallStacksInCrashReports, ${app.commandLine.getSwitchValue('enable-features')}`;
	app.commandLine.appendSwitch('enable-features', featuresToEnable);

	// Following features are disabled from the runtime:
	// `CalculateNativeWinOcclusion` - Disable native window occlusion tracker (https://groups.google.com/a/chromium.org/g/embedder-dev/c/ZF3uHHyWLKw/m/VDN2hDXMAAAJ)
	const featuresToDisable =
		`CalculateNativeWinOcclusion,${app.commandLine.getSwitchValue('disable-features')}`;
	app.commandLine.appendSwitch('disable-features', featuresToDisable);

	// Blink features to configure.
	// `FontMatchingCTMigration` - Siwtch font matching on macOS to Appkit (Refs https://github.com/microsoft/vscode/issues/224496#issuecomment-2270418470).
	// `StandardizedBrowserZoom` - Disable zoom adjustment for bounding box (https://github.com/microsoft/vscode/issues/232750#issuecomment-2459495394)
	const blinkFeaturesToDisable =
		`FontMatchingCTMigration,StandardizedBrowserZoom,${app.commandLine.getSwitchValue('disable-blink-features')}`;
	app.commandLine.appendSwitch('disable-blink-features', blinkFeaturesToDisable);

	// Support JS Flags
	const jsFlags = getJSFlags(cliArgs);
	if (jsFlags) {
		app.commandLine.appendSwitch('js-flags', jsFlags);
	}

	// Use portal version 4 that supports current_folder option
	// to address https://github.com/microsoft/vscode/issues/213780
	// Runtime sets the default version to 3, refs https://github.com/electron/electron/pull/44426
	app.commandLine.appendSwitch('xdg-portal-required-version', '4');

	return argvConfig;
}

interface IArgvConfig {
	[key: string]: string | string[] | boolean | undefined;
	readonly locale?: string;
	readonly 'disable-lcd-text'?: boolean;
	readonly 'proxy-bypass-list'?: string;
	readonly 'disable-hardware-acceleration'?: boolean;
	readonly 'force-color-profile'?: string;
	readonly 'enable-crash-reporter'?: boolean;
	readonly 'crash-reporter-id'?: string;
	readonly 'enable-proposed-api'?: string[];
	readonly 'log-level'?: string | string[];
	readonly 'disable-chromium-sandbox'?: boolean;
	readonly 'use-inmemory-secretstorage'?: boolean;
}

function readArgvConfigSync(): IArgvConfig {

	// Read or create the argv.json config file sync before app('ready')
	const argvConfigPath = getArgvConfigPath();
	let argvConfig: IArgvConfig | undefined = undefined;
	try {
		argvConfig = parse(fs.readFileSync(argvConfigPath).toString());
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			createDefaultArgvConfigSync(argvConfigPath);
		} else {
			console.warn(`Unable to read argv.json configuration file in ${argvConfigPath}, falling back to defaults (${error})`);
		}
	}

	// Fallback to default
	if (!argvConfig) {
		argvConfig = {};
	}

	return argvConfig;
}

function createDefaultArgvConfigSync(argvConfigPath: string): void {
	try {

		// Ensure argv config parent exists
		const argvConfigPathDirname = path.dirname(argvConfigPath);
		if (!fs.existsSync(argvConfigPathDirname)) {
			fs.mkdirSync(argvConfigPathDirname);
		}

		// Default argv content
		const defaultArgvConfigContent = [
			'// This configuration file allows you to pass permanent command line arguments to VS Code.',
			'// Only a subset of arguments is currently supported to reduce the likelihood of breaking',
			'// the installation.',
			'//',
			'// PLEASE DO NOT CHANGE WITHOUT UNDERSTANDING THE IMPACT',
			'//',
			'// NOTE: Changing this file requires a restart of VS Code.',
			'{',
			'	// Use software rendering instead of hardware accelerated rendering.',
			'	// This can help in cases where you see rendering issues in VS Code.',
			'	// "disable-hardware-acceleration": true',
			'}'
		];

		// Create initial argv.json with default content
		fs.writeFileSync(argvConfigPath, defaultArgvConfigContent.join('\n'));
	} catch (error) {
		console.error(`Unable to create argv.json configuration file in ${argvConfigPath}, falling back to defaults (${error})`);
	}
}

function getArgvConfigPath(): string {
	const vscodePortable = process.env['VSCODE_PORTABLE'];
	if (vscodePortable) {
		return path.join(vscodePortable, 'argv.json');
	}

	let dataFolderName = product.dataFolderName;
	if (process.env['VSCODE_DEV']) {
		dataFolderName = `${dataFolderName}-dev`;
	}

	return path.join(os.homedir(), dataFolderName!, 'argv.json');
}

function configureCrashReporter(): void {
	let crashReporterDirectory = args['crash-reporter-directory'];
	let submitURL = '';
	if (crashReporterDirectory) {
		crashReporterDirectory = path.normalize(crashReporterDirectory);

		if (!path.isAbsolute(crashReporterDirectory)) {
			console.error(`The path '${crashReporterDirectory}' specified for --crash-reporter-directory must be absolute.`);
			app.exit(1);
		}

		if (!fs.existsSync(crashReporterDirectory)) {
			try {
				fs.mkdirSync(crashReporterDirectory, { recursive: true });
			} catch (error) {
				console.error(`The path '${crashReporterDirectory}' specified for --crash-reporter-directory does not seem to exist or cannot be created.`);
				app.exit(1);
			}
		}

		// Crashes are stored in the crashDumps directory by default, so we
		// need to change that directory to the provided one
		app.setPath('crashDumps', crashReporterDirectory);
	}

	// Otherwise we configure the crash reporter from product.json
	else {
		const appCenter = product.appCenter;
		if (appCenter) {
			const isWindows = (process.platform === 'win32');
			const isLinux = (process.platform === 'linux');
			const isDarwin = (process.platform === 'darwin');
			const crashReporterId = argvConfig['crash-reporter-id'];
			const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (crashReporterId && uuidPattern.test(crashReporterId)) {
				if (isWindows) {
					switch (process.arch) {
						case 'x64':
							submitURL = appCenter['win32-x64'];
							break;
						case 'arm64':
							submitURL = appCenter['win32-arm64'];
							break;
					}
				} else if (isDarwin) {
					if (product.darwinUniversalAssetId) {
						submitURL = appCenter['darwin-universal'];
					} else {
						switch (process.arch) {
							case 'x64':
								submitURL = appCenter['darwin'];
								break;
							case 'arm64':
								submitURL = appCenter['darwin-arm64'];
								break;
						}
					}
				} else if (isLinux) {
					submitURL = appCenter['linux-x64'];
				}
				submitURL = submitURL.concat('&uid=', crashReporterId, '&iid=', crashReporterId, '&sid=', crashReporterId);
				// Send the id for child node process that are explicitly starting crash reporter.
				// For vscode this is ExtensionHost process currently.
				const argv = process.argv;
				const endOfArgsMarkerIndex = argv.indexOf('--');
				if (endOfArgsMarkerIndex === -1) {
					argv.push('--crash-reporter-id', crashReporterId);
				} else {
					// if the we have an argument "--" (end of argument marker)
					// we cannot add arguments at the end. rather, we add
					// arguments before the "--" marker.
					argv.splice(endOfArgsMarkerIndex, 0, '--crash-reporter-id', crashReporterId);
				}
			}
		}
	}

	// Start crash reporter for all processes
	const productName = (product.crashReporter ? product.crashReporter.productName : undefined) || product.nameShort;
	const companyName = (product.crashReporter ? product.crashReporter.companyName : undefined) || 'Microsoft';
	const uploadToServer = Boolean(!process.env['VSCODE_DEV'] && submitURL && !crashReporterDirectory);
	crashReporter.start({
		companyName,
		productName: process.env['VSCODE_DEV'] ? `${productName} Dev` : productName,
		submitURL,
		uploadToServer,
		compress: true
	});
}

function getJSFlags(cliArgs: NativeParsedArgs): string | null {
	const jsFlags: string[] = [];

	// Add any existing JS flags we already got from the command line
	if (cliArgs['js-flags']) {
		jsFlags.push(cliArgs['js-flags']);
	}

	if (process.platform === 'linux') {
		// Fix cppgc crash on Linux with 16KB page size.
		// Refs https://issues.chromium.org/issues/378017037
		// The fix from https://github.com/electron/electron/commit/6c5b2ef55e08dc0bede02384747549c1eadac0eb
		// only affects non-renderer process.
		// The following will ensure that the flag will be
		// applied to the renderer process as well.
		// TODO(deepak1556): Remove this once we update to
		// Chromium >= 134.
		jsFlags.push('--nodecommit_pooled_pages');
	}

	return jsFlags.length > 0 ? jsFlags.join(' ') : null;
}

function parseCLIArgs(): NativeParsedArgs {
	return minimist(process.argv, {
		string: [
			'user-data-dir',
			'locale',
			'js-flags',
			'crash-reporter-directory'
		],
		boolean: [
			'disable-chromium-sandbox',
		],
		default: {
			'sandbox': true
		},
		alias: {
			'no-sandbox': 'sandbox'
		}
	});
}

function registerListeners(): void {

	/**
	 * macOS: when someone drops a file to the not-yet running VSCode, the open-file event fires even before
	 * the app-ready event. We listen very early for open-file and remember this upon startup as path to open.
	 */
	const macOpenFiles: string[] = [];
	(globalThis as any)['macOpenFiles'] = macOpenFiles;
	app.on('open-file', function (event, path) {
		macOpenFiles.push(path);
	});

	/**
	 * macOS: react to open-url requests.
	 */
	const openUrls: string[] = [];
	const onOpenUrl =
		function (event: { preventDefault: () => void }, url: string) {
			event.preventDefault();

			openUrls.push(url);
		};

	app.on('will-finish-launching', function () {
		app.on('open-url', onOpenUrl);
	});

	(globalThis as any)['getOpenUrls'] = function () {
		app.removeListener('open-url', onOpenUrl);

		return openUrls;
	};

	/**
	 * Cleanup on app quit
	 */
	app.on('will-quit', () => {
		stopFetchUrlBackendServer();
		stopWebSearchBackendServer();
		// stopCloneWebsiteBackendServer(); // 已注释
		stopVisionBackendServer();
		stopApiRequestBackendServer();
		stopOpenBrowserBackendServer();
	});

	app.on('before-quit', () => {
		stopFetchUrlBackendServer();
		stopWebSearchBackendServer();
		// stopCloneWebsiteBackendServer(); // 已注释
		stopVisionBackendServer();
		stopApiRequestBackendServer();
		stopOpenBrowserBackendServer();
	});
}

function getCodeCachePath(): string | undefined {

	// explicitly disabled via CLI args
	if (process.argv.indexOf('--no-cached-data') > 0) {
		return undefined;
	}

	// running out of sources
	if (process.env['VSCODE_DEV']) {
		return undefined;
	}

	// require commit id
	const commit = product.commit;
	if (!commit) {
		return undefined;
	}

	return path.join(userDataPath, 'CachedData', commit);
}

async function mkdirpIgnoreError(dir: string | undefined): Promise<string | undefined> {
	if (typeof dir === 'string') {
		try {
			await fs.promises.mkdir(dir, { recursive: true });

			return dir;
		} catch (error) {
			// ignore
		}
	}

	return undefined;
}

//#region NLS Support

function processZhLocale(appLocale: string): string {
	if (appLocale.startsWith('zh')) {
		const region = appLocale.split('-')[1];

		// On Windows and macOS, Chinese languages returned by
		// app.getPreferredSystemLanguages() start with zh-hans
		// for Simplified Chinese or zh-hant for Traditional Chinese,
		// so we can easily determine whether to use Simplified or Traditional.
		// However, on Linux, Chinese languages returned by that same API
		// are of the form zh-XY, where XY is a country code.
		// For China (CN), Singapore (SG), and Malaysia (MY)
		// country codes, assume they use Simplified Chinese.
		// For other cases, assume they use Traditional.
		if (['hans', 'cn', 'sg', 'my'].includes(region)) {
			return 'zh-cn';
		}

		return 'zh-tw';
	}

	return appLocale;
}

/**
 * Resolve the NLS configuration
 */
async function resolveNlsConfiguration(): Promise<INLSConfiguration> {

	// First, we need to test a user defined locale.
	// If it fails we try the app locale.
	// If that fails we fall back to English.

	const nlsConfiguration = nlsConfigurationPromise ? await nlsConfigurationPromise : undefined;
	if (nlsConfiguration) {
		return nlsConfiguration;
	}

	// Try to use the app locale which is only valid
	// after the app ready event has been fired.

	let userLocale = app.getLocale();
	if (!userLocale) {
		return {
			userLocale: 'en',
			osLocale,
			resolvedLanguage: 'en',
			defaultMessagesFile: path.join(__dirname, 'nls.messages.json'),

			// NLS: below 2 are a relic from old times only used by vscode-nls and deprecated
			locale: 'en',
			availableLanguages: {}
		};
	}

	// See above the comment about the loader and case sensitiveness
	userLocale = processZhLocale(userLocale.toLowerCase());

	return resolveNLSConfiguration({
		userLocale,
		osLocale,
		commit: product.commit,
		userDataPath,
		nlsMetadataPath: __dirname
	});
}

/**
 * Language tags are case insensitive however an ESM loader is case sensitive
 * To make this work on case preserving & insensitive FS we do the following:
 * the language bundles have lower case language tags and we always lower case
 * the locale we receive from the user or OS.
 */
function getUserDefinedLocale(argvConfig: IArgvConfig): string | undefined {
	const locale = args['locale'];
	if (locale) {
		return locale.toLowerCase(); // a directly provided --locale always wins
	}

	return typeof argvConfig?.locale === 'string' ? argvConfig.locale.toLowerCase() : undefined;
}

//#endregion
