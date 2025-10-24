<script lang="ts">
	import { useI18n } from '@shelchin/i18n/svelte';

	const i18n = useI18n();
	let isOpen = $state(false);
	let selectedLang = $state(i18n.locale);
	let dropdownDirection = $state<'down' | 'up'>('down');
	let dropdownAlign = $state<'left' | 'right'>('right');
	let containerRef = $state<HTMLDivElement>();

	const languages = [
		{ code: 'en', label: 'English', flag: '🇺🇸' },
		{ code: 'zh', label: '中文', flag: '🇨🇳' }
	];

	const currentLanguage = $derived(
		languages.find((lang) => lang.code === selectedLang) || languages[0]
	);

	const checkDropdownPosition = () => {
		if (!containerRef) return;

		// 获取 container 元素
		const container = document.getElementById('container');
		if (!container) return;

		const rect = containerRef.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		console.log({ rect, containerRect });

		const menuHeight = 100; // Approximate height of dropdown menu
		const menuWidth = 160; // Approximate width of dropdown menu

		// Check vertical space relative to container
		const spaceBelow = containerRect.bottom - rect.bottom;
		const spaceAbove = rect.top - containerRect.top;

		// Check horizontal space relative to container
		const spaceRight = containerRect.right - rect.right;
		const spaceLeft = rect.left - containerRect.left;

		console.log({ spaceRight, menuWidth, spaceLeft, spaceBelow, spaceAbove });

		// Determine vertical direction
		if (spaceBelow < menuHeight && spaceAbove > menuHeight) {
			dropdownDirection = 'up';
		} else {
			dropdownDirection = 'down';
		}

		// Determine horizontal alignment
		if (spaceRight < menuWidth && spaceLeft > menuWidth) {
			dropdownAlign = 'right';
		} else {
			dropdownAlign = 'left';
		}
	};

	const toggleDropdown = () => {
		if (!isOpen) {
			checkDropdownPosition();
		}
		isOpen = !isOpen;
	};

	const selectLanguage = (code: string) => {
		selectedLang = code;
		i18n.setLocale(code);
		isOpen = false;
	};

	// Close dropdown when clicking outside
	const handleClickOutside = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (!target.closest('.lang-toggle-container')) {
			isOpen = false;
		}
	};

	// Check position on scroll or resize
	const handleScrollOrResize = () => {
		if (isOpen) {
			checkDropdownPosition();
		}
	};

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			window.addEventListener('scroll', handleScrollOrResize, true);
			window.addEventListener('resize', handleScrollOrResize);
			return () => {
				document.removeEventListener('click', handleClickOutside);
				window.removeEventListener('scroll', handleScrollOrResize, true);
				window.removeEventListener('resize', handleScrollOrResize);
			};
		}
	});
</script>

<div class="lang-toggle-container" bind:this={containerRef}>
	<button
		class="lang-toggle-button"
		onclick={toggleDropdown}
		aria-label="Select language"
		aria-expanded={isOpen}
	>
		<span class="flag">{currentLanguage.flag}</span>
		<svg
			class="chevron"
			class:rotated={isOpen}
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M6 9l6 6 6-6" />
		</svg>
	</button>

	{#if isOpen}
		<div
			class="dropdown-menu"
			class:dropdown-up={dropdownDirection === 'up'}
			class:dropdown-right={dropdownAlign === 'right'}
		>
			{#each languages as lang (lang.code)}
				<button
					class="dropdown-item"
					class:active={selectedLang === lang.code}
					onclick={() => selectLanguage(lang.code)}
				>
					<span class="flag">{lang.flag}</span>
					<span class="label">{lang.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.lang-toggle-container {
		position: relative;
		display: inline-block;
	}

	.lang-toggle-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: var(--text-base);
		min-width: 4rem;
		height: 2.5rem;
	}

	.lang-toggle-button:hover {
		background: var(--color-panel-1);
		border-color: var(--color-primary);
	}

	.flag {
		font-size: 1.25rem;
		line-height: 1;
		display: flex;
		align-items: center;
	}

	.chevron {
		color: var(--color-muted-foreground);
		transition: transform 0.2s ease;
		margin-left: auto;
	}

	.chevron.rotated {
		transform: rotate(180deg);
	}

	.dropdown-menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		left: 0;
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		min-width: 10rem;
		z-index: 1000;
		overflow: hidden;
		animation: slideDown 0.2s ease;
		padding: 6px;
	}

	/* When dropdown should appear above the button */
	.dropdown-menu.dropdown-up {
		top: auto;
		bottom: calc(100% + var(--space-1));
		animation: slideUp 0.2s ease;
	}

	/* When dropdown should align to the right */
	.dropdown-menu.dropdown-right {
		left: auto;
		right: 0;
	}

	/* Combination: up and right */
	.dropdown-menu.dropdown-up.dropdown-right {
		left: auto;
		right: 0;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2-5) var(--space-3);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: var(--text-sm);
		color: var(--color-foreground);
		text-align: left;
		position: relative;

		margin-top: 8px;
		margin-bottom: 8px;
	}

	.dropdown-item:hover {
		background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.1);
		color: var(--color-primary);
		padding-left: calc(var(--space-3) + 4px);
	}

	.dropdown-item.active {
		background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.15);
		color: var(--color-primary);
		font-weight: var(--font-medium);
	}

	.dropdown-item.active:hover {
		background: hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.2);
	}

	/* Add a subtle left border on hover */
	.dropdown-item::before {
		/* content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: var(--color-primary);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.2s ease; */
	}

	.dropdown-item:hover::before {
		transform: scaleX(1);
	}

	.dropdown-item .label {
		flex: 1;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Dark mode support */
	:global([data-theme='dark']) .lang-toggle-button {
		background: var(--color-panel-1);
		border-color: var(--color-panel-border-2);
	}

	:global([data-theme='dark']) .lang-toggle-button:hover {
		background: var(--color-panel-2);
		border-color: var(--color-primary);
	}

	:global([data-theme='dark']) .dropdown-menu {
		background: var(--color-panel-1);
		border-color: var(--color-panel-border-2);
	}

	:global([data-theme='dark']) .dropdown-item:hover {
		background: hsla(var(--brand-hue), var(--brand-saturation), 60%, 0.15);
		color: hsla(var(--brand-hue), var(--brand-saturation), 70%, 1);
	}

	:global([data-theme='dark']) .dropdown-item.active {
		background: hsla(var(--brand-hue), var(--brand-saturation), 60%, 0.2);
		color: hsla(var(--brand-hue), var(--brand-saturation), 70%, 1);
	}

	:global([data-theme='dark']) .dropdown-item.active:hover {
		background: hsla(var(--brand-hue), var(--brand-saturation), 60%, 0.25);
	}

	/* Mobile responsive - let position detection handle it */
	@media (max-width: 640px) {
		/* Position is handled by the automatic detection */
	}
</style>
