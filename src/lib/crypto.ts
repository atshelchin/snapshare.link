// E2EE utilities for privacy channels using AES-256-GCM
// All encryption/decryption happens client-side. Server never sees plaintext or keys.

export async function encryptFile(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	// Layout: [iv (12 bytes)] [ciphertext + auth tag]
	const result = new Uint8Array(iv.length + encrypted.byteLength);
	result.set(iv);
	result.set(new Uint8Array(encrypted), iv.length);
	return result.buffer;
}

export async function decryptFile(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
	const buf = new Uint8Array(data);
	const iv = buf.slice(0, 12);
	const ciphertext = buf.slice(12);
	return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

export async function encryptString(key: CryptoKey, text: string): Promise<string> {
	const encoded = new TextEncoder().encode(text);
	const encrypted = await encryptFile(key, encoded.buffer);
	return arrayBufferToBase64Url(encrypted);
}

export async function decryptString(key: CryptoKey, ciphertext: string): Promise<string> {
	const data = base64UrlToArrayBuffer(ciphertext);
	const decrypted = await decryptFile(key, data);
	return new TextDecoder().decode(decrypted);
}

export async function exportKeyToBase64Url(key: CryptoKey): Promise<string> {
	const raw = await crypto.subtle.exportKey('raw', key);
	return arrayBufferToBase64Url(raw);
}

export async function importKeyFromBase64Url(base64url: string): Promise<CryptoKey> {
	const raw = base64UrlToArrayBuffer(base64url);
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
}

// Infer MIME type from file name extension
export function inferMimeType(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase() || '';
	const map: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml',
		bmp: 'image/bmp',
		ico: 'image/x-icon',
		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		ogg: 'audio/ogg',
		flac: 'audio/flac',
		aac: 'audio/aac',
		m4a: 'audio/mp4',
		mp4: 'video/mp4',
		webm: 'video/webm',
		mov: 'video/quicktime',
		avi: 'video/x-msvideo',
		mkv: 'video/x-matroska',
		txt: 'text/plain',
		html: 'text/html',
		css: 'text/css',
		js: 'text/javascript',
		json: 'application/json',
		pdf: 'application/pdf',
		zip: 'application/zip',
		rar: 'application/x-rar-compressed',
		'7z': 'application/x-7z-compressed',
		doc: 'application/msword',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		ppt: 'application/vnd.ms-powerpoint',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
	};
	return map[ext] || 'application/octet-stream';
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}
