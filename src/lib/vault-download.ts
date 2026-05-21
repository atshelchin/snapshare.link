// Streaming decrypt-to-disk download for vault files
// Downloads encrypted chunks via Range requests, decrypts each in memory (~200MB peak),
// and writes directly to disk via File System Access API.

import { decryptFile } from '$lib/crypto';

// Must match the PART_SIZE used during upload
const PART_SIZE = 100 * 1024 * 1024; // 100MB
const ENCRYPT_OVERHEAD = 12 + 16; // IV (12) + AES-GCM auth tag (16)
const ENCRYPTED_CHUNK_SIZE = PART_SIZE + ENCRYPT_OVERHEAD;

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

// Get the encrypted file size by doing a HEAD request
async function getEncryptedFileSize(url: string): Promise<number> {
	const resp = await fetch(url, { method: 'HEAD' });
	const contentLength = resp.headers.get('content-length');
	if (!contentLength) throw new Error('Cannot determine file size');
	return parseInt(contentLength, 10);
}

// Download, decrypt, and save to disk in streaming chunks
export async function downloadAndDecrypt(
	cdnUrl: string,
	fileName: string,
	encryptionKey: CryptoKey,
	onProgress?: ProgressCallback,
	abortSignal?: AbortSignal
): Promise<void> {
	// 1. Get encrypted file size
	const encryptedSize = await getEncryptedFileSize(cdnUrl);
	const totalChunks = Math.ceil(encryptedSize / ENCRYPTED_CHUNK_SIZE);

	// 2. Prompt user to pick save location
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
		// Fallback: collect all chunks in memory (only for smaller files)
		throw new Error('File System Access API not supported. Please use Chrome or Edge.');
	}

	const report = (completedChunks: number, status: DownloadProgress['status'], error?: string) => {
		onProgress?.({
			totalChunks,
			completedChunks,
			percent: totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0,
			status,
			error
		});
	};

	try {
		for (let i = 0; i < totalChunks; i++) {
			if (abortSignal?.aborted) {
				await writable.abort();
				report(i, 'cancelled');
				return;
			}

			const start = i * ENCRYPTED_CHUNK_SIZE;
			const end = Math.min(start + ENCRYPTED_CHUNK_SIZE - 1, encryptedSize - 1);

			// Download one encrypted chunk
			const resp = await fetch(cdnUrl, {
				headers: { Range: `bytes=${start}-${end}` },
				signal: abortSignal
			});

			if (!resp.ok && resp.status !== 206) {
				throw new Error(`Download failed: HTTP ${resp.status}`);
			}

			const encryptedChunk = await resp.arrayBuffer();

			// Decrypt
			const decrypted = await decryptFile(encryptionKey, encryptedChunk);

			// Write to disk immediately — memory is freed
			await writable.write(decrypted);

			report(i + 1, 'downloading');
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
