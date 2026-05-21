import type { RequestHandler } from './$types';
import { calculatePrice, calculateParts, PART_SIZE, MAX_FILE_SIZE, STORAGE_PLANS, type StoragePlan } from '$lib/vault';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { fileSize, plan = '30d' } = await request.json();

		if (!fileSize || fileSize <= 0) {
			return Response.json({ success: false, error: 'Invalid file size' }, { status: 400 });
		}

		if (fileSize > MAX_FILE_SIZE) {
			return Response.json(
				{ success: false, error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024 * 1024 * 1024)}TB` },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan. Use "7d" or "30d"' }, { status: 400 });
		}

		const pricing = calculatePrice(fileSize, plan as StoragePlan);
		const partsTotal = calculateParts(fileSize);

		return Response.json({
			success: true,
			data: {
				...pricing,
				partsTotal,
				partSize: PART_SIZE,
				fileSizeBytes: fileSize
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
