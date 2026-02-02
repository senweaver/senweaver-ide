/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Download, Maximize2, RefreshCw } from 'lucide-react';
import './DesignerCanvas.css';

// Create a trusted types policy for iframe content
const createTrustedHTML = (() => {
	if (typeof window !== 'undefined' && (window as any).trustedTypes) {
		try {
			const policy = (window as any).trustedTypes.createPolicy('designer-iframe', {
				createHTML: (input: string) => input
			});
			return (html: string) => policy.createHTML(html);
		} catch (e) {
			console.warn('Failed to create trusted types policy:', e);
		}
	}
	// Fallback: return the string as-is
	return (html: string) => html;
})();

export interface NavigationLink {
	elementText?: string;
	elementSelector?: string;
	targetDesignId: string;
}

export interface DesignData {
	id: string;
	type: 'mockup' | 'component' | 'wireframe';
	html: string;
	css: string;
	title: string;
	timestamp: number;
	navigationLinks?: NavigationLink[];
}

interface DesignerCanvasProps {
	design: DesignData;
	onFork?: (design: DesignData) => void;
	onCopyPrompt?: (design: DesignData) => void;
}

export const DesignerCanvas: React.FC<DesignerCanvasProps> = ({ design, onFork, onCopyPrompt }) => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const updateTimerRef = useRef<number | null>(null);
	const updateRafRef = useRef<number | null>(null);
	const latestHtmlRef = useRef(design.html);
	const latestCssRef = useRef(design.css);

	// Update iframe content when design changes
	useEffect(() => {
		latestHtmlRef.current = design.html;
		latestCssRef.current = design.css;

		const iframe = iframeRef.current;
		if (!iframe) return;

		const flushUpdate = () => {
			try {
				const doc = iframe.contentDocument || iframe.contentWindow?.document;
				if (!doc) return;

				const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		${latestCssRef.current}
	</style>
</head>
<body>
	${latestHtmlRef.current}
</body>
</html>`;

				// Clear and write new content using trusted types
				doc.open();
				const trustedHTML = createTrustedHTML(fullHTML);
				doc.write(trustedHTML as any);
				doc.close();
			} catch (error) {
				console.error('Failed to update iframe content:', error);
			}
		};

		// Debounce heavy doc.write to avoid blocking UI on rapid updates
		if (updateTimerRef.current) {
			window.clearTimeout(updateTimerRef.current);
			updateTimerRef.current = null;
		}
		if (updateRafRef.current) {
			cancelAnimationFrame(updateRafRef.current);
			updateRafRef.current = null;
		}

		// Schedule: small delay + RAF (keeps typing/scroll smooth)
		updateTimerRef.current = window.setTimeout(() => {
			updateRafRef.current = requestAnimationFrame(() => {
				updateRafRef.current = null;
				// Wait for iframe to be ready
				if (iframe.contentDocument?.readyState === 'complete') {
					flushUpdate();
				} else {
					iframe.onload = flushUpdate;
				}
			});
			updateTimerRef.current = null;
		}, 120);

		return () => {
			if (updateTimerRef.current) {
				window.clearTimeout(updateTimerRef.current);
				updateTimerRef.current = null;
			}
			if (updateRafRef.current) {
				cancelAnimationFrame(updateRafRef.current);
				updateRafRef.current = null;
			}
		};
	}, [design.html, design.css]);

	const handleCopyHTML = () => {
		const fullCode = `<!-- ${design.title} -->\n<style>\n${design.css}\n</style>\n\n${design.html}`;
		navigator.clipboard.writeText(fullCode);
	};

	const handleDownload = () => {
		const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${design.title}</title>
	<style>
		${design.css}
	</style>
</head>
<body>
	${design.html}
</body>
</html>`;

		const blob = new Blob([fullHTML], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${design.title.replace(/\s+/g, '-').toLowerCase()}.html`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleRefresh = () => {
		if (iframeRef.current) {
			iframeRef.current.src = iframeRef.current.src;
		}
	};

	const toggleFullscreen = () => {
		setIsFullscreen(!isFullscreen);
	};

	return (
		<div className={`designer-canvas-container ${isFullscreen ? 'fullscreen' : ''}`}>
			<div className="designer-canvas-header">
				<div className="designer-canvas-title">
					<span className="design-type-badge">{design.type}</span>
					<span className="design-title">{design.title}</span>
				</div>
				<div className="designer-canvas-actions">
					<button
						className="canvas-action-btn"
						onClick={handleRefresh}
						title="刷新"
					>
						<RefreshCw size={14} />
					</button>
					<button
						className="canvas-action-btn"
						onClick={handleCopyHTML}
						title="复制代码"
					>
						<Copy size={14} />
					</button>
					<button
						className="canvas-action-btn"
						onClick={handleDownload}
						title="下载 HTML"
					>
						<Download size={14} />
					</button>
					{onFork && (
						<button
							className="canvas-action-btn"
							onClick={() => onFork(design)}
							title="Fork & 迭代"
						>
							<RefreshCw size={14} />
						</button>
					)}
					<button
						className="canvas-action-btn"
						onClick={toggleFullscreen}
						title={isFullscreen ? '退出全屏' : '全屏'}
					>
						<Maximize2 size={14} />
					</button>
				</div>
			</div>
			<div className="designer-canvas-frame">
				<iframe
					ref={iframeRef}
					title={design.title}
					sandbox="allow-scripts allow-same-origin"
					className="design-iframe"
				/>
			</div>
		</div>
	);
};

export default DesignerCanvas;
