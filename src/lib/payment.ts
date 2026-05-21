// USDC payment on Base network
// Each order gets a random receiving address. Private key stored in D1.
// User pays to the unique address, server verifies, then sweeps to main wallet.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const BASE_RPC = 'https://mainnet.base.org';

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// Main wallet (funds are swept here)
export const MAIN_WALLET = '0x14fB1fB21751E29F7Ec48dC450017552E3D1eA5c';

// Generate a random payment keypair
export function generatePaymentAddress(): { address: string; privateKeyHex: string } {
	const privateKey = secp256k1.utils.randomSecretKey();
	const publicKey = secp256k1.getPublicKey(privateKey, false); // uncompressed 65 bytes
	const hash = keccak_256(publicKey.slice(1)); // hash of x,y (skip 04 prefix)
	const addressBytes = hash.slice(-20);
	const address =
		'0x' +
		Array.from(addressBytes)
			.map((b: number) => b.toString(16).padStart(2, '0'))
			.join('');

	const privateKeyHex =
		'0x' +
		Array.from(new Uint8Array(privateKey))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

	return { address: toChecksumAddress(address), privateKeyHex };
}

// EIP-55 checksum address
function toChecksumAddress(address: string): string {
	const addr = address.toLowerCase().replace('0x', '');
	const hash = keccak_256(new TextEncoder().encode(addr));
	const hashHex = Array.from(hash)
		.map((b: number) => b.toString(16).padStart(2, '0'))
		.join('');
	let checksummed = '0x';
	for (let i = 0; i < addr.length; i++) {
		checksummed += parseInt(hashHex[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
	}
	return checksummed;
}

// Check if a specific address has received USDC payment of at least the expected amount
export async function checkPaymentToAddress(
	receiverAddress: string,
	expectedAmountUSDC: string,
	rpcUrl = BASE_RPC
): Promise<{ paid: boolean; txHash: string; error?: string }> {
	try {
		// Get USDC balance of the receiver address
		const balanceData = encodeBalanceOfCall(receiverAddress);

		const resp = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'eth_call',
				params: [{ to: USDC_ADDRESS, data: balanceData }, 'latest']
			})
		});

		const data = await resp.json();
		const balance = BigInt(data.result || '0x0');
		const expectedAmount = BigInt(
			Math.round(parseFloat(expectedAmountUSDC) * 10 ** USDC_DECIMALS)
		);

		if (balance >= expectedAmount) {
			// Find the tx hash from recent Transfer events to this address
			const txHash = await findTransferTx(receiverAddress, rpcUrl);
			return { paid: true, txHash };
		}

		return { paid: false, txHash: '' };
	} catch (e) {
		return { paid: false, txHash: '', error: String(e) };
	}
}

// Encode balanceOf(address) call
function encodeBalanceOfCall(address: string): string {
	// balanceOf(address) = 0x70a08231
	const addr = address.slice(2).toLowerCase().padStart(64, '0');
	return '0x70a08231' + addr;
}

// Find recent USDC Transfer tx to a specific address
async function findTransferTx(receiverAddress: string, rpcUrl: string): Promise<string> {
	try {
		const latestResp = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
		});
		const latestData = await latestResp.json();
		const latestBlock = parseInt(latestData.result, 16);
		const fromBlock = Math.max(0, latestBlock - 1000); // ~30 min on Base

		const transferTopic =
			'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
		const receiverTopic = '0x' + receiverAddress.slice(2).toLowerCase().padStart(64, '0');

		const logsResp = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'eth_getLogs',
				params: [
					{
						address: USDC_ADDRESS,
						topics: [transferTopic, null, receiverTopic],
						fromBlock: '0x' + fromBlock.toString(16),
						toBlock: 'latest'
					}
				]
			})
		});

		const logsData = await logsResp.json();
		const logs = logsData.result || [];
		if (logs.length > 0) {
			return logs[logs.length - 1].transactionHash;
		}
	} catch {
		// ignore
	}
	return '';
}
