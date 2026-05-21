import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/d1';
import { paidFiles } from '$lib/server/db/schema';
import {
	calculatePrice,
	calculateParts,
	STORAGE_PLANS,
	type StoragePlan
} from '$lib/vault';
import { derivePaymentAddress, MAIN_WALLET } from '$lib/payment';

// Create a payment order with a unique receiving address
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env as Record<string, string>;
		const { channelId, fileSize, fileHash, plan = '30d' } = await request.json();

		if (!channelId || !fileSize || !fileHash) {
			return Response.json(
				{ success: false, error: 'Missing required fields: channelId, fileSize, fileHash' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		const storagePlan = plan as StoragePlan;
		const planConfig = STORAGE_PLANS[storagePlan];
		const pricing = calculatePrice(fileSize, storagePlan);
		const partsTotal = calculateParts(fileSize);

		// Generate unique order ID and derive payment address
		const orderId = nanoid();
		const masterSeed = env.PAYMENT_MASTER_SEED || 'dev-seed-change-in-production';
		const { address: paymentAddress } = derivePaymentAddress(masterSeed, orderId);

		const now = Date.now();
		const expiresAt = now + planConfig.days * 24 * 60 * 60 * 1000;

		// Store order in KV with 1 hour TTL (for payment polling)
		await (env as unknown as { KV: { put: (key: string, value: string, options?: { expirationTtl: number }) => Promise<void> } }).KV.put(
			`vault-order:${orderId}`,
			JSON.stringify({
				orderId,
				channelId,
				fileHash,
				fileSize,
				plan: storagePlan,
				amount: pricing.priceUSDC,
				paymentAddress,
				partsTotal,
				createdAt: now
			}),
			{ expirationTtl: 3600 }
		);

		// Persist order to D1 so orderId is never lost (needed for fund sweeping)
		const db = drizzle(platform?.env!.DB);
		await db.insert(paidFiles).values({
			file_key: orderId, // temporary PK, replaced when upload starts
			order_id: orderId,
			payment_address: paymentAddress,
			channel_id: channelId,
			file_name: fileHash,
			file_size: fileSize,
			payment_amount: pricing.priceUSDC,
			upload_status: 'pending',
			parts_total: partsTotal,
			expires_at: expiresAt,
			created_at: now
		});

		return Response.json({
			success: true,
			data: {
				orderId,
				paymentAddress,
				amount: pricing.priceUSDC,
				currency: 'USDC',
				network: 'base',
				storageDays: planConfig.days,
				partsTotal,
				pricing
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
