<script lang="ts">
	import { useI18n } from '@shelchin/i18n/svelte';
	import { encryptFile } from '$lib/crypto';
	// Payment address is per-order, fetched from server
	import QRCode from './qr-code.svelte';
	import CopyButton from './copy-button.svelte';

	const i18n = useI18n();
	import { PART_SIZE } from '$lib/vault';

	const partSize = PART_SIZE;

	type StoragePlan = '7d' | '30d';

	let { channelId, encryptionKey, resumeOrderId = '', resumeFileName = '', resumeFileHash = '', onUploadComplete } = $props<{
		channelId: string;
		encryptionKey: CryptoKey;
		resumeOrderId?: string;
		resumeFileName?: string;
		resumeFileHash?: string;
		onUploadComplete?: () => void;
	}>();

	// When resumeOrderId changes, enter resume mode — user needs to re-select the file
	let lastResumeOrderId = '';
	$effect(() => {
		if (resumeOrderId && resumeOrderId !== lastResumeOrderId) {
			lastResumeOrderId = resumeOrderId;
			selectedFile = null;
			fileKey = '';
			partsDone = 0;
			orderId = resumeOrderId;
			uploadState = 'failed';
			error = resumeFileName
				? i18n.t('vault.selectFileToResume') + '\n📄 ' + resumeFileName
				: i18n.t('vault.selectFileToResume');
		}
	});

	// State
	let selectedPlan = $state<StoragePlan>('7d');
	let selectedFile = $state<File | null>(null);
	let fileHash = $state('');
	let isHashing = $state(false);
	let pricing = $state<{
		sizeGB: number;
		billableGB: number;
		priceUSDC: string;
		partsTotal: number;
		storageDays: number;
		plan: StoragePlan;
	} | null>(null);
	let uploadState = $state<
		'idle' | 'pricing' | 'paying' | 'uploading' | 'paused' | 'completed' | 'failed'
	>('idle');
	let error = $state('');
	let isDragOver = $state(false);

	// Payment order
	let orderId = $state('');
	let paymentAddress = $state('');
	let pollingTimer = $state<ReturnType<typeof setInterval> | null>(null);

	// Upload tracking
	let fileKey = $state('');
	let partsTotal = $state(0);
	let partsDone = $state(0);
	let isPaused = $state(false);
	let abortController = $state<AbortController | null>(null);

	let uploadStartTime = $state(0);

	let overallProgress = $derived(
		partsTotal > 0 ? (partsDone / partsTotal) * 100 : 0
	);

	let uploadSpeedStr = $state('');
	let uploadTimeStr = $state('');

	function updateUploadStats() {
		if (!uploadStartTime || partsDone === 0) { uploadSpeedStr = ''; uploadTimeStr = ''; return; }
		const elapsed = (Date.now() - uploadStartTime) / 1000;
		const bytesPerSec = (partsDone * partSize) / elapsed;
		uploadSpeedStr = formatSize(bytesPerSec) + '/s';
		const remaining = Math.ceil((elapsed / partsDone) * (partsTotal - partsDone));
		const eM = Math.floor(elapsed / 60), eS = Math.floor(elapsed % 60);
		const rM = Math.floor(remaining / 60), rS = remaining % 60;
		const eStr = eM > 0 ? `${eM}m${eS}s` : `${eS}s`;
		const rStr = rM > 0 ? `${rM}m${rS}s` : `${rS}s`;
		uploadTimeStr = `${eStr} / ~${rStr}`;
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return (bytes / Math.pow(k, i)).toFixed(i > 2 ? 2 : 0) + ' ' + sizes[i];
	}

	// Compute SHA-256 hash of file (streaming, low memory)
	async function computeFileHash(file: File): Promise<string> {
		const CHUNK = 8 * 1024 * 1024; // 8MB chunks for hashing
		const chunks = Math.ceil(file.size / CHUNK);

		// For files > 256MB, hash first+last 128MB for speed
		if (file.size > 256 * 1024 * 1024) {
			const head = await file.slice(0, 128 * 1024 * 1024).arrayBuffer();
			const tail = await file.slice(-128 * 1024 * 1024).arrayBuffer();
			const combined = new Uint8Array(head.byteLength + tail.byteLength + 8);
			combined.set(new Uint8Array(head), 0);
			combined.set(new Uint8Array(tail), head.byteLength);
			// Include file size in hash for uniqueness
			new DataView(combined.buffer).setBigUint64(head.byteLength + tail.byteLength, BigInt(file.size));
			const hash = await crypto.subtle.digest('SHA-256', combined);
			return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
		}

		// Small files: hash entirely
		const buffer = await file.arrayBuffer();
		const hash = await crypto.subtle.digest('SHA-256', buffer);
		return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		selectFile(input.files[0]);
		input.value = '';
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		const files = event.dataTransfer?.files;
		if (files && files.length > 0) selectFile(files[0]);
	}

	async function selectFile(file: File) {
		selectedFile = file;
		isHashing = true;
		fileHash = '';
		try {
			fileHash = await computeFileHash(file);
		} catch {
			fileHash = `${file.name}-${file.size}-${file.lastModified}`;
		}
		isHashing = false;

		// If resuming with existing fileKey/uploadId (page refresh), go straight to upload
		if (fileKey && uploadId) {
			await startUpload();
			return;
		}

		// If resuming a paid order, verify file matches then upload
		if (orderId) {
			if (resumeFileHash && fileHash !== resumeFileHash) {
				error = i18n.t('vault.fileMismatch') + '\n📄 ' + (resumeFileName || '');
				uploadState = 'failed';
				selectedFile = null;
				return;
			}
			await startUpload();
			return;
		}
		await refreshPricing(file);
	}

	async function refreshPricing(file: File | null = selectedFile) {
		if (!file) return;
		uploadState = 'pricing';
		error = '';
		try {
			const resp = await fetch('/api/vault/calculate-price', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileSize: file.size, plan: selectedPlan })
			});
			const data = await resp.json();
			if (data.success) {
				pricing = data.data;
				uploadState = 'idle';
			} else {
				error = data.error;
				uploadState = 'failed';
			}
		} catch (e) {
			error = String(e);
			uploadState = 'failed';
		}
	}

	async function switchPlan(plan: StoragePlan) {
		selectedPlan = plan;
		if (selectedFile) await refreshPricing();
	}

	async function startPayment() {
		if (!pricing || !selectedFile) return;
		error = '';
		uploadState = 'paying';

		try {
			// Create order → get unique payment address
			const resp = await fetch('/api/vault/create-order', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channelId,
					fileName: selectedFile.name,
					fileSize: selectedFile.size,
					fileHash,
					plan: selectedPlan
				})
			});
			const data = await resp.json();
			if (!data.success) {
				error = data.error;
				uploadState = 'failed';
				return;
			}

			orderId = data.data.orderId;
			paymentAddress = data.data.paymentAddress;

			// Start polling for payment
			startPolling();
		} catch (e) {
			error = String(e);
			uploadState = 'failed';
		}
	}

	function startPolling() {
		stopPolling();
		pollingTimer = setInterval(async () => {
			try {
				const resp = await fetch('/api/vault/check-payment', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ orderId })
				});
				const data = await resp.json();
				if (data.success && data.data.paid) {
					stopPolling();
					await startUpload();
				}
			} catch {
				// Keep polling
			}
		}, 5000);
	}

	function stopPolling() {
		if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
	}

	function cancelPayment() {
		stopPolling();
		uploadState = 'idle';
		orderId = '';
		paymentAddress = '';
		error = '';
	}

	async function startUpload() {
		if (!selectedFile) return;
		uploadState = 'uploading';
		error = '';
		uploadStartTime = Date.now();

		// If resuming from localStorage with existing fileKey, skip create-upload
		if (fileKey && partsTotal > 0) {
			isPaused = false;
			await uploadParts();
			return;
		}

		try {
			const resp = await fetch('/api/vault/create-upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					orderId,
					channelId,
					fileName: selectedFile.name,
					fileSize: selectedFile.size,
					fileHash,
					encrypted: true,
					plan: selectedPlan
				})
			});

			const data = await resp.json();
			if (!data.success) {
				error = data.error || 'Failed to create upload';
				uploadState = 'failed';
				return;
			}

			if (data.data.alreadyUploaded) {
				uploadState = 'completed';
				onUploadComplete?.();
				return;
			}

			fileKey = data.data.fileKey;
			partsTotal = data.data.partsTotal;
			partsDone = 0;
			isPaused = false;

			saveUploadState();
			await uploadParts();
		} catch (e) {
			error = String(e);
			uploadState = 'failed';
		}
	}

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 3000;
	const CONCURRENCY = 5;

	async function uploadPartWithRetry(partNum: number): Promise<void> {
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				await uploadSinglePart(partNum);
				return;
			} catch (e) {
				if (isPaused) throw new Error('paused');
				if (attempt < MAX_RETRIES) {
					await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
				} else {
					throw e;
				}
			}
		}
	}

	async function uploadParts() {
		if (!selectedFile) return;

		const remaining: number[] = [];
		for (let i = partsDone + 1; i <= partsTotal; i++) remaining.push(i);

		let failed = false;
		let failError = '';

		async function worker() {
			while (remaining.length > 0 && !failed && !isPaused) {
				const partNum = remaining.shift()!;
				try {
					await uploadPartWithRetry(partNum);
					partsDone++;
					updateUploadStats();
					saveUploadState();
				} catch (e) {
					if (isPaused || String(e) === 'Error: paused') return;
					failed = true;
					failError = `Part ${partNum}: ${e}`;
				}
			}
		}

		// Launch concurrent workers
		const workers = Array.from({ length: Math.min(CONCURRENCY, remaining.length) }, () => worker());
		await Promise.all(workers);

		if (isPaused) { uploadState = 'paused'; return; }
		if (failed) {
			error = failError;
			// Try recreating session
			try {
				error = i18n.t('vault.sessionExpired');
				await recreateUploadSession();
				await uploadParts(); // restart
			} catch {
				error = failError;
				uploadState = 'failed';
			}
			return;
		}

		// Complete with retries
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				const resp = await fetch('/api/vault/complete-upload', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fileKey, partsTotal, plan: selectedPlan })
				});
				const data = await resp.json();
				if (data.success) {
					uploadState = 'completed';
					onUploadComplete?.();
					clearUploadState();
					return;
				}
				if (attempt === MAX_RETRIES) { error = data.error; uploadState = 'failed'; return; }
			} catch (e) {
				if (attempt === MAX_RETRIES) { error = String(e); uploadState = 'failed'; return; }
			}
			error = `Complete failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`;
			await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
		}
	}

	async function recreateUploadSession(): Promise<void> {
		// Upload session expired (404) — create a new one via create-upload
		const resp = await fetch('/api/vault/create-upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				orderId, channelId,
				fileName: selectedFile!.name,
				fileSize: selectedFile!.size,
				fileHash, encrypted: true,
				plan: selectedPlan
			})
		});
		const data = await resp.json();
		if (!data.success) throw new Error(data.error || 'Failed to recreate upload session');
		fileKey = data.data.fileKey;
		partsTotal = data.data.partsTotal;
		partsDone = 0;
		saveUploadState();
	}

	async function uploadSinglePart(partNumber: number): Promise<void> {
		if (!selectedFile) throw new Error('No file');

		const urlResp = await fetch('/api/vault/get-part-url', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fileKey, partNumber, plan: selectedPlan })
		});
		const urlData = await urlResp.json();
		if (!urlData.success) throw new Error(urlData.error);

		const start = (partNumber - 1) * partSize;
		const end = Math.min(start + partSize, selectedFile.size);
		const chunk = selectedFile.slice(start, end);
		let chunkData: ArrayBuffer = await chunk.arrayBuffer();

		chunkData = await encryptFile(encryptionKey, chunkData);

		await new Promise<void>((resolve, reject) => {
			const ctrl = new AbortController();
			abortController = ctrl;
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', urlData.data.url);
			xhr.upload.addEventListener('progress', () => {});
			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve();
				else reject(new Error(`HTTP ${xhr.status}`));
			});
			xhr.addEventListener('error', () => reject(new Error('Network error')));
			xhr.addEventListener('abort', () => reject(new Error('Aborted')));
			ctrl.signal.addEventListener('abort', () => xhr.abort());
			xhr.send(new Blob([chunkData]));
		});

		abortController = null;
	}

	function pauseUpload() { isPaused = true; abortController?.abort(); }
	async function resumeUpload() { isPaused = false; uploadState = 'uploading'; await uploadParts(); }

	async function cancelUpload() {
		isPaused = true;
		abortController?.abort();
		clearUploadState();
		resetState();
	}

	async function retryUpload() { error = ''; uploadState = 'uploading'; isPaused = false; await uploadParts(); }

	function resetState() {
		selectedFile = null;
		fileHash = '';
		pricing = null;
		uploadState = 'idle';
		error = '';
		fileKey = '';
		partsTotal = 0;
		partsDone = 0;
		isPaused = false;
		orderId = '';
		paymentAddress = '';
		lastResumeOrderId = '';
	}

	function saveUploadState() {
		localStorage.setItem(`vault-upload:${channelId}`, JSON.stringify({
			fileKey, partsTotal, partsDone, plan: selectedPlan, orderId
		}));
	}

	function clearUploadState() { localStorage.removeItem(`vault-upload:${channelId}`); }

	// Restore in-progress upload after page refresh
	// Only restore orderId — server will handle session creation/resume
	function loadUploadState() {
		const saved = localStorage.getItem(`vault-upload:${channelId}`);
		if (!saved) return;
		try {
			const state = JSON.parse(saved);
			if (state.fileKey && state.partsDone < state.partsTotal) {
				fileKey = state.fileKey;
				partsTotal = state.partsTotal;
				partsDone = state.partsDone;
				orderId = state.orderId || '';
				selectedPlan = state.plan || '7d';
				uploadState = 'paused';
				error = '';
			} else {
				clearUploadState();
			}
		} catch {
			clearUploadState();
		}
	}

	$effect(() => {
		if (channelId) loadUploadState();
	});
</script>

<div class="vault-uploader">
	{#if uploadState === 'completed'}
		<div class="vault-complete">
			<div class="complete-icon">✅</div>
			<div class="complete-title">{i18n.t('vault.completed')}</div>
			<div class="complete-meta">{selectedFile?.name} · {selectedFile ? formatSize(selectedFile.size) : ''}</div>
			<button class="button button-primary" onclick={resetState} style="margin-top: var(--space-4);">
				{i18n.t('vault.selectFile')}
			</button>
		</div>

	{:else if uploadState === 'paying'}
		<!-- Payment view: unique address per order, auto-polling -->
		<div class="payment-view">
			<h3 class="payment-title">{i18n.t('vault.scanToPay')}</h3>

			<div class="payment-qr">
				<QRCode data={paymentAddress} size={180} />
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
					<span>{i18n.t('vault.token')}</span>
					<span class="payment-value">USDC</span>
				</div>
				<div class="payment-row payment-amount-row">
					<span>{i18n.t('vault.amount')}</span>
					<span class="payment-value payment-amount">${pricing?.priceUSDC} USDC</span>
				</div>
				<div class="payment-row">
					<span>{i18n.t('vault.receiver')}</span>
					<span class="payment-value payment-address">{paymentAddress}</span>
				</div>
			</div>

			<CopyButton value={paymentAddress} label={i18n.t('vault.copyAddress')} />

			<div class="payment-polling">
				<div class="spinner"></div>
				<span>{i18n.t('vault.waitingPayment')}</span>
			</div>

			{#if error}<div class="vault-error">{error}</div>{/if}

			<button class="button button-secondary" onclick={cancelPayment} style="width: 100%;">
				{i18n.t('vault.cancel')}
			</button>
		</div>

	{:else if uploadState === 'uploading' || uploadState === 'paused'}
		<div class="vault-progress">
			<div class="progress-header">
				<span class="progress-title">{i18n.t('vault.uploadProgress')}</span>
				<span class="progress-percent">{Math.round(overallProgress)}%</span>
			</div>
			<div class="progress-bar-container">
				<div class="progress-bar" style="width: {overallProgress}%"></div>
			</div>
			<div class="progress-meta">
				<span>{selectedFile?.name || i18n.t('vault.selectFileToResume')}</span>
				<span>{i18n.t('vault.partProgress').replace('{done}', String(partsDone)).replace('{total}', String(partsTotal))}</span>
			</div>
			{#if uploadTimeStr}
				<div class="progress-time">⏱ {uploadTimeStr} · {uploadSpeedStr}</div>
			{/if}
			{#if error}
				<div class="vault-warning">{error}</div>
			{/if}
			<div class="progress-actions">
				{#if uploadState === 'paused' && !selectedFile}
					<label class="button button-primary" style="cursor: pointer;">
						📁 {i18n.t('vault.selectFile')}
						<input type="file" hidden onchange={handleFileSelect} />
					</label>
				{:else if uploadState === 'paused'}
					<button class="button button-primary" onclick={resumeUpload}>{i18n.t('vault.resume')}</button>
				{:else}
					<button class="button button-secondary" onclick={pauseUpload}>{i18n.t('vault.pause')}</button>
				{/if}
				<button class="button button-danger" onclick={cancelUpload}>{i18n.t('vault.cancel')}</button>
			</div>
		</div>

	{:else if uploadState === 'failed'}
		<div class="vault-failed">
			<div class="vault-error" style="white-space: pre-line;">{error}</div>
			<div class="progress-actions">
				{#if fileKey && uploadId}
					<button class="button button-primary" onclick={retryUpload}>{i18n.t('vault.retry')}</button>
				{:else if orderId}
					<label class="button button-primary" style="cursor: pointer;">
						📁 {i18n.t('vault.selectFile')}
						<input type="file" hidden onchange={handleFileSelect} />
					</label>
				{/if}
				<button class="button button-secondary" onclick={resetState}>{i18n.t('vault.cancel')}</button>
			</div>
		</div>

	{:else}
		<!-- Plan selector -->
		<div class="plan-selector">
			<button class="plan-option" class:active={selectedPlan === '7d'} onclick={() => switchPlan('7d')}>
				<span class="plan-days">7 {i18n.t('vault.days')}</span>
				<span class="plan-price">$0.01/GB</span>
			</button>
			<button class="plan-option" class:active={selectedPlan === '30d'} onclick={() => switchPlan('30d')}>
				<span class="plan-days">30 {i18n.t('vault.days')}</span>
				<span class="plan-price">$0.1/GB</span>
			</button>
		</div>

		<!-- File drop zone -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="vault-dropzone" class:drag-over={isDragOver}
			ondragover={(e) => { e.preventDefault(); isDragOver = true; }}
			ondragleave={(e) => { e.preventDefault(); isDragOver = false; }}
			ondrop={handleDrop}
		>
			<input type="file" id="vaultFileInput" class="file-input-hidden" onchange={handleFileSelect} />
			<label for="vaultFileInput" class="vault-dropzone-label">
				<div class="vault-icon">📦</div>
				<div class="vault-dropzone-text">
					<div class="vault-dropzone-title">{i18n.t('vault.dragOrClick')}</div>
					<div class="vault-dropzone-hint">{i18n.t('vault.noSizeLimit')}</div>
				</div>
			</label>
		</div>

		{#if isHashing}
			<div class="hashing-indicator">
				<div class="spinner"></div>
				<span>{i18n.t('vault.computingHash')}</span>
			</div>
		{/if}

		{#if selectedFile && pricing && !isHashing}
			<div class="vault-pricing">
				<div class="pricing-row file-info-row">
					<span class="file-name-display">📄 {selectedFile.name}</span>
					<span class="pricing-value file-type-display">{selectedFile.type || 'unknown'}</span>
				</div>
				{#if fileHash}
					<div class="pricing-row">
						<span>SHA-256</span>
						<span class="pricing-value file-hash">{fileHash.slice(0, 16)}...</span>
					</div>
				{/if}
				<div class="pricing-row">
					<span>{i18n.t('vault.totalSize')}</span>
					<span class="pricing-value">{formatSize(selectedFile.size)} → {pricing.billableGB} GB</span>
				</div>
				<div class="pricing-row">
					<span>{i18n.t('vault.storageDuration')}</span>
					<span class="pricing-value">{pricing.storageDays} {i18n.t('vault.days')}</span>
				</div>
				<div class="pricing-row pricing-total">
					<span>{i18n.t('vault.totalPrice')}</span>
					<span class="pricing-value">${pricing.priceUSDC} USDC</span>
				</div>
			</div>

			<button class="button button-primary vault-pay-btn" onclick={startPayment}>
				💳 {i18n.t('vault.payAndUpload')} · ${pricing.priceUSDC} USDC
			</button>
		{/if}
	{/if}
</div>

<style>
	.vault-uploader { display: flex; flex-direction: column; gap: var(--space-4); }
	.file-input-hidden { display: none; }

	.plan-selector { display: flex; gap: var(--space-2); }
	.plan-option {
		flex: 1; padding: var(--space-3); border: 2px solid var(--color-border);
		border-radius: var(--radius-md); background: var(--color-panel-1);
		cursor: pointer; text-align: center; transition: all 0.2s ease;
	}
	.plan-option.active { border-color: var(--color-primary); background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.1); }
	.plan-option:hover:not(.active) { border-color: var(--color-muted-foreground); }
	.plan-days { display: block; font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-foreground); }
	.plan-price { display: block; font-size: var(--text-sm); color: var(--color-primary); margin-top: var(--space-1); }

	.vault-dropzone-label {
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		padding: var(--space-8); border: 2px dashed var(--color-border); border-radius: var(--radius-lg);
		background: var(--color-panel-1); cursor: pointer; transition: all 0.2s ease;
	}
	.vault-dropzone.drag-over .vault-dropzone-label, .vault-dropzone-label:hover { border-color: var(--color-primary); background: var(--color-panel-2); }
	.vault-dropzone.drag-over .vault-dropzone-label { border-style: solid; box-shadow: 0 0 0 3px hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.2); }
	.vault-icon { font-size: 2.5rem; margin-bottom: var(--space-2); }
	.vault-dropzone-text { text-align: center; }
	.vault-dropzone-title { font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-foreground); margin-bottom: var(--space-1); }
	.vault-dropzone-hint { font-size: var(--text-sm); color: var(--color-muted-foreground); }

	.hashing-indicator { display: flex; align-items: center; gap: var(--space-2); justify-content: center; color: var(--color-muted-foreground); font-size: var(--text-sm); }

	.file-info-row { padding-bottom: var(--space-2); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-1); }
	.file-name-display { font-weight: var(--font-semibold); color: var(--color-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
	.file-type-display { flex-shrink: 0; opacity: 0.6; }
	.file-hash { font-family: var(--font-family-mono, monospace); font-size: var(--text-xs); opacity: 0.6; }

	.vault-pricing { padding: var(--space-4); background: var(--color-panel-2); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-2); }
	.pricing-row { display: flex; justify-content: space-between; font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.pricing-total { font-weight: var(--font-semibold); color: var(--color-foreground); font-size: var(--text-base); padding-top: var(--space-2); border-top: 1px solid var(--color-border); }
	.pricing-value { font-weight: var(--font-medium); }
	.vault-pay-btn { width: 100%; padding: var(--space-4); font-size: var(--text-base); }

	/* Payment view */
	.payment-view { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); text-align: center; }
	.payment-title { font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-foreground); margin: 0; }
	.payment-qr { padding: var(--space-2); background: white; border-radius: var(--radius-lg); display: inline-block; }
	.payment-details { width: 100%; padding: var(--space-4); background: var(--color-panel-2); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-2); }
	.payment-row { display: flex; justify-content: space-between; font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.payment-value { font-weight: var(--font-medium); color: var(--color-foreground); }
	.payment-amount-row { padding: var(--space-2) 0; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
	.payment-amount { font-size: var(--text-lg); font-weight: var(--font-semibold); color: var(--color-primary); }
	.payment-chain { display: inline-flex; align-items: center; gap: 4px; background: #0052ff; color: white; padding: 2px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); }
	.payment-address { font-family: var(--font-family-mono, monospace); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 60%; }

	/* Progress */
	.vault-progress, .vault-failed, .vault-complete { display: flex; flex-direction: column; gap: var(--space-3); }
	.progress-header { display: flex; justify-content: space-between; align-items: center; }
	.progress-title { font-weight: var(--font-semibold); color: var(--color-foreground); }
	.progress-percent { font-weight: var(--font-semibold); color: var(--color-primary); font-size: var(--text-lg); }
	.progress-bar-container { height: 8px; background: var(--color-panel-2); border-radius: var(--radius-full); overflow: hidden; }
	.progress-bar { height: 100%; background: linear-gradient(90deg, var(--color-primary), hsla(var(--brand-hue), var(--brand-saturation), 60%, 1)); transition: width 0.3s ease; border-radius: var(--radius-full); }
	.progress-meta { display: flex; justify-content: space-between; font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.progress-time { font-size: var(--text-xs); color: var(--color-muted-foreground); text-align: right; }
	.progress-actions { display: flex; gap: var(--space-2); }
	.button-secondary { background: var(--color-panel-2); color: var(--color-foreground); border: 1px solid var(--color-border); }
	.button-danger { background: hsla(0, 70%, 50%, 0.1); color: var(--color-danger); border: 1px solid var(--color-danger); }
	.vault-error { padding: var(--space-3); background: hsla(0, 70%, 50%, 0.1); border: 1px solid var(--color-danger); border-radius: var(--radius-md); color: var(--color-danger); font-size: var(--text-sm); }
	.vault-warning { padding: var(--space-2) var(--space-3); background: hsla(40, 90%, 50%, 0.1); border: 1px solid hsla(40, 90%, 50%, 0.4); border-radius: var(--radius-md); color: hsla(40, 60%, 35%, 1); font-size: var(--text-xs); }
	.vault-complete { text-align: center; padding: var(--space-6); }
	.complete-icon { font-size: 3rem; margin-bottom: var(--space-2); }
	.complete-title { font-size: var(--text-xl); font-weight: var(--font-semibold); color: var(--color-foreground); }
	.complete-meta { font-size: var(--text-sm); color: var(--color-muted-foreground); }

	.payment-polling { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-muted-foreground); }
	.spinner { width: 18px; height: 18px; border: 2px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite; flex-shrink: 0; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
