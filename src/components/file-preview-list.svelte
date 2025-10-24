<script lang="ts">
	interface FilePreview {
		file: File;
		error?: string;
	}

	let { files = $bindable(), onRemove } = $props<{
		files: FilePreview[];
		onRemove?: (index: number) => void;
	}>();

	// 获取文件类型图标
	function getFileIcon(type: string): string {
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
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	}
</script>

<div class="file-preview-list">
	{#each files as { file, error }, index (file.name + file.size)}
		<div class="file-preview-item" class:has-error={error}>
			<div class="file-icon">{getFileIcon(file.type)}</div>

			<div class="file-info">
				<div class="file-name">{file.name}</div>
				<div class="file-meta">
					<span class="file-size">{formatFileSize(file.size)}</span>
					{#if file.type}
						<span class="file-type">{file.type}</span>
					{/if}
				</div>
				{#if error}
					<div class="file-error">{error}</div>
				{/if}
			</div>

			{#if onRemove}
				<button class="remove-button" onclick={() => onRemove?.(index)} aria-label="Remove file">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.file-preview-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.file-preview-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: all 0.2s ease;
	}

	.file-preview-item:hover {
		background: var(--color-panel-2);
		border-color: var(--color-primary);
	}

	.file-preview-item.has-error {
		border-color: var(--color-danger);
		background: hsla(0, 70%, 50%, 0.05);
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

	.file-type {
		opacity: 0.7;
	}

	.file-error {
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-danger);
		font-weight: var(--font-medium);
	}

	.remove-button {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: var(--radius);
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: all 0.2s ease;
	}

	.remove-button:hover {
		background: var(--color-danger);
		color: white;
	}
</style>
