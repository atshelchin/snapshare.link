<script lang="ts">
	let { emojiIcon, content } = $props();
</script>

<div class="expire-notice" data-theme="dark">
	<span class="expire-icon">{emojiIcon}</span>
	<span data-lang="expireNotice">{content}</span>
</div>

<style>
	:global {
		[data-theme='dark'] .expire-notice {
			background: linear-gradient(135deg, #2d1f1f 0%, #3d2525 100%);
			border-color: #5d3535;
			color: #ff8888;
		}
		.expire-notice {
			background: linear-gradient(135deg, #fff5f5 0%, #ffe5e5 100%);
			border: 1px solid #ffcccc;
			border-radius: 8px;
			padding: 10px 15px;
			margin-bottom: 15px;
			font-size: 13px;
			color: #d63031;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.expire-icon {
			font-size: 12px;
		}
	}
</style>
