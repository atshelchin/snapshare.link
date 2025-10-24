<script lang="ts">
	import { textToFile, genUploadUrls, uploadWithPUT, addFile, validateFiles } from '$lib';
	import ChannelHeader from '../../../components/channel-header.svelte';
	import DangerNotice from '../../../components/danger-notice.svelte';
	import Tabs from '../../../components/tabs.svelte';
	import FilePreviewList from '../../../components/file-preview-list.svelte';
	import FileUploadProgress from '../../../components/file-upload-progress.svelte';
	import type { UploadProgress } from '../../../components/file-upload-progress.svelte';
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

	// 首次加载文件列表
	$effect(() => {
		loadFiles();
	});

	async function loadFiles() {
		isLoadingFiles = true;
		try {
			const resp = await fetch(
				`https://snapshare.link/api/query-files-by-channel?channel_id=${channel_id}`
			);
			const data = await resp.json();
			if (data.files) {
				filesList = data.files;
			}
		} catch (error) {
			console.error('加载文件失败：', error);
		} finally {
			isLoadingFiles = false;
		}
	}

	// 处理文件选择
	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		const result = validateFiles(input.files);
		validationError = '';
		rateLimitError = '';

		if (result.invalid.length > 0) {
			selectedFiles = [
				...result.valid.map((file) => ({ file })),
				...result.invalid.map((item) => ({ file: item.file, error: item.error }))
			];

			if (result.valid.length === 0) {
				validationError = result.invalid[0].error;
			}
		} else {
			selectedFiles = result.valid.map((file) => ({ file }));
		}
	}

	// 移除文件
	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
		validationError = '';
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
					rateLimitError = `上传受限：${urlsData.error}。当前已用 ${Math.round(limit.current / 1024 / 1024)}MB / ${Math.round(limit.max / 1024 / 1024)}MB`;
				} else {
					rateLimitError = urlsData.error || '请求上传链接失败';
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
			console.error('上传失败：', error);
			rateLimitError = '上传过程中发生错误';
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
						console.error('添加文件记录失败:', err);
					}
					resolve();
				} else {
					uploadQueue[index].status = 'error';
					uploadQueue[index].error = `上传失败: HTTP ${xhr.status}`;
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
				uploadQueue[index].error = '网络错误';
				reject(new Error('网络错误'));
			};

			const onabort = () => {
				uploadQueue[index].status = 'error';
				uploadQueue[index].error = '上传已取消';
				reject(new Error('上传已取消'));
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
					rateLimitError = `上传受限：${urlsData.error}。当前已用 ${Math.round(limit.current / 1024 / 1024)}MB / ${Math.round(limit.max / 1024 / 1024)}MB`;
				} else {
					rateLimitError = urlsData.error || '请求上传链接失败';
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
						rateLimitError = `上传失败: HTTP ${xhr.status}`;
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
						rateLimitError = '网络错误';
						reject(new Error('网络错误'));
					},
					() => {
						rateLimitError = '上传已取消';
						reject(new Error('上传已取消'));
					}
				);
			});
		} catch (error) {
			console.error('文本上传失败：', error);
		} finally {
			isUploadingText = false;
			setTimeout(() => {
				textUploadProgress = 0;
			}, 2000);
		}
	}

	const getText = async (url: string) => {
		const resp = await fetch(url);
		return await resp.text();
	};
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
						<h4 class="queue-title">上传进度</h4>
						{#each uploadQueue as item (item.file.name + item.file.size)}
							<FileUploadProgress {item} />
						{/each}
					</div>
				{:else}
					<div class="upload-area">
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
							disabled={selectedFiles.every((f) => f.error) || isUploading}
						>
							{isUploading
								? '上传中...'
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
							<span>发送中...</span>
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
					{isUploadingText ? '发送中...' : i18n.t('channel.text.send')}
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
				<div class="file-card">
					<div class="file-info">
						<div class="file-name">{file.file_name}</div>
						<div class="file-meta">
							{#if file.file_type?.startsWith('text/')}
								{#await getText('https://cdn.snapshare.link/' + file.file_key) then text}
									<div class="text-preview">{text}</div>
								{/await}
							{:else}
								<a
									href={'https://cdn.snapshare.link/' + file.file_key}
									target="_blank"
									class="download-link"
								>
									{i18n.t('channel.fileList.download')}
								</a>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">{i18n.t('channel.fileList.empty')}</div>
	{/if}
</div>

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

	.file-input-label:hover {
		border-color: var(--color-primary);
		background: var(--color-panel-2);
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
		margin-top: var(--space-8);
	}

	.section-title {
		font-size: var(--text-xl);
		font-weight: var(--font-semibold);
		color: var(--color-foreground);
		margin-bottom: var(--space-4);
	}

	.files-grid {
		display: grid;
		gap: var(--space-3);
	}

	.file-card {
		padding: var(--space-4);
		background: var(--color-panel-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: all 0.2s ease;
	}

	.file-card:hover {
		background: var(--color-panel-2);
		border-color: var(--color-primary);
	}

	.file-name {
		font-weight: var(--font-medium);
		color: var(--color-foreground);
		margin-bottom: var(--space-2);
	}

	.text-preview {
		padding: var(--space-3);
		background: var(--color-panel-2);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		color: var(--color-muted-foreground);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 200px;
		overflow-y: auto;
	}

	.download-link {
		color: var(--color-primary);
		text-decoration: none;
		font-size: var(--text-sm);
	}

	.download-link:hover {
		text-decoration: underline;
	}

	.loading,
	.empty-state {
		padding: var(--space-8);
		text-align: center;
		color: var(--color-muted-foreground);
	}
</style>
