<script lang="ts">
	import { onMount } from 'svelte';
	import { useI18n } from '@shelchin/i18n/svelte';

	import type { Snippet } from 'svelte';

	const i18n = useI18n();

	interface Props {
		open?: boolean;
		onClose?: () => void;
		title?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		closeOnOverlay?: boolean;
		closeOnEsc?: boolean;
		children?: Snippet;
		footer?: Snippet;
	}

	let {
		open = $bindable(false),
		onClose,
		title,
		size = 'md',
		closeOnOverlay = true,
		closeOnEsc = true,
		children,
		footer
	}: Props = $props();

	let dialog: HTMLDialogElement;
	let modalContent: HTMLDivElement;
	let startY = 0;
	let currentY = 0;
	let isDragging = false;
	let savedScrollY = 0;

	function handleClose() {
		open = false;
		onClose?.();
	}

	function handleOverlayClick(e: MouseEvent) {
		if (closeOnOverlay && e.target === dialog) {
			handleClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault(); // Always prevent default ESC behavior
			if (closeOnEsc) {
				handleClose();
			}
		}
	}

	function handleCancel(e: Event) {
		// The cancel event fires when ESC is pressed on a dialog
		e.preventDefault();
		if (closeOnEsc) {
			handleClose();
		}
	}

	// Touch handlers for swipe-to-dismiss on mobile
	function handleTouchStart(e: TouchEvent) {
		if (window.innerWidth > 640) return; // Only on mobile
		startY = e.touches[0].clientY;
		isDragging = true;

		// Remove any existing transition for immediate response
		if (dialog) {
			dialog.style.transition = 'none';
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isDragging || window.innerWidth > 640) return;

		currentY = e.touches[0].clientY;
		const deltaY = currentY - startY;

		// Only allow dragging down
		if (deltaY > 0 && dialog) {
			// Use transform3d for hardware acceleration
			dialog.style.transform = `translate3d(0, ${deltaY}px, 0)`;

			// Calculate opacity based on drag distance (max 200px for full transparency)
			const maxDragDistance = 200;
			const opacity = Math.max(0.3, 1 - deltaY / maxDragDistance);

			// Apply opacity to backdrop
			dialog.style.setProperty('--backdrop-opacity', opacity.toString());
		} else if (deltaY <= 0 && dialog) {
			// Reset if trying to drag up
			dialog.style.transform = 'translate3d(0, 0, 0)';
			dialog.style.setProperty('--backdrop-opacity', '1');
		}
	}

	function handleTouchEnd() {
		if (!isDragging || window.innerWidth > 640) return;

		const deltaY = currentY - startY;

		// If dragged more than 100px, close the modal
		if (deltaY > 100) {
			// Animate out before closing
			dialog.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out';
			dialog.style.transform = 'translateY(100%)';
			dialog.style.opacity = '0';

			setTimeout(() => {
				handleClose();
				// Reset styles for next open
				dialog.style.transition = '';
				dialog.style.transform = '';
				dialog.style.opacity = '';
			}, 200);
		} else if (dialog) {
			// Snap back to original position with animation
			dialog.style.transition = 'transform 200ms ease-out';
			dialog.style.transform = 'translateY(0)';

			// Animate backdrop opacity back
			const currentOpacity = dialog.style.getPropertyValue('--backdrop-opacity') || '1';
			const startTime = performance.now();
			const duration = 200;
			const startOpacity = parseFloat(currentOpacity);

			function animateOpacity(currentTime: number) {
				const elapsed = currentTime - startTime;
				const progress = Math.min(elapsed / duration, 1);
				const opacity = startOpacity + (1 - startOpacity) * progress;
				dialog.style.setProperty('--backdrop-opacity', opacity.toString());

				if (progress < 1) {
					requestAnimationFrame(animateOpacity);
				}
			}

			requestAnimationFrame(animateOpacity);

			// Reset transition after animation
			setTimeout(() => {
				dialog.style.transition = '';
			}, 200);
		}

		isDragging = false;
		startY = 0;
		currentY = 0;
	}

	// Handle modal open/close - only on client side
	function lockBodyScroll() {
		if (typeof window !== 'undefined' && typeof document !== 'undefined') {
			savedScrollY = window.scrollY;

			// Add class and inline styles for maximum compatibility
			document.body.classList.add('modal-open');
			document.body.style.setProperty('--scroll-y', `-${savedScrollY}px`);

			// Fallback: also apply inline styles directly
			document.body.style.overflow = 'hidden';
			document.body.style.position = 'fixed';
			document.body.style.top = `-${savedScrollY}px`;
			document.body.style.left = '0';
			document.body.style.right = '0';
			document.body.style.width = '100%';
		}
	}

	function unlockBodyScroll() {
		if (typeof window !== 'undefined' && typeof document !== 'undefined') {
			document.body.classList.remove('modal-open');
			document.body.style.removeProperty('--scroll-y');

			// Remove all inline styles
			document.body.style.overflow = '';
			document.body.style.position = '';
			document.body.style.top = '';
			document.body.style.left = '';
			document.body.style.right = '';
			document.body.style.width = '';

			if (savedScrollY) {
				window.scrollTo(0, savedScrollY);
				savedScrollY = 0;
			}
		}
	}

	// Watch for dialog state changes
	$effect(() => {
		// Only run on client
		if (typeof window === 'undefined') return;

		if (dialog && open) {
			// Small delay to ensure dialog is ready
			const timer = setTimeout(() => {
				if (dialog && !dialog.open) {
					dialog.showModal();
					dialog.style.transform = '';
					dialog.style.setProperty('--backdrop-opacity', '1');
					lockBodyScroll();
				}
			}, 0);

			return () => clearTimeout(timer);
		} else if (dialog && !open && dialog.open) {
			dialog.close();
			unlockBodyScroll();
		}
	});

	onMount(() => {
		return () => {
			if (dialog?.open) {
				dialog.close();
				unlockBodyScroll();
			}
		};
	});
</script>

<dialog
	bind:this={dialog}
	class="modal modal-{size}"
	onclick={handleOverlayClick}
	onkeydown={handleKeydown}
	oncancel={handleCancel}
	aria-labelledby={title ? 'modal-title' : undefined}
>
	<div
		class="modal-content"
		bind:this={modalContent}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
	>
		<!-- Mobile drag handle -->
		<div class="modal-drag-handle">
			<div class="drag-handle-bar"></div>
		</div>

		{#if title}
			<div class="modal-header">
				<h2 id="modal-title" class="modal-title">{title}</h2>
				<button class="modal-close" onclick={handleClose} aria-label={i18n.t('modal.close')}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
						<path d="M15 5L5 15M5 5l10 10" stroke-width="2" stroke-linecap="round" />
					</svg>
				</button>
			</div>
		{/if}

		<div class="modal-body">
			{@render children?.()}
		</div>

		{#if footer}
			<div class="modal-footer">
				{@render footer()}
			</div>
		{/if}
	</div>
</dialog>

<style>
	/* Global body scroll lock styles */
	:global(body.modal-open) {
		overflow: hidden !important;
		position: fixed !important;
		top: var(--scroll-y, 0) !important;
		left: 0 !important;
		right: 0 !important;
		width: 100% !important;
	}

	.modal {
		margin: auto;
		padding: 0;
		border: none;
		border-radius: var(--radius-lg);
		background: var(--color-popover);
		color: var(--color-popover-foreground);
		box-shadow: var(--shadow-2xl);
		max-width: 90vw;
		max-height: 85vh;
		overflow: visible;
		animation: modal-in 200ms ease-out;
	}

	.modal::backdrop {
		--base-opacity: 0.5;
		background: rgba(0, 0, 0, calc(var(--base-opacity) * var(--backdrop-opacity, 1)));
		backdrop-filter: blur(calc(4px * var(--backdrop-opacity, 1)));
		animation: fade-in 200ms ease-out;
		transition:
			opacity 200ms ease-out,
			backdrop-filter 200ms ease-out;
	}

	:global([data-theme='dark']) .modal::backdrop {
		--base-opacity: 0.7;
		background: rgba(0, 0, 0, calc(var(--base-opacity) * var(--backdrop-opacity, 1)));
		backdrop-filter: blur(calc(8px * var(--backdrop-opacity, 1)));
	}

	/* 高对比度模式支持 */
	:global([data-contrast='high']) .modal {
		border: 2px solid var(--color-border);
	}

	:global([data-contrast='ultra']) .modal {
		border: 3px solid var(--color-border);
	}

	:global([data-contrast='ultra']) .modal::backdrop {
		background: rgba(0, 0, 0, 0.9);
		backdrop-filter: none;
	}

	.modal-content {
		display: flex;
		flex-direction: column;
		max-height: 85vh;
		overflow: hidden;
		position: relative;
		transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	/* Drag handle - hidden on desktop */
	.modal-drag-handle {
		display: none;
	}

	.drag-handle-bar {
		width: 3rem;
		height: 0.25rem;
		background: var(--color-muted-foreground);
		opacity: 0.3;
		border-radius: var(--radius-full);
		margin: 0 auto;
	}

	.modal-sm {
		width: min(24rem, 90vw);
	}

	.modal-md {
		width: min(32rem, 90vw);
	}

	.modal-lg {
		width: min(48rem, 90vw);
	}

	.modal-xl {
		width: min(64rem, 90vw);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-6) var(--space-6) var(--space-3) var(--space-6);
		flex-shrink: 0;
	}

	.modal-title {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--font-semibold);
		color: var(--color-heading-1);
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.modal-close:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
		transform: scale(1.05);
	}

	.modal-close:focus-visible {
		outline: 2px solid var(--color-ring);
		outline-offset: 2px;
	}

	.modal-body {
		padding: var(--space-3) var(--space-6) var(--space-6) var(--space-6);
		overflow-y: auto;
		flex: 1 1 auto; /* Allow shrinking and growing */
		min-height: 0; /* Important for flexbox scrolling */
		-webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
		overscroll-behavior: contain; /* Prevent scroll chaining */
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: var(--space-6);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	@keyframes modal-in {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* Mobile styles - Sheet Modal */
	@media (max-width: 640px) {
		.modal {
			position: fixed;
			bottom: 0 !important; /* Force stick to bottom */
			top: auto !important;
			left: 0;
			right: 0;
			margin: 0;
			max-width: 100%;
			width: 100%;
			height: auto;
			max-height: 85vh; /* Leave more space at the top for iPhone */
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
			animation: sheet-slide-up 300ms cubic-bezier(0.32, 0.72, 0, 1);
			will-change: transform, opacity;
			/* Enable hardware acceleration */
			transform: translate3d(0, 0, 0);
			backface-visibility: hidden;
			perspective: 1000px;
		}

		.modal::backdrop {
			animation: fade-in 300ms ease-out;
		}

		.modal-content {
			display: flex;
			flex-direction: column;
			height: auto;
			max-height: 85vh;
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
			overflow: hidden;
		}

		/* Show drag handle on mobile */
		.modal-drag-handle {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: var(--space-3) 0 var(--space-2);
			cursor: grab;
			touch-action: pan-y;
		}

		.modal-drag-handle:active {
			cursor: grabbing;
		}

		.modal-header {
			padding: var(--space-4) var(--space-5) var(--space-2) var(--space-5);
		}

		.modal-body {
			padding: var(--space-2) var(--space-5) var(--space-5) var(--space-5);
			/* Add safe area padding for devices with home indicator */
			padding-bottom: max(var(--space-5), env(safe-area-inset-bottom));
		}

		.modal-footer {
			padding: var(--space-5);
			padding-bottom: max(var(--space-5), env(safe-area-inset-bottom));
		}

		/* All modals are full width on mobile */
		.modal-sm,
		.modal-md,
		.modal-lg,
		.modal-xl {
			width: 100%;
		}

		/* Closing animation */
		.modal:not([open]) {
			animation: sheet-slide-down 200ms cubic-bezier(0.32, 0.72, 0, 1);
		}
	}

	@keyframes sheet-slide-up {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes sheet-slide-down {
		from {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(100%);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.modal,
		.modal::backdrop {
			animation: none;
		}

		.modal-content {
			transition: none;
		}
	}
</style>
