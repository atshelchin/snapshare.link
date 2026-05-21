import type { RequestHandler } from './$types';
import { getUploadedParts, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env as unknown as VaultEnv;
		const { fileKey, partsTotal, plan = '30d' } = await request.json() as {
			fileKey: string; partsTotal: number; plan?: string;
		};

		if (!fileKey || !partsTotal) {
			return Response.json({ success: false, error: 'Missing fileKey or partsTotal' }, { status: 400 });
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		const uploaded = await getUploadedParts(env, fileKey, partsTotal, plan as StoragePlan);

		return Response.json({
			success: true,
			data: { uploaded, count: uploaded.length }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
