/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// 存储键
const CUSTOM_API_STORAGE_KEY = 'senweaver.customApis';

// API 字段定义
export interface CustomApiField {
	name: string;           // 字段名称
	type: 'string' | 'number' | 'boolean' | 'object' | 'array';  // 字段类型
	required: boolean;      // 是否必填
	description: string;    // 字段说明
	defaultValue?: string;  // 默认值
}

// 自定义 API 定义
export interface CustomApiDefinition {
	id: string;             // 唯一标识
	name: string;           // API 名称（用于显示）
	url: string;            // API URL
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';  // HTTP 方法
	description: string;    // 功能详细描述（供助手选择使用）
	headers?: Record<string, string>;  // 请求头
	fields: CustomApiField[];  // 请求字段列表
	responseDescription?: string;  // 响应格式说明
	enabled: boolean;       // 是否启用
	createdAt: number;      // 创建时间
	updatedAt: number;      // 更新时间
}

// 服务状态
export interface CustomApiState {
	apis: CustomApiDefinition[];
}

// 默认状态
const defaultCustomApiState: CustomApiState = {
	apis: []
};

// 服务接口
export interface ICustomApiService {
	readonly _serviceBrand: undefined;
	readonly state: CustomApiState;

	onDidChangeState: Event<void>;

	// API 管理方法
	addApi(api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomApiDefinition>;
	updateApi(id: string, updates: Partial<Omit<CustomApiDefinition, 'id' | 'createdAt'>>): Promise<void>;
	deleteApi(id: string): Promise<void>;
	getApi(id: string): CustomApiDefinition | undefined;
	getEnabledApis(): CustomApiDefinition[];

	// 获取 API 列表描述（供助手使用）
	getApiListDescription(): string;
}

export const ICustomApiService = createDecorator<ICustomApiService>('customApiService');

// 生成唯一 ID
function generateId(): string {
	return `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 服务实现
class CustomApiService extends Disposable implements ICustomApiService {
	readonly _serviceBrand: undefined;

	private _state: CustomApiState;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _disposables = this._register(new DisposableStore());

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// 从存储加载状态
		this._state = this._loadState();

		// 监听存储变化
		const d = this.storageService.onDidChangeValue(StorageScope.APPLICATION, CUSTOM_API_STORAGE_KEY, this._disposables)(() => {
			this._state = this._loadState();
			this._onDidChangeState.fire();
		});
		this._disposables.add(d);
	}

	get state(): CustomApiState {
		return this._state;
	}

	private _loadState(): CustomApiState {
		const stored = this.storageService.get(CUSTOM_API_STORAGE_KEY, StorageScope.APPLICATION);
		if (stored) {
			try {
				return JSON.parse(stored);
			} catch {
				return deepClone(defaultCustomApiState);
			}
		}
		return deepClone(defaultCustomApiState);
	}

	private async _saveState(): Promise<void> {
		this.storageService.store(
			CUSTOM_API_STORAGE_KEY,
			JSON.stringify(this._state),
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
		this._onDidChangeState.fire();
	}

	async addApi(api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomApiDefinition> {
		const now = Date.now();
		const newApi: CustomApiDefinition = {
			...api,
			id: generateId(),
			createdAt: now,
			updatedAt: now,
		};

		this._state = {
			...this._state,
			apis: [...this._state.apis, newApi],
		};

		await this._saveState();
		return newApi;
	}

	async updateApi(id: string, updates: Partial<Omit<CustomApiDefinition, 'id' | 'createdAt'>>): Promise<void> {
		const index = this._state.apis.findIndex(api => api.id === id);
		if (index === -1) {
			throw new Error(`API with id ${id} not found`);
		}

		const updatedApi: CustomApiDefinition = {
			...this._state.apis[index],
			...updates,
			updatedAt: Date.now(),
		};

		const newApis = [...this._state.apis];
		newApis[index] = updatedApi;

		this._state = {
			...this._state,
			apis: newApis,
		};

		await this._saveState();
	}

	async deleteApi(id: string): Promise<void> {
		this._state = {
			...this._state,
			apis: this._state.apis.filter(api => api.id !== id),
		};

		await this._saveState();
	}

	getApi(id: string): CustomApiDefinition | undefined {
		return this._state.apis.find(api => api.id === id);
	}

	getEnabledApis(): CustomApiDefinition[] {
		return this._state.apis.filter(api => api.enabled);
	}

	getApiListDescription(): string {
		const enabledApis = this.getEnabledApis();
		if (enabledApis.length === 0) {
			return '';
		}

		const apiDescriptions = enabledApis.map(api => {
			const fieldsDesc = api.fields.map(f =>
				`  - ${f.name} (${f.type}${f.required ? ', 必填' : ''}): ${f.description}`
			).join('\n');

			return `## ${api.name}
- URL: ${api.url}
- 方法: ${api.method}
- 描述: ${api.description}
- 字段:
${fieldsDesc}
${api.responseDescription ? `- 响应说明: ${api.responseDescription}` : ''}`;
		}).join('\n\n');

		return `# 可用的自定义 API 列表

以下 API 可以通过 api_request 工具调用：

${apiDescriptions}

调用示例：使用 api_request 工具，设置对应的 url、method、headers 和 body 参数。`;
	}
}

registerSingleton(ICustomApiService, CustomApiService, InstantiationType.Eager);
