import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { and, gte, eq } from 'drizzle-orm';
import { createPresignedUploadUrl, hashIP } from '$lib';
import { files } from '$lib/server/db/schema';

// 限流配置
const RATE_LIMIT = {
	MAX_FILES_PER_HOUR: 100, // 每小时最多上传 100 个文件
	MAX_FILES_PER_DAY: 500, // 每天最多上传 500 个文件
	MAX_SIZE_PER_HOUR: 1000 * 1024 * 1024, // 每小时最多 1000MB
	MAX_SIZE_PER_DAY: 10 * 1024 * 1024 * 1024, // 每天最多 10GB
	TIME_WINDOW_HOUR: 60 * 60 * 1000, // 1 小时（毫秒）
	TIME_WINDOW_DAY: 24 * 60 * 60 * 1000 // 24 小时（毫秒）
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const db = drizzle(platform!.env!.DB);

	try {
		const { fileSizeBytes } = await request.json();

		// 获取用户 IP 并哈希
		const userIP =
			request.headers.get('CF-Connecting-IP') ||
			request.headers.get('X-Forwarded-For')?.split(',')[0] ||
			'unknown';

		const uploader_hash_ip = await hashIP(userIP);

		// 检查限流
		const now = Date.now();
		const oneHourAgo = now - RATE_LIMIT.TIME_WINDOW_HOUR;
		const oneDayAgo = now - RATE_LIMIT.TIME_WINDOW_DAY;

		// 查询最近 1 小时内的上传记录
		const recentFilesHour = await db
			.select()
			.from(files)
			.where(and(eq(files.uploader_hash_ip, uploader_hash_ip), gte(files.created_at, oneHourAgo)))
			.all();

		// 查询最近 24 小时内的上传记录
		const recentFilesDay = await db
			.select()
			.from(files)
			.where(and(eq(files.uploader_hash_ip, uploader_hash_ip), gte(files.created_at, oneDayAgo)))
			.all();

		// 检查每小时文件数量限制
		if (recentFilesHour.length >= RATE_LIMIT.MAX_FILES_PER_HOUR) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_FILES_PER_HOUR} files per hour`,
					limit: {
						current: recentFilesHour.length,
						max: RATE_LIMIT.MAX_FILES_PER_HOUR,
						window: 'hour'
					}
				},
				{ status: 429 }
			);
		}

		// 检查每天文件数量限制
		if (recentFilesDay.length >= RATE_LIMIT.MAX_FILES_PER_DAY) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_FILES_PER_DAY} files per day`,
					limit: {
						current: recentFilesDay.length,
						max: RATE_LIMIT.MAX_FILES_PER_DAY,
						window: 'day'
					}
				},
				{ status: 429 }
			);
		}

		// 检查每小时总大小限制
		const totalSizeHour = recentFilesHour.reduce((sum, f) => sum + (f.file_size || 0), 0);
		const proposedTotalSize = totalSizeHour + fileSizeBytes;

		if (proposedTotalSize > RATE_LIMIT.MAX_SIZE_PER_HOUR) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_SIZE_PER_HOUR / 1024 / 1024}MB per hour`,
					limit: {
						current: totalSizeHour,
						max: RATE_LIMIT.MAX_SIZE_PER_HOUR,
						requested: fileSizeBytes,
						window: 'hour',
						unit: 'bytes'
					}
				},
				{ status: 429 }
			);
		}

		const totalSizeDay = recentFilesDay.reduce((sum, f) => sum + (f.file_size || 0), 0);
		const proposedTotalSizeDay = totalSizeDay + fileSizeBytes;
		if (proposedTotalSizeDay > RATE_LIMIT.MAX_SIZE_PER_DAY) {
			return Response.json(
				{
					success: false,
					error: `Rate limit exceeded: Maximum ${RATE_LIMIT.MAX_SIZE_PER_DAY / 1024 / 1024}MB per day`,
					limit: {
						current: totalSizeDay,
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
		const result = await createPresignedUploadUrl(platform?.env, fileSizeBytes);
		return Response.json({
			success: true,
			data: result,
			limit: {
				fileSize: {
					hour: {
						current: totalSizeHour,
						max: RATE_LIMIT.MAX_SIZE_PER_HOUR,
						requested: fileSizeBytes,
						window: 'hour',
						unit: 'bytes'
					},
					day: {
						current: totalSizeHour,
						max: RATE_LIMIT.MAX_SIZE_PER_DAY,
						requested: fileSizeBytes,
						window: 'day',
						unit: 'bytes'
					}
				},
				files: {
					day: {
						current: recentFilesDay.length,
						max: RATE_LIMIT.MAX_FILES_PER_DAY,
						window: 'day'
					},
					hour: {
						current: recentFilesHour.length,
						max: RATE_LIMIT.MAX_FILES_PER_HOUR,
						window: 'hour'
					}
				}
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
