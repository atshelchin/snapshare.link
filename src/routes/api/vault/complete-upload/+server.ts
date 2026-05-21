import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { completeMultipartUpload, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as VaultEnv;
		const { fileKey, uploadId, parts, plan = '30d' } = await request.json();

		if (!fileKey || !uploadId || !parts || !Array.isArray(parts)) {
			return Response.json(
				{ success: false, error: 'Missing required fields: fileKey, uploadId, parts[]' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		// ETags are fetched server-side via ListParts — client ETags ignored
		await completeMultipartUpload(env, fileKey, uploadId, parts, plan as StoragePlan);

		await db
			.update(paidFiles)
			.set({
				upload_status: 'completed',
				parts_done: parts.length
			})
			.where(eq(paidFiles.file_key, fileKey));

		return Response.json({ success: true });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
