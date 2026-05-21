import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and, gt } from 'drizzle-orm';
import { paidFiles, downloadTokens } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const { channelId } = await request.json();

		if (!channelId) {
			return Response.json({ success: false, error: 'Missing channelId' }, { status: 400 });
		}

		const now = Date.now();
		const files = await db
			.select()
			.from(paidFiles)
			.where(eq(paidFiles.channel_id, channelId))
			.orderBy(desc(paidFiles.created_at))
			.limit(50)
			.all();

		// Return non-expired files: completed ones + paid-but-pending (have payment_tx) for retry
		const activeFiles = files.filter(
			(f) => f.expires_at > now && (
				f.upload_status === 'completed' ||
				((f.upload_status === 'pending' || f.upload_status === 'uploading') && f.payment_tx)
			)
		);

		// Fetch valid download tokens for all active files
		const fileKeys = activeFiles.map((f) => f.file_key);
		const tokenMap = new Map<string, { downloadsUsed: number; downloadsMax: number }>();
		if (fileKeys.length > 0) {
			for (const fk of fileKeys) {
				const tokens = await db.select().from(downloadTokens)
					.where(and(
						eq(downloadTokens.file_key, fk),
						gt(downloadTokens.expires_at, now)
					))
					.orderBy(desc(downloadTokens.created_at))
					.limit(1)
					.all();
				if (tokens.length && tokens[0].downloads_used < tokens[0].downloads_max) {
					tokenMap.set(fk, {
						downloadsUsed: tokens[0].downloads_used,
						downloadsMax: tokens[0].downloads_max
					});
				}
			}
		}

		return Response.json({
			success: true,
			data: activeFiles.map((f) => {
				const token = tokenMap.get(f.file_key);
				return {
					fileKey: f.file_key,
					fileHash: f.file_name, // file_name stores the hash
					fileSize: f.file_size,
					encrypted: f.encrypted === 1,
					plan: f.expires_at - f.created_at > 8 * 24 * 60 * 60 * 1000 ? '30d' : '7d',
					expiresAt: f.expires_at,
					createdAt: f.created_at,
					uploadStatus: f.upload_status,
					orderId: f.order_id,
					originalName: f.original_name,
					partsTotal: f.parts_total,
					downloadPrice: f.download_price || '0.01',
					...(token ? { downloadsUsed: token.downloadsUsed, downloadsMax: token.downloadsMax } : {})
				};
			})
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
