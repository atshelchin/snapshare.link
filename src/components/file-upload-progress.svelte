<script lang="ts">
	import { useI18n } from '@shelchin/i18n/svelte';

	export interface UploadProgress {
		file: File;
		status: 'waiting' | 'uploading' | 'success' | 'error';
		progress: number;
		error?: string;
	}

	let { item } = $props<{ item: UploadProgress }>();
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
				</div>
			</div>
		</div>
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
