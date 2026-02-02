/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X, WifiOff } from 'lucide-react';
import { useSettingsState } from '../util/services.js';
import { errorDetails, isConnectionError, getFriendlyErrorMessage } from '../../../../common/sendLLMMessageTypes.js';


export const ErrorDisplay = ({
	message: message_,
	fullError,
	onDismiss,
	showDismiss,
}: {
	message: string,
	fullError: Error | null,
	onDismiss: (() => void) | null,
	showDismiss?: boolean,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const details = errorDetails(fullError)
	const isConnError = isConnectionError(message_, fullError);
	// 连接错误时不显示展开按钮（因为详情对用户没有帮助）
	const isExpandable = !!details && !isConnError;

	// 使用友好的错误消息
	const message = getFriendlyErrorMessage(message_, fullError);

	return (
		<div className={`rounded-lg border ${isConnError ? 'border-orange-200 bg-orange-50' : 'border-red-200 bg-red-50'} p-4 overflow-auto`}>
			{/* Header */}
			<div className='flex items-start justify-between'>
				<div className='flex gap-3'>
					{isConnError ? (
						<WifiOff className='h-5 w-5 text-orange-600 mt-0.5' />
					) : (
						<AlertCircle className='h-5 w-5 text-red-600 mt-0.5' />
					)}
					<div className='flex-1'>
						<h3 className={`font-semibold ${isConnError ? 'text-orange-800' : 'text-red-800'}`}>
							{isConnError ? '连接失败' : 'Error'}
						</h3>
						<p className={`mt-1 ${isConnError ? 'text-orange-700' : 'text-red-700'}`}>
							{message}
						</p>
					</div>
				</div>

				<div className='flex gap-2'>
					{isExpandable && (
						<button className='text-red-600 hover:text-red-800 p-1 rounded'
							onClick={() => setIsExpanded(!isExpanded)}
						>
							{isExpanded ? (
								<ChevronUp className='h-5 w-5' />
							) : (
								<ChevronDown className='h-5 w-5' />
							)}
						</button>
					)}
					{showDismiss && onDismiss && (
						<button className={`${isConnError ? 'text-orange-600 hover:text-orange-800' : 'text-red-600 hover:text-red-800'} p-1 rounded`}
							onClick={onDismiss}
						>
							<X className='h-5 w-5' />
						</button>
					)}
				</div>
			</div>

			{/* Expandable Details */}
			{isExpanded && details && (
				<div className='mt-4 space-y-3 border-t border-red-200 pt-3 overflow-auto'>
					<div>
						<span className='font-semibold text-red-800'>Full Error: </span>
						<pre className='text-red-700'>{details}</pre>
					</div>
				</div>
			)}
		</div>
	);
};
