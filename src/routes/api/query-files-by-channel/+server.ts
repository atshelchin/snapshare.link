import type { RequestHandler } from './$types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc } from 'drizzle-orm';
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
	const db = drizzle(platform?.env!.DB);
	try {
		const channel_id = url.searchParams.get('channel_id') ?? '';

		let channelFiles: ChannelFile[] = [];
		if (channel_id) {
			channelFiles = (await db
				.select()
				.from(files)
				.where(eq(files.channel_id, channel_id))
				.orderBy(desc(files.created_at))
				.limit(10)
				.all()) as ChannelFile[];
		}
		return Response.json({ success: true, data: { channel_id, channelFiles } });
	} catch (error) {
		return Response.json({ success: false, error: String(error) }, { status: 400 });
	}
};
