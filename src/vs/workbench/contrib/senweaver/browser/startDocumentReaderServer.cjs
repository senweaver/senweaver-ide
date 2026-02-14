/**
 * Start Document Reader Server
 * This script starts the backend server for reading document files (Word, PDF, Excel, PowerPoint)
 *
 * Features:
 * - Read .docx files (Word documents)
 * - Read .pdf files (PDF documents)
 * - Read .xlsx/.xls files (Excel spreadsheets)
 * - Read .pptx files (PowerPoint presentations)
 * - Extract text content and convert to Markdown
 * - Support pagination for large documents
 *
 * Usage: node startDocumentReaderServer.js [port]
 * Default port: 3008
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const DEFAULT_PORT = 3008;
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024; // 50MB max file size

// Cache for serving PDF files via HTTP
const pdfCache = new Map();

// Try to load optional dependencies
let mammoth, pdfParse, xlsx, pptxParser, libreConvert;

try {
	mammoth = require('mammoth');
} catch (e) {
	console.warn('[DocumentReader] ⚠️ mammoth not installed - Word (.docx) support unavailable');
	console.warn('   Install with: npm install mammoth');
}

// Try to load libreoffice-convert for native document to PDF conversion
try {
	libreConvert = require('libreoffice-convert');
} catch (e) {
	console.warn('[DocumentReader] ⚠️ libreoffice-convert not installed - Using HTML fallback for Word/Excel');
	console.warn('   For native rendering, install: npm install libreoffice-convert');
	console.warn('   Note: Requires LibreOffice to be installed on the system');
}

// Try pdfjs-dist first (more reliable), then fall back to pdf-parse
let pdfjsLib = null;
try {
	// Use legacy build with .mjs extension for Node.js compatibility
	pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
} catch (e) {
	console.warn('[DocumentReader] ⚠️ pdfjs-dist not available:', e.message);
}

// Always try to load pdf-parse (needed for PDF to Word conversion regardless of pdfjs-dist)
try {
	const pdfParseModule = require('pdf-parse');
	// pdf-parse exports a function directly
	if (typeof pdfParseModule === 'function') {
		pdfParse = pdfParseModule;
	} else if (pdfParseModule && typeof pdfParseModule.default === 'function') {
		pdfParse = pdfParseModule.default;
	} else if (pdfParseModule && typeof pdfParseModule.parse === 'function') {
		pdfParse = pdfParseModule.parse;
	} else if (pdfParseModule && pdfParseModule.PDFParse) {
		// Some versions export PDFParse class
		const PDFParseClass = pdfParseModule.PDFParse;
		pdfParse = async (buffer) => {
			const parser = new PDFParseClass(buffer);
			return await parser.parse();
		};
	} else {
		// Last resort: try to use the module as-is if it has expected structure
		pdfParse = null;
	}
} catch (e2) {
	console.warn('[DocumentReader] ⚠️ pdf-parse not installed - PDF to Word conversion unavailable');
	console.warn('   Install with: npm install pdf-parse');
	console.warn('   Error:', e2.message);
}

try {
	xlsx = require('xlsx');
} catch (e) {
	console.warn('[DocumentReader] ⚠️ xlsx not installed - Excel support unavailable');
	console.warn('   Install with: npm install xlsx');
}

// Note: pptx-parser is optional and may not be available
try {
	// Try different pptx parsing libraries
	pptxParser = require('pptx-parser');
} catch (e) {
	try {
		// Alternative: officegen for reading
		pptxParser = null;
	} catch (e2) {
		console.warn('[DocumentReader] ⚠️ pptx parser not installed - PowerPoint support limited');
	}
}

/**
 * Detect file type from extension
 */
function getFileType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.docx':
		case '.doc':
			return 'word';
		case '.pdf':
			return 'pdf';
		case '.xlsx':
		case '.xls':
			return 'excel';
		case '.pptx':
		case '.ppt':
			return 'powerpoint';
		case '.txt':
		case '.md':
		case '.markdown':
			return 'text';
		case '.rtf':
			return 'rtf';
		default:
			return 'unknown';
	}
}

/**
 * Convert document to PDF using LibreOffice
 */
async function convertToPdf(inputBuffer, inputExt) {
	if (!libreConvert) {
		return null;
	}

	return new Promise((resolve, reject) => {
		libreConvert.convert(inputBuffer, '.pdf', undefined, (err, result) => {
			if (err) {
				console.warn('[DocumentReader] ⚠️ LibreOffice conversion failed:', err.message);
				resolve(null);
			} else {
				resolve(result);
			}
		});
	});
}

/**
 * Read Word document (.docx)
 */
async function readWordDocument(filePath) {
	const buffer = fs.readFileSync(filePath);

	// Try LibreOffice conversion first for 100% native rendering
	if (libreConvert) {
		try {
			const pdfBuffer = await convertToPdf(buffer, '.docx');
			if (pdfBuffer) {

				// Extract text content using mammoth for AI interaction
				let content = '';
				if (mammoth) {
					try {
						const mdResult = await mammoth.convertToMarkdown({ buffer });
						content = mdResult.value;
					} catch (e) {
						content = '[Text extraction failed]';
					}
				}

				return {
					content,
					fileType: 'word',
					pages: 1,
					pdfData: pdfBuffer.toString('base64'),  // Use PDF for native rendering
					metadata: {
						format: 'docx',
						extractedAs: 'pdf',
						renderMode: 'native'
					}
				};
			}
		} catch (e) {
			console.warn('[DocumentReader] ⚠️ LibreOffice conversion error:', e.message);
		}
	}

	// Use docx-preview for native rendering in browser
	// Return the original docx file as base64 for front-end rendering
	try {
		// Extract text content using mammoth for AI interaction
		let content = '';
		if (mammoth) {
			// Try multiple extraction methods
			try {
				const mdResult = await mammoth.convertToMarkdown({ buffer });
				content = mdResult.value;
			} catch (e) {
				console.log(`[DocumentReader] ⚠️ Mammoth markdown failed: ${e.message}`);
			}

			// If markdown extraction failed or returned empty, try raw text
			if (!content || content.length === 0) {
				try {
					const rawResult = await mammoth.extractRawText({ buffer });
					content = rawResult.value;
				} catch (e2) {
					console.log(`[DocumentReader] ⚠️ Mammoth raw text failed: ${e2.message}`);
				}
			}

			// If both failed, try extracting from docx XML directly
			if (!content || content.length === 0) {
				try {
					const JSZip = require('jszip');
					const zip = await JSZip.loadAsync(buffer);
					const documentXml = await zip.file('word/document.xml')?.async('string');
					if (documentXml) {
						// Extract text from XML tags
						const textMatches = documentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
						content = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
					}
				} catch (e3) {
					console.log(`[DocumentReader] ⚠️ Direct XML extraction failed: ${e3.message}`);
				}
			}
		}

		return {
			content,
			fileType: 'word',
			pages: 1,
			docxData: buffer.toString('base64'),  // Return original docx for docx-preview rendering
			metadata: {
				format: 'docx',
				extractedAs: 'docx-preview',
				renderMode: 'native'
			}
		};
	} catch (error) {
		// Try alternative approach - extract raw text
		try {
			const result = await mammoth.extractRawText({ buffer });
			return {
				content: result.value,
				fileType: 'word',
				pages: 1,
				metadata: {
					format: 'docx',
					extractedAs: 'plaintext'
				}
			};
		} catch (e2) {
			throw new Error(`Failed to read Word document: ${error.message}`);
		}
	}
}

/**
 * Read PDF document using pdfjs-dist or pdf-parse
 */
async function readPdfDocument(filePath, options = {}) {
	const buffer = fs.readFileSync(filePath);

	// Always include base64 data for native rendering
	const base64Data = buffer.toString('base64');

	// Cache PDF for HTTP serving (generate unique ID)
	const pdfId = Date.now().toString(36) + Math.random().toString(36).substr(2);
	pdfCache.set(pdfId, buffer);
	// Clean up old cache entries (keep last 10)
	if (pdfCache.size > 10) {
		const firstKey = pdfCache.keys().next().value;
		pdfCache.delete(firstKey);
	}

	// Try pdfjs-dist first
	if (pdfjsLib) {
		try {
			const uint8Array = new Uint8Array(buffer);
			const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
			const pdf = await loadingTask.promise;

			let content = '';
			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const textContent = await page.getTextContent();
				const pageText = textContent.items.map(item => item.str).join(' ');
				content += pageText + '\n\n';
			}

			// Clean up excessive whitespace
			content = content
				.replace(/\r\n/g, '\n')
				.replace(/\n{4,}/g, '\n\n\n')
				.trim();

			return {
				content,
				fileType: 'pdf',
				pages: pdf.numPages,
				pdfData: base64Data,  // Include base64 for native rendering
				pdfId: pdfId,  // Include PDF ID for HTTP serving
				metadata: {
					format: 'pdf',
					extractedAs: 'plaintext',
					parser: 'pdfjs-dist'
				}
			};
		} catch (err) {
			console.error(`[DocumentReader] ❌ pdfjs-dist error:`, err.message);
			// Fall through to pdf-parse
		}
	}

	// Try pdf-parse as fallback
	if (!pdfParse) {
		throw new Error('No PDF parser available. Install with: npm install pdfjs-dist');
	}

	try {
		let data;
		try {
			data = await pdfParse(buffer);
		} catch (parseErr) {
			console.error(`[DocumentReader] ❌ PDF parse error:`, parseErr.message);
			throw parseErr;
		}


		// Format the content with page information
		let content = data.text;

		// Clean up excessive whitespace while preserving structure
		content = content
			.replace(/\r\n/g, '\n')
			.replace(/\n{4,}/g, '\n\n\n')
			.trim();

		return {
			content,
			fileType: 'pdf',
			pages: data.numpages,
			pdfData: base64Data,  // Include base64 for native rendering
			pdfId: pdfId,  // Include PDF ID for HTTP serving
			metadata: {
				format: 'pdf',
				info: data.info,
				version: data.version,
				extractedAs: 'plaintext'
			}
		};
	} catch (error) {
		throw new Error(`Failed to read PDF document: ${error.message}`);
	}
}

/**
 * Read Excel spreadsheet (.xlsx, .xls)
 */
async function readExcelDocument(filePath) {
	if (!xlsx) {
		throw new Error('xlsx library not installed. Install with: npm install xlsx');
	}

	const buffer = fs.readFileSync(filePath);
	const ext = path.extname(filePath).toLowerCase();

	// Try LibreOffice conversion first for 100% native rendering
	if (libreConvert) {
		try {
			const pdfBuffer = await convertToPdf(buffer, ext);
			if (pdfBuffer) {

				// Extract text content for AI interaction
				const workbook = xlsx.readFile(filePath);
				let content = '';
				for (const sheetName of workbook.SheetNames) {
					const sheet = workbook.Sheets[sheetName];
					content += `## Sheet: ${sheetName}\n\n`;
					const csv = xlsx.utils.sheet_to_csv(sheet);
					content += csv + '\n\n';
				}

				return {
					content,
					fileType: 'excel',
					pages: workbook.SheetNames.length,
					pdfData: pdfBuffer.toString('base64'),  // Use PDF for native rendering
					metadata: {
						format: ext.replace('.', ''),
						sheets: workbook.SheetNames,
						extractedAs: 'pdf',
						renderMode: 'native'
					}
				};
			}
		} catch (e) {
			console.warn('[DocumentReader] ⚠️ LibreOffice conversion error:', e.message);
		}
	}

	// Return original xlsx data for front-end rendering with SheetJS
	try {
		const workbook = xlsx.readFile(filePath);
		let content = '';

		// Extract text content for AI interaction
		for (const sheetName of workbook.SheetNames) {
			content += `## Sheet: ${sheetName}\n\n`;
			const sheet = workbook.Sheets[sheetName];
			const csv = xlsx.utils.sheet_to_csv(sheet);
			if (csv.trim()) {
				const lines = csv.split('\n').filter(l => l.trim());
				if (lines.length > 0) {
					const headers = lines[0].split(',');
					content += '| ' + headers.join(' | ') + ' |\n';
					content += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
					for (let i = 1; i < Math.min(lines.length, 100); i++) {
						const cells = lines[i].split(',');
						content += '| ' + cells.join(' | ') + ' |\n';
					}
					content += '\n';
				}
			}
		}

		return {
			content,
			fileType: 'excel',
			pages: workbook.SheetNames.length,
			xlsxData: buffer.toString('base64'),  // Return original xlsx for front-end rendering
			metadata: {
				format: path.extname(filePath).toLowerCase().replace('.', ''),
				sheets: workbook.SheetNames,
				extractedAs: 'xlsx-preview',
				renderMode: 'native'
			}
		};
	} catch (error) {
		throw new Error(`Failed to read Excel document: ${error.message}`);
	}
}

// Legacy HTML table rendering (kept for reference)
async function readExcelDocumentLegacy(filePath) {
	const buffer = fs.readFileSync(filePath);
	try {
		const workbook = xlsx.readFile(filePath);
		let content = '';
		let htmlContent = '';

		// Build HTML with tabs for each sheet
		htmlContent = `
			<div style="font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; background: white; height: 100%;">
				<style>
					.excel-tabs { display: flex; background: #f0f0f0; border-bottom: 1px solid #ccc; padding: 0 8px; }
					.excel-tab { padding: 8px 16px; cursor: pointer; border: none; background: transparent; font-size: 13px; }
					.excel-tab:hover { background: #e0e0e0; }
					.excel-tab.active { background: white; border: 1px solid #ccc; border-bottom: none; margin-bottom: -1px; }
					.excel-sheet { display: none; padding: 0; overflow: auto; height: calc(100% - 40px); }
					.excel-sheet.active { display: block; }
					.excel-table { border-collapse: collapse; width: 100%; font-size: 13px; }
					.excel-table th { background: #f5f5f5; font-weight: bold; text-align: center; padding: 6px 10px; border: 1px solid #ddd; min-width: 80px; }
					.excel-table td { padding: 6px 10px; border: 1px solid #ddd; white-space: nowrap; }
					.excel-table tr:nth-child(even) { background: #fafafa; }
					.excel-table tr:hover { background: #e8f4fc; }
					.row-num { background: #f5f5f5; color: #666; text-align: center; font-weight: normal; width: 40px; }
				</style>
				<div class="excel-tabs">
		`;

		// Create tabs
		workbook.SheetNames.forEach((sheetName, index) => {
			const activeClass = index === 0 ? 'active' : '';
			htmlContent += `<button class="excel-tab ${activeClass}" onclick="document.querySelectorAll('.excel-sheet').forEach(s=>s.classList.remove('active'));document.querySelectorAll('.excel-tab').forEach(t=>t.classList.remove('active'));document.getElementById('sheet-${index}').classList.add('active');this.classList.add('active');">${sheetName}</button>`;
		});
		htmlContent += '</div>';

		// Process each sheet
		for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex++) {
			const sheetName = workbook.SheetNames[sheetIndex];
			const sheet = workbook.Sheets[sheetName];
			const activeClass = sheetIndex === 0 ? 'active' : '';

			// Add sheet header for text content
			content += `## Sheet: ${sheetName}\n\n`;

			// Convert to JSON for HTML table
			const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

			htmlContent += `<div id="sheet-${sheetIndex}" class="excel-sheet ${activeClass}"><table class="excel-table">`;

			if (jsonData.length > 0) {
				// Header row with column letters
				htmlContent += '<thead><tr><th class="row-num"></th>';
				const maxCols = Math.max(...jsonData.map(row => (row || []).length), 1);
				for (let col = 0; col < maxCols; col++) {
					const colLetter = String.fromCharCode(65 + (col % 26));
					htmlContent += `<th>${colLetter}</th>`;
				}
				htmlContent += '</tr></thead><tbody>';

				// Data rows
				jsonData.forEach((row, rowIndex) => {
					htmlContent += `<tr><td class="row-num">${rowIndex + 1}</td>`;
					for (let col = 0; col < maxCols; col++) {
						const cellValue = row && row[col] !== undefined ? row[col] : '';
						htmlContent += `<td>${String(cellValue).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
					}
					htmlContent += '</tr>';
				});
				htmlContent += '</tbody>';

				// Also build markdown content
				const csv = xlsx.utils.sheet_to_csv(sheet);
				if (csv.trim()) {
					const lines = csv.split('\n').filter(l => l.trim());
					if (lines.length > 0) {
						const headers = lines[0].split(',');
						content += '| ' + headers.join(' | ') + ' |\n';
						content += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
						for (let i = 1; i < lines.length; i++) {
							const cells = lines[i].split(',');
							content += '| ' + cells.join(' | ') + ' |\n';
						}
						content += '\n';
					}
				}
			} else {
				htmlContent += '<tr><td>(Empty sheet)</td></tr>';
				content += '(Empty sheet)\n\n';
			}

			htmlContent += '</table></div>';
		}

		htmlContent += '</div>';

		return {
			content,
			fileType: 'excel',
			pages: workbook.SheetNames.length,
			htmlData: htmlContent,  // Include HTML for native rendering
			metadata: {
				format: path.extname(filePath).toLowerCase().replace('.', ''),
				sheets: workbook.SheetNames,
				extractedAs: 'html'
			}
		};
	} catch (error) {
		throw new Error(`Failed to read Excel document: ${error.message}`);
	}
}

/**
 * Read PowerPoint presentation (.pptx)
 */
async function readPowerPointDocument(filePath) {
	const buffer = fs.readFileSync(filePath);
	const ext = path.extname(filePath).toLowerCase();

	// Try LibreOffice conversion first for 100% native rendering
	if (libreConvert) {
		try {
			const pdfBuffer = await convertToPdf(buffer, ext);
			if (pdfBuffer) {

				// Extract text content for AI interaction
				let content = '';
				let slideCount = 0;

				if (pptxParser) {
					try {
						const result = await new Promise((resolve, reject) => {
							pptxParser(filePath, (err, data) => {
								if (err) reject(err);
								else resolve(data);
							});
						});
						if (result && result.slides) {
							slideCount = result.slides.length;
							result.slides.forEach((slide, index) => {
								content += `## Slide ${index + 1}\n\n`;
								if (slide.text) {
									content += slide.text + '\n\n';
								}
							});
						}
					} catch (e) {
						content = '[Text extraction failed]';
					}
				}

				return {
					content,
					fileType: 'powerpoint',
					pages: slideCount,
					pdfData: pdfBuffer.toString('base64'),  // Use PDF for native rendering
					metadata: {
						format: ext.replace('.', ''),
						extractedAs: 'pdf',
						renderMode: 'native'
					}
				};
			}
		} catch (e) {
			console.warn('[DocumentReader] ⚠️ LibreOffice conversion error:', e.message);
		}
	}

	// Return original pptx data for front-end rendering
	let content = '';
	let slideCount = 0;

	// Try to extract text content for AI interaction
	if (pptxParser) {
		try {
			const result = await new Promise((resolve, reject) => {
				pptxParser(filePath, (err, data) => {
					if (err) reject(err);
					else resolve(data);
				});
			});

			if (result && result.slides) {
				slideCount = result.slides.length;
				result.slides.forEach((slide, index) => {
					content += `## Slide ${index + 1}\n\n`;
					if (slide.text) {
						content += slide.text + '\n\n';
					}
				});
			}
		} catch (e) {
			content = '[Text extraction limited]';
		}
	}

	return {
		content,
		fileType: 'powerpoint',
		pages: slideCount,
		pptxData: buffer.toString('base64'),  // Return original pptx for front-end rendering
		metadata: {
			format: 'pptx',
			extractedAs: 'pptx-preview',
			renderMode: 'native'
		}
	};
}

/**
 * Read plain text file
 */
async function readTextDocument(filePath) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return {
			content,
			fileType: 'text',
			pages: 1,
			metadata: {
				format: path.extname(filePath).toLowerCase().replace('.', '') || 'txt',
				extractedAs: 'plaintext'
			}
		};
	} catch (error) {
		throw new Error(`Failed to read text file: ${error.message}`);
	}
}

/**
 * Main document reading function
 */
async function readDocument(filePath, options = {}) {
	const { startIndex = 0, maxLength = 50000 } = options;

	// Check if file exists
	if (!fs.existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`);
	}

	// Check file size
	const stats = fs.statSync(filePath);
	if (stats.size > MAX_CONTENT_LENGTH) {
		throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_CONTENT_LENGTH} bytes)`);
	}

	const fileType = getFileType(filePath);
	let result;

	switch (fileType) {
		case 'word':
			result = await readWordDocument(filePath);
			break;
		case 'pdf':
			result = await readPdfDocument(filePath);
			break;
		case 'excel':
			result = await readExcelDocument(filePath);
			break;
		case 'powerpoint':
			result = await readPowerPointDocument(filePath);
			break;
		case 'text':
			result = await readTextDocument(filePath);
			break;
		default:
			throw new Error(`Unsupported file type: ${path.extname(filePath)}. Supported: .docx, .pdf, .xlsx, .xls, .pptx, .txt, .md`);
	}

	// Apply pagination
	const fullContent = result.content;
	const contentLength = fullContent.length;
	const paginatedContent = fullContent.slice(startIndex, startIndex + maxLength);
	const hasMore = (startIndex + maxLength) < contentLength;
	const nextIndex = hasMore ? startIndex + maxLength : contentLength;

	return {
		...result,
		content: paginatedContent,
		contentLength,
		hasMore,
		nextIndex,
		startIndex
	};
}

/**
 * Write Word document (.docx)
 * Supports two modes:
 * 1. Full rewrite: content is the complete new document content
 * 2. Edit mode: options.replacements is an array of {find, replace, bold?, italic?} objects
 */
async function writeWordDocument(filePath, content, options = {}) {
	// Ensure content is always a valid string — never crash on null/undefined
	if (content === null || content === undefined) content = '';
	if (typeof content !== 'string') content = String(content);

	// Try to use docx library for creating Word documents
	let docx;
	try {
		docx = require('docx');
	} catch (e) {
		throw new Error('docx library not installed. Install with: npm install docx');
	}

	const { Document, Paragraph, TextRun, Packer, HeadingLevel } = docx;

	// Edit mode: read original document, apply replacements
	if (options.replacements && Array.isArray(options.replacements) && options.replacements.length > 0 && fs.existsSync(filePath)) {
		// Read original document content using mammoth
		let originalContent = '';
		try {
			const mammoth = require('mammoth');
			const result = await mammoth.extractRawText({ path: filePath });
			originalContent = result.value;
		} catch (e) {
			console.warn('[DocumentReader] Failed to read original document for editing:', e.message);
			originalContent = content; // Fallback to provided content
		}

		// Apply replacements
		let modifiedContent = originalContent;
		for (const replacement of options.replacements) {
			if (replacement.find && replacement.replace !== undefined) {
				modifiedContent = modifiedContent.split(replacement.find).join(replacement.replace);
			}
		}

		// Use modified content for document creation
		content = modifiedContent;
	}

	// If content is provided and file exists (non-replacement mode), support append
	// When new content is shorter than original, it's likely a continuation/append
	if (fs.existsSync(filePath) && !options.replacements && content && content.trim()) {
		try {
			const mammoth = require('mammoth');
			const result = await mammoth.extractRawText({ path: filePath });
			const originalContent = result.value;

			// Heuristic: if new content doesn't start with a heading and original exists,
			// treat it as appending to the existing document
			const isAppend = originalContent && originalContent.trim().length > 0 &&
				!content.trim().startsWith('# ') &&
				content.length < originalContent.length;

			if (isAppend) {
				console.log('[DocumentReader] Appending content to existing document (' + originalContent.length + ' + ' + content.length + ' chars)');
				content = originalContent + '\n\n' + content;
			}
		} catch (e) {
			// Continue with provided content as full replacement
		}
	}

	// Parse markdown-like content into paragraphs
	const lines = content.split('\n');
	const children = [];


	// Track formatting from options.replacements for specific text
	const formatMap = new Map();
	if (options.replacements) {
		for (const r of options.replacements) {
			if (r.replace && (r.bold || r.italic)) {
				formatMap.set(r.replace, { bold: r.bold, italic: r.italic });
			}
		}
	}

	for (const line of lines) {
		if (line.startsWith('# ')) {
			children.push(new Paragraph({
				text: line.substring(2),
				heading: HeadingLevel.HEADING_1
			}));
		} else if (line.startsWith('## ')) {
			children.push(new Paragraph({
				text: line.substring(3),
				heading: HeadingLevel.HEADING_2
			}));
		} else if (line.startsWith('### ')) {
			children.push(new Paragraph({
				text: line.substring(4),
				heading: HeadingLevel.HEADING_3
			}));
		} else if (line.startsWith('- ') || line.startsWith('* ')) {
			children.push(new Paragraph({
				text: line.substring(2),
				bullet: { level: 0 }
			}));
		} else if (line.trim() === '') {
			children.push(new Paragraph({ text: '' }));
		} else {
			// Handle bold and italic in text
			const runs = [];
			let remaining = line;
			const boldItalicRegex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
			let lastIndex = 0;
			let match;

			while ((match = boldItalicRegex.exec(remaining)) !== null) {
				if (match.index > lastIndex) {
					const text = remaining.substring(lastIndex, match.index);
					const fmt = formatMap.get(text);
					runs.push(new TextRun({ text, bold: fmt?.bold, italics: fmt?.italic }));
				}
				if (match[1]) {
					runs.push(new TextRun({ text: match[1], bold: true, italics: true }));
				} else if (match[2]) {
					runs.push(new TextRun({ text: match[2], bold: true }));
				} else if (match[3]) {
					runs.push(new TextRun({ text: match[3], italics: true }));
				}
				lastIndex = match.index + match[0].length;
			}
			if (lastIndex < remaining.length) {
				const text = remaining.substring(lastIndex);
				// Check if this text should have special formatting from replacements
				const fmt = formatMap.get(text);
				runs.push(new TextRun({ text, bold: fmt?.bold, italics: fmt?.italic }));
			}

			if (runs.length > 0) {
				children.push(new Paragraph({ children: runs }));
			} else {
				// Check if whole line needs formatting
				const fmt = formatMap.get(line);
				if (fmt) {
					children.push(new Paragraph({
						children: [new TextRun({ text: line, bold: fmt.bold, italics: fmt.italic })]
					}));
				} else {
					children.push(new Paragraph({ text: line }));
				}
			}
		}
	}

	// Ensure document is never completely empty — docx library requires at least one child
	if (children.length === 0) {
		children.push(new Paragraph({ text: '' }));
	}

	const doc = new Document({
		sections: [{
			properties: {},
			children: children
		}]
	});

	const buffer = await Packer.toBuffer(doc);

	// Ensure parent directories exist
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	fs.writeFileSync(filePath, buffer);

	return {
		success: true,
		filePath,
		fileType: 'word',
		size: buffer.length
	};
}

/**
 * Write Excel document (.xlsx)
 */
async function writeExcelDocument(filePath, content, options = {}) {
	if (!xlsx) {
		throw new Error('xlsx library not installed. Install with: npm install xlsx');
	}

	// Parse markdown table or structured content
	const workbook = xlsx.utils.book_new();

	// Try to parse as markdown tables
	const tables = content.split(/\n\n+/);
	let sheetIndex = 0;

	for (const table of tables) {
		const lines = table.trim().split('\n').filter(l => l.trim());
		if (lines.length === 0) continue;

		// Check if it's a markdown table
		const isMarkdownTable = lines.some(l => l.includes('|'));

		if (isMarkdownTable) {
			const data = [];
			for (const line of lines) {
				// Skip separator lines (|---|---|)
				if (/^\|[\s\-:]+\|$/.test(line.replace(/[\s\-:|]/g, '').length === 0 ? '|--|' : line)) continue;
				if (line.match(/^\|[\s\-:|\s]+\|$/)) continue;

				const cells = line.split('|')
					.map(c => c.trim())
					.filter((c, i, arr) => i > 0 && i < arr.length - 1 || (i === 0 && c) || (i === arr.length - 1 && c));

				if (cells.length > 0 && !cells.every(c => /^[\-:]+$/.test(c))) {
					data.push(cells);
				}
			}

			if (data.length > 0) {
				const sheetName = options.sheetNames?.[sheetIndex] || `Sheet${sheetIndex + 1}`;
				const ws = xlsx.utils.aoa_to_sheet(data);
				xlsx.utils.book_append_sheet(workbook, ws, sheetName);
				sheetIndex++;
			}
		} else {
			// Treat as CSV-like data
			const data = lines.map(l => l.split(/[,\t]/));
			if (data.length > 0) {
				const sheetName = options.sheetNames?.[sheetIndex] || `Sheet${sheetIndex + 1}`;
				const ws = xlsx.utils.aoa_to_sheet(data);
				xlsx.utils.book_append_sheet(workbook, ws, sheetName);
				sheetIndex++;
			}
		}
	}

	// If no tables found, create a single cell with content
	if (sheetIndex === 0) {
		const ws = xlsx.utils.aoa_to_sheet([[content]]);
		xlsx.utils.book_append_sheet(workbook, ws, 'Sheet1');
	}

	xlsx.writeFile(workbook, filePath);

	const stats = fs.statSync(filePath);
	return {
		success: true,
		filePath,
		fileType: 'excel',
		size: stats.size,
		sheets: sheetIndex || 1
	};
}

/**
 * Write document (main function)
 */
async function writeDocument(filePath, content, options = {}) {
	const ext = path.extname(filePath).toLowerCase();

	// Backup original file only if explicitly requested
	if (fs.existsSync(filePath) && options.backup === true) {
		const backupPath = filePath + '.backup';
		fs.copyFileSync(filePath, backupPath);
	}

	switch (ext) {
		case '.docx':
			return await writeWordDocument(filePath, content, options);
		case '.xlsx':
		case '.xls':
			return await writeExcelDocument(filePath, content, options);
		case '.txt':
		case '.md':
			fs.writeFileSync(filePath, content, 'utf-8');
			return {
				success: true,
				filePath,
				fileType: 'text',
				size: Buffer.byteLength(content)
			};
		default:
			throw new Error(`Writing not supported for ${ext} files. Supported: .docx, .xlsx, .txt, .md`);
	}
}

/**
 * Merge multiple PDF files into one
 */
async function mergePdfFiles(inputFiles, outputPath) {
	if (!pdfjsLib) {
		throw new Error('pdfjs-dist not available for PDF merging');
	}

	// For merging, we need pdf-lib which is better suited
	let PDFLib;
	try {
		PDFLib = require('pdf-lib');
	} catch (e) {
		throw new Error('pdf-lib not installed. Install with: npm install pdf-lib');
	}

	const { PDFDocument } = PDFLib;
	const mergedPdf = await PDFDocument.create();

	for (const inputFile of inputFiles) {
		if (!fs.existsSync(inputFile)) {
			throw new Error(`File not found: ${inputFile}`);
		}
		const pdfBytes = fs.readFileSync(inputFile);
		const pdf = await PDFDocument.load(pdfBytes);
		const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
		pages.forEach(page => mergedPdf.addPage(page));
	}

	const mergedPdfBytes = await mergedPdf.save();
	fs.writeFileSync(outputPath, mergedPdfBytes);

	return {
		success: true,
		filePath: outputPath,
		fileType: 'pdf',
		size: mergedPdfBytes.length,
		mergedFiles: inputFiles.length
	};
}

/**
 * Split PDF file into multiple files
 */
async function splitPdfFile(inputFile, outputDir, options = {}) {
	let PDFLib;
	try {
		PDFLib = require('pdf-lib');
	} catch (e) {
		throw new Error('pdf-lib not installed. Install with: npm install pdf-lib');
	}

	const { PDFDocument } = PDFLib;

	if (!fs.existsSync(inputFile)) {
		throw new Error(`File not found: ${inputFile}`);
	}

	const pdfBytes = fs.readFileSync(inputFile);
	const pdf = await PDFDocument.load(pdfBytes);
	const totalPages = pdf.getPageCount();

	// Create output directory if not exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const outputFiles = [];
	const { fromPage = 1, toPage = totalPages, pagesPerFile = 1 } = options;

	const startPage = Math.max(1, fromPage) - 1;
	const endPage = Math.min(totalPages, toPage);

	for (let i = startPage; i < endPage; i += pagesPerFile) {
		const newPdf = await PDFDocument.create();
		const pageEnd = Math.min(i + pagesPerFile, endPage);

		for (let j = i; j < pageEnd; j++) {
			const [page] = await newPdf.copyPages(pdf, [j]);
			newPdf.addPage(page);
		}

		const outputPath = path.join(outputDir, `page_${i + 1}-${pageEnd}.pdf`);
		const newPdfBytes = await newPdf.save();
		fs.writeFileSync(outputPath, newPdfBytes);
		outputFiles.push(outputPath);
	}

	return {
		success: true,
		outputDir,
		fileType: 'pdf',
		totalPages,
		splitFiles: outputFiles.length,
		files: outputFiles
	};
}

/**
 * Add watermark to PDF
 */
async function addPdfWatermark(inputFile, outputFile, watermarkText, options = {}) {
	let PDFLib;
	try {
		PDFLib = require('pdf-lib');
	} catch (e) {
		throw new Error('pdf-lib not installed. Install with: npm install pdf-lib');
	}

	const { PDFDocument, rgb, degrees } = PDFLib;

	const pdfBytes = fs.readFileSync(inputFile);
	const pdf = await PDFDocument.load(pdfBytes);
	const pages = pdf.getPages();

	const {
		fontSize = 30,
		opacity = 0.3,
		angle = 45,
		color = { r: 0.5, g: 0.5, b: 0.5 }
	} = options;

	for (const page of pages) {
		const { width, height } = page.getSize();
		page.drawText(watermarkText, {
			x: width / 4,
			y: height / 2,
			size: fontSize,
			color: rgb(color.r, color.g, color.b),
			opacity: opacity,
			rotate: degrees(angle)
		});
	}

	const watermarkedPdfBytes = await pdf.save();
	fs.writeFileSync(outputFile, watermarkedPdfBytes);

	return {
		success: true,
		filePath: outputFile,
		fileType: 'pdf',
		size: watermarkedPdfBytes.length,
		pages: pages.length
	};
}

/**
 * Attempt to repair truncated JSON (e.g. from LLM output cutoff on long papers).
 * Uses multiple strategies with increasing aggressiveness.
 */
function tryRepairTruncatedJson(input) {
	if (!input || input.length < 10) return null;

	const firstBrace = input.indexOf('{');
	if (firstBrace === -1) return null;

	// Strategy 1: Close unclosed braces/brackets after cleaning trailing garbage
	const result = _repairByClosing(input, firstBrace);
	if (result) return result;

	// Strategy 2: For severely truncated JSON, try progressively shorter substrings
	// Find the last complete value boundary (closing quote, bracket, or brace)
	const json = input.slice(firstBrace);
	const lastGoodBoundaries = [
		json.lastIndexOf('}'),
		json.lastIndexOf(']'),
		json.lastIndexOf('"'),
	].filter(i => i > 0).sort((a, b) => b - a);

	for (const boundary of lastGoodBoundaries) {
		const candidate = json.slice(0, boundary + 1);
		const repaired = _repairByClosing(candidate, 0);
		if (repaired) return repaired;
	}

	return null;
}

function _repairByClosing(input, startIdx) {
	let json = input.slice(startIdx);

	let openBraces = 0, openBrackets = 0;
	let inString = false, escaped = false;
	for (let i = 0; i < json.length; i++) {
		const ch = json[i];
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') openBraces++;
		else if (ch === '}') openBraces--;
		else if (ch === '[') openBrackets++;
		else if (ch === ']') openBrackets--;
	}

	if (openBraces === 0 && openBrackets === 0) return null;
	if (openBraces < 0 || openBrackets < 0) return null;

	if (inString) json += '"';

	// Remove trailing incomplete content with multiple patterns
	const cleanPatterns = [
		/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/,       // trailing partial key-value
		/,\s*\{[^}]*$/,                          // trailing incomplete object in array
		/,\s*\[[^\]]*$/,                          // trailing incomplete array
		/,\s*"[^"]*$/,                            // trailing incomplete string in array
	];
	for (const pattern of cleanPatterns) {
		const cleaned = json.replace(pattern, '');
		if (cleaned.length !== json.length && cleaned.length > 5) {
			json = cleaned;
			break;
		}
	}

	json = json.replace(/,\s*$/, '');

	// Re-count
	openBraces = 0; openBrackets = 0; inString = false; escaped = false;
	for (let i = 0; i < json.length; i++) {
		const ch = json[i];
		if (escaped) { escaped = false; continue; }
		if (ch === '\\') { escaped = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') openBraces++;
		else if (ch === '}') openBraces--;
		else if (ch === '[') openBrackets++;
		else if (ch === ']') openBrackets--;
	}

	if (inString) json += '"';
	for (let i = 0; i < openBrackets; i++) json += ']';
	for (let i = 0; i < openBraces; i++) json += '}';

	try {
		const parsed = JSON.parse(json);
		if (parsed && typeof parsed === 'object') {
			console.log('[DocumentReader] Successfully repaired truncated JSON (' + input.length + ' chars)');
			return parsed;
		}
	} catch { /* repair failed */ }

	return null;
}

/**
 * Last-resort: extract readable text content from a string that looks like truncated JSON.
 * Uses regex to pull out "text", "title", "heading", "subtitle" values and
 * reconstruct a document-like structure as markdown.
 * This NEVER fails — always returns some text.
 */
function extractTextFromBrokenJson(input) {
	if (!input || typeof input !== 'string') return '';

	const lines = [];

	// Extract title
	const titleMatch = input.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
	if (titleMatch) lines.push('# ' + titleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));

	// Extract subtitle
	const subtitleMatch = input.match(/"subtitle"\s*:\s*"((?:[^"\\]|\\.)*)"/);
	if (subtitleMatch) lines.push('## ' + subtitleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));

	// Extract all headings (in order of appearance)
	const headingRegex = /"heading"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
	let headingMatch;
	const headings = [];
	while ((headingMatch = headingRegex.exec(input)) !== null) {
		headings.push(headingMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
	}

	// Extract all text values (paragraphs)
	const textRegex = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
	let textMatch;
	const texts = [];
	while ((textMatch = textRegex.exec(input)) !== null) {
		const val = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
		if (val.length > 5) texts.push(val); // skip very short fragments
	}

	// Interleave headings and text by their position in the original JSON string
	const headingPositions = [];
	const hRegex2 = /"heading"\s*:\s*"/g;
	let hm;
	while ((hm = hRegex2.exec(input)) !== null) {
		headingPositions.push(hm.index);
	}

	const textPositions = [];
	const tRegex2 = /"text"\s*:\s*"/g;
	let tm;
	while ((tm = tRegex2.exec(input)) !== null) {
		textPositions.push(tm.index);
	}

	// Build ordered content by position in original string
	const allItems = [];
	for (let i = 0; i < headings.length; i++) {
		allItems.push({ type: 'heading', text: headings[i], pos: headingPositions[i] || 0 });
	}
	for (let i = 0; i < texts.length; i++) {
		allItems.push({ type: 'text', text: texts[i], pos: textPositions[i] || 0 });
	}
	allItems.sort((a, b) => a.pos - b.pos);

	for (const item of allItems) {
		if (item.type === 'heading') {
			lines.push('\n## ' + item.text);
		} else {
			lines.push(item.text);
		}
	}

	// If we extracted nothing from structured fields, just strip JSON syntax
	if (lines.length === 0) {
		const stripped = input
			.replace(/[{}\[\]]/g, '')
			.replace(/"[a-z_]+"\s*:/gi, '')
			.replace(/"/g, '')
			.replace(/,\s*$/gm, '')
			.replace(/true|false|null/g, '')
			.split('\n')
			.map(l => l.trim())
			.filter(l => l.length > 2);
		return stripped.join('\n');
	}

	return lines.join('\n');
}

/**
 * Create professional Word document with advanced formatting
 */
async function createProfessionalWord(filePath, documentData, options = {}) {
	let docx;
	try {
		docx = require('docx');
	} catch (e) {
		throw new Error('docx library not installed. Install with: npm install docx');
	}
	let normalizedData = documentData;
	let wasJsonRepaired = false;
	if (typeof normalizedData === 'string') {
		const tryParseJsonFromString = (input) => {
			const original = String(input);
			const trimmed = original.trim();
			const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
			const baseCandidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
			const normalizedCandidate = baseCandidate
				.replace(/[""„‟]/g, '"')
				.replace(/[''‚‛]/g, "'")
				.replace(/：/g, ':')
				.replace(/，/g, ',')
				.replace(/,\s*([}\]])/g, '$1');

			const attempt = (candidate) => {
				try {
					return JSON.parse(candidate);
				} catch {
					return null;
				}
			};

			let parsed = attempt(baseCandidate) || attempt(normalizedCandidate);
			if (parsed && typeof parsed === 'object') return parsed;

			const firstObj = normalizedCandidate.indexOf('{');
			const lastObj = normalizedCandidate.lastIndexOf('}');
			if (firstObj !== -1 && lastObj > firstObj) {
				parsed = attempt(normalizedCandidate.slice(firstObj, lastObj + 1));
				if (parsed && typeof parsed === 'object') return parsed;
			}

			const firstArr = normalizedCandidate.indexOf('[');
			const lastArr = normalizedCandidate.lastIndexOf(']');
			if (firstArr !== -1 && lastArr > firstArr) {
				parsed = attempt(normalizedCandidate.slice(firstArr, lastArr + 1));
				if (parsed && typeof parsed === 'object') return parsed;
			}

			// ================ Truncated JSON repair ================
			// When LLM output is cut off mid-JSON (e.g. long papers), try to repair
			if (normalizedCandidate.length > 10 && firstObj !== -1) {
				const repaired = tryRepairTruncatedJson(normalizedCandidate);
				if (repaired) {
					wasJsonRepaired = true;
					return repaired;
				}
			}

			return null;
		};

		const parsed = tryParseJsonFromString(normalizedData);
		if (parsed && typeof parsed === 'object') {
			normalizedData = parsed;
		}
	}

	const {
		Document, Paragraph, TextRun, Table, TableRow, TableCell,
		HeadingLevel, AlignmentType, BorderStyle, WidthType,
		Header, Footer, PageNumber, NumberFormat, Packer,
		LineRuleType, PageOrientation
	} = docx;

	const mmToTwip = (mm) => Math.round((mm / 25.4) * 1440);

	const normalizeText = (v) => (v === null || v === undefined) ? '' : String(v);

	const getAllTextForHeuristic = () => {
		let text = '';
		if (typeof normalizedData === 'string') text += normalizedData;
		if (Array.isArray(normalizedData)) text += normalizedData.join('\n');
		if (normalizedData && typeof normalizedData === 'object') {
			if (typeof normalizedData.title === 'string') text += '\n' + normalizedData.title;
			if (typeof normalizedData.subtitle === 'string') text += '\n' + normalizedData.subtitle;
			if (typeof normalizedData.content === 'string') text += '\n' + normalizedData.content;
			if (typeof normalizedData.text === 'string') text += '\n' + normalizedData.text;
			if (Array.isArray(normalizedData.sections)) {
				for (const s of normalizedData.sections) {
					if (!s) continue;
					if (typeof s.heading === 'string') text += '\n' + s.heading;
					if (Array.isArray(s.paragraphs)) {
						for (const p of s.paragraphs) {
							if (typeof p === 'string') text += '\n' + p;
							else if (p && typeof p.text === 'string') text += '\n' + p.text;
						}
					}
				}
			}
		}
		return text;
	};

	const looksLikeAcademicPaper = () => {
		const text = getAllTextForHeuristic();
		const hit = (re) => re.test(text);
		const score = [
			hit(/\babstract\b/i) || hit(/摘要/),
			hit(/\bkeywords\b/i) || hit(/关键词/),
			hit(/\breferences\b/i) || hit(/参考文献/),
			hit(/\bintroduction\b/i) || hit(/引言/),
			hit(/\bmethod\b/i) || hit(/方法/),
			hit(/\bconclusion\b/i) || hit(/结论/) || hit(/总结/)
		].filter(Boolean).length;
		return score >= 2;
	};

	const detectLanguageForTemplate = () => {
		const text = getAllTextForHeuristic();
		const hasChinese = /[\u4e00-\u9fa5]/.test(text);
		return hasChinese ? 'zh' : 'en';
	};

	const templateOption = (options && options.template) ? String(options.template) : 'auto';
	const resolveTemplate = () => {
		if (templateOption === 'none') return null;
		if (templateOption === 'academic_cn_gb' || templateOption === 'academic_en_apa7' || templateOption === 'academic_en_ieee') {
			return templateOption;
		}
		if (templateOption === 'auto' || !templateOption) {
			if (!looksLikeAcademicPaper()) return null;
			return detectLanguageForTemplate() === 'zh' ? 'academic_cn_gb' : 'academic_en_apa7';
		}
		return null;
	};

	const selectedTemplate = resolveTemplate();
	const detectedLangForStyles = detectLanguageForTemplate();

	const buildAcademicStyles = (tpl) => {
		const isZh = tpl === 'academic_cn_gb';
		const isApa = tpl === 'academic_en_apa7';
		const isIeee = tpl === 'academic_en_ieee';
		const defaultFont = (isZh || detectedLangForStyles === 'zh') ? 'SimSun' : 'Times New Roman';
		const titleSize = isZh ? 44 : 32;
		const bodySize = isIeee ? 20 : 24;
		const line = isZh ? 360 : 480;
		const bodyIndent = isZh ? 480 : 0;
		const bodyAlignment = isZh ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;

		return {
			default: {
				document: {
					run: { font: defaultFont, size: bodySize },
					paragraph: {
						spacing: { line, lineRule: LineRuleType.AUTO },
					}
				}
			},
			paragraphStyles: [
				{
					id: 'SenweaverPaperTitle',
					name: 'SenweaverPaperTitle',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { bold: true, size: titleSize },
					paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } }
				},
				{
					id: 'SenweaverPaperSubtitle',
					name: 'SenweaverPaperSubtitle',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { italics: isZh ? false : true, size: isZh ? 28 : 24 },
					paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } }
				},
				{
					id: 'SenweaverPaperAbstractHeading',
					name: 'SenweaverPaperAbstractHeading',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { bold: true, size: isZh ? 24 : bodySize },
					paragraph: { spacing: { before: 240, after: 120 } }
				},
				{
					id: 'SenweaverPaperAbstractBody',
					name: 'SenweaverPaperAbstractBody',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { size: isIeee ? 18 : (isZh ? 21 : bodySize) },
					paragraph: {
						alignment: bodyAlignment,
						spacing: { line: isZh ? 360 : 480, lineRule: LineRuleType.AUTO },
						indent: { firstLine: isZh ? 420 : 0 }
					}
				},
				{
					id: 'SenweaverPaperHeading1',
					name: 'SenweaverPaperHeading1',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { bold: true, size: isZh ? 28 : (isIeee ? 20 : 26) },
					paragraph: { spacing: { before: 240, after: 120 } }
				},
				{
					id: 'SenweaverPaperHeading2',
					name: 'SenweaverPaperHeading2',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { bold: true, size: isZh ? 24 : (isIeee ? 20 : 24) },
					paragraph: { spacing: { before: 180, after: 60 } }
				},
				{
					id: 'SenweaverPaperBody',
					name: 'SenweaverPaperBody',
					basedOn: 'Normal',
					next: 'Normal',
					quickFormat: true,
					run: { size: bodySize },
					paragraph: {
						alignment: bodyAlignment,
						spacing: { line, lineRule: LineRuleType.AUTO },
						indent: { firstLine: bodyIndent }
					}
				}
			]
		};
	};

	const findSectionByHeading = (headingReList) => {
		if (!normalizedData || typeof normalizedData !== 'object' || !Array.isArray(normalizedData.sections)) return null;
		for (const s of normalizedData.sections) {
			const h = (s && typeof s.heading === 'string') ? s.heading.trim() : '';
			if (!h) continue;
			for (const re of headingReList) {
				if (re.test(h)) return s;
			}
		}
		return null;
	};

	const buildParaFromParaData = (para, styleId, alignmentOverride) => {
		// Null/undefined safety — always return a valid Paragraph
		if (!para && para !== 0) return new Paragraph({ text: '', style: styleId });
		if (typeof para === 'string') {
			return new Paragraph({ text: para, style: styleId, alignment: alignmentOverride });
		}
		if (typeof para === 'number') {
			return new Paragraph({ text: String(para), style: styleId, alignment: alignmentOverride });
		}
		const runs = [];
		if (para.text !== undefined && para.text !== null) {
			runs.push(new TextRun({
				text: String(para.text),
				bold: para.bold,
				italics: para.italic,
				size: para.size ? para.size * 2 : undefined
			}));
		}
		return new Paragraph({
			children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
			style: styleId,
			alignment: alignmentOverride || (para.align === 'center' ? AlignmentType.CENTER :
				para.align === 'right' ? AlignmentType.RIGHT : undefined)
		});
	};

	const buildTableFromAoa = (aoa) => {
		if (!Array.isArray(aoa) || aoa.length === 0) {
			return new Paragraph({ text: '[Empty table]' });
		}
		const tableRows = aoa
			.filter(row => Array.isArray(row) && row.length > 0)
			.map((row, rowIndex) =>
				new TableRow({
					children: row.map(cell =>
						new TableCell({
							children: [new Paragraph({
								text: normalizeText(cell),
								alignment: AlignmentType.CENTER
							})],
							shading: rowIndex === 0 ? { fill: 'DDDDDD' } : undefined
						})
					)
				})
			);
		if (tableRows.length === 0) return new Paragraph({ text: '[Empty table]' });
		return new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });
	};

	if (selectedTemplate) {
		const styles = buildAcademicStyles(selectedTemplate);
		const isZh = selectedTemplate === 'academic_cn_gb';
		const isIeee = selectedTemplate === 'academic_en_ieee';
		const margin = isZh
			? { top: mmToTwip(25.4), bottom: mmToTwip(25.4), left: mmToTwip(31.8), right: mmToTwip(25.4) }
			: { top: mmToTwip(25.4), bottom: mmToTwip(25.4), left: mmToTwip(25.4), right: mmToTwip(25.4) };
		const a4Page = {
			margin,
			size: { width: mmToTwip(210), height: mmToTwip(297), orientation: PageOrientation.PORTRAIT }
		};

		const frontChildren = [];
		const bodyChildren = [];

		if (normalizedData && typeof normalizedData === 'object' && normalizedData.title) {
			frontChildren.push(new Paragraph({ text: normalizedData.title, style: 'SenweaverPaperTitle' }));
		}
		if (normalizedData && typeof normalizedData === 'object' && normalizedData.subtitle) {
			frontChildren.push(new Paragraph({ text: normalizedData.subtitle, style: 'SenweaverPaperSubtitle' }));
		}

		const abstractSection = findSectionByHeading([/^(摘要|Abstract)$/i, /^\s*摘要\s*$/i, /^\s*Abstract\s*$/i]);
		const keywordSection = findSectionByHeading([/^(关键词|Keywords)$/i, /^\s*关键词\s*$/i, /^\s*Keywords\s*$/i]);
		const referencesSection = findSectionByHeading([/^(参考文献|References)$/i, /^\s*参考文献\s*$/i, /^\s*References\s*$/i]);

		if (abstractSection) {
			frontChildren.push(new Paragraph({ text: isZh ? '摘要' : 'Abstract', style: 'SenweaverPaperAbstractHeading' }));
			if (Array.isArray(abstractSection.paragraphs)) {
				for (const p of abstractSection.paragraphs) {
					frontChildren.push(buildParaFromParaData(p, 'SenweaverPaperAbstractBody'));
				}
			}
		}
		if (keywordSection) {
			frontChildren.push(new Paragraph({ text: isZh ? '关键词' : 'Keywords', style: 'SenweaverPaperAbstractHeading' }));
			if (Array.isArray(keywordSection.paragraphs)) {
				for (const p of keywordSection.paragraphs) {
					frontChildren.push(buildParaFromParaData(p, 'SenweaverPaperAbstractBody'));
				}
			}
		}

		const sectionsToRender = (normalizedData && typeof normalizedData === 'object' && Array.isArray(normalizedData.sections)) ? normalizedData.sections : [];
		for (const section of sectionsToRender) {
			if (!section) continue;
			if (section === abstractSection || section === keywordSection) continue;
			const h = (section.heading && typeof section.heading === 'string') ? section.heading.trim() : '';
			if (h) {
				bodyChildren.push(new Paragraph({ text: h, style: 'SenweaverPaperHeading1' }));
			}
			if (Array.isArray(section.paragraphs)) {
				for (const para of section.paragraphs) {
					bodyChildren.push(buildParaFromParaData(para, 'SenweaverPaperBody'));
				}
			}
			if (section.table) {
				bodyChildren.push(buildTableFromAoa(section.table));
			}
		}

		if (bodyChildren.length === 0) {
			if (typeof normalizedData === 'string') {
				// If string looks like truncated JSON, extract text content instead of writing raw JSON
				const trimmedStr = normalizedData.trim();
				let contentToUse = normalizedData;
				if (trimmedStr.startsWith('{') && (trimmedStr.includes('"title"') || trimmedStr.includes('"sections"') || trimmedStr.includes('"paragraphs"'))) {
					console.warn('[DocumentReader] Detected truncated JSON in academic path, extracting text content');
					contentToUse = extractTextFromBrokenJson(normalizedData);
					wasJsonRepaired = true; // mark as repaired (partial content)
				}
				const lines = contentToUse.split('\n').map(l => l.trim()).filter(Boolean);
				for (const line of lines) bodyChildren.push(new Paragraph({ text: line, style: 'SenweaverPaperBody' }));
			} else if (normalizedData && typeof normalizedData === 'object') {
				const rawText = (typeof normalizedData.content === 'string' ? normalizedData.content : (typeof normalizedData.text === 'string' ? normalizedData.text : ''));
				if (rawText) {
					const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
					for (const line of lines) bodyChildren.push(new Paragraph({ text: line, style: 'SenweaverPaperBody' }));
				}
			}
		}

		const footerText = (options && typeof options.footer === 'string') ? options.footer : '';
		const footerRuns = [];
		if (footerText) footerRuns.push(new TextRun({ text: footerText + (isZh ? ' - 第 ' : ' - Page ') }));
		else footerRuns.push(new TextRun({ text: isZh ? '第 ' : 'Page ' }));
		footerRuns.push(new TextRun({ children: [PageNumber.CURRENT] }));
		if (isZh) footerRuns.push(new TextRun({ text: ' 页' }));

		const headerText = (options && typeof options.header === 'string') ? options.header : '';
		const headers = headerText ? {
			default: new Header({
				children: [new Paragraph({ text: headerText, alignment: AlignmentType.CENTER })]
			})
		} : undefined;

		const footers = {
			default: new Footer({
				children: [new Paragraph({
					children: footerRuns,
					alignment: AlignmentType.CENTER
				})]
			})
		};

		const section1 = {
			properties: { page: a4Page },
			headers,
			footers,
			children: frontChildren
		};

		// Ensure document is never completely empty — docx library requires at least one child
		const allChildren = [...frontChildren, ...bodyChildren];
		if (allChildren.length === 0) {
			allChildren.push(new Paragraph({ text: '' }));
		}

		const sections = [section1];
		if (isIeee) {
			const twoCol = { count: 2, space: 720 };
			section1.properties = { page: a4Page, column: twoCol, columns: twoCol };
			section1.children = allChildren;
		} else {
			section1.children = allChildren;
		}

		const doc = new Document({ styles, sections });
		const buffer = await Packer.toBuffer(doc);
		if (isIeee) {
			try {
				const JSZip = require('jszip');
				const zip = await JSZip.loadAsync(buffer);
				const documentXml = await zip.file('word/document.xml')?.async('string');
				const hasCols = !!(documentXml && /<w:cols\b/.test(documentXml));
				const colsTag = documentXml ? (documentXml.match(/<w:cols[^>]*>/)?.[0] || '') : '';
			} catch (e) {
				console.log(`[DocumentReader] ⚠️ IEEE column XML check failed: ${e && e.message ? e.message : String(e)}`);
			}
		}
		// Ensure parent directories exist
		const dirPath = path.dirname(filePath);
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}
		fs.writeFileSync(filePath, buffer);

		const result = {
			success: true,
			filePath,
			fileType: 'word',
			size: buffer.length,
			elements: allChildren.length,
			sections: (normalizedData && typeof normalizedData === 'object' && Array.isArray(normalizedData.sections)) ? normalizedData.sections.length : 0
		};
		if (wasJsonRepaired) {
			result.warning = 'Document was created from repaired truncated JSON. Some sections may be incomplete. You can use edit_document to add missing content.';
			result.wasJsonRepaired = true;
		}
		return result;
	}

	const children = [];

	if (typeof normalizedData === 'string') {
		// If string looks like truncated JSON, extract text content instead of writing raw JSON
		const trimmedStr = normalizedData.trim();
		let contentToUse = normalizedData;
		if (trimmedStr.startsWith('{') && (trimmedStr.includes('"title"') || trimmedStr.includes('"sections"') || trimmedStr.includes('"paragraphs"'))) {
			console.warn('[DocumentReader] Detected truncated JSON in non-template path, extracting text content');
			contentToUse = extractTextFromBrokenJson(normalizedData);
			wasJsonRepaired = true;
		}
		const lines = contentToUse.split('\n').map(l => l.trim()).filter(Boolean);
		for (const line of lines) {
			children.push(new Paragraph({ text: line }));
		}
	}

	if (Array.isArray(normalizedData)) {
		const lines = normalizedData.map(v => String(v)).map(l => l.trim()).filter(Boolean);
		for (const line of lines) {
			children.push(new Paragraph({ text: line }));
		}
	}

	if (normalizedData?.content && typeof normalizedData.content === 'string') {
		const lines = normalizedData.content.split('\n').filter(line => line.trim());
		for (const line of lines) {
			children.push(new Paragraph({ text: line }));
		}
	}

	if (normalizedData?.text && typeof normalizedData.text === 'string') {
		const lines = normalizedData.text.split('\n').filter(line => line.trim());
		for (const line of lines) {
			children.push(new Paragraph({ text: line }));
		}
	}

	// Process document structure
	if (normalizedData?.title) {
		children.push(new Paragraph({
			text: normalizedData.title,
			heading: HeadingLevel.TITLE,
			alignment: AlignmentType.CENTER
		}));
	}

	if (normalizedData?.subtitle) {
		children.push(new Paragraph({
			text: normalizedData.subtitle,
			heading: HeadingLevel.HEADING_2,
			alignment: AlignmentType.CENTER
		}));
	}

	// Process sections
	if (Array.isArray(normalizedData?.sections)) {
		for (const section of normalizedData.sections) {
			if (!section) continue; // null safety
			if (section.heading && typeof section.heading === 'string') {
				children.push(new Paragraph({
					text: section.heading,
					heading: HeadingLevel.HEADING_1
				}));
			}

			if (Array.isArray(section.paragraphs)) {
				for (const para of section.paragraphs) {
					if (!para && para !== 0) continue; // null safety
					if (typeof para === 'string') {
						children.push(new Paragraph({ text: para }));
					} else if (typeof para === 'object') {
						// Handle formatted paragraph
						const runs = [];
						if (para.text !== undefined && para.text !== null) {
							runs.push(new TextRun({
								text: String(para.text),
								bold: para.bold,
								italics: para.italic,
								size: para.size ? para.size * 2 : undefined
							}));
						}
						children.push(new Paragraph({
							children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
							alignment: para.align === 'center' ? AlignmentType.CENTER :
								para.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT
						}));
					}
				}
			}

			// Handle tables with null safety
			if (Array.isArray(section.table) && section.table.length > 0) {
				const tableRows = section.table
					.filter(row => Array.isArray(row) && row.length > 0)
					.map((row, rowIndex) =>
						new TableRow({
							children: row.map(cell =>
								new TableCell({
									children: [new Paragraph({
										text: normalizeText(cell),
										alignment: AlignmentType.CENTER
									})],
									shading: rowIndex === 0 ? { fill: 'DDDDDD' } : undefined
								})
							)
						})
					);
				if (tableRows.length > 0) {
					children.push(new Table({
						rows: tableRows,
						width: { size: 100, type: WidthType.PERCENTAGE }
					}));
				}
			}
		}
	}

	if (children.length === 0) {
		children.push(new Paragraph({ text: '[Empty document - no content provided]' }));
	}

	// Create document with header/footer if specified
	const doc = new Document({
		sections: [{
			properties: {},
			headers: options.header ? {
				default: new Header({
					children: [new Paragraph({ text: options.header, alignment: AlignmentType.CENTER })]
				})
			} : undefined,
			footers: options.footer ? {
				default: new Footer({
					children: [new Paragraph({
						children: [
							new TextRun({ text: options.footer + ' - 第 ' }),
							new TextRun({ children: [PageNumber.CURRENT] }),
							new TextRun({ text: ' 页' })
						],
						alignment: AlignmentType.CENTER
					})]
				})
			} : undefined,
			children: children
		}]
	});

	const buffer = await Packer.toBuffer(doc);

	// Ensure parent directories exist
	const dirPath2 = path.dirname(filePath);
	if (!fs.existsSync(dirPath2)) {
		fs.mkdirSync(dirPath2, { recursive: true });
	}
	fs.writeFileSync(filePath, buffer);

	const result = {
		success: true,
		filePath,
		fileType: 'word',
		size: buffer.length,
		elements: children.length,
		sections: Array.isArray(normalizedData?.sections) ? normalizedData.sections.length : 0
	};
	if (wasJsonRepaired) {
		result.warning = 'Document was created from repaired truncated JSON. Some sections may be incomplete. You can use edit_document to add missing content.';
		result.wasJsonRepaired = true;
	}
	return result;
}

/**
 * Create professional Excel with multiple sheets, formulas, and styling
 */
async function createProfessionalExcel(filePath, workbookData, options = {}) {
	if (!xlsx) {
		throw new Error('xlsx library not installed. Install with: npm install xlsx');
	}
	let normalizedData = workbookData;
	if (typeof normalizedData === 'string') {
		const trimmed = normalizedData.trim();
		if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
			try {
				const parsed = JSON.parse(trimmed);
				if (parsed && typeof parsed === 'object') {
					normalizedData = parsed;
				}
			} catch {
			}
		}
	}
	if (Array.isArray(normalizedData)) {
		if (normalizedData.length > 0 && Array.isArray(normalizedData[0])) {
			normalizedData = { sheets: [{ name: 'Sheet1', data: normalizedData }] };
		} else if (normalizedData.length > 0 && normalizedData[0] && typeof normalizedData[0] === 'object') {
			normalizedData = { sheets: [{ name: 'Sheet1', json: normalizedData }] };
		} else {
			const lines = normalizedData.map(v => String(v)).map(l => l.trim()).filter(Boolean);
			normalizedData = { sheets: [{ name: 'Sheet1', data: lines.map(l => [l]) }] };
		}
	}
	if (typeof normalizedData === 'string') {
		const lines = normalizedData.split('\n').map(l => l.trim()).filter(Boolean);
		normalizedData = { sheets: [{ name: 'Sheet1', data: lines.map(l => [l]) }] };
	}

	const workbook = xlsx.utils.book_new();

	for (const sheetData of normalizedData.sheets || [normalizedData]) {
		const sheetName = sheetData.name || `Sheet${workbook.SheetNames.length + 1}`;
		let ws;

		if (sheetData.data) {
			// Array of arrays
			ws = xlsx.utils.aoa_to_sheet(sheetData.data);
		} else if (sheetData.json) {
			// JSON data
			ws = xlsx.utils.json_to_sheet(sheetData.json);
		} else {
			continue;
		}

		// Apply column widths
		if (sheetData.columnWidths) {
			ws['!cols'] = sheetData.columnWidths.map(w => ({ wch: w }));
		}

		// Apply formulas
		if (sheetData.formulas) {
			for (const formula of sheetData.formulas) {
				ws[formula.cell] = { f: formula.formula };
			}
		}

		xlsx.utils.book_append_sheet(workbook, ws, sheetName);
	}

	xlsx.writeFile(workbook, filePath);

	const stats = fs.statSync(filePath);
	return {
		success: true,
		filePath,
		fileType: 'excel',
		size: stats.size,
		sheets: workbook.SheetNames.length
	};
}

/**
 * Create professional PowerPoint presentation
 */
async function createProfessionalPPT(filePath, presentationData, options = {}) {
	let pptxgen;
	try {
		pptxgen = require('pptxgenjs');
	} catch (e) {
		throw new Error('pptxgenjs library not installed. Install with: npm install pptxgenjs');
	}
	let normalizedData = presentationData;
	if (typeof normalizedData === 'string') {
		const trimmed = normalizedData.trim();
		if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
			try {
				const parsed = JSON.parse(trimmed);
				if (parsed && typeof parsed === 'object') {
					normalizedData = parsed;
				}
			} catch {
			}
		}
	}
	if (Array.isArray(normalizedData)) {
		const lines = normalizedData.map(v => String(v)).map(l => l.trim()).filter(Boolean);
		normalizedData = { slides: [{ content: lines }] };
	}
	if (typeof normalizedData === 'string') {
		const lines = normalizedData.split('\n').map(l => l.trim()).filter(Boolean);
		normalizedData = { slides: [{ content: lines }] };
	}

	const pres = new pptxgen();

	// Set presentation properties
	if (normalizedData.title) {
		pres.title = normalizedData.title;
	}
	if (normalizedData.author) {
		pres.author = normalizedData.author;
	}
	if (normalizedData.subject) {
		pres.subject = normalizedData.subject;
	}

	// Set theme colors if specified
	if (options.theme) {
		// Apply theme settings
	}

	// Create title slide if title is provided
	if (normalizedData.title) {
		const titleSlide = pres.addSlide();
		titleSlide.addText(normalizedData.title, {
			x: 0.5,
			y: 2.0,
			w: '90%',
			h: 1.5,
			fontSize: 44,
			bold: true,
			align: 'center',
			color: '363636'
		});
		if (normalizedData.subtitle) {
			titleSlide.addText(normalizedData.subtitle, {
				x: 0.5,
				y: 3.5,
				w: '90%',
				h: 1.0,
				fontSize: 24,
				align: 'center',
				color: '666666'
			});
		}
	}

	// Create content slides
	const slides = normalizedData.slides || [];
	for (const slideData of slides) {
		const slide = pres.addSlide();
		let yPos = 0.5;

		// Slide title
		if (slideData.title) {
			slide.addText(slideData.title, {
				x: 0.5,
				y: yPos,
				w: '90%',
				h: 0.8,
				fontSize: 32,
				bold: true,
				color: '363636'
			});
			yPos += 1.0;
		}

		// Slide subtitle
		if (slideData.subtitle) {
			slide.addText(slideData.subtitle, {
				x: 0.5,
				y: yPos,
				w: '90%',
				h: 0.5,
				fontSize: 18,
				color: '666666'
			});
			yPos += 0.7;
		}

		// Content paragraphs
		if (slideData.content && slideData.content.length > 0) {
			for (const para of slideData.content) {
				slide.addText(para, {
					x: 0.5,
					y: yPos,
					w: '90%',
					h: 0.5,
					fontSize: 18,
					color: '363636'
				});
				yPos += 0.6;
			}
		}

		// Bullet points
		if (slideData.bullets && slideData.bullets.length > 0) {
			const bulletText = slideData.bullets.map(b => ({ text: b, options: { bullet: true } }));
			slide.addText(bulletText, {
				x: 0.5,
				y: yPos,
				w: '90%',
				h: 'auto',
				fontSize: 18,
				color: '363636',
				valign: 'top'
			});
		}

		// Image
		if (slideData.image) {
			try {
				if (slideData.image.startsWith('data:')) {
					slide.addImage({ data: slideData.image, x: 1, y: yPos + 0.5, w: 6, h: 4 });
				} else if (fs.existsSync(slideData.image)) {
					slide.addImage({ path: slideData.image, x: 1, y: yPos + 0.5, w: 6, h: 4 });
				}
			} catch (e) {
				console.warn('[DocumentReader] Failed to add image to slide:', e.message);
			}
		}
	}

	// Save the presentation
	await pres.writeFile({ fileName: filePath });

	const stats = fs.statSync(filePath);
	return {
		success: true,
		filePath,
		fileType: 'ppt',
		size: stats.size,
		slides: (presentationData.title ? 1 : 0) + slides.length
	};
}

/**
 * Convert document between formats
 */
async function convertDocument(inputFile, outputPath, format, options = {}) {
	const ext = path.extname(inputFile).toLowerCase();
	const sourceFormat = ext.replace('.', '');

	// Ensure output directory exists
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	let result = {
		success: true,
		inputFile,
		outputPath,
		sourceFormat,
		targetFormat: format
	};

	const normalizedTargetFormat = (format === 'wps') ? 'docx' : format;

	if ((ext === '.md' || ext === '.markdown') && (normalizedTargetFormat === 'docx' || normalizedTargetFormat === 'xlsx')) {
		const mdText = fs.readFileSync(inputFile, 'utf8');
		if (!mdText || mdText.trim().length === 0) {
			throw new Error(`Cannot convert Markdown to ${format}: source markdown is empty`);
		}

		if (normalizedTargetFormat === 'docx') {
			const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = require('docx');
			const { marked } = await import('marked');
			const tokens = marked.lexer(mdText);

			const runsFromInline = (inlineTokens) => {
				const runs = [];
				const visit = (t, style) => {
					if (!t) return;
					if (Array.isArray(t)) {
						for (const c of t) visit(c, style);
						return;
					}
					const nextStyle = { ...(style || {}) };
					if (t.type === 'strong') {
						nextStyle.bold = true;
						return visit(t.tokens || [], nextStyle);
					}
					if (t.type === 'em') {
						nextStyle.italics = true;
						return visit(t.tokens || [], nextStyle);
					}
					if (t.type === 'codespan') {
						runs.push(new TextRun({ text: t.text || '', font: 'Consolas' }));
						return;
					}
					if (t.type === 'text') {
						runs.push(new TextRun({ text: t.text || '', bold: !!nextStyle.bold, italics: !!nextStyle.italics }));
						return;
					}
					if (t.type === 'link') {
						runs.push(new TextRun({ text: t.text || t.href || '', bold: !!nextStyle.bold, italics: !!nextStyle.italics }));
						return;
					}
					if (t.raw) {
						runs.push(new TextRun({ text: String(t.raw), bold: !!nextStyle.bold, italics: !!nextStyle.italics }));
					}
				};
				visit(inlineTokens || [], {});
				return runs.length ? runs : [new TextRun({ text: '' })];
			};

			const children = [];
			for (const token of tokens) {
				if (token.type === 'space') continue;
				if (token.type === 'heading') {
					const level = token.depth || 1;
					const heading = level === 1 ? HeadingLevel.HEADING_1 :
						level === 2 ? HeadingLevel.HEADING_2 :
							level === 3 ? HeadingLevel.HEADING_3 :
								HeadingLevel.HEADING_4;
					children.push(new Paragraph({ heading, children: runsFromInline(token.tokens || [{ type: 'text', text: token.text || '' }]) }));
					continue;
				}
				if (token.type === 'paragraph') {
					children.push(new Paragraph({ children: runsFromInline(token.tokens || [{ type: 'text', text: token.text || '' }]) }));
					continue;
				}
				if (token.type === 'blockquote') {
					const quoteTokens = token.tokens || [];
					for (const qt of quoteTokens) {
						if (qt.type === 'paragraph') {
							children.push(new Paragraph({ indent: { left: 720 }, children: runsFromInline(qt.tokens || [{ type: 'text', text: qt.text || '' }]) }));
						}
					}
					continue;
				}
				if (token.type === 'code') {
					const codeLines = String(token.text || '').split('\n');
					for (const line of codeLines) {
						children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
					}
					continue;
				}
				if (token.type === 'list') {
					const ordered = !!token.ordered;
					let idx = token.start || 1;
					for (const item of token.items || []) {
						const itemTokens = item.tokens || [];
						const textToken = itemTokens.find(t => t.type === 'text') || itemTokens.find(t => t.type === 'paragraph') || { type: 'text', text: item.text || '' };
						const runs = (textToken.type === 'paragraph') ? runsFromInline(textToken.tokens || [{ type: 'text', text: textToken.text || '' }]) : runsFromInline(textToken.tokens || [{ type: 'text', text: textToken.text || '' }]);
						if (ordered) {
							children.push(new Paragraph({ children: [new TextRun({ text: `${idx}. ` }), ...runs] }));
							idx++;
						} else {
							children.push(new Paragraph({ bullet: { level: 0 }, children: runs }));
						}
					}
					continue;
				}
				if (token.type === 'hr') {
					children.push(new Paragraph({ children: [new TextRun({ text: '—'.repeat(24) })] }));
					continue;
				}
				if (token.type === 'table') {
					const header = token.header || [];
					const rows = token.rows || [];
					const allRows = [header, ...rows];
					const tableRows = allRows.map((r) => new TableRow({
						children: (r || []).map((c) => new TableCell({
							children: [new Paragraph({ children: runsFromInline(c && c.tokens ? c.tokens : [{ type: 'text', text: String(c && c.text !== undefined ? c.text : c || '') }]) })]
						}))
					}));
					children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
					continue;
				}
				if (token.raw) {
					const raw = String(token.raw).trim();
					if (raw) children.push(new Paragraph({ text: raw }));
				}
			}

			if (children.length === 0) {
				throw new Error(`Cannot convert Markdown to ${format}: no content parsed from markdown`);
			}

			const doc = new Document({ sections: [{ properties: {}, children }] });
			const buffer = await Packer.toBuffer(doc);

			const MIN_DOCX_SIZE = 500;
			if (buffer.length < MIN_DOCX_SIZE && fs.existsSync(outputPath)) {
				const existingSize = fs.statSync(outputPath).size;
				if (existingSize > buffer.length) {
					throw new Error(`Markdown conversion produced suspiciously small DOCX (${buffer.length} bytes); refusing to overwrite existing file (${existingSize} bytes)`);
				}
			}

			fs.writeFileSync(outputPath, buffer);
			const stats = fs.statSync(outputPath);
			result.size = stats.size;
			return result;
		}

		if (normalizedTargetFormat === 'xlsx') {
			if (!xlsx) {
				throw new Error('xlsx library not installed. Install with: npm install xlsx');
			}
			const { marked } = await import('marked');
			const tokens = marked.lexer(mdText);
			const tables = tokens.filter(t => t && t.type === 'table');
			const workbook = xlsx.utils.book_new();

			if (tables.length > 0) {
				let tableIdx = 1;
				for (const t of tables) {
					const header = (t.header || []).map(c => (c && c.text !== undefined) ? String(c.text) : String(c || ''));
					const rows = (t.rows || []).map(r => (r || []).map(c => (c && c.text !== undefined) ? String(c.text) : String(c || '')));
					const aoa = [header, ...rows];
					const ws = xlsx.utils.aoa_to_sheet(aoa);
					xlsx.utils.book_append_sheet(workbook, ws, `Table${tableIdx}`);
					tableIdx++;
				}
			} else {
				const lines = mdText.split('\n').map(l => l.replace(/\r$/, '')).map(l => l.trim()).filter(Boolean);
				const ws = xlsx.utils.aoa_to_sheet(lines.map(l => [l]));
				xlsx.utils.book_append_sheet(workbook, ws, 'Sheet1');
			}

			xlsx.writeFile(workbook, outputPath);
			const stats = fs.statSync(outputPath);
			result.size = stats.size;
			result.sheets = workbook.SheetNames.length;
			return result;
		}
	}

	if (format === 'pdf') {
		// Convert Word/Excel to PDF
		if (ext === '.docx' || ext === '.doc') {
			const docBuffer = fs.readFileSync(inputFile);

			try {
				const { chromium } = require('playwright-core');
				const possiblePaths = [
					'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
					'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
					'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
					'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
					process.env.CHROME_PATH,
					process.env.EDGE_PATH,
				].filter(Boolean);

				let executablePath = null;
				for (const p of possiblePaths) {
					if (fs.existsSync(p)) {
						executablePath = p;
						break;
					}
				}

				if (ext === '.docx' && executablePath) {
					const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..');
					const readFirstExistingText = (candidates) => {
						for (const candidate of candidates) {
							try {
								if (candidate && fs.existsSync(candidate)) {
									return fs.readFileSync(candidate, 'utf8');
								}
							} catch (e) {
							}
						}
						return null;
					};

					const jszipCode = readFirstExistingText([
						path.join(projectRoot, 'resources', 'jszip', 'jszip.min.js'),
						path.join(projectRoot, 'node_modules', 'jszip', 'dist', 'jszip.min.js'),
					]);

					const docxPreviewCode = readFirstExistingText([
						path.join(projectRoot, 'resources', 'docx-preview', 'docx-preview.min.js'),
						path.join(projectRoot, 'node_modules', 'docx-preview', 'dist', 'docx-preview.min.js'),
						path.join(projectRoot, 'node_modules', 'docx-preview', 'dist', 'docx-preview.js'),
					]);

					if (jszipCode && docxPreviewCode) {
						const browser = await chromium.launch({ executablePath, headless: true });
						try {
							const page = await browser.newPage();
							await page.setViewportSize({ width: 1400, height: 900 });
							await page.setContent(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: 100%; background: #ffffff; }
		#container { width: 100%; }
		.docx-wrapper { background: #ffffff !important; padding: 0 !important; }
		.docx-wrapper > section.docx { background: white !important; box-shadow: none !important; margin: 0 auto !important; }
		.docx table { border-collapse: collapse !important; }
		.docx table td, .docx table th {
			border: 1px solid #000 !important;
			padding: 4px 8px !important;
			vertical-align: top !important;
		}
		.docx table tr { page-break-inside: avoid !important; }
		.docx p { line-height: 1.5 !important; }
	</style>
</head>
<body>
	<div id="container"></div>
</body>
</html>`, { waitUntil: 'domcontentloaded' });

							await page.addScriptTag({ content: jszipCode });
							await page.addScriptTag({ content: docxPreviewCode });

							const base64Docx = docBuffer.toString('base64');
							await page.evaluate(async (docxBase64) => {
								window.__DOCX_RENDER_DONE__ = false;
								window.__DOCX_RENDER_ERROR__ = null;
								try {
									const binaryString = atob(docxBase64);
									const bytes = new Uint8Array(binaryString.length);
									for (let i = 0; i < binaryString.length; i++) {
										bytes[i] = binaryString.charCodeAt(i);
									}
									const container = document.getElementById('container');
									await docx.renderAsync(bytes.buffer, container, null, {
										className: 'docx',
										inWrapper: true,
										ignoreWidth: false,
										ignoreHeight: false,
										ignoreFonts: false,
										breakPages: true,
										useBase64URL: true,
										renderHeaders: true,
										renderFooters: true,
										renderFootnotes: true,
										renderEndnotes: true
									});
								} catch (e) {
									window.__DOCX_RENDER_ERROR__ = (e && e.message) ? e.message : String(e);
								} finally {
									window.__DOCX_RENDER_DONE__ = true;
								}
							}, base64Docx);

							await page.waitForFunction(() => window.__DOCX_RENDER_DONE__ === true, { timeout: 60000 });

							const renderInfo = await page.evaluate(() => {
								return {
									error: window.__DOCX_RENDER_ERROR__ || null,
									sections: document.querySelectorAll('section.docx').length,
									tables: document.querySelectorAll('table').length,
									textLength: (document.body && document.body.innerText) ? document.body.innerText.length : 0,
								};
							});

							if (renderInfo.error) {
								throw new Error(`docx-preview render failed: ${renderInfo.error}`);
							}
							if (!renderInfo.sections || renderInfo.sections <= 0) {
								throw new Error('docx-preview render produced 0 pages (sections)');
							}

							await page.emulateMedia({ media: 'screen' });
							await page.waitForTimeout(200);

							const pdfBuffer = await page.pdf({
								format: 'A4',
								preferCSSPageSize: true,
								margin: { top: '0', bottom: '0', left: '0', right: '0' },
								printBackground: true,
							});

							const MIN_PDF_SIZE = 1000;
							if (pdfBuffer.length < MIN_PDF_SIZE) {
								if (fs.existsSync(outputPath)) {
									const existingSize = fs.statSync(outputPath).size;
									if (existingSize > pdfBuffer.length) {
										throw new Error(`docx-preview produced suspiciously small PDF (${pdfBuffer.length} bytes); refusing to overwrite existing file (${existingSize} bytes)`);
									}
								}
							}
							fs.writeFileSync(outputPath, pdfBuffer);
							const stats = fs.statSync(outputPath);
							result.size = stats.size;

							const { PDFDocument } = require('pdf-lib');
							const pdfDoc = await PDFDocument.load(pdfBuffer);
							result.pages = pdfDoc.getPageCount();
							return result;
						} finally {
							await browser.close();
						}
					}
				}
			} catch (e) {
				console.log(`[DocumentReader] ⚠️ DOCX high-fidelity conversion failed: ${e.message}, falling back to mammoth HTML conversion`);
			}

			const mammoth = require('mammoth');

			// Extract HTML from Word document
			let htmlContent = '';

			// Try mammoth first
			try {
				const htmlResult = await mammoth.convertToHtml({ buffer: docBuffer });
				htmlContent = htmlResult.value;
			} catch (e) {
				console.log(`[DocumentReader] ⚠️ Mammoth HTML failed: ${e.message}`);
			}

			// If mammoth failed or returned empty, try direct XML extraction
			if (!htmlContent || htmlContent.length === 0) {
				try {
					const JSZip = require('jszip');
					const zip = await JSZip.loadAsync(docBuffer);
					const documentXml = await zip.file('word/document.xml')?.async('string');

					if (documentXml) {
						// Parse XML to extract text with basic formatting
						const paragraphs = [];
						// Match paragraphs
						const paraMatches = documentXml.match(/<w:p[^>]*>[\s\S]*?<\/w:p>/g) || [];

						for (const paraXml of paraMatches) {
							// Extract text runs
							const textMatches = paraXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
							const paraText = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join('');

							if (paraText.trim()) {
								// Check for heading style
								const isHeading = paraXml.includes('w:pStyle') && (paraXml.includes('Heading') || paraXml.includes('标题'));
								const isBold = paraXml.includes('<w:b/>') || paraXml.includes('<w:b ');

								if (isHeading) {
									paragraphs.push(`<h2>${paraText}</h2>`);
								} else if (isBold) {
									paragraphs.push(`<p><strong>${paraText}</strong></p>`);
								} else {
									paragraphs.push(`<p>${paraText}</p>`);
								}
							}
						}

						htmlContent = paragraphs.join('\n');

					}
				} catch (e2) {
					console.log(`[DocumentReader] ⚠️ Direct XML extraction failed: ${e2.message}`);
				}
			}

			// Also try extracting raw text to compare
			let rawText = '';
			try {
				const textResult = await mammoth.extractRawText({ buffer: docBuffer });
				rawText = textResult.value;
			} catch (e) {
				console.log(`[DocumentReader] ⚠️ Raw text extraction failed: ${e.message}`);
			}

			// If we still have no HTML but have raw text, convert raw text to simple HTML
			if ((!htmlContent || htmlContent.length === 0) && rawText && rawText.length > 0) {
				const lines = rawText.split('\n').filter(l => l.trim());
				htmlContent = lines.map(line => `<p>${line}</p>`).join('\n');
			}

			const hasTable = htmlContent.includes('<table');


			// SAFETY CHECK: Refuse to create empty PDF that would overwrite original file
			if (!htmlContent || htmlContent.length === 0) {

				// Check if output would overwrite an existing file with content
				if (fs.existsSync(outputPath)) {
					const existingStats = fs.statSync(outputPath);
					console.log(`[DocumentReader]    ⚠️ Output file exists: ${existingStats.size} bytes - REFUSING to overwrite with empty PDF`);
				}

				throw new Error(`Cannot convert Word to PDF: source document "${path.basename(inputFile)}" appears to be empty or unreadable. Conversion aborted to prevent data loss.`);
			}

			// Create full HTML document with proper styling for PDF
			const fullHtml = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		@page { size: A4; margin: 20mm; }
		body {
			font-family: "Microsoft YaHei", "SimHei", "SimSun", sans-serif;
			font-size: 12pt;
			line-height: 1.6;
			color: #000;
		}
		h1 { font-size: 20pt; font-weight: bold; margin: 16pt 0 8pt 0; }
		h2 { font-size: 16pt; font-weight: bold; margin: 14pt 0 6pt 0; }
		h3 { font-size: 14pt; font-weight: bold; margin: 12pt 0 4pt 0; }
		p { margin: 6pt 0; }
		table {
			border-collapse: collapse;
			width: 100%;
			margin: 10pt 0;
		}
		th, td {
			border: 1px solid #000;
			padding: 6pt 8pt;
			text-align: left;
		}
		th {
			background-color: #f0f0f0;
			font-weight: bold;
		}
		ul, ol { margin: 6pt 0; padding-left: 20pt; }
		li { margin: 3pt 0; }
		strong, b { font-weight: bold; }
		em, i { font-style: italic; }
	</style>
</head>
<body>
${htmlContent}
</body>
</html>`;

			// Use Playwright to render HTML to PDF
			try {
				const { chromium } = require('playwright-core');

				// Try to find Chrome/Edge executable
				const possiblePaths = [
					'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
					'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
					'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
					'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
					process.env.CHROME_PATH,
					process.env.EDGE_PATH,
				].filter(Boolean);

				let executablePath = null;
				for (const p of possiblePaths) {
					if (fs.existsSync(p)) {
						executablePath = p;
						break;
					}
				}

				if (!executablePath) {
					throw new Error('Chrome or Edge browser not found');
				}

				const browser = await chromium.launch({
					executablePath,
					headless: true,
				});

				const page = await browser.newPage();

				// Set viewport to ensure proper rendering
				await page.setViewportSize({ width: 1200, height: 800 });

				await page.setContent(fullHtml, { waitUntil: 'networkidle' });

				// Debug: Check if content was loaded
				const bodyContent = await page.evaluate(() => document.body.innerText);
				if (bodyContent.length < 500) {
					console.log(`[DocumentReader] 📄 Page body text: ${bodyContent}`);
				}

				const pdfBuffer = await page.pdf({
					format: 'A4',
					margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
					printBackground: true,
				});

				await browser.close();

				// SAFETY CHECK: Verify PDF has meaningful content before writing
				const MIN_PDF_SIZE = 1000; // Minimum expected size for a PDF with content
				if (pdfBuffer.length < MIN_PDF_SIZE) {
					if (fs.existsSync(outputPath)) {
						const existingSize = fs.statSync(outputPath).size;
						if (existingSize > pdfBuffer.length) {
							throw new Error(`Conversion produced empty/minimal PDF. Original file (${existingSize} bytes) preserved to prevent data loss.`);
						}
					}
				}

				fs.writeFileSync(outputPath, pdfBuffer);
				const stats = fs.statSync(outputPath);
				result.size = stats.size;

				// Count pages from PDF
				const { PDFDocument } = require('pdf-lib');
				const pdfDoc = await PDFDocument.load(pdfBuffer);
				result.pages = pdfDoc.getPageCount();

			} catch (playwrightError) {

				// Fallback: simple text-based PDF using already extracted rawText
				const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

				// Use the rawText we already extracted earlier, or try again
				let fallbackText = rawText;
				if (!fallbackText || fallbackText.length === 0) {
					try {
						const textResult = await mammoth.extractRawText({ buffer: docBuffer });
						fallbackText = textResult.value;
					} catch (e) {
						// Try direct XML extraction
						try {
							const JSZip = require('jszip');
							const zip = await JSZip.loadAsync(docBuffer);
							const documentXml = await zip.file('word/document.xml')?.async('string');
							if (documentXml) {
								const textMatches = documentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
								fallbackText = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
							}
						} catch (e2) {
							fallbackText = '[Content extraction failed]';
						}
					}
				}

				// SAFETY CHECK: Refuse to create empty PDF in fallback mode
				if (!fallbackText || fallbackText.length === 0 || fallbackText === '[Content extraction failed]') {
					throw new Error('Cannot convert Word to PDF: all extraction methods failed. Original file preserved.');
				}

				const pdfDoc = await PDFDocument.create();
				const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

				const pageWidth = 595;
				const pageHeight = 842;
				const margin = 50;
				const fontSize = 11;
				const lineHeight = 16;
				const maxWidth = pageWidth - 2 * margin;

				let page = pdfDoc.addPage([pageWidth, pageHeight]);
				let y = pageHeight - margin;

				const paragraphs = fallbackText.split('\n').filter(p => p.trim());

				for (const para of paragraphs) {
					const words = para.split(/\s+/);
					let currentLine = '';

					for (const word of words) {
						const testLine = currentLine ? `${currentLine} ${word}` : word;
						const testWidth = font.widthOfTextAtSize(testLine, fontSize);

						if (testWidth <= maxWidth) {
							currentLine = testLine;
						} else {
							if (y < margin + lineHeight) {
								page = pdfDoc.addPage([pageWidth, pageHeight]);
								y = pageHeight - margin;
							}
							if (currentLine) {
								page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
								y -= lineHeight;
							}
							currentLine = word;
						}
					}

					if (currentLine) {
						if (y < margin + lineHeight) {
							page = pdfDoc.addPage([pageWidth, pageHeight]);
							y = pageHeight - margin;
						}
						page.drawText(currentLine, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
						y -= lineHeight * 1.5;
					}
				}

				const pdfBytes = await pdfDoc.save();

				// SAFETY CHECK: Verify fallback PDF has content before writing
				const MIN_PDF_SIZE = 1000;
				if (pdfBytes.length < MIN_PDF_SIZE) {
					if (fs.existsSync(outputPath)) {
						const existingSize = fs.statSync(outputPath).size;
						if (existingSize > pdfBytes.length) {
							throw new Error(`Fallback conversion produced empty PDF. Original file preserved.`);
						}
					}
				}

				fs.writeFileSync(outputPath, pdfBytes);
				const stats = fs.statSync(outputPath);
				result.size = stats.size;
				result.pages = pdfDoc.getPageCount();
			}
		} else if (libreConvert) {
			// Use LibreOffice for other formats (Excel, PPT)
			const inputBuffer = fs.readFileSync(inputFile);
			const pdfBuffer = await new Promise((resolve, reject) => {
				libreConvert.convert(inputBuffer, '.pdf', undefined, (err, done) => {
					if (err) reject(err);
					else resolve(done);
				});
			});
			fs.writeFileSync(outputPath, pdfBuffer);
			const stats = fs.statSync(outputPath);
			result.size = stats.size;
		} else {
			throw new Error('PDF conversion for this format requires LibreOffice. Word (.docx) files can be converted without it.');
		}
	} else if ((normalizedTargetFormat === 'docx') && ext === '.pdf') {
		// PDF to DOCX conversion with format preservation
		const pdfBuffer = fs.readFileSync(inputFile);
		let numPages = 0;
		let allPages = [];

		// Extract structured content from PDF using pdfjs-dist
		if (pdfjsLib) {
			try {
				const uint8Array = new Uint8Array(pdfBuffer);
				const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
				const pdf = await loadingTask.promise;
				numPages = pdf.numPages;

				for (let i = 1; i <= pdf.numPages; i++) {
					const page = await pdf.getPage(i);
					const content = await page.getTextContent();
					const viewport = page.getViewport({ scale: 1.0 });

					// Group text items by Y position (lines)
					const lines = [];
					let currentLine = { y: null, items: [] };
					const lineThreshold = 5; // pixels tolerance for same line

					// Sort items by Y (top to bottom), then X (left to right)
					const sortedItems = content.items
						.filter(item => item.str && item.str.trim())
						.sort((a, b) => {
							const yA = viewport.height - a.transform[5];
							const yB = viewport.height - b.transform[5];
							if (Math.abs(yA - yB) < lineThreshold) {
								return a.transform[4] - b.transform[4]; // Sort by X
							}
							return yA - yB; // Sort by Y
						});

					for (const item of sortedItems) {
						const y = viewport.height - item.transform[5];
						const x = item.transform[4];
						const fontSize = Math.abs(item.transform[0]) || 12;

						if (currentLine.y === null || Math.abs(y - currentLine.y) > lineThreshold) {
							// New line
							if (currentLine.items.length > 0) {
								lines.push(currentLine);
							}
							currentLine = { y, items: [], fontSize, x };
						}
						currentLine.items.push({
							text: item.str,
							x,
							fontSize,
							fontName: item.fontName || ''
						});
					}
					if (currentLine.items.length > 0) {
						lines.push(currentLine);
					}

					allPages.push({ pageNum: i, lines, width: viewport.width, height: viewport.height });
				}
			} catch (err) {
				console.error(`[DocumentReader] ❌ pdfjs-dist extraction error:`, err.message);
			}
		}

		if (allPages.length === 0) {
			throw new Error('Failed to extract content from PDF. No PDF parser available or PDF content is empty.');
		}

		// Create DOCX with preserved formatting
		const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, AlignmentType } = require('docx');

		const docChildren = [];

		for (const page of allPages) {
			// Analyze page structure to detect tables
			const tableLines = [];
			const textLines = [];

			// Simple table detection: lines with multiple items at regular X intervals
			for (const line of page.lines) {
				if (line.items.length >= 2) {
					// Check if items are evenly spaced (table-like)
					const xPositions = line.items.map(item => item.x);
					const gaps = [];
					for (let i = 1; i < xPositions.length; i++) {
						gaps.push(xPositions[i] - xPositions[i - 1]);
					}
					// If we have consistent gaps, it might be a table row
					if (gaps.length > 0) {
						const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
						const isTableLike = gaps.every(g => Math.abs(g - avgGap) < avgGap * 0.5) && avgGap > 30;
						if (isTableLike && line.items.length >= 2) {
							tableLines.push(line);
							continue;
						}
					}
				}
				textLines.push(line);
			}

			// Process table lines first (group consecutive table lines)
			let tableBuffer = [];
			const processedLines = [];

			for (const line of page.lines) {
				const isTable = tableLines.includes(line);
				if (isTable) {
					tableBuffer.push(line);
				} else {
					if (tableBuffer.length > 0) {
						processedLines.push({ type: 'table', lines: tableBuffer });
						tableBuffer = [];
					}
					processedLines.push({ type: 'text', line });
				}
			}
			if (tableBuffer.length > 0) {
				processedLines.push({ type: 'table', lines: tableBuffer });
			}

			// Convert to DOCX elements
			for (const item of processedLines) {
				if (item.type === 'table' && item.lines.length >= 2) {
					// Create table
					const maxCols = Math.max(...item.lines.map(l => l.items.length));
					const tableRows = item.lines.map(line => {
						const cells = [];
						for (let i = 0; i < maxCols; i++) {
							const cellText = line.items[i]?.text || '';
							cells.push(new TableCell({
								children: [new Paragraph({ children: [new TextRun(cellText)] })],
								width: { size: Math.floor(100 / maxCols), type: WidthType.PERCENTAGE }
							}));
						}
						return new TableRow({ children: cells });
					});

					docChildren.push(new Table({
						rows: tableRows,
						width: { size: 100, type: WidthType.PERCENTAGE }
					}));
					docChildren.push(new Paragraph({ children: [] })); // Spacing after table
				} else if (item.type === 'text') {
					const line = item.line;
					const lineText = line.items.map(i => i.text).join(' ');
					const avgFontSize = line.items.reduce((sum, i) => sum + i.fontSize, 0) / line.items.length;

					// Detect heading based on font size
					let headingLevel = null;
					if (avgFontSize >= 18) headingLevel = HeadingLevel.HEADING_1;
					else if (avgFontSize >= 14) headingLevel = HeadingLevel.HEADING_2;
					else if (avgFontSize >= 12.5) headingLevel = HeadingLevel.HEADING_3;

					// Detect bold from font name
					const isBold = line.items.some(i => i.fontName && (i.fontName.toLowerCase().includes('bold') || i.fontName.toLowerCase().includes('heavy')));

					const para = new Paragraph({
						children: [new TextRun({
							text: lineText,
							bold: isBold || headingLevel !== null,
							size: Math.round(avgFontSize * 2) // Convert to half-points
						})],
						heading: headingLevel,
						alignment: line.x > page.width * 0.4 ? AlignmentType.CENTER : AlignmentType.LEFT
					});
					docChildren.push(para);
				}
			}

			// Add page break between pages (except last page)
			if (page.pageNum < numPages) {
				docChildren.push(new Paragraph({
					children: [],
					pageBreakBefore: true
				}));
			}
		}

		const doc = new Document({
			sections: [{
				properties: {},
				children: docChildren
			}]
		});

		const buffer = await Packer.toBuffer(doc);
		const MIN_DOCX_SIZE = 500;
		if (buffer.length < MIN_DOCX_SIZE && fs.existsSync(outputPath)) {
			const existingSize = fs.statSync(outputPath).size;
			if (existingSize > buffer.length) {
				throw new Error(`PDF conversion produced suspiciously small DOCX (${buffer.length} bytes); refusing to overwrite existing file (${existingSize} bytes)`);
			}
		}
		fs.writeFileSync(outputPath, buffer);
		const stats = fs.statSync(outputPath);
		result.size = stats.size;
		result.pages = numPages;
	} else if (format === 'images') {
		// Convert document pages to images
		result.images = [];
		// For now, return a placeholder - full implementation would require additional libraries
		result.success = true;
		result.images = [];
	} else {
		throw new Error(`Unsupported conversion: ${sourceFormat} to ${format}`);
	}

	return result;
}

/**
 * Merge multiple documents of the same type
 */
async function mergeDocuments(inputFiles, outputPath, options = {}) {
	if (!inputFiles || inputFiles.length < 2) {
		throw new Error('At least 2 files are required for merging');
	}

	const ext = path.extname(inputFiles[0]).toLowerCase();
	const outputDir = path.dirname(outputPath);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	let result = {
		success: true,
		outputPath,
		mergedFiles: inputFiles.length,
		fileType: ext.replace('.', '')
	};

	if (ext === '.docx') {
		// Merge Word documents
		const { Document, Packer, Paragraph, TextRun, PageBreak } = require('docx');
		const allParagraphs = [];

		for (let i = 0; i < inputFiles.length; i++) {
			if (mammoth) {
				const docResult = await mammoth.extractRawText({ path: inputFiles[i] });
				const lines = docResult.value.split('\n').filter(line => line.trim());

				if (i > 0) {
					allParagraphs.push(new Paragraph({ children: [new PageBreak()] }));
				}

				for (const line of lines) {
					allParagraphs.push(new Paragraph({ children: [new TextRun(line)] }));
				}
			}
		}

		const doc = new Document({
			sections: [{ properties: {}, children: allParagraphs }]
		});
		const buffer = await Packer.toBuffer(doc);
		fs.writeFileSync(outputPath, buffer);

	} else if (ext === '.xlsx' || ext === '.xls') {
		// Merge Excel files into different sheets
		if (xlsx) {
			const workbook = xlsx.utils.book_new();

			for (let i = 0; i < inputFiles.length; i++) {
				const wb = xlsx.readFile(inputFiles[i]);
				const sheetName = wb.SheetNames[0] || `Sheet${i + 1}`;
				const sheet = wb.Sheets[sheetName];
				xlsx.utils.book_append_sheet(workbook, sheet, `File${i + 1}_${sheetName}`.substring(0, 31));
			}

			xlsx.writeFile(workbook, outputPath);
		} else {
			throw new Error('Excel merge requires xlsx library');
		}

	} else if (ext === '.pdf') {
		// Merge PDF files
		const { PDFDocument } = require('pdf-lib');
		const mergedPdf = await PDFDocument.create();

		for (const file of inputFiles) {
			const pdfBytes = fs.readFileSync(file);
			const pdf = await PDFDocument.load(pdfBytes);
			const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
			copiedPages.forEach(page => mergedPdf.addPage(page));
		}

		const mergedPdfBytes = await mergedPdf.save();
		fs.writeFileSync(outputPath, mergedPdfBytes);

	} else {
		throw new Error(`Unsupported file type for merging: ${ext}`);
	}

	const stats = fs.statSync(outputPath);
	result.size = stats.size;
	return result;
}

/**
 * Extract content from documents (images, text, slides)
 */
async function extractContent(inputFile, outputDir, extractType, options = {}) {
	const ext = path.extname(inputFile).toLowerCase();

	// Ensure output directory exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	let result = {
		success: true,
		inputFile,
		outputDir,
		extractType,
		extractedCount: 0,
		files: []
	};

	if (extractType === 'images') {
		if (ext === '.docx') {
			// Extract images from Word document
			const AdmZip = require('adm-zip');
			const zip = new AdmZip(inputFile);
			const zipEntries = zip.getEntries();

			for (const entry of zipEntries) {
				if (entry.entryName.startsWith('word/media/')) {
					const fileName = path.basename(entry.entryName);
					const outputFile = path.join(outputDir, fileName);
					fs.writeFileSync(outputFile, entry.getData());
					result.files.push(outputFile);
					result.extractedCount++;
				}
			}
		} else if (ext === '.pdf') {
			// For PDF image extraction, would need additional libraries
			console.log('[DocumentReader] PDF image extraction requires additional setup');
		}

	} else if (extractType === 'text') {
		const baseName = path.basename(inputFile, ext);
		const outputFile = path.join(outputDir, `${baseName}.txt`);

		if (ext === '.pdf' && pdfParse) {
			const pdfBuffer = fs.readFileSync(inputFile);
			const pdfData = await pdfParse(pdfBuffer);
			fs.writeFileSync(outputFile, pdfData.text);
			result.files.push(outputFile);
			result.extractedCount = 1;
		} else if (ext === '.docx' && mammoth) {
			const docResult = await mammoth.extractRawText({ path: inputFile });
			fs.writeFileSync(outputFile, docResult.value);
			result.files.push(outputFile);
			result.extractedCount = 1;
		}

	} else if (extractType === 'slides') {
		// Extract slides as images would require additional libraries
		console.log('[DocumentReader] Slide extraction requires additional setup');
	}

	return result;
}

/**
 * Create HTTP server
 */
function createServer() {
	const server = http.createServer(async (req, res) => {
		// CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		// Handle GET requests for serving PDF files and static assets
		if (req.method === 'GET') {
			const url = new URL(req.url, `http://localhost`);
			const pathname = url.pathname;

			// Serve cached PDF file
			if (pathname.startsWith('/pdf/')) {
				const pdfId = pathname.substring(5);
				const pdfData = pdfCache.get(pdfId);
				if (pdfData) {
					res.writeHead(200, {
						'Content-Type': 'application/pdf',
						'Content-Length': pdfData.length
					});
					res.end(pdfData);
					return;
				} else {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'PDF not found' }));
					return;
				}
			}

			// Serve PDF.js library files from resources/pdfjs or node_modules
			if (pathname.startsWith('/pdfjs/')) {
				const fileName = pathname.substring(7);
				// __dirname is out/vs/workbench/contrib/senweaver/browser, need 6 levels up to project root
				const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..');
				const pdfjsDir = path.join(projectRoot, 'resources', 'pdfjs');
				const nodeModulesDir = path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'build');

				// Map .js to .mjs for node_modules
				const mjsFileName = fileName.replace('.min.js', '.min.mjs');

				let filePath = path.join(pdfjsDir, fileName);
				let isMjs = false;

				// Check if file exists in resources/pdfjs
				if (!fs.existsSync(filePath)) {
					// Try node_modules with .mjs extension
					filePath = path.join(nodeModulesDir, mjsFileName);
					isMjs = true;
				}

				try {
					if (fs.existsSync(filePath)) {
						const content = fs.readFileSync(filePath);
						// Use correct MIME type for ES modules
						const contentType = (isMjs || fileName.endsWith('.mjs')) ? 'application/javascript' : 'application/javascript';
						res.writeHead(200, {
							'Content-Type': contentType,
							'Content-Length': content.length
						});
						res.end(content);
						return;
					}
				} catch (e) {
					console.error('[DocumentReader] Error serving pdfjs file:', e.message);
				}

				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'File not found' }));
				return;
			}

			// Serve docx-preview library files from resources/docx-preview or node_modules
			if (pathname.startsWith('/docx-preview/')) {
				const fileName = pathname.substring(14);
				const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..');
				const docxPreviewDir = path.join(projectRoot, 'resources', 'docx-preview');
				const nodeModulesDir = path.join(projectRoot, 'node_modules', 'docx-preview', 'dist');

				let filePath = path.join(docxPreviewDir, fileName);

				// Check if file exists in resources/docx-preview
				if (!fs.existsSync(filePath)) {
					// Try node_modules
					filePath = path.join(nodeModulesDir, fileName);
				}

				try {
					if (fs.existsSync(filePath)) {
						const content = fs.readFileSync(filePath);
						res.writeHead(200, {
							'Content-Type': 'application/javascript',
							'Content-Length': content.length
						});
						res.end(content);
						return;
					}
				} catch (e) {
					console.error('[DocumentReader] Error serving docx-preview file:', e.message);
				}

				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'File not found' }));
				return;
			}

			// Serve xlsx (SheetJS) library files from resources/xlsx or node_modules
			if (pathname.startsWith('/xlsx/')) {
				const fileName = pathname.substring(6);
				const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..');
				const xlsxDir = path.join(projectRoot, 'resources', 'xlsx');
				const nodeModulesDir = path.join(projectRoot, 'node_modules', 'xlsx', 'dist');

				let filePath = path.join(xlsxDir, fileName);

				if (!fs.existsSync(filePath)) {
					filePath = path.join(nodeModulesDir, fileName);
				}

				try {
					if (fs.existsSync(filePath)) {
						const content = fs.readFileSync(filePath);
						res.writeHead(200, {
							'Content-Type': 'application/javascript',
							'Content-Length': content.length
						});
						res.end(content);
						return;
					}
				} catch (e) {
					console.error('[DocumentReader] Error serving xlsx file:', e.message);
				}

				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'File not found' }));
				return;
			}

			// Serve jszip library files from resources/jszip or node_modules
			if (pathname.startsWith('/jszip/')) {
				const fileName = pathname.substring(7);
				const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..', '..');
				const jszipDir = path.join(projectRoot, 'resources', 'jszip');
				const nodeModulesDir = path.join(projectRoot, 'node_modules', 'jszip', 'dist');

				let filePath = path.join(jszipDir, fileName);

				if (!fs.existsSync(filePath)) {
					filePath = path.join(nodeModulesDir, fileName);
				}

				try {
					if (fs.existsSync(filePath)) {
						const content = fs.readFileSync(filePath);
						res.writeHead(200, {
							'Content-Type': 'application/javascript',
							'Content-Length': content.length
						});
						res.end(content);
						return;
					}
				} catch (e) {
					console.error('[DocumentReader] Error serving jszip file:', e.message);
				}

				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'File not found' }));
				return;
			}

			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found' }));
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed' }));
			return;
		}

		// Parse URL to determine action
		const url = new URL(req.url, `http://localhost`);
		const action = url.pathname;

		let body = '';
		req.on('data', chunk => {
			body += chunk.toString();
			if (body.length > 10 * 1024 * 1024) { // 10MB limit for request body
				req.destroy();
			}
		});

		req.on('end', async () => {
			try {
				const data = JSON.parse(body);

				// Route to appropriate handler based on action
				if (action === '/write' || action === '/edit') {
					// Write/Edit document
					const { file_path, options } = data;
					let content = data.content;

					if (!file_path) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'file_path is required' }));
						return;
					}

					if (content === undefined || content === null) {
						// For replacement mode, empty content is OK — we'll read the original
						if (!options || !options.replacements) {
							res.writeHead(400, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ error: 'content is required' }));
							return;
						}
						content = '';
					}

					const result = await writeDocument(file_path, content, options || {});


					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/merge-pdf') {
					// Merge PDF files
					const { input_files, output_path } = data;
					if (!input_files || !output_path) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_files and output_path are required' }));
						return;
					}

					const result = await mergePdfFiles(input_files, output_path);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/split-pdf') {
					// Split PDF file
					const { input_file, output_dir, options } = data;
					if (!input_file || !output_dir) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_file and output_dir are required' }));
						return;
					}

					const result = await splitPdfFile(input_file, output_dir, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/watermark-pdf') {
					// Add watermark to PDF
					const { input_file, output_file, watermark_text, options } = data;
					if (!input_file || !output_file || !watermark_text) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_file, output_file and watermark_text are required' }));
						return;
					}

					const result = await addPdfWatermark(input_file, output_file, watermark_text, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/create-word') {
					// Create professional Word document
					const { file_path, document_data, options } = data;
					if (!file_path || !document_data) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'file_path and document_data are required' }));
						return;
					}
					const result = await createProfessionalWord(file_path, document_data, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/create-excel') {
					// Create professional Excel workbook
					const { file_path, workbook_data, options } = data;
					if (!file_path || !workbook_data) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'file_path and workbook_data are required' }));
						return;
					}
					const result = await createProfessionalExcel(file_path, workbook_data, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/create-ppt') {
					// Create professional PowerPoint presentation
					const { file_path, presentation_data, options } = data;
					if (!file_path || !presentation_data) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'file_path and presentation_data are required' }));
						return;
					}
					const result = await createProfessionalPPT(file_path, presentation_data, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/convert-document') {
					// Convert document between formats
					const { input_file, output_path, format, options } = data;
					if (!input_file || !output_path || !format) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_file, output_path and format are required' }));
						return;
					}
					const result = await convertDocument(input_file, output_path, format, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/merge-documents') {
					// Merge multiple documents
					const { input_files, output_path, options } = data;
					if (!input_files || !output_path) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_files and output_path are required' }));
						return;
					}
					const result = await mergeDocuments(input_files, output_path, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else if (action === '/extract-content') {
					// Extract content from document
					const { input_file, output_dir, extract_type, options } = data;
					if (!input_file || !output_dir || !extract_type) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'input_file, output_dir and extract_type are required' }));
						return;
					}
					const result = await extractContent(input_file, output_dir, extract_type, options || {});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));

				} else {
					// Default: Read document (original functionality)
					const { file_path, start_index, max_length } = data;

					if (!file_path) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'file_path is required' }));
						return;
					}


					const result = await readDocument(file_path, {
						startIndex: start_index || 0,
						maxLength: max_length || 50000
					});

					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(result));
				}
			} catch (error) {
				console.error(`[DocumentReader] ❌ Error:`, error.message);
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					error: error.message,
					suggestion: getSuggestion(error.message)
				}));
			}
		});
	});

	return server;
}

/**
 * Get helpful suggestions based on error
 */
function getSuggestion(errorMessage) {
	if (errorMessage.includes('mammoth')) {
		return 'To read Word documents, install: npm install mammoth';
	}
	if (errorMessage.includes('pdf-parse')) {
		return 'To read PDF documents, install: npm install pdf-parse';
	}
	if (errorMessage.includes('xlsx')) {
		return 'To read Excel files, install: npm install xlsx';
	}
	if (errorMessage.includes('pptx')) {
		return 'To read PowerPoint files, install: npm install pptx-parser (optional)';
	}
	return null;
}

/**
 * Get port file path for IPC
 */
function getPortFilePath() {
	return path.join(os.tmpdir(), 'senweaver-document-reader-port.txt');
}

/**
 * Write actual port to file for other processes to read
 */
function writePortFile(port) {
	try {
		const portFile = getPortFilePath();
		fs.writeFileSync(portFile, String(port), 'utf8');
	} catch (e) {
		console.error(`[DocumentReader] ⚠️ Failed to write port file: ${e.message}`);
	}
}

/**
 * Delete port file on cleanup
 */
function deletePortFile() {
	try {
		const portFile = getPortFilePath();
		if (fs.existsSync(portFile)) {
			fs.unlinkSync(portFile);
		}
	} catch (e) {
		// Ignore cleanup errors
	}
}

// Global server reference for cleanup
let serverInstance = null;

/**
 * Cleanup function
 */
function cleanup() {
	deletePortFile();
	if (serverInstance) {
		serverInstance.close(() => {
			process.exit(0);
		});
	} else {
		process.exit(0);
	}
}

/**
 * Start server with dynamic port allocation
 * Consistent with other backend services (open_browser, screenshot_to_code, etc.)
 */
function startServer(startPort = DEFAULT_PORT) {
	const server = createServer();
	serverInstance = server;

	// Try to listen on the specified port, with automatic fallback to next available port
	let currentPort = startPort;
	const maxAttempts = 20; // Try up to 20 ports

	const tryListen = (attempt = 0) => {
		if (attempt >= maxAttempts) {
			console.error(`[DocumentReader] ❌ Failed to find an available port after ${maxAttempts} attempts (ports ${startPort}-${currentPort})`);
			process.exit(1);
			return;
		}

		server.listen(currentPort, () => {
			// Store the actual port for reference
			server.actualPort = currentPort;

			// Output port in a parseable format for main.ts to capture


			// Write port to file for toolsService to read
			writePortFile(currentPort);

		});

		server.once('error', (error) => {
			if (error.code === 'EADDRINUSE') {
				currentPort++;
				// Remove all listeners to avoid multiple error handlers
				server.removeAllListeners('error');
				// Try next port
				tryListen(attempt + 1);
			} else {
				console.error(`[DocumentReader] ❌ Server error: ${error.message}`);
				process.exit(1);
			}
		});
	};

	tryListen();

	// Cleanup on SIGTERM (from main process)
	process.on('SIGTERM', () => {
		cleanup();
	});

	// Cleanup on SIGINT (Ctrl+C)
	process.on('SIGINT', () => {
		cleanup();
	});

	// Cleanup on uncaught exception
	process.on('uncaughtException', (error) => {
		console.error('[DocumentReader] 💥 Uncaught exception:', error);
		cleanup();
	});

	// Cleanup on unhandled rejection
	process.on('unhandledRejection', (reason, promise) => {
		console.error('[DocumentReader] 💥 Unhandled rejection:', reason);
	});

	return server;
}

// Export for testing
module.exports = { readDocument, getFileType, createServer, startServer, getPortFilePath, DEFAULT_PORT };

// Run if executed directly
if (require.main === module) {
	const port = parseInt(process.argv[2]) || DEFAULT_PORT;
	startServer(port);
}
