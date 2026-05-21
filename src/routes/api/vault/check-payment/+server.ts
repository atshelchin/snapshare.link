import type { RequestHandler } from './$types';
import { checkPaymentToAddress } from '$lib/payment';

// Check if payment has been received at the order's unique address
export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env as Record<string, unknown>;
		const kv = env.KV as { get: (key: string) => Promise<string | null> };
		const { orderId } = await request.json();

		if (!orderId) {
			return Response.json({ success: false, error: 'Missing orderId' }, { status: 400 });
		}

		// Get order from KV
		const orderData = await kv.get(`vault-order:${orderId}`);
		if (!orderData) {
			return Response.json({ success: false, error: 'Order not found or expired' }, { status: 404 });
		}

		const order = JSON.parse(orderData);

		// Check if the unique address has received USDC
		const result = await checkPaymentToAddress(order.paymentAddress, order.amount);

		return Response.json({
			success: true,
			data: {
				paid: result.paid,
				txHash: result.txHash,
				paymentAddress: order.paymentAddress,
				amount: order.amount
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 500 });
	}
};
