<script lang="ts">
	interface Tab {
		id: string;
		label: string;
		icon?: string;
	}

	let {
		tabs,
		activeTab = $bindable(),
		children
	} = $props<{
		tabs: Tab[];
		activeTab: string;
		children: import('svelte').Snippet;
	}>();
</script>

<div class="tabs-container">
	<div class="tabs-header">
		{#each tabs as tab (tab.id)}
			<button
				class="tab-button"
				class:active={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
			>
				{#if tab.icon}
					<span class="tab-icon">{tab.icon}</span>
				{/if}
				<span>{tab.label}</span>
			</button>
		{/each}
	</div>

	<div class="tabs-content">
		{@render children()}
	</div>
</div>

<style>
	.tabs-container {
		width: 100%;
	}

	.tabs-header {
		display: flex;
		gap: var(--space-2);
		border-bottom: 2px solid var(--color-border);
		margin-bottom: var(--space-4);
	}

	.tab-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		font-size: var(--text-base);
		font-weight: var(--font-medium);
		color: var(--color-muted-foreground);
		transition: all 0.2s ease;
		margin-bottom: -2px;
	}

	.tab-button:hover {
		color: var(--color-foreground);
		background: var(--color-panel-1);
	}

	.tab-button.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
		font-weight: var(--font-semibold);
	}

	.tab-icon {
		font-size: var(--text-lg);
	}

	.tabs-content {
		padding: var(--space-4) 0;
	}
</style>
