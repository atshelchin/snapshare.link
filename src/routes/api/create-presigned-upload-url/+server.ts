import type { RequestHandler } from './$types';
import { createPresignedUploadUrl, hashIP } from '$lib';

// 限流配置
const RATE_LIMIT = {
	MAX_FILES_PER_HOUR: 100, // 每小时最多上传 100 个文件
	MAX_FILES_PER_DAY: 500, // 每天最多上传 500 个文件
	MAX_SIZE_PER_HOUR: 1000 * 1024 * 1024, // 每小时最多 1000MB
	MAX_SIZE_PER_DAY: 10 * 1024 * 1024 * 1024 // 每天最多 10GB
};

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = platform?.env;
		const { files } = await request.json();

		const fileSizeBytes = files.reduce((acc: number, size: number) => acc + size);

		// 获取用户 IP 并哈希
		const userIP =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For')?.split(',')[0] ||
			'unknown';

		const uploader_hash_ip = await hashIP(userIP);

		// 检查限流
		const now = new Date();

		const time = new Date(now.getTime());
		const prefixHour = time.toISOString().slice(0, 13);
		const prefixDay = time.toISOString().slice(0, 10);
		const KeyDay = uploader_hash_ip + ':' + prefixDay;
		const KeyHour = uploader_hash_ip + ':' + prefixHour;

		const valueHour = JSON.parse(await env.KV.get(KeyHour)) || {
			fileSizeHour: 0,
			fileCountHour: 0
		};

		const valueDay = JSON.parse(await env.KV.get(KeyDay)) || {
			fileSizeDay: 0,
			fileCountDay: 0
		};

		console.log({ valueDay, valueHour });
		// 检查每小时文件数量限制
		if (valueHour.fileCountHour >= RATE_LIMIT.MAX_FILES_PER_HOUR) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_FILES_PER_HOUR} files per hour`,
					limit: {
						current: valueHour.fileCountHour,
						max: RATE_LIMIT.MAX_FILES_PER_HOUR,
						window: 'hour'
					}
				},
				{ status: 429 }
			);
		}

		// 检查每天文件数量限制
		if (valueDay.fileCountDay >= RATE_LIMIT.MAX_FILES_PER_DAY) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_FILES_PER_DAY} files per day`,
					limit: {
						current: valueDay.fileCountDay,
						max: RATE_LIMIT.MAX_FILES_PER_DAY,
						window: 'day'
					}
				},
				{ status: 429 }
			);
		}

		// 检查每小时总大小限制
		if (valueHour.fileSizeHour + fileSizeBytes > RATE_LIMIT.MAX_SIZE_PER_HOUR) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_SIZE_PER_HOUR / 1024 / 1024}MB per hour`,
					limit: {
						current: valueHour.fileSizeHour,
						max: RATE_LIMIT.MAX_SIZE_PER_HOUR,
						requested: fileSizeBytes,
						window: 'hour',
						unit: 'bytes'
					}
				},
				{ status: 429 }
			);
		}
		// 检查每天总大小限制
		if (valueDay.fileSizeDay + fileSizeBytes > RATE_LIMIT.MAX_SIZE_PER_DAY) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_SIZE_PER_DAY / 1024 / 1024}MB per day`,
					limit: {
						current: valueDay.fileSizeDay,
						max: RATE_LIMIT.MAX_SIZE_PER_HOUR,
						requested: fileSizeBytes,
						window: 'day',
						unit: 'bytes'
					}
				},
				{ status: 429 }
			);
		}

		// 通过限流检查，生成预签名 URL

		const uploadUrlData = [];
		for (let i = 0; i < files.length; i++) {
			const result = await createPresignedUploadUrl(platform?.env, files[i]);
			uploadUrlData.push(result);
		}

		const newValueDay = {
			fileSizeDay: valueDay.fileSizeDay + fileSizeBytes,
			fileCountDay: valueDay.fileCountDay + files.length
		};
		const newValueHour = {
			fileSizeHour: valueHour.fileSizeHour + fileSizeBytes,
			fileCountHour: valueHour.fileCountHour + files.length
		};

		await env.KV.put(KeyDay, JSON.stringify(newValueDay), { expirationTtl: 24 * 60 * 60 });
		await env.KV.put(KeyHour, JSON.stringify(newValueHour), { expirationTtl: 60 * 60 });

		return Response.json({
			success: true,
			data: uploadUrlData,
			limit: {
				day: newValueDay,
				hour: newValueHour
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
