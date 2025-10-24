<script lang="ts">
	import CopyButton from './copy-button.svelte';
	import AudioPlayer from './audio-player.svelte';
	import VideoPlayer from './video-player.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';

	interface FileItemData {
		channel_id: string;
		file_key: string;
		file_name: string;
		file_type: string | null;
		file_size: number | null;
		created_at: number;
	}

	let { file, onImageClick } = $props<{
		file: FileItemData;
		onImageClick?: (url: string) => void;
	}>();

	const i18n = useI18n();
	const fileUrl = `https://cdn.snapshare.link/${file.file_key}`;

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
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return i18n.t('channel.fileItem.justNow');
		if (minutes < 60) return i18n.t('channel.fileItem.minutesAgo', { n: minutes });
		if (hours < 24) return i18n.t('channel.fileItem.hoursAgo', { n: hours });
		if (days < 7) return i18n.t('channel.fileItem.daysAgo', { n: days });

		return date.toLocaleDateString();
	}

	// 判断文件类型
	const isImage = file.file_type?.startsWith('image/');
	const isAudio = file.file_type?.startsWith('audio/');
	const isVideo = file.file_type?.startsWith('video/');
	const isText = file.file_type?.startsWith('text/');

	// 文本内容状态
	let textContent = $state<string>('');
	let isLoadingText = $state(false);

	// 加载文本内容
	async function loadTextContent() {
		if (!isText || textContent) return;
		isLoadingText = true;
		try {
			const resp = await fetch(fileUrl);
			textContent = await resp.text();
		} catch (error) {
			console.error('Failed to load text:', error);
			textContent = i18n.t('channel.fileItem.loadError');
		} finally {
			isLoadingText = false;
		}
	}

	// 如果是文本文件，自动加载内容
	$effect(() => {
		if (isText) {
			loadTextContent();
		}
	});
</script>

<div class="file-item">
	<div class="file-header">
		<div class="file-icon">{getFileIcon(file.file_type)}</div>
		<div class="file-info">
			<div class="file-name">{file.file_name}</div>
			<div class="file-meta">
				<span class="file-size">{formatFileSize(file.file_size)}</span>
				<span class="file-time">{formatTime(file.created_at)}</span>
			</div>
		</div>
	</div>

	<div class="file-content">
		{#if isImage}
			<button class="image-preview" onclick={() => onImageClick?.(fileUrl)}>
				<img src={fileUrl} alt={file.file_name} loading="lazy" />
				<div class="image-overlay">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<circle cx="11" cy="11" r="8" stroke-width="2" />
						<path d="M21 21l-4.35-4.35" stroke-width="2" stroke-linecap="round" />
						<path d="M11 8v6M8 11h6" stroke-width="2" stroke-linecap="round" />
					</svg>
				</div>
			</button>
		{:else if isAudio}
			<AudioPlayer src={fileUrl} fileName={file.file_name} />
		{:else if isVideo}
			<VideoPlayer src={fileUrl} fileName={file.file_name} />
		{:else if isText}
			{#if isLoadingText}
				<div class="text-loading">{i18n.t('channel.fileItem.loading')}</div>
			{:else if textContent}
				<div class="text-preview">{textContent}</div>
				<CopyButton value={textContent} label={i18n.t('channel.fileItem.copyText')} />
			{/if}
		{/if}
	</div>

	<div class="file-actions">
		<a href={fileUrl} download={file.file_name} class="action-button download-button">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
				<path
					d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
					stroke-width="2"
					stroke-linecap="round"
				/>
				<polyline points="7 10 12 15 17 10" stroke-width="2" stroke-linecap="round" />
				<line x1="12" y1="15" x2="12" y2="3" stroke-width="2" stroke-linecap="round" />
			</svg>
			<span>{i18n.t('channel.fileItem.download')}</span>
		</a>
	</div>
</div>

<style>
	.file-item {
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		transition: all 0.2s ease;
	}

	.file-item:hover {
		background: var(--color-panel-2);
		border-color: var(--color-primary);
	}

	.file-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.file-icon {
		font-size: 2rem;
		flex-shrink: 0;
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

	.file-meta {
		display: flex;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.file-size {
		font-weight: var(--font-medium);
	}

	.file-content {
		margin-bottom: var(--space-4);
	}

	/* 图片预览 */
	.image-preview {
		position: relative;
		width: 100%;
		max-width: 400px;
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
		height: auto;
		display: block;
		transition: transform 0.2s ease;
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
		max-height: 300px;
		overflow-y: auto;
		margin-bottom: var(--space-3);
		font-family: var(--font-family-mono, monospace);
	}

	.text-loading {
		padding: var(--space-4);
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: var(--text-sm);
	}

	/* 操作按钮 */
	.file-actions {
		display: flex;
		gap: var(--space-2);
	}

	.action-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--color-panel-2);
		color: var(--color-foreground);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-button:hover {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.download-button svg {
		flex-shrink: 0;
	}
</style>
