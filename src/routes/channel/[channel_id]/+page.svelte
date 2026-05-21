<script lang="ts">
	import { textToFile, genUploadUrls, uploadWithPUT, addFile, validateFiles } from '$lib';
	import ChannelHeader from '../../../components/channel-header.svelte';
	import DangerNotice from '../../../components/danger-notice.svelte';
	import Tabs from '../../../components/tabs.svelte';
	import FilePreviewList from '../../../components/file-preview-list.svelte';
	import FileUploadProgress from '../../../components/file-upload-progress.svelte';
	import type { UploadProgress } from '../../../components/file-upload-progress.svelte';
	import FileItem from '../../../components/file-item.svelte';
	import ImageLightbox from '../../../components/image-lightbox.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';

	let { params } = $props();
	const i18n = useI18n();
	const channel_id = params.channel_id;

	// Tab 状态
	let activeTab = $state<'file' | 'text'>('file');

	// 文本输入
	let txt = $state('');
	let textUploadProgress = $state(0);
	let isUploadingText = $state(false);

	// 文件上传
	let fileInput = $state<HTMLInputElement>();
	let selectedFiles = $state<{ file: File; error?: string }[]>([]);
	let validationError = $state('');
	let uploadQueue = $state<UploadProgress[]>([]);
	let isUploading = $state(false);
	let rateLimitError = $state('');
	let isDragOver = $state(false);

	// 文件列表状态
	interface FileItem {
		channel_id: string;
		file_key: string;
		file_name: string;
		file_type: string | null;
		file_size: number | null;
		created_at: number;
	}

	let filesList = $state<FileItem[]>([]);
	let isLoadingFiles = $state(true);
	let eventSource: EventSource | null = null;

	// 图片放大状态
	let lightboxImageUrl = $state<string | null>(null);

	// 使用 SSE 加载文件列表
	$effect(() => {
		isLoadingFiles = true;
		eventSource = new EventSource(
			`https://snapshare.link/api/stream-files-by-channel?channel_id=${channel_id}`
		);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.type === 'initial') {
					// 首次加载
					filesList = data.data || [];
					isLoadingFiles = false;
				} else if (data.type === 'update') {
					// 增量更新
					const newFiles = data.data || [];
					// 合并新文件到列表开头，避免重复
					const existingKeys = new Set(filesList.map((f) => f.file_key));
					const uniqueNewFiles = newFiles.filter((f: FileItem) => !existingKeys.has(f.file_key));
					filesList = [...uniqueNewFiles, ...filesList];
				} else if (data.type === 'error') {
					console.error('SSE error:', data.error);
					isLoadingFiles = false;
				}
			} catch (error) {
				console.error('Failed to parse SSE data:', error);
			}
		};

		eventSource.onerror = (error) => {
			console.error('SSE connection error:', error);
			isLoadingFiles = false;
			eventSource?.close();
		};

		return () => {
			// 清理 SSE 连接
			if (eventSource) {
				eventSource.close();
			}
		};
	});

	// 处理文件（来自 input 或 drop）
	function addFiles(files: FileList | File[]) {
		const result = validateFiles(files);
		validationError = '';
		rateLimitError = '';

		if (result.invalid.length > 0) {
			selectedFiles = [
				...selectedFiles,
				...result.valid.map((file) => ({ file })),
				...result.invalid.map((item) => ({ file: item.file, error: item.error }))
			];

			if (result.valid.length === 0) {
				validationError = result.invalid[0].error;
			}
		} else {
			selectedFiles = [...selectedFiles, ...result.valid.map((file) => ({ file }))];
		}

		// 检查总文件数是否超过限制
		const currentValidFiles = selectedFiles.filter((f) => !f.error);
		if (currentValidFiles.length > 10) {
			const toDelete = currentValidFiles.length - 10;
			validationError = `${i18n.t('channel.upload.maxFiles')} ${currentValidFiles.length} ${i18n.t('channel.upload.filesSelected')}, ${i18n.t('channel.upload.pleaseDelete')} ${toDelete} ${i18n.t('channel.upload.files')}`;
		}
	}

	// 处理文件选择
	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		addFiles(input.files);
		// 清空 input 以允许重复选择同一文件
		input.value = '';
	}

	// 拖拽处理
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		if (isUploading) return;
		const files = event.dataTransfer?.files;
		if (files && files.length > 0) {
			addFiles(files);
		}
	}

	// 移除文件
	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);

		// 重新检查文件数量限制
		const currentValidFiles = selectedFiles.filter((f) => !f.error);
		if (currentValidFiles.length > 10) {
			const toDelete = currentValidFiles.length - 10;
			validationError = `${i18n.t('channel.upload.maxFiles')} ${currentValidFiles.length} ${i18n.t('channel.upload.filesSelected')}, ${i18n.t('channel.upload.pleaseDelete')} ${toDelete} ${i18n.t('channel.upload.files')}`;
		} else {
			// 当文件数量 <= 10 时，重新验证所有文件
			validationError = '';
			const files = selectedFiles.map((f) => f.file);
			const result = validateFiles(files);

			// 更新文件列表，重新标记错误
			selectedFiles = [
				...result.valid.map((file) => ({ file })),
				...result.invalid.map((item) => ({ file: item.file, error: item.error }))
			];

			// 如果有无效文件，显示第一个错误
			if (result.invalid.length > 0 && result.valid.length === 0) {
				validationError = result.invalid[0].error;
			}
		}
	}

	// 分享文件
	async function shareFiles() {
		const validFiles = selectedFiles.filter((item) => !item.error).map((item) => item.file);
		if (validFiles.length === 0) return;

		isUploading = true;
		rateLimitError = '';

		// 初始化上传队列
		uploadQueue = validFiles.map((file) => ({
			file,
			status: 'waiting' as const,
			progress: 0
		}));

		try {
			// 请求上传 URLs
			const fileSizes = validFiles.map((f) => f.size);
			const urlsData = await genUploadUrls(fileSizes);

			if (!urlsData.success) {
				// 处理限流错误
				if (urlsData.limit) {
					const limit = urlsData.limit.hour || urlsData.limit.day;
					const currentMB = Math.round(limit.current / 1024 / 1024);
					const maxMB = Math.round(limit.max / 1024 / 1024);
					rateLimitError = `${i18n.t('channel.upload.rateLimitError')}: ${urlsData.error}. ${currentMB}MB / ${maxMB}MB`;
				} else {
					rateLimitError = urlsData.error || i18n.t('channel.upload.requestFailed');
				}
				uploadQueue = [];
				isUploading = false;
				return;
			}

			// 开始上传每个文件
			const uploadPromises = validFiles.map((file, index) =>
				uploadSingleFile(file, urlsData.data[index], index)
			);

			await Promise.all(uploadPromises);
		} catch (error) {
			console.error(i18n.t('channel.upload.uploadError'), error);
			rateLimitError = i18n.t('channel.upload.uploadError');
		} finally {
			isUploading = false;
			// 清空选择
			setTimeout(() => {
				selectedFiles = [];
				uploadQueue = [];
				if (fileInput) fileInput.value = '';
			}, 2000);
		}
	}

	// 上传单个文件
	async function uploadSingleFile(
		file: File,
		uploadData: { url: string; fileKey: string },
		index: number
	) {
		return new Promise<void>((resolve, reject) => {
			// 更新状态为上传中
			uploadQueue[index].status = 'uploading';

			const onload = async (xhr: XMLHttpRequest) => {
				if (xhr.status >= 200 && xhr.status < 300) {
					uploadQueue[index].status = 'success';
					uploadQueue[index].progress = 100;

					// 添加到文件列表
					try {
						await addFile(channel_id, uploadData.fileKey, file.name);
						// 本地更新文件列表
						filesList = [
							{
								channel_id,
								file_key: uploadData.fileKey,
								file_name: file.name,
								file_type: file.type,
								file_size: file.size,
								created_at: Date.now()
							},
							...filesList
						];
					} catch (err) {
						console.error(i18n.t('channel.upload.addFileFailed'), err);
					}
					resolve();
				} else {
					uploadQueue[index].status = 'error';
					uploadQueue[index].error = `${i18n.t('channel.upload.uploadFailed')}: HTTP ${xhr.status}`;
					reject(new Error(`HTTP ${xhr.status}`));
				}
			};

			const onprogress = (e: ProgressEvent) => {
				if (e.lengthComputable) {
					uploadQueue[index].progress = (e.loaded / e.total) * 100;
				}
			};

			const onerror = () => {
				uploadQueue[index].status = 'error';
				uploadQueue[index].error = i18n.t('channel.upload.networkError');
				reject(new Error(i18n.t('channel.upload.networkError')));
			};

			const onabort = () => {
				uploadQueue[index].status = 'error';
				uploadQueue[index].error = i18n.t('channel.upload.uploadCanceled');
				reject(new Error(i18n.t('channel.upload.uploadCanceled')));
			};

			uploadWithPUT(uploadData.url, file, onload, onprogress, onerror, onabort);
		});
	}

	// 分享文本
	async function shareTxt() {
		if (!txt.trim()) return;

		isUploadingText = true;
		textUploadProgress = 0;
		rateLimitError = '';

		try {
			const file = textToFile(txt, `text_${Date.now()}.txt`);
			const urlsData = await genUploadUrls([file.size]);

			if (!urlsData.success) {
				if (urlsData.limit) {
					const limit = urlsData.limit.hour || urlsData.limit.day;
					const currentMB = Math.round(limit.current / 1024 / 1024);
					const maxMB = Math.round(limit.max / 1024 / 1024);
					rateLimitError = `${i18n.t('channel.upload.rateLimitError')}: ${urlsData.error}. ${currentMB}MB / ${maxMB}MB`;
				} else {
					rateLimitError = urlsData.error || i18n.t('channel.upload.requestFailed');
				}
				isUploadingText = false;
				return;
			}

			await new Promise<void>((resolve, reject) => {
				const onload = async (xhr: XMLHttpRequest) => {
					if (xhr.status >= 200 && xhr.status < 300) {
						textUploadProgress = 100;
						await addFile(channel_id, urlsData.data[0].fileKey, file.name);

						// 本地更新文件列表
						filesList = [
							{
								channel_id,
								file_key: urlsData.data[0].fileKey,
								file_name: file.name,
								file_type: file.type,
								file_size: file.size,
								created_at: Date.now()
							},
							...filesList
						];

						txt = '';
						resolve();
					} else {
						rateLimitError = `${i18n.t('channel.upload.uploadFailed')}: HTTP ${xhr.status}`;
						reject(new Error(`HTTP ${xhr.status}`));
					}
				};

				const onprogress = (e: ProgressEvent) => {
					if (e.lengthComputable) {
						textUploadProgress = (e.loaded / e.total) * 100;
					}
				};

				uploadWithPUT(
					urlsData.data[0].url,
					file,
					onload,
					onprogress,
					() => {
						rateLimitError = i18n.t('channel.upload.networkError');
						reject(new Error(i18n.t('channel.upload.networkError')));
					},
					() => {
						rateLimitError = i18n.t('channel.upload.uploadCanceled');
						reject(new Error(i18n.t('channel.upload.uploadCanceled')));
					}
				);
			});
		} catch (error) {
			console.error(i18n.t('channel.text.uploadFailed'), error);
		} finally {
			isUploadingText = false;
			setTimeout(() => {
				textUploadProgress = 0;
			}, 2000);
		}
	}
</script>

<ChannelHeader {channel_id} />

<DangerNotice emojiIcon="⏰" description={i18n.t('channel.notice.description')} />

{#if rateLimitError}
	<div class="rate-limit-error">
		<span class="error-icon">⚠️</span>
		<span>{rateLimitError}</span>
	</div>
{/if}

<div class="upload-section">
	<Tabs
		tabs={[
			{ id: 'file', label: i18n.t('channel.tabs.file'), icon: '📁' },
			{ id: 'text', label: i18n.t('channel.tabs.text'), icon: '📝' }
		]}
		bind:activeTab
	>
		{#if activeTab === 'file'}
			<div class="tab-content">
				{#if uploadQueue.length > 0}
					<div class="upload-queue">
						<h4 class="queue-title">{i18n.t('channel.upload.progress')}</h4>
						{#each uploadQueue as item (item.file.name + item.file.size)}
							<FileUploadProgress {item} />
						{/each}
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="upload-area"
						class:drag-over={isDragOver}
						ondragover={handleDragOver}
						ondragleave={handleDragLeave}
						ondrop={handleDrop}
					>
						<input
							type="file"
							multiple
							bind:this={fileInput}
							onchange={handleFileSelect}
							id="fileInput"
							class="file-input-hidden"
							disabled={isUploading}
						/>
						<label for="fileInput" class="file-input-label">
							<div class="upload-icon">📤</div>
							<div class="upload-text">
								<div class="upload-title">{i18n.t('channel.upload.clickOrDrag')}</div>
								<div class="upload-hint">
									{i18n.t('channel.upload.limit')} 10 {i18n.t('channel.upload.files')}, {i18n.t(
										'channel.upload.maxSize'
									)} 100MB
								</div>
							</div>
						</label>
					</div>

					{#if validationError}
						<div class="validation-error">⚠️ {validationError}</div>
					{/if}

					{#if selectedFiles.length > 0}
						<div class="file-preview-section">
							<div class="preview-header">
								<span
									>{i18n.t('channel.upload.selected')}
									{selectedFiles.length}
									{i18n.t('channel.upload.files')}</span
								>
								<button class="button-text" onclick={() => (selectedFiles = [])}>
									{i18n.t('channel.upload.clearAll')}
								</button>
							</div>
							<FilePreviewList files={selectedFiles} onRemove={removeFile} />
						</div>

						<button
							class="button button-primary"
							onclick={shareFiles}
							disabled={selectedFiles.every((f) => f.error) ||
								isUploading ||
								selectedFiles.filter((f) => !f.error).length > 10}
						>
							{isUploading
								? i18n.t('channel.upload.uploading')
								: `${i18n.t('channel.upload.upload')} (${selectedFiles.filter((f) => !f.error).length})`}
						</button>
					{/if}
				{/if}
			</div>
		{:else}
			<div class="tab-content">
				<textarea
					bind:value={txt}
					placeholder={i18n.t('channel.text.placeholder')}
					class="text-input"
					disabled={isUploadingText}
				></textarea>

				{#if isUploadingText && textUploadProgress > 0}
					<div class="text-upload-progress">
						<div class="progress-info">
							<span>{i18n.t('channel.text.sending')}</span>
							<span>{Math.round(textUploadProgress)}%</span>
						</div>
						<div class="progress-bar-container">
							<div class="progress-bar" style="width: {textUploadProgress}%"></div>
						</div>
					</div>
				{/if}

				<button
					class="button button-primary"
					onclick={shareTxt}
					disabled={!txt.trim() || isUploadingText}
				>
					{isUploadingText ? i18n.t('channel.text.sending') : i18n.t('channel.text.send')}
				</button>
			</div>
		{/if}
	</Tabs>
</div>

<div class="files-list-section">
	<h3 class="section-title">{i18n.t('channel.fileList.title')}</h3>

	{#if isLoadingFiles}
		<div class="loading">{i18n.t('channel.fileList.loading')}</div>
	{:else if filesList.length > 0}
		<div class="files-grid">
			{#each filesList as file (file.file_key)}
				<FileItem {file} onImageClick={(url) => (lightboxImageUrl = url)} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">{i18n.t('channel.fileList.empty')}</div>
	{/if}
</div>

<ImageLightbox bind:imageUrl={lightboxImageUrl} />

<style>
	.rate-limit-error {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
		background: hsla(0, 70%, 50%, 0.1);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.error-icon {
		font-size: var(--text-lg);
	}

	.upload-section {
		margin-bottom: var(--space-8);
		padding: var(--space-6);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.upload-queue {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.queue-title {
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin: 0;
	}

	/* 文件上传区域 */
	.upload-area {
		position: relative;
	}

	.file-input-hidden {
		display: none;
	}

	.file-input-label {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-panel-1);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.file-input-label:hover,
	.upload-area.drag-over .file-input-label {
		border-color: var(--color-primary);
		background: var(--color-panel-2);
	}

	.upload-area.drag-over .file-input-label {
		border-style: solid;
		box-shadow: 0 0 0 3px hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.2);
	}

	.upload-icon {
		font-size: 3rem;
		margin-bottom: var(--space-3);
	}

	.upload-text {
		text-align: center;
	}

	.upload-title {
		font-size: var(--text-lg);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin-bottom: var(--space-1);
	}

	.upload-hint {
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.validation-error {
		padding: var(--space-3);
		background: hsla(0, 70%, 50%, 0.1);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.file-preview-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.preview-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.button-text {
		background: none;
		border: none;
		color: var(--color-primary);
		cursor: pointer;
		font-size: var(--text-sm);
		padding: var(--space-1);
	}

	.button-text:hover {
		text-decoration: underline;
	}

	/* 文本输入 */
	.text-input {
		width: 100%;
		min-height: 200px;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-panel-1);
		color: var(--color-foreground);
		font-size: var(--text-base);
		font-family: var(--font-family-sans);
		resize: vertical;
		transition: border-color 0.2s ease;
	}

	.text-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.text-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.text-upload-progress {
		padding: var(--space-3);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.progress-info {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
	}

	.progress-bar-container {
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

	/* 文件列表 */
	.files-list-section {
		margin-top: var(--space-12);
		padding-top: var(--space-8);
		border-top: 2px solid var(--color-border);
		position: relative;
	}

	.files-list-section::before {
		content: '';
		position: absolute;
		top: -2px;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--color-primary) 50%, transparent);
		opacity: 0.3;
	}

	.section-title {
		font-size: var(--text-xl);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin-bottom: var(--space-4);
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.section-title::before {
		content: '📋';
		font-size: var(--text-2xl);
	}

	.files-grid {
		display: grid;
		gap: var(--space-4);
	}

	.loading,
	.empty-state {
		padding: var(--space-8);
		text-align: center;
		color: var(--color-muted-foreground);
	}
</style>
