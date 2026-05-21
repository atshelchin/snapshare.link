import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { downloadTokens, paidFiles } from '$lib/server/db/schema';
import { getChunkUploadUrl, type VaultEnv, type StoragePlan } from '$lib/vault';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Get signed download URLs for all chunks, requires valid download token
// POST { token, action: "start" } → returns signed URLs + file info
// POST { token, partNumber } → returns signed URL for one chunk
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as VaultEnv;
		const { token, partNumber } = await request.json() as { token: string; partNumber?: number };

		if (!token) {
			return Response.json({ success: false, error: 'Missing token' }, { status: 400 });
		}

		// Validate token
		const tokens = await db.select().from(downloadTokens)
			.where(eq(downloadTokens.token, token)).limit(1).all();

		if (!tokens.length) {
			return Response.json({ success: false, error: 'Invalid token' }, { status: 403 });
		}

		const t = tokens[0];
		if (t.expires_at < Date.now()) {
			return Response.json({ success: false, error: 'Token expired' }, { status: 403 });
		}
		if (t.downloads_used >= t.downloads_max) {
			return Response.json({ success: false, error: 'Download limit reached' }, { status: 403 });
		}

		// Get file info
		const files = await db.select().from(paidFiles)
			.where(eq(paidFiles.file_key, t.file_key)).limit(1).all();

		if (!files.length) {
			return Response.json({ success: false, error: 'File not found' }, { status: 404 });
		}

		const file = files[0];
		const plan = (file.expires_at - file.created_at > 8 * 24 * 60 * 60 * 1000 ? '30d' : '7d') as StoragePlan;
		const bucketName = plan === '7d' ? 'paid-snapshare-7days' : 'paid-snapshare';

		const s3 = new S3Client({
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

		if (partNumber) {
			// Single chunk URL
			const url = await getSignedUrl(s3, new GetObjectCommand({
				Bucket: bucketName,
				Key: `${t.file_key}/${partNumber}`
			}), { expiresIn: 3600 });

			return Response.json({ success: true, data: { url, partNumber } });
		}

		// Start download — increment counter, return file info + first chunk URL
		await db.update(downloadTokens)
			.set({ downloads_used: t.downloads_used + 1 })
			.where(eq(downloadTokens.token, token));

		const firstUrl = await getSignedUrl(s3, new GetObjectCommand({
			Bucket: bucketName,
			Key: `${t.file_key}/1`
		}), { expiresIn: 3600 });

		return Response.json({
			success: true,
			data: {
				fileKey: file.file_key,
				fileName: file.original_name,
				fileSize: file.file_size,
				partsTotal: file.parts_total,
				plan,
				token,
				downloadsUsed: t.downloads_used + 1,
				downloadsMax: t.downloads_max,
				expiresAt: t.expires_at,
				firstChunkUrl: firstUrl
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
