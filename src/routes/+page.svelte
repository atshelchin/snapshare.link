<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { useI18n } from '@shelchin/i18n/svelte';
	import {
		isWebAuthnSupported,
		registerPasskey,
		authenticateAndDeriveKey,
		getPasskeyDisplayName
	} from '$lib/passkeys';
	import { exportKeyToBase64Url } from '$lib/crypto';

	const i18n = useI18n();
	let channel_id = $state('');
	let privacyError = $state('');
	let privacyLoading = $state(false);

	// 注册流程状态
	let showRegister = $state(false);
	let registerName = $state('');

	const handleEnter = () => {
		const url = resolve(`/channel/${channel_id}`);
		if (channel_id != '') {
			goto(url);
		}
	};

	const handlePrivateChannel = async () => {
		if (!channel_id.trim()) return;

		if (!isWebAuthnSupported()) {
			privacyError = i18n.t('privacy.webauthnNotSupported');
			return;
		}

		privacyLoading = true;
		privacyError = '';

		try {
			// Try to authenticate with existing passkey + PRF
			const { key, credentialId } = await authenticateAndDeriveKey(channel_id);
			const keyStr = await exportKeyToBase64Url(key);
			const name = await getPasskeyDisplayName(credentialId);
			const byParam = name ? `&by=${encodeURIComponent(name)}` : '';
			goto(`/channel/${channel_id}#key=${keyStr}${byParam}`);
		} catch (e: unknown) {
			const error = e as Error;
			if (error.message === 'PRF_NOT_SUPPORTED') {
				privacyError = i18n.t('privacy.prfNotSupported');
			} else {
				// No passkey — show registration form
				showRegister = true;
			}
		} finally {
			privacyLoading = false;
		}
	};

	const handleRegister = async () => {
		if (!registerName.trim()) return;

		privacyLoading = true;
		privacyError = '';

		try {
			await registerPasskey(registerName.trim());
			showRegister = false;
			// After registration, authenticate with PRF to derive key
			const { key } = await authenticateAndDeriveKey(channel_id);
			const keyStr = await exportKeyToBase64Url(key);
			const byParam = `&by=${encodeURIComponent(registerName.trim())}`;
			goto(`/channel/${channel_id}#key=${keyStr}${byParam}`);
		} catch (regError: unknown) {
			const re = regError as Error;
			if (re.message === 'PRF_NOT_SUPPORTED') {
				privacyError = i18n.t('privacy.prfNotSupported');
			} else if (re.message?.startsWith('PUBLICKEY_STORE_FAILED')) {
				privacyError = re.message;
			} else {
				privacyError = i18n.t('privacy.authFailed');
			}
		} finally {
			privacyLoading = false;
		}
	};
</script>

<div class="container">
	<div class="room-input-group">
		<input
			bind:value={channel_id}
			type="text"
			id="roomInput"
			placeholder={i18n.t('app.inputtips')}
			autocomplete="off"
		/>
	</div>
	<div class="button-group">
		<button class="button-primary button" onclick={handleEnter}>{i18n.t('app.enter')}</button>
		<button
			class="button-privacy button"
			onclick={handlePrivateChannel}
			disabled={privacyLoading}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
				<path d="M7 11V7a5 5 0 0 1 10 0v4" />
			</svg>
			<span>{privacyLoading ? i18n.t('privacy.authenticating') : i18n.t('app.privateChannel')}</span>
		</button>
	</div>

	<div class="vault-entry">
		<a href="/vault" class="button-vault button">
			<span>📦</span>
			<span>{i18n.t('vault.title')}</span>
			<span class="vault-entry-sub">{i18n.t('vault.subtitle')}</span>
		</a>
	</div>

	{#if showRegister}
		<div class="register-card">
			<h4 class="register-title">{i18n.t('privacy.registerFirst')}</h4>
			<input
				bind:value={registerName}
				type="text"
				class="register-input"
				placeholder={i18n.t('privacy.enterName')}
				autocomplete="off"
			/>
			<div class="register-actions">
				<button
					class="button button-primary"
					onclick={handleRegister}
					disabled={!registerName.trim() || privacyLoading}
				>
					{privacyLoading ? i18n.t('privacy.registering') : i18n.t('privacy.register')}
				</button>
				<button class="button button-cancel" onclick={() => (showRegister = false)}>
					{i18n.t('modal.close')}
				</button>
			</div>
		</div>
	{/if}

	{#if privacyError}
		<div class="privacy-error">{privacyError}</div>
	{/if}

	<p class="tips" style="color: #666; font-size: 14px;">
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
		background-color: var(--color-panel-1);
		color: var(--text-primary);
	}
	.room-input-group input:focus {
		outline: none;
		border-color: var(--brand-400);
	}

	.button-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.button-privacy {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		background: transparent;
		color: var(--brand-600);
		border: 2px solid var(--brand-400);
		transition: all 0.2s ease;
		font-weight: 600;
	}

	.button-privacy:hover:not(:disabled) {
		background: var(--brand-600);
		border-color: var(--brand-600);
		color: white;
	}

	.button-privacy:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.register-card {
		margin-top: var(--space-4);
		padding: var(--space-5);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		text-align: left;
	}

	.register-title {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--text-base);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
	}

	.register-input {
		width: 100%;
		padding: 10px 14px;
		font-size: var(--text-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-panel-2);
		color: var(--color-foreground);
		margin-bottom: var(--space-3);
	}

	.register-input:focus {
		outline: none;
		border-color: var(--brand-400);
	}

	.register-actions {
		display: flex;
		gap: var(--space-2);
	}

	.button-cancel {
		background: var(--color-panel-2);
		color: var(--color-muted-foreground);
		border: 1px solid var(--color-border);
	}

	.privacy-error {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: hsla(0, 70%, 50%, 0.1);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	/* Vault entry */
	.vault-entry {
		margin-top: var(--space-6);
		padding-top: var(--space-6);
		border-top: 1px solid var(--color-border);
	}

	.button-vault {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		padding: var(--space-4);
		background: var(--color-panel-1);
		border: 2px solid var(--color-border);
		border-radius: 10px;
		color: var(--color-foreground);
		text-decoration: none;
		transition: all 0.2s ease;
		font-weight: 600;
	}

	.button-vault:hover {
		border-color: var(--brand-400);
		background: var(--color-panel-2);
	}

	.vault-entry-sub {
		font-size: var(--text-xs);
		font-weight: var(--font-normal);
		color: var(--color-muted-foreground);
	}

	.tips {
		margin-top: 40px;
	}
	@media (max-width: 768px) {
		.room-input-group {
			margin-top: 100px;
		}
	}
</style>
