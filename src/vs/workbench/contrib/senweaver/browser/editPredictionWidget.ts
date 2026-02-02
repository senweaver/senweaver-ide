/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, OverlayWidgetPositionPreference } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import * as dom from '../../../../base/browser/dom.js';
// @ts-ignore - React 组件需要先编译才能使用
import { mountEditPredictionWidget } from './react/out/senweaver-editor-widgets-tsx/index.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditPredictionService } from './editPredictionService.js';
import { EditPredictionResult } from '../common/editPredictionTypes.js';

/**
 * EditPrediction Widget 组件属性
 */
export interface EditPredictionWidgetProps {
	result: EditPredictionResult | null;
	onApply: (predictionId: string, itemIds?: string[]) => void;
	onReject: (predictionId: string) => void;
	onItemSelect?: (itemId: string, selected: boolean) => void;
}

/**
 * EditPrediction 编辑器贡献
 *
 * 在编辑器中显示多位置编辑预测 widget
 */
export class EditPredictionWidgetContribution extends Disposable implements IEditorContribution, IOverlayWidget {
	public static readonly ID = 'editor.contrib.editPredictionWidget';

	// React 组件
	private _rootHTML: HTMLElement;
	private _rerender: (props?: EditPredictionWidgetProps) => void = () => { };
	private _reactComponentDisposable: IDisposable | null = null;

	// 状态
	private _isVisible = false;

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEditPredictionService private readonly _editPredictionService: IEditPredictionService,
	) {
		super();

		// 创建容器元素
		const { root, content } = dom.h('div@root', [
			dom.h('div@content', [])
		]);

		// 设置容器样式
		root.style.position = 'absolute';
		root.style.display = 'none';
		root.style.pointerEvents = 'auto';
		root.style.zIndex = '1000';

		// 初始化 React 组件
		this._instantiationService.invokeFunction(accessor => {
			if (this._reactComponentDisposable) {
				this._reactComponentDisposable.dispose();
			}

			const res = mountEditPredictionWidget(content, accessor, {
				result: null,
				onApply: this._handleApply.bind(this),
				onReject: this._handleReject.bind(this),
				onItemSelect: this._handleItemSelect.bind(this),
			});

			if (!res) {
				return;
			}

			this._reactComponentDisposable = { dispose: res.dispose };
			this._rerender = res.rerender;
			this._register(this._reactComponentDisposable);
		});

		this._rootHTML = root;

		// 注册为 overlay widget
		this._editor.addOverlayWidget(this);

		// 监听预测结果
		this._register(this._editPredictionService.onPredictionReady((result) => {
			this._showPrediction(result);
		}));

		// 监听编辑器事件
		this._register(this._editor.onDidScrollChange(() => this._updatePositionIfVisible()));
		this._register(this._editor.onDidLayoutChange(() => this._updatePositionIfVisible()));

		// 监听编辑器失焦
		let isMouseOverWidget = false;
		this._rootHTML.addEventListener('mouseenter', () => {
			isMouseOverWidget = true;
		});
		this._rootHTML.addEventListener('mouseleave', () => {
			isMouseOverWidget = false;
		});

		this._register(this._editor.onDidBlurEditorText(() => {
			if (!isMouseOverWidget) {
				// 延迟隐藏，允许用户与 widget 交互
				setTimeout(() => {
					if (!isMouseOverWidget) {
						this._hide();
					}
				}, 200);
			}
		}));
	}

	// IOverlayWidget 实现
	public getId(): string {
		return EditPredictionWidgetContribution.ID;
	}

	public getDomNode(): HTMLElement {
		return this._rootHTML;
	}

	public getPosition(): IOverlayWidgetPosition | null {
		if (!this._isVisible) {
			return null;
		}

		return {
			preference: OverlayWidgetPositionPreference.TOP_RIGHT_CORNER
		};
	}

	/**
	 * 显示预测结果
	 */
	private _showPrediction(result: EditPredictionResult): void {
		if (!this._editor.hasModel()) {
			return;
		}

		const currentUri = this._editor.getModel()?.uri;
		const resultUri = result.cursorPosition.uri;

		// 🔥 检查 URI 是否匹配（只显示当前文件的预测结果）
		if (currentUri && resultUri && currentUri.toString() !== resultUri.toString()) {
			return;
		}

		// 只显示有预测或相关编辑的结果
		if (result.predictions.length === 0 && result.relatedEdits.length === 0) {
			return;
		}

		this._isVisible = true;
		this._rootHTML.style.display = 'block';

		// 更新 React 组件
		try {
			this._rerender({
				result,
				onApply: this._handleApply.bind(this),
				onReject: this._handleReject.bind(this),
				onItemSelect: this._handleItemSelect.bind(this),
			});
		} catch (error) {
			// 忽略渲染错误
		}

		// 更新位置
		this._updatePosition();
	}

	/**
	 * 隐藏 widget
	 */
	private _hide(): void {
		this._isVisible = false;
		this._rootHTML.style.display = 'none';

		this._rerender({
			result: null,
			onApply: this._handleApply.bind(this),
			onReject: this._handleReject.bind(this),
		});
	}

	/**
	 * 更新位置 - 定位到右上角，但留出代码状态栏的宽度
	 */
	private _updatePosition(): void {
		if (!this._editor.hasModel() || !this._isVisible) {
			return;
		}

		// 定位到右上角，但留出状态栏宽度（140-150px）
		const top = 10;
		const statusBarWidth = 145; // 代码状态栏的宽度（140-150px之间）

		this._rootHTML.style.top = `${top}px`;
		this._rootHTML.style.right = `${statusBarWidth}px`;
		this._rootHTML.style.left = 'auto';
	}

	private _updatePositionIfVisible(): void {
		if (this._isVisible) {
			this._updatePosition();
		}
	}

	/**
	 * 处理应用预测
	 */
	private async _handleApply(predictionId: string, itemIds?: string[]): Promise<void> {
		const success = await this._editPredictionService.applyPrediction(predictionId, itemIds);
		if (success) {
			this._hide();
		}
	}

	/**
	 * 处理拒绝预测
	 */
	private _handleReject(predictionId: string): void {
		this._editPredictionService.rejectPrediction(predictionId);
		this._hide();
	}

	/**
	 * 处理选中项变化
	 */
	private _handleItemSelect(itemId: string, selected: boolean): void {
		// 可以在这里添加额外逻辑，比如高亮显示选中的编辑位置
	}

	public override dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}
}

// 注册编辑器贡献
registerEditorContribution(
	EditPredictionWidgetContribution.ID,
	EditPredictionWidgetContribution,
	EditorContributionInstantiation.AfterFirstRender
);
