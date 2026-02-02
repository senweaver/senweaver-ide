/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, Edit2, ToggleLeft, ToggleRight } from 'lucide-react';
import { CustomApiDefinition, CustomApiField, ICustomApiService } from '../../../../common/customApiService.js';
import { useAccessor, useIsDark } from '../util/services.js';

// 字段类型选项
const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

// 空字段模板
const emptyField: Omit<CustomApiField, 'name'> = {
	type: 'string',
	required: false,
	description: '',
	defaultValue: '',
};

// 空 API 模板
const emptyApi: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
	name: '',
	url: '',
	method: 'GET',
	description: '',
	headers: {},
	fields: [],
	responseDescription: '',
	enabled: true,
};

// 字段编辑器组件
const FieldEditor = ({
	field,
	onChange,
	onDelete,
}: {
	field: CustomApiField;
	onChange: (field: CustomApiField) => void;
	onDelete: () => void;
}) => {
	return (
		<div className="flex items-start gap-3 p-4 bg-senweaver-bg-1 rounded-lg border border-senweaver-border-2">
			<div className="flex-1 space-y-3">
				<div className="grid grid-cols-2 gap-3">
					<input
						type="text"
						placeholder="字段名称"
						value={field.name}
						onChange={(e) => onChange({ ...field, name: e.target.value })}
						className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color"
					/>
					<select
						value={field.type}
						onChange={(e) => onChange({ ...field, type: e.target.value as CustomApiField['type'] })}
						className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 focus:outline-none focus:border-senweaver-ring-color cursor-pointer"
					>
						{FIELD_TYPES.map((t) => (
							<option key={t} value={t}>{t}</option>
						))}
					</select>
				</div>
				<input
					type="text"
					placeholder="字段说明（可选）"
					value={field.description}
					onChange={(e) => onChange({ ...field, description: e.target.value })}
					className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color"
				/>
				<div className="flex items-center gap-4">
					<label className="flex items-center gap-2 text-sm text-senweaver-fg-2 cursor-pointer">
						<input
							type="checkbox"
							checked={field.required}
							onChange={(e) => onChange({ ...field, required: e.target.checked })}
							className="w-4 h-4 rounded bg-senweaver-bg-1 border-senweaver-border-2 text-senweaver-ring-color focus:ring-senweaver-ring-color"
						/>
						必填字段
					</label>
					<input
						type="text"
						placeholder="默认值（可选）"
						value={field.defaultValue || ''}
						onChange={(e) => onChange({ ...field, defaultValue: e.target.value })}
						className="flex-1 px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color"
					/>
				</div>
			</div>
			<button
				onClick={onDelete}
				className="p-2 text-senweaver-fg-3 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
				title="删除字段"
			>
				<Trash2 size={18} />
			</button>
		</div>
	);
};

// API 编辑表单组件
const ApiEditForm = ({
	api,
	onSave,
	onCancel,
	isNew = false,
}: {
	api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'> | CustomApiDefinition;
	onSave: (api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'>) => void;
	onCancel: () => void;
	isNew?: boolean;
}) => {
	const [formData, setFormData] = useState(api);
	const [headersText, setHeadersText] = useState(
		api.headers ? JSON.stringify(api.headers, null, 2) : '{}'
	);
	const [headersError, setHeadersError] = useState('');

	const handleHeadersChange = (text: string) => {
		setHeadersText(text);
		try {
			const parsed = JSON.parse(text);
			setFormData({ ...formData, headers: parsed });
			setHeadersError('');
		} catch {
			setHeadersError('JSON 格式错误');
		}
	};

	const addField = () => {
		setFormData({
			...formData,
			fields: [...formData.fields, { ...emptyField, name: '' }],
		});
	};

	const updateField = (index: number, field: CustomApiField) => {
		const newFields = [...formData.fields];
		newFields[index] = field;
		setFormData({ ...formData, fields: newFields });
	};

	const deleteField = (index: number) => {
		setFormData({
			...formData,
			fields: formData.fields.filter((_, i) => i !== index),
		});
	};

	const handleSubmit = () => {
		if (!formData.name.trim()) {
			alert('请输入 API 名称');
			return;
		}
		if (!formData.url.trim()) {
			alert('请输入 API URL');
			return;
		}
		if (headersError) {
			alert('请修正 Headers JSON 格式');
			return;
		}
		onSave(formData);
	};

	return (
		<div className="space-y-6">
			{/* 表单标题 */}
			<div className="mb-2">
				<h3 className="text-lg font-medium text-senweaver-link-color">
					{isNew ? '添加新 API' : '编辑 API'}
				</h3>
			</div>

			{/* API 名称 */}
			<div>
				<label className="block text-sm text-senweaver-fg-2 mb-2">API 名称</label>
				<input
					type="text"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					placeholder="请输入 API 名称..."
					className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color"
				/>
			</div>

			{/* HTTP 方法和 URL */}
			<div className="grid grid-cols-[120px_1fr] gap-3">
				<div>
					<label className="block text-sm text-senweaver-fg-2 mb-2">HTTP 方法</label>
					<select
						value={formData.method}
						onChange={(e) => setFormData({ ...formData, method: e.target.value as CustomApiDefinition['method'] })}
						className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 focus:outline-none focus:border-senweaver-ring-color cursor-pointer"
					>
						{HTTP_METHODS.map((m) => (
							<option key={m} value={m}>{m}</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-sm text-senweaver-fg-2 mb-2">API URL</label>
					<input
						type="text"
						value={formData.url}
						onChange={(e) => setFormData({ ...formData, url: e.target.value })}
						placeholder="https://api.example.com/endpoint"
						className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color"
					/>
				</div>
			</div>

			{/* 功能描述 */}
			<div>
				<label className="block text-sm text-senweaver-fg-2 mb-2">功能描述</label>
				<textarea
					value={formData.description}
					onChange={(e) => setFormData({ ...formData, description: e.target.value })}
					placeholder="请详细描述任务需求、目标和要求..."
					rows={4}
					className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color resize-none"
				/>
			</div>

			{/* 请求头 */}
			<div>
				<label className="block text-sm text-senweaver-fg-2 mb-2">
					请求头 (JSON 格式)
					{headersError && <span className="text-red-400 ml-2 text-xs">{headersError}</span>}
				</label>
				<textarea
					value={headersText}
					onChange={(e) => handleHeadersChange(e.target.value)}
					placeholder='{"Content-Type": "application/json"}'
					rows={3}
					className={`w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color resize-none font-mono text-sm ${headersError ? 'border-red-500 focus:border-red-500' : ''}`}
				/>
			</div>

			{/* 请求字段 */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<label className="text-sm text-senweaver-fg-2">请求字段</label>
					<button
						onClick={addField}
						className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-senweaver-fg-2 hover:text-senweaver-fg-1 bg-senweaver-bg-1 hover:bg-senweaver-bg-2-hover rounded-md border border-senweaver-border-2 transition-colors"
					>
						<Plus size={14} />
						添加字段
					</button>
				</div>
				<div className="space-y-3">
					{formData.fields.map((field, index) => (
						<FieldEditor
							key={index}
							field={field}
							onChange={(f) => updateField(index, f)}
							onDelete={() => deleteField(index)}
						/>
					))}
					{formData.fields.length === 0 && (
						<div className="bg-senweaver-bg-1 border border-senweaver-border-1 rounded-lg text-sm text-senweaver-fg-3 text-center py-6">
							暂无字段
						</div>
					)}
				</div>
			</div>

			{/* 响应格式说明 */}
			<div>
				<label className="block text-sm text-senweaver-fg-2 mb-2">响应格式说明</label>
				<textarea
					value={formData.responseDescription || ''}
					onChange={(e) => setFormData({ ...formData, responseDescription: e.target.value })}
					placeholder="描述 API 返回的数据格式..."
					rows={2}
					className="w-full px-3 py-2 bg-senweaver-bg-1 border border-senweaver-border-2 rounded text-senweaver-fg-1 placeholder-senweaver-fg-3 focus:outline-none focus:border-senweaver-ring-color resize-none"
				/>
			</div>

			{/* 操作按钮 */}
			<div className="flex items-center gap-3 pt-4">
				<button
					onClick={handleSubmit}
					className="px-4 py-2 bg-vscode-button-bg hover:bg-vscode-button-hover-bg text-vscode-button-fg rounded transition-colors font-medium"
				>
					{isNew ? '创建 API' : '保存修改'}
				</button>
				<button
					onClick={onCancel}
					className="px-4 py-2 bg-senweaver-bg-1 hover:bg-senweaver-bg-2-hover text-senweaver-fg-1 rounded border border-senweaver-border-2 transition-colors"
				>
					取消
				</button>
			</div>
		</div>
	);
};

// API 列表项组件
const ApiListItem = ({
	api,
	onEdit,
	onDelete,
	onToggle,
}: {
	api: CustomApiDefinition;
	onEdit: () => void;
	onDelete: () => void;
	onToggle: () => void;
}) => {
	const methodColors: Record<string, string> = {
		GET: 'bg-green-500/20 text-green-400',
		POST: 'bg-blue-500/20 text-blue-400',
		PUT: 'bg-yellow-500/20 text-yellow-400',
		DELETE: 'bg-red-500/20 text-red-400',
		PATCH: 'bg-purple-500/20 text-purple-400',
	};

	return (
		<div className={`bg-senweaver-bg-1 border border-senweaver-border-1 rounded-lg overflow-hidden transition-opacity ${!api.enabled ? 'opacity-50' : ''}`}>
			<div className="flex items-center gap-4 p-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-3 mb-1">
						<span className="font-medium text-senweaver-fg-1">{api.name}</span>
						<span className={`px-2 py-0.5 text-xs font-medium rounded ${methodColors[api.method] || methodColors.GET}`}>
							{api.method}
						</span>
					</div>
					<div className="text-sm text-senweaver-fg-3 truncate">{api.url}</div>
					{api.description && (
						<div className="text-sm text-senweaver-fg-4 mt-1 line-clamp-1">{api.description}</div>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={onToggle}
						className={`p-2 rounded-md transition-colors ${api.enabled
							? 'text-green-400 hover:bg-green-500/10'
							: 'text-senweaver-fg-4 hover:bg-senweaver-bg-1'
						}`}
						title={api.enabled ? '点击禁用' : '点击启用'}
					>
						{api.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
					</button>
					<button
						onClick={onEdit}
						className="p-2 text-senweaver-fg-3 hover:text-senweaver-link-color hover:bg-senweaver-link-color/10 rounded-md transition-colors"
						title="编辑"
					>
						<Edit2 size={18} />
					</button>
					<button
						onClick={onDelete}
						className="p-2 text-senweaver-fg-3 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
						title="删除"
					>
						<Trash2 size={18} />
					</button>
				</div>
			</div>
		</div>
	);
};

// 主面板组件
export const CustomApiPanel = ({ embedded = false }: { embedded?: boolean }) => {
	const accessor = useAccessor();
	const customApiService = accessor.get('ICustomApiService') as ICustomApiService;

	const [apis, setApis] = useState<CustomApiDefinition[]>(customApiService.state.apis);
	const [editingApi, setEditingApi] = useState<CustomApiDefinition | null>(null);
	const [isAdding, setIsAdding] = useState(false);

	// 监听状态变化
	React.useEffect(() => {
		const disposable = customApiService.onDidChangeState(() => {
			setApis(customApiService.state.apis);
		});
		return () => disposable.dispose();
	}, [customApiService]);

	const handleAdd = useCallback(async (api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'>) => {
		await customApiService.addApi(api);
		setIsAdding(false);
	}, [customApiService]);

	const handleUpdate = useCallback(async (api: Omit<CustomApiDefinition, 'id' | 'createdAt' | 'updatedAt'>) => {
		if (editingApi) {
			await customApiService.updateApi(editingApi.id, api);
			setEditingApi(null);
		}
	}, [customApiService, editingApi]);

	const handleDelete = useCallback(async (id: string) => {
		if (confirm('确定要删除这个 API 吗？')) {
			await customApiService.deleteApi(id);
		}
	}, [customApiService]);

	const handleToggle = useCallback(async (api: CustomApiDefinition) => {
		await customApiService.updateApi(api.id, { enabled: !api.enabled });
	}, [customApiService]);

	const isDark = useIsDark();

	const content = (
		<div className={embedded ? '' : 'flex-1 overflow-auto'}>
			<div className={embedded ? '' : 'max-w-2xl mx-auto p-6'}>
					{isAdding ? (
						<ApiEditForm
							api={emptyApi}
							onSave={handleAdd}
							onCancel={() => setIsAdding(false)}
							isNew={true}
						/>
					) : editingApi ? (
						<ApiEditForm
							api={editingApi}
							onSave={handleUpdate}
							onCancel={() => setEditingApi(null)}
						/>
					) : (
						<>
							{/* 标题区域 */}
							<div className="mb-6">
								<h2 className="text-xl font-semibold text-senweaver-link-color mb-2">自定义 API</h2>
								<p className="text-sm text-senweaver-fg-3">配置可供助手调用的 API 接口</p>
							</div>

							{/* 添加按钮 */}
							<div className="mb-6">
								<button
									onClick={() => setIsAdding(true)}
									className="px-4 py-2 bg-vscode-button-bg hover:bg-vscode-button-hover-bg text-vscode-button-fg rounded transition-colors font-medium"
								>
									添加 API
								</button>
							</div>

							{/* API 列表 */}
							<div className="mb-4">
								<h3 className="text-base font-medium text-senweaver-fg-1 mb-4">API 列表</h3>
								<div className="space-y-3">
									{apis.length === 0 ? (
										<div className="bg-senweaver-bg-1 border border-senweaver-border-1 rounded-lg text-center py-8">
											<div className="text-senweaver-fg-3">暂无 API</div>
										</div>
									) : (
										apis.map((api) => (
											<ApiListItem
												key={api.id}
												api={api}
												onEdit={() => setEditingApi(api)}
												onDelete={() => handleDelete(api.id)}
												onToggle={() => handleToggle(api)}
											/>
										))
									)}
								</div>
							</div>

							{/* 底部提示 */}
							<div className="text-xs text-senweaver-fg-4 mt-6">
								提示：启用的 API 将自动提供给助手，助手可以通过工具调用这些 API
							</div>
						</>
					)}
			</div>
		</div>
	);

	if (embedded) {
		return content;
	}

	return (
		<div className={`@@senweaver-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<div className="h-full flex flex-col bg-senweaver-bg-2">
				{content}
			</div>
		</div>
	);
};

export default CustomApiPanel;
