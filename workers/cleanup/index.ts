// Lightweight Cron Worker - calls /api/cleanup every minute
// Replaces snapshare-schedule-r2 and snapshare-schedule-d1

interface Env {
	CLEANUP_SECRET: string;
	CLEANUP_URL: string; // default: https://snapshare.link/api/cleanup
}

export default {
	async scheduled(controller: ScheduledController, env: Env) {
		const url = env.CLEANUP_URL || 'https://snapshare.link/api/cleanup';
		const resp = await fetch(url, {
			headers: { 'X-Cleanup-Secret': env.CLEANUP_SECRET || '' }
		});
		const data = await resp.json();
		console.log('cleanup result:', JSON.stringify(data));
	}
};
