<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import QRCodeStyling from 'qr-code-styling';

	interface Props {
		data: string;
		size?: number;
		logo?: string;
		className?: string;
	}

	let { data, size = 248, logo, className = '' }: Props = $props();

	let qrCodeContainer = $state<HTMLDivElement>();
	let qrCodeInstance = $state<unknown>(null);
	let currentTheme = $state<string | null>(null);
	let qrKey = $state(0); // Key to force re-render

	// Function to get QR code options based on theme
	function getQRCodeOptions() {
		const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
		const computedStyle = getComputedStyle(document.documentElement);

		const primaryColor = computedStyle.getPropertyValue('--color-primary').trim();
		const brand400 = computedStyle.getPropertyValue('--brand-400').trim();
		const brand500 = computedStyle.getPropertyValue('--brand-500').trim();
		const brand600 = computedStyle.getPropertyValue('--brand-600').trim();

		// Theme-aware colors
		const dotsColor = isDark ? brand500 : brand600;
		const cornersSquareColor = isDark ? brand400 : primaryColor;
		const cornersDotColor = isDark ? brand600 : brand500;
		const backgroundColor = isDark ? '#f8f9fa' : '#ffffff';

		return {
			width: size,
			height: size,
			type: 'svg',
			data,
			margin: 0,
			qrOptions: {
				typeNumber: 0,
				mode: 'Byte',
				errorCorrectionLevel: 'M'
			},
			dotsOptions: {
				color: dotsColor,
				type: 'rounded'
			},
			backgroundOptions: {
				color: backgroundColor
			},
			cornersSquareOptions: {
				color: cornersSquareColor,
				type: 'extra-rounded'
			},
			cornersDotOptions: {
				color: cornersDotColor,
				type: 'dot'
			},
			image: logo,
			imageOptions: {
				crossOrigin: 'anonymous',
				margin: 5,
				imageSize: 0.4
			}
		};
	}

	// Mount QR code into container
	onMount(() => {
		if (!data || !qrCodeContainer) return;

		// Create QR code instance
		const QRCode = QRCodeStyling as unknown as new (
			options: Record<string, unknown>
		) => { append: (el: HTMLElement) => void };

		qrCodeInstance = new QRCode(getQRCodeOptions());
		(qrCodeInstance as { append: (el: HTMLElement) => void }).append(qrCodeContainer);
	});

	// Listen for theme changes
	let themeObserver: MutationObserver | null = null;

	onMount(() => {
		themeObserver = new MutationObserver(() => {
			const theme = document.documentElement.getAttribute('data-theme');
			if (theme !== currentTheme) {
				currentTheme = theme;
				// Force re-render by updating key
				qrKey = qrKey + 1;
			}
		});

		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});

		// Initial theme
		currentTheme = document.documentElement.getAttribute('data-theme');
	});

	onDestroy(() => {
		if (themeObserver) {
			themeObserver.disconnect();
		}
	});

	// Re-render when data or theme changes
	$effect(() => {
		// This will trigger when qrKey changes
		// Use qrKey to register dependency without violating linting rules
		if (!data || !qrCodeContainer) return;

		// Access qrKey to register it as a dependency
		const currentKey = qrKey;
		if (currentKey === undefined) return;

		// Re-create QR code
		const QRCode = QRCodeStyling as unknown as new (
			options: Record<string, unknown>
		) => { append: (el: HTMLElement) => void };

		const newQRCode = new QRCode(getQRCodeOptions());

		// Clear content and append new QR code
		// eslint-disable-next-line svelte/no-dom-manipulating
		qrCodeContainer.textContent = '';
		newQRCode.append(qrCodeContainer);
		qrCodeInstance = newQRCode;
	});
</script>

{#key qrKey}
	<div class="qr-code {className}" bind:this={qrCodeContainer}></div>
{/key}

<style>
	.qr-code {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-background);
	}

	.qr-code :global(svg) {
		width: 100%;
		height: 100%;
	}
</style>
