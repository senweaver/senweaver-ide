/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { DesignData } from './DesignerCanvas.js';

interface DesignerMessageRendererProps {
	content: string;
	messageId: string;
	onOpenPreview: (design: DesignData) => void;
}

/**
 * Extracts HTML and CSS from markdown code blocks in the message content
 */
const extractDesignFromContent = (content: string, messageId: string): DesignData | null => {
	// Match HTML code blocks
	const htmlMatch = content.match(/```html\n([\s\S]*?)```/i) || 
	                  content.match(/```\n(<!DOCTYPE html>[\s\S]*?)```/i);
	
	// Match CSS code blocks
	const cssMatch = content.match(/```css\n([\s\S]*?)```/i);
	
	// If we have HTML, we can create a design
	if (htmlMatch) {
		const html = htmlMatch[1].trim();
		const css = cssMatch ? cssMatch[1].trim() : '';
		
		// Determine design type based on content or keywords
		let type: 'mockup' | 'component' | 'wireframe' = 'component';
		const lowerContent = content.toLowerCase();
		
		if (lowerContent.includes('mockup') || lowerContent.includes('screen') || lowerContent.includes('page')) {
			type = 'mockup';
		} else if (lowerContent.includes('wireframe') || lowerContent.includes('sketch')) {
			type = 'wireframe';
		}
		
		// Extract title from content (look for heading or use default)
		const titleMatch = content.match(/^#\s+(.+)$/m);
		const title = titleMatch ? titleMatch[1] : 'UI Design';
		
		return {
			id: messageId,
			type,
			html,
			css,
			title,
			timestamp: Date.now()
		};
	}
	
	return null;
};

/**
 * Component that renders a button to open the design preview panel
 */
export const DesignerMessageRenderer: React.FC<DesignerMessageRendererProps> = ({ content, messageId, onOpenPreview }) => {
	const designData = useMemo(() => {
		return extractDesignFromContent(content, messageId);
	}, [content, messageId]);
	
	if (!designData) {
		return null;
	}
	
	return (
		<div className="designer-message-preview-button">
			<button 
				className="open-preview-btn"
				onClick={() => onOpenPreview(designData)}
			>
				<Eye size={16} />
				<span>打开设计预览</span>
				<span className="design-type-badge">{designData.type}</span>
			</button>
		</div>
	);
};

export default DesignerMessageRenderer;
