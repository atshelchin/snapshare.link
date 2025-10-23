<script lang="ts">
	import { resolve } from '$app/paths';

	let channel_id = $state('');
</script>

<input bind:value={channel_id} />

<a href={resolve(`/channel/${channel_id}`)}>进入房间</a>
