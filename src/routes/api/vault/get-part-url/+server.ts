import type { RequestHandler } from './$types';
import { getChunkUploadUrl, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env as unknown as VaultEnv;
		const { fileKey, partNumber, plan = '30d' } = await request.json();

		if (!fileKey || !partNumber) {
			return Response.json(
				{ success: false, error: 'Missing required fields: fileKey, partNumber' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		const url = await getChunkUploadUrl(env, fileKey, partNumber, plan as StoragePlan);

		return Response.json({
			success: true,
			data: { url, partNumber }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
