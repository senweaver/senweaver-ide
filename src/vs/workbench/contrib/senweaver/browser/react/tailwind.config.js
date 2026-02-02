/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: 'selector', // '{prefix-}dark' className is used to identify `dark:`
	content: ['./src2/**/*.{jsx,tsx}'], // uses these files to decide how to transform the css file
	theme: {
		extend: {
			typography: theme => ({
				DEFAULT: {
					css: {
						'--tw-prose-body': 'var(--senweaver-fg-1)',
						'--tw-prose-headings': 'var(--senweaver-fg-1)',
						'--tw-prose-lead': 'var(--senweaver-fg-2)',
						'--tw-prose-links': 'var(--senweaver-link-color)',
						'--tw-prose-bold': 'var(--senweaver-fg-1)',
						'--tw-prose-counters': 'var(--senweaver-fg-3)',
						'--tw-prose-bullets': 'var(--senweaver-fg-3)',
						'--tw-prose-hr': 'var(--senweaver-border-4)',
						'--tw-prose-quotes': 'var(--senweaver-fg-1)',
						'--tw-prose-quote-borders': 'var(--senweaver-border-2)',
						'--tw-prose-captions': 'var(--senweaver-fg-3)',
						'--tw-prose-code': 'var(--senweaver-fg-0)',
						'--tw-prose-pre-code': 'var(--senweaver-fg-0)',
						'--tw-prose-pre-bg': 'var(--senweaver-bg-1)',
						'--tw-prose-th-borders': 'var(--senweaver-border-4)',
						'--tw-prose-td-borders': 'var(--senweaver-border-4)',
					},
				},
			}),
			fontSize: {
				xs: '10px',
				sm: '11px',
				root: '13px',
				lg: '14px',
				xl: '16px',
				'2xl': '18px',
				'3xl': '20px',
				'4xl': '24px',
				'5xl': '30px',
				'6xl': '36px',
				'7xl': '48px',
				'8xl': '64px',
				'9xl': '72px',
			},
			// common colors to use, ordered light to dark

			colors: {
				'senweaver-bg-1': 'var(--senweaver-bg-1)',
				'senweaver-bg-1-alt': 'var(--senweaver-bg-1-alt)',
				'senweaver-bg-2': 'var(--senweaver-bg-2)',
				'senweaver-bg-2-alt': 'var(--senweaver-bg-2-alt)',
				'senweaver-bg-2-hover': 'var(--senweaver-bg-2-hover)',
				'senweaver-bg-3': 'var(--senweaver-bg-3)',


				'senweaver-fg-0': 'var(--senweaver-fg-0)',
				'senweaver-fg-1': 'var(--senweaver-fg-1)',
				'senweaver-fg-2': 'var(--senweaver-fg-2)',
				'senweaver-fg-3': 'var(--senweaver-fg-3)',
				// 'senweaver-fg-4': 'var(--vscode-tab-inactiveForeground)',
				'senweaver-fg-4': 'var(--senweaver-fg-4)',

				'senweaver-warning': 'var(--senweaver-warning)',

				'senweaver-border-1': 'var(--senweaver-border-1)',
				'senweaver-border-2': 'var(--senweaver-border-2)',
				'senweaver-border-3': 'var(--senweaver-border-3)',
				'senweaver-border-4': 'var(--senweaver-border-4)',

				'senweaver-ring-color': 'var(--senweaver-ring-color)',
				'senweaver-link-color': 'var(--senweaver-link-color)',

				vscode: {
					// see: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content

					// base colors
					'fg': 'var(--vscode-foreground)',
					'focus-border': 'var(--vscode-focusBorder)',
					'disabled-fg': 'var(--vscode-disabledForeground)',
					'widget-border': 'var(--vscode-widget-border)',
					'widget-shadow': 'var(--vscode-widget-shadow)',
					'selection-bg': 'var(--vscode-selection-background)',
					'description-fg': 'var(--vscode-descriptionForeground)',
					'error-fg': 'var(--vscode-errorForeground)',
					'icon-fg': 'var(--vscode-icon-foreground)',
					'sash-hover-border': 'var(--vscode-sash-hoverBorder)',

					// text colors
					'text-blockquote-bg': 'var(--vscode-textBlockQuote-background)',
					'text-blockquote-border': 'var(--vscode-textBlockQuote-border)',
					'text-codeblock-bg': 'var(--vscode-textCodeBlock-background)',
					'text-link-active-fg': 'var(--vscode-textLink-activeForeground)',
					'text-link-fg': 'var(--vscode-textLink-foreground)',
					'text-preformat-fg': 'var(--vscode-textPreformat-foreground)',
					'text-preformat-bg': 'var(--vscode-textPreformat-background)',
					'text-separator-fg': 'var(--vscode-textSeparator-foreground)',

					// input colors
					'input-bg': 'var(--vscode-input-background)',
					'input-border': 'var(--vscode-input-border)',
					'input-fg': 'var(--vscode-input-foreground)',
					'input-placeholder-fg': 'var(--vscode-input-placeholderForeground)',
					'input-active-bg': 'var(--vscode-input-activeBackground)',
					'input-option-active-border': 'var(--vscode-inputOption-activeBorder)',
					'input-option-active-fg': 'var(--vscode-inputOption-activeForeground)',
					'input-option-hover-bg': 'var(--vscode-inputOption-hoverBackground)',
					'input-validation-error-bg': 'var(--vscode-inputValidation-errorBackground)',
					'input-validation-error-fg': 'var(--vscode-inputValidation-errorForeground)',
					'input-validation-error-border': 'var(--vscode-inputValidation-errorBorder)',
					'input-validation-info-bg': 'var(--vscode-inputValidation-infoBackground)',
					'input-validation-info-fg': 'var(--vscode-inputValidation-infoForeground)',
					'input-validation-info-border': 'var(--vscode-inputValidation-infoBorder)',
					'input-validation-warning-bg': 'var(--vscode-inputValidation-warningBackground)',
					'input-validation-warning-fg': 'var(--vscode-inputValidation-warningForeground)',
					'input-validation-warning-border': 'var(--vscode-inputValidation-warningBorder)',

					// command center colors (the top bar)
					'commandcenter-fg': 'var(--vscode-commandCenter-foreground)',
					'commandcenter-active-fg': 'var(--vscode-commandCenter-activeForeground)',
					'commandcenter-bg': 'var(--vscode-commandCenter-background)',
					'commandcenter-active-bg': 'var(--vscode-commandCenter-activeBackground)',
					'commandcenter-border': 'var(--vscode-commandCenter-border)',
					'commandcenter-inactive-fg': 'var(--vscode-commandCenter-inactiveForeground)',
					'commandcenter-inactive-border': 'var(--vscode-commandCenter-inactiveBorder)',
					'commandcenter-active-border': 'var(--vscode-commandCenter-activeBorder)',
					'commandcenter-debugging-bg': 'var(--vscode-commandCenter-debuggingBackground)',

					// badge colors
					'badge-fg': 'var(--vscode-badge-foreground)',
					'badge-bg': 'var(--vscode-badge-background)',

					// button colors
					'button-bg': 'var(--vscode-button-background)',
					'button-fg': 'var(--vscode-button-foreground)',
					'button-border': 'var(--vscode-button-border)',
					'button-separator': 'var(--vscode-button-separator)',
					'button-hover-bg': 'var(--vscode-button-hoverBackground)',
					'button-secondary-fg': 'var(--vscode-button-secondaryForeground)',
					'button-secondary-bg': 'var(--vscode-button-secondaryBackground)',
					'button-secondary-hover-bg': 'var(--vscode-button-secondaryHoverBackground)',

					// checkbox colors
					'checkbox-bg': 'var(--vscode-checkbox-background)',
					'checkbox-fg': 'var(--vscode-checkbox-foreground)',
					'checkbox-border': 'var(--vscode-checkbox-border)',
					'checkbox-select-bg': 'var(--vscode-checkbox-selectBackground)',

					// sidebar colors
					'sidebar-bg': 'var(--vscode-sideBar-background)',
					'sidebar-fg': 'var(--vscode-sideBar-foreground)',
					'sidebar-border': 'var(--vscode-sideBar-border)',
					'sidebar-drop-bg': 'var(--vscode-sideBar-dropBackground)',
					'sidebar-title-fg': 'var(--vscode-sideBarTitle-foreground)',
					'sidebar-header-bg': 'var(--vscode-sideBarSectionHeader-background)',
					'sidebar-header-fg': 'var(--vscode-sideBarSectionHeader-foreground)',
					'sidebar-header-border': 'var(--vscode-sideBarSectionHeader-border)',
					'sidebar-activitybartop-border': 'var(--vscode-sideBarActivityBarTop-border)',
					'sidebar-title-bg': 'var(--vscode-sideBarTitle-background)',
					'sidebar-title-border': 'var(--vscode-sideBarTitle-border)',
					'sidebar-stickyscroll-bg': 'var(--vscode-sideBarStickyScroll-background)',
					'sidebar-stickyscroll-border': 'var(--vscode-sideBarStickyScroll-border)',
					'sidebar-stickyscroll-shadow': 'var(--vscode-sideBarStickyScroll-shadow)',

					// other colors (these are partially complete)

					// text formatting
					'text-preformat-bg': 'var(--vscode-textPreformat-background)',
					'text-preformat-fg': 'var(--vscode-textPreformat-foreground)',

					// editor colors
					'editor-bg': 'var(--vscode-editor-background)',
					'editor-fg': 'var(--vscode-editor-foreground)',



					// other
					'editorwidget-bg': 'var(--vscode-editorWidget-background)',
					'toolbar-hover-bg': 'var(--vscode-toolbar-hoverBackground)',
					'toolbar-foreground': 'var(--vscode-editorActionList-foreground)',

					'editorwidget-fg': 'var(--vscode-editorWidget-foreground)',
					'editorwidget-border': 'var(--vscode-editorWidget-border)',

					'charts-orange': 'var(--vscode-charts-orange)',
					'charts-yellow': 'var(--vscode-charts-yellow)',
				},
			},
		},
	},
	plugins: [
		require('@tailwindcss/typography')
	],
	prefix: 'senweaver-'
}

