import type { RequestHandler } from './$types';
import { getPartUploadUrl, STORAGE_PLANS, type VaultEnv, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env as unknown as VaultEnv;
		const { fileKey, uploadId, partNumber, plan = '30d' } = await request.json();

		if (!fileKey || !uploadId || !partNumber) {
			return Response.json(
				{ success: false, error: 'Missing required fields: fileKey, uploadId, partNumber' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		const url = await getPartUploadUrl(env, fileKey, uploadId, partNumber, plan as StoragePlan);

		return Response.json({
			success: true,
			data: { url, partNumber }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
