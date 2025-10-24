<script lang="ts">
	import { Sun, Moon } from '@lucide/svelte';
	import { useTheme } from '../stores/theme.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';

	interface Props {
		size?: 'sm' | 'md' | 'lg';
		showLabel?: boolean;
		labelPosition?: 'left' | 'right';
	}

	let { size = 'md', showLabel = false, labelPosition = 'right' }: Props = $props();

	// Use global theme store
	const themeStore = useTheme();
	const i18n = useI18n();

	// Size mapping
	const sizeMap = {
		sm: { button: '2rem', icon: 16 },
		md: { button: '2.5rem', icon: 20 },
		lg: { button: '3rem', icon: 24 }
	};

	const currentSize = $derived(sizeMap[size]);

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			themeStore.toggleTheme();
		}
	}
</script>

<div class="theme-toggle-wrapper" data-position={labelPosition}>
	{#if showLabel && labelPosition === 'left'}
		<span class="theme-label">
			{themeStore.theme === 'light' ? i18n.t('theme.light') : i18n.t('theme.dark')}
		</span>
	{/if}

	<button
		class="theme-toggle theme-toggle-{size}"
		onclick={themeStore.toggleTheme}
		onkeydown={handleKeyDown}
		aria-label={themeStore.theme === 'light'
			? i18n.t('theme.switchToDark')
			: i18n.t('theme.switchToLight')}
		title={themeStore.theme === 'light'
			? i18n.t('theme.switchToDark')
			: i18n.t('theme.switchToLight')}
		style="--button-size: {currentSize.button}"
	>
		<div class="icon-wrapper" data-theme={themeStore.theme}>
			{#if themeStore.theme === 'light'}
				<Sun size={currentSize.icon} class="theme-icon sun-icon" />
			{:else}
				<Moon size={currentSize.icon} class="theme-icon moon-icon" />
			{/if}
		</div>
	</button>

	{#if showLabel && labelPosition === 'right'}
		<span class="theme-label">
			{themeStore.theme === 'light' ? i18n.t('theme.light') : i18n.t('theme.dark')}
		</span>
	{/if}
</div>

<style>
	.theme-toggle-wrapper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.theme-toggle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--button-size);
		height: var(--button-size);
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-background);
		color: var(--color-foreground);
		cursor: pointer;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		overflow: hidden;
	}

	.theme-toggle:hover {
		background: var(--color-muted);
		border-color: var(--color-primary);
		transform: scale(1.05);
	}

	.theme-toggle:active {
		transform: scale(0.95);
	}

	.theme-toggle:focus-visible {
		outline: 2px solid var(--color-ring);
		outline-offset: 2px;
	}

	.icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		animation: icon-in 300ms ease-out;
	}

	.icon-wrapper[data-theme='dark'] {
		animation: rotate-in 300ms ease-out;
	}

	:global(.theme-icon) {
		display: block;
		stroke-width: 2;
	}

	:global(.sun-icon) {
		color: var(--color-warning, #f59e0b);
		animation: sun-rotate 300ms ease-out;
	}

	:global(.moon-icon) {
		color: var(--color-primary);
		animation: moon-scale 300ms ease-out;
	}

	.theme-label {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-muted-foreground);
		user-select: none;
	}

	/* Size variants */
	.theme-toggle-sm {
		border-radius: var(--radius-md);
	}

	.theme-toggle-lg {
		border-radius: var(--radius-xl);
	}

	/* Animations */
	@keyframes icon-in {
		from {
			opacity: 0;
			transform: scale(0.8);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes rotate-in {
		from {
			transform: rotate(-90deg) scale(0.8);
			opacity: 0;
		}
		to {
			transform: rotate(0deg) scale(1);
			opacity: 1;
		}
	}

	@keyframes sun-rotate {
		from {
			transform: rotate(-45deg);
		}
		to {
			transform: rotate(0deg);
		}
	}

	@keyframes moon-scale {
		0% {
			transform: scale(0.8);
		}
		50% {
			transform: scale(1.1);
		}
		100% {
			transform: scale(1);
		}
	}

	/* High contrast mode */
	:global([data-contrast='high']) .theme-toggle {
		border-width: 2px;
		font-weight: var(--font-semibold);
	}

	:global([data-contrast='ultra']) .theme-toggle {
		border-width: 3px;
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.theme-toggle,
		.icon-wrapper,
		:global(.theme-icon) {
			animation: none;
			transition: none;
		}
	}

	/* Dark theme specific styles */
	:global([data-theme='dark']) .theme-toggle {
		background: var(--color-panel-1);
	}

	:global([data-theme='dark']) .theme-toggle:hover {
		background: var(--color-panel-2);
	}
</style>
