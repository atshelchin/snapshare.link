<script lang="ts">
	import { textToFile, genUploadUrls, uploadWithPUT, addFile } from '$lib';
	import ChannelHeader from '../../../components/channel-header.svelte';

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

<textarea bind:value={txt} />
<button onclick={shareTxt}> 分享 文本</button>

<input type="file" bind:files multiple />
<button onclick={shareFiles}> 分享 文件</button>

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
