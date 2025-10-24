<script lang="ts">
	import { QrCode, LogOut, ScanQrCode } from '@lucide/svelte';
	import { useI18n } from '@shelchin/i18n/svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Modal from './modal.svelte';
	import CopyButton from './copy-button.svelte';
	import QRCode from './qr-code.svelte';

	const i18n = useI18n();
	let { channel_id } = $props();
	let basicModal = $state(false);
	const leave = () => {
		goto(resolve('/'));
	};
</script>

<div class="channel-info">
	<div class="channel-code-section">
		<div style="font-size: 12px; color: #666; margin-bottom: 5px;" data-lang="currentchannel">
			{i18n.t('app.channel.headertitle')}
		</div>
		<div class="channel-code" id="currentchannel">{channel_id}</div>
	</div>
	<div class="channel-actions">
		<button
			onclick={() => (basicModal = !basicModal)}
			class="btn btn-secondary btn-small"
			data-lang="qrBtn"
			><QrCode size={16} />
			<span style="margin-left:var(--space-1-5)">{i18n.t('app.channel.qr')}</span></button
		>
		<button onclick={leave} class="  btn-small btn-secondary btn" data-lang="leaveBtn"
			><LogOut size={16} /><span style="margin-left:var(--space-1-5)"
				>{i18n.t('app.channel.leave')}</span
			>
		</button>
	</div>
</div>
<Modal bind:open={basicModal} size="sm">
	<div class="qr-content">
		<h3 data-lang="qrTitle">
			<ScanQrCode /><span style="margin-left:var(--space-1-5)"
				>{i18n.t('app.channel.scantojoin')}</span
			>
		</h3>
		<div id="qrcode">
			<QRCode data={`https://snapshare.link/channel/${channel_id}`} size={160} />
		</div>
		<div class="qr-url" id="qrUrl">
			https://snapshare.link/channel/{channel_id}
		</div>
		<CopyButton
			label={i18n.t('app.channel.copylink')}
			value={`https://snapshare.link/channel/${channel_id}`}
		/>
	</div>
</Modal>

<style>
	.channel-info {
		background: var(--item-bg);
		padding: 15px;
		border-radius: 10px;
		margin-bottom: 20px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 15px;
	}
	@media (max-width: 768px) {
		.channel-info {
			flex-direction: column;
			align-items: stretch;
		}

		.channel-code-section {
			text-align: center;
		}
		.channel-code {
			font-size: 18px;
		}
		.channel-actions {
			justify-content: center;
			width: 100%;
		}
	}
	.channel-actions {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.channel-code {
		font-size: 24px;
		font-weight: bold;
		color: var(--brand-600);
	}

	.channel-code-section {
		flex: 1;
		min-width: 200px;
	}

	.btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 5px 10px var(--brand-200);
	}

	.btn.btn-small {
		padding: 8px 16px;
		font-size: 13px;
	}
	.btn.btn-secondary {
		background: #e0e0e0;
		color: #333;
		padding: 8px 20px;
		font-size: 14px;
	}
	.btn {
		display: flex;
		align-items: center;
		color: white;
		border: none;
		padding: 15px 40px;
		font-size: 16px;
		border-radius: 10px;
		cursor: pointer;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		font-weight: 600;
	}
	.qr-content {
		/* background: white; */

		border-radius: 20px;
		text-align: center;

		width: 100%;
	}
	.qr-content h3 {
		margin-bottom: 20px;
		/* color: #333; */
		display: flex;
		justify-content: center;
		align-items: center;
	}
	#qrcode {
		display: flex;
		justify-content: center;
		margin: 20px 0;
	}
	#qrcode img {
		padding: 4px;
		background-color: white;
	}

	.qr-url {
		background: var(--color-panel-2);
		padding: 10px;
		border-radius: 8px;
		font-size: 12px;
		word-break: break-all;
		margin-top: 15px;
		color: #666;
		margin-bottom: 8px;
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
</style>
