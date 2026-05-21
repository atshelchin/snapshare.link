import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { hashIP } from '$lib';
import {
	generateFileKey,
	calculateParts,
	STORAGE_PLANS,
	type VaultEnv,
	type StoragePlan
} from '$lib/vault';
import { checkPaymentToAddress } from '$lib/payment';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const db = drizzle(platform?.env!.DB);
		const env = platform?.env as unknown as VaultEnv & { KV: { get: (key: string) => Promise<string | null> } };
		const { orderId, channelId, fileName, fileSize, fileHash, encrypted, plan = '30d' } =
			await request.json();

		if (!orderId || !channelId || !fileName || !fileSize || !fileHash) {
			return Response.json(
				{ success: false, error: 'Missing required fields' },
				{ status: 400 }
			);
		}

		if (!STORAGE_PLANS[plan as StoragePlan]) {
			return Response.json({ success: false, error: 'Invalid plan' }, { status: 400 });
		}

		const storagePlan = plan as StoragePlan;
		const planConfig = STORAGE_PLANS[storagePlan];

		// Check if this file already uploaded successfully
		const existingFile = await db
			.select()
			.from(paidFiles)
			.where(
				and(
					eq(paidFiles.channel_id, channelId),
					eq(paidFiles.file_name, fileHash),
					eq(paidFiles.upload_status, 'completed')
				)
			)
			.limit(1)
			.all();

		if (existingFile.length > 0) {
			return Response.json({
				success: true,
				data: { fileKey: existingFile[0].file_key, alreadyUploaded: true, expiresAt: existingFile[0].expires_at }
			});
		}

		// Get order from KV first, fallback to D1
		let order: { channelId: string; fileHash: string; paymentAddress: string; amount: string };
		const orderData = await env.KV.get(`vault-order:${orderId}`);
		if (orderData) {
			order = JSON.parse(orderData);
		} else {
			let d1Order = await db.select().from(paidFiles)
				.where(eq(paidFiles.order_id, orderId)).limit(1).all();
			if (!d1Order.length) {
				d1Order = await db.select().from(paidFiles)
					.where(eq(paidFiles.file_key, orderId)).limit(1).all();
			}
			if (!d1Order.length) {
				return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
			}
			order = {
				channelId: d1Order[0].channel_id,
				fileHash: d1Order[0].file_name,
				paymentAddress: d1Order[0].payment_address || '',
				amount: d1Order[0].payment_amount || '0'
			};
		}

		if (order.channelId !== channelId || order.fileHash !== fileHash) {
			return Response.json({ success: false, error: 'Order does not match' }, { status: 403 });
		}

		// Verify payment
		const payment = await checkPaymentToAddress(order.paymentAddress, order.amount);
		if (!payment.paid) {
			return Response.json(
				{ success: false, error: 'Payment not received yet' },
				{ status: 402 }
			);
		}

		const userIP =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For')?.split(',')[0] ||
			'unknown';
		const uploaderHashIp = await hashIP(userIP);

		const fileKey = generateFileKey();
		const partsTotal = calculateParts(fileSize);
		const expiresAt = Date.now() + planConfig.days * 24 * 60 * 60 * 1000;

		// Get pending record to preserve private_key
		const pendingRecord = await db.select({ private_key: paidFiles.private_key, original_name: paidFiles.original_name })
			.from(paidFiles).where(eq(paidFiles.order_id, orderId)).limit(1).all();

		// Replace the pending order record with upload record
		await db.delete(paidFiles).where(eq(paidFiles.order_id, orderId));
		await db.insert(paidFiles).values({
			file_key: fileKey,
			order_id: orderId,
			original_name: pendingRecord[0]?.original_name,
			payment_address: order.paymentAddress,
			private_key: pendingRecord[0]?.private_key,
			channel_id: channelId,
			file_name: fileHash,
			file_size: fileSize,
			encrypted: encrypted ? 1 : 0,
			payment_tx: payment.txHash || orderId,
			payment_amount: order.amount,
			download_price: (Math.max(1, Math.ceil(fileSize / (1024 * 1024 * 1024))) * 0.01).toFixed(2),
			upload_status: 'uploading',
			parts_total: partsTotal,
			parts_done: 0,
			uploader_hash_ip: uploaderHashIp,
			expires_at: expiresAt,
			created_at: Date.now()
		});

		return Response.json({
			success: true,
			data: { fileKey, partsTotal, expiresAt, plan: storagePlan }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
