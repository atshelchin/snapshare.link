import type { RequestHandler } from './$types';
import { FILE_VALIDATION, createPresignedUploadUrl, formatUploadLimitSize, hashIP } from '$lib';
import type { Env, UploadUrlData } from '$lib';

type UploadEnv = Env & {
	KV: {
		get: (key: string) => Promise<string | null>;
		put: (key: string, value: string, options?: { expirationTtl: number }) => Promise<void>;
	};
};

interface HourLimitState {
	fileSizeHour: number;
	fileCountHour: number;
}

interface DayLimitState {
	fileSizeDay: number;
	fileCountDay: number;
}

interface GlobalHourLimitState {
	globalFileSizeHour: number;
}

function parseLimitState<T>(value: string | null, fallback: T): T {
	if (!value) return fallback;

	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

// 限流配置
const MAX_UPLOAD_BATCH_SIZE = FILE_VALIDATION.MAX_FILES * FILE_VALIDATION.MAX_FILE_SIZE;

const RATE_LIMIT = {
	MAX_FILES_PER_HOUR: FILE_VALIDATION.MAX_FILES,
	MAX_FILES_PER_DAY: FILE_VALIDATION.MAX_FILES * 5,
	MAX_SIZE_PER_HOUR: MAX_UPLOAD_BATCH_SIZE,
	MAX_SIZE_PER_DAY: MAX_UPLOAD_BATCH_SIZE,
	GLOBAL_MAX_SIZE_PER_HOUR: MAX_UPLOAD_BATCH_SIZE
};

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const env = (platform as { env?: UploadEnv } | undefined)?.env;
		if (!env) {
			return Response.json(
				{ success: false, error: 'Missing platform environment' },
				{ status: 500 }
			);
		}

		const { files } = (await request.json()) as { files?: unknown };

		if (!Array.isArray(files)) {
			return Response.json({ success: false, error: 'Invalid files payload' }, { status: 400 });
		}

		if (files.length > FILE_VALIDATION.MAX_FILES) {
			return Response.json(
				{
					success: false,
					error: `Maximum ${FILE_VALIDATION.MAX_FILES} files allowed`
				},
				{ status: 400 }
			);
		}

		const invalidFileSize = files.find(
			(size) =>
				typeof size !== 'number' ||
				!Number.isFinite(size) ||
				size <= 0 ||
				size > FILE_VALIDATION.MAX_FILE_SIZE
		);
		if (invalidFileSize !== undefined) {
			return Response.json(
				{
					success: false,
					error: `Each file must be between 1 byte and ${formatUploadLimitSize()}`
				},
				{ status: 400 }
			);
		}

		const fileSizes = files as number[];
		const fileSizeBytes = fileSizes.reduce((acc, size) => acc + size, 0);

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
		const GlobalKeyHour = 'global:' + prefixHour;

		const valueHour = parseLimitState<HourLimitState>(await env.KV.get(KeyHour), {
			fileSizeHour: 0,
			fileCountHour: 0
		});

		const valueDay = parseLimitState<DayLimitState>(await env.KV.get(KeyDay), {
			fileSizeDay: 0,
			fileCountDay: 0
		});

		const globalValueHour = parseLimitState<GlobalHourLimitState>(await env.KV.get(GlobalKeyHour), {
			globalFileSizeHour: 0
		});

		console.log({ valueDay, valueHour, globalValueHour });

		// 检查全站每小时总大小限制
		if (globalValueHour.globalFileSizeHour + fileSizeBytes > RATE_LIMIT.GLOBAL_MAX_SIZE_PER_HOUR) {
			return Response.json(
				{
					success: false,
					error: `Global rate limit exceeded: Maximum ${formatUploadLimitSize(RATE_LIMIT.GLOBAL_MAX_SIZE_PER_HOUR)} per hour for all users`,
					limit: {
						current: globalValueHour.globalFileSizeHour,
						max: RATE_LIMIT.GLOBAL_MAX_SIZE_PER_HOUR,
						requested: fileSizeBytes,
						window: 'hour',
						unit: 'bytes',
						scope: 'global'
					}
				},
				{ status: 429 }
			);
		}

		// 检查每小时文件数量限制
		if (valueHour.fileCountHour + fileSizes.length > RATE_LIMIT.MAX_FILES_PER_HOUR) {
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
		if (valueDay.fileCountDay + fileSizes.length > RATE_LIMIT.MAX_FILES_PER_DAY) {
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
					error: `Rate limit exceeded: Maximum ${formatUploadLimitSize(RATE_LIMIT.MAX_SIZE_PER_HOUR)} per hour`,
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
					error: `Rate limit exceeded: Maximum ${formatUploadLimitSize(RATE_LIMIT.MAX_SIZE_PER_DAY)} per day`,
					limit: {
						current: valueDay.fileSizeDay,
						max: RATE_LIMIT.MAX_SIZE_PER_DAY,
						requested: fileSizeBytes,
						window: 'day',
						unit: 'bytes'
					}
				},
				{ status: 429 }
			);
		}

		// 通过限流检查，生成预签名 URL

		const uploadUrlData: UploadUrlData[] = [];
		for (let i = 0; i < fileSizes.length; i++) {
			const result = await createPresignedUploadUrl(env, fileSizes[i]);
			uploadUrlData.push(result);
		}

		const newValueDay = {
			fileSizeDay: valueDay.fileSizeDay + fileSizeBytes,
			fileCountDay: valueDay.fileCountDay + fileSizes.length
		};
		const newValueHour = {
			fileSizeHour: valueHour.fileSizeHour + fileSizeBytes,
			fileCountHour: valueHour.fileCountHour + fileSizes.length
		};
		const newGlobalValueHour = {
			globalFileSizeHour: globalValueHour.globalFileSizeHour + fileSizeBytes
		};

		await env.KV.put(KeyDay, JSON.stringify(newValueDay), { expirationTtl: 24 * 60 * 60 });
		await env.KV.put(KeyHour, JSON.stringify(newValueHour), { expirationTtl: 60 * 60 });
		await env.KV.put(GlobalKeyHour, JSON.stringify(newGlobalValueHour), { expirationTtl: 60 * 60 });

		return Response.json({
			success: true,
			data: uploadUrlData,
			limit: {
				day: newValueDay,
				hour: newValueHour,
				global: newGlobalValueHour
			}
		});
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
