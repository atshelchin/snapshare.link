<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	import { useI18n } from '@shelchin/i18n/svelte';

	const i18n = useI18n();
	let channel_id = $state('');

	const handleEnter = () => {
		const url = resolve(`/channel/${channel_id}`);
		if (channel_id != '') {
			goto(url);
		}
	};
</script>

<div class="container">
	<div class="room-input-group">
		<input
			bind:value={channel_id}
			type="text"
			id="roomInput"
			data-lang="roomPlaceholder"
			placeholder={i18n.t('app.inputtips')}
			autocomplete="off"
		/>
	</div>
	<button class="button-primary button" onclick={handleEnter}> {i18n.t('app.enter')}</button>
	<p class="tips" style=" color: #666; font-size: 14px;" data-lang="welcomeTip">
		{i18n.t('app.tips')}
	</p>
</div>

<style>
	.container {
		text-align: center;
	}
	.room-input-group {
		margin: 30px 0;
	}
	.room-input-group input {
		width: 100%;
		padding: 15px 20px;
		font-size: 18px;
		border: 2px solid var(--border-color);
		border-radius: 10px;
		text-align: center;
		transition: border 0.3s;
		/* background: var(--container-bg); */
		background-color: var(--color-panel-1);
		color: var(--text-primary);
	}
	.room-input-group input:focus {
		outline: none;
		border-color: var(--brand-400);
	}

	.tips {
		margin-top: 160px;
	}
	@media (max-width: 768px) {
		.room-input-group {
			margin-top: 100px;
		}
	}
</style>
