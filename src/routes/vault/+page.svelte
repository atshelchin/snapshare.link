<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useI18n } from '@shelchin/i18n/svelte';
	import VaultUploader from '../../components/vault-uploader.svelte';
	import QRCode from '../../components/qr-code.svelte';
	import CopyButton from '../../components/copy-button.svelte';
	import { downloadAndDecryptWithToken, isFileSystemAccessSupported, type DownloadProgress } from '$lib/vault-download';
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
		partsTotal?: number;
		downloadPrice?: string;
		displayName?: string;
		downloadsUsed?: number;
		downloadsMax?: number;
	}

	let vaultFiles = $state<VaultFile[]>([]);
	let isLoadingFiles = $state(false);
	let downloadingFile = $state<string | null>(null);
	let downloadProgress = $state<DownloadProgress | null>(null);
	let downloadAbort = $state<AbortController | null>(null);
	let downloadSpeed = $state('');
	let downloadStartTime = 0;

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

	// Download payment state
	let downloadError = $state('');
	let downloadPayingFile = $state<VaultFile | null>(null);
	let downloadOrderId = $state('');
	let downloadPaymentAddress = $state('');
	let downloadPaymentAmount = $state('');
	let downloadPollingTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let downloadToken = $state('');
	let downloadsUsed = $state(0);
	let downloadsMax = $state(10);

	async function handleDownload(file: VaultFile) {
		if (!encryptionKey || downloadingFile) return;

		// Check memory token
		if (downloadToken && downloadPayingFile?.fileKey === file.fileKey) {
			await copyDownloadCommand(file);
			return;
		}

		// Check server for existing valid token
		try {
			const tokenResp = await fetch('/api/vault/check-download-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileKey: file.fileKey })
			});
			const tokenData = await tokenResp.json() as { success: boolean; data?: { hasToken: boolean; token?: string; downloadsUsed?: number; downloadsMax?: number } };
			if (tokenData.success && tokenData.data?.hasToken && tokenData.data.token) {
				downloadToken = tokenData.data.token;
				downloadsUsed = tokenData.data.downloadsUsed || 0;
				downloadsMax = tokenData.data.downloadsMax || 10;
				downloadPayingFile = file;
				cliModalFile = file;
				await copyDownloadCommand(file);
				return;
			}
		} catch { /* no existing token, proceed to payment */ }

		// No valid token — start payment flow
		downloadPayingFile = file;
		try {
			const resp = await fetch('/api/vault/create-download-order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileKey: file.fileKey })
			});
			const data = await resp.json() as { success: boolean; data?: { orderId?: string; paymentAddress?: string; amount?: string; alreadyPaid?: boolean; token?: string; downloadsUsed?: number; downloadsMax?: number }; error?: string };
			if (!data.success || !data.data) {
				downloadError = data.error || 'Failed to create download order';
				downloadPayingFile = null;
				return;
			}
			// Already paid — skip payment, go to download
			if (data.data.alreadyPaid && data.data.token) {
				downloadToken = data.data.token;
				downloadsUsed = data.data.downloadsUsed || 0;
				downloadsMax = data.data.downloadsMax || 10;
				cliModalFile = file;
				await copyDownloadCommand(file);
				return;
			}
			downloadOrderId = data.data.orderId || '';
			downloadPaymentAddress = data.data.paymentAddress || '';
			downloadPaymentAmount = data.data.amount || '';
			// Poll for payment
			downloadPollingTimer = setInterval(async () => {
				try {
					const checkResp = await fetch('/api/vault/check-download-payment', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ orderId: downloadOrderId })
					});
					const checkData = await checkResp.json() as { success: boolean; data?: { paid: boolean; token?: string; downloadsMax?: number } };
					if (checkData.success && checkData.data?.paid && checkData.data.token) {
						stopDownloadPolling();
						downloadToken = checkData.data.token;
						downloadsUsed = 0;
						downloadsMax = checkData.data.downloadsMax || 10;
						await startDownloadWithToken(file, checkData.data.token);
					}
				} catch { /* keep polling */ }
			}, 5000);
		} catch (e) {
			downloadError = String(e);
			downloadPayingFile = null;
		}
	}

	function stopDownloadPolling() {
		if (downloadPollingTimer) { clearInterval(downloadPollingTimer); downloadPollingTimer = null; }
	}

	function cancelDownloadPayment() {
		stopDownloadPolling();
		downloadPayingFile = null;
		downloadOrderId = '';
		downloadPaymentAddress = '';
		downloadPaymentAmount = '';
	}

	async function startDownloadWithToken(file: VaultFile, token: string, resumeExisting = false) {
		downloadPayingFile = null;
		if (!isFileSystemAccessSupported()) {
			// Show CLI modal instead
			await copyDownloadCommand(file);
			return;
		}
		downloadingFile = file.fileKey;
		downloadProgress = null;
		downloadSpeed = '';
		downloadStartTime = Date.now();

		const ctrl = new AbortController();
		downloadAbort = ctrl;

		const fileName = file.originalName || file.fileHash.slice(0, 12) + '.bin';

		try {
			await downloadAndDecryptWithToken(
				token,
				fileName,
				encryptionKey!,
				(progress) => {
					downloadProgress = { ...progress };
					const elapsed = (Date.now() - downloadStartTime) / 1000;
					if (elapsed > 0 && progress.completedChunks > 0) {
						const bytesPerSec = progress.completedChunks * 100 * 1024 * 1024 / elapsed;
						downloadSpeed = `${formatSize(bytesPerSec)}/s`;
					}
				},
				ctrl.signal,
				file.partsTotal,
				resumeExisting
			);
			// Show completion
			downloadProgress = { totalChunks: file.partsTotal || 0, completedChunks: file.partsTotal || 0, percent: 100, status: 'completed' };
			downloadsUsed++;
			loadFiles(); // refresh download counts
		} catch { /* error via progress callback */ }
		finally {
			downloadingFile = null;
			downloadAbort = null;
			downloadSpeed = '';
		}
	}

	function cancelDownload() {
		downloadAbort?.abort();
	}

	let cliCommand = $state('');
	let showCliModal = $state(false);
	let cliModalFile = $state<VaultFile | null>(null);

	async function copyDownloadCommand(file: VaultFile) {
		if (!encryptionKey) return;
		const keyStr = await exportKeyToBase64Url(encryptionKey);
		const name = file.originalName || file.fileHash.slice(0, 12) + '.bin';
		const tokenParam = downloadToken ? `&token=${downloadToken}` : '';
		const url = `https://snapshare.link/d#key=${keyStr}&file=${encodeURIComponent(file.fileKey)}&name=${encodeURIComponent(name)}&parts=${file.partsTotal}&plan=${file.plan}&hash=${file.fileHash}${tokenParam}`;
		cliCommand = `deno run -A jsr:@snapshare/download "${url}"`;
		cliModalFile = file;
		showCliModal = true;
	}

	let cliCopied = $state(false);

	async function copyCliToClipboard() {
		await navigator.clipboard.writeText(cliCommand);
		cliCopied = true;
		setTimeout(() => cliCopied = false, 2000);
	}

	let resumeOrderId = $state('');
	let resumeFileName = $state('');
	let resumeFileHash = $state('');

	function handleResumeUpload(file: VaultFile) {
		if (file.orderId) {
			resumeOrderId = file.orderId;
			resumeFileName = file.originalName || '';
			resumeFileHash = file.fileHash || '';
			document.querySelector('.vault-content')?.scrollIntoView({ behavior: 'smooth' });
		}
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
				<h1 class="vault-title">📦 {i18n.t('vault.title')}{#if userName} · {userName}{/if} <span class="alpha-badge">Alpha</span></h1>
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

		<div class="vault-alpha-notice">
			{i18n.t('vault.alphaNotice')}
		</div>

		<div class="vault-content">
			<VaultUploader channelId={vaultChannelId} {encryptionKey} {resumeOrderId} {resumeFileName} {resumeFileHash} onUploadComplete={loadFiles} />
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
									<button class="btn btn-secondary btn-small" onclick={() => handleResumeUpload(file)}>
										{i18n.t('vault.retry')}
									</button>
								{:else if downloadingFile === file.fileKey && downloadProgress && downloadProgress.status !== 'completed'}
									<div class="download-progress-inline">
										<div class="download-progress-top">
											<span>{Math.round(downloadProgress.percent)}% ({downloadProgress.completedChunks}/{downloadProgress.totalChunks})</span>
											<button class="btn btn-secondary btn-small" onclick={cancelDownload}>
												{i18n.t('vault.cancel')}
											</button>
										</div>
										<div class="progress-bar-container">
											<div class="progress-bar" style="width: {downloadProgress.percent}%"></div>
										</div>
										{#if downloadSpeed}
											<div class="download-speed">{downloadSpeed}</div>
										{/if}
									</div>
								{:else if downloadProgress && downloadProgress.status === 'completed' && downloadPayingFile?.fileKey === file.fileKey}
									<div class="download-complete-inline">
										<span>✅ {i18n.t('vault.downloadComplete')}</span>
										<span class="download-complete-name">{file.originalName || file.fileHash.slice(0, 12)}</span>
									</div>
								{:else}
									<button
										class="btn btn-secondary btn-small"
										onclick={() => handleDownload(file)}
										disabled={!!downloadingFile}
									>
										{i18n.t('channel.fileItem.download')}{#if file.downloadsUsed != null} · {file.downloadsUsed}/{file.downloadsMax}{:else} · {file.downloadPrice} USDC{/if}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

		</div>
	</div>

	{#if downloadPayingFile && downloadPaymentAddress}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cli-overlay" onclick={cancelDownloadPayment} onkeydown={(e) => e.key === 'Escape' && cancelDownloadPayment()}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="cli-modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
				<h3 class="cli-modal-title">{i18n.t('vault.payToDownload')}</h3>
				<p class="download-option-desc">
					{downloadPayingFile.originalName || downloadPayingFile.fileHash.slice(0, 16)} · {formatSize(downloadPayingFile.fileSize)}
				</p>

				<div class="payment-qr-wrap">
					<QRCode data={downloadPaymentAddress} size={160} />
				</div>

				<div class="payment-details">
					<div class="payment-row">
						<span>{i18n.t('vault.network')}</span>
						<span class="payment-value payment-chain">
							<svg width="14" height="14" viewBox="0 0 111 111" fill="none" xmlns="http://www.w3.org/2000/svg">
								<circle cx="55.5" cy="55.5" r="55.5" fill="white"/>
								<path d="M55.3909 93.2691C76.1977 93.2691 93.0591 76.4077 93.0591 55.6009C93.0591 34.7941 76.1977 17.9327 55.3909 17.9327C35.6631 17.9327 19.4756 33.1256 17.8027 52.4173H65.1877V58.7845H17.8027C19.4756 78.0762 35.6631 93.2691 55.3909 93.2691Z" fill="#0052FF"/>
							</svg>
							Base
						</span>
					</div>
					<div class="payment-row">
						<span>{i18n.t('vault.amount')}</span>
						<span class="payment-value" style="color: var(--color-primary); font-weight: 600;">{downloadPaymentAmount} USDC</span>
					</div>
					<div class="payment-row">
						<span>{i18n.t('vault.receiver')}</span>
						<span class="payment-value payment-address">{downloadPaymentAddress}</span>
					</div>
				</div>

				<CopyButton value={downloadPaymentAddress} label={i18n.t('vault.copyAddress')} />

				<div class="payment-polling">
					<div class="spinner"></div>
					<span>{i18n.t('vault.waitingPayment')}</span>
				</div>

				{#if downloadError}
					<div class="vault-error">{downloadError}</div>
				{/if}

				<button class="cli-close" onclick={cancelDownloadPayment}>
					{i18n.t('vault.cancel')}
				</button>
			</div>
		</div>
	{/if}

	{#if showCliModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cli-overlay" onclick={() => showCliModal = false} onkeydown={(e) => e.key === 'Escape' && (showCliModal = false)}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="cli-modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
				<h3 class="cli-modal-title">{i18n.t('vault.downloadMethod')}</h3>

				<div class="download-quota">
					{i18n.t('vault.downloadsRemaining')}: {downloadsMax - downloadsUsed} / {downloadsMax}
				</div>

				<div class="download-option download-option-recommended">
					<div class="download-option-badge">{i18n.t('vault.recommended')}</div>
					<div class="download-option-title">{i18n.t('vault.cliDownload')}</div>
					<p class="download-option-desc">{i18n.t('vault.cliDesc')}</p>
					<div class="cli-command-box">
						<code class="cli-command">{cliCommand}</code>
					</div>
					<button class="button button-primary" onclick={copyCliToClipboard}>
						{cliCopied ? '✅ Copied!' : i18n.t('vault.copyCommand')}
					</button>
					<p class="cli-install-hint">{i18n.t('vault.cliInstallHint')}</p>
				</div>

				<div class="download-option">
					<div class="download-option-title">{i18n.t('vault.browserDownload')}</div>
					<p class="download-option-desc">{i18n.t('vault.browserDesc')}</p>
					<div class="download-option-btns">
						<button class="button button-secondary" onclick={() => { showCliModal = false; if (downloadToken && cliModalFile) startDownloadWithToken(cliModalFile, downloadToken); }}>
							{i18n.t('vault.newDownload')}
						</button>
						<button class="button button-secondary" onclick={() => { showCliModal = false; if (downloadToken && cliModalFile) startDownloadWithToken(cliModalFile, downloadToken, true); }}>
							{i18n.t('vault.resumeDownload')}
						</button>
					</div>
				</div>

				<button class="cli-close" onclick={() => showCliModal = false}>
					{i18n.t('modal.close')}
				</button>
			</div>
		</div>
	{/if}
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
	.download-progress-inline {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	.download-progress-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--text-sm);
		color: var(--color-primary);
		font-weight: var(--font-semibold);
	}

	.download-speed {
		font-size: var(--text-xs);
		color: var(--color-muted-foreground);
		text-align: right;
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

	.alpha-badge {
		font-size: var(--text-xs); font-weight: var(--font-semibold);
		color: white; background: hsla(30, 90%, 50%, 0.9);
		padding: 1px 6px; border-radius: var(--radius-full);
		vertical-align: middle;
	}
	.vault-alpha-notice {
		font-size: var(--text-xs); color: var(--color-muted-foreground);
		padding: var(--space-2) var(--space-4);
		margin-bottom: var(--space-2);
		text-align: center;
		line-height: 1.5;
	}

	.download-complete-inline {
		display: flex; flex-direction: column; gap: 2px;
		font-size: var(--text-sm); color: hsl(120, 50%, 40%); font-weight: var(--font-medium);
	}
	.download-complete-name {
		font-size: var(--text-xs); color: var(--color-muted-foreground); font-weight: normal;
	}
	.download-quota {
		font-size: var(--text-sm); color: var(--color-muted-foreground);
		padding: var(--space-2) var(--space-3);
		background: var(--color-panel-2); border-radius: var(--radius-md);
		text-align: center;
	}

	/* Download payment modal */
	.payment-qr-wrap { display: flex; justify-content: center; padding: var(--space-2); background: white; border-radius: var(--radius-lg); }
	.payment-details { width: 100%; padding: var(--space-3); background: var(--color-panel-2); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-2); }
	.payment-row { display: flex; justify-content: space-between; font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.payment-value { font-weight: var(--font-medium); color: var(--color-foreground); }
	.payment-chain { display: inline-flex; align-items: center; gap: 4px; background: #0052ff; color: white; padding: 2px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); }
	.payment-address { font-family: var(--font-family-mono, monospace); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
	.payment-polling { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.spinner { width: 18px; height: 18px; border: 2px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.vault-error { padding: var(--space-3); background: hsla(0, 70%, 50%, 0.1); border: 1px solid var(--color-danger); border-radius: var(--radius-md); color: var(--color-danger); font-size: var(--text-sm); }

	/* CLI Download Modal */
	.cli-overlay {
		position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100;
		display: flex; align-items: center; justify-content: center; padding: var(--space-4);
	}
	.cli-modal {
		background: var(--color-panel-1); border: 1px solid var(--color-border);
		border-radius: var(--radius-xl); max-width: 520px; width: 100%;
		padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4);
		max-height: 90vh; overflow-y: auto;
	}
	.cli-modal-title { font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-foreground); margin: 0; }
	.download-option {
		padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg);
		display: flex; flex-direction: column; gap: var(--space-2);
	}
	.download-option-recommended {
		border-color: var(--color-primary); background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.05);
	}
	.download-option-badge {
		display: inline-block; width: fit-content;
		font-size: var(--text-xs); font-weight: var(--font-semibold);
		color: white; background: var(--color-primary);
		padding: 1px 8px; border-radius: var(--radius-full);
	}
	.download-option-title { font-weight: var(--font-semibold); color: var(--color-foreground); }
	.download-option-desc { font-size: var(--text-sm); color: var(--color-muted-foreground); margin: 0; }
	.download-option-btns { display: flex; gap: var(--space-2); }
	.cli-command-box {
		background: var(--color-panel-2); border: 1px solid var(--color-border);
		border-radius: var(--radius-md); padding: var(--space-3); overflow-x: auto;
	}
	.cli-command { font-size: var(--text-xs); word-break: break-all; white-space: pre-wrap; }
	.cli-install-hint { font-size: var(--text-xs); color: var(--color-muted-foreground); margin: 0; font-family: var(--font-family-mono, monospace); }
	.cli-close {
		background: none; border: none; color: var(--color-muted-foreground);
		cursor: pointer; font-size: var(--text-sm); text-align: center;
	}
	.cli-close:hover { color: var(--color-foreground); }
</style>
