<script lang="ts">
	import {
		FILE_VALIDATION,
		formatUploadLimitSize,
		textToFile,
		genUploadUrls,
		uploadWithPUT,
		addFile,
		validateFiles
	} from '$lib';
	import ChannelHeader from '../../../components/channel-header.svelte';
	import DangerNotice from '../../../components/danger-notice.svelte';
	import Tabs from '../../../components/tabs.svelte';
	import FilePreviewList from '../../../components/file-preview-list.svelte';
	import FileUploadProgress from '../../../components/file-upload-progress.svelte';
	import type { UploadProgress } from '../../../components/file-upload-progress.svelte';
	import FileItem from '../../../components/file-item.svelte';
	import ImageLightbox from '../../../components/image-lightbox.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';
	import { importKeyFromBase64Url, encryptFile, encryptString } from '$lib/crypto';
	import type { UploadUrlData } from '$lib';

	let { params } = $props();
	const i18n = useI18n();
	const channel_id = params.channel_id;
	const maxFileSizeLabel = formatUploadLimitSize();
	const MAX_PARALLEL_UPLOADS = 4;
	const MAX_UPLOAD_ATTEMPTS = 3;
	const UPLOAD_IDLE_TIMEOUT_MS = 45_000;

	// 隐私频道：从 URL hash 解析加密密钥和创建者名字
	let encryptionKey = $state<CryptoKey | null>(null);
	let channelCreator = $state('');
	let isPrivacyMode = $derived(encryptionKey !== null);

	$effect(() => {
		const hash = window.location.hash;
		if (!hash.includes('key=')) return;

		// Parse key
		const keyMatch = hash.match(/[#&]key=([^&]+)/);
		if (keyMatch) {
			importKeyFromBase64Url(keyMatch[1])
				.then((key) => {
					encryptionKey = key;
				})
				.catch((err) => {
					console.error('Failed to parse encryption key from URL:', err);
				});
		}

		// Parse creator name
		const byMatch = hash.match(/[#&]by=([^&]+)/);
		if (byMatch) {
			channelCreator = decodeURIComponent(byMatch[1]);
		}
	});

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
	let uploadQueue = $state<UploadQueueItem[]>([]);
	let isUploading = $state(false);
	let rateLimitError = $state('');
	let isDragOver = $state(false);
	let clearUploadQueueTimer: ReturnType<typeof setTimeout> | undefined;

	// 文件列表状态
	interface FileItem {
		channel_id: string;
		file_key: string;
		file_name: string;
		file_type: string | null;
		file_size: number | null;
		created_at: number;
	}

	interface ChannelFileStats {
		fileCount: number;
		totalSize: number;
	}

	interface ChannelStreamEvent {
		type: 'initial' | 'update' | 'error';
		data?: FileItem[];
		stats?: ChannelFileStats;
		error?: string;
	}

	type UploadQueueItem = UploadProgress & {
		id: string;
		uploadFile: File;
		uploadData: UploadUrlData;
		storedName: string;
		storedType: string;
		storedSize: number;
	};

	let filesList = $state<FileItem[]>([]);
	let fileStats = $state<ChannelFileStats>({ fileCount: 0, totalSize: 0 });
	let isLoadingFiles = $state(true);
	let eventSource: EventSource | null = null;

	// 图片放大状态
	let lightboxImageUrl = $state<string | null>(null);

	function formatStorageSize(bytes: number): string {
		if (!bytes || bytes <= 0) return '0 B';

		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
		const value = bytes / Math.pow(k, i);
		const precision = i === 0 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(precision).replace(/\.0+$/, '')} ${sizes[i]}`;
	}

	function getFallbackStats(fileItems: FileItem[]): ChannelFileStats {
		return {
			fileCount: fileItems.length,
			totalSize: fileItems.reduce((total, file) => total + (file.file_size || 0), 0)
		};
	}

	function normalizeFileStats(stats: ChannelFileStats | undefined, fallback: FileItem[]) {
		if (!stats) return getFallbackStats(fallback);

		return {
			fileCount: Number(stats.fileCount || 0),
			totalSize: Number(stats.totalSize || 0)
		};
	}

	function addToFileStats(fileSize: number | null | undefined) {
		fileStats = {
			fileCount: fileStats.fileCount + 1,
			totalSize: fileStats.totalSize + (fileSize || 0)
		};
	}

	// 使用 SSE 加载文件列表
	$effect(() => {
		isLoadingFiles = true;
		eventSource = new EventSource(
			`https://snapshare.link/api/stream-files-by-channel?channel_id=${channel_id}`
		);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as ChannelStreamEvent;

				if (data.type === 'initial') {
					filesList = data.data || [];
					fileStats = normalizeFileStats(data.stats, filesList);
					isLoadingFiles = false;
				} else if (data.type === 'update') {
					const newFiles = data.data || [];
					const existingKeys = new Set(filesList.map((f) => f.file_key));
					const uniqueNewFiles = newFiles.filter((f: FileItem) => !existingKeys.has(f.file_key));
					filesList = [...uniqueNewFiles, ...filesList];
					fileStats = normalizeFileStats(data.stats, filesList);
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

		const currentValidFiles = selectedFiles.filter((f) => !f.error);
		if (currentValidFiles.length > FILE_VALIDATION.MAX_FILES) {
			const toDelete = currentValidFiles.length - FILE_VALIDATION.MAX_FILES;
			validationError = `${i18n.t('channel.upload.maxFiles')} ${currentValidFiles.length} ${i18n.t('channel.upload.filesSelected')}, ${i18n.t('channel.upload.pleaseDelete')} ${toDelete} ${i18n.t('channel.upload.files')}`;
		}
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		addFiles(input.files);
		input.value = '';
	}

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

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);

		const currentValidFiles = selectedFiles.filter((f) => !f.error);
		if (currentValidFiles.length > FILE_VALIDATION.MAX_FILES) {
			const toDelete = currentValidFiles.length - FILE_VALIDATION.MAX_FILES;
			validationError = `${i18n.t('channel.upload.maxFiles')} ${currentValidFiles.length} ${i18n.t('channel.upload.filesSelected')}, ${i18n.t('channel.upload.pleaseDelete')} ${toDelete} ${i18n.t('channel.upload.files')}`;
		} else {
			validationError = '';
			const files = selectedFiles.map((f) => f.file);
			const result = validateFiles(files);

			selectedFiles = [
				...result.valid.map((file) => ({ file })),
				...result.invalid.map((item) => ({ file: item.file, error: item.error }))
			];

			if (result.invalid.length > 0 && result.valid.length === 0) {
				validationError = result.invalid[0].error;
			}
		}
	}

	// 加密单个文件（隐私模式）
	async function encryptFileForUpload(
		key: CryptoKey,
		file: File
	): Promise<{ encryptedFile: File; encryptedName: string }> {
		const data = await file.arrayBuffer();
		const encrypted = await encryptFile(key, data);
		const encryptedName = await encryptString(key, file.name);
		const encryptedFile = new File([encrypted], encryptedName, {
			type: 'application/octet-stream'
		});
		return { encryptedFile, encryptedName };
	}

	function createUploadQueueId(file: File, index: number): string {
		return `${Date.now()}-${index}-${file.name}-${file.size}-${file.lastModified}`;
	}

	function setUploadQueueItem(index: number, patch: Partial<UploadQueueItem>) {
		const current = uploadQueue[index];
		if (!current) return;

		uploadQueue[index] = { ...current, ...patch };
	}

	function getUploadRequestError(urlsData: Awaited<ReturnType<typeof genUploadUrls>>): string {
		if (urlsData.success) return '';

		const limit = urlsData.limit?.hour || urlsData.limit?.day || urlsData.limit?.global;
		if (limit) {
			const currentMB = Math.round(limit.current / 1024 / 1024);
			const maxMB = Math.round(limit.max / 1024 / 1024);
			const message = urlsData.error || i18n.t('channel.upload.requestFailed');
			return `${i18n.t('channel.upload.rateLimitError')}: ${message}. ${currentMB}MB / ${maxMB}MB`;
		}

		return urlsData.error || i18n.t('channel.upload.requestFailed');
	}

	function getUploadErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : i18n.t('channel.upload.uploadError');
	}

	function delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function scheduleClearSuccessfulUploadQueue() {
		if (clearUploadQueueTimer) clearTimeout(clearUploadQueueTimer);

		clearUploadQueueTimer = setTimeout(() => {
			if (!uploadQueue.length || uploadQueue.some((item) => item.status !== 'success')) return;

			selectedFiles = [];
			uploadQueue = [];
			rateLimitError = '';
			if (fileInput) fileInput.value = '';
		}, 2000);
	}

	function updateFilesListAfterUpload(item: UploadQueueItem): boolean {
		if (filesList.some((file) => file.file_key === item.uploadData.fileKey)) return false;

		filesList = [
			{
				channel_id,
				file_key: item.uploadData.fileKey,
				file_name: item.storedName,
				file_type: item.storedType,
				file_size: item.storedSize,
				created_at: Date.now()
			},
			...filesList
		];

		return true;
	}

	async function processUploadQueue(indices: number[]) {
		let nextIndex = 0;
		const workerCount = Math.min(MAX_PARALLEL_UPLOADS, indices.length);

		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (nextIndex < indices.length) {
					const index = indices[nextIndex++];
					const item = uploadQueue[index];
					if (!item || item.status === 'success') continue;

					await uploadSingleFile(index);
				}
			})
		);

		isUploading = false;

		const failedCount = uploadQueue.filter((item) => item.status === 'error').length;
		if (failedCount > 0) {
			rateLimitError = `${failedCount} ${i18n.t('channel.upload.filesFailed')}`;
			return;
		}

		scheduleClearSuccessfulUploadQueue();
	}

	// 分享文件
	async function shareFiles() {
		const validFiles = selectedFiles.filter((item) => !item.error).map((item) => item.file);
		if (validFiles.length === 0) return;

		if (clearUploadQueueTimer) clearTimeout(clearUploadQueueTimer);
		isUploading = true;
		rateLimitError = '';
		uploadQueue = [];

		try {
			let filesToUpload: File[];
			let storedNames: string[];

			if (isPrivacyMode && encryptionKey) {
				const encrypted = await Promise.all(
					validFiles.map((file) => encryptFileForUpload(encryptionKey!, file))
				);
				filesToUpload = encrypted.map((item) => item.encryptedFile);
				storedNames = encrypted.map((item) => item.encryptedName);
			} else {
				filesToUpload = validFiles;
				storedNames = validFiles.map((file) => file.name);
			}

			const fileSizes = filesToUpload.map((file) => file.size);
			const urlsData = await genUploadUrls(fileSizes);

			if (!urlsData.success) {
				rateLimitError = getUploadRequestError(urlsData);
				isUploading = false;
				return;
			}

			uploadQueue = validFiles.map((file, index) => ({
				id: createUploadQueueId(file, index),
				file,
				uploadFile: filesToUpload[index],
				uploadData: urlsData.data[index],
				storedName: storedNames[index],
				storedType: isPrivacyMode ? 'application/octet-stream' : file.type,
				storedSize: isPrivacyMode ? filesToUpload[index].size : file.size,
				status: 'waiting' as const,
				progress: 0,
				attempts: 0,
				maxAttempts: MAX_UPLOAD_ATTEMPTS
			}));

			await processUploadQueue(uploadQueue.map((_, index) => index));
		} catch (error) {
			console.error(i18n.t('channel.upload.uploadError'), error);
			rateLimitError = getUploadErrorMessage(error);
			isUploading = false;
		}
	}

	async function retryUploadItem(index: number) {
		const item = uploadQueue[index];
		if (!item || item.status !== 'error' || isUploading) return;

		isUploading = true;
		rateLimitError = '';
		setUploadQueueItem(index, {
			status: 'waiting',
			progress: 0,
			error: undefined,
			attempts: 0
		});

		const urlsData = await genUploadUrls([item.uploadFile.size]);
		if (!urlsData.success) {
			const message = getUploadRequestError(urlsData);
			setUploadQueueItem(index, {
				status: 'error',
				error: message
			});
			rateLimitError = message;
			isUploading = false;
			return;
		}

		setUploadQueueItem(index, { uploadData: urlsData.data[0] });
		await processUploadQueue([index]);
	}

	// 上传单个文件，失败时自动重试，最终失败后保留为可手动重试
	async function uploadSingleFile(index: number): Promise<boolean> {
		while ((uploadQueue[index]?.attempts || 0) < MAX_UPLOAD_ATTEMPTS) {
			try {
				await uploadSingleFileOnce(index);
				return true;
			} catch (error) {
				const item = uploadQueue[index];
				if (!item) return false;

				const message = getUploadErrorMessage(error);
				if ((item.attempts || 0) >= MAX_UPLOAD_ATTEMPTS) {
					setUploadQueueItem(index, {
						status: 'error',
						error: message
					});
					return false;
				}

				setUploadQueueItem(index, {
					status: 'waiting',
					error: undefined
				});
				await delay(800 * (item.attempts || 1));
			}
		}

		return false;
	}

	async function uploadSingleFileOnce(index: number): Promise<void> {
		const item = uploadQueue[index];
		if (!item) throw new Error(i18n.t('channel.upload.uploadError'));

		setUploadQueueItem(index, {
			status: 'uploading',
			progress: 0,
			error: undefined,
			attempts: (item.attempts || 0) + 1
		});

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let xhr: XMLHttpRequest | undefined;
			let idleTimer: ReturnType<typeof setTimeout> | undefined;

			const clearIdleTimer = () => {
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = undefined;
			};

			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearIdleTimer();

				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};

			const resetIdleTimer = () => {
				clearIdleTimer();
				idleTimer = setTimeout(() => {
					finish(new Error(i18n.t('channel.upload.uploadTimeout')));
					xhr?.abort();
				}, UPLOAD_IDLE_TIMEOUT_MS);
			};

			resetIdleTimer();

			const onload = async (request: XMLHttpRequest) => {
				clearIdleTimer();

				if (request.status < 200 || request.status >= 300) {
					finish(new Error(`${i18n.t('channel.upload.uploadFailed')}: HTTP ${request.status}`));
					return;
				}

				try {
					const addFileResult = (await addFile(
						channel_id,
						item.uploadData.fileKey,
						item.storedName
					)) as { success?: boolean; error?: string };

					if (addFileResult?.success === false) {
						throw new Error(addFileResult.error || i18n.t('channel.upload.addFileFailed'));
					}

					setUploadQueueItem(index, {
						status: 'success',
						progress: 100,
						error: undefined
					});
					if (updateFilesListAfterUpload(item)) {
						addToFileStats(item.storedSize);
					}
					finish();
				} catch (error) {
					finish(
						new Error(
							error instanceof Error ? error.message : i18n.t('channel.upload.addFileFailed')
						)
					);
				}
			};

			const onprogress = (event: ProgressEvent) => {
				if (settled) return;
				resetIdleTimer();

				if (event.lengthComputable) {
					setUploadQueueItem(index, {
						progress: (event.loaded / event.total) * 100
					});
				}
			};

			xhr = uploadWithPUT(
				item.uploadData.url,
				item.uploadFile,
				onload,
				onprogress,
				() => finish(new Error(i18n.t('channel.upload.networkError'))),
				() => finish(new Error(i18n.t('channel.upload.uploadCanceled')))
			);
		});
	}

	// 分享文本
	async function shareTxt() {
		if (!txt.trim()) return;

		isUploadingText = true;
		textUploadProgress = 0;
		rateLimitError = '';

		try {
			let fileToUpload: File;
			let fileNameToStore: string;

			if (isPrivacyMode && encryptionKey) {
				const originalFile = textToFile(txt, `text_${Date.now()}.txt`);
				const result = await encryptFileForUpload(encryptionKey, originalFile);
				fileToUpload = result.encryptedFile;
				fileNameToStore = result.encryptedName;
			} else {
				fileToUpload = textToFile(txt, `text_${Date.now()}.txt`);
				fileNameToStore = fileToUpload.name;
			}

			const urlsData = await genUploadUrls([fileToUpload.size]);

			if (!urlsData.success) {
				const limit = urlsData.limit?.hour || urlsData.limit?.day || urlsData.limit?.global;
				if (limit) {
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
						await addFile(channel_id, urlsData.data[0].fileKey, fileNameToStore);

						filesList = [
							{
								channel_id,
								file_key: urlsData.data[0].fileKey,
								file_name: fileNameToStore,
								file_type: isPrivacyMode ? 'application/octet-stream' : 'text/plain',
								file_size: fileToUpload.size,
								created_at: Date.now()
							},
							...filesList
						];
						addToFileStats(fileToUpload.size);

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
					fileToUpload,
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

<ChannelHeader {channel_id} {encryptionKey} {isPrivacyMode} />

<DangerNotice emojiIcon="⏰" description={i18n.t('channel.notice.description')} />

{#if isPrivacyMode}
	<div class="privacy-badge">
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
			<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		</svg>
		<span>{i18n.t('privacy.badge')}</span>
		<span class="privacy-badge-sub">· {i18n.t('privacy.encrypted')}</span>
		{#if channelCreator}
			<span class="privacy-badge-creator">· {channelCreator}</span>
		{/if}
	</div>
{/if}

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
						{#each uploadQueue as item, index (item.id)}
							<FileUploadProgress
								{item}
								onRetry={() => retryUploadItem(index)}
								retryDisabled={isUploading}
							/>
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
							<div class="upload-icon">{isPrivacyMode ? '🔒' : '📤'}</div>
							<div class="upload-text">
								<div class="upload-title">{i18n.t('channel.upload.clickOrDrag')}</div>
								<div class="upload-hint">
									{i18n.t('channel.upload.limit')}
									{FILE_VALIDATION.MAX_FILES}
									{i18n.t('channel.upload.files')}, {i18n.t('channel.upload.maxSize')}
									{maxFileSizeLabel}
								</div>
								{#if isPrivacyMode}
									<div class="upload-hint privacy-hint">{i18n.t('privacy.encrypted')}</div>
								{/if}
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
								selectedFiles.filter((f) => !f.error).length > FILE_VALIDATION.MAX_FILES}
						>
							{#if isPrivacyMode}
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									style="margin-right: 4px;"
								>
									<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
									<path d="M7 11V7a5 5 0 0 1 10 0v4" />
								</svg>
							{/if}
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
	<div class="files-list-header">
		<h3 class="section-title">{i18n.t('channel.fileList.title')}</h3>
		<div class="files-list-stats" aria-label={i18n.t('channel.fileList.stats')}>
			<span>{fileStats.fileCount} {i18n.t('channel.upload.files')}</span>
			<span class="stats-separator">·</span>
			<span>{formatStorageSize(fileStats.totalSize)} {i18n.t('channel.fileList.storageUsed')}</span>
		</div>
	</div>

	{#if isLoadingFiles}
		<div class="loading">{i18n.t('channel.fileList.loading')}</div>
	{:else if filesList.length > 0}
		<div class="files-grid">
			{#each filesList as file (file.file_key)}
				<FileItem {file} {encryptionKey} onImageClick={(url) => (lightboxImageUrl = url)} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">{i18n.t('channel.fileList.empty')}</div>
	{/if}
</div>

<ImageLightbox bind:imageUrl={lightboxImageUrl} />

<style>
	.privacy-badge {
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
		font-weight: var(--font-semibold);
	}

	.privacy-badge-sub {
		font-weight: var(--font-normal);
		opacity: 0.7;
	}

	.privacy-badge-creator {
		font-weight: var(--font-medium);
		opacity: 0.85;
	}

	.privacy-hint {
		color: var(--color-primary);
		font-weight: var(--font-medium);
		margin-top: var(--space-1);
	}

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
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.section-title::before {
		content: '📋';
		font-size: var(--text-2xl);
	}

	.files-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.files-list-stats {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-muted-foreground);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		text-align: right;
		white-space: nowrap;
	}

	.stats-separator {
		opacity: 0.6;
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

	@media (max-width: 640px) {
		.files-list-header {
			align-items: flex-start;
			flex-direction: column;
			gap: var(--space-1);
		}

		.files-list-stats {
			text-align: left;
			white-space: normal;
		}
	}
</style>
