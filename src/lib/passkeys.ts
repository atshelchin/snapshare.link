// WebAuthn Passkeys + PRF key derivation for privacy channels
// Public keys stored at external index service (on-chain), encryption keys derived client-side via PRF

const PUBLICKEY_INDEX_URL = 'https://webauthnp256-publickey-index.biubiu.tools';

function getRpId(): string {
	return window.location.hostname;
}

function getRpName(): string {
	return 'SnapShare';
}

// Check if WebAuthn and PRF are supported
export function isWebAuthnSupported(): boolean {
	return !!window.PublicKeyCredential;
}

// Register a new passkey
export async function registerPasskey(
	displayName: string = 'SnapShare User'
): Promise<{ credentialId: string }> {
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const userId = crypto.getRandomValues(new Uint8Array(16));
	const userName = displayName.toLowerCase().replace(/\s+/g, '-') || 'snapshare-user';

	const credential = (await navigator.credentials.create({
		publicKey: {
			challenge,
			rp: { name: getRpName(), id: getRpId() },
			user: {
				id: userId,
				name: userName,
				displayName: displayName
			},
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 (P-256)
			authenticatorSelection: {
				residentKey: 'required',
				userVerification: 'required'
			},
			extensions: {
				prf: {} as Record<string, unknown>
			}
		}
	})) as PublicKeyCredential;

	const credentialId = bufferToBase64Url(credential.rawId);

	// Store public key at external index service via /api/create
	const attestationResponse = credential.response as AuthenticatorAttestationResponse;
	const spkiPublicKey = attestationResponse.getPublicKey?.();
	if (spkiPublicKey) {
		// Strip SPKI header (26 bytes for P-256) to get raw 65-byte uncompressed key (04 + X + Y)
		const rawPublicKey = new Uint8Array(spkiPublicKey).slice(26).buffer;
		const resp = await fetch(`${PUBLICKEY_INDEX_URL}/api/create`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				rpId: getRpId(),
				credentialId,
				publicKey: bufferToHex(rawPublicKey),
				name: displayName
			})
		});
		if (!resp.ok && resp.status !== 201 && resp.status !== 202) {
			const errData = await resp.json().catch(() => ({}));
			throw new Error(
				`PUBLICKEY_STORE_FAILED: ${(errData as Record<string, string>).error || resp.statusText}`
			);
		}
	}

	// Check PRF support from extension results
	const extResults = credential.getClientExtensionResults() as Record<string, unknown>;
	const prfExt = extResults.prf as { enabled?: boolean } | undefined;
	if (prfExt && !prfExt.enabled) {
		throw new Error('PRF_NOT_SUPPORTED');
	}

	// Save displayName locally for fast retrieval
	localStorage.setItem(`passkey:${credentialId}:name`, displayName);

	return { credentialId };
}

// Get display name: local cache first, then remote query
export async function getPasskeyDisplayName(credentialId: string): Promise<string> {
	// 1. Local cache
	const cached = localStorage.getItem(`passkey:${credentialId}:name`);
	if (cached) return cached;

	// 2. Remote query
	try {
		const resp = await fetch(
			`${PUBLICKEY_INDEX_URL}/api/query?rpId=${encodeURIComponent(getRpId())}&credentialId=${encodeURIComponent(credentialId)}`
		);
		if (resp.ok) {
			const data = await resp.json();
			if (data.name) {
				// Cache for next time
				localStorage.setItem(`passkey:${credentialId}:name`, data.name);
				return data.name;
			}
		}
	} catch (e) {
		console.warn('Failed to query passkey name from index service:', e);
	}

	return '';
}

// Authenticate with passkey and derive AES key via PRF
export async function authenticateAndDeriveKey(
	channelId: string
): Promise<{ key: CryptoKey; credentialId: string }> {
	const challenge = crypto.getRandomValues(new Uint8Array(32));

	// Use channel_id hashed to 32 bytes as PRF salt
	const saltInput = new TextEncoder().encode('snapshare:' + channelId);
	const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', saltInput));

	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge,
			rpId: getRpId(),
			userVerification: 'required',
			extensions: {
				prf: {
					eval: { first: salt }
				}
			} as Record<string, unknown>
		}
	})) as PublicKeyCredential;

	const extResults = assertion.getClientExtensionResults() as Record<string, unknown>;
	const prfResults = (extResults.prf as { results?: { first?: ArrayBuffer } } | undefined)
		?.results;
	if (!prfResults?.first) {
		throw new Error('PRF_NOT_SUPPORTED');
	}

	// Derive AES-256-GCM key from PRF output via HKDF
	const keyMaterial = await crypto.subtle.importKey('raw', prfResults.first, 'HKDF', false, [
		'deriveKey'
	]);

	const aesKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode('snapshare-e2ee:' + channelId)
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		true, // extractable - need to export to URL hash
		['encrypt', 'decrypt']
	);

	const credId = bufferToBase64Url(assertion.rawId);
	return { key: aesKey, credentialId: credId };
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
