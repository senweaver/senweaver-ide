/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css'
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import { useIsDark } from '../util/services.js';

/**
 * Creates a configured global tooltip component with consistent styling
 * To use:
 * 1. Mount a Tooltip with some id eg id='senweaver-tooltip'
 * 2. Add data-tooltip-id="senweaver-tooltip" and data-tooltip-content="Your tooltip text" to any element
 */
export const SenweaverTooltip = () => {


	const isDark = useIsDark()

	return (

		// use native colors so we don't have to worry about @@senweaver-scope styles
		// --senweaver-bg-1: var(--vscode-input-background);
		// --senweaver-bg-1-alt: var(--vscode-badge-background);
		// --senweaver-bg-2: var(--vscode-sideBar-background);
		// --senweaver-bg-2-alt: color-mix(in srgb, var(--vscode-sideBar-background) 30%, var(--vscode-editor-background) 70%);
		// --senweaver-bg-3: var(--vscode-editor-background);

		// --senweaver-fg-0: color-mix(in srgb, var(--vscode-tab-activeForeground) 90%, black 10%);
		// --senweaver-fg-1: var(--vscode-editor-foreground);
		// --senweaver-fg-2: var(--vscode-input-foreground);
		// --senweaver-fg-3: var(--vscode-input-placeholderForeground);
		// /* --senweaver-fg-4: var(--vscode-tab-inactiveForeground); */
		// --senweaver-fg-4: var(--vscode-list-deemphasizedForeground);

		// --senweaver-warning: var(--vscode-charts-yellow);

		// --senweaver-border-1: var(--vscode-commandCenter-activeBorder);
		// --senweaver-border-2: var(--vscode-commandCenter-border);
		// --senweaver-border-3: var(--vscode-commandCenter-inactiveBorder);
		// --senweaver-border-4: var(--vscode-editorGroup-border);

		<>
			<style>
				{`
				#senweaver-tooltip, #senweaver-tooltip-orange, #senweaver-tooltip-green, #senweaver-tooltip-ollama-settings, #senweaver-tooltip-provider-info {
					font-size: 11px;
					padding: 4px 10px;
					border-radius: 9999px;
					z-index: 999999;
					max-width: 300px;
					word-wrap: break-word;
				}

				#senweaver-tooltip {
					background-color: #1e1e1e;
					color: var(--vscode-input-foreground);
				}

				#senweaver-tooltip-orange {
					background-color: #F6762A;
					color: white;
				}

				#senweaver-tooltip-green {
					background-color: #1e1e1e;
					color: #4ade80;
					border-radius: 9999px;
					padding: 4px 12px;
				}

				#senweaver-tooltip-ollama-settings, #senweaver-tooltip-provider-info {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);
				}

				.react-tooltip-arrow {
					z-index: -1 !important; /* Keep arrow behind content (somehow this isnt done automatically) */
				}
				`}
			</style>


			<Tooltip
				id="senweaver-tooltip"
				// border='1px solid var(--vscode-editorGroup-border)'
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="senweaver-tooltip-orange"
				border='1px solid rgba(200,200,200,.3)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="senweaver-tooltip-green"
				border='1px solid rgba(200,200,200,.3)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="senweaver-tooltip-ollama-settings"
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				openEvents={{ mouseover: true, click: true, focus: true }}
				place='right'
				style={{ pointerEvents: 'all', userSelect: 'text', fontSize: 11 }}
			>
				<div style={{ padding: '8px 10px' }}>
					<div style={{ opacity: 0.8, textAlign: 'center', fontWeight: 'bold', marginBottom: 8 }}>
						Good starter models
					</div>
					<div style={{ marginBottom: 4 }}>
						<span style={{ opacity: 0.8 }}>For chat:{` `}</span>
						<span style={{ opacity: 0.8, fontWeight: 'bold' }}>gemma3</span>
					</div>
					<div style={{ marginBottom: 4 }}>
						<span style={{ opacity: 0.8 }}>For autocomplete:{` `}</span>
						<span style={{ opacity: 0.8, fontWeight: 'bold' }}>qwen2.5-coder</span>
					</div>
					<div style={{ marginBottom: 0 }}>
						<span style={{ opacity: 0.8 }}>Use the largest version of these you can!</span>
					</div>
				</div>
			</Tooltip>

			<Tooltip
				id="senweaver-tooltip-provider-info"
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				delayShow={50}
				style={{ pointerEvents: 'all', userSelect: 'text', fontSize: 11, maxWidth: '280px', paddingTop:'8px', paddingBottom:'8px' }}
			/>
		</>
	);
};
