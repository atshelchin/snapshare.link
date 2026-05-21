import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, gt } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';

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

		// Only return non-expired, completed files
		const activeFiles = files.filter(
			(f) => f.upload_status === 'completed' && f.expires_at > now
		);

		return Response.json({
			success: true,
			data: activeFiles.map((f) => ({
				fileKey: f.file_key,
				fileHash: f.file_name, // file_name stores the hash
				fileSize: f.file_size,
				encrypted: f.encrypted === 1,
				plan: f.expires_at - f.created_at > 8 * 24 * 60 * 60 * 1000 ? '30d' : '7d',
				expiresAt: f.expires_at,
				createdAt: f.created_at
			}))
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
