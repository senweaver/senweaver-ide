/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DesignerCanvas, DesignData } from './DesignerCanvas.js';
import './DesignerPreviewPanel.css';

interface DesignerPreviewPanelProps {
	designs: DesignData[];
	onClose: () => void;
}

export const DesignerPreviewPanel: React.FC<DesignerPreviewPanelProps> = ({ designs, onClose }) => {
	const [selectedDesignIndex, setSelectedDesignIndex] = useState(0);


	// Auto-select the latest design when new designs are added
	React.useEffect(() => {
		if (designs.length > 0) {
			setSelectedDesignIndex(designs.length - 1);
		}
	}, [designs.length]);

	if (designs.length === 0) {
		return (
			<div className="designer-preview-panel">
				<div className="designer-preview-header">
					<div className="designer-preview-title">
						<span className="title-text">设计预览</span>
					</div>
					<button
						className="close-button"
						onClick={onClose}
						title="关闭预览"
					>
						<X size={18} />
					</button>
				</div>
				<div className="designer-preview-empty">
					<div className="empty-state">
						<span className="empty-icon">🎨</span>
						<p className="empty-text">等待 AI 生成设计...</p>
						<p className="empty-hint">在聊天中描述您想要的 UI 设计</p>
					</div>
				</div>
			</div>
		);
	}

	const currentDesign = designs[selectedDesignIndex];

	return (
		<div className="designer-preview-panel">
			{/* Header */}
			<div className="designer-preview-header">
				<div className="designer-preview-title">
					<span className="title-text">设计预览</span>
					{designs.length > 1 && (
						<span className="design-count">({selectedDesignIndex + 1} / {designs.length})</span>
					)}
				</div>
				<button
					className="close-button"
					onClick={onClose}
					title="关闭预览"
				>
					<X size={18} />
				</button>
			</div>

			{/* Design tabs (if multiple designs) */}
			{designs.length > 1 && (
				<div className="designer-preview-tabs">
					{designs.map((design, index) => (
						<button
							key={design.id}
							className={`design-tab ${index === selectedDesignIndex ? 'active' : ''}`}
							onClick={() => setSelectedDesignIndex(index)}
						>
							<span className="tab-type">{design.type}</span>
							<span className="tab-title">{design.title}</span>
						</button>
					))}
				</div>
			)}

			{/* Canvas */}
			<div className="designer-preview-content">
				<DesignerCanvas design={currentDesign} />
			</div>
		</div>
	);
};

export default DesignerPreviewPanel;
