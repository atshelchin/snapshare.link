import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { lt } from 'drizzle-orm';
import { files, paidFiles } from '$lib/server/db/schema';
import {
	S3Client,
	ListObjectsV2Command,
	DeleteObjectsCommand
} from '@aws-sdk/client-s3';

// Cleanup endpoint - designed to be called by Cloudflare Cron Trigger every minute
// Cleans:
// 1. D1 `files` table: records older than 1 hour
// 2. D1 `paid_files` table: records past their expires_at
// 3. R2 free bucket: objects with time prefix older than 2 hours
// (paid R2 buckets use lifecycle rules for auto-deletion)

// Generate past hour prefixes for R2 object listing
function getPastHourPrefixes(hours: number, excludeRecentHours: number): string[] {
	const prefixes: string[] = [];
	const now = new Date();
	const startOffset = hours + excludeRecentHours - 1;
	const endOffset = excludeRecentHours;

	for (let i = startOffset; i >= endOffset; i--) {
		const time = new Date(now.getTime() - i * 60 * 60 * 1000);
		prefixes.push(time.toISOString().slice(0, 13));
	}
	return prefixes;
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const authHeader = request.headers.get('X-Cleanup-Secret');
	const env = platform?.env as Record<string, string>;
	const expectedSecret = env?.CLEANUP_SECRET;
	if (expectedSecret && authHeader !== expectedSecret) {
		return Response.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = drizzle(platform?.env!.DB);
	const now = Date.now();
	const oneHourAgo = now - 3600000;

	const results = { d1Files: 0, d1PaidFiles: 0, r2Objects: 0 };

	try {
		// 1. D1: delete free channel files older than 1 hour
		const deletedFiles = await db
			.delete(files)
			.where(lt(files.created_at, oneHourAgo))
			.returning()
			.all();
		results.d1Files = deletedFiles.length;

		// 2. D1: delete expired paid files
		const deletedPaid = await db
			.delete(paidFiles)
			.where(lt(paidFiles.expires_at, now))
			.returning()
			.all();
		results.d1PaidFiles = deletedPaid.length;

		// 3. R2: delete objects from free bucket using time prefix strategy
		// (same logic as snapshare-schedule-r2: scan 6 hours, exclude recent 2 hours)
		if (env?.ACCESS_KEY_ID && env?.ACCOUNT_ID && env?.BUCKET) {
			const s3 = new S3Client({
				region: 'auto',
				endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
				credentials: {
					accessKeyId: env.ACCESS_KEY_ID,
					secretAccessKey: env.SECRET_ACCESS_KEY
				}
			});

			const prefixes = getPastHourPrefixes(6, 2);
			const keys: { Key: string }[] = [];

			for (const prefix of prefixes) {
				const list = await s3.send(
					new ListObjectsV2Command({ Bucket: env.BUCKET, Prefix: prefix })
				);
				if (list?.Contents?.length) {
					for (const obj of list.Contents) {
						if (obj.Key) keys.push({ Key: obj.Key });
					}
				}
			}

			if (keys.length > 0) {
				// DeleteObjects max 1000 per request
				for (let i = 0; i < keys.length; i += 1000) {
					await s3.send(
						new DeleteObjectsCommand({
							Bucket: env.BUCKET,
							Delete: { Objects: keys.slice(i, i + 1000) }
						})
					);
				}
				results.r2Objects = keys.length;
			}
		}

		return Response.json({
			success: true,
			cleaned: results,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
