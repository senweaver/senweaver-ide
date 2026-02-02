/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom/client'
import { _registerServices } from './services.js';
import { initImageApiConfig } from './imageUtils.js';
import { IProductService } from '../../../../../../../platform/product/common/productService.js';


import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';

export const mountFnGenerator = (Component: (params: any) => React.ReactNode) => (rootElement: HTMLElement, accessor: ServicesAccessor, props?: any) => {
	if (typeof document === 'undefined') {
		console.error('index.tsx error: document was undefined')
		return
	}

	const disposables = _registerServices(accessor)

	// 初始化图片上传配置（从 product.json 获取）
	try {
		const productService = accessor.get(IProductService);
		const apiConfig = productService.senweaverApiConfig;
		if (apiConfig) {
			initImageApiConfig({
				apiBaseUrl: apiConfig.apiBaseUrl,
				secretKey: apiConfig.secretKey
			});
		}
	} catch (e) {
		console.warn('Failed to initialize image API config from product.json:', e);
	}

	const root = ReactDOM.createRoot(rootElement)

	const rerender = (props?: any) => {
		root.render(<Component {...props} />); // tailwind dark theme indicator
	}
	const dispose = () => {
		root.unmount();
		disposables.forEach(d => d.dispose());
	}

	rerender(props)

	const returnVal = {
		rerender,
		dispose,
	}
	return returnVal
}
