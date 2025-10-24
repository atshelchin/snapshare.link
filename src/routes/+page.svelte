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

	.button-primary {
		background: var(--color-button-primary);
		color: var(--color-button-primary-foreground);
	}

	.button {
		padding: var(--space-2-5) var(--space-5);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	button:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 20px var(--button-hover-shadow-color);
	}

	.tips {
		margin-top: 160px;
	}
	@media (max-width: 768px) {
		.room-input-group {
			margin-top: 250px;
		}
	}
</style>
