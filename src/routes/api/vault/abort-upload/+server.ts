import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { abortMultipartUpload, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as VaultEnv;
		const { fileKey, uploadId, plan = '30d' } = await request.json();

		if (!fileKey || !uploadId) {
			return Response.json(
				{ success: false, error: 'Missing required fields: fileKey, uploadId' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		await abortMultipartUpload(env, fileKey, uploadId, plan as StoragePlan);

		await db
			.update(paidFiles)
			.set({ upload_status: 'failed' })
			.where(eq(paidFiles.file_key, fileKey));

		return Response.json({ success: true });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
