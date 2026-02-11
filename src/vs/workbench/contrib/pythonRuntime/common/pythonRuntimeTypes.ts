/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Python Runtime Type Definitions
 */

/**
 * Python Version Information
 */
export interface PythonVersion {
	/** Major version number */
	major: number;
	/** Minor version number */
	minor: number;
	/** Patch version number */
	patch: number;
	/** Full version string, e.g., "3.12.0" */
	full: string;
}

/**
 * Python Runtime Information
 */
export interface PythonRuntimeInfo {
	/** Version information */
	version: PythonVersion;
	/** Python executable file path */
	executablePath: string;
	/** Runtime root directory */
	rootPath: string;
	/** Platform information */
	platform: 'win32' | 'darwin' | 'linux';
	/** Architecture information */
	arch: 'x64' | 'arm64';
	/** Whether this is a builtin runtime */
	isBuiltin: boolean;
	/** Installation timestamp */
	installedAt?: number;
}

/**
 * Python Download Options
 */
export interface PythonDownloadOptions {
	/** Version to download */
	version: string;
	/** Download progress callback */
	onProgress?: (progress: DownloadProgress) => void;
	/** Whether to show progress notifications */
	showProgress?: boolean;
}

/**
 * Download Progress Information
 */
export interface DownloadProgress {
	/** Bytes downloaded */
	downloaded: number;
	/** Total bytes */
	total: number;
	/** Download speed (bytes per second) */
	speed: number;
	/** Progress percentage */
	percentage: number;
}

/**
 * Python Runtime Status
 */
export enum PythonRuntimeStatus {
	/** Not installed */
	NotInstalled = 'not_installed',
	/** Downloading */
	Downloading = 'downloading',
	/** Installing */
	Installing = 'installing',
	/** Installed */
	Installed = 'installed',
	/** Error */
	Error = 'error'
}

/**
 * Python Runtime Status Information
 */
export interface PythonRuntimeStatusInfo {
	/** Status */
	status: PythonRuntimeStatus;
	/** Current version */
	version?: string;
	/** Error message (if any) */
	error?: string;
	/** Download progress (if downloading) */
	progress?: DownloadProgress;
}

/**
 * Supported Python Versions List
 */
export const SUPPORTED_PYTHON_VERSIONS = [
	'3.9.18',
	'3.10.13',
	'3.11.9',
	'3.12.4',
	'3.13.1'
] as const;

/**
 * Default Python Version
 */
export const DEFAULT_PYTHON_VERSION = '3.12.4';

/**
 * Python Download URL Template
 */
export interface PythonDownloadUrl {
	/** Windows x64 */
	win32_x64: string;
	/** Windows ARM64 */
	win32_arm64: string;
	/** macOS x64 */
	darwin_x64: string;
	/** macOS ARM64 */
	darwin_arm64: string;
	/** Linux x64 */
	linux_x64: string;
	/** Linux ARM64 */
	linux_arm64: string;
}

/**
 * Get download URL for specified version
 */
export function getPythonDownloadUrl(version: string, platform: NodeJS.Platform, arch: string): string {
	const baseUrl = 'https://www.python.org/ftp/python';
	
	if (platform === 'win32') {
		// Windows uses embedded version (smaller)
		if (arch === 'arm64') {
			return `${baseUrl}/${version}/python-${version}-embed-arm64.zip`;
		}
		return `${baseUrl}/${version}/python-${version}-embed-amd64.zip`;
	} else if (platform === 'darwin') {
		// macOS uses official installer package
		if (arch === 'arm64') {
			return `${baseUrl}/${version}/python-${version}-macos11.pkg`;
		}
		return `${baseUrl}/${version}/python-${version}-macos11.pkg`;
	} else {
		// Linux uses precompiled binaries
		// Note: Python.org doesn't provide precompiled Linux binaries, need to use other sources
		// Here we use pyenv or conda precompiled versions
		const archSuffix = arch === 'arm64' ? 'aarch64' : 'x86_64';
		// Use conda-forge precompiled version
		return `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-${archSuffix}.sh`;
	}
}

/**
 * Parse version string
 */
export function parsePythonVersion(versionString: string): PythonVersion | null {
	const match = versionString.match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!match) {
		return null;
	}
	
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: parseInt(match[3], 10),
		full: versionString
	};
}

/**
 * Compare two versions
 */
export function comparePythonVersions(v1: PythonVersion, v2: PythonVersion): number {
	if (v1.major !== v2.major) {
		return v1.major - v2.major;
	}
	if (v1.minor !== v2.minor) {
		return v1.minor - v2.minor;
	}
	return v1.patch - v2.patch;
}
