<script lang="ts">
	import { textToFile, genUploadUrls, uploadWithPUT, addFile } from '$lib';
	import ChannelHeader from '../../../components/channel-header.svelte';
	import DangerNotice from '../../../components/danger-notice.svelte';
	let { params } = $props();

	const channel_id = params.channel_id;

	let txt = $state('');
	let files = $state<FileList | undefined>();

	console.log(params);

	const getFiles = async () => {
		const resp = await fetch(
			'https://snapshare.link/api/query-files-by-channel?channel_id=' + params.channel_id
		);
		return await resp.json();
	};

	const shareTxt = async () => {
		console.log({ txt });
		const file = textToFile(txt);
		console.log({ file });

		const data = await genUploadUrls([file.size]);
		console.log({ data });

		const onload = async (e) => {
			console.log('onload');
			if (e.status >= 200 && e.status < 300) {
				console.log('✅ 上传成功！', 'success');
				await addFile(params.channel_id, data.data[0].fileKey, file.name);
			} else {
				console.log(`❌ 上传失败：HTTP ${e.status} - ${e.statusText}`, 'error');
			}
		};

		const onprogress = (e) => {
			console.log('onprogress', e, e.loaded, e.total);
		};

		const onerror = () => {
			console.log('onerror');
		};

		const onabort = () => {
			console.log('onabort');
		};

		uploadWithPUT(data.data[0].url, file, onload, onprogress, onerror, onabort);
	};

	const shareFiles = async () => {
		console.log(files);

		const list = Array.from(files);

		for (let i = 0; i < list.length; i++) {
			const file = list[i];
			const data = await genUploadUrls([file.size]);
			console.log({ data });

			const onload = async (e) => {
				console.log('onload');
				if (e.status >= 200 && e.status < 300) {
					console.log('✅ 上传成功！', 'success');
					await addFile(params.channel_id, data.data[0].fileKey, file.name);
				} else {
					console.log(`❌ 上传失败：HTTP ${e.status} - ${e.statusText}`, 'error');
				}
			};

			const onprogress = (e) => {
				console.log('onprogress', e, e.loaded, e.total);
			};

			const onerror = () => {
				console.log('onerror');
			};

			const onabort = () => {
				console.log('onabort');
			};

			uploadWithPUT(data.data[0].url, file, onload, onprogress, onerror, onabort);
		}
	};

	const getText = async (url: string) => {
		const resp = await fetch(url);
		const text = await resp.text();
		return text;
	};
</script>

<ChannelHeader {channel_id} />

<DangerNotice
	emojiIcon="⏰"
	content="Shared content will be automatically deleted after 1 hour
"
/>
<div class="tab-content" id="textTab">
	<textarea
		class="textarea"
		bind:value={txt}
		data-lang="textPlaceholder"
		placeholder="Enter text content to share..."
		style="height: 132px;"
	></textarea>
	<button onclick={shareTxt} class="button-primary button share-btn" data-lang="shareTextBtn"
		>Share Text</button
	>
</div>

<div class="tab-content">
	<div
		class="upload-area"
		onclick={() => {
			document.getElementById('fileInput').click();
		}}
	>
		<div class="upload-icon">📤</div>
		<div><strong data-lang="uploadTitle">Click to Upload Files</strong></div>
		<div style="font-size: 12px; color: #999; margin-top: 5px;" data-lang="uploadSubtitle">
			or drag files here
		</div>
		<div style="font-size: 11px; color: #999; margin-top: 5px;" data-lang="uploadTip">
			✨ Images/Audio/Video support online preview
		</div>
	</div>
	<input type="file" id="fileInput" bind:files multiple />
</div>

<button onclick={shareFiles} class="button-primary button share-btn" data-lang="shareTextBtn"
	>Share Files</button
>

{#await getFiles()}
	<p>...rolling</p>
{:then result}
	{console.log(result)}
	{#each result.data.channelFiles as item (item.file_key)}
		<br />
		<p>channel_id:{item.channel_id}</p>
		<p>created_at:{item.created_at}</p>
		<p>file_key:{item.file_key}</p>
		<p>file_name:{item.file_name}</p>
		<p>file_size:{item.file_size}</p>
		<p>file_type:{item.file_type}</p>
		<p>uploader_hash_ip:{item.uploader_hash_ip}</p>
		<br />
		{#if item.file_type == 'text/plain'}
			{#await getText('https://cdn.snapshare.link/' + item.file_key)}
				...
			{:then data}
				<textarea readonly>{data}</textarea>
			{/await}
		{:else}
			<a target="_blank" href={'https://cdn.snapshare.link/' + item.file_key}>下载地址</a>
		{/if}
	{/each}
{:catch error}
	<p style="color: red">{error.message}</p>
{/await}

<style>
	.textarea {
		width: 100%;
		padding: 15px;
		border: 2px solid var(--border-color);
		border-radius: 10px;
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
		min-height: 100px;
		background: var(--container-bg);
		color: var(--text-primary);
	}

	.share-btn {
		margin-top: 10px;
		width: 100%;
	}
	.upload-area {
		border: 2px dashed var(--border-color);
		border-radius: 10px;
		padding: 30px;
		text-align: center;
		margin-bottom: 20px;
		cursor: pointer;
		transition: all 0.3s;
		background: var(--container-bg);
		color: var(--text-primary);
	}
	.upload-icon {
		font-size: 48px;
		margin-bottom: 10px;
	}
	input[type='file'] {
		display: none;
	}
	.tab-content {
		margin-top: 20px;
	}
</style>
