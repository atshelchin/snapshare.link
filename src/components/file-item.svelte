<script lang="ts">
	import CopyButton from './copy-button.svelte';
	import AudioPlayer from './audio-player.svelte';
	import VideoPlayer from './video-player.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';
	import { decryptFile, decryptString, inferMimeType } from '$lib/crypto';

	interface FileItemData {
		channel_id: string;
		file_key: string;
		file_name: string;
		file_type: string | null;
		file_size: number | null;
		created_at: number;
	}

	let { file, encryptionKey = null, onImageClick } = $props<{
		file: FileItemData;
		encryptionKey?: CryptoKey | null;
		onImageClick?: (url: string) => void;
	}>();

	const i18n = useI18n();
	const fileUrl = `https://cdn.snapshare.link/${file.file_key}`;
	const isEncrypted = encryptionKey !== null;

	// 解密后的文件名和类型
	let decryptedName = $state('');
	let decryptedType = $state<string | null>(null);
	let isDecryptingName = $state(false);

	// 解密后的预览 blob URL
	let decryptedBlobUrl = $state<string | null>(null);
	let isDecryptingContent = $state(false);

	// 显示用的文件名和类型
	let displayName = $derived(isEncrypted ? (decryptedName || '...') : file.file_name);
	let displayType = $derived(isEncrypted ? decryptedType : file.file_type);

	// 判断文件类型（基于 displayType）
	let isImage = $derived(displayType?.startsWith('image/') ?? false);
	let isAudio = $derived(displayType?.startsWith('audio/') ?? false);
	let isVideo = $derived(displayType?.startsWith('video/') ?? false);
	let isText = $derived(displayType?.startsWith('text/') ?? false);

	// 获取文件类型图标
	function getFileIcon(type: string | null): string {
		if (!type) return '📎';
		if (type.startsWith('image/')) return '🖼️';
		if (type.startsWith('video/')) return '🎬';
		if (type.startsWith('audio/')) return '🎵';
		if (type.startsWith('text/')) return '📄';
		if (type.includes('pdf')) return '📕';
		if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return '📦';
		if (type.includes('word') || type.includes('doc')) return '📘';
		if (type.includes('excel') || type.includes('sheet')) return '📊';
		if (type.includes('powerpoint') || type.includes('presentation')) return '📙';
		return '📎';
	}

	// 格式化文件大小
	function formatFileSize(bytes: number | null): string {
		if (!bytes) return '-';
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}

	// 格式化时间
	function formatTime(timestamp: number): string {
		const date = new Date(timestamp);

		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		const timezoneOffset = -date.getTimezoneOffset();
		const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
		const offsetMinutes = Math.abs(timezoneOffset) % 60;
		const offsetSign = timezoneOffset >= 0 ? '+' : '-';
		const timezone = `GMT${offsetSign}${offsetHours}${offsetMinutes > 0 ? ':' + String(offsetMinutes).padStart(2, '0') : ''}`;

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timezone}`;
	}

	// 文本内容状态
	let textContent = $state<string>('');
	let isLoadingText = $state(false);

	// 下载状态
	let downloadStatus = $state<'idle' | 'downloading' | 'done' | 'error'>('idle');

	// 解密文件名
	$effect(() => {
		if (isEncrypted && encryptionKey && file.file_name) {
			isDecryptingName = true;
			decryptString(encryptionKey, file.file_name)
				.then((name) => {
					decryptedName = name;
					decryptedType = inferMimeType(name);
				})
				.catch(() => {
					decryptedName = file.file_name;
					decryptedType = file.file_type;
				})
				.finally(() => {
					isDecryptingName = false;
				});
		}
	});

	// 获取并解密文件内容（用于预览）
	async function fetchAndDecrypt(): Promise<ArrayBuffer> {
		const response = await fetch(fileUrl);
		const data = await response.arrayBuffer();
		if (isEncrypted && encryptionKey) {
			return decryptFile(encryptionKey, data);
		}
		return data;
	}

	// 加载预览内容（图片/音视频），解密后创建 blob URL
	$effect(() => {
		if (!isEncrypted || !encryptionKey || isDecryptingName) return;
		if (!isImage && !isAudio && !isVideo) return;

		isDecryptingContent = true;
		fetchAndDecrypt()
			.then((decrypted) => {
				const blob = new Blob([decrypted], { type: displayType || 'application/octet-stream' });
				decryptedBlobUrl = URL.createObjectURL(blob);
			})
			.catch((err) => {
				console.error('Failed to decrypt content:', err);
			})
			.finally(() => {
				isDecryptingContent = false;
			});

		return () => {
			if (decryptedBlobUrl) {
				URL.revokeObjectURL(decryptedBlobUrl);
			}
		};
	});

	// 加载文本内容
	async function loadTextContent() {
		if (textContent) return;
		isLoadingText = true;
		try {
			if (isEncrypted && encryptionKey) {
				const decrypted = await fetchAndDecrypt();
				textContent = new TextDecoder().decode(decrypted);
			} else {
				const resp = await fetch(fileUrl);
				textContent = await resp.text();
			}
		} catch (error) {
			console.error('Failed to load text:', error);
			textContent = i18n.t('channel.fileItem.loadError');
		} finally {
			isLoadingText = false;
		}
	}

	// 检查文本是否为URL
	function isUrl(text: string): boolean {
		try {
			const url = new URL(text.trim());
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch {
			return false;
		}
	}

	// 强制下载文件
	async function handleDownload() {
		if (downloadStatus === 'downloading') return;
		downloadStatus = 'downloading';
		try {
			let blob: Blob;
			if (isEncrypted && encryptionKey) {
				const decrypted = await fetchAndDecrypt();
				blob = new Blob([decrypted], { type: displayType || 'application/octet-stream' });
			} else {
				const response = await fetch(fileUrl);
				blob = await response.blob();
			}
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = displayName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
			downloadStatus = 'done';
			setTimeout(() => {
				downloadStatus = 'idle';
			}, 3000);
		} catch (error) {
			console.error('Download failed:', error);
			downloadStatus = 'error';
			setTimeout(() => {
				downloadStatus = 'idle';
			}, 3000);
		}
	}

	// 如果是文本文件，自动加载内容
	$effect(() => {
		if (isText && !isDecryptingName) {
			loadTextContent();
		}
	});

	// 预览用的 URL：加密模式用解密后的 blob URL，否则直接用 CDN URL
	let previewUrl = $derived(isEncrypted ? decryptedBlobUrl : fileUrl);
</script>

<div class="file-item">
	<div class="file-header">
		<div class="file-icon">
			{#if isDecryptingName}
				<span class="decrypting-icon">🔓</span>
			{:else}
				{getFileIcon(displayType)}
			{/if}
		</div>
		<div class="file-info">
			<div class="file-name">
				{#if isDecryptingName}
					<span class="decrypting-text">{i18n.t('privacy.decrypting')}</span>
				{:else}
					{displayName}
				{/if}
			</div>
			<div class="file-meta">
				<span class="file-size">{formatFileSize(file.file_size)}</span>
				<span class="file-time">{formatTime(file.created_at)}</span>
			</div>
		</div>
		<div class="file-actions">
			{#if !isEncrypted}
				<a
					href={fileUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="icon-button"
					title={i18n.t('channel.fileItem.open')}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path
							d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
							stroke-width="2"
							stroke-linecap="round"
						/>
						<polyline points="15 3 21 3 21 9" stroke-width="2" stroke-linecap="round" />
						<line x1="10" y1="14" x2="21" y2="3" stroke-width="2" stroke-linecap="round" />
					</svg>
				</a>
			{/if}
			<button
				onclick={handleDownload}
				class="icon-button"
				class:download-done={downloadStatus === 'done'}
				class:download-error={downloadStatus === 'error'}
				class:download-loading={downloadStatus === 'downloading'}
				disabled={downloadStatus === 'downloading'}
				title={downloadStatus === 'done'
					? i18n.t('channel.fileItem.downloadDone')
					: downloadStatus === 'error'
						? i18n.t('channel.fileItem.downloadError')
						: downloadStatus === 'downloading'
							? i18n.t('channel.fileItem.downloading')
							: i18n.t('channel.fileItem.download')}
			>
				{#if downloadStatus === 'downloading'}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="spin">
						<path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-width="2" stroke-linecap="round" />
					</svg>
				{:else if downloadStatus === 'done'}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<polyline points="20 6 9 17 4 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				{:else if downloadStatus === 'error'}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<line x1="18" y1="6" x2="6" y2="18" stroke-width="2" stroke-linecap="round" />
						<line x1="6" y1="6" x2="18" y2="18" stroke-width="2" stroke-linecap="round" />
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path
							d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
							stroke-width="2"
							stroke-linecap="round"
						/>
						<polyline points="7 10 12 15 17 10" stroke-width="2" stroke-linecap="round" />
						<line x1="12" y1="15" x2="12" y2="3" stroke-width="2" stroke-linecap="round" />
					</svg>
				{/if}
			</button>
		</div>
	</div>

	<div class="file-content">
		{#if isImage}
			{#if isEncrypted && isDecryptingContent}
				<div class="text-loading">{i18n.t('privacy.decrypting')}</div>
			{:else if previewUrl}
				<button class="image-preview" onclick={() => onImageClick?.(previewUrl!)}>
					<img src={previewUrl} alt={displayName} loading="lazy" />
					<div class="image-overlay">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor">
							<circle cx="11" cy="11" r="8" stroke-width="2" />
							<path d="M21 21l-4.35-4.35" stroke-width="2" stroke-linecap="round" />
							<path d="M11 8v6M8 11h6" stroke-width="2" stroke-linecap="round" />
						</svg>
					</div>
				</button>
			{/if}
		{:else if isAudio}
			{#if isEncrypted && isDecryptingContent}
				<div class="text-loading">{i18n.t('privacy.decrypting')}</div>
			{:else if previewUrl}
				<AudioPlayer src={previewUrl} fileName={displayName} />
			{/if}
		{:else if isVideo}
			{#if isEncrypted && isDecryptingContent}
				<div class="text-loading">{i18n.t('privacy.decrypting')}</div>
			{:else if previewUrl}
				<VideoPlayer src={previewUrl} fileName={displayName} />
			{/if}
		{:else if isText}
			{#if isLoadingText}
				<div class="text-loading">{i18n.t('channel.fileItem.loading')}</div>
			{:else if textContent}
				{#if isUrl(textContent)}
					<a
						href={textContent.trim()}
						target="_blank"
						rel="noopener noreferrer"
						class="text-link"
						data-sveltekit-preload-data="off"
					>
						<span class="link-text">{textContent}</span>
						<svg
							class="external-link-icon"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
						>
							<path
								d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
								stroke-width="2"
								stroke-linecap="round"
							/>
							<polyline points="15 3 21 3 21 9" stroke-width="2" stroke-linecap="round" />
							<line x1="10" y1="14" x2="21" y2="3" stroke-width="2" stroke-linecap="round" />
						</svg>
					</a>
				{:else}
					<div class="text-preview">{textContent}</div>
				{/if}
				<CopyButton value={textContent} label={i18n.t('channel.fileItem.copyText')} />
			{/if}
		{/if}
	</div>
</div>

<style>
	.file-item {
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		transition: all 0.2s ease;
		max-width: 100%;
		overflow: hidden;
	}

	.file-item:hover {
		background: var(--color-panel-2);
		border-color: var(--color-primary);
	}

	.file-header {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.file-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}

	.decrypting-icon {
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.file-info {
		flex: 1;
		min-width: 0;
	}

	.file-name {
		font-size: var(--text-base);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		word-break: break-word;
		margin-bottom: var(--space-1);
	}

	.decrypting-text {
		color: var(--color-muted-foreground);
		font-style: italic;
	}

	.file-meta {
		display: flex;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.file-size {
		font-weight: var(--font-medium);
	}

	.file-time {
		font-size: var(--text-xs);
		font-family: var(--font-family-mono, monospace);
	}

	.file-content {
		margin-bottom: var(--space-3);
		max-width: 100%;
		overflow: hidden;
	}

	/* 图片预览 */
	.image-preview {
		position: relative;
		width: 100%;
		max-width: 100%;
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: zoom-in;
		border: none;
		background: none;
		padding: 0;
		display: block;
	}

	.image-preview img {
		width: 100%;
		max-width: 100%;
		height: auto;
		display: block;
		object-fit: contain;
		transition: transform 0.2s ease;
	}

	@media (min-width: 640px) {
		.image-preview {
			max-width: 400px;
		}
	}

	.image-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.2s ease;
		color: white;
	}

	.image-preview:hover .image-overlay {
		opacity: 1;
	}

	.image-preview:hover img {
		transform: scale(1.05);
	}

	/* 文本预览 */
	.text-preview {
		padding: var(--space-4);
		background: var(--color-panel-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--color-foreground);
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
		max-height: 300px;
		max-width: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		margin-bottom: var(--space-3);
		font-family: var(--font-family-mono, monospace);
	}

	.text-loading {
		padding: var(--space-4);
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: var(--text-sm);
	}

	/* 文本链接 */
	.text-link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4);
		background: var(--color-panel-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--color-primary);
		margin-bottom: var(--space-3);
		text-decoration: none;
		transition: all 0.2s ease;
		max-width: 100%;
		overflow: hidden;
	}

	.link-text {
		flex: 1;
		min-width: 0;
		word-break: break-all;
		overflow-wrap: break-word;
	}

	.external-link-icon {
		flex-shrink: 0;
		opacity: 0.6;
		transition: opacity 0.2s ease;
	}

	.text-link:hover {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.text-link:hover .external-link-icon {
		opacity: 1;
	}

	/* 操作按钮 */
	.file-actions {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		gap: var(--space-1);
	}

	.icon-button {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-panel-2);
		color: var(--color-muted-foreground);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.icon-button:hover {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
		transform: scale(1.1);
	}

	.icon-button svg {
		flex-shrink: 0;
	}

	.icon-button.download-done {
		background: var(--color-success, #22c55e);
		color: white;
		border-color: var(--color-success, #22c55e);
	}

	.icon-button.download-error {
		background: var(--color-danger);
		color: white;
		border-color: var(--color-danger);
	}

	.icon-button.download-loading {
		opacity: 0.7;
		cursor: wait;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.spin {
		animation: spin 1s linear infinite;
	}
</style>
