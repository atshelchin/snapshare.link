// Data Vault: paid upload utilities for large files
// Each encrypted chunk is stored as a separate R2 object: {fileKey}/{partNumber}
// No multipart upload — no 10,000 part limit, no CompleteMultipartUpload

import {
	S3Client,
	PutObjectCommand,
	HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import type { Env } from '$lib';

// Fixed 10MB per chunk
export const PART_SIZE = 10 * 1024 * 1024;

// No hard file size limit — practically limited by storage cost
export const MAX_FILE_SIZE = Infinity;

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
		forcePathStyle: true,
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED',
	});
}

function getBucketName(_env: VaultEnv, plan: StoragePlan): string {
	return plan === '7d' ? 'paid-snapshare-7days' : 'paid-snapshare';
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

// Generate a unique fileKey for a new upload
export function generateFileKey(): string {
	const uuid = nanoid();
	const now = new Date();
	const prefix = now.toISOString().slice(0, 10);
	return `vault/${prefix}/${uuid}`;
}

// Generate a presigned PUT URL for a single chunk: {fileKey}/{partNumber}
export async function getChunkUploadUrl(
	env: VaultEnv,
	fileKey: string,
	partNumber: number,
	plan: StoragePlan
): Promise<string> {
	const s3 = createS3Client(env);
	const bucket = getBucketName(env, plan);

	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: `${fileKey}/${partNumber}`,
		ContentType: 'application/octet-stream'
	});

	return getSignedUrl(s3, command, { expiresIn: 3600 });
}

// Check which chunks have been uploaded (for resume)
export async function getUploadedParts(
	env: VaultEnv,
	fileKey: string,
	partsTotal: number,
	plan: StoragePlan
): Promise<number[]> {
	const s3 = createS3Client(env);
	const bucket = getBucketName(env, plan);
	const uploaded: number[] = [];

	// Check each part with HEAD (batch in parallel, 20 at a time)
	for (let i = 0; i < partsTotal; i += 20) {
		const batch = [];
		for (let j = i; j < Math.min(i + 20, partsTotal); j++) {
			batch.push(
				s3.send(new HeadObjectCommand({
					Bucket: bucket,
					Key: `${fileKey}/${j + 1}`
				})).then(() => j + 1).catch(() => null)
			);
		}
		const results = await Promise.all(batch);
		for (const r of results) {
			if (r !== null) uploaded.push(r);
		}
	}

	return uploaded.sort((a, b) => a - b);
}
