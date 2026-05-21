// Data Vault: paid multipart upload utilities for large files
// Uses S3-compatible API for R2 multipart uploads with presigned URLs
// Server-side ops use raw fetch to avoid DOMParser issue in Workers

import {
	S3Client,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import type { Env } from '$lib';
import { AwsV4Signer } from 'aws4fetch';

// 100MB per part
export const PART_SIZE = 100 * 1024 * 1024;

// Max file size: 4TB
export const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024 * 1024;

// Storage plans
export type StoragePlan = '7d' | '30d';

export const STORAGE_PLANS = {
	'7d': { days: 7, pricePerGB: 0.01, label: '7 days', bucket: 'PAID_BUCKET_7D' },
	'30d': { days: 30, pricePerGB: 0.1, label: '30 days', bucket: 'PAID_BUCKET_30D' }
} as const;

export interface VaultEnv extends Env {
	PAID_BUCKET_30D: R2Bucket;
	PAID_BUCKET_7D: R2Bucket;
}

function createS3Client(env: VaultEnv): S3Client {
	return new S3Client({
		region: 'auto',
		endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: env.ACCESS_KEY_ID,
			secretAccessKey: env.SECRET_ACCESS_KEY
		},
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED',
	});
}

function getBucketName(_env: VaultEnv, plan: StoragePlan): string {
	return plan === '7d' ? 'paid-snapshare-7days' : 'paid-snapshare';
}

function getR2Endpoint(env: VaultEnv, plan: StoragePlan): string {
	const bucket = getBucketName(env, plan);
	return `https://${bucket}.${env.ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

// Calculate price in USDC
export function calculatePrice(
	fileSizeBytes: number,
	plan: StoragePlan
): {
	sizeGB: number;
	billableGB: number;
	priceUSDC: string;
	storageDays: number;
	plan: StoragePlan;
} {
	const planConfig = STORAGE_PLANS[plan];
	const sizeGB = fileSizeBytes / (1024 * 1024 * 1024);
	const billableGB = Math.max(1, Math.ceil(sizeGB));
	const price = billableGB * planConfig.pricePerGB;
	return {
		sizeGB: Math.round(sizeGB * 1000) / 1000,
		billableGB,
		priceUSDC: price.toFixed(2),
		storageDays: planConfig.days,
		plan
	};
}

// Calculate number of parts needed
export function calculateParts(fileSizeBytes: number): number {
	return Math.ceil(fileSizeBytes / PART_SIZE);
}

// Create a multipart upload via raw S3 API (avoids DOMParser)
export async function createMultipartUpload(
	env: VaultEnv,
	fileName: string,
	plan: StoragePlan
): Promise<{ uploadId: string; fileKey: string }> {
	const uuid = nanoid();
	const now = new Date();
	const prefix = now.toISOString().slice(0, 10);
	const fileKey = `vault/${prefix}/${uuid}`;
	const endpoint = getR2Endpoint(env, plan);

	const signer = new AwsV4Signer({
		accessKeyId: env.ACCESS_KEY_ID,
		secretAccessKey: env.SECRET_ACCESS_KEY,
		region: 'auto',
		service: 's3',
		url: `${endpoint}/${fileKey}?uploads`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/octet-stream',
			'x-amz-meta-original-name': encodeURIComponent(fileName)
		}
	});

	const signed = await signer.sign();
	const resp = await fetch(signed.url, {
		method: 'POST',
		headers: signed.headers
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`CreateMultipartUpload failed: ${resp.status} ${text}`);
	}

	const xml = await resp.text();
	const uploadIdMatch = xml.match(/<UploadId>(.+?)<\/UploadId>/);
	if (!uploadIdMatch) throw new Error('No UploadId in response');

	return { uploadId: uploadIdMatch[1], fileKey };
}

// Generate a presigned URL for uploading a single part
export async function getPartUploadUrl(
	env: VaultEnv,
	fileKey: string,
	uploadId: string,
	partNumber: number,
	plan: StoragePlan
): Promise<string> {
	const s3 = createS3Client(env);
	const bucket = getBucketName(env, plan);

	const command = new UploadPartCommand({
		Bucket: bucket,
		Key: fileKey,
		UploadId: uploadId,
		PartNumber: partNumber
	});

	return getSignedUrl(s3, command, { expiresIn: 3600 });
}

// Complete the multipart upload via raw S3 API
export async function completeMultipartUpload(
	env: VaultEnv,
	fileKey: string,
	uploadId: string,
	parts: { partNumber: number; etag: string }[],
	plan: StoragePlan
): Promise<void> {
	const endpoint = getR2Endpoint(env, plan);
	const partsXml = parts
		.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
		.join('');
	const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

	const signer = new AwsV4Signer({
		accessKeyId: env.ACCESS_KEY_ID,
		secretAccessKey: env.SECRET_ACCESS_KEY,
		region: 'auto',
		service: 's3',
		url: `${endpoint}/${fileKey}?uploadId=${uploadId}`,
		method: 'POST',
		headers: { 'Content-Type': 'application/xml' },
		body
	});

	const signed = await signer.sign();
	const resp = await fetch(signed.url, {
		method: 'POST',
		headers: signed.headers,
		body
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`CompleteMultipartUpload failed: ${resp.status} ${text}`);
	}
}

// Abort a multipart upload via raw S3 API
export async function abortMultipartUpload(
	env: VaultEnv,
	fileKey: string,
	uploadId: string,
	plan: StoragePlan
): Promise<void> {
	const endpoint = getR2Endpoint(env, plan);

	const signer = new AwsV4Signer({
		accessKeyId: env.ACCESS_KEY_ID,
		secretAccessKey: env.SECRET_ACCESS_KEY,
		region: 'auto',
		service: 's3',
		url: `${endpoint}/${fileKey}?uploadId=${uploadId}`,
		method: 'DELETE'
	});

	const signed = await signer.sign();
	await fetch(signed.url, {
		method: 'DELETE',
		headers: signed.headers
	});
}
