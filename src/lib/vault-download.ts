// Streaming decrypt-to-disk download for vault files
// Each chunk is a separate R2 object: {fileKey}/{partNumber}
// Downloads each chunk, decrypts, and writes to disk via File System Access API.

import { decryptFile } from '$lib/crypto';

export interface DownloadProgress {
	totalChunks: number;
	completedChunks: number;
	percent: number;
	status: 'downloading' | 'completed' | 'failed' | 'cancelled';
	error?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

// Check if File System Access API is available
export function isFileSystemAccessSupported(): boolean {
	return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

// Download, decrypt, and save to disk — one chunk at a time
export async function downloadAndDecrypt(
	cdnUrl: string,
	fileName: string,
	encryptionKey: CryptoKey,
	onProgress?: ProgressCallback,
	abortSignal?: AbortSignal,
	totalChunks?: number
): Promise<void> {
	// If totalChunks not provided, probe to find how many chunks exist
	if (!totalChunks) {
		totalChunks = await probeChunkCount(cdnUrl);
	}

	// Prompt user to pick save location
	let writable: FileSystemWritableFileStream;
	if (isFileSystemAccessSupported()) {
		const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> })
			.showSaveFilePicker({
				suggestedName: fileName,
				types: [
					{
						description: 'File',
						accept: { 'application/octet-stream': [] }
					}
				]
			});
		writable = await handle.createWritable();
	} else {
		throw new Error('File System Access API not supported. Please use Chrome or Edge.');
	}

	const report = (completedChunks: number, status: DownloadProgress['status'], error?: string) => {
		onProgress?.({
			totalChunks: totalChunks!,
			completedChunks,
			percent: totalChunks! > 0 ? (completedChunks / totalChunks!) * 100 : 0,
			status,
			error
		});
	};

	try {
		for (let i = 1; i <= totalChunks; i++) {
			if (abortSignal?.aborted) {
				await writable.abort();
				report(i - 1, 'cancelled');
				return;
			}

			// Download chunk {fileKey}/{partNumber}
			const resp = await fetch(`${cdnUrl}/${i}`, { signal: abortSignal });

			if (!resp.ok) {
				throw new Error(`Download chunk ${i} failed: HTTP ${resp.status}`);
			}

			const encryptedChunk = await resp.arrayBuffer();

			// Decrypt
			const decrypted = await decryptFile(encryptionKey, encryptedChunk);

			// Write to disk immediately
			await writable.write(decrypted);

			report(i, 'downloading');
		}

		await writable.close();
		report(totalChunks, 'completed');
	} catch (e) {
		try {
			await writable.abort();
		} catch {
			// ignore
		}
		const errorMsg = e instanceof Error ? e.message : String(e);
		report(0, 'failed', errorMsg);
		throw e;
	}
}

// Probe how many chunks exist by binary search on HEAD requests
async function probeChunkCount(cdnUrl: string): Promise<number> {
	// Quick check: does chunk 1 exist?
	const r1 = await fetch(`${cdnUrl}/1`, { method: 'HEAD' });
	if (!r1.ok) throw new Error('No chunks found for this file');

	// Binary search for the last chunk
	let low = 1;
	let high = 2;

	// First find an upper bound
	while (true) {
		const r = await fetch(`${cdnUrl}/${high}`, { method: 'HEAD' });
		if (!r.ok) break;
		low = high;
		high *= 2;
	}

	// Binary search between low and high
	while (low < high - 1) {
		const mid = Math.floor((low + high) / 2);
		const r = await fetch(`${cdnUrl}/${mid}`, { method: 'HEAD' });
		if (r.ok) low = mid;
		else high = mid;
	}

	return low;
}
