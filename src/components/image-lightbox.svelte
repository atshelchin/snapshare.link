<script lang="ts">
	let { imageUrl = $bindable(), onClose } = $props<{
		imageUrl: string | null;
		onClose?: () => void;
	}>();

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			close();
		}
	}

	function close() {
		imageUrl = null;
		onClose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		}
	}
</script>

{#if imageUrl}
	<div class="lightbox" onclick={handleBackdropClick} onkeydown={handleKeydown} role="dialog">
		<button class="close-button" onclick={close} aria-label="Close">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
				<path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
		<div class="lightbox-content">
			<img src={imageUrl} alt="Enlarged view" />
		</div>
	</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--space-8);
		backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.close-button {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: var(--radius-full);
		cursor: pointer;
		color: white;
		transition: all 0.2s ease;
		z-index: 1001;
	}

	.close-button:hover {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(1.1);
	}

	.lightbox-content {
		max-width: 90vw;
		max-height: 90vh;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: zoomIn 0.3s ease;
	}

	@keyframes zoomIn {
		from {
			transform: scale(0.9);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.lightbox-content img {
		max-width: 100%;
		max-height: 90vh;
		width: auto;
		height: auto;
		border-radius: var(--radius-lg);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
</style>
