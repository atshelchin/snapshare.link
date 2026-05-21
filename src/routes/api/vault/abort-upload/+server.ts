import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const { fileKey } = await request.json();

		if (!fileKey) {
			return Response.json(
				{ success: false, error: 'Missing required field: fileKey' },
				{ status: 400 }
			);
		}

		await db
			.update(paidFiles)
			.set({ upload_status: 'failed' })
			.where(eq(paidFiles.file_key, fileKey));

		return Response.json({ success: true });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
