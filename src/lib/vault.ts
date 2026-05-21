// Data Vault: paid multipart upload utilities for large files
// Uses S3-compatible API for R2 multipart uploads with presigned URLs

import {
	S3Client,
	CreateMultipartUploadCommand,
	UploadPartCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import type { Env } from '$lib';

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
	PAID_BUCKET_30D: string;
	PAID_BUCKET_7D: string;
}

function createS3Client(env: VaultEnv): S3Client {
	return new S3Client({
		region: 'auto',
		endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: env.ACCESS_KEY_ID,
			secretAccessKey: env.SECRET_ACCESS_KEY
		}
	});
}

function getBucketName(env: VaultEnv, plan: StoragePlan): string {
	return plan === '7d' ? env.PAID_BUCKET_7D : env.PAID_BUCKET_30D;
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

// Create a multipart upload and return uploadId + fileKey
export async function createMultipartUpload(
	env: VaultEnv,
	fileName: string,
	plan: StoragePlan
): Promise<{ uploadId: string; fileKey: string }> {
	const s3 = createS3Client(env);
	const uuid = nanoid();
	const now = new Date();
	const prefix = now.toISOString().slice(0, 10);
	const fileKey = `vault/${prefix}/${uuid}`;
	const bucket = getBucketName(env, plan);

	const command = new CreateMultipartUploadCommand({
		Bucket: bucket,
		Key: fileKey,
		ContentType: 'application/octet-stream',
		Metadata: {
			'original-name': encodeURIComponent(fileName)
		}
	});

	const response = await s3.send(command);
	if (!response.UploadId) {
		throw new Error('Failed to create multipart upload');
	}

	return { uploadId: response.UploadId, fileKey };
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

// Complete the multipart upload
export async function completeMultipartUpload(
	env: VaultEnv,
	fileKey: string,
	uploadId: string,
	parts: { partNumber: number; etag: string }[],
	plan: StoragePlan
): Promise<void> {
	const s3 = createS3Client(env);
	const bucket = getBucketName(env, plan);

	const command = new CompleteMultipartUploadCommand({
		Bucket: bucket,
		Key: fileKey,
		UploadId: uploadId,
		MultipartUpload: {
			Parts: parts.map((p) => ({
				PartNumber: p.partNumber,
				ETag: p.etag
			}))
		}
	});

	await s3.send(command);
}

// Abort a multipart upload (cleanup)
export async function abortMultipartUpload(
	env: VaultEnv,
	fileKey: string,
	uploadId: string,
	plan: StoragePlan
): Promise<void> {
	const s3 = createS3Client(env);
	const bucket = getBucketName(env, plan);

	const command = new AbortMultipartUploadCommand({
		Bucket: bucket,
		Key: fileKey,
		UploadId: uploadId
	});

	await s3.send(command);
}
