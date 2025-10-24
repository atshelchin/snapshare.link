<script lang="ts" module>
	// Module context - 全局状态，确保同时只播放一个
	let currentPlaying: HTMLAudioElement | null = $state(null);

	export function stopCurrentPlaying() {
		if (currentPlaying && !currentPlaying.paused) {
			currentPlaying.pause();
		}
	}
</script>

<script lang="ts">
	let { src, fileName } = $props<{ src: string; fileName: string }>();

	let audio = $state<HTMLAudioElement>();
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let showVolumeSlider = $state(false);

	function togglePlay() {
		if (!audio) return;

		if (isPlaying) {
			audio.pause();
		} else {
			// 停止其他正在播放的音频
			stopCurrentPlaying();
			currentPlaying = audio;
			audio.play();
		}
	}

	function handleTimeUpdate() {
		if (audio) {
			currentTime = audio.currentTime;
		}
	}

	function handleLoadedMetadata() {
		if (audio) {
			duration = audio.duration;
		}
	}

	function handleEnded() {
		isPlaying = false;
		currentTime = 0;
	}

	function handlePlay() {
		isPlaying = true;
	}

	function handlePause() {
		isPlaying = false;
	}

	function handleSeek(e: MouseEvent) {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const percent = (e.clientX - rect.left) / rect.width;
		if (audio) {
			audio.currentTime = percent * duration;
		}
	}

	function handleVolumeChange(e: Event) {
		const target = e.target as HTMLInputElement;
		volume = parseFloat(target.value);
		if (audio) {
			audio.volume = volume;
		}
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	const progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
</script>

<div class="audio-player">
	<audio
		bind:this={audio}
		{src}
		ontimeupdate={handleTimeUpdate}
		onloadedmetadata={handleLoadedMetadata}
		onended={handleEnded}
		onplay={handlePlay}
		onpause={handlePause}
	></audio>

	<button class="play-button" onclick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
		{#if isPlaying}
			<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="4" width="4" height="16" rx="1" />
				<rect x="14" y="4" width="4" height="16" rx="1" />
			</svg>
		{:else}
			<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
				<path d="M8 5v14l11-7z" />
			</svg>
		{/if}
	</button>

	<div class="player-info">
		<div class="track-name">{fileName}</div>
		<div class="progress-container">
			<button class="progress-bar" onclick={handleSeek} aria-label="Seek">
				<div class="progress-track">
					<div class="progress-fill" style="width: {progress}%"></div>
				</div>
			</button>
			<div class="time-display">
				<span class="current-time">{formatTime(currentTime)}</span>
				<span class="duration">{formatTime(duration)}</span>
			</div>
		</div>
	</div>

	<div class="volume-control">
		<button
			class="volume-button"
			onclick={() => (showVolumeSlider = !showVolumeSlider)}
			aria-label="Volume"
		>
			{#if volume === 0}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			{:else if volume < 0.5}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07" stroke-width="2" />
				</svg>
			{:else}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path
						d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"
						stroke-width="2"
					/>
				</svg>
			{/if}
		</button>

		{#if showVolumeSlider}
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={volume}
				oninput={handleVolumeChange}
				class="volume-slider"
				aria-label="Volume level"
			/>
		{/if}
	</div>
</div>

<style>
	.audio-player {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4);
		background: linear-gradient(135deg, var(--color-panel-1) 0%, var(--color-panel-2) 100%);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		transition: all 0.2s ease;
		max-width: 100%;
		overflow: hidden;
	}

	.audio-player:hover {
		border-color: var(--color-primary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.play-button {
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.play-button:hover {
		transform: scale(1.1);
		box-shadow: 0 4px 12px hsla(var(--brand-hue), var(--brand-saturation), 50%, 0.4);
	}

	.play-button:active {
		transform: scale(0.95);
	}

	.player-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.track-name {
		font-size: var(--text-sm);
		font-weight: var(--font-medium);
		color: var(--color-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.progress-container {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.progress-bar {
		width: 100%;
		height: 24px;
		display: flex;
		align-items: center;
		background: none;
		border: none;
		padding: var(--space-2) 0;
		cursor: pointer;
	}

	.progress-track {
		width: 100%;
		height: 6px;
		background: var(--color-panel-2);
		border-radius: var(--radius-full);
		overflow: hidden;
		position: relative;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			var(--color-primary),
			hsla(var(--brand-hue), var(--brand-saturation), 60%, 1)
		);
		border-radius: var(--radius-full);
		transition: width 0.1s linear;
	}

	.time-display {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-xs);
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		position: relative;
	}

	.volume-button {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: var(--color-muted-foreground);
		border: none;
		border-radius: var(--radius);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.volume-button:hover {
		background: var(--color-panel-2);
		color: var(--color-foreground);
	}

	.volume-slider {
		width: 80px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--gray-500);
		border-radius: var(--radius-full);
		outline: none;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		background: var(--color-primary);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.volume-slider::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	.volume-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: var(--color-primary);
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.volume-slider::-moz-range-thumb:hover {
		transform: scale(1.2);
	}

	@media (max-width: 640px) {
		.audio-player {
			flex-wrap: wrap;
		}

		.volume-control {
			width: 100%;
			justify-content: center;
		}

		.volume-slider {
			flex: 1;
		}
	}
</style>
