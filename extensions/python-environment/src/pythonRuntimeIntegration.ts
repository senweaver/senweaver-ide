/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Python Runtime Integration
 * Integrates builtin Python runtime into Python environment extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

/**
 * Detect builtin Python runtime
 */
export async function detectBuiltinPython(): Promise<PythonEnvironment | undefined> {
	try {
		// Check if builtin Python is enabled in configuration
		const config = vscode.workspace.getConfiguration('python');
		const useBuiltin = config.get<boolean>('runtime.useBuiltin', true);
		if (!useBuiltin) {
			return undefined;
		}

		// Get user data directory
		const userDataPath = vscode.env.appName === 'code-oss-dev' 
			? path.join(os.homedir(), '.vscode-oss-dev')
			: path.join(os.homedir(), '.vscode');
		
		// Build builtin Python storage path
		const pythonRuntimePath = path.join(userDataPath, 'python-runtime');
		
		if (!fs.existsSync(pythonRuntimePath)) {
			return undefined;
		}

		// Find installed Python versions
		const preferredVersion = config.get<string>('runtime.preferredVersion', '3.12.4');
		const versions = ['3.13.1', '3.12.4', '3.11.9', '3.10.13', '3.9.18'];
		const checkVersions = [preferredVersion, ...versions.filter(v => v !== preferredVersion)];

		for (const version of checkVersions) {
			const platformName = os.platform();
			const archName = os.arch();
			const installPath = path.join(pythonRuntimePath, `python-${version}-${platformName}-${archName}`);
			
			let pythonPath: string;
			if (platformName === 'win32') {
				pythonPath = path.join(installPath, 'python.exe');
			} else {
				pythonPath = path.join(installPath, 'bin', 'python3');
			}

			if (fs.existsSync(pythonPath)) {
				// Verify Python is available
				try {
					const { stdout } = await execAsync(`"${pythonPath}" --version`);
					const versionMatch = stdout.match(/Python (\d+\.\d+\.\d+)/);
					
					return {
						name: `Builtin Python ${version}`,
						path: pythonPath,
						version: versionMatch ? versionMatch[1] : version,
						type: 'system' as const,
						isActive: true
					};
				} catch (error) {
					// Python not available, continue to next version
					continue;
				}
			}
		}

		return undefined;
	} catch (error) {
		console.error('[PythonEnvironment] Failed to detect builtin Python:', error);
		return undefined;
	}
}

interface PythonEnvironment {
	name: string;
	path: string;
	version?: string;
	type: 'system' | 'venv' | 'conda' | 'pyenv' | 'poetry' | 'pipenv';
	isActive?: boolean;
}
