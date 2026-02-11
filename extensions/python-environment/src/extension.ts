/*
 * Python Environment Manager Extension
 *
 * 提供 Python 虚拟环境的自动检测和管理功能，
 * 与 basedpyright 配合使用，实现完整的 Python 开发体验。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import * as os from 'os';
import { detectBuiltinPython } from './pythonRuntimeIntegration.js';

// Python 环境信息接口
interface PythonEnvironment {
    name: string;
    path: string;
    version?: string;
    type: 'system' | 'venv' | 'conda' | 'pyenv' | 'poetry' | 'pipenv';
    isActive?: boolean;
}

// 全局状态
let statusBarItem: vscode.StatusBarItem;
let currentEnvironment: PythonEnvironment | undefined;
let discoveredEnvironments: PythonEnvironment[] = [];
let environmentChangeEmitter: vscode.EventEmitter<void>;

/**
 * 扩展激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<any> {
    console.log('Python Environment Manager is now active');

    // 创建事件发射器
    environmentChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(environmentChangeEmitter);

    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'python-environment.selectInterpreter';
    statusBarItem.tooltip = 'Select Python Interpreter';
    context.subscriptions.push(statusBarItem);

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('python-environment.selectInterpreter', selectInterpreter),
        vscode.commands.registerCommand('python-environment.refreshEnvironments', refreshEnvironments),
        vscode.commands.registerCommand('python-environment.createVirtualEnv', createVirtualEnv)
    );

    // 监听配置变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('python')) {
                await refreshEnvironments();
                await updateBasedPyrightSettings();
                // 通知 basedpyright 配置已更改
                notifyBasedPyright();
            }
        })
    );

    // 监听工作区变化
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await refreshEnvironments();
            await updateBasedPyrightSettings();
        })
    );

    // 初始化：发现环境并设置
    await refreshEnvironments();
    await autoSelectEnvironment();
    await updateBasedPyrightSettings();

    // 显示状态栏
    updateStatusBar();
    statusBarItem.show();

    // 提供 Python Extension API（兼容 ms-python.python 和 @vscode/python-extension）
    const api = createPythonExtensionApi();

    // 将 API 存储到全局状态，以便其他扩展可以访问
    context.globalState.update('pythonApi', api);

    return api;
}

/**
 * 通知 basedpyright 重新加载配置
 */
async function notifyBasedPyright(): Promise<void> {
    try {
        // 尝试执行 basedpyright 的重启命令
        await vscode.commands.executeCommand('basedpyright.restartserver');
    } catch {
        // 如果命令不存在，忽略错误
    }
}

/**
 * 创建兼容 ms-python.python 的 API
 * 这样 basedpyright 可以通过标准 API 获取 Python 路径
 *
 * 参考: https://github.com/microsoft/vscode-python/blob/main/src/client/api.ts
 * 和 @vscode/python-extension 包的接口定义
 */
function createPythonExtensionApi(): any {
    return {
        // 标记为支持新的解释器存储方式（basedpyright 检查此标志）
        ready: Promise.resolve(),

        // 模拟 packageJSON，包含 featureFlags
        // basedpyright 的 extension.ts 会检查这个标志
        packageJSON: {
            featureFlags: {
                usingNewInterpreterStorage: true
            }
        },

        settings: {
            getExecutionDetails: (resource?: vscode.Uri) => {
                const pythonPath = currentEnvironment?.path || getConfiguredPythonPath(resource);
                return {
                    execCommand: pythonPath ? [pythonPath] : undefined
                };
            },
            onDidChangeExecutionDetails: (callback: () => void): vscode.Disposable => {
                // 当环境变化时通知
                return environmentChangeEmitter.event(callback);
            }
        },

        environments: {
            getActiveEnvironmentPath: (_resource?: vscode.Uri) => {
                const pythonPath = currentEnvironment?.path || getConfiguredPythonPath(_resource);
                return {
                    path: pythonPath || 'python',
                    id: currentEnvironment?.name || 'default'
                };
            },
            resolveEnvironment: async (env: any) => {
                return env;
            },
            known: discoveredEnvironments.map(env => ({
                id: env.name,
                path: env.path,
                version: env.version
            })),
            onDidChangeActiveEnvironmentPath: environmentChangeEmitter.event
        },

        debug: {
            getRemoteLauncherCommand: () => []
        }
    };
}

/**
 * 获取配置的 Python 路径
 */
function getConfiguredPythonPath(resource?: vscode.Uri): string | undefined {
    const config = vscode.workspace.getConfiguration('python', resource);
    return config.get<string>('defaultInterpreterPath') || config.get<string>('pythonPath');
}

/**
 * 刷新环境列表
 */
async function refreshEnvironments(): Promise<void> {
    discoveredEnvironments = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const config = vscode.workspace.getConfiguration('python');
    const autoDetect = config.get<boolean>('autoDetectVirtualEnvs', true);
    const venvFolders = config.get<string[]>('venvFolders', ['.venv', 'venv', '.env', 'env']);
    const venvPath = config.get<string>('venvPath', '');

    // 1. 检测工作区内的虚拟环境
    if (autoDetect) {
        for (const folder of workspaceFolders) {
            // 检查常见的虚拟环境目录
            for (const venvName of venvFolders) {
                const venvDir = path.join(folder.uri.fsPath, venvName);
                const env = await detectVirtualEnv(venvDir, venvName);
                if (env) {
                    discoveredEnvironments.push(env);
                }
            }

            // 检查 Poetry 虚拟环境
            const poetryEnv = await detectPoetryEnv(folder.uri.fsPath);
            if (poetryEnv) {
                discoveredEnvironments.push(poetryEnv);
            }

            // 检查 Pipenv 虚拟环境
            const pipenvEnv = await detectPipenvEnv(folder.uri.fsPath);
            if (pipenvEnv) {
                discoveredEnvironments.push(pipenvEnv);
            }
        }
    }

    // 2. 检测 venvPath 配置的目录
    if (venvPath && fs.existsSync(venvPath)) {
        const entries = fs.readdirSync(venvPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const envPath = path.join(venvPath, entry.name);
                const env = await detectVirtualEnv(envPath, entry.name);
                if (env) {
                    discoveredEnvironments.push(env);
                }
            }
        }
    }

    // 3. 检测 Conda 环境
    const condaEnvs = await detectCondaEnvironments();
    discoveredEnvironments.push(...condaEnvs);

    // 4. 检测 pyenv 环境
    const pyenvEnvs = await detectPyenvEnvironments();
    discoveredEnvironments.push(...pyenvEnvs);

    // 5. Detect builtin Python runtime (priority)
    const builtinPython = await detectBuiltinPython();
    if (builtinPython) {
        discoveredEnvironments.push(builtinPython);
    }

    // 6. Add system Python (if fallback is enabled)
    const fallbackToSystem = config.get<boolean>('runtime.fallbackToSystem', true);
    if (fallbackToSystem || !builtinPython) {
        const systemPython = await detectSystemPython();
        if (systemPython) {
            discoveredEnvironments.push(systemPython);
        }
    }

    // 去重
    const seen = new Set<string>();
    discoveredEnvironments = discoveredEnvironments.filter(env => {
        const key = env.path.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });

    console.log(`Discovered ${discoveredEnvironments.length} Python environments`);
}

/**
 * 检测虚拟环境
 */
async function detectVirtualEnv(envPath: string, name: string): Promise<PythonEnvironment | undefined> {
    const pythonPath = getPythonExecutable(envPath);
    if (!pythonPath || !fs.existsSync(pythonPath)) {
        return undefined;
    }

    const version = await getPythonVersion(pythonPath);

    return {
        name: name,
        path: pythonPath,
        version: version,
        type: 'venv'
    };
}

/**
 * 获取 Python 可执行文件路径
 */
function getPythonExecutable(envPath: string): string | undefined {
    const isWindows = os.platform() === 'win32';

    if (isWindows) {
        // Windows: Scripts/python.exe
        const scriptsPath = path.join(envPath, 'Scripts', 'python.exe');
        if (fs.existsSync(scriptsPath)) {
            return scriptsPath;
        }
    } else {
        // Unix: bin/python or bin/python3
        const binPath = path.join(envPath, 'bin', 'python');
        if (fs.existsSync(binPath)) {
            return binPath;
        }
        const bin3Path = path.join(envPath, 'bin', 'python3');
        if (fs.existsSync(bin3Path)) {
            return bin3Path;
        }
    }

    return undefined;
}

/**
 * 获取 Python 版本
 */
async function getPythonVersion(pythonPath: string): Promise<string | undefined> {
    try {
        const result = child_process.execSync(`"${pythonPath}" --version`, {
            encoding: 'utf8',
            timeout: 5000
        });
        const match = result.match(/Python\s+(\d+\.\d+\.\d+)/);
        return match ? match[1] : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 检测 Poetry 虚拟环境
 */
async function detectPoetryEnv(workspacePath: string): Promise<PythonEnvironment | undefined> {
    const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
    if (!fs.existsSync(pyprojectPath)) {
        return undefined;
    }

    try {
        const content = fs.readFileSync(pyprojectPath, 'utf8');
        if (!content.includes('[tool.poetry]')) {
            return undefined;
        }

        // 尝试获取 Poetry 虚拟环境路径
        const result = child_process.execSync('poetry env info --path', {
            cwd: workspacePath,
            encoding: 'utf8',
            timeout: 10000
        }).trim();

        if (result && fs.existsSync(result)) {
            const pythonPath = getPythonExecutable(result);
            if (pythonPath) {
                const version = await getPythonVersion(pythonPath);
                return {
                    name: `Poetry (${path.basename(workspacePath)})`,
                    path: pythonPath,
                    version: version,
                    type: 'poetry'
                };
            }
        }
    } catch {
        // Poetry 未安装或未配置
    }

    return undefined;
}

/**
 * 检测 Pipenv 虚拟环境
 */
async function detectPipenvEnv(workspacePath: string): Promise<PythonEnvironment | undefined> {
    const pipfilePath = path.join(workspacePath, 'Pipfile');
    if (!fs.existsSync(pipfilePath)) {
        return undefined;
    }

    try {
        const result = child_process.execSync('pipenv --venv', {
            cwd: workspacePath,
            encoding: 'utf8',
            timeout: 10000
        }).trim();

        if (result && fs.existsSync(result)) {
            const pythonPath = getPythonExecutable(result);
            if (pythonPath) {
                const version = await getPythonVersion(pythonPath);
                return {
                    name: `Pipenv (${path.basename(workspacePath)})`,
                    path: pythonPath,
                    version: version,
                    type: 'pipenv'
                };
            }
        }
    } catch {
        // Pipenv 未安装或未配置
    }

    return undefined;
}

/**
 * 检测 Conda 环境
 */
async function detectCondaEnvironments(): Promise<PythonEnvironment[]> {
    const environments: PythonEnvironment[] = [];
    const config = vscode.workspace.getConfiguration('python');
    let condaPath = config.get<string>('condaPath', '');

    // 尝试找到 conda
    if (!condaPath) {
        const possiblePaths = os.platform() === 'win32'
            ? ['conda.exe', 'C:\\ProgramData\\Anaconda3\\Scripts\\conda.exe', 'C:\\ProgramData\\Miniconda3\\Scripts\\conda.exe']
            : ['conda', '/opt/anaconda3/bin/conda', '/opt/miniconda3/bin/conda', `${os.homedir()}/anaconda3/bin/conda`, `${os.homedir()}/miniconda3/bin/conda`];

        for (const p of possiblePaths) {
            try {
                child_process.execSync(`"${p}" --version`, { encoding: 'utf8', timeout: 5000 });
                condaPath = p;
                break;
            } catch {
                // 继续尝试下一个
            }
        }
    }

    if (!condaPath) {
        return environments;
    }

    try {
        const result = child_process.execSync(`"${condaPath}" env list --json`, {
            encoding: 'utf8',
            timeout: 30000
        });

        const envList = JSON.parse(result);
        for (const envPath of envList.envs || []) {
            const pythonPath = getPythonExecutable(envPath);
            if (pythonPath && fs.existsSync(pythonPath)) {
                const version = await getPythonVersion(pythonPath);
                const name = path.basename(envPath);
                environments.push({
                    name: `Conda: ${name}`,
                    path: pythonPath,
                    version: version,
                    type: 'conda'
                });
            }
        }
    } catch {
        // Conda 未安装或出错
    }

    return environments;
}

/**
 * 检测 pyenv 环境
 */
async function detectPyenvEnvironments(): Promise<PythonEnvironment[]> {
    const environments: PythonEnvironment[] = [];

    if (os.platform() === 'win32') {
        // Windows 上 pyenv-win
        const pyenvRoot = process.env.PYENV_ROOT || path.join(os.homedir(), '.pyenv', 'pyenv-win');
        const versionsDir = path.join(pyenvRoot, 'versions');

        if (fs.existsSync(versionsDir)) {
            const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pythonPath = path.join(versionsDir, entry.name, 'python.exe');
                    if (fs.existsSync(pythonPath)) {
                        environments.push({
                            name: `pyenv: ${entry.name}`,
                            path: pythonPath,
                            version: entry.name,
                            type: 'pyenv'
                        });
                    }
                }
            }
        }
    } else {
        // Unix
        const pyenvRoot = process.env.PYENV_ROOT || path.join(os.homedir(), '.pyenv');
        const versionsDir = path.join(pyenvRoot, 'versions');

        if (fs.existsSync(versionsDir)) {
            const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pythonPath = path.join(versionsDir, entry.name, 'bin', 'python');
                    if (fs.existsSync(pythonPath)) {
                        environments.push({
                            name: `pyenv: ${entry.name}`,
                            path: pythonPath,
                            version: entry.name,
                            type: 'pyenv'
                        });
                    }
                }
            }
        }
    }

    return environments;
}

/**
 * 检测系统 Python
 */
async function detectSystemPython(): Promise<PythonEnvironment | undefined> {
    const pythonCommands = os.platform() === 'win32'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];

    for (const cmd of pythonCommands) {
        try {
            const result = child_process.execSync(`${cmd} -c "import sys; print(sys.executable)"`, {
                encoding: 'utf8',
                timeout: 5000
            }).trim();

            if (result && fs.existsSync(result)) {
                const version = await getPythonVersion(result);
                return {
                    name: 'System Python',
                    path: result,
                    version: version,
                    type: 'system'
                };
            }
        } catch {
            // 继续尝试下一个
        }
    }

    return undefined;
}

/**
 * 自动选择环境
 */
async function autoSelectEnvironment(): Promise<void> {
    // 优先使用配置的路径
    const configuredPath = getConfiguredPythonPath();
    if (configuredPath && configuredPath !== 'python' && configuredPath !== 'python3') {
        const env = discoveredEnvironments.find(e => e.path === configuredPath);
        if (env) {
            currentEnvironment = env;
            return;
        }
    }

    // 优先选择工作区内的虚拟环境
    const workspaceEnv = discoveredEnvironments.find(e =>
        e.type === 'venv' || e.type === 'poetry' || e.type === 'pipenv'
    );
    if (workspaceEnv) {
        currentEnvironment = workspaceEnv;
        await setEnvironment(workspaceEnv);
        return;
    }

    // 使用第一个可用的环境
    if (discoveredEnvironments.length > 0) {
        currentEnvironment = discoveredEnvironments[0];
    }
}

/**
 * 选择解释器命令
 */
async function selectInterpreter(): Promise<void> {
    await refreshEnvironments();

    const items: vscode.QuickPickItem[] = discoveredEnvironments.map(env => ({
        label: env.name,
        description: env.version ? `Python ${env.version}` : undefined,
        detail: env.path,
        picked: currentEnvironment?.path === env.path
    }));

    // 添加手动输入选项
    items.push({
        label: '$(add) Enter interpreter path...',
        description: 'Manually specify a Python interpreter',
        detail: undefined
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Python interpreter',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (!selected) {
        return;
    }

    if (selected.label.includes('Enter interpreter path')) {
        // 手动输入路径
        const inputPath = await vscode.window.showInputBox({
            prompt: 'Enter the path to a Python interpreter',
            placeHolder: '/path/to/python or C:\\path\\to\\python.exe',
            validateInput: (value: string) => {
                if (!value) {
                    return 'Please enter a path';
                }
                if (!fs.existsSync(value)) {
                    return 'File does not exist';
                }
                return undefined;
            }
        });

        if (inputPath) {
            const version = await getPythonVersion(inputPath);
            const env: PythonEnvironment = {
                name: 'Custom',
                path: inputPath,
                version: version,
                type: 'system'
            };
            await setEnvironment(env);
        }
    } else {
        const env = discoveredEnvironments.find(e => e.path === selected.detail);
        if (env) {
            await setEnvironment(env);
        }
    }
}

/**
 * 设置当前环境
 */
async function setEnvironment(env: PythonEnvironment): Promise<void> {
    currentEnvironment = env;

    // 更新配置
    const config = vscode.workspace.getConfiguration('python');
    await config.update('defaultInterpreterPath', env.path, vscode.ConfigurationTarget.Workspace);

    // 更新 basedpyright 设置
    await updateBasedPyrightSettings();

    // 更新状态栏
    updateStatusBar();

    // 触发环境变化事件，通知 basedpyright
    environmentChangeEmitter.fire();

    vscode.window.showInformationMessage(`Python interpreter set to: ${env.name} (${env.version || 'unknown version'})`);
}

/**
 * 更新 basedpyright 设置
 */
async function updateBasedPyrightSettings(): Promise<void> {
    if (!currentEnvironment) {
        return;
    }

    const config = vscode.workspace.getConfiguration('python');

    // 设置 pythonPath
    await config.update('pythonPath', currentEnvironment.path, vscode.ConfigurationTarget.Workspace);

    // 如果是虚拟环境，设置 venvPath
    if (currentEnvironment.type === 'venv') {
        const envDir = path.dirname(path.dirname(currentEnvironment.path));
        const parentDir = path.dirname(envDir);

        // 检查是否在工作区内
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                if (envDir.startsWith(folder.uri.fsPath)) {
                    // 虚拟环境在工作区内，不需要设置 venvPath
                    return;
                }
            }
        }

        // 虚拟环境在工作区外，设置 venvPath
        await config.update('venvPath', parentDir, vscode.ConfigurationTarget.Workspace);
    }

    // 设置 extraPaths（如果需要）
    const sitePackagesPath = getSitePackagesPath(currentEnvironment.path);
    if (sitePackagesPath) {
        const analysisConfig = vscode.workspace.getConfiguration('basedpyright.analysis');
        const currentExtraPaths = analysisConfig.get<string[]>('extraPaths', []);

        // 检查是否已包含
        if (!currentExtraPaths.includes(sitePackagesPath)) {
            // 不自动添加 site-packages，因为 basedpyright 会自动处理
            // 但可以添加其他自定义路径
        }
    }
}

/**
 * 获取 site-packages 路径
 */
function getSitePackagesPath(pythonPath: string): string | undefined {
    try {
        const result = child_process.execSync(
            `"${pythonPath}" -c "import site; print(site.getsitepackages()[0])"`,
            { encoding: 'utf8', timeout: 5000 }
        ).trim();
        return result;
    } catch {
        return undefined;
    }
}

/**
 * 更新状态栏
 */
function updateStatusBar(): void {
    if (currentEnvironment) {
        const version = currentEnvironment.version ? ` ${currentEnvironment.version}` : '';
        statusBarItem.text = `$(symbol-misc) Python${version}`;
        statusBarItem.tooltip = `${currentEnvironment.name}\n${currentEnvironment.path}\nClick to select interpreter`;
    } else {
        statusBarItem.text = '$(symbol-misc) Select Python';
        statusBarItem.tooltip = 'Click to select Python interpreter';
    }
}

/**
 * 创建虚拟环境命令
 */
async function createVirtualEnv(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Please open a workspace folder first');
        return;
    }

    // 选择工作区
    let targetFolder: vscode.WorkspaceFolder;
    if (workspaceFolders.length === 1) {
        targetFolder = workspaceFolders[0];
    } else {
        const selected = await vscode.window.showWorkspaceFolderPick({
            placeHolder: 'Select workspace folder for virtual environment'
        });
        if (!selected) {
            return;
        }
        targetFolder = selected;
    }

    // 输入虚拟环境名称
    const envName = await vscode.window.showInputBox({
        prompt: 'Enter virtual environment name',
        value: '.venv',
        validateInput: (value: string) => {
            if (!value) {
                return 'Please enter a name';
            }
            const envPath = path.join(targetFolder.uri.fsPath, value);
            if (fs.existsSync(envPath)) {
                return 'Directory already exists';
            }
            return undefined;
        }
    });

    if (!envName) {
        return;
    }

    // 选择 Python 解释器
    const pythonPath = currentEnvironment?.path || 'python';

    const envPath = path.join(targetFolder.uri.fsPath, envName);

    // 创建虚拟环境
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Creating virtual environment...',
        cancellable: false
    }, async () => {
        try {
            child_process.execSync(`"${pythonPath}" -m venv "${envPath}"`, {
                encoding: 'utf8',
                timeout: 60000
            });

            vscode.window.showInformationMessage(`Virtual environment created: ${envName}`);

            // 刷新并选择新环境
            await refreshEnvironments();
            const newEnv = discoveredEnvironments.find(e => e.path.includes(envPath));
            if (newEnv) {
                await setEnvironment(newEnv);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create virtual environment: ${error}`);
        }
    });
}

/**
 * 扩展停用
 */
export function deactivate(): void {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (environmentChangeEmitter) {
        environmentChangeEmitter.dispose();
    }
}

