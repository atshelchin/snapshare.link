// place files you want to import through the `$lib` alias in this folder.
export async function getFileMetadata(url: string, cdnUrl = 'https://cdn.snapshare.link/') {
	const response = await fetch(cdnUrl + url, {
		method: 'HEAD',
		headers: {
			'Accept-Encoding': 'identity' // 告诉服务器不要压缩
		}
	});

	return {
		size: parseInt(response.headers.get('content-length') || '0'),
		type: response.headers.get('content-type') || 'application/octet-stream'
	};
}

// 使用 Web Crypto API 对 IP 进行 SHA-256 哈希
export async function hashIP(ip: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(ip);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return hashHex.slice(0, 16); // 返回前 16 个字符
}
