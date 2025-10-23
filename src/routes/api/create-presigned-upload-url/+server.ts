import type { RequestHandler } from './$types';

import { createPresignedUploadUrl } from '$lib';

export const POST: RequestHandler = async ({ request, platform }) => {
    try {
        console.log({ platform })
        const { fileSizeBytes } = await request.json();

        console.log({ fileSizeBytes })
        const result = await createPresignedUploadUrl(platform?.env, fileSizeBytes);
        return Response.json({ success: true, data: result });
    } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 400 });
    }
};
