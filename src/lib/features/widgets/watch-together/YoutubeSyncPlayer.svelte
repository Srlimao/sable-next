<script lang="ts">
  import { untrack } from 'svelte';
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';

  import { clamp } from '#lib/clamp.js';
  import { i18n } from '#lib/i18n.js';
  import { readText, writeText } from '#lib/platform/local-json.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import ResizeHandle from '#lib/ui/primitives/ResizeHandle.svelte';

  import { shouldCorrectDrift, DRIFT_TOLERANCE_SEC, type WatchTogetherItemKind } from './watch-together-protocol.js';
  import {
    parseYoutubeMessage,
    postYoutubeCommand,
    postYoutubeListening,
    youtubeSyncEmbedUrl,
  } from './youtube-source.js';

  interface Props {
    videoId: string;
    kind?: WatchTogetherItemKind;
    playing: boolean;
    targetPositionSec: () => number;
    syncEpoch: number;
    syncVersion: number;
    theater?: boolean;
    maximized?: boolean;
    canControl: boolean;
    shortsScrollMode?: boolean;
    canScrollPrev?: boolean;
    loadingShort?: boolean;
    onLocalPlay: (pos: number) => void;
    onLocalPause: (pos: number) => void;
    onLocalSeek: (pos: number) => void;
    onEnded: () => void;
    onLiveDetected?: () => void;
    onScrollPrev?: () => void;
    onScrollNext?: () => void;
  }

  let {
    videoId,
    kind = 'video',
    playing,
    targetPositionSec,
    syncEpoch,
    syncVersion,
    theater = false,
    maximized = false,
    canControl,
    shortsScrollMode = false,
    canScrollPrev = false,
    loadingShort = false,
    onLocalPlay,
    onLocalPause,
    onLocalSeek,
    onEnded,
    onLiveDetected,
    onScrollPrev,
    onScrollNext,
  }: Props = $props();

  const YT_UNSTARTED = -1;
  const YT_ENDED = 0;
  const YT_PLAYING = 1;
  const YT_PAUSED = 2;
  const YT_BUFFERING = 3;
  const SUPPRESS_MS = 1800;
  const LOAD_SUPPRESS_MS = 2800;
  const DRIFT_CHECK_MS = 2000;
  const LOCAL_SEEK_THRESHOLD_SEC = 1.5;
  const FOCUS_RELEASE_MS = 250;
  const LISTEN_MAX_ATTEMPTS = 60;
  const LISTEN_INTERVAL_MS = 400;
  const SHORT_HEIGHT_STORAGE_KEY = 'sable-watch-together-short-height';
  const MIN_SHORT_HEIGHT = 240;
  const MAX_SHORT_HEIGHT = 760;
  const SHORT_HEIGHT_STEP = 24;
  const WHEEL_COOLDOWN_MS = 450;

  let contained = $derived(theater || maximized);
  const storedShortHeight = Number.parseFloat(readText(SHORT_HEIGHT_STORAGE_KEY) ?? '');
  let shortHeight = $state(
    Number.isFinite(storedShortHeight)
      ? clamp(Math.round(storedShortHeight), MIN_SHORT_HEIGHT, MAX_SHORT_HEIGHT)
      : untrack(() => (theater || maximized ? 540 : 420))
  );
  let lastWheelAt = 0;

  const initialSrc = untrack(() =>
    youtubeSyncEmbedUrl(videoId, kind === 'live' ? 0 : targetPositionSec(), kind)
  );

  let iframe = $state<HTMLIFrameElement | null>(null);
  let playerWrap = $state<HTMLDivElement | null>(null);
  let hoveringPlayer = $state(false);
  let ready = $state(false);
  let loadedVideoId = $state(untrack(() => videoId));
  let playerState = $state(YT_UNSTARTED);
  let localTime = $state(0);
  let lastTickAt = 0;
  let suppressedUntil = 0;
  let activeAd = false;
  let detectedLive = $state(false);
  let liveDuration = 0;
  let isLive = $derived(kind === 'live' || detectedLive);
  let isShort = $derived(!isLive && kind === 'short');
  let autoplayBlocked = $state(false);
  let listenCounter = 1;
  let lastVideoId = untrack(() => videoId);
  let lastSyncEpoch = -1;
  let lastSyncVersion = -1;
  let autoplayTimer: ReturnType<typeof setTimeout> | undefined;
  let focusReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let listenTimer: ReturnType<typeof setInterval> | undefined;

  export function currentPosition(): number {
    return localTime;
  }

  function releaseIframeFocus(): void {
    if (!iframe || document.fullscreenElement) return;
    if (document.activeElement === iframe) {
      iframe.blur();
      playerWrap?.focus({ preventScroll: true });
    }
  }

  function scheduleFocusRelease(): void {
    clearTimeout(focusReleaseTimer);
    focusReleaseTimer = setTimeout(() => {
      if (playerState === YT_PLAYING) releaseIframeFocus();
    }, FOCUS_RELEASE_MS);
  }

  function onPlayerPointerEnter(): void {
    hoveringPlayer = true;
  }

  function onPlayerPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.buttons !== 0 || document.fullscreenElement) return;
    hoveringPlayer = false;
    if (playerState === YT_PLAYING) releaseIframeFocus();
  }

  function onPlayerPointerDown(): void {
    hoveringPlayer = true;
  }

  function seekToLiveEdge(): void {
    if (!iframe) return;
    postYoutubeCommand(iframe, 'seekTo', [liveDuration > 0 ? liveDuration : 1_000_000_000, true]);
  }

  function suppress(ms = SUPPRESS_MS): void {
    suppressedUntil = Date.now() + ms;
  }

  function isSuppressed(): boolean {
    return Date.now() < suppressedUntil;
  }

  function scheduleAutoplayCheck(): void {
    clearTimeout(autoplayTimer);
    autoplayTimer = setTimeout(() => {
      if (playing && ready && playerState !== YT_PLAYING && playerState !== YT_BUFFERING) {
        autoplayBlocked = true;
      }
    }, 1500);
  }

  function applyRemoteState(forceSeek = false): void {
    if (!iframe || !ready) return;
    const target = targetPositionSec();

    if (loadedVideoId !== videoId) {
      suppress(LOAD_SUPPRESS_MS);
      loadedVideoId = videoId;
      localTime = target;
      lastTickAt = Date.now();
      if (isLive) {
        if (playing) {
          postYoutubeCommand(iframe, 'loadVideoById', [videoId]);
          scheduleAutoplayCheck();
        } else {
          postYoutubeCommand(iframe, 'cueVideoById', [videoId]);
        }
      } else if (playing) {
        postYoutubeCommand(iframe, 'loadVideoById', [videoId, target]);
        scheduleAutoplayCheck();
      } else {
        postYoutubeCommand(iframe, 'cueVideoById', [videoId, target]);
      }
      return;
    }

    suppress();

    if (!playing) {
      clearTimeout(autoplayTimer);
      autoplayBlocked = false;
      if (playerState === YT_UNSTARTED) {
        if (isLive) {
          postYoutubeCommand(iframe, 'cueVideoById', [videoId]);
        } else {
          postYoutubeCommand(iframe, 'cueVideoById', [videoId, target]);
          localTime = target;
          lastTickAt = Date.now();
        }
        return;
      }
      postYoutubeCommand(iframe, 'pauseVideo');
      if (!isLive && (forceSeek || Math.abs(localTime - target) > 0.5)) {
        postYoutubeCommand(iframe, 'seekTo', [target, true]);
        localTime = target;
        lastTickAt = Date.now();
        postYoutubeCommand(iframe, 'pauseVideo');
      }
      return;
    }

    if (isLive) {
      if (forceSeek) {
        seekToLiveEdge();
        lastTickAt = Date.now();
      }
    } else if (forceSeek || shouldCorrectDrift(localTime, target)) {
      postYoutubeCommand(iframe, 'seekTo', [target, true]);
      localTime = target;
      lastTickAt = Date.now();
    }

    autoplayBlocked = false;
    postYoutubeCommand(iframe, 'playVideo');
    scheduleAutoplayCheck();
  }

  function handleStateChange(nextState: number): void {
    if (activeAd) return;
    const prevState = playerState;
    playerState = nextState;
    if (nextState === YT_PLAYING || nextState === YT_BUFFERING) {
      clearTimeout(autoplayTimer);
      autoplayBlocked = false;
    }
    if (nextState === YT_PLAYING) {
      scheduleFocusRelease();
    } else {
      clearTimeout(focusReleaseTimer);
    }
    if (nextState === YT_ENDED) {
      if (canControl) onEnded();
      return;
    }
    if (nextState === YT_PLAYING && playing && !isLive && prevState === YT_UNSTARTED && !isSuppressed()) {
      const target = targetPositionSec();
      if (iframe && target - localTime > DRIFT_TOLERANCE_SEC) {
        suppress();
        postYoutubeCommand(iframe, 'seekTo', [target, true]);
        localTime = target;
        lastTickAt = Date.now();
      }
      return;
    }
    if (isSuppressed() || !canControl) return;

    if (nextState === YT_PLAYING && !playing) {
      onLocalPlay(isLive ? 0 : localTime);
    } else if (
      nextState === YT_PAUSED &&
      playing &&
      (prevState === YT_PLAYING || prevState === YT_BUFFERING)
    ) {
      onLocalPause(isLive ? 0 : localTime);
    }
  }

  function onMessage(event: MessageEvent): void {
    if (iframe && event.source !== iframe.contentWindow) return;
    const msg = parseYoutubeMessage(event);
    if (msg === null) return;

    if (msg.kind === 'ready') {
      ready = true;
      clearInterval(listenTimer);
      applyRemoteState(!isLive);
      return;
    }

    if (msg.kind === 'state') {
      handleStateChange(msg.playerState);
      return;
    }

    if (msg.kind === 'info') {
      const adFromVideo = msg.videoId !== null && msg.videoId !== videoId;
      const adStartedOrActive = adFromVideo || msg.isAd === true;

      if (!ready) {
        ready = true;
        clearInterval(listenTimer);
        if (!adStartedOrActive) applyRemoteState(!isLive);
      }

      const now = Date.now();
      if (adStartedOrActive) {
        activeAd = true;
        return;
      }
      if (activeAd) {
        if ((msg.videoId !== null && msg.videoId === videoId) || msg.isAd === false) {
          activeAd = false;
          if (msg.currentTime !== null) localTime = msg.currentTime;
          lastTickAt = now;
          suppress();
          applyRemoteState(false);
        }
        return;
      }

      if (msg.duration !== null && msg.duration > 0) {
        liveDuration = msg.duration;
      }
      if (
        !detectedLive &&
        (msg.isLive === true ||
          (msg.playerState === YT_PLAYING &&
            msg.duration === 0 &&
            msg.currentTime !== null &&
            msg.currentTime > 0))
      ) {
        detectedLive = true;
        onLiveDetected?.();
      }

      if (msg.currentTime !== null) {
        const expectedDelta =
          playerState === YT_PLAYING && lastTickAt > 0 ? (now - lastTickAt) / 1000 : 0;
        const projectedLocal = localTime + expectedDelta;
        const movedFromLast = Math.abs(msg.currentTime - localTime);
        const movedFromProjected = Math.abs(msg.currentTime - projectedLocal);
        const jumped =
          lastTickAt > 0 &&
          movedFromProjected > LOCAL_SEEK_THRESHOLD_SEC &&
          movedFromLast > LOCAL_SEEK_THRESHOLD_SEC;
        localTime = msg.currentTime;
        lastTickAt = now;
        if (jumped && !isSuppressed() && canControl && !isLive && playerState !== YT_UNSTARTED) {
          onLocalSeek(msg.currentTime);
        }
      }
      if (msg.playerState !== null && msg.playerState !== playerState) {
        handleStateChange(msg.playerState);
      }
    }
  }

  function onIframeLoad(): void {
    if (!iframe) return;
    ready = false;
    const id = listenCounter++;
    postYoutubeListening(iframe, id);
    clearInterval(listenTimer);
    let attempts = 0;
    listenTimer = setInterval(() => {
      if (!iframe || ready || attempts >= LISTEN_MAX_ATTEMPTS) {
        clearInterval(listenTimer);
        return;
      }
      attempts += 1;
      postYoutubeListening(iframe, id);
    }, LISTEN_INTERVAL_MS);
  }

  function joinPlayback(): void {
    if (!iframe) return;
    autoplayBlocked = false;
    clearTimeout(autoplayTimer);
    suppress();
    if (isLive) {
      seekToLiveEdge();
    } else {
      postYoutubeCommand(iframe, 'seekTo', [targetPositionSec(), true]);
    }
    postYoutubeCommand(iframe, 'playVideo');
  }

  $effect(() => {
    const videoChanged = videoId !== lastVideoId;
    const epochChanged = syncEpoch !== lastSyncEpoch;
    const resyncChanged = syncVersion !== lastSyncVersion;
    lastVideoId = videoId;
    lastSyncEpoch = syncEpoch;
    lastSyncVersion = syncVersion;
    if (videoChanged) {
      activeAd = false;
      detectedLive = false;
      liveDuration = 0;
    }
    if (!ready && iframe && (videoChanged || epochChanged || resyncChanged)) {
      postYoutubeListening(iframe, listenCounter);
    }
    if (ready && (videoChanged || epochChanged || resyncChanged)) {
      applyRemoteState(resyncChanged);
    }
  });

  $effect(() => {
    if (!ready || isLive) return;
    const timer = setInterval(() => {
      if (!iframe || isSuppressed() || activeAd) return;
      if (!playing) {
        if (playerState === YT_PLAYING) {
          suppress();
          postYoutubeCommand(iframe, 'pauseVideo');
        }
        return;
      }
      if (autoplayBlocked) return;
      const target = targetPositionSec();
      const effectiveLocal =
        playerState === YT_PLAYING && lastTickAt > 0
          ? localTime + (Date.now() - lastTickAt) / 1000
          : localTime;
      if (playerState === YT_PLAYING && shouldCorrectDrift(effectiveLocal, target)) {
        suppress();
        postYoutubeCommand(iframe, 'seekTo', [target, true]);
        localTime = target;
        lastTickAt = Date.now();
      } else if (playerState === YT_PAUSED) {
        suppress();
        if (shouldCorrectDrift(localTime, target)) {
          postYoutubeCommand(iframe, 'seekTo', [target, true]);
          localTime = target;
          lastTickAt = Date.now();
        }
        postYoutubeCommand(iframe, 'playVideo');
        scheduleAutoplayCheck();
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(timer);
  });

  $effect(() => () => {
    clearTimeout(autoplayTimer);
    clearTimeout(focusReleaseTimer);
    clearInterval(listenTimer);
  });

  function onStageWheel(event: WheelEvent): void {
    if (!isShort || !shortsScrollMode || !canControl || loadingShort) return;
    if (Math.abs(event.deltaY) < 20) return;
    const now = Date.now();
    if (now - lastWheelAt < WHEEL_COOLDOWN_MS) return;
    event.preventDefault();
    lastWheelAt = now;
    if (event.deltaY > 0) onScrollNext?.();
    else if (canScrollPrev) onScrollPrev?.();
  }
</script>

<svelte:window
  onmessage={onMessage}
  onfocus={() => {
    if (playerState === YT_PLAYING && !hoveringPlayer) releaseIframeFocus();
  }}
/>

<div bind:this={playerWrap} class={['player-wrap', { contained }]} tabindex="-1">
  <div class={['player-stage', { short: isShort, contained }]} onwheel={onStageWheel}>
    <div
      class={['player-shell', { short: isShort, theater, maximized }]}
      role="presentation"
      style:height={isShort
        ? contained
          ? `min(${shortHeight}px, 100cqh)`
          : `${shortHeight}px`
        : null}
      onpointerenter={onPlayerPointerEnter}
      onpointerleave={onPlayerPointerLeave}
      onpointerdown={onPlayerPointerDown}
    >
      <iframe
        bind:this={iframe}
        class={['player-frame', { unhovered: playerState === YT_PLAYING && !hoveringPlayer }]}
        title={i18n.t('widgets.watchTogether')}
        src={initialSrc}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
        onload={onIframeLoad}
      ></iframe>
      {#if autoplayBlocked}
        <div class="autoplay-overlay">
          <Button variant="primary" onclick={joinPlayback}>
            <PlayIcon weight="fill" />
            {i18n.t('widgets.watchTogetherJoinPlayback')}
          </Button>
        </div>
      {/if}
    </div>
    {#if isShort && shortsScrollMode && canControl}
      <div class="shorts-rail">
        <IconButton
          variant="ghost"
          size="small"
          label={i18n.t('widgets.watchTogetherPrevShort')}
          disabled={!canScrollPrev || loadingShort}
          onclick={() => onScrollPrev?.()}
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          variant="ghost"
          size="small"
          label={i18n.t('widgets.watchTogetherNextShort')}
          disabled={loadingShort}
          onclick={() => onScrollNext?.()}
        >
          <ArrowDownIcon />
        </IconButton>
      </div>
    {/if}
  </div>
  {#if isShort}
    <div class="short-resize-bar">
      <ResizeHandle
        grow="down"
        value={shortHeight}
        min={MIN_SHORT_HEIGHT}
        max={MAX_SHORT_HEIGHT}
        step={SHORT_HEIGHT_STEP}
        label={i18n.t('widgets.watchTogetherResizeShort')}
        onResize={(next) => (shortHeight = clamp(Math.round(next), MIN_SHORT_HEIGHT, MAX_SHORT_HEIGHT))}
        onCommit={() => writeText(SHORT_HEIGHT_STORAGE_KEY, String(shortHeight))}
      />
      <span class="short-resize-grip" aria-hidden="true"></span>
    </div>
  {/if}
</div>

<style>
  .player-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-050);
    width: 100%;
  }

  .player-wrap.contained {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .player-wrap:focus {
    outline: none;
  }

  .player-stage {
    width: 100%;
  }

  .player-stage.contained {
    align-items: center;
    background: oklch(0% 0 0deg);
    border-radius: var(--radius-inner);
    container-type: size;
    display: flex;
    flex: 1;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
    width: 100%;
  }

  .player-stage.short {
    align-items: center;
    background: oklch(0% 0 0deg);
    border-radius: var(--radius-inner);
    box-sizing: border-box;
    display: flex;
    gap: var(--space-150);
    justify-content: center;
    overflow: hidden;
    padding-inline: var(--space-150);
    width: 100%;
  }

  .player-shell {
    aspect-ratio: 16 / 9;
    background: oklch(0% 0 0deg);
    border-radius: var(--radius-inner);
    overflow: hidden;
    position: relative;
    width: 100%;
  }

  .player-stage.contained .player-shell:not(.short) {
    aspect-ratio: 16 / 9;
    height: min(100cqh, calc(100cqw * 9 / 16));
    width: min(100cqw, calc(100cqh * 16 / 9));
  }

  .player-shell.short {
    aspect-ratio: 9 / 16;
    max-height: 75vh;
    max-width: 100%;
    width: auto;
  }

  .player-shell.short.theater,
  .player-shell.short.maximized {
    max-height: 78vh;
  }

  .player-stage.contained .player-shell.short {
    max-height: 100cqh;
  }

  .shorts-rail {
    background: var(--surface-container);
    border-radius: var(--radius-pill);
    display: flex;
    flex-direction: column;
    gap: var(--space-050);
    padding: var(--space-050);
  }

  .short-resize-bar {
    align-items: center;
    display: flex;
    height: 0.75rem;
    justify-content: center;
    position: relative;
    width: 100%;
  }

  .short-resize-grip {
    background: var(--surface-container-line, var(--surface-container-active));
    border-radius: var(--radius-pill);
    height: 0.25rem;
    pointer-events: none;
    width: 2.5rem;
  }

  .player-frame {
    border: 0;
    display: block;
    height: 100%;
    width: 100%;
  }

  .player-frame.unhovered {
    pointer-events: none;
  }

  .autoplay-overlay {
    align-items: center;
    background: oklch(0% 0 0deg / 55%);
    display: flex;
    inset: 0;
    justify-content: center;
    position: absolute;
  }
</style>
