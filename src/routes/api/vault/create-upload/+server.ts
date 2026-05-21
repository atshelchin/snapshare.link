import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { paidFiles } from '$lib/server/db/schema';
import { hashIP } from '$lib';
import {
	createMultipartUpload,
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

		// Check if this file already uploaded successfully (no re-payment needed)
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

		// Get order from KV
		const orderData = await env.KV.get(`vault-order:${orderId}`);
		if (!orderData) {
			return Response.json({ success: false, error: 'Order not found or expired' }, { status: 404 });
		}

		const order = JSON.parse(orderData);

		// Verify order belongs to this channel and file
		if (order.channelId !== channelId || order.fileHash !== fileHash) {
			return Response.json({ success: false, error: 'Order does not match' }, { status: 403 });
		}

		// Verify payment at the order's unique address
		const payment = await checkPaymentToAddress(order.paymentAddress, order.amount);
		if (!payment.paid) {
			return Response.json(
				{ success: false, error: 'Payment not received yet' },
				{ status: 402 }
			);
		}

		// Check if there's an existing incomplete upload for this order (resume)
		const existingUpload = await db
			.select()
			.from(paidFiles)
			.where(eq(paidFiles.payment_tx, payment.txHash || orderId))
			.limit(1)
			.all();

		if (existingUpload.length > 0 && existingUpload[0].upload_status !== 'completed') {
			return Response.json({
				success: true,
				data: {
					fileKey: existingUpload[0].file_key,
					uploadId: existingUpload[0].upload_id,
					partsTotal: existingUpload[0].parts_total,
					partsDone: existingUpload[0].parts_done,
					expiresAt: existingUpload[0].expires_at,
					resumed: true
				}
			});
		}

		const userIP =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For')?.split(',')[0] ||
			'unknown';
		const uploaderHashIp = await hashIP(userIP);

		const { uploadId, fileKey } = await createMultipartUpload(env, fileName, storagePlan);
		const partsTotal = calculateParts(fileSize);
		const expiresAt = Date.now() + planConfig.days * 24 * 60 * 60 * 1000;

		// Replace the pending order record (created in create-order) with real upload record
		await db.delete(paidFiles).where(eq(paidFiles.file_key, orderId));
		await db.insert(paidFiles).values({
			file_key: fileKey,
			order_id: orderId,
			payment_address: order.paymentAddress,
			channel_id: channelId,
			file_name: fileHash,
			file_size: fileSize,
			encrypted: encrypted ? 1 : 0,
			payment_tx: payment.txHash || orderId,
			payment_amount: order.amount,
			upload_id: uploadId,
			upload_status: 'uploading',
			parts_total: partsTotal,
			parts_done: 0,
			uploader_hash_ip: uploaderHashIp,
			expires_at: expiresAt,
			created_at: Date.now()
		});

		return Response.json({
			success: true,
			data: { fileKey, uploadId, partsTotal, expiresAt, plan: storagePlan }
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
