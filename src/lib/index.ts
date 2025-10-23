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
