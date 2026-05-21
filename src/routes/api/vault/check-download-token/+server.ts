import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gt } from 'drizzle-orm';
import { downloadTokens } from '$lib/server/db/schema';

// Check if there's an existing valid download token for a file
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const { fileKey } = await request.json();

		if (!fileKey) {
			return Response.json({ success: false, error: 'Missing fileKey' }, { status: 400 });
		}

		const now = Date.now();
		const tokens = await db.select().from(downloadTokens)
			.where(
				and(
					eq(downloadTokens.file_key, fileKey),
					gt(downloadTokens.expires_at, now)
				)
			)
			.orderBy(downloadTokens.created_at)
			.limit(1)
			.all();

		if (tokens.length && tokens[0].downloads_used < tokens[0].downloads_max) {
			return Response.json({
				success: true,
				data: {
					hasToken: true,
					token: tokens[0].token,
					downloadsUsed: tokens[0].downloads_used,
					downloadsMax: tokens[0].downloads_max,
					expiresAt: tokens[0].expires_at
				}
			});
		}

		return Response.json({
			success: true,
			data: { hasToken: false }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
