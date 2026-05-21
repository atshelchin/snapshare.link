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
	let encrypted = $state(false);

	// 注册流程状态
	let showRegister = $state(false);
	let registerName = $state('');

	const handleEnter = async () => {
		if (!channel_id.trim()) return;

		if (!encrypted) {
			goto(resolve(`/channel/${channel_id}`));
			return;
		}

		// Encrypted flow
		if (!isWebAuthnSupported()) {
			privacyError = i18n.t('privacy.webauthnNotSupported');
			return;
		}

		privacyLoading = true;
		privacyError = '';

		try {
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

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter') handleEnter();
	};
</script>

<div class="container">
	<div class="input-row">
		<input
			bind:value={channel_id}
			onkeydown={handleKeydown}
			type="text"
			placeholder={i18n.t('app.inputtips')}
			autocomplete="off"
		/>
		<button
			class="lock-toggle"
			class:active={encrypted}
			onclick={() => (encrypted = !encrypted)}
			title={encrypted ? i18n.t('privacy.encrypted') : i18n.t('app.privateChannel')}
		>
			{#if encrypted}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
					<path d="M7 11V7a5 5 0 0 1 10 0v4" />
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
					<path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" />
				</svg>
			{/if}
		</button>
	</div>

	{#if encrypted}
		<div class="encrypt-hint">{i18n.t('privacy.encrypted')}</div>
	{/if}

	<button class="button button-primary enter-btn" onclick={handleEnter} disabled={privacyLoading || !channel_id.trim()}>
		{#if privacyLoading}
			{i18n.t('privacy.authenticating')}
		{:else}
			{i18n.t('app.enter')}
		{/if}
	</button>

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

	<p class="tips">{i18n.t('app.tips')}</p>

	<a href="/vault" class="vault-link">
		📦 {i18n.t('vault.title')} · {i18n.t('vault.vaultBrief')} →
	</a>
</div>

<style>
	.container {
		text-align: center;
	}

	.input-row {
		margin: 30px 0 var(--space-4);
		display: flex;
		align-items: center;
		gap: 0;
		border: 2px solid var(--border-color);
		border-radius: 10px;
		background-color: var(--color-panel-1);
		transition: border 0.3s;
	}

	.input-row:focus-within {
		border-color: var(--brand-400);
	}

	.input-row input {
		flex: 1;
		padding: 15px 20px;
		font-size: 18px;
		border: none;
		border-radius: 10px 0 0 10px;
		text-align: center;
		background: transparent;
		color: var(--text-primary);
		outline: none;
	}

	.lock-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		margin-right: 4px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
		opacity: 0.4;
	}

	.lock-toggle:hover {
		opacity: 0.7;
	}

	.lock-toggle.active {
		color: var(--brand-600);
		opacity: 1;
	}

	.encrypt-hint {
		font-size: var(--text-xs);
		color: var(--brand-600);
		margin-top: calc(-1 * var(--space-2));
		margin-bottom: var(--space-3);
	}

	.enter-btn {
		width: 100%;
	}

	.enter-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

	.tips {
		margin-top: 30px;
		color: #666;
		font-size: 14px;
	}

	.vault-link {
		display: inline-block;
		margin-top: var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
		text-decoration: none;
		transition: color 0.2s;
	}

	.vault-link:hover {
		color: var(--brand-600);
	}

	@media (max-width: 768px) {
		.input-row {
			margin-top: 100px;
		}
	}
</style>
