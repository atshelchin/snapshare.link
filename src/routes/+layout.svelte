<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../design-tokens.css';
	import type { LayoutData } from './$types.js';
	import { createI18nStore, setI18nContext } from '@shelchin/i18n/svelte';
	import { PACKAGE_NAME, locales } from '../i18n/i18n.svelte';
	let { children, data } = $props<{ children: import('svelte').Snippet; data: LayoutData }>();
	console.log({ data });
	const i18nStore = createI18nStore({ initialLocale: data.locale });

	i18nStore.register(PACKAGE_NAME, locales);
	setI18nContext(i18nStore);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
