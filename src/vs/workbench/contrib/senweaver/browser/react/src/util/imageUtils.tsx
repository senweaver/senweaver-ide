import React from 'react';
import { ImageAttachment, ImageUploadStatus } from '../../../../common/chatThreadServiceTypes.js';

// 图片上传API配置（从 product.json 加载）
interface ImageApiConfig {
	apiBaseUrl: string;
	secretKey: string;
}

// 默认配置（如果未初始化则使用默认值）
let imageApiConfig: ImageApiConfig = {
	apiBaseUrl: 'https://ide-api.senweaver.com',
	secretKey: ''
};

// 初始化图片上传配置（由外部调用，传入 product.json 中的配置）
export function initImageApiConfig(config: { apiBaseUrl?: string; secretKey?: string }) {
	if (config.apiBaseUrl) {
		imageApiConfig.apiBaseUrl = config.apiBaseUrl;
	}
	if (config.secretKey) {
		imageApiConfig.secretKey = config.secretKey;
	}
}

// 获取图片上传 URL
function getImageUploadBaseUrl(): string {
	return `${imageApiConfig.apiBaseUrl}/api/upload/image`;
}

// 获取密钥
function getSecretKey(): string {
	return imageApiConfig.secretKey;
}

// MD5 哈希函数
function md5(string: string): string {
	function md5cycle(x: number[], k: number[]) {
		let a = x[0], b = x[1], c = x[2], d = x[3];
		a = ff(a, b, c, d, k[0], 7, -680876936);
		d = ff(d, a, b, c, k[1], 12, -389564586);
		c = ff(c, d, a, b, k[2], 17, 606105819);
		b = ff(b, c, d, a, k[3], 22, -1044525330);
		a = ff(a, b, c, d, k[4], 7, -176418897);
		d = ff(d, a, b, c, k[5], 12, 1200080426);
		c = ff(c, d, a, b, k[6], 17, -1473231341);
		b = ff(b, c, d, a, k[7], 22, -45705983);
		a = ff(a, b, c, d, k[8], 7, 1770035416);
		d = ff(d, a, b, c, k[9], 12, -1958414417);
		c = ff(c, d, a, b, k[10], 17, -42063);
		b = ff(b, c, d, a, k[11], 22, -1990404162);
		a = ff(a, b, c, d, k[12], 7, 1804603682);
		d = ff(d, a, b, c, k[13], 12, -40341101);
		c = ff(c, d, a, b, k[14], 17, -1502002290);
		b = ff(b, c, d, a, k[15], 22, 1236535329);
		a = gg(a, b, c, d, k[1], 5, -165796510);
		d = gg(d, a, b, c, k[6], 9, -1069501632);
		c = gg(c, d, a, b, k[11], 14, 643717713);
		b = gg(b, c, d, a, k[0], 20, -373897302);
		a = gg(a, b, c, d, k[5], 5, -701558691);
		d = gg(d, a, b, c, k[10], 9, 38016083);
		c = gg(c, d, a, b, k[15], 14, -660478335);
		b = gg(b, c, d, a, k[4], 20, -405537848);
		a = gg(a, b, c, d, k[9], 5, 568446438);
		d = gg(d, a, b, c, k[14], 9, -1019803690);
		c = gg(c, d, a, b, k[3], 14, -187363961);
		b = gg(b, c, d, a, k[8], 20, 1163531501);
		a = gg(a, b, c, d, k[13], 5, -1444681467);
		d = gg(d, a, b, c, k[2], 9, -51403784);
		c = gg(c, d, a, b, k[7], 14, 1735328473);
		b = gg(b, c, d, a, k[12], 20, -1926607734);
		a = hh(a, b, c, d, k[5], 4, -378558);
		d = hh(d, a, b, c, k[8], 11, -2022574463);
		c = hh(c, d, a, b, k[11], 16, 1839030562);
		b = hh(b, c, d, a, k[14], 23, -35309556);
		a = hh(a, b, c, d, k[1], 4, -1530992060);
		d = hh(d, a, b, c, k[4], 11, 1272893353);
		c = hh(c, d, a, b, k[7], 16, -155497632);
		b = hh(b, c, d, a, k[10], 23, -1094730640);
		a = hh(a, b, c, d, k[13], 4, 681279174);
		d = hh(d, a, b, c, k[0], 11, -358537222);
		c = hh(c, d, a, b, k[3], 16, -722521979);
		b = hh(b, c, d, a, k[6], 23, 76029189);
		a = hh(a, b, c, d, k[9], 4, -640364487);
		d = hh(d, a, b, c, k[12], 11, -421815835);
		c = hh(c, d, a, b, k[15], 16, 530742520);
		b = hh(b, c, d, a, k[2], 23, -995338651);
		a = ii(a, b, c, d, k[0], 6, -198630844);
		d = ii(d, a, b, c, k[7], 10, 1126891415);
		c = ii(c, d, a, b, k[14], 15, -1416354905);
		b = ii(b, c, d, a, k[5], 21, -57434055);
		a = ii(a, b, c, d, k[12], 6, 1700485571);
		d = ii(d, a, b, c, k[3], 10, -1894986606);
		c = ii(c, d, a, b, k[10], 15, -1051523);
		b = ii(b, c, d, a, k[1], 21, -2054922799);
		a = ii(a, b, c, d, k[8], 6, 1873313359);
		d = ii(d, a, b, c, k[15], 10, -30611744);
		c = ii(c, d, a, b, k[6], 15, -1560198380);
		b = ii(b, c, d, a, k[13], 21, 1309151649);
		a = ii(a, b, c, d, k[4], 6, -145523070);
		d = ii(d, a, b, c, k[11], 10, -1120210379);
		c = ii(c, d, a, b, k[2], 15, 718787259);
		b = ii(b, c, d, a, k[9], 21, -343485551);
		x[0] = add32(a, x[0]);
		x[1] = add32(b, x[1]);
		x[2] = add32(c, x[2]);
		x[3] = add32(d, x[3]);
	}
	function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
		a = add32(add32(a, q), add32(x, t));
		return add32((a << s) | (a >>> (32 - s)), b);
	}
	function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn((b & c) | ((~b) & d), a, b, x, s, t);
	}
	function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn((b & d) | (c & (~d)), a, b, x, s, t);
	}
	function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn(b ^ c ^ d, a, b, x, s, t);
	}
	function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
		return cmn(c ^ (b | (~d)), a, b, x, s, t);
	}
	function md51(s: string) {
		const n = s.length;
		const state = [1732584193, -271733879, -1732584194, 271733878];
		let i;
		for (i = 64; i <= s.length; i += 64) {
			md5cycle(state, md5blk(s.substring(i - 64, i)));
		}
		s = s.substring(i - 64);
		const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		for (i = 0; i < s.length; i++)
			tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
		tail[i >> 2] |= 0x80 << ((i % 4) << 3);
		if (i > 55) {
			md5cycle(state, tail);
			for (i = 0; i < 16; i++) tail[i] = 0;
		}
		tail[14] = n * 8;
		md5cycle(state, tail);
		return state;
	}
	function md5blk(s: string) {
		const md5blks = [];
		for (let i = 0; i < 64; i += 4) {
			md5blks[i >> 2] = s.charCodeAt(i)
				+ (s.charCodeAt(i + 1) << 8)
				+ (s.charCodeAt(i + 2) << 16)
				+ (s.charCodeAt(i + 3) << 24);
		}
		return md5blks;
	}
	const hex_chr = '0123456789abcdef'.split('');
	function rhex(n: number) {
		let s = '';
		for (let j = 0; j < 4; j++)
			s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
		return s;
	}
	function hex(x: number[]) {
		for (let i = 0; i < x.length; i++)
			x[i] = rhex(x[i]) as unknown as number;
		return (x as unknown as string[]).join('');
	}
	function add32(a: number, b: number) {
		return (a + b) & 0xFFFFFFFF;
	}
	return hex(md51(string));
}

// 生成简单的UUID
function simpleUuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

// 获取或生成用户ID（与SenweaverOnlineConfigContribution.ts保持一致）
function getUserId(): string {
	const storageKey = 'senweaver.user.id';
	let userId = localStorage.getItem(storageKey);

	if (!userId) {
		// 检测平台
		const platform = navigator.platform.toLowerCase();
		const platformType = platform.includes('win') ? 'win' : platform.includes('mac') ? 'mac' : platform.includes('linux') ? 'linux' : 'unknown';

		const systemInfo = {
			platform: platformType,
			language: navigator.language,
			screenRes: `${window.screen.width}x${window.screen.height}`,
			random: Math.random()
		};
		const baseId = simpleUuid();
		const hash = btoa(JSON.stringify(systemInfo)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
		userId = `${baseId.substring(0, 8)}-${hash}`;
		localStorage.setItem(storageKey, userId);
	}

	return userId;
}

// 生成带签名的上传URL
// URL格式: https://ide-api.senweaver.com/api/upload/image?user_id=<user_id>&timestamp=<10位秒级时间戳>&sn=<md5>
// sn计算规则: md5(timestamp + secretKey + user_id)
function getUploadUrl(): string {
	const timestamp = Math.floor(Date.now() / 1000).toString(); // 10位时间戳
	const userId = getUserId();
	const rawString = timestamp + getSecretKey() + userId;
	const sn = md5(rawString);
	return `${getImageUploadBaseUrl()}?user_id=${encodeURIComponent(userId)}&timestamp=${timestamp}&sn=${sn}`;
}

// 将base64字符串转换为Blob（不使用fetch，避免CSP问题）
function base64ToBlob(base64Data: string, mimeType: string): Blob {
	const byteCharacters = atob(base64Data);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const byteArray = new Uint8Array(byteNumbers);
	return new Blob([byteArray], { type: mimeType });
}

// 上传单个图片到服务器
export const uploadImageToServer = async (image: ImageAttachment): Promise<{ url: string } | { error: string }> => {
	try {
		// 检查base64Data是否存在
		if (!image.base64Data) {
			// 如果已经有uploadedUrl，说明已上传成功，直接返回
			if (image.uploadedUrl) {
				return { url: image.uploadedUrl };
			}
			return { error: '图片数据不存在，无法上传' };
		}

		// 将base64转换为Blob（使用纯JS方式，避免CSP限制）
		const blob = base64ToBlob(image.base64Data, image.mimeType);

		// 创建FormData
		const formData = new FormData();
		formData.append('file', blob, image.name);

		// 获取带签名的上传URL
		const uploadUrl = getUploadUrl();

		// 上传到服务器
		const response = await fetch(uploadUrl, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`上传失败: ${response.status} ${response.statusText}`);
		}

		const result = await response.json();

		// 假设服务器返回 { url: "https://..." } 格式
		if (result.url) {
			return { url: result.url };
		} else if (result.data?.url) {
			return { url: result.data.url };
		} else {
			throw new Error('服务器返回的数据格式不正确');
		}
	} catch (error) {
		console.error('[uploadImageToServer] 上传图片失败:', error);
		return { error: error instanceof Error ? error.message : '上传失败' };
	}
};

// 批量上传图片并更新状态
export const uploadImagesWithProgress = async (
	images: ImageAttachment[],
	onProgress: (updatedImages: ImageAttachment[]) => void
): Promise<ImageAttachment[]> => {
	// 首先将所有图片标记为上传中
	const uploadingImages = images.map(img => ({
		...img,
		uploadStatus: 'uploading' as ImageUploadStatus,
	}));
	onProgress(uploadingImages);

	// 并行上传所有图片
	const uploadPromises = images.map(async (image, index) => {
		const result = await uploadImageToServer(image);

		if ('url' in result) {
			return {
				...image,
				uploadStatus: 'uploaded' as ImageUploadStatus,
				uploadedUrl: result.url,
				uploadError: undefined,
			};
		} else {
			return {
				...image,
				uploadStatus: 'error' as ImageUploadStatus,
				uploadError: result.error,
			};
		}
	});

	const uploadedImages = await Promise.all(uploadPromises);
	onProgress(uploadedImages);

	return uploadedImages;
};

// Image preview component with upload status
export const ImagePreview = ({ image, onRemove }: { image: ImageAttachment, onRemove: () => void }) => {
	const isUploading = image.uploadStatus === 'uploading';
	const isUploaded = image.uploadStatus === 'uploaded';
	const hasError = image.uploadStatus === 'error';

	// 优先使用已上传的URL，否则使用base64预览
	const imageSrc = image.uploadedUrl || (image.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : '');

	return (
		<div className="relative inline-block m-1 border border-senweaver-border-2 rounded-md overflow-hidden">
			<img
				src={imageSrc}
				alt={image.name}
				className={`w-20 h-20 object-cover ${isUploading ? 'opacity-50' : ''}`}
			/>
			{/* 上传中状态 - 旋转圆圈 */}
			{isUploading && (
				<div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
					<div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
				</div>
			)}
			{/* 上传成功状态 - 绿色勾选 */}
			{isUploaded && (
				<div className="absolute top-1 left-1 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
					✓
				</div>
			)}
			{/* 上传失败状态 - 红色警告 */}
			{hasError && (
				<div className="absolute top-1 left-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs" title={image.uploadError}>
					!
				</div>
			)}
			<button
				onClick={onRemove}
				className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
				disabled={isUploading}
			>
				×
			</button>
			<div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate">
				{image.name}
			</div>
		</div>
	);
};

// Utility function to convert file to base64
export const fileToBase64 = (file: File): Promise<string> => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// Remove data URL prefix to get just the base64 data
			const base64Data = result.split(',')[1];
			resolve(base64Data);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
};

// Utility function to get image dimensions
export const getImageDimensions = (file: File): Promise<{ width: number, height: number }> => {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			resolve({ width: img.width, height: img.height });
		};
		img.src = URL.createObjectURL(file);
	});
};

// Utility function to compress image if needed
export const compressImage = (file: File, maxWidth: number = 1024, maxHeight: number = 1024, quality: number = 0.8): Promise<File> => {
	return new Promise((resolve) => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		const img = new Image();

		img.onload = () => {
			// Calculate new dimensions
			let { width, height } = img;

			if (width > height) {
				if (width > maxWidth) {
					height = (height * maxWidth) / width;
					width = maxWidth;
				}
			} else {
				if (height > maxHeight) {
					width = (width * maxHeight) / height;
					height = maxHeight;
				}
			}

			canvas.width = width;
			canvas.height = height;

			// Draw and compress
			ctx.drawImage(img, 0, 0, width, height);

			canvas.toBlob((blob) => {
				if (blob) {
					const compressedFile = new File([blob], file.name, {
						type: file.type,
						lastModified: Date.now(),
					});
					resolve(compressedFile);
				} else {
					resolve(file); // Fallback to original file
				}
			}, file.type, quality);
		};

		img.src = URL.createObjectURL(file);
	});
};

// Process multiple files and convert to ImageAttachment[]
// 现在会设置初始状态为 'pending'，等待后续上传
export const processImageFiles = async (files: File[]): Promise<ImageAttachment[]> => {
	const imageFiles = files.filter(file => file.type.startsWith('image/'));

	if (imageFiles.length === 0) return [];

	const newImages: ImageAttachment[] = [];

	for (const file of imageFiles) {
		try {
			// Compress large images
			const processedFile = file.size > 1024 * 1024 ? await compressImage(file) : file;

			const base64Data = await fileToBase64(processedFile);
			const dimensions = await getImageDimensions(processedFile);

			const imageAttachment: ImageAttachment = {
				id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				name: file.name,
				mimeType: file.type,
				size: processedFile.size,
				base64Data,
				width: dimensions.width,
				height: dimensions.height,
				uploadStatus: 'pending', // 初始状态为待上传
			};

			newImages.push(imageAttachment);
		} catch (error) {
			console.error('Error processing image:', error);
		}
	}

	return newImages;
};

// 处理图片文件并自动上传到服务器
export const processAndUploadImageFiles = async (
	files: File[],
	onProgress: (images: ImageAttachment[]) => void
): Promise<ImageAttachment[]> => {
	// 首先处理图片文件
	const processedImages = await processImageFiles(files);

	if (processedImages.length === 0) return [];

	// 然后上传到服务器
	const uploadedImages = await uploadImagesWithProgress(processedImages, onProgress);

	return uploadedImages;
};

// Image upload button component
export const ImageUploadButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<button
			type="button"
			onClick={onClick}
			className="absolute bottom-2 right-2 p-1 text-senweaver-fg-3 hover:text-senweaver-fg-1 hover:bg-senweaver-bg-2 rounded transition-colors"
			title="添加图片"
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<polyline points="21,15 16,10 5,21" />
			</svg>
		</button>
	);
};

// Drag overlay component
export const DragOverlay = () => {
	return (
		<div className="absolute inset-0 bg-blue-100 dark:bg-blue-900/30 border-2 border-dashed border-blue-400 dark:border-blue-500 rounded flex items-center justify-center z-10">
			<div className="text-blue-600 dark:text-blue-400 text-center">
				<svg className="mx-auto mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
					<circle cx="8.5" cy="8.5" r="1.5" />
					<polyline points="21,15 16,10 5,21" />
				</svg>
				<p>Drop images here</p>
			</div>
		</div>
	);
};
