import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
// import { sql, eq, lt, desc, gt } from 'drizzle-orm';
import { files } from '$lib/server/db/schema';
import { getFileMetadata, hashIP } from '$lib';

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = drizzle(platform?.env!.DB);
	try {
		const { channel_id, file_key, file_name } = await request.json();

		const userIP =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For')?.split(',')[0] ||
			'unknown';
		console.log({ userIP });

		const uploader_hash_ip = await hashIP(userIP);

		const { size, type } = await getFileMetadata(file_key);

		if (size == 0) {
			throw new Error('Invalid file key');
		}
		const filesToInsert = [
			{
				channel_id,
				file_key,
				file_name,
				file_type: type,
				file_size: size,
				uploader_hash_ip,
				created_at: Date.now()
			}
		];
		const insertedFiles = await db.insert(files).values(filesToInsert).returning().all();

		return Response.json({ success: true, count: insertedFiles.length, files: insertedFiles });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
