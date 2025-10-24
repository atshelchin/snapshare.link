<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../design-tokens.css';
	import '../global.css';
	import type { LayoutData } from './$types.js';
	import { createI18nStore, setI18nContext } from '@shelchin/i18n/svelte';
	import { PACKAGE_NAME, locales } from '../i18n/i18n.svelte';
	import Header from '../components/header.svelte';
	let { children, data } = $props<{ children: import('svelte').Snippet; data: LayoutData }>();
	console.log({ data });
	const i18nStore = createI18nStore({ initialLocale: data.locale });

	i18nStore.register(PACKAGE_NAME, locales);
	setI18nContext(i18nStore);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="container" id="container">
	<Header />
	<div class="content">
		{@render children?.()}
	</div>
</div>

<style>
	.container {
		background: var(--container-bg);
		border-radius: 20px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		max-width: 800px;
		width: 100%;
		overflow: hidden;
		transition: background 0.3s ease;
	}
	.content {
		padding: 30px;
		min-height: 600px;
		background-color: var(--color-panel-0);
	}
	@media (max-width: 768px) {
		.container {
			width: 100vw;
			border-radius: 0px;
			min-height: 100vh;
		}

		.content {
			padding: 10px;
			min-height: calc(100vh - 190px);
		}
	}

	:global(:root) {
		--brand-hue: 35; /* 主色调 Primary Hue (0-360) - 量子橙 Quantum Amber */
		--brand-saturation: 88%; /* 饱和度 Saturation (0-100%) */
		--radius-scale: 1; /* 圆角缩放 Radius Scale */
		--spacing-scale: 1; /* 间距缩放 Spacing Scale */

		/* 无障碍配置 Accessibility Configuration */
		--font-scale: 1; /* 字体缩放 Font Scale */
		--contrast-mode: normal; /* 对比度模式 Contrast Mode */
		--letter-spacing: normal; /* 字间距 Letter Spacing */
		--line-height: 1.6; /* 行高 Line Height */
	}
</style>
