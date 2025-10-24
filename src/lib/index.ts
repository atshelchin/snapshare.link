import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

// place files you want to import through the `$lib` alias in this folder.
export async function getFileMetadata(url: string, cdnUrl = 'https://cdn.snapshare.link/') {
	const response = await fetch(cdnUrl + url, {
		method: 'HEAD',
		headers: {
			'Accept-Encoding': 'identity' // 告诉服务器不要压缩
		}
	});

	return {
		size: parseInt(response.headers.get('content-length') || '0'),
		type: response.headers.get('content-type') || 'application/octet-stream'
	};
}

// 使用 Web Crypto API 对 IP 进行 SHA-256 哈希
export async function hashIP(ip: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(ip);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return hashHex.slice(0, 16); // 返回前 16 个字符
}

// 文件验证配置
const FILE_VALIDATION = {
	MAX_FILES: 10,
	MAX_FILE_SIZE: 100 * 1024 * 1024 // 100MB
};

export interface FileValidationError {
	file: File;
	error: string;
}

export interface FileValidationResult {
	valid: File[];
	invalid: FileValidationError[];
	totalSize: number;
}

// 验证文件
export function validateFiles(files: FileList | File[]): FileValidationResult {
	const fileArray = Array.from(files);
	const valid: File[] = [];
	const invalid: FileValidationError[] = [];
	let totalSize = 0;

	// 检查文件数量
	if (fileArray.length > FILE_VALIDATION.MAX_FILES) {
		return {
			valid: [],
			invalid: fileArray.map((file) => ({
				file,
				error: `最多只能上传 ${FILE_VALIDATION.MAX_FILES} 个文件`
			})),
			totalSize: 0
		};
	}

	// 检查每个文件
	for (const file of fileArray) {
		if (file.size > FILE_VALIDATION.MAX_FILE_SIZE) {
			invalid.push({
				file,
				error: `文件大小超过 ${FILE_VALIDATION.MAX_FILE_SIZE / 1024 / 1024}MB`
			});
		} else if (file.size === 0) {
			invalid.push({
				file,
				error: '文件大小为 0'
			});
		} else {
			valid.push(file);
			totalSize += file.size;
		}
	}

	return { valid, invalid, totalSize };
}

export interface Env {
	ACCESS_KEY_ID: string;
	SECRET_ACCESS_KEY: string;
	ACCOUNT_ID: string;
	BUCKET: string;
	REGION: string;
}

export async function createPresignedUploadUrl(env: Env, fileSizeBytes: number) {
	const uuid = nanoid();
	const now = new Date();
	const time = new Date(now.getTime());
	const prefix = time.toISOString().slice(0, 13);
	const fileKey = prefix + '/' + uuid;
	const maxSize = 100 * 1024 * 1024;

	if (fileSizeBytes > maxSize) {
		throw new Error('fileSizeBytes exceeded max size limit ');
	}

	const command = new PutObjectCommand({
		Bucket: env.BUCKET,
		Key: fileKey,
		ContentLength: fileSizeBytes //设置精确大小
	});
	const S3 = new S3Client({
		region: 'auto',
		endpoint: `https://${env.ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: env.ACCESS_KEY_ID,
			secretAccessKey: env.SECRET_ACCESS_KEY
		}
	});

	const presignedUrl = await getSignedUrl(S3, command, {
		expiresIn: 3600
	});

	return {
		url: presignedUrl,
		method: 'PUT',
		fileKey: fileKey,
		fileSizeBytes: fileSizeBytes,
		maxSizeBytes: maxSize,
		expiresIn: 3600
	};
}

export function textToFile(text: string, filename: string = 'untitled.txt'): File {
	const blob = new Blob([text], { type: 'text/plain' });
	return new File([blob], filename, { type: 'text/plain' });
}

export async function genUploadUrls(files: number[]) {
	const url = 'https://snapshare.link/api/create-presigned-upload-url';
	const body = { files: files };
	const options = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	};

	try {
		const response = await fetch(url, options);
		const data = await response.json();
 
		return data;
	} catch (error) {
		console.error(error);
	}
}

export function updateProgress(a, b) {
	console.log(a, b);
}

export function uploadWithPUT(url: string, file: File, onload, onprogress, onerror, onabort) {
	const uploadXHR = new XMLHttpRequest();

	// 监听上传进度
	uploadXHR.upload.addEventListener('progress', function (e) {
		// if (e.lengthComputable) {
		onprogress?.(e);
		// 	updateProgress(e.loaded, e.total);
		// }
	});

	// 监听完成
	uploadXHR.addEventListener('load', function () {
		onload?.(uploadXHR);
		// const uploadBtn = document.getElementById('uploadBtn');
		// uploadBtn.disabled = false;
		// uploadBtn.textContent = '开始上传';

		// if (uploadXHR.status >= 200 && uploadXHR.status < 300) {
		// 	showStatus('✅ 上传成功！', 'success');
		// } else {
		// 	showStatus(`❌ 上传失败：HTTP ${uploadXHR.status} - ${uploadXHR.statusText}`, 'error');
		// }
	});

	// 监听错误
	uploadXHR.addEventListener('error', function () {
		// const uploadBtn = document.getElementById('uploadBtn');
		// uploadBtn.disabled = false;
		// uploadBtn.textContent = '开始上传';
		// showStatus('❌ 网络错误，上传失败', 'error');
		onerror?.();
	});

	// 监听取消
	uploadXHR.addEventListener('abort', function () {
		onabort?.();
		// const uploadBtn = document.getElementById('uploadBtn');
		// uploadBtn.disabled = false;
		// uploadBtn.textContent = '开始上传';
		// showStatus('⚠️ 上传已取消', 'info');
	});

	// 发送 PUT 请求
	uploadXHR.open('PUT', url);
	uploadXHR.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
	uploadXHR.send(file);
}

export async function addFile(channel_id: string, file_key: string, file_name: string) {
	const url = 'https://snapshare.link/api/add-file';

	const body = {
		channel_id,
		file_key,
		file_name
	};
	const options = {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	};

	try {
		const response = await fetch(url, options);
		const data = await response.json();

		console.log('addFile', data);
		return data;
	} catch (error) {
		console.error(error);
	}
}
