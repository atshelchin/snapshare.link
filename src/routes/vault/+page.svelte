<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useI18n } from '@shelchin/i18n/svelte';
	import VaultUploader from '../../components/vault-uploader.svelte';
	import { downloadAndDecrypt, isFileSystemAccessSupported, type DownloadProgress } from '$lib/vault-download';
	import { decryptString } from '$lib/crypto';
	import {
		isWebAuthnSupported,
		registerPasskey,
		authenticateAndDeriveKey,
		getPasskeyDisplayName
	} from '$lib/passkeys';
	import { exportKeyToBase64Url, importKeyFromBase64Url } from '$lib/crypto';

	const i18n = useI18n();

	// Auth state
	let isAuthenticated = $state(false);
	let isAuthenticating = $state(false);
	let authError = $state('');
	let userName = $state('');
	let encryptionKey = $state<CryptoKey | null>(null);
	let vaultChannelId = $state('');

	// Registration
	let showRegister = $state(false);
	let registerName = $state('');

	// Use a fixed salt for vault so PRF always produces the same key per user
	const VAULT_SALT = 'snapshare-vault';
	const SESSION_KEY = 'vault-session';

	// Restore session on mount
	$effect(() => {
		const saved = sessionStorage.getItem(SESSION_KEY);
		if (saved) {
			try {
				const session = JSON.parse(saved);
				importKeyFromBase64Url(session.key).then((key) => {
					encryptionKey = key;
					vaultChannelId = session.channelId;
					userName = session.userName;
					isAuthenticated = true;
				});
			} catch {
				sessionStorage.removeItem(SESSION_KEY);
			}
		}
	});

	async function saveSession(key: CryptoKey, channelId: string, name: string) {
		const keyStr = await exportKeyToBase64Url(key);
		sessionStorage.setItem(SESSION_KEY, JSON.stringify({
			key: keyStr,
			channelId,
			userName: name
		}));
	}

	function logout() {
		sessionStorage.removeItem(SESSION_KEY);
		encryptionKey = null;
		vaultChannelId = '';
		userName = '';
		isAuthenticated = false;
		showRegister = false;
		authError = '';
	}

	async function authenticate() {
		if (!isWebAuthnSupported()) {
			authError = i18n.t('privacy.webauthnNotSupported');
			return;
		}

		isAuthenticating = true;
		authError = '';

		try {
			const { key, credentialId } = await authenticateAndDeriveKey(VAULT_SALT);
			encryptionKey = key;
			// Use credential ID hash as vault channel ID
			const keyStr = await exportKeyToBase64Url(key);
			vaultChannelId = 'vault-' + keyStr.slice(0, 16);
			const name = await getPasskeyDisplayName(credentialId);
			userName = name || '';
			isAuthenticated = true;
			await saveSession(key, vaultChannelId, userName);
		} catch (e: unknown) {
			const error = e as Error;
			if (error.message === 'PRF_NOT_SUPPORTED') {
				authError = i18n.t('privacy.prfNotSupported');
			} else {
				showRegister = true;
			}
		} finally {
			isAuthenticating = false;
		}
	}

	async function handleRegister() {
		if (!registerName.trim()) return;

		isAuthenticating = true;
		authError = '';

		try {
			await registerPasskey(registerName.trim());
			showRegister = false;
			const { key, credentialId } = await authenticateAndDeriveKey(VAULT_SALT);
			encryptionKey = key;
			const keyStr = await exportKeyToBase64Url(key);
			vaultChannelId = 'vault-' + keyStr.slice(0, 16);
			userName = registerName.trim();
			isAuthenticated = true;
			await saveSession(key, vaultChannelId, userName);
		} catch (regError: unknown) {
			const re = regError as Error;
			if (re.message === 'PRF_NOT_SUPPORTED') {
				authError = i18n.t('privacy.prfNotSupported');
			} else if (re.message?.startsWith('PUBLICKEY_STORE_FAILED')) {
				authError = re.message;
			} else {
				authError = i18n.t('privacy.authFailed');
			}
		} finally {
			isAuthenticating = false;
		}
	}

	// File list
	interface VaultFile {
		fileKey: string;
		fileHash: string;
		fileSize: number;
		encrypted: boolean;
		plan: string;
		expiresAt: number;
		createdAt: number;
		uploadStatus?: string;
		orderId?: string;
		originalName?: string;
		displayName?: string;
	}

	let vaultFiles = $state<VaultFile[]>([]);
	let isLoadingFiles = $state(false);
	let downloadingFile = $state<string | null>(null); // fileKey of currently downloading
	let downloadProgress = $state<DownloadProgress | null>(null);
	let downloadAbort = $state<AbortController | null>(null);

	async function loadFiles() {
		if (!vaultChannelId) return;
		isLoadingFiles = true;
		try {
			const resp = await fetch('/api/vault/list-files', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ channelId: vaultChannelId })
			});
			const data = await resp.json();
			if (data.success) {
				vaultFiles = data.data;
			}
		} catch {
			// ignore
		} finally {
			isLoadingFiles = false;
		}
	}

	// Load files when authenticated
	$effect(() => {
		if (isAuthenticated && vaultChannelId) {
			loadFiles();
		}
	});

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return (bytes / Math.pow(k, i)).toFixed(i > 2 ? 2 : 0) + ' ' + sizes[i];
	}

	function formatTimeLeft(expiresAt: number): string {
		const ms = expiresAt - Date.now();
		if (ms <= 0) return i18n.t('vault.expired');
		const hours = Math.floor(ms / 3600000);
		const days = Math.floor(hours / 24);
		if (days > 0) return `${days}d ${hours % 24}h`;
		return `${hours}h`;
	}

	async function handleDownload(file: VaultFile) {
		if (!encryptionKey || downloadingFile) return;

		if (!isFileSystemAccessSupported()) {
			alert('Please use Chrome or Edge for large file downloads.');
			return;
		}

		downloadingFile = file.fileKey;
		downloadProgress = null;

		const ctrl = new AbortController();
		downloadAbort = ctrl;

		const cdnUrl = `https://paid-cdn.snapshare.link/${file.fileKey}`;
		// Use hash as filename fallback (original name is encrypted in the file)
		const fileName = file.fileHash.slice(0, 12) + '.bin';

		try {
			await downloadAndDecrypt(
				cdnUrl,
				fileName,
				encryptionKey,
				(progress) => { downloadProgress = { ...progress }; },
				ctrl.signal
			);
		} catch {
			// error already reported via progress callback
		} finally {
			downloadingFile = null;
			downloadAbort = null;
		}
	}

	function cancelDownload() {
		downloadAbort?.abort();
	}

	function goHome() {
		goto(resolve('/'));
	}
</script>

{#if isAuthenticated && encryptionKey}
	<!-- Authenticated vault view -->
	<div class="vault-page">
		<div class="vault-header">
			<div class="vault-header-left">
				<h1 class="vault-title">📦 {i18n.t('vault.title')}{#if userName} · {userName}{/if}</h1>
			</div>
			<div class="vault-header-actions">
				<button class="btn btn-secondary btn-small" onclick={logout}>
					{i18n.t('vault.switchAccount')}
				</button>
				<button class="btn btn-secondary btn-small" onclick={goHome}>
					{i18n.t('app.channel.leave')}
				</button>
			</div>
		</div>

		<div class="vault-notice">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
				<path d="M7 11V7a5 5 0 0 1 10 0v4" />
			</svg>
			<span>{i18n.t('privacy.encrypted')}</span>
		</div>

		<div class="vault-content">
			<VaultUploader channelId={vaultChannelId} {encryptionKey} />
		</div>

		<!-- File list -->
		<div class="vault-files-section">
			<div class="vault-files-header">
				<h2 class="vault-files-title">{i18n.t('vault.myFiles')}</h2>
				<button class="btn btn-secondary btn-small" onclick={loadFiles}>
					{i18n.t('vault.refresh')}
				</button>
			</div>

			{#if isLoadingFiles}
				<div class="vault-files-empty">{i18n.t('channel.fileList.loading')}</div>
			{:else if vaultFiles.length === 0}
				<div class="vault-files-empty">{i18n.t('channel.fileList.empty')}</div>
			{:else}
				<div class="vault-files-list">
					{#each vaultFiles as file (file.fileKey)}
						<div class="vault-file-item">
							<div class="vault-file-info">
								<div class="vault-file-name">
									{#if file.uploadStatus === 'completed'}
										🔒
									{:else}
										⏳
									{/if}
									{file.originalName || file.fileHash.slice(0, 16) + '...'}
								</div>
								<div class="vault-file-meta">
									<span>{formatSize(file.fileSize)}</span>
									<span>·</span>
									<span>{file.plan}</span>
									<span>·</span>
									{#if file.uploadStatus === 'completed'}
										<span>{i18n.t('vault.expiresIn')} {formatTimeLeft(file.expiresAt)}</span>
									{:else}
										<span class="status-pending">{i18n.t('vault.uploadPending')}</span>
									{/if}
								</div>
							</div>
							<div class="vault-file-actions">
								{#if file.uploadStatus !== 'completed'}
									<span class="status-badge">{i18n.t('vault.paid')}</span>
								{:else if downloadingFile === file.fileKey && downloadProgress}
									<div class="download-progress-mini">
										<span>{Math.round(downloadProgress.percent)}%</span>
										<button class="btn btn-secondary btn-small" onclick={cancelDownload}>
											{i18n.t('vault.cancel')}
										</button>
									</div>
								{:else}
									<button
										class="btn btn-secondary btn-small"
										onclick={() => handleDownload(file)}
										disabled={!!downloadingFile}
									>
										{i18n.t('channel.fileItem.download')}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if downloadProgress && downloadProgress.status === 'downloading'}
				<div class="download-progress-bar">
					<div class="progress-header">
						<span>{i18n.t('vault.downloading')}</span>
						<span>{Math.round(downloadProgress.percent)}% ({downloadProgress.completedChunks}/{downloadProgress.totalChunks})</span>
					</div>
					<div class="progress-bar-container">
						<div class="progress-bar" style="width: {downloadProgress.percent}%"></div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<!-- Auth screen -->
	<div class="vault-auth">
		<div class="vault-auth-card">
			<div class="vault-auth-icon">📦</div>
			<h1 class="vault-auth-title">{i18n.t('vault.title')}</h1>
			<p class="vault-auth-subtitle">{i18n.t('vault.subtitle')}</p>

			{#if showRegister}
				<div class="register-section">
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
							disabled={!registerName.trim() || isAuthenticating}
						>
							{isAuthenticating ? i18n.t('privacy.registering') : i18n.t('privacy.register')}
						</button>
						<button class="button button-cancel" onclick={() => (showRegister = false)}>
							{i18n.t('modal.close')}
						</button>
					</div>
				</div>
			{:else}
				<button
					class="button button-primary vault-auth-btn"
					onclick={authenticate}
					disabled={isAuthenticating}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
					<span>
						{isAuthenticating ? i18n.t('privacy.authenticating') : i18n.t('vault.loginWithPasskey')}
					</span>
				</button>
			{/if}

			{#if authError}
				<div class="vault-auth-error">{authError}</div>
			{/if}

			<button class="vault-back-link" onclick={goHome}>
				← {i18n.t('app.channel.leave')}
			</button>
		</div>
	</div>
{/if}

<style>
	/* Vault page (authenticated) */
	.vault-page {
		max-width: 640px;
		margin: 0 auto;
	}

	.vault-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-6);
		padding: var(--space-4);
		background: var(--item-bg);
		border-radius: var(--radius-lg);
	}

	.vault-header-left {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.vault-header-actions {
		display: flex;
		gap: var(--space-2);
	}

	.vault-title {
		font-size: var(--text-xl);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin: 0;
	}

.vault-notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.1);
		border: 1px solid hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.3);
		border-radius: var(--radius-md);
		color: var(--color-primary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
	}

	.vault-content {
		padding: var(--space-6);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
	}

	/* Auth screen */
	.vault-auth {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
	}

	.vault-auth-card {
		text-align: center;
		max-width: 400px;
		width: 100%;
		padding: var(--space-8);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
	}

	.vault-auth-icon {
		font-size: 4rem;
		margin-bottom: var(--space-3);
	}

	.vault-auth-title {
		font-size: var(--text-2xl);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin: 0 0 var(--space-2) 0;
	}

	.vault-auth-subtitle {
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
		margin: 0 0 var(--space-6) 0;
	}

	.vault-auth-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		font-size: var(--text-base);
	}

	.vault-auth-error {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: hsla(0, 70%, 50%, 0.1);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.vault-back-link {
		display: block;
		margin-top: var(--space-4);
		background: none;
		border: none;
		color: var(--color-muted-foreground);
		cursor: pointer;
		font-size: var(--text-sm);
	}

	.vault-back-link:hover {
		color: var(--color-primary);
	}

	/* Register */
	.register-section {
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

	.btn.btn-secondary {
		background: #e0e0e0;
		color: #333;
		padding: 8px 16px;
		font-size: 13px;
		border: none;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 600;
	}

	.btn.btn-small {
		padding: 8px 16px;
		font-size: 13px;
	}

	/* Vault file list */
	.vault-files-section {
		margin-top: var(--space-8);
		padding-top: var(--space-6);
		border-top: 2px solid var(--color-border);
	}

	.vault-files-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-4);
	}

	.vault-files-title {
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin: 0;
	}

	.vault-files-empty {
		padding: var(--space-8);
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: var(--text-sm);
	}

	.vault-files-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.vault-file-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-4);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: border-color 0.2s ease;
	}

	.vault-file-item:hover {
		border-color: var(--color-primary);
	}

	.vault-file-info {
		flex: 1;
		min-width: 0;
	}

	.vault-file-name {
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		font-size: var(--text-sm);
		font-family: var(--font-family-mono, monospace);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vault-file-meta {
		display: flex;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--color-muted-foreground);
		margin-top: var(--space-1);
	}

	.vault-file-actions {
		flex-shrink: 0;
		margin-left: var(--space-3);
	}

	.status-pending { color: var(--color-primary); font-weight: var(--font-medium); }
	.status-badge { font-size: var(--text-xs); font-weight: var(--font-semibold); color: hsl(120, 50%, 40%); background: hsl(120, 50%, 92%); padding: 2px 8px; border-radius: var(--radius-full); }

	.download-progress-mini {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-primary);
		font-weight: var(--font-semibold);
	}

	.download-progress-bar {
		margin-top: var(--space-4);
		padding: var(--space-4);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
		margin-bottom: var(--space-2);
	}

	.progress-bar-container {
		height: 6px;
		background: var(--color-panel-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--color-primary), hsla(var(--brand-hue), var(--brand-saturation), 60%, 1));
		transition: width 0.3s ease;
		border-radius: var(--radius-full);
	}
</style>
