import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, gt, and } from 'drizzle-orm';
import { files } from '$lib/server/db/schema';

type ChannelFile = {
	channel_id: string;
	file_key: string;
	file_name: string;
	file_type: string;
	file_size: number;
	uploader_hash_ip: string;
	created_at: number;
};

export const GET: RequestHandler = async ({ url, platform }) => {
	const channel_id = url.searchParams.get('channel_id');

	if (!channel_id) {
		return new Response('channel_id is required', { status: 400 });
	}

	const db = drizzle(platform?.env!.DB);

	// 创建 SSE 响应
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			// 发送 SSE 消息的辅助函数
			const sendEvent = (data: { type: string; data?: ChannelFile[]; error?: string }) => {
				const message = `data: ${JSON.stringify(data)}\n\n`;
				controller.enqueue(encoder.encode(message));
			};

			try {
				// 首次加载最新10条数据
				const initialFiles = (await db
					.select()
					.from(files)
					.where(eq(files.channel_id, channel_id))
					.orderBy(desc(files.created_at))
					.limit(10)
					.all()) as ChannelFile[];

				// 发送初始数据
				sendEvent({
					type: 'initial',
					data: initialFiles
				});

				// 记录最新的时间戳
				let lastTimestamp =
					initialFiles.length > 0 ? Math.max(...initialFiles.map((f) => f.created_at)) : Date.now();

				// 轮询检查新数据
				const intervalId = setInterval(async () => {
					try {
						// 查询比最后时间戳更新的文件，并且属于当前频道
						const newFiles = (await db
							.select()
							.from(files)
							.where(and(eq(files.channel_id, channel_id), gt(files.created_at, lastTimestamp)))
							.orderBy(desc(files.created_at))
							.all()) as ChannelFile[];

						if (newFiles.length > 0) {
							// 更新最新时间戳
							lastTimestamp = Math.max(...newFiles.map((f) => f.created_at));

							// 发送增量数据
							sendEvent({
								type: 'update',
								data: newFiles
							});
						}
					} catch (error) {
						console.error('Error polling for new files:', error);
					}
				}, 2000); // 每2秒检查一次

				// 监听客户端断开连接
				// @ts-expect-error - ReadableStreamDefaultController signal is not typed
				if (controller.signal) {
					// @ts-expect-error - ReadableStreamDefaultController signal is not typed
					controller.signal.addEventListener('abort', () => {
						clearInterval(intervalId);
					});
				}
			} catch (error) {
				sendEvent({
					type: 'error',
					error: String(error)
				});
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
