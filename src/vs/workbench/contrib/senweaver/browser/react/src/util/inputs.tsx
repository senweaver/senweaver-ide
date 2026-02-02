/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { forwardRef, ForwardRefExoticComponent, MutableRefObject, RefAttributes, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IInputBoxStyles, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { Checkbox } from '../../../../../../../base/browser/ui/toggle/toggle.js';

import { CodeEditorWidget } from '../../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js'
import { useAccessor } from './services.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { asCssVariable } from '../../../../../../../platform/theme/common/colorUtils.js';
import { inputBackground, inputForeground } from '../../../../../../../platform/theme/common/colorRegistry.js';
import { useFloating, autoUpdate, offset, flip, shift, size, autoPlacement } from '@floating-ui/react';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename, getFolderName } from '../sidebar-tsx/SidebarChat.js';
import { ChevronRight, File, Folder, FolderClosed, LucideProps } from 'lucide-react';
import { StagingSelectionItem, ImageAttachment } from '../../../../common/chatThreadServiceTypes.js';
import { DiffEditorWidget } from '../../../../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { extractSearchReplaceBlocks, ExtractedSearchReplaceBlock } from '../../../../common/helpers/extractCodeFromResult.js';
import { IAccessibilitySignalService } from '../../../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IEditorProgressService } from '../../../../../../../platform/progress/common/progress.js';
import { detectLanguage } from '../../../../common/helpers/languageHelpers.js';
import { extractEditorsDropData } from '../../../../../../../platform/dnd/browser/dnd.js';
import { DataTransfers } from '../../../../../../../base/browser/dnd.js';


// type guard
const isConstructor = (f: any)
	: f is { new(...params: any[]): any } => {
	return !!f.prototype && f.prototype.constructor === f;
}

export const WidgetComponent = <CtorParams extends any[], Instance>({ ctor, propsFn, dispose, onCreateInstance, children, className }
	: {
		ctor: { new(...params: CtorParams): Instance } | ((container: HTMLDivElement) => Instance),
		propsFn: (container: HTMLDivElement) => CtorParams, // unused if fn
		onCreateInstance: (instance: Instance) => IDisposable[],
		dispose: (instance: Instance) => void,
		children?: React.ReactNode,
		className?: string
	}
) => {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const instance = isConstructor(ctor) ? new ctor(...propsFn(containerRef.current!)) : ctor(containerRef.current!)
		const disposables = onCreateInstance(instance);
		return () => {
			disposables.forEach(d => d.dispose());
			dispose(instance)
		}
	}, [ctor, propsFn, dispose, onCreateInstance, containerRef])

	return <div ref={containerRef} className={className === undefined ? `w-full` : className}>{children}</div>
}

type GenerateNextOptions = (optionText: string) => Promise<Option[]>

type Option = {
	fullName: string,
	abbreviatedName: string,
	iconInMenu: ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>, // type for lucide-react components
} & (
		| { leafNodeType?: undefined, nextOptions: Option[], generateNextOptions?: undefined, }
		| { leafNodeType?: undefined, nextOptions?: undefined, generateNextOptions: GenerateNextOptions, }
		| { leafNodeType: 'File' | 'Folder', uri: URI, nextOptions?: undefined, generateNextOptions?: undefined, }
	)


const isSubsequence = (text: string, pattern: string): boolean => {

	text = text.toLowerCase()
	pattern = pattern.toLowerCase()

	if (pattern === '') return true;
	if (text === '') return false;
	if (pattern.length > text.length) return false;

	const seq: boolean[][] = Array(pattern.length + 1)
		.fill(null)
		.map(() => Array(text.length + 1).fill(false));

	for (let j = 0; j <= text.length; j++) {
		seq[0][j] = true;
	}

	for (let i = 1; i <= pattern.length; i++) {
		for (let j = 1; j <= text.length; j++) {
			if (pattern[i - 1] === text[j - 1]) {
				seq[i][j] = seq[i - 1][j - 1];
			} else {
				seq[i][j] = seq[i][j - 1];
			}
		}
	}
	return seq[pattern.length][text.length];
};


const scoreSubsequence = (text: string, pattern: string): number => {
	if (pattern === '') return 0;

	text = text.toLowerCase();
	pattern = pattern.toLowerCase();

	// We'll use dynamic programming to find the longest consecutive substring
	const n = text.length;
	const m = pattern.length;

	// This will track our maximum consecutive match length
	let maxConsecutive = 0;

	// For each starting position in the text
	for (let i = 0; i < n; i++) {
		// Check for matches starting from this position
		let consecutiveCount = 0;

		// For each character in the pattern
		for (let j = 0; j < m; j++) {
			// If we have a match and we're still within text bounds
			if (i + j < n && text[i + j] === pattern[j]) {
				consecutiveCount++;
			} else {
				// Break on first non-match
				break;
			}
		}

		// Update our maximum
		maxConsecutive = Math.max(maxConsecutive, consecutiveCount);
	}

	return maxConsecutive;
}


function getRelativeWorkspacePath(accessor: ReturnType<typeof useAccessor>, uri: URI): string {
	const workspaceService = accessor.get('IWorkspaceContextService');
	const workspaceFolders = workspaceService.getWorkspace().folders;

	if (!workspaceFolders.length) {
		return uri.fsPath; // No workspace folders, return original path
	}

	// Sort workspace folders by path length (descending) to match the most specific folder first
	const sortedFolders = [...workspaceFolders].sort((a, b) =>
		b.uri.fsPath.length - a.uri.fsPath.length
	);

	// Add trailing slash to paths for exact matching
	const uriPath = uri.fsPath.endsWith('/') ? uri.fsPath : uri.fsPath + '/';

	// Check if the URI is inside any workspace folder
	for (const folder of sortedFolders) {


		const folderPath = folder.uri.fsPath.endsWith('/') ? folder.uri.fsPath : folder.uri.fsPath + '/';
		if (uriPath.startsWith(folderPath)) {
			// Calculate the relative path by removing the workspace folder path
			let relativePath = uri.fsPath.slice(folder.uri.fsPath.length);
			// Remove leading slash if present
			if (relativePath.startsWith('/')) {
				relativePath = relativePath.slice(1);
			}

			return relativePath;
		}
	}

	// URI is not in any workspace folder, return original path
	return uri.fsPath;
}



const numOptionsToShow = 100



// TODO make this unique based on other options
const getAbbreviatedName = (relativePath: string) => {
	return getBasename(relativePath, 1)
}

const getOptionsAtPath = async (accessor: ReturnType<typeof useAccessor>, path: string[], optionText: string): Promise<Option[]> => {

	const toolsService = accessor.get('IToolsService')



	const searchForFilesOrFolders = async (t: string, searchFor: 'files' | 'folders') => {
		try {

			const searchResults = (await (await toolsService.callTool.search_pathnames_only({
				query: t,
				includePattern: null,
				pageNumber: 1,
			})).result).uris

			if (searchFor === 'files') {
				const res: Option[] = searchResults.map(uri => {
					const relativePath = getRelativeWorkspacePath(accessor, uri)
					return {
						leafNodeType: 'File',
						uri: uri,
						iconInMenu: File,
						fullName: relativePath,
						abbreviatedName: getAbbreviatedName(relativePath),
					}
				})
				return res
			}

			else if (searchFor === 'folders') {
				// Extract unique directory paths from the results
				const directoryMap = new Map<string, URI>();

				for (const uri of searchResults) {
					if (!uri) continue;

					// Get the full path and extract directories
					const relativePath = getRelativeWorkspacePath(accessor, uri)
					const pathParts = relativePath.split('/');

					// Get workspace info
					const workspaceService = accessor.get('IWorkspaceContextService');
					const workspaceFolders = workspaceService.getWorkspace().folders;

					// Find the workspace folder containing this URI
					let workspaceFolderUri: URI | undefined;
					if (workspaceFolders.length) {
						// Sort workspace folders by path length (descending) to match the most specific folder first
						const sortedFolders = [...workspaceFolders].sort((a, b) =>
							b.uri.fsPath.length - a.uri.fsPath.length
						);

						// Find the containing workspace folder
						for (const folder of sortedFolders) {
							const folderPath = folder.uri.fsPath.endsWith('/') ? folder.uri.fsPath : folder.uri.fsPath + '/';
							const uriPath = uri.fsPath.endsWith('/') ? uri.fsPath : uri.fsPath + '/';

							if (uriPath.startsWith(folderPath)) {
								workspaceFolderUri = folder.uri;
								break;
							}
						}
					}

					if (workspaceFolderUri) {
						// Add each directory and its parents to the map
						let currentPath = '';
						for (let i = 0; i < pathParts.length - 1; i++) {
							currentPath = i === 0 ? `/${pathParts[i]}` : `${currentPath}/${pathParts[i]}`;


							// Create a proper directory URI
							const directoryUri = URI.joinPath(
								workspaceFolderUri,
								currentPath.startsWith('/') ? currentPath.substring(1) : currentPath
							);

							directoryMap.set(currentPath, directoryUri);
						}
					}
				}
				// Convert map to array
				return Array.from(directoryMap.entries()).map(([relativePath, uri]) => ({
					leafNodeType: 'Folder',
					uri: uri,
					iconInMenu: Folder, // Folder
					fullName: relativePath,
					abbreviatedName: getAbbreviatedName(relativePath),
				})) satisfies Option[];
			}
		} catch (error) {
			console.error('Error fetching directories:', error);
			return [];
		}
	};


	const allOptions: Option[] = [
		{
			fullName: 'files',
			abbreviatedName: 'files',
			iconInMenu: File,
			generateNextOptions: async (t) => (await searchForFilesOrFolders(t, 'files')) || [],
		},
		{
			fullName: 'folders',
			abbreviatedName: 'folders',
			iconInMenu: Folder,
			generateNextOptions: async (t) => (await searchForFilesOrFolders(t, 'folders')) || [],
		},
	]

	// follow the path in the optionsTree (until the last path element)

	let nextOptionsAtPath = allOptions
	let generateNextOptionsAtPath: GenerateNextOptions | undefined = undefined

	for (const pn of path) {

		const selectedOption = nextOptionsAtPath.find(o => o.fullName.toLowerCase() === pn.toLowerCase())

		if (!selectedOption) return [];

		nextOptionsAtPath = selectedOption.nextOptions! // assume nextOptions exists until we hit the very last option (the path will never contain the last possible option)
		generateNextOptionsAtPath = selectedOption.generateNextOptions

	}


	if (generateNextOptionsAtPath) {

		nextOptionsAtPath = await generateNextOptionsAtPath(optionText)
	}
	else if (path.length === 0 && optionText.trim().length > 0) { // (special case): directly search for both files and folders if optionsPath is empty and there's a search term
		const filesResults = await searchForFilesOrFolders(optionText, 'files') || [];
		const foldersResults = await searchForFilesOrFolders(optionText, 'folders') || [];
		nextOptionsAtPath = [...foldersResults, ...filesResults,]
	}

	const optionsAtPath = nextOptionsAtPath
		.filter(o => isSubsequence(o.fullName, optionText))
		.sort((a, b) => { // this is a hack but good for now
			const scoreA = scoreSubsequence(a.fullName, optionText);
			const scoreB = scoreSubsequence(b.fullName, optionText);
			return scoreB - scoreA;
		})
		.slice(0, numOptionsToShow) // should go last because sorting/filtering should happen on all datapoints

	return optionsAtPath

}



export type TextAreaFns = { setValue: (v: string) => void, enable: () => void, disable: () => void }
type InputBox2Props = {
	initValue?: string | null;
	placeholder: string;
	multiline: boolean;
	enableAtToMention?: boolean;
	enableImageUpload?: boolean; // New prop for image upload
	onImageUpload?: (images: ImageAttachment[]) => void; // Callback for image uploads
	fnsRef?: { current: null | TextAreaFns };
	className?: string;
	onChangeText?: (value: string) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
	onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
	onChangeHeight?: (newHeight: number) => void;
}
export const SenweaverInputBox2 = forwardRef<HTMLTextAreaElement, InputBox2Props>(function X({
	initValue,
	placeholder,
	multiline,
	enableAtToMention,
	enableImageUpload = false,
	onImageUpload,
	fnsRef,
	className,
	onKeyDown,
	onFocus,
	onBlur,
	onChangeText
}, ref) {


	// mirrors whatever is in ref
	const accessor = useAccessor()

	const chatThreadService = accessor.get('IChatThreadService')
	const languageService = accessor.get('ILanguageService')

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const selectedOptionRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// 从线程状态获取上传的图片，而不是维护本地状态
	const currentThread = chatThreadService.getCurrentThread();
	const uploadedImages = currentThread?.state?.uploadedImages || [];
	const [isMenuOpen, _setIsMenuOpen] = useState(false); // the @ to mention menu
	const [inputValue, setInputValue] = useState(''); // track input value for overlay rendering
	const setIsMenuOpen: typeof _setIsMenuOpen = (value) => {
		if (!enableAtToMention) { return; } // never open menu if not enabled
		_setIsMenuOpen(value);
	}

	// logic for @ to mention vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv
	const [optionPath, setOptionPath] = useState<string[]>([]);
	const [optionIdx, setOptionIdx] = useState<number>(0);
	const [options, setOptions] = useState<Option[]>([]);
	const [optionText, setOptionText] = useState<string>('');
	const [didLoadInitialOptions, setDidLoadInitialOptions] = useState(false);

	const currentPathRef = useRef<string>(JSON.stringify([]));

	// dont show breadcrums if first page and user hasnt typed anything
	const isTypingEnabled = true
	const isBreadcrumbsShowing = optionPath.length === 0 && !optionText ? false : true

	const insertTextAtCursor = (text: string) => {
		const textarea = textAreaRef.current;
		if (!textarea) return;

		// Focus the textarea first
		textarea.focus();

		// delete the @ and set the cursor position
		// Get cursor position
		const startPos = textarea.selectionStart;
		const endPos = textarea.selectionEnd;

		// Get the text before the cursor, excluding the @ symbol that triggered the menu
		const textBeforeCursor = textarea.value.substring(0, startPos - 1);
		const textAfterCursor = textarea.value.substring(endPos);

		// Replace the text including the @ symbol with the selected option
		textarea.value = textBeforeCursor + textAfterCursor;

		// Set cursor position after the inserted text
		const newCursorPos = textBeforeCursor.length;
		textarea.setSelectionRange(newCursorPos, newCursorPos);

		// React's onChange relies on a SyntheticEvent system
		// The best way to ensure it runs is to call callbacks directly
		if (onChangeText) {
			onChangeText(textarea.value);
		}
		adjustHeight();
	};


	const onSelectOption = async () => {

		if (!options.length) { return; }

		const option = options[optionIdx];
		const newPath = [...optionPath, option.fullName]
		const isLastOption = !option.generateNextOptions && !option.nextOptions
		setDidLoadInitialOptions(false)
		if (isLastOption) {
			setIsMenuOpen(false)
			insertTextAtCursor(option.abbreviatedName)

			let newSelection: StagingSelectionItem
			if (option.leafNodeType === 'File') newSelection = {
				type: 'File',
				uri: option.uri,
				language: languageService.guessLanguageIdByFilepathOrFirstLine(option.uri) || '',
				state: { wasAddedAsCurrentFile: false },
			}
			else if (option.leafNodeType === 'Folder') newSelection = {
				type: 'Folder',
				uri: option.uri,
				language: undefined,
				state: undefined,
			}
			else throw new Error(`Unexpected leafNodeType ${option.leafNodeType}`)

			chatThreadService.addNewStagingSelection(newSelection)
		}
		else {


			currentPathRef.current = JSON.stringify(newPath);
			const newOpts = await getOptionsAtPath(accessor, newPath, '') || []
			if (currentPathRef.current !== JSON.stringify(newPath)) { return; }
			setOptionPath(newPath)
			setOptionText('')
			setOptionIdx(0)
			setOptions(newOpts)
			setDidLoadInitialOptions(true)
		}
	}

	const onRemoveOption = async () => {
		const newPath = [...optionPath.slice(0, optionPath.length - 1)]
		currentPathRef.current = JSON.stringify(newPath);
		const newOpts = await getOptionsAtPath(accessor, newPath, '') || []
		if (currentPathRef.current !== JSON.stringify(newPath)) { return; }
		setOptionPath(newPath)
		setOptionText('')
		setOptionIdx(0)
		setOptions(newOpts)
	}

	const onOpenOptionMenu = async () => {
		const newPath: [] = []
		currentPathRef.current = JSON.stringify([]);
		const newOpts = await getOptionsAtPath(accessor, [], '') || []
		if (currentPathRef.current !== JSON.stringify([])) { return; }
		setOptionPath(newPath)
		setOptionText('')
		setIsMenuOpen(true);
		setOptionIdx(0);
		setOptions(newOpts);
	}
	const onCloseOptionMenu = () => {
		setIsMenuOpen(false);
	}

	const onNavigateUp = (step = 1, periodic = true) => {
		if (options.length === 0) return;
		setOptionIdx((prevIdx) => {
			const newIdx = prevIdx - step;
			return periodic ? (newIdx + options.length) % options.length : Math.max(0, newIdx);
		});
	}
	const onNavigateDown = (step = 1, periodic = true) => {
		if (options.length === 0) return;
		setOptionIdx((prevIdx) => {
			const newIdx = prevIdx + step;
			return periodic ? newIdx % options.length : Math.min(options.length - 1, newIdx);
		});
	}

	const onNavigateToTop = () => {
		if (options.length === 0) return;
		setOptionIdx(0);
	}
	const onNavigateToBottom = () => {
		if (options.length === 0) return;
		setOptionIdx(options.length - 1);
	}

	const debounceTimerRef = useRef<number | null>(null);

	useEffect(() => {
		// Cleanup function to cancel any pending timeouts when unmounting
		return () => {
			if (debounceTimerRef.current !== null) {
				window.clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, []);

	// debounced, but immediate if text is empty
	const onPathTextChange = useCallback((newStr: string) => {


		setOptionText(newStr);

		if (debounceTimerRef.current !== null) {
			window.clearTimeout(debounceTimerRef.current);
		}

		currentPathRef.current = JSON.stringify(optionPath);

		const fetchOptions = async () => {
			const newOpts = await getOptionsAtPath(accessor, optionPath, newStr) || [];
			if (currentPathRef.current !== JSON.stringify(optionPath)) { return; }
			setOptions(newOpts);
			setOptionIdx(0);
			debounceTimerRef.current = null;
		};

		// If text is empty, run immediately without debouncing
		if (newStr.trim() === '') {
			fetchOptions();
		} else {
			// Otherwise, set a new timeout to fetch options after a delay
			debounceTimerRef.current = window.setTimeout(fetchOptions, 300);
		}
	}, [optionPath, accessor]);


	const onMenuKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {

		const isCommandKeyPressed = e.altKey || e.ctrlKey || e.metaKey;

		if (e.key === 'ArrowUp') {
			if (isCommandKeyPressed) {
				onNavigateToTop()
			} else {
				if (e.altKey) {
					onNavigateUp(10, false);
				} else {
					onNavigateUp();
				}
			}
		} else if (e.key === 'ArrowDown') {
			if (isCommandKeyPressed) {
				onNavigateToBottom()
			} else {
				if (e.altKey) {
					onNavigateDown(10, false);
				} else {
					onNavigateDown();
				}
			}
		} else if (e.key === 'ArrowLeft') {
			onRemoveOption();
		} else if (e.key === 'ArrowRight') {
			onSelectOption();
		} else if (e.key === 'Enter') {
			onSelectOption();
		} else if (e.key === 'Escape') {
			onCloseOptionMenu()
		} else if (e.key === 'Backspace') {

			if (!optionText) { // No text remaining
				if (optionPath.length === 0) {
					onCloseOptionMenu()
					return; // don't prevent defaults (backspaces the @ symbol)
				} else {
					onRemoveOption();
				}
			}
			else if (isCommandKeyPressed) { // Ctrl+Backspace
				onPathTextChange('')
			}
			else { // Backspace
				onPathTextChange(optionText.slice(0, -1))
			}
		} else if (e.key.length === 1) {
			if (isCommandKeyPressed) { // Ctrl+letter
				// do nothing
			}
			else { // letter
				if (isTypingEnabled) {
					onPathTextChange(optionText + e.key)
				}
			}
		}

		e.preventDefault();
		e.stopPropagation();

	};

	// scroll the selected optionIdx into view on optionIdx and optionText changes
	useEffect(() => {
		if (isMenuOpen && selectedOptionRef.current) {
			selectedOptionRef.current.scrollIntoView({
				behavior: 'instant',
				block: 'nearest',
				inline: 'nearest',
			});
		}
	}, [optionIdx, isMenuOpen, optionText, selectedOptionRef]);

	const measureRef = useRef<HTMLDivElement>(null);
	const gapPx = 2
	const offsetPx = 2
	const {
		x,
		y,
		strategy,
		refs,
		middlewareData,
		update
	} = useFloating({
		open: isMenuOpen,
		onOpenChange: setIsMenuOpen,
		placement: 'bottom',

		middleware: [
			offset({ mainAxis: gapPx, crossAxis: offsetPx }),
			flip({
				boundary: document.body,
				padding: 8
			}),
			shift({
				boundary: document.body,
				padding: 8,
			}),
			size({
				apply({ elements, rects }) {
					// Just set width on the floating element and let content handle scrolling
					Object.assign(elements.floating.style, {
						width: `${Math.max(
							rects.reference.width,
							measureRef.current?.offsetWidth ?? 0
						)}px`
					});
				},
				padding: 8,
				// Use viewport as boundary instead of any parent element
				boundary: document.body,
			}),
		],
		whileElementsMounted: autoUpdate,
		strategy: 'fixed',
	});
	useEffect(() => {
		if (!isMenuOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const floating = refs.floating.current;
			const reference = refs.reference.current;

			// Check if reference is an HTML element before using contains
			const isReferenceHTMLElement = reference && 'contains' in reference;

			if (
				floating &&
				(!isReferenceHTMLElement || !reference.contains(target)) &&
				!floating.contains(target)
			) {
				setIsMenuOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isMenuOpen, refs.floating, refs.reference]);
	// logic for @ to mention ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^


	const [isEnabled, setEnabled] = useState(true)

	// Image upload handlers - 处理图片文件并自动上传到服务器
	const handleFileSelect = useCallback(async (files: FileList) => {
		if (!enableImageUpload || !onImageUpload) return;

		const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
		if (imageFiles.length === 0) return;

		try {
			const { processImageFiles, uploadImagesWithProgress } = await import('./imageUtils.js');
			const processedImages = await processImageFiles(imageFiles);

			// 先添加到状态中（显示pending/uploading状态）
			onImageUpload(processedImages);

			// 然后触发上传，并在上传过程中更新状态
			uploadImagesWithProgress(processedImages, (updatedImages) => {
				// 获取当前的所有图片
				const currentThread = chatThreadService.getCurrentThread();
				if (currentThread) {
					const existing = currentThread.state.uploadedImages || [];
					// 替换正在上传的图片为更新后的状态
					const merged = existing.map(img => {
						const updated = updatedImages.find(u => u.id === img.id);
						return updated || img;
					});
					chatThreadService.setCurrentThreadState({
						uploadedImages: merged
					});
				}
			});
		} catch (error) {
			console.error('Error processing images:', error);
		}
	}, [enableImageUpload, onImageUpload, chatThreadService]);

	const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			handleFileSelect(e.target.files);
		}
	}, [handleFileSelect]);

	// Note: Drag and drop is now handled by SenweaverChatArea parent component
	// This provides unified handling for files, folders, and images

	const removeImage = useCallback((index: number) => {
		if (!onImageUpload) return;

		// 从当前线程状态中移除图片
		const currentImages = uploadedImages.filter((_, i) => i !== index);
		onImageUpload(currentImages);
	}, [uploadedImages, onImageUpload]);

	// Handle paste events to support pasting images from clipboard
	const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		if (!enableImageUpload || !onImageUpload) return;

		const items = e.clipboardData?.items;
		if (!items) return;

		// Check if clipboard contains image data
		const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
		if (imageItems.length === 0) return;

		// Prevent default paste behavior when we have images
		e.preventDefault();

		try {
			const files: File[] = [];
			for (const item of imageItems) {
				const file = item.getAsFile();
				if (file) {
					files.push(file);
				}
			}

			if (files.length > 0) {
				// Create a FileList-like object
				const fileList = {
					length: files.length,
					item: (index: number) => files[index] || null,
					[Symbol.iterator]: function* () {
						for (let i = 0; i < files.length; i++) {
							yield files[i];
						}
					}
				} as any as FileList;

				// Reuse existing handleFileSelect logic
				await handleFileSelect(fileList);

			}
		} catch (error) {
			console.error('[SenweaverInputBox2] Error pasting images from clipboard:', error);
		}
	}, [enableImageUpload, onImageUpload, handleFileSelect]);

	const adjustHeight = useCallback(() => {
		const r = textAreaRef.current
		if (!r) return

		r.style.height = 'auto' // set to auto to reset height, then set to new height

		if (r.scrollHeight === 0) return requestAnimationFrame(adjustHeight)
		const h = r.scrollHeight
		const newHeight = Math.min(h + 1, 500) // plus one to avoid scrollbar appearing when it shouldn't
		r.style.height = `${newHeight}px`
	}, []);



	const fns: TextAreaFns = useMemo(() => ({
		setValue: (val) => {
			const r = textAreaRef.current
			if (!r) return
			r.value = val
			setInputValue(val) // sync overlay
			onChangeText?.(r.value)
			adjustHeight()
		},
		enable: () => { setEnabled(true) },
		disable: () => { setEnabled(false) },
	}), [onChangeText, adjustHeight])

	// Render text with @terminal:xxx as styled chips
	const renderTextWithTerminalChips = useCallback((text: string) => {
		const terminalMentionRegex = /@terminal:([^\s]+)/g;
		const parts: React.ReactNode[] = [];
		let lastIndex = 0;
		let match;

		while ((match = terminalMentionRegex.exec(text)) !== null) {
			// Add text before the match
			if (match.index > lastIndex) {
				parts.push(text.slice(lastIndex, match.index));
			}
			// Add the styled terminal chip - minimal styling to preserve text width alignment
			const fullMatch = match[0]; // @terminal:terminalName
			parts.push(
				<span
					key={match.index}
					style={{
						backgroundColor: 'var(--vscode-badge-background, #4d4d4d)',
						color: 'var(--vscode-badge-foreground, #ffffff)',
						borderRadius: '3px',
					}}
				>
					{fullMatch}
				</span>
			);
			lastIndex = match.index + match[0].length;
		}
		// Add remaining text
		if (lastIndex < text.length) {
			parts.push(text.slice(lastIndex));
		}
		return parts.length > 0 ? parts : text;
	}, [])



	useEffect(() => {
		if (initValue)
			fns.setValue(initValue)
	}, [initValue])




	return <div className="relative w-full">
		{/* Image Upload Input */}
		{enableImageUpload && (
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				style={{ display: 'none' }}
				onChange={handleFileInputChange}
			/>
		)}

		{/* Image Previews with upload status */}
		{enableImageUpload && uploadedImages.length > 0 && (
			<div className="mb-2 flex flex-wrap gap-2">
				{uploadedImages.map((image, index) => {
					const isUploading = image.uploadStatus === 'uploading';
					const isUploaded = image.uploadStatus === 'uploaded';
					const hasError = image.uploadStatus === 'error';

					return (
						<div key={index} className="relative group">
							<img
								src={`data:${image.mimeType};base64,${image.base64Data}`}
								alt={image.name}
								className={`w-16 h-16 object-cover rounded border border-senweaver-border-3 ${isUploading ? 'opacity-50' : ''}`}
							/>
							{/* 上传中状态 - 旋转圆圈 */}
							{isUploading && (
								<div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
									<div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
								</div>
							)}
							{/* 上传成功状态 - 绿色勾选 */}
							{isUploaded && (
								<div className="absolute top-0 left-0 bg-green-500 text-white rounded-tl rounded-br w-4 h-4 flex items-center justify-center text-xs">
									✓
								</div>
							)}
							{/* 上传失败状态 - 红色警告 */}
							{hasError && (
								<div className="absolute top-0 left-0 bg-red-500 text-white rounded-tl rounded-br w-4 h-4 flex items-center justify-center text-xs" title={image.uploadError}>
									!
								</div>
							)}
							<button
								onClick={() => removeImage(index)}
								className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
								disabled={isUploading}
							>
								×
							</button>
							<div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 rounded-b truncate">
								{image.name}
							</div>
						</div>
					);
				})}
			</div>
		)}

		{/* Buttons row above textarea */}
		{(enableAtToMention || enableImageUpload) && (
			<div className="flex justify-start gap-2 mb-2">
				{/* @ Button for file/folder mention */}
				{enableAtToMention && (
					<button
						type="button"
						onClick={() => {
							const textarea = textAreaRef.current;
							if (textarea) {
								// Insert @ at cursor position
								const startPos = textarea.selectionStart;
								const endPos = textarea.selectionEnd;
								const textBefore = textarea.value.substring(0, startPos);
								const textAfter = textarea.value.substring(endPos);

								textarea.value = textBefore + '@' + textAfter;

								// Set cursor position after the @
								const newCursorPos = startPos + 1;
								textarea.setSelectionRange(newCursorPos, newCursorPos);

								// Focus the textarea
								textarea.focus();

								// Trigger change event
								if (onChangeText) {
									onChangeText(textarea.value);
								}
								adjustHeight();

								// Trigger the @ menu
								onOpenOptionMenu();
							}
						}}
						className="p-1 text-senweaver-fg-3 hover:text-senweaver-fg-1 transition-colors"
						title="添加文件或文件夹"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="16" />
							<line x1="8" y1="12" x2="16" y2="12" />
						</svg>
					</button>
				)}

				{/* Image Upload Button */}
				{enableImageUpload && (
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="p-1 text-senweaver-fg-3 hover:text-senweaver-fg-1 transition-colors"
						title="添加图片"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
							<circle cx="8.5" cy="8.5" r="1.5" />
							<polyline points="21,15 16,10 5,21" />
						</svg>
					</button>
				)}
			</div>
		)}

		<div className="relative">
			{/* Overlay for rendering @terminal:xxx as styled chips - must match textarea styles exactly */}
			{inputValue.includes('@terminal:') && (
				<div
					className={`absolute inset-0 w-full pointer-events-none overflow-hidden whitespace-pre-wrap break-words ${enableImageUpload ? 'pr-10' : ''} ${className}`}
					style={{
						background: 'transparent',
						color: asCssVariable(inputForeground),
						zIndex: 1,
						// Match textarea default padding
						padding: '2px',
						boxSizing: 'border-box',
						fontFamily: 'inherit',
						fontSize: 'inherit',
						lineHeight: 'inherit',
					}}
				>
					{renderTextWithTerminalChips(inputValue)}
				</div>
			)}
			<textarea
				autoFocus={false}
				ref={useCallback((r: HTMLTextAreaElement | null) => {
					if (fnsRef)
						fnsRef.current = fns

					refs.setReference(r)

					textAreaRef.current = r
					if (typeof ref === 'function') ref(r)
					else if (ref) ref.current = r
					adjustHeight()
				}, [fnsRef, fns, setEnabled, adjustHeight, ref, refs])}

				onFocus={onFocus}
				onBlur={onBlur}

				disabled={!isEnabled}

				className={`w-full resize-none max-h-[500px] overflow-y-auto placeholder:text-senweaver-fg-3 ${enableImageUpload ? 'pr-10' : ''} ${className}`}
				style={{
					// defaultInputBoxStyles
					background: asCssVariable(inputBackground),
					// Make text transparent when overlay is active, but keep caret visible
					color: inputValue.includes('@terminal:') ? 'transparent' : asCssVariable(inputForeground),
					caretColor: asCssVariable(inputForeground),
					// inputBorder: asCssVariable(inputBorder),
				}}

				onInput={useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
					const latestChange = (event.nativeEvent as InputEvent).data;

					if (latestChange === '@') {
						onOpenOptionMenu()
					}

				}, [onOpenOptionMenu, accessor])}

				onChange={useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
					const r = textAreaRef.current
					if (!r) return
					setInputValue(r.value) // sync overlay
					onChangeText?.(r.value)
					adjustHeight()
				}, [onChangeText, adjustHeight])}

				onKeyDown={useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {

					if (isMenuOpen) {
						onMenuKeyDown(e)
						return;
					}

					const textarea = e.currentTarget;
					const value = textarea.value;
					const cursorPos = textarea.selectionStart;
					const selectionEnd = textarea.selectionEnd;

					// Handle Backspace/Delete for @terminal:xxx as atomic unit
					if (e.key === 'Backspace' || e.key === 'Delete') {
						const terminalMentionRegex = /@terminal:[^\s]+/g;
						let match;
						while ((match = terminalMentionRegex.exec(value)) !== null) {
							const start = match.index;
							const end = start + match[0].length;

							// Check if cursor is inside or at the boundary of this mention
							const cursorInMention = cursorPos > start && cursorPos <= end;
							const cursorAtEnd = cursorPos === end && e.key === 'Backspace';
							const cursorAtStart = cursorPos === start && e.key === 'Delete';
							const selectionOverlaps = cursorPos <= end && selectionEnd >= start;

							if (cursorInMention || cursorAtEnd || cursorAtStart || (cursorPos !== selectionEnd && selectionOverlaps)) {
								e.preventDefault();
								// Delete the entire mention
								const newValue = value.substring(0, start) + value.substring(end);
								textarea.value = newValue;
								setInputValue(newValue);
								onChangeText?.(newValue);
								adjustHeight();
								// Set cursor position
								textarea.setSelectionRange(start, start);
								return;
							}
						}

						// Original logic: if no text or cursor at position 0, remove staging selection
						if (!value || (cursorPos === 0 && selectionEnd === 0)) {
							if (e.metaKey || e.ctrlKey) {
								chatThreadService.popStagingSelections(Number.MAX_SAFE_INTEGER)
							} else {
								chatThreadService.popStagingSelections(1)
							}
							return;
						}
					}
					if (e.key === 'Enter') {
						// Shift + Enter when multiline = newline
						const shouldAddNewline = e.shiftKey && multiline
						if (!shouldAddNewline) e.preventDefault(); // prevent newline from being created
					}
					onKeyDown?.(e)
				}, [onKeyDown, onMenuKeyDown, multiline, onChangeText, adjustHeight])}

				onPaste={handlePaste}

				rows={1}
				placeholder={placeholder}
			/>
		</div>
		{/* <div>{`idx ${optionIdx}`}</div> */}
		{isMenuOpen && (
			<div
				ref={refs.setFloating}
				className="z-[100] border-senweaver-border-3 bg-senweaver-bg-2-alt border rounded shadow-lg flex flex-col overflow-hidden"
				style={{
					position: strategy,
					top: y ?? 0,
					left: x ?? 0,
					width: refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : 0
				}}
				onWheel={(e) => e.stopPropagation()}
			>
				{/* Breadcrumbs Header */}
				{isBreadcrumbsShowing && <div className="px-2 py-1 text-senweaver-fg-1 bg-senweaver-bg-2-alt border-b border-senweaver-border-3 sticky top-0 bg-senweaver-bg-1 z-10 select-none pointer-events-none">
					{optionText ?
						<div className="flex items-center">
							{/* {optionPath.map((path, index) => (
								<React.Fragment key={index}>
									<span>{path}</span>
									<ChevronRight size={12} className="mx-1" />
								</React.Fragment>
							))} */}
							<span>{optionText}</span>
						</div>
						: <div className='opacity-50'>Enter text to filter...</div>
					}
				</div>}


				{/* Options list */}
				<div className='max-h-[400px] w-full max-w-full overflow-y-auto overflow-x-auto'>
					<div className="w-max min-w-full flex flex-col gap-0 text-nowrap flex-nowrap">
						{options.length === 0 ?
							<div className="text-senweaver-fg-3 px-3 py-0.5">No results found</div>
							: options.map((o, oIdx) => {

								return (
									// Option
									<div
										ref={oIdx === optionIdx ? selectedOptionRef : null}
										key={o.fullName}
										className={`
											flex items-center gap-2
											px-3 py-1 cursor-pointer
											${oIdx === optionIdx ? 'bg-white/10 text-senweaver-fg-1' : 'bg-senweaver-bg-2-alt text-senweaver-fg-1'}
										`}
										onClick={() => { onSelectOption(); }}
										onMouseMove={() => { setOptionIdx(oIdx) }}
									>
										{<o.iconInMenu size={12} />}

										<span>{o.abbreviatedName}</span>

										{o.fullName && o.fullName !== o.abbreviatedName && <span className="opacity-60 text-sm">{o.fullName}</span>}

										{o.nextOptions || o.generateNextOptions ? (
											<ChevronRight size={12} />
										) : null}

									</div>
								)
							})
						}
					</div>
				</div>
			</div>
		)}
	</div>

})


export const SenweaverSimpleInputBox = ({ value, onChangeValue, placeholder, className, disabled, passwordBlur, compact, ...inputProps }: {
	value: string;
	onChangeValue: (value: string) => void;
	placeholder: string;
	className?: string;
	disabled?: boolean;
	compact?: boolean;
	passwordBlur?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) => {
	// Create a ref for the input element to maintain the same DOM node between renders
	const inputRef = useRef<HTMLInputElement>(null);

	// Track if we need to restore selection
	const selectionRef = useRef<{ start: number | null, end: number | null }>({
		start: null,
		end: null
	});

	// Handle value changes without recreating the input
	useEffect(() => {
		const input = inputRef.current;
		if (input && input.value !== value) {
			// Store current selection positions
			selectionRef.current.start = input.selectionStart;
			selectionRef.current.end = input.selectionEnd;

			// Update the value
			input.value = value;

			// Restore selection if we had it before
			if (selectionRef.current.start !== null && selectionRef.current.end !== null) {
				input.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
			}
		}
	}, [value]);

	const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		onChangeValue(e.target.value);
	}, [onChangeValue]);

	return (
		<input
			ref={inputRef}
			defaultValue={value} // Use defaultValue instead of value to avoid recreation
			onChange={handleChange}
			placeholder={placeholder}
			disabled={disabled}
			className={`w-full resize-none bg-senweaver-bg-1 text-senweaver-fg-1 placeholder:text-senweaver-fg-3 border border-senweaver-border-2 focus:border-senweaver-border-1
				${compact ? 'py-1 px-2' : 'py-2 px-4 '}
				rounded
				${disabled ? 'opacity-50 cursor-not-allowed' : ''}
				${className}`}
			style={{
				...passwordBlur && { WebkitTextSecurity: 'disc' },
				background: asCssVariable(inputBackground),
				color: asCssVariable(inputForeground)
			}}
			{...inputProps}
			type={undefined} // VS Code is doing some annoyingness that breaks paste if this is defined
		/>
	);
};


export const SenweaverInputBox = ({ onChangeText, onCreateInstance, inputBoxRef, placeholder, isPasswordField, multiline }: {
	onChangeText: (value: string) => void;
	styles?: Partial<IInputBoxStyles>,
	onCreateInstance?: (instance: InputBox) => void | IDisposable[];
	inputBoxRef?: { current: InputBox | null };
	placeholder: string;
	isPasswordField?: boolean;
	multiline: boolean;
}) => {

	const accessor = useAccessor()

	const contextViewProvider = accessor.get('IContextViewService')
	return <WidgetComponent
		className='
			bg-senweaver-bg-1
			@@senweaver-force-child-placeholder-senweaver-fg-1
		'
		ctor={InputBox}
		propsFn={useCallback((container) => [
			container,
			contextViewProvider,
			{
				inputBoxStyles: {
					...defaultInputBoxStyles,
					inputForeground: "var(--vscode-foreground)",
					// inputBackground: 'transparent',
					// inputBorder: 'none',
				},
				placeholder,
				tooltip: '',
				type: isPasswordField ? 'password' : undefined,
				flexibleHeight: multiline,
				flexibleMaxHeight: 500,
				flexibleWidth: false,
			}
		] as const, [contextViewProvider, placeholder, multiline])}
		dispose={useCallback((instance: InputBox) => {
			instance.dispose()
			instance.element.remove()
		}, [])}
		onCreateInstance={useCallback((instance: InputBox) => {
			const disposables: IDisposable[] = []
			disposables.push(
				instance.onDidChange((newText) => onChangeText(newText))
			)
			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (inputBoxRef)
				inputBoxRef.current = instance;

			return disposables
		}, [onChangeText, onCreateInstance, inputBoxRef])}
	/>
};





export const SenweaverSlider = ({
	value,
	onChange,
	size = 'md',
	disabled = false,
	min = 0,
	max = 7,
	step = 1,
	className = '',
	width = 200,
}: {
	value: number;
	onChange: (value: number) => void;
	disabled?: boolean;
	size?: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
	min?: number;
	max?: number;
	step?: number;
	className?: string;
	width?: number;
}) => {
	// Calculate percentage for position
	const percentage = ((value - min) / (max - min)) * 100;

	// Handle track click
	const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (disabled) return;

		const rect = e.currentTarget.getBoundingClientRect();
		const clickPosition = e.clientX - rect.left;
		const trackWidth = rect.width;

		// Calculate new value
		const newPercentage = Math.max(0, Math.min(1, clickPosition / trackWidth));
		const rawValue = min + newPercentage * (max - min);

		// Special handling to ensure max value is always reachable
		if (rawValue >= max - step / 2) {
			onChange(max);
			return;
		}

		// Normal step calculation
		const steppedValue = Math.round((rawValue - min) / step) * step + min;
		const clampedValue = Math.max(min, Math.min(max, steppedValue));

		onChange(clampedValue);
	};

	// Helper function to handle thumb dragging that respects steps and max
	const handleThumbDrag = (moveEvent: MouseEvent, track: Element) => {
		if (!track) return;

		const rect = (track as HTMLElement).getBoundingClientRect();
		const movePosition = moveEvent.clientX - rect.left;
		const trackWidth = rect.width;

		// Calculate new value
		const newPercentage = Math.max(0, Math.min(1, movePosition / trackWidth));
		const rawValue = min + newPercentage * (max - min);

		// Special handling to ensure max value is always reachable
		if (rawValue >= max - step / 2) {
			onChange(max);
			return;
		}

		// Normal step calculation
		const steppedValue = Math.round((rawValue - min) / step) * step + min;
		const clampedValue = Math.max(min, Math.min(max, steppedValue));

		onChange(clampedValue);
	};

	return (
		<div className={`inline-flex items-center flex-shrink-0 ${className}`}>
			{/* Outer container with padding to account for thumb overhang */}
			<div className={`relative flex-shrink-0 ${disabled ? 'opacity-25' : ''}`}
				style={{
					width,
					// Add horizontal padding equal to half the thumb width
					// paddingLeft: thumbSizePx / 2,
					// paddingRight: thumbSizePx / 2
				}}>
				{/* Track container with adjusted width */}
				<div className="relative w-full">
					{/* Invisible wider clickable area that sits above the track */}
					<div
						className="absolute w-full cursor-pointer"
						style={{
							height: '16px',
							top: '50%',
							transform: 'translateY(-50%)',
							zIndex: 1
						}}
						onClick={handleTrackClick}
					/>

					{/* Track */}
					<div
						className={`relative ${size === 'xxs' ? 'h-0.5' :
							size === 'xs' ? 'h-1' :
								size === 'sm' ? 'h-1.5' :
									size === 'sm+' ? 'h-2' : 'h-2.5'
							} bg-senweaver-bg-2 rounded-full cursor-pointer`}
						onClick={handleTrackClick}
					>
						{/* Filled part of track */}
						<div
							className={`absolute left-0 ${size === 'xxs' ? 'h-0.5' :
								size === 'xs' ? 'h-1' :
									size === 'sm' ? 'h-1.5' :
										size === 'sm+' ? 'h-2' : 'h-2.5'
								} bg-senweaver-fg-1 rounded-full`}
							style={{ width: `${percentage}%` }}
						/>
					</div>

					{/* Thumb */}
					<div
						className={`absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2
							${size === 'xxs' ? 'h-2 w-2' :
								size === 'xs' ? 'h-2.5 w-2.5' :
									size === 'sm' ? 'h-3 w-3' :
										size === 'sm+' ? 'h-3.5 w-3.5' : 'h-4 w-4'
							}
							bg-senweaver-fg-1 rounded-full shadow-md ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
							border border-senweaver-fg-1`}
						style={{ left: `${percentage}%`, zIndex: 2 }}  // Ensure thumb is above the invisible clickable area
						onMouseDown={(e) => {
							if (disabled) return;

							const track = e.currentTarget.previousElementSibling;

							const handleMouseMove = (moveEvent: MouseEvent) => {
								handleThumbDrag(moveEvent, track as Element);
							};

							const handleMouseUp = () => {
								document.removeEventListener('mousemove', handleMouseMove);
								document.removeEventListener('mouseup', handleMouseUp);
								document.body.style.cursor = '';
								document.body.style.userSelect = '';
							};

							document.body.style.userSelect = 'none';
							document.body.style.cursor = 'grabbing';
							document.addEventListener('mousemove', handleMouseMove);
							document.addEventListener('mouseup', handleMouseUp);

							e.preventDefault();
						}}
					/>
				</div>
			</div>
		</div>
	);
};



export const SenweaverSwitch = ({
	value,
	onChange,
	size = 'md',
	disabled = false,
	...props
}: {
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
	size?: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
}) => {
	return (
		<label className="inline-flex items-center" {...props}>
			<div
				onClick={() => !disabled && onChange(!value)}
				className={`
			cursor-pointer
			relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out
			${value ? 'bg-zinc-900 dark:bg-white' : 'bg-white dark:bg-zinc-600'}
			${disabled ? 'opacity-25' : ''}
			${size === 'xxs' ? 'h-3 w-5' : ''}
			${size === 'xs' ? 'h-4 w-7' : ''}
			${size === 'sm' ? 'h-5 w-9' : ''}
			${size === 'sm+' ? 'h-5 w-10' : ''}
			${size === 'md' ? 'h-6 w-11' : ''}
		  `}
			>
				<span
					className={`
			  inline-block transform rounded-full bg-white dark:bg-zinc-900 shadow transition-transform duration-200 ease-in-out
			  ${size === 'xxs' ? 'h-2 w-2' : ''}
			  ${size === 'xs' ? 'h-2.5 w-2.5' : ''}
			  ${size === 'sm' ? 'h-3 w-3' : ''}
			  ${size === 'sm+' ? 'h-3.5 w-3.5' : ''}
			  ${size === 'md' ? 'h-4 w-4' : ''}
			  ${size === 'xxs' ? (value ? 'translate-x-2.5' : 'translate-x-0.5') : ''}
			  ${size === 'xs' ? (value ? 'translate-x-3.5' : 'translate-x-0.5') : ''}
			  ${size === 'sm' ? (value ? 'translate-x-5' : 'translate-x-1') : ''}
			  ${size === 'sm+' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			  ${size === 'md' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			`}
				/>
			</div>
		</label>
	);
};





export const SenweaverCheckBox = ({ label, value, onClick, className }: { label: string, value: boolean, onClick: (checked: boolean) => void, className?: string }) => {
	const divRef = useRef<HTMLDivElement | null>(null)
	const instanceRef = useRef<Checkbox | null>(null)

	useEffect(() => {
		if (!instanceRef.current) return
		instanceRef.current.checked = value
	}, [value])


	return <WidgetComponent
		className={className ?? ''}
		ctor={Checkbox}
		propsFn={useCallback((container: HTMLDivElement) => {
			divRef.current = container
			return [label, value, defaultCheckboxStyles] as const
		}, [label, value])}
		onCreateInstance={useCallback((instance: Checkbox) => {
			instanceRef.current = instance;
			divRef.current?.append(instance.domNode)
			const d = instance.onChange(() => onClick(instance.checked))
			return [d]
		}, [onClick])}
		dispose={useCallback((instance: Checkbox) => {
			instance.dispose()
			instance.domNode.remove()
		}, [])}

	/>

}



import { ModelFeatureTag } from '../../../../common/modelCapabilities.js';

// 功能标签图标组件
const FeatureTagIcon = ({ tag }: { tag: ModelFeatureTag }) => {
	switch (tag) {
		case 'code':
			return (
				<span
					className="inline-flex items-center justify-center px-1 py-0.5 text-[10px] font-medium text-blue-400"
					data-tooltip-id="senweaver-tooltip"
					data-tooltip-content="代码生成"
				>
					code
				</span>
			);
		case 'plan':
			return (
				<span
					className="inline-flex items-center justify-center px-1 py-0.5 text-[10px] font-medium text-orange-400"
					data-tooltip-id="senweaver-tooltip"
					data-tooltip-content="规划能力"
				>
					plan
				</span>
			);
		case 'new':
			return (
				<span
					className="inline-flex items-center justify-center px-1 py-0.5 text-[10px] font-medium text-green-400"
					data-tooltip-id="senweaver-tooltip"
					data-tooltip-content="最新支持"
				>
					new
				</span>
			);
		case 'your-api-key':
			return (
				<span
					className="inline-flex items-center justify-center px-1 py-0.5 text-[10px] font-medium text-gray-400"
					data-tooltip-id="senweaver-tooltip"
					data-tooltip-content="使用你自己的 API Key"
				>
					your API key
				</span>
			);
		default:
			return null;
	}
};

export const SenweaverCustomDropdownBox = <T extends NonNullable<any>>({
	options,
	selectedOption,
	onChangeOption,
	getOptionDropdownName,
	getOptionDropdownDetail,
	getOptionLabel,
	getOptionDisplayName,
	getOptionIcon,
	getOptionsEqual,
	getOptionIsDisabled,
	getOptionTooltip,
	getOptionGroup,
	getOptionFeatureTags,
	renderHeaderContent,
	displayNameClassName,
	showIconWhenCustomDisplayName = false,
	className,
	arrowTouchesText = true,
	matchInputWidth = false,
	gapPx = 0,
	offsetPx = -6,
}: {
	options: T[];
	selectedOption: T | undefined;
	onChangeOption: (newValue: T) => void;
	getOptionDropdownName: (option: T) => string;
	getOptionDropdownDetail?: (option: T) => string;
	getOptionLabel?: (option: T) => string | undefined;
	getOptionDisplayName: (option: T) => string;
	getOptionIcon?: (option: T) => React.ReactNode;
	getOptionsEqual: (a: T, b: T) => boolean;
	getOptionIsDisabled?: (option: T) => boolean;
	getOptionTooltip?: (option: T) => string | undefined;
	getOptionGroup?: (option: T) => string;
	getOptionFeatureTags?: (option: T) => ModelFeatureTag[];
	renderHeaderContent?: (closeDropdown: () => void) => React.ReactNode;
	displayNameClassName?: string;
	showIconWhenCustomDisplayName?: boolean;
	className?: string;
	arrowTouchesText?: boolean;
	matchInputWidth?: boolean;
	gapPx?: number;
	offsetPx?: number;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const measureRef = useRef<HTMLDivElement>(null);

	// Replace manual positioning with floating-ui
	const {
		x,
		y,
		strategy,
		refs,
		middlewareData,
		update
	} = useFloating({
		open: isOpen,
		onOpenChange: setIsOpen,
		placement: 'bottom-start',

		middleware: [
			offset({ mainAxis: gapPx, crossAxis: offsetPx }),
			flip({
				boundary: document.body,
				padding: 8
			}),
			shift({
				boundary: document.body,
				padding: 8,
			}),
			size({
				apply({ availableHeight, elements, rects }) {
					const maxHeight = Math.min(availableHeight)

					Object.assign(elements.floating.style, {
						maxHeight: `${maxHeight}px`,
						overflowY: 'auto',
						// Ensure the width isn't constrained by the parent
						width: `${Math.min(
							Math.max(
								rects.reference.width,
								measureRef.current?.offsetWidth ?? 0,
								260
							),
							360
						)}px`,
						minWidth: '260px'
					});
				},
				padding: 8,
				// Use viewport as boundary instead of any parent element
				boundary: document.body,
			}),
		],
		whileElementsMounted: autoUpdate,
		strategy: 'fixed',
	});

	// if the selected option is null, set the selection to the 0th option
	useEffect(() => {
		if (options.length === 0) return
		if (selectedOption !== undefined) return
		onChangeOption(options[0])
	}, [selectedOption, onChangeOption, options])

	// Handle clicks outside
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const floating = refs.floating.current;
			const reference = refs.reference.current;

			// Check if reference is an HTML element before using contains
			const isReferenceHTMLElement = reference && 'contains' in reference;

			if (
				floating &&
				(!isReferenceHTMLElement || !reference.contains(target)) &&
				!floating.contains(target)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen, refs.floating, refs.reference]);

	if (selectedOption === undefined)
		return null

	return (
		<div className={`inline-block relative ${className}`}>
			{/* Hidden measurement div */}
			<div
				ref={measureRef}
				className="opacity-0 pointer-events-none absolute -left-[999999px] -top-[999999px] flex flex-col"
				style={{ maxWidth: '300px' }}
				aria-hidden="true"
			>
				{options.map((option) => {
					const optionName = getOptionDropdownName(option);
					const optionDetail = getOptionDropdownDetail?.(option) || '';
					const optionLabel = getOptionLabel?.(option) || '';

					return (
						<div key={optionName + optionDetail} className="flex items-center px-2">
							<div className="w-4 mr-2" />
							<div className="flex flex-col flex-1 min-w-0">
								<span className="text-sm truncate">{optionName}</span>
								{optionDetail && (
									<span className="text-xs truncate">{optionDetail}</span>
								)}
							</div>
							{optionLabel && (
								<span className="text-xs opacity-50 flex-shrink-0 ml-2">{optionLabel}</span>
							)}
							<div className="w-4 ml-2" />
						</div>
					)
				})}
			</div>

			{/* Select Button */}
			<button
				type='button'
				ref={refs.setReference}
				className="flex items-center h-4 bg-transparent whitespace-nowrap hover:brightness-90 w-full"
				onClick={() => setIsOpen(!isOpen)}
				title={getOptionTooltip?.(selectedOption)}
			>
				{getOptionIcon && (!displayNameClassName || showIconWhenCustomDisplayName) && (
					<span className="flex-shrink-0 mr-1.5">
						{getOptionIcon(selectedOption)}
					</span>
				)}
				<span className={`truncate ${arrowTouchesText ? 'mr-1' : ''} ${displayNameClassName || ''}`}>
					{getOptionDisplayName(selectedOption)}
				</span>
				<svg
					className={`size-3 flex-shrink-0 ${arrowTouchesText ? '' : 'ml-auto'}`}
					viewBox="0 0 12 12"
					fill="none"
				>
					<path
						d="M2.5 4.5L6 8L9.5 4.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div
					ref={refs.setFloating}
					className="z-[100] bg-senweaver-bg-1 border-senweaver-border-3 border rounded shadow-lg"
					style={{
						position: strategy,
						top: y ?? 0,
						left: x ?? 0,
						width: (matchInputWidth
							? (refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : 0)
							: Math.min(
								Math.max(
									(refs.reference.current instanceof HTMLElement ? refs.reference.current.offsetWidth : 0),
									(measureRef.current instanceof HTMLElement ? measureRef.current.offsetWidth : 0)
								),
								300 // 最大宽度限制为 300px (增加以适应两行布局)
							))
					}}
					onWheel={(e) => e.stopPropagation()}
				>
					{/* Header content (e.g., Auto Mode switch) */}
					{renderHeaderContent && renderHeaderContent(() => setIsOpen(false))}

					<div className='overflow-auto max-h-80'>

						{!getOptionGroup ? options.map((option) => {
							const thisOptionIsSelected = getOptionsEqual(option, selectedOption);
							const optionName = getOptionDropdownName(option);
							const optionDetail = getOptionDropdownDetail?.(option) || '';
							const optionLabel = getOptionLabel?.(option) || '';
							const optionIcon = getOptionIcon?.(option);
							const isDisabled = getOptionIsDisabled?.(option) || false;
							const tooltip = getOptionTooltip?.(option);
							const featureTags = getOptionFeatureTags?.(option) || [];

							return (
								<div
									key={optionName}
									title={tooltip}
									className={`flex items-center px-2 py-1.5 pr-2 transition-all duration-100 cursor-pointer
										${isDisabled
											? 'opacity-40'
											: `${thisOptionIsSelected ? 'bg-white/10 text-senweaver-fg-1' : 'hover:bg-white/10 hover:text-senweaver-fg-1'}`}
									`}
									onClick={() => {
										if (!isDisabled) {
											onChangeOption(option);
											setIsOpen(false);
										}
									}}
								>
									{/* Icon at the start (always reserve space for alignment) */}
									<div className="w-4 flex justify-center flex-shrink-0 mr-2">
										{optionIcon}
									</div>

									{/* Layout: title and description */}
									<div className="flex flex-col flex-1 min-w-0">
										<span
											className="text-sm truncate leading-tight"
											data-tooltip-id="senweaver-tooltip"
											data-tooltip-content={optionName}
										>
											{optionName}
										</span>
										{optionDetail && (
											<span className="text-xs opacity-50 truncate leading-tight mt-0.5">{optionDetail}</span>
										)}
									</div>

									{/* Feature tags */}
									{featureTags.length > 0 && (
										<div className="flex items-center gap-1 flex-shrink-0 ml-2">
											{featureTags.map((tag) => (
												<FeatureTagIcon key={tag} tag={tag} />
											))}
										</div>
									)}

									{/* Label before checkmark */}
									{optionLabel && (
										<span className="text-xs opacity-50 flex-shrink-0 ml-2">{optionLabel}</span>
									)}

									{/* Checkmark at the end */}
									<div className="w-4 flex justify-center flex-shrink-0 ml-2">
										{thisOptionIsSelected && !isDisabled && (
											<svg className="size-3" viewBox="0 0 12 12" fill="none">
												<path
													d="M10 3L4.5 8.5L2 6"
													stroke="currentColor"
													strokeWidth="1.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											</svg>
										)}
									</div>
								</div>
							);
						}) : (() => {
							const groups = new Map<string, T[]>();
							options.forEach(option => {
								const group = getOptionGroup(option);
								if (!groups.has(group)) groups.set(group, []);
								groups.get(group)!.push(option);
							});
							// Sort groups: "最新推荐" first, then others
							const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
								if (a === '最新推荐') return -1;
								if (b === '最新推荐') return 1;
								return 0;
							});
							return sortedGroups.map(([groupName, groupOptions]) => (
								<div key={groupName}>
									<div className="px-2 py-1.5 text-xs font-medium text-senweaver-fg-3 opacity-60">{groupName}</div>
									{groupOptions.map((option) => {
										const thisOptionIsSelected = getOptionsEqual(option, selectedOption);
										const optionName = getOptionDropdownName(option);
										const optionDetail = getOptionDropdownDetail?.(option) || '';
										const optionLabel = getOptionLabel?.(option) || '';
										const optionIcon = getOptionIcon?.(option);
										const isDisabled = getOptionIsDisabled?.(option) || false;
										const tooltip = getOptionTooltip?.(option);
										const featureTags = getOptionFeatureTags?.(option) || [];
										return (
											<div key={optionName} title={tooltip}
												className={`flex items-center px-2 py-1.5 pr-2 transition-all duration-100 cursor-pointer ${isDisabled ? 'opacity-40' : `${thisOptionIsSelected ? 'bg-white/10 text-senweaver-fg-1' : 'hover:bg-white/10 hover:text-senweaver-fg-1'}`}`}
												onClick={() => { if (!isDisabled) { onChangeOption(option); setIsOpen(false); } }}>
												<div className="w-4 flex justify-center flex-shrink-0 mr-2">{optionIcon}</div>
												<div className="flex flex-col flex-1 min-w-0">
													<span
														className="text-sm truncate leading-tight"
														data-tooltip-id="senweaver-tooltip"
														data-tooltip-content={optionName}
													>
														{optionName}
													</span>
													{optionDetail && <span className="text-xs opacity-50 truncate leading-tight mt-0.5">{optionDetail}</span>}
												</div>
												{/* Feature tags */}
												{featureTags.length > 0 && (
													<div className="flex items-center gap-1 flex-shrink-0 ml-2">
														{featureTags.map((tag) => (
															<FeatureTagIcon key={tag} tag={tag} />
														))}
													</div>
												)}
												{optionLabel && <span className="text-xs opacity-50 flex-shrink-0 ml-2">{optionLabel}</span>}
												<div className="w-4 flex justify-center flex-shrink-0 ml-2">
													{thisOptionIsSelected && !isDisabled && (
														<svg className="size-3" viewBox="0 0 12 12" fill="none">
															<path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
														</svg>
													)}
												</div>
											</div>
										);
									})}
								</div>
							));
						})()}
					</div>

				</div>
			)}
		</div>
	);
};



export const _SenweaverSelectBox = <T,>({ onChangeSelection, onCreateInstance, selectBoxRef, options, className }: {
	onChangeSelection: (value: T) => void;
	onCreateInstance?: ((instance: SelectBox) => void | IDisposable[]);
	selectBoxRef?: React.MutableRefObject<SelectBox | null>;
	options: readonly { text: string, value: T }[];
	className?: string;
}) => {
	const accessor = useAccessor()
	const contextViewProvider = accessor.get('IContextViewService')

	let containerRef = useRef<HTMLDivElement | null>(null);

	return <WidgetComponent
		className={`
			@@select-child-restyle
			@@[&_select]:!senweaver-text-senweaver-fg-3
			@@[&_select]:!senweaver-text-xs
			!text-senweaver-fg-3
			${className ?? ''}
		`}
		ctor={SelectBox}
		propsFn={useCallback((container) => {
			containerRef.current = container
			const defaultIndex = 0;
			return [
				options.map(opt => ({ text: opt.text })),
				defaultIndex,
				contextViewProvider,
				defaultSelectBoxStyles,
			] as const;
		}, [containerRef, options])}

		dispose={useCallback((instance: SelectBox) => {
			instance.dispose();
			containerRef.current?.childNodes.forEach(child => {
				containerRef.current?.removeChild(child)
			})
		}, [containerRef])}

		onCreateInstance={useCallback((instance: SelectBox) => {
			const disposables: IDisposable[] = []

			if (containerRef.current)
				instance.render(containerRef.current)

			disposables.push(
				instance.onDidSelect(e => { onChangeSelection(options[e.index].value); })
			)

			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (selectBoxRef)
				selectBoxRef.current = instance;

			return disposables;
		}, [containerRef, onChangeSelection, options, onCreateInstance, selectBoxRef])}

	/>;
};

// makes it so that code in the sidebar isnt too tabbed out
const normalizeIndentation = (code: string): string => {
	const lines = code.split('\n')

	let minLeadingSpaces = Infinity

	// find the minimum number of leading spaces
	for (const line of lines) {
		if (line.trim() === '') continue;
		let leadingSpaces = 0;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				leadingSpaces += 1;
			} else { break; }
		}
		minLeadingSpaces = Math.min(minLeadingSpaces, leadingSpaces)
	}

	// remove the leading spaces
	return lines.map(line => {
		if (line.trim() === '') return line;

		let spacesToRemove = minLeadingSpaces;
		let i = 0;
		while (spacesToRemove > 0 && i < line.length) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				spacesToRemove -= 1;
				i++;
			} else { break; }
		}

		return line.slice(i);

	}).join('\n')

}


const modelOfEditorId: { [id: string]: ITextModel | undefined } = {}
export type BlockCodeProps = { initValue: string, language?: string, maxHeight?: number, showScrollbars?: boolean }
export const BlockCode = ({ initValue, language, maxHeight, showScrollbars }: BlockCodeProps) => {

	initValue = normalizeIndentation(initValue)

	// default settings
	const MAX_HEIGHT = maxHeight ?? Infinity;
	const SHOW_SCROLLBARS = showScrollbars ?? false;

	const divRef = useRef<HTMLDivElement | null>(null)

	const accessor = useAccessor()
	const instantiationService = accessor.get('IInstantiationService')
	// const languageDetectionService = accessor.get('ILanguageDetectionService')
	const modelService = accessor.get('IModelService')

	const id = useId()

	// these are used to pass to the model creation of modelRef
	const initValueRef = useRef(initValue)
	const languageRef = useRef(language)

	const modelRef = useRef<ITextModel | null>(null)

	// if we change the initial value, don't re-render the whole thing, just set it here. same for language
	useEffect(() => {
		initValueRef.current = initValue
		modelRef.current?.setValue(initValue)
	}, [initValue])
	useEffect(() => {
		languageRef.current = language
		if (language) modelRef.current?.setLanguage(language)
	}, [language])

	return <div ref={divRef} className='relative z-0 px-2 py-1 bg-senweaver-bg-3'>
		<WidgetComponent
			className='@@bg-editor-style-override' // text-sm
			ctor={useCallback((container) => {
				return instantiationService.createInstance(
					CodeEditorWidget,
					container,
					{
						automaticLayout: true,
						wordWrap: 'off',

						scrollbar: {
							alwaysConsumeMouseWheel: false,
							...SHOW_SCROLLBARS ? {
								vertical: 'auto',
								verticalScrollbarSize: 8,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
							} : {
								vertical: 'hidden',
								verticalScrollbarSize: 0,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
								ignoreHorizontalScrollbarInContentHeight: true,

							},
						},
						scrollBeyondLastLine: false,

						lineNumbers: 'off',

						readOnly: true,
						domReadOnly: true,
						readOnlyMessage: { value: '' },

						minimap: {
							enabled: false,
							// maxColumn: 0,
						},

						hover: { enabled: false },

						selectionHighlight: false, // highlights whole words
						renderLineHighlight: 'none',

						folding: false,
						lineDecorationsWidth: 0,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						overviewRulerBorder: false,
						glyphMargin: false,

						stickyScroll: {
							enabled: false,
						},
					},
					{
						isSimpleWidget: true,
					})
			}, [instantiationService])}

			onCreateInstance={useCallback((editor: CodeEditorWidget) => {
				const languageId = languageRef.current ? languageRef.current : 'plaintext'

				const model = modelOfEditorId[id] ?? modelService.createModel(
					initValueRef.current, {
					languageId: languageId,
					onDidChange: (e) => { return { dispose: () => { } } } // no idea why they'd require this
				})
				modelRef.current = model
				editor.setModel(model);

				const container = editor.getDomNode()
				const parentNode = container?.parentElement
				const resize = () => {
					const height = editor.getScrollHeight() + 1
					if (parentNode) {
						// const height = Math.min(, MAX_HEIGHT);
						parentNode.style.height = `${height}px`;
						parentNode.style.maxHeight = `${MAX_HEIGHT}px`;
						editor.layout();
					}
				}

				resize()
				const disposable = editor.onDidContentSizeChange(() => { resize() });

				return [disposable, model]
			}, [modelService])}

			dispose={useCallback((editor: CodeEditorWidget) => {
				editor.dispose();
			}, [modelService])}

			propsFn={useCallback(() => { return [] }, [])}
		/>
	</div>

}


export const SenweaverButtonBgDarken = ({ children, disabled, onClick, className }: { children: React.ReactNode; disabled?: boolean; onClick: () => void; className?: string }) => {
	return <button disabled={disabled}
		className={`px-3 py-1 bg-black/10 dark:bg-white/10 rounded-sm overflow-hidden whitespace-nowrap flex items-center justify-center ${className || ''}`}
		onClick={onClick}
	>{children}</button>
}

// export const SenweaverScrollableElt = ({ options, children }: { options: ScrollableElementCreationOptions, children: React.ReactNode }) => {
// 	const instanceRef = useRef<DomScrollableElement | null>(null);
// 	const [childrenPortal, setChildrenPortal] = useState<React.ReactNode | null>(null)

// 	return <>
// 		<WidgetComponent
// 			ctor={DomScrollableElement}
// 			propsFn={useCallback((container) => {
// 				return [container, options] as const;
// 			}, [options])}
// 			onCreateInstance={useCallback((instance: DomScrollableElement) => {
// 				instanceRef.current = instance;
// 				setChildrenPortal(createPortal(children, instance.getDomNode()))
// 				return []
// 			}, [setChildrenPortal, children])}
// 			dispose={useCallback((instance: DomScrollableElement) => {
//
// 				// instance.dispose();
// 				// instance.getDomNode().remove()
// 			}, [])}
// 		>{children}</WidgetComponent>

// 		{childrenPortal}

// 	</>
// }

// export const SenweaverSelectBox = <T,>({ onChangeSelection, initVal, selectBoxRef, options }: {
// 	initVal: T;
// 	selectBoxRef: React.MutableRefObject<SelectBox | null>;
// 	options: readonly { text: string, value: T }[];
// 	onChangeSelection: (value: T) => void;
// }) => {


// 	return <WidgetComponent
// 		ctor={DropdownMenu}
// 		propsFn={useCallback((container) => {
// 			return [
// 				container, {
// 					contextMenuProvider,
// 					actions: options.map(({ text, value }, i) => ({
// 						id: i + '',
// 						label: text,
// 						tooltip: text,
// 						class: undefined,
// 						enabled: true,
// 						run: () => {
// 							onChangeSelection(value);
// 						},
// 					}))

// 				}] as const;
// 		}, [options, initVal, contextViewProvider])}

// 		dispose={useCallback((instance: DropdownMenu) => {
// 			instance.dispose();
// 			// instance.element.remove()
// 		}, [])}

// 		onCreateInstance={useCallback((instance: DropdownMenu) => {
// 			return []
// 		}, [])}

// 	/>;
// };




// export const SenweaverCheckBox = ({ onChangeChecked, initVal, label, checkboxRef, }: {
// 	onChangeChecked: (checked: boolean) => void;
// 	initVal: boolean;
// 	checkboxRef: React.MutableRefObject<ObjectSettingCheckboxWidget | null>;
// 	label: string;
// }) => {
// 	const containerRef = useRef<HTMLDivElement>(null);


// 	useEffect(() => {
// 		if (!containerRef.current) return;

// 		// Create and mount the Checkbox using VSCode's implementation

// 		checkboxRef.current = new ObjectSettingCheckboxWidget(
// 			containerRef.current,
// 			themeService,
// 			contextViewService,
// 			hoverService,
// 		);


// 		checkboxRef.current.setValue([{
// 			key: { type: 'string', data: label },
// 			value: { type: 'boolean', data: initVal },
// 			removable: false,
// 			resetable: true,
// 		}])

// 		checkboxRef.current.onDidChangeList((list) => {
// 			onChangeChecked(!!list);
// 		})


// 		// cleanup
// 		return () => {
// 			if (checkboxRef.current) {
// 				checkboxRef.current.dispose();
// 				if (containerRef.current) {
// 					while (containerRef.current.firstChild) {
// 						containerRef.current.removeChild(containerRef.current.firstChild);
// 					}
// 				}
// 				checkboxRef.current = null;
// 			}
// 		};
// 	}, [checkboxRef, label, initVal, onChangeChecked]);

// 	return <div ref={containerRef} className="w-full" />;
// };




const SingleDiffEditor = ({ block, lang }: { block: ExtractedSearchReplaceBlock, lang: string | undefined }) => {
	const accessor = useAccessor();
	const modelService = accessor.get('IModelService');
	const instantiationService = accessor.get('IInstantiationService');
	const languageService = accessor.get('ILanguageService');

	const languageSelection = useMemo(() => languageService.createById(lang), [lang, languageService]);

	// Create models for original and modified
	const originalModel = useMemo(() =>
		modelService.createModel(block.orig, languageSelection),
		[block.orig, languageSelection, modelService]
	);
	const modifiedModel = useMemo(() =>
		modelService.createModel(block.final, languageSelection),
		[block.final, languageSelection, modelService]
	);

	// Clean up models on unmount
	useEffect(() => {
		return () => {
			originalModel.dispose();
			modifiedModel.dispose();
		};
	}, [originalModel, modifiedModel]);

	// Imperatively mount the DiffEditorWidget
	const divRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<any>(null);

	useEffect(() => {
		if (!divRef.current) return;
		// Create the diff editor instance
		const editor = instantiationService.createInstance(
			DiffEditorWidget,
			divRef.current,
			{
				automaticLayout: true,
				readOnly: true,
				renderSideBySide: true,
				minimap: { enabled: false },
				lineNumbers: 'off',
				scrollbar: {
					vertical: 'hidden',
					horizontal: 'auto',
					verticalScrollbarSize: 0,
					horizontalScrollbarSize: 8,
					alwaysConsumeMouseWheel: false,
					ignoreHorizontalScrollbarInContentHeight: true,
				},
				hover: { enabled: false },
				folding: false,
				selectionHighlight: false,
				renderLineHighlight: 'none',
				overviewRulerLanes: 0,
				hideCursorInOverviewRuler: true,
				overviewRulerBorder: false,
				glyphMargin: false,
				stickyScroll: { enabled: false },
				scrollBeyondLastLine: false,
				renderGutterMenu: false,
				renderIndicators: false,
			},
			{ originalEditor: { isSimpleWidget: true }, modifiedEditor: { isSimpleWidget: true } }
		);
		editor.setModel({ original: originalModel, modified: modifiedModel });

		// Calculate the height based on content
		const updateHeight = () => {
			const contentHeight = Math.max(
				originalModel.getLineCount() * 19, // approximate line height
				modifiedModel.getLineCount() * 19
			) + 19 * 2 + 1; // add padding

			// Set reasonable min/max heights
			const height = Math.min(Math.max(contentHeight, 100), 300);
			if (divRef.current) {
				divRef.current.style.height = `${height}px`;
				editor.layout();
			}
		};

		updateHeight();
		editorRef.current = editor;

		// Update height when content changes
		const disposable1 = originalModel.onDidChangeContent(() => updateHeight());
		const disposable2 = modifiedModel.onDidChangeContent(() => updateHeight());

		return () => {
			disposable1.dispose();
			disposable2.dispose();
			editor.dispose();
			editorRef.current = null;
		};
	}, [originalModel, modifiedModel, instantiationService]);

	return (
		<div className="w-full bg-senweaver-bg-3 @@bg-editor-style-override" ref={divRef} />
	);
};





/**
 * ToolDiffEditor mounts a native VSCode DiffEditorWidget to show a diff between original and modified code blocks.
 * Props:
 *   - uri: URI of the file (for language detection, etc)
 *   - searchReplaceBlocks: string in search/replace format (from LLM)
 *   - language?: string (optional, fallback to 'plaintext')
 */
export const SenweaverDiffEditor = ({ uri, searchReplaceBlocks, language }: { uri?: any, searchReplaceBlocks: string, language?: string }) => {
	const accessor = useAccessor();
	const languageService = accessor.get('ILanguageService');

	// Extract all blocks
	const blocks = extractSearchReplaceBlocks(searchReplaceBlocks);

	// Use detectLanguage for language detection if not provided
	let lang = language;
	if (!lang && blocks.length > 0) {
		lang = detectLanguage(languageService, { uri: uri ?? null, fileContents: blocks[0].orig });
	}

	// If no blocks, show empty state
	if (blocks.length === 0) {
		return <div className="w-full p-4 text-senweaver-fg-4 text-sm">No changes found</div>;
	}

	// Display all blocks
	return (
		<div className="w-full flex flex-col gap-2">
			{blocks.map((block, index) => (
				<div key={index} className="w-full">
					{blocks.length > 1 && (
						<div className="text-senweaver-fg-4 text-xs mb-1 px-1">
							Change {index + 1} of {blocks.length}
						</div>
					)}
					<SingleDiffEditor block={block} lang={lang} />
				</div>
			))}
		</div>
	);
};


