<script lang="ts">
	let copyFeedback = $state(false);
	let { value, label } = $props();
	// Copy to clipboard
	console.log(value, 55);
	async function handleCopy() {
		if (!value) return;

		try {
			// Use fallback for older browsers
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(value);
			} else {
				// Fallback method for non-secure contexts
				const textArea = document.createElement('textarea');
				textArea.value = value;
				textArea.style.position = 'fixed';
				textArea.style.left = '-999999px';
				textArea.style.top = '-999999px';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();

				try {
					document.execCommand('copy');
				} finally {
					textArea.remove();
				}
			}

			copyFeedback = true;
			setTimeout(() => {
				copyFeedback = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}
</script>

<button
	class="copy-button"
	class:copied={copyFeedback}
	onclick={handleCopy}
	aria-label={copyFeedback ? 'Link copied!' : 'Copy link'}
>
	{#if copyFeedback}
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
			<path
				d="M13.5 4.5L6 12L2.5 8.5"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				fill="none"
			/>
		</svg>
	{:else}
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			<rect x="5.5" y="5.5" width="8" height="8" rx="1" stroke="currentColor" />
			<path d="M3.5 10.5V3.5C3.5 2.94772 3.94772 2.5 4.5 2.5H11.5" stroke="currentColor" />
		</svg>
	{/if}
	<span>{label}</span>
</button>

<style>
	.copy-button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: transparent;
		color: var(--color-muted-foreground);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		cursor: pointer;
		transition: all 150ms ease;
		width: 100%;
		justify-content: center;
	}

	/* .copy-button:hover {
		background: var(--color-muted);
		border-color: var(--color-border-hover);
		color: var(--color-foreground);
	} */

	.copy-button.copied {
		color: var(--color-success);
		border-color: var(--color-success);
	}

	.copy-button.copied svg {
		color: var(--color-success);
	}
</style>
