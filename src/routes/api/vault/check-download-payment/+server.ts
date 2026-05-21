import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/d1';
import { downloadTokens } from '$lib/server/db/schema';
import { checkPaymentToAddress } from '$lib/payment';

// Check download payment and issue a download token (24h, max 3 downloads)
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as { KV: { get: (key: string) => Promise<string | null> } };
		const { orderId } = await request.json();

		if (!orderId) {
			return Response.json({ success: false, error: 'Missing orderId' }, { status: 400 });
		}

		const orderData = await env.KV.get(`download-order:${orderId}`);
		if (!orderData) {
			return Response.json({ success: false, error: 'Order not found or expired' }, { status: 404 });
		}

		const order = JSON.parse(orderData);
		const result = await checkPaymentToAddress(order.paymentAddress, order.amount);

		if (!result.paid) {
			return Response.json({
				success: true,
				data: { paid: false, paymentAddress: order.paymentAddress, amount: order.amount }
			});
		}

		// Payment confirmed — create download token
		const token = nanoid(32);
		const now = Date.now();

		await db.insert(downloadTokens).values({
			token,
			file_key: order.fileKey,
			payment_tx: result.txHash || orderId,
			payment_address: order.paymentAddress,
			private_key: order.privateKeyHex,
			payment_amount: order.amount,
			downloads_used: 0,
			downloads_max: 3,
			expires_at: now + 24 * 60 * 60 * 1000, // 24h
			created_at: now
		});

		return Response.json({
			success: true,
			data: {
				paid: true,
				token,
				expiresAt: now + 24 * 60 * 60 * 1000,
				downloadsMax: 3,
				fileKey: order.fileKey
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
