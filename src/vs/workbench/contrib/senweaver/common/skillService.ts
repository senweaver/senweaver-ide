/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event, Emitter } from '../../../../base/common/event.js';

/**
 * Skill 信息结构
 * 参考 OpenCode-IDE 的实现
 */
export interface SkillInfo {
	name: string;
	description: string;
	location: string;  // 文件路径
	content?: string;  // 完整内容（按需加载）
}

/**
 * Skill 服务状态
 */
export interface SkillServiceState {
	skills: Record<string, SkillInfo>;
	error?: string;
}

/**
 * Skills 配置文件结构
 */
export interface SkillsConfigFileJSON {
	skills: {
		[name: string]: {
			description: string;
			content: string;
		};
	};
}

export interface ISkillService {
	readonly _serviceBrand: undefined;

	readonly state: SkillServiceState;
	onDidChangeState: Event<void>;

	/**
	 * 获取所有可用的 skills
	 */
	getAllSkills(): SkillInfo[];

	/**
	 * 根据名称获取 skill
	 */
	getSkill(name: string): SkillInfo | undefined;

	/**
	 * 加载 skill 的完整内容
	 */
	loadSkillContent(name: string): Promise<string | undefined>;

	/**
	 * 刷新 skills 列表
	 */
	refresh(): Promise<void>;

	/**
	 * 打开 skills 配置文件
	 */
	revealSkillsConfigFile(): Promise<void>;

	/**
	 * 添加 skill
	 */
	addSkill(name: string, description: string, content: string): Promise<void>;

	/**
	 * 删除 skill
	 */
	deleteSkill(name: string): Promise<void>;

	/**
	 * 打开 skill 配置目录 (兼容旧方法)
	 */
	revealSkillsFolder(): Promise<void>;
}

export const ISkillService = createDecorator<ISkillService>('skillService');

// Skill 文件名
const SKILL_FILE_NAME = 'SKILL.md';
const SKILLS_CONFIG_FILE_NAME = 'skills.json';

// 默认配置
const SKILLS_CONFIG_SAMPLE: SkillsConfigFileJSON = {
	skills: {
		'code-review': {
			description: '执行代码审查，检查代码质量和安全问题',
			content: `## Code Review Skill\n\n请对提供的代码进行全面审查：\n\n1. **代码质量** - 检查命名、结构、可读性\n2. **逻辑正确性** - 验证边界条件和错误处理\n3. **性能** - 识别潜在的性能问题\n4. **安全** - 检查安全漏洞\n\n输出格式：\n- **位置**: 文件和行号\n- **严重性**: Critical / High / Medium / Low\n- **问题**: 问题描述\n- **建议**: 修复建议`
		},
		'git-commit': {
			description: '生成清晰的 Git 提交消息',
			content: `## Git Commit Message Skill\n\n根据代码变更生成符合 Conventional Commits 规范的提交消息：\n\n格式: <type>(<scope>): <subject>\n\n类型:\n- feat: 新功能\n- fix: 修复 Bug\n- docs: 文档变更\n- style: 代码格式\n- refactor: 重构\n- perf: 性能优化\n- test: 测试相关\n- build: 构建相关`
		}
	}
};
const SKILLS_CONFIG_SAMPLE_STRING = JSON.stringify(SKILLS_CONFIG_SAMPLE, null, 2);

// 解析 YAML frontmatter
function parseFrontmatter(content: string): { data: Record<string, string>; content: string } | null {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		return null;
	}

	const yamlContent = match[1];
	const markdownContent = match[2];

	// 简单解析 YAML（只支持 key: value 格式）
	const data: Record<string, string> = {};
	const lines = yamlContent.split('\n');
	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex > 0) {
			const key = line.substring(0, colonIndex).trim();
			const value = line.substring(colonIndex + 1).trim();
			// 移除引号
			data[key] = value.replace(/^["']|["']$/g, '');
		}
	}

	return { data, content: markdownContent };
}

class SkillService extends Disposable implements ISkillService {
	_serviceBrand: undefined;

	state: SkillServiceState = {
		skills: {},
		error: undefined,
	};

	private readonly _onDidChangeState = new Emitter<void>();
	public readonly onDidChangeState = this._onDidChangeState.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		try {
			// 创建配置文件（如果不存在）
			const configUri = await this._getSkillsConfigFilePath();
			const fileExists = await this._configFileExists(configUri);
			if (!fileExists) {
				await this._createSkillsConfigFile(configUri);
				console.log('[SkillService] Skills 配置文件已创建:', configUri.toString());
			}
			// 添加文件监听
			await this._addConfigFileWatcher();
			// 刷新 skills 列表
			await this.refresh();
		} catch (error) {
			console.error('[SkillService] 初始化失败:', error);
			this.state.error = `初始化失败: ${error}`;
		}
	}

	/**
	 * 获取 skills 配置文件路径
	 */
	private async _getSkillsConfigFilePath(): Promise<URI> {
		const appName = this.productService.dataFolderName;
		const userHome = await this.pathService.userHome();
		return URI.joinPath(userHome, appName, SKILLS_CONFIG_FILE_NAME);
	}

	/**
	 * 检查配置文件是否存在
	 */
	private async _configFileExists(configUri: URI): Promise<boolean> {
		try {
			await this.fileService.stat(configUri);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 创建配置文件
	 */
	private async _createSkillsConfigFile(configUri: URI): Promise<void> {
		await this.fileService.createFile(configUri);
		const buffer = VSBuffer.fromString(SKILLS_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(configUri, buffer);
	}

	/**
	 * 添加配置文件监听
	 */
	private async _addConfigFileWatcher(): Promise<void> {
		const configUri = await this._getSkillsConfigFilePath();
		this._register(this.fileService.watch(configUri));
		this._register(this.fileService.onDidFilesChange(async e => {
			if (!e.contains(configUri)) return;
			await this.refresh();
		}));
	}

	/**
	 * 解析配置文件
	 */
	private async _parseSkillsConfigFile(): Promise<SkillsConfigFileJSON | null> {
		const configUri = await this._getSkillsConfigFilePath();
		try {
			const fileContent = await this.fileService.readFile(configUri);
			const contentString = fileContent.value.toString();
			const configFileJson = JSON.parse(contentString);
			if (!configFileJson.skills) {
				throw new Error('Missing skills property');
			}
			return configFileJson as SkillsConfigFileJSON;
		} catch (error) {
			console.error('[SkillService] 解析配置文件失败:', error);
			return null;
		}
	}

	/**
	 * 保存配置文件
	 */
	private async _saveSkillsConfigFile(config: SkillsConfigFileJSON): Promise<void> {
		const configUri = await this._getSkillsConfigFilePath();
		const buffer = VSBuffer.fromString(JSON.stringify(config, null, 2));
		await this.fileService.writeFile(configUri, buffer);
	}

	/**
	 * 获取所有 skills 扫描目录
	 */
	private async _getSkillDirectories(): Promise<URI[]> {
		const directories: URI[] = [];

		// 1. 项目级目录：.senweaver/skill/
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		for (const folder of workspaceFolders) {
			const projectSkillDir = URI.joinPath(folder.uri, '.senweaver', 'skill');
			directories.push(projectSkillDir);

			// 兼容 .opencode/skill/ 目录
			const opencodeSkillDir = URI.joinPath(folder.uri, '.opencode', 'skill');
			directories.push(opencodeSkillDir);

			// 兼容 .claude/skills/ 目录 (Claude Code 格式)
			const claudeSkillDir = URI.joinPath(folder.uri, '.claude', 'skills');
			directories.push(claudeSkillDir);
		}

		// 2. 全局配置目录
		const userHome = await this.pathService.userHome();
		const appName = this.productService.dataFolderName;

		// ~/.config/senweaver/skill/ (或 Windows 等效目录)
		const globalSkillDir = URI.joinPath(userHome, appName, 'skill');
		directories.push(globalSkillDir);

		// 兼容 ~/.config/opencode/skill/
		const globalOpencodeDir = URI.joinPath(userHome, '.config', 'opencode', 'skill');
		directories.push(globalOpencodeDir);

		// 兼容 ~/.claude/skills/
		const globalClaudeDir = URI.joinPath(userHome, '.claude', 'skills');
		directories.push(globalClaudeDir);

		return directories;
	}

	/**
	 * 扫描目录查找 SKILL.md 文件
	 */
	private async _scanDirectory(dirUri: URI): Promise<SkillInfo[]> {
		const skills: SkillInfo[] = [];

		try {
			// 检查目录是否存在
			const dirStat = await this.fileService.stat(dirUri).catch(() => null);
			if (!dirStat || !dirStat.isDirectory) {
				return skills;
			}

			// 列出子目录
			const children = await this.fileService.resolve(dirUri);
			if (!children.children) {
				return skills;
			}

			for (const child of children.children) {
				if (!child.isDirectory) continue;

				// 检查子目录中的 SKILL.md
				const skillFileUri = URI.joinPath(child.resource, SKILL_FILE_NAME);
				try {
					const fileContent = await this.fileService.readFile(skillFileUri);
					const content = fileContent.value.toString();

					const parsed = parseFrontmatter(content);
					if (!parsed) {
						console.warn(`[SkillService] 无效的 SKILL.md 格式: ${skillFileUri.fsPath}`);
						continue;
					}

					const { data } = parsed;
					const name = data.name;
					const description = data.description;

					if (!name || !description) {
						console.warn(`[SkillService] SKILL.md 缺少必要字段 (name/description): ${skillFileUri.fsPath}`);
						continue;
					}

					// 验证名称格式（宽松模式，允许更多字符）
					if (name.length > 64) {
						console.warn(`[SkillService] Skill 名称过长: ${name}`);
						continue;
					}

					skills.push({
						name,
						description,
						location: skillFileUri.fsPath,
					});

				} catch (e) {
					// SKILL.md 不存在或读取失败，跳过
				}
			}
		} catch (e) {
			// 目录不存在或无法读取
		}

		return skills;
	}

	/**
	 * 刷新 skills 列表（从配置文件和目录扫描）
	 */
	async refresh(): Promise<void> {
		const skills: Record<string, SkillInfo> = {};

		// 1. 从配置文件加载 skills
		const configUri = await this._getSkillsConfigFilePath();
		const config = await this._parseSkillsConfigFile();
		if (config && config.skills) {
			for (const [name, skillData] of Object.entries(config.skills)) {
				skills[name] = {
					name,
					description: skillData.description,
					location: configUri.fsPath, // 配置文件位置
					content: skillData.content,
				};
			}
		}

		// 2. 从目录扫描 SKILL.md 文件（兼容旧方式）
		const directories = await this._getSkillDirectories();
		for (const dir of directories) {
			const dirSkills = await this._scanDirectory(dir);
			for (const skill of dirSkills) {
				// 配置文件中的 skill 优先级更高
				if (skills[skill.name]) {
					continue;
				}
				skills[skill.name] = skill;
			}
		}

		this.state = {
			skills,
			error: undefined,
		};

		console.log(`[SkillService] 发现 ${Object.keys(skills).length} 个 skills`);
		this._onDidChangeState.fire();
	}

	/**
	 * 获取所有 skills
	 */
	getAllSkills(): SkillInfo[] {
		return Object.values(this.state.skills);
	}

	/**
	 * 根据名称获取 skill
	 */
	getSkill(name: string): SkillInfo | undefined {
		return this.state.skills[name];
	}

	/**
	 * 加载 skill 的完整内容
	 */
	async loadSkillContent(name: string): Promise<string | undefined> {
		const skill = this.state.skills[name];
		if (!skill) {
			return undefined;
		}

		// 如果是配置文件中的 skill，直接返回内容
		if (skill.content) {
			return [
				`## Skill: ${skill.name}`,
				'',
				skill.content.trim()
			].join('\n');
		}

		// 否则从 SKILL.md 文件加载
		try {
			const uri = URI.file(skill.location);
			const fileContent = await this.fileService.readFile(uri);
			const content = fileContent.value.toString();

			const parsed = parseFrontmatter(content);
			if (!parsed) {
				return content; // 返回原始内容
			}

			// 缓存内容
			skill.content = parsed.content;

			// 返回格式化的输出
			const dir = skill.location.substring(0, skill.location.lastIndexOf('/'));
			return [
				`## Skill: ${skill.name}`,
				'',
				`**Base directory**: ${dir}`,
				'',
				parsed.content.trim()
			].join('\n');

		} catch (e) {
			console.error(`[SkillService] 加载 skill 内容失败: ${name}`, e);
			return undefined;
		}
	}

	/**
	 * 打开 skills 配置文件
	 */
	async revealSkillsConfigFile(): Promise<void> {
		try {
			const configUri = await this._getSkillsConfigFilePath();
			await this.editorService.openEditor({
				resource: configUri,
				options: {
					pinned: true,
					revealIfOpened: true,
				}
			});
		} catch (error) {
			console.error('[SkillService] 打开配置文件失败:', error);
		}
	}

	/**
	 * 添加 skill
	 */
	async addSkill(name: string, description: string, content: string): Promise<void> {
		const config = await this._parseSkillsConfigFile();
		if (!config) {
			throw new Error('无法读取配置文件');
		}

		config.skills[name] = { description, content };
		await this._saveSkillsConfigFile(config);
		// 文件监听会自动触发 refresh
	}

	/**
	 * 删除 skill
	 */
	async deleteSkill(name: string): Promise<void> {
		const config = await this._parseSkillsConfigFile();
		if (!config) {
			throw new Error('无法读取配置文件');
		}

		if (config.skills[name]) {
			delete config.skills[name];
			await this._saveSkillsConfigFile(config);
			// 文件监听会自动触发 refresh
		}
	}

	/**
	 * 打开 skill 配置目录 (兼容旧方法，现在打开配置文件)
	 */
	async revealSkillsFolder(): Promise<void> {
		await this.revealSkillsConfigFile();
	}
}

registerSingleton(ISkillService, SkillService, InstantiationType.Delayed);
