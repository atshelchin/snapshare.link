<script lang="ts" module>
	// Module context - 全局状态，确保同时只播放一个
	let currentPlaying: HTMLVideoElement | null = $state(null);

	export function stopCurrentPlaying() {
		if (currentPlaying && !currentPlaying.paused) {
			currentPlaying.pause();
		}
	}
</script>

<script lang="ts">
	import { stopCurrentPlaying as stopAudio } from './audio-player.svelte';

	let { src } = $props<{ src: string; fileName?: string }>();

	let video = $state<HTMLVideoElement>();
	let container = $state<HTMLDivElement>();
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let showControls = $state(true);
	let isFullscreen = $state(false);
	let hideControlsTimeout: ReturnType<typeof setTimeout>;

	function togglePlay() {
		if (!video) return;

		if (isPlaying) {
			video.pause();
		} else {
			// 停止其他正在播放的视频和音频
			stopCurrentPlaying();
			stopAudio();
			currentPlaying = video;
			video.play();
		}
	}

	function handleTimeUpdate() {
		if (video) {
			currentTime = video.currentTime;
		}
	}

	function handleLoadedMetadata() {
		if (video) {
			duration = video.duration;
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
		if (video) {
			video.currentTime = percent * duration;
		}
	}

	function handleVolumeChange(e: Event) {
		const target = e.target as HTMLInputElement;
		volume = parseFloat(target.value);
		if (video) {
			video.volume = volume;
		}
	}

	function toggleFullscreen() {
		if (!container) return;

		if (!isFullscreen) {
			if (container.requestFullscreen) {
				container.requestFullscreen();
			}
		} else {
			if (document.exitFullscreen) {
				document.exitFullscreen();
			}
		}
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	function showControlsTemporarily() {
		showControls = true;
		clearTimeout(hideControlsTimeout);
		if (isPlaying) {
			hideControlsTimeout = setTimeout(() => {
				showControls = false;
			}, 3000);
		}
	}

	function handleMouseMove() {
		showControlsTemporarily();
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	const progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	$effect(() => {
		if (container) {
			container.addEventListener('fullscreenchange', handleFullscreenChange);
			return () => {
				container?.removeEventListener('fullscreenchange', handleFullscreenChange);
			};
		}
	});
</script>

<div class="video-player-container" bind:this={container} onmousemove={handleMouseMove}>
	<video
		bind:this={video}
		{src}
		class="video-element"
		onclick={togglePlay}
		ontimeupdate={handleTimeUpdate}
		onloadedmetadata={handleLoadedMetadata}
		onended={handleEnded}
		onplay={handlePlay}
		onpause={handlePause}
	></video>

	<div class="video-overlay" class:show={showControls || !isPlaying}>
		{#if !isPlaying}
			<button class="play-overlay-button" onclick={togglePlay} aria-label="Play">
				<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z" />
				</svg>
			</button>
		{/if}

		<div class="video-controls">
			<div class="progress-container">
				<button class="progress-bar" onclick={handleSeek} aria-label="Seek">
					<div class="progress-track">
						<div class="progress-fill" style="width: {progress}%"></div>
					</div>
				</button>
			</div>

			<div class="controls-row">
				<div class="left-controls">
					<button
						class="control-button"
						onclick={togglePlay}
						aria-label={isPlaying ? 'Pause' : 'Play'}
					>
						{#if isPlaying}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
								<rect x="6" y="4" width="4" height="16" rx="1" />
								<rect x="14" y="4" width="4" height="16" rx="1" />
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
								<path d="M8 5v14l11-7z" />
							</svg>
						{/if}
					</button>

					<div class="volume-control">
						<button class="control-button" aria-label="Volume">
							{#if volume === 0}
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<path
										d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"
										stroke-width="2"
										stroke-linecap="round"
									/>
								</svg>
							{:else}
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
									<path
										d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14"
										stroke-width="2"
									/>
								</svg>
							{/if}
						</button>
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
					</div>

					<div class="time-display">
						<span>{formatTime(currentTime)}</span>
						<span>/</span>
						<span>{formatTime(duration)}</span>
					</div>
				</div>

				<div class="right-controls">
					<button class="control-button" onclick={toggleFullscreen} aria-label="Fullscreen">
						{#if isFullscreen}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
								<path
									d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
								<path
									d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.video-player-container {
		position: relative;
		width: 100%;
		max-width: 100%;
		background: black;
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	@media (min-width: 640px) {
		.video-player-container {
			max-width: 800px;
		}
	}

	.video-player-container:fullscreen {
		border-radius: 0;
		max-width: none;
	}

	.video-element {
		width: 100%;
		max-width: 100%;
		height: auto;
		display: block;
		cursor: pointer;
	}

	.video-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 50%);
		opacity: 0;
		transition: opacity 0.3s ease;
		pointer-events: none;
	}

	.video-overlay.show {
		opacity: 1;
		pointer-events: auto;
	}

	.play-overlay-button {
		width: 80px;
		height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.2);
		backdrop-filter: blur(10px);
		color: white;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
		margin-bottom: auto;
		margin-top: auto;
	}

	.play-overlay-button:hover {
		transform: scale(1.1);
		background: rgba(255, 255, 255, 0.3);
	}

	.video-controls {
		width: 100%;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: auto;
	}

	.progress-container {
		width: 100%;
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
		height: 4px;
		background: rgba(255, 255, 255, 0.3);
		border-radius: var(--radius-full);
		overflow: hidden;
		position: relative;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-primary);
		border-radius: var(--radius-full);
		transition: width 0.1s linear;
	}

	.controls-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.left-controls,
	.right-controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.control-button {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: white;
		border: none;
		border-radius: var(--radius);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.control-button:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.volume-slider {
		width: 80px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: rgba(255, 255, 255, 0.3);
		border-radius: var(--radius-full);
		outline: none;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		background: white;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.volume-slider::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	.volume-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: white;
		border: none;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.volume-slider::-moz-range-thumb:hover {
		transform: scale(1.2);
	}

	.time-display {
		display: flex;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: white;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 640px) {
		.volume-control {
			display: none;
		}
	}
</style>
