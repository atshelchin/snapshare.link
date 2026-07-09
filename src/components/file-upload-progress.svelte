<script lang="ts">
	import { useI18n } from '@shelchin/i18n/svelte';

	export interface UploadProgress {
		id?: string;
		file: File;
		status: 'waiting' | 'uploading' | 'success' | 'error';
		progress: number;
		error?: string;
		attempts?: number;
		maxAttempts?: number;
	}

	let {
		item,
		onRetry,
		retryDisabled = false
	} = $props<{
		item: UploadProgress;
		onRetry?: () => void;
		retryDisabled?: boolean;
	}>();
	const i18n = useI18n();

	// 格式化文件大小
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}

	// 获取状态图标
	function getStatusIcon(status: string): string {
		switch (status) {
			case 'waiting':
				return '⏳';
			case 'uploading':
				return '📤';
			case 'success':
				return '✅';
			case 'error':
				return '❌';
			default:
				return '📄';
		}
	}

	// 获取状态文本
	function getStatusText(status: string): string {
		switch (status) {
			case 'waiting':
				return i18n.t('upload.status.waiting');
			case 'uploading':
				return i18n.t('upload.status.uploading');
			case 'success':
				return i18n.t('upload.status.success');
			case 'error':
				return i18n.t('upload.status.error');
			default:
				return '';
		}
	}
</script>

<div class="upload-progress-item" class:error={item.status === 'error'}>
	<div class="file-header">
		<div class="file-info">
			<span class="status-icon">{getStatusIcon(item.status)}</span>
			<div class="file-details">
				<div class="file-name">{item.file.name}</div>
				<div class="file-meta">
					<span class="file-size">{formatFileSize(item.file.size)}</span>
					<span class="status-text">{getStatusText(item.status)}</span>
					{#if item.status === 'uploading'}
						<span class="progress-text">{Math.round(item.progress)}%</span>
					{/if}
					{#if item.status !== 'success' && item.maxAttempts && item.maxAttempts > 1}
						<span class="attempt-text">{item.attempts || 0}/{item.maxAttempts}</span>
					{/if}
				</div>
			</div>
		</div>
		{#if item.status === 'error' && onRetry}
			<button class="retry-button" onclick={onRetry} disabled={retryDisabled}>
				{i18n.t('channel.upload.retry')}
			</button>
		{/if}
	</div>

	{#if item.status === 'uploading' || item.status === 'success'}
		<div class="progress-bar-container">
			<div class="progress-bar" style="width: {item.progress}%"></div>
		</div>
	{/if}

	{#if item.error}
		<div class="error-message">{item.error}</div>
	{/if}
</div>

<style>
	.upload-progress-item {
		padding: var(--space-3);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: all 0.2s ease;
	}

	.upload-progress-item.error {
		border-color: var(--color-danger);
		background: hsla(0, 70%, 50%, 0.05);
	}

	.file-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.file-info {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: 1;
		min-width: 0;
	}

	.status-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.file-details {
		flex: 1;
		min-width: 0;
	}

	.file-name {
		font-size: var(--text-base);
		font-weight: var(--font-medium);
		color: var(--color-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.file-size {
		font-weight: var(--font-medium);
	}

	.status-text {
		color: var(--color-primary);
	}

	.progress-text {
		color: var(--color-primary);
		font-weight: var(--font-semibold);
	}

	.attempt-text {
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	.retry-button {
		flex-shrink: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-panel-2);
		color: var(--color-primary);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		padding: var(--space-1-5) var(--space-3);
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}

	.retry-button:hover:not(:disabled) {
		border-color: var(--color-primary);
		background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.08);
	}

	.retry-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.progress-bar-container {
		margin-top: var(--space-2);
		height: 6px;
		background: var(--color-panel-2);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(
			90deg,
			var(--color-primary),
			hsla(var(--brand-hue), var(--brand-saturation), 60%, 1)
		);
		transition: width 0.3s ease;
		border-radius: var(--radius-full);
	}

	.error-message {
		margin-top: var(--space-2);
		padding: var(--space-2);
		background: hsla(0, 70%, 50%, 0.1);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		color: var(--color-danger);
	}
</style>
