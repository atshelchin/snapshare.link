import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gt } from 'drizzle-orm';
import { downloadTokens } from '$lib/server/db/schema';
import { checkPaymentToAddress } from '$lib/payment';

// Check download payment and activate the download token
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as { KV: { get: (key: string) => Promise<string | null> } };
		const { orderId } = await request.json();

		if (!orderId) {
			return Response.json({ success: false, error: 'Missing orderId' }, { status: 400 });
		}

		// Try KV first, then fallback to D1 pending token
		let order: { fileKey: string; paymentAddress: string; amount: string; privateKeyHex: string };
		const orderData = await env.KV.get(`download-order:${orderId}`);
		if (orderData) {
			order = JSON.parse(orderData);
		} else {
			// KV expired — recover from D1 pending token
			const pending = await db.select().from(downloadTokens)
				.where(eq(downloadTokens.token, orderId)).limit(1).all();
			if (!pending.length) {
				return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
			}
			order = {
				fileKey: pending[0].file_key,
				paymentAddress: pending[0].payment_address || '',
				amount: pending[0].payment_amount || '0',
				privateKeyHex: pending[0].private_key || ''
			};
		}

		const result = await checkPaymentToAddress(order.paymentAddress, order.amount);

		if (!result.paid) {
			return Response.json({
				success: true,
				data: { paid: false, paymentAddress: order.paymentAddress, amount: order.amount }
			});
		}

		// Check if already activated (prevent duplicates from repeated polling)
		const existing = await db.select().from(downloadTokens)
			.where(and(
				eq(downloadTokens.file_key, order.fileKey),
				gt(downloadTokens.expires_at, Date.now())
			)).limit(1).all();

		if (existing.length && existing[0].downloads_max > 0 && existing[0].token !== orderId) {
			// Already activated by a previous poll
			return Response.json({
				success: true,
				data: {
					paid: true,
					token: existing[0].token,
					expiresAt: existing[0].expires_at,
					downloadsMax: existing[0].downloads_max,
					fileKey: order.fileKey
				}
			});
		}

		// Activate token
		const token = nanoid(32);
		const now = Date.now();

		await db.delete(downloadTokens).where(eq(downloadTokens.token, orderId));

		await db.insert(downloadTokens).values({
			token,
			file_key: order.fileKey,
			payment_tx: result.txHash || orderId,
			payment_address: order.paymentAddress,
			private_key: order.privateKeyHex,
			payment_amount: order.amount,
			downloads_used: 0,
			downloads_max: 10,
			expires_at: now + 24 * 60 * 60 * 1000,
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
