import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { generatePaymentAddress } from '$lib/payment';

// Create a payment order for downloading a file
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as { KV: { put: (key: string, value: string, options?: { expirationTtl: number }) => Promise<void> } };
		const { fileKey } = await request.json();

		if (!fileKey) {
			return Response.json({ success: false, error: 'Missing fileKey' }, { status: 400 });
		}

		// Get file info
		const file = await db.select().from(paidFiles)
			.where(eq(paidFiles.file_key, fileKey)).limit(1).all();

		if (!file.length || file[0].upload_status !== 'completed') {
			return Response.json({ success: false, error: 'File not found' }, { status: 404 });
		}

		const downloadPrice = file[0].download_price || '0.01';

		// Generate payment address
		const orderId = nanoid();
		const { address: paymentAddress, privateKeyHex } = generatePaymentAddress();

		// Store in KV (1h TTL for payment polling)
		await env.KV.put(
			`download-order:${orderId}`,
			JSON.stringify({
				orderId,
				fileKey,
				amount: downloadPrice,
				paymentAddress,
				privateKeyHex,
				createdAt: Date.now()
			}),
			{ expirationTtl: 3600 }
		);

		return Response.json({
			success: true,
			data: {
				orderId,
				paymentAddress,
				amount: downloadPrice,
				currency: 'USDC',
				network: 'base',
				fileName: file[0].original_name,
				fileSize: file[0].file_size
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
