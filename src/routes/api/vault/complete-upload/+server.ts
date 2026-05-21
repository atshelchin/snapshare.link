import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { getUploadedParts, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as VaultEnv;
		const body = await request.json() as { fileKey: string; partsTotal: number; plan?: string };
		const { fileKey, partsTotal, plan = '30d' } = body;

		if (!fileKey || !partsTotal) {
			return Response.json(
				{ success: false, error: 'Missing required fields: fileKey, partsTotal' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		// Verify all parts are uploaded
		const uploaded = await getUploadedParts(env, fileKey, partsTotal, plan as StoragePlan);
		if (uploaded.length < partsTotal) {
			const missing = [];
			for (let i = 1; i <= partsTotal; i++) {
				if (!uploaded.includes(i)) missing.push(i);
			}
			return Response.json({
				success: false,
				error: `Missing ${missing.length} parts: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`,
				data: { uploaded: uploaded.length, missing: missing.length }
			}, { status: 400 });
		}

		await db
			.update(paidFiles)
			.set({
				upload_status: 'completed',
				parts_done: partsTotal
			})
			.where(eq(paidFiles.file_key, fileKey));

		return Response.json({ success: true });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
