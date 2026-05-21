// Streaming decrypt-to-disk download for vault files
// Each chunk is a separate R2 object: {fileKey}/{partNumber}
// Resume: user selects the same file, we detect existing size and skip completed chunks.

import { decryptFile } from '$lib/crypto';
import { PART_SIZE } from '$lib/vault';

export interface DownloadProgress {
	totalChunks: number;
	completedChunks: number;
	percent: number;
	status: 'downloading' | 'completed' | 'failed' | 'cancelled';
	error?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export function isFileSystemAccessSupported(): boolean {
	return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export async function downloadAndDecrypt(
	cdnUrl: string,
	fileName: string,
	encryptionKey: CryptoKey,
	onProgress?: ProgressCallback,
	abortSignal?: AbortSignal,
	totalChunks?: number
): Promise<void> {
	if (!totalChunks) {
		totalChunks = await probeChunkCount(cdnUrl);
	}

	if (!isFileSystemAccessSupported()) {
		throw new Error('File System Access API not supported. Please use Chrome or Edge.');
	}

	const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> })
		.showSaveFilePicker({
			suggestedName: fileName,
			types: [{ description: 'File', accept: { 'application/octet-stream': [] } }]
		});

	// Detect resume: check if the file already has content
	const existingFile = await handle.getFile();
	const existingSize = existingFile.size;
	// Each decrypted chunk is exactly PART_SIZE (except possibly the last)
	const completedChunks = existingSize > 0 ? Math.floor(existingSize / PART_SIZE) : 0;
	const startChunk = completedChunks + 1;
	const isResume = completedChunks > 0 && completedChunks < totalChunks;

	const writable = await handle.createWritable({ keepExistingData: isResume });
	if (isResume) {
		// Truncate to exact chunk boundary (in case last write was partial)
		const safeSize = completedChunks * PART_SIZE;
		await writable.truncate(safeSize);
		await writable.seek(safeSize);
	}

	const report = (done: number, status: DownloadProgress['status'], error?: string) => {
		onProgress?.({
			totalChunks: totalChunks!,
			completedChunks: done,
			percent: totalChunks! > 0 ? (done / totalChunks!) * 100 : 0,
			status,
			error
		});
	};

	if (isResume) {
		report(completedChunks, 'downloading');
	}

	try {
		for (let i = startChunk; i <= totalChunks; i++) {
			if (abortSignal?.aborted) {
				await writable.close();
				report(i - 1, 'cancelled');
				return;
			}

			const resp = await fetch(`${cdnUrl}/${i}`, { signal: abortSignal });
			if (!resp.ok) throw new Error(`Download chunk ${i} failed: HTTP ${resp.status}`);

			const encryptedChunk = await resp.arrayBuffer();
			const decrypted = await decryptFile(encryptionKey, encryptedChunk);
			await writable.write(decrypted);

			report(i, 'downloading');
		}

		await writable.close();
		report(totalChunks, 'completed');
	} catch (e) {
		try { await writable.close(); } catch { /* ignore */ }
		const errorMsg = e instanceof Error ? e.message : String(e);
		report(startChunk - 1, 'failed', errorMsg);
		throw e;
	}
}

async function probeChunkCount(cdnUrl: string): Promise<number> {
	const r1 = await fetch(`${cdnUrl}/1`, { method: 'HEAD' });
	if (!r1.ok) throw new Error('No chunks found for this file');

	let low = 1;
	let high = 2;
	while (true) {
		const r = await fetch(`${cdnUrl}/${high}`, { method: 'HEAD' });
		if (!r.ok) break;
		low = high;
		high *= 2;
	}
	while (low < high - 1) {
		const mid = Math.floor((low + high) / 2);
		const r = await fetch(`${cdnUrl}/${mid}`, { method: 'HEAD' });
		if (r.ok) low = mid;
		else high = mid;
	}
	return low;
}
