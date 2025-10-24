<script lang="ts">
	import ThemeToggle from './theme-toggle.svelte';
	import LangToggle from './lang-toggle.svelte';
	import { useI18n } from '@shelchin/i18n/svelte';

	const i18n = useI18n();
</script>

<div class="header">
	<!-- 切换按钮 -->
	<div class="header-controls">
		<ThemeToggle />
		<LangToggle />
	</div>

	<h1 id="headerTitle">⚡ SnapShare.link</h1>
	<p id="headerDesc">{i18n.t('app.description')}</p>
</div>

<style>
	.header {
		background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
		color: var(--header-text);
		padding: 30px;
		text-align: center;
		position: relative;
		height: 190px;
	}

	.header h1 {
		font-size: 32px;
		margin-bottom: 10px;
	}
	.header p {
		opacity: 0.9;
		font-size: 14px;
	}
	.header-controls {
		position: absolute;
		top: 15px;
		right: 15px;
		display: flex;
		gap: 8px;
	}
	#headerTitle {
		color: var(--header-text);
	}
	/* .control-btn {
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.3);
		color: white;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 16px;
		transition: all 0.3s ease;
		backdrop-filter: blur(10px);
	} */
</style>
