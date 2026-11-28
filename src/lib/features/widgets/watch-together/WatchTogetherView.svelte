<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
  import ArrowsInSimpleIcon from 'phosphor-svelte/lib/ArrowsInSimpleIcon';
  import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';
  import ArrowsVerticalIcon from 'phosphor-svelte/lib/ArrowsVerticalIcon';
  import CornersInIcon from 'phosphor-svelte/lib/CornersInIcon';
  import CornersOutIcon from 'phosphor-svelte/lib/CornersOutIcon';
  import ListBulletsIcon from 'phosphor-svelte/lib/ListBulletsIcon';
  import LockSimpleIcon from 'phosphor-svelte/lib/LockSimpleIcon';
  import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpenIcon';
  import PauseIcon from 'phosphor-svelte/lib/PauseIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
  import SkipForwardIcon from 'phosphor-svelte/lib/SkipForwardIcon';
  import TelevisionSimpleIcon from 'phosphor-svelte/lib/TelevisionSimpleIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  import type { MemberView } from '#src/generated/protocol';
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import { readText, writeText } from '#lib/platform/local-json.js';
  import Alert from '#lib/ui/primitives/Alert.svelte';
  import Button from '#lib/ui/primitives/Button.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';

  import { WatchTogetherSession } from './watch-together-session.svelte.js';
  import WatchTogetherQueue from './WatchTogetherQueue.svelte';
  import YoutubeSyncPlayer from './YoutubeSyncPlayer.svelte';

  interface Props {
    roomId: string;
    session?: WatchTogetherSession;
    canManage?: boolean;
    members?: readonly MemberView[];
    theater?: boolean;
    maximized?: boolean;
    pendingUrl?: string | null;
    onConsumePendingUrl?: () => void;
    onToggleTheater?: () => void;
    onToggleMaximize?: () => void;
    onCloseTheater?: () => void;
    onEnsureRoomWidget?: (fallbackUrl: string) => Promise<void>;
  }

  let {
    roomId,
    session: providedSession,
    canManage = false,
    members = [],
    theater = false,
    maximized = false,
    pendingUrl = null,
    onConsumePendingUrl,
    onToggleTheater,
    onToggleMaximize,
    onCloseTheater,
    onEnsureRoomWidget,
  }: Props = $props();

  const SHORTS_SCROLL_KEY = 'sable-watch-together-shorts-scroll';
  const core = useCoreClient();
  let syncVersion = $state(0);
  let detectedLiveVideoId = $state<string | null>(null);
  let shortsScrollMode = $state(readText(SHORTS_SCROLL_KEY) === '1');
  let urlError = $state<string | null>(null);
  let player = $state<YoutubeSyncPlayer>();
  let queueUserOverride = $state<boolean | null>(null);
  let lastModeKey = '';

  let moderatorIds = $derived.by(() => {
    const ids = new SvelteSet<string>();
    for (const member of members) {
      if (member.power_level >= 50) ids.add(member.user_id);
    }
    if (canManage && core.session?.user_id) ids.add(core.session.user_id);
    return ids;
  });

  const initialSession = untrack(() => providedSession);
  const fallbackSession =
    initialSession ??
    new WatchTogetherSession({
      core,
      get roomId() {
        return roomId;
      },
      get userId() {
        return core.session?.user_id ?? '';
      },
      isModerator: () => canManage || moderatorIds.has(core.session?.user_id ?? ''),
      moderatorIds: () => moderatorIds,
      onEnsureRoomWidget: (...args) => onEnsureRoomWidget?.(...args) ?? Promise.resolve(),
    });
  const ownedSession = initialSession ? null : fallbackSession;
  const session = $derived(providedSession ?? fallbackSession);

  let isCurrentLive = $derived(
    session.state.current?.kind === 'live' ||
      (session.state.current !== null && detectedLiveVideoId === session.state.current.videoId)
  );
  let isCurrentShort = $derived(!isCurrentLive && session.state.current?.kind === 'short');
  let showQueue = $derived(
    !theater && !maximized
      ? true
      : queueUserOverride !== null
        ? queueUserOverride
        : session.state.current === null || (theater && session.state.queue.length > 0)
  );

  function memberName(userId: string): string {
    return members.find((member) => member.user_id === userId)?.display_name ?? userId;
  }

  async function addUrl(url: string): Promise<boolean> {
    urlError = null;
    const result = await session.enqueueUrl(url);
    if (result === 'invalid') {
      urlError = i18n.t('widgets.watchTogetherInvalidUrl');
      return false;
    }
    return result === 'ok';
  }

  function togglePlayPause(): void {
    const pos = player?.currentPosition() ?? session.expectedPosition();
    if (session.state.playing) void session.pause(pos);
    else void session.play(pos);
  }

  function resync(): void {
    void session.refresh();
    syncVersion += 1;
  }

  function toggleShortsScroll(): void {
    shortsScrollMode = !shortsScrollMode;
    writeText(SHORTS_SCROLL_KEY, shortsScrollMode ? '1' : '0');
  }

  $effect(() => {
    const _room = roomId;
    if (!ownedSession || !_room) return;
    return ownedSession.start();
  });

  $effect(() => {
    const modeKey = `${theater}:${maximized}`;
    if (modeKey !== lastModeKey) {
      lastModeKey = modeKey;
      queueUserOverride = null;
    }
  });

  $effect(() => {
    if (!pendingUrl || session.loading) return;
    const url = pendingUrl;
    onConsumePendingUrl?.();
    void addUrl(url);
  });
</script>

<div class={['watch-together', { theater, maximized }]}>
  <div class="status-bar">
    <div class="status-meta">
      <span class={['badge', { playing: session.state.playing, locked: session.state.locked }]}>
        {#if session.state.locked}
          {i18n.t('widgets.watchTogetherLocked')}
        {:else if session.state.playing}
          {i18n.t('widgets.watchTogetherSynced')}
        {:else}
          {i18n.t('widgets.watchTogetherPaused')}
        {/if}
      </span>
      {#if isCurrentLive}
        <span class="badge live">{i18n.t('widgets.watchTogetherLive')}</span>
      {:else if isCurrentShort}
        <span class="badge short">{i18n.t('widgets.watchTogetherShort')}</span>
      {/if}
      {#if session.state.lastActor}
        <span class="actor">
          {i18n.t('widgets.watchTogetherLastAction', {
            user: memberName(session.state.lastActor),
          })}
        </span>
      {/if}
    </div>
    <div class="status-actions">
      {#if session.state.current}
        <IconButton
          variant="ghost"
          size="small"
          label={isCurrentLive
            ? i18n.t('widgets.watchTogetherJumpToLive')
            : i18n.t('widgets.watchTogetherResync')}
          onclick={resync}
        >
          <ArrowsClockwiseIcon />
        </IconButton>
      {/if}
      {#if session.canToggleLock}
        <IconButton
          variant="ghost"
          size="small"
          label={session.state.locked
            ? i18n.t('widgets.watchTogetherUnlock')
            : i18n.t('widgets.watchTogetherLock')}
          aria-pressed={session.state.locked}
          onclick={() => void session.setLocked(!session.state.locked)}
        >
          {#if session.state.locked}
            <LockSimpleIcon weight="fill" />
          {:else}
            <LockSimpleOpenIcon />
          {/if}
        </IconButton>
      {/if}
      {#if theater || maximized}
        <IconButton
          variant="ghost"
          size="small"
          label={i18n.t('widgets.watchTogetherToggleQueue')}
          aria-pressed={showQueue}
          onclick={() => {
            queueUserOverride = !showQueue;
          }}
        >
          <ListBulletsIcon weight={showQueue ? 'fill' : 'regular'} />
        </IconButton>
      {/if}
      {#if onToggleTheater}
        <IconButton
          variant="ghost"
          size="small"
          label={theater || maximized
            ? i18n.t('widgets.watchTogetherDock')
            : i18n.t('widgets.watchTogetherTheater')}
          aria-pressed={theater}
          onclick={onToggleTheater}
        >
          {#if theater || maximized}
            <ArrowsInSimpleIcon />
          {:else}
            <ArrowsOutSimpleIcon />
          {/if}
        </IconButton>
      {/if}
      {#if onToggleMaximize}
        <IconButton
          variant="ghost"
          size="small"
          label={maximized
            ? i18n.t('widgets.watchTogetherRestore')
            : i18n.t('widgets.watchTogetherMaximize')}
          aria-pressed={maximized}
          onclick={onToggleMaximize}
        >
          {#if maximized}
            <CornersInIcon />
          {:else}
            <CornersOutIcon />
          {/if}
        </IconButton>
      {/if}
      {#if (theater || maximized) && onCloseTheater}
        <IconButton
          variant="ghost"
          size="small"
          label={i18n.t('widgets.watchTogetherClose')}
          onclick={onCloseTheater}
        >
          <XIcon />
        </IconButton>
      {/if}
    </div>
  </div>

  {#if session.error}
    <Alert variant="critical">{i18n.t('errors.actionFailed')}</Alert>
  {/if}

  {#if session.loading}
    <div class="loading-box">
      <Spinner label={i18n.t('widgets.watchTogether')} />
    </div>
  {:else}
    <div class={['layout', { 'with-queue': showQueue }]}>
      <div class="stage-col">
        {#if session.state.current}
          {@const current = session.state.current}
          <YoutubeSyncPlayer
            bind:this={player}
            videoId={current.videoId}
            kind={current.kind ?? 'video'}
            playing={session.state.playing}
            targetPositionSec={() => session.expectedPosition()}
            syncEpoch={session.syncEpoch}
            {syncVersion}
            {theater}
            {maximized}
            canControl={session.canControl}
            shortsScrollMode={isCurrentShort && shortsScrollMode}
            canScrollPrev={session.canScrollPrevShort}
            loadingShort={session.loadingShort}
            onLocalPlay={(pos) => void session.play(pos, 'player')}
            onLocalPause={(pos) => void session.pause(pos, 'player')}
            onLocalSeek={(pos) => void session.seek(pos, 'player')}
            onEnded={() =>
              void session.handleEnded({ loopShort: isCurrentShort && shortsScrollMode })}
            onLiveDetected={() => {
              detectedLiveVideoId = current.videoId;
            }}
            onScrollPrev={() => void session.scrollPrevShort()}
            onScrollNext={() => void session.scrollNextShort()}
          />
          <div class="now-playing">
            <div class="now-meta">
              <span class="now-label">{i18n.t('widgets.watchTogetherNowPlaying')}</span>
              <strong class="now-title">{current.title}</strong>
              {#if current.author}
                <span class="now-author">{current.author}</span>
              {/if}
            </div>
            {#if session.canControl}
              <div class="playback-controls">
                {#if isCurrentShort}
                  <Button
                    variant={shortsScrollMode ? 'primary' : 'secondary'}
                    size="small"
                    aria-pressed={shortsScrollMode}
                    onclick={toggleShortsScroll}
                  >
                    <ArrowsVerticalIcon />
                    {i18n.t('widgets.watchTogetherShortsScroll')}
                  </Button>
                {/if}
                <Button variant="secondary" size="small" onclick={togglePlayPause}>
                  {#if session.state.playing}
                    <PauseIcon weight="fill" />
                    {i18n.t('widgets.watchTogetherPause')}
                  {:else}
                    <PlayIcon weight="fill" />
                    {i18n.t('widgets.watchTogetherPlay')}
                  {/if}
                </Button>
                <IconButton
                  variant="ghost"
                  size="small"
                  label={i18n.t('widgets.watchTogetherSkip')}
                  onclick={() => void session.skipNext()}
                >
                  <SkipForwardIcon weight="fill" />
                </IconButton>
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty-stage">
            <TelevisionSimpleIcon size={32} />
            <strong>{i18n.t('widgets.watchTogether')}</strong>
            <p>{i18n.t('widgets.watchTogetherEmpty')}</p>
          </div>
        {/if}
      </div>

      {#if showQueue}
        <WatchTogetherQueue
          queue={session.state.queue}
          canControl={session.canControl}
          adding={session.adding}
          {urlError}
          {memberName}
          onAddUrl={addUrl}
          onPlayItem={(id) => void session.playItem(id)}
          onMoveItem={(id, delta) => void session.moveItem(id, delta)}
          onRemoveItem={(id) => void session.removeItem(id)}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .watch-together {
    box-sizing: border-box;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-250);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: var(--space-300);
  }

  .watch-together.maximized {
    background: var(--bg-container);
  }

  .status-bar {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: var(--space-150);
    justify-content: space-between;
  }

  .status-meta {
    align-items: center;
    display: flex;
    gap: var(--space-150);
    min-width: 0;
  }

  .badge {
    background: var(--surface-container-active);
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    padding: var(--space-050) var(--space-150);
  }

  .badge.playing {
    background: var(--primary-container, var(--primary-main));
    color: var(--primary-on-container, var(--primary-on-main));
  }

  .badge.live {
    background: var(--crit-container);
    color: var(--crit-on-container);
  }

  .actor {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-actions {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-050);
  }

  .loading-box {
    align-items: center;
    display: flex;
    flex: 1;
    justify-content: center;
  }

  .layout {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-250);
    min-height: 0;
    overflow: hidden;
  }

  .stage-col {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-200);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .watch-together.theater .layout.with-queue .stage-col,
  .watch-together.maximized .layout.with-queue .stage-col {
    flex: 1 1 60%;
    min-height: 10rem;
  }

  @container (min-width: 44rem) {
    .watch-together.theater .layout.with-queue,
    .watch-together.maximized .layout.with-queue {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
      grid-template-rows: minmax(0, 1fr);
    }

    .watch-together.theater .layout.with-queue .stage-col,
    .watch-together.maximized .layout.with-queue .stage-col {
      min-height: 0;
    }
  }

  .now-playing {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: var(--space-200);
    justify-content: space-between;
  }

  .now-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .now-label,
  .now-author {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
  }

  .now-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .playback-controls {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: var(--space-100);
  }

  .empty-stage {
    align-items: center;
    background: var(--surface-container);
    border: var(--border-width) solid var(--surface-container-line);
    border-radius: var(--radius-inner);
    color: var(--surface-var-on-container);
    display: flex;
    flex-direction: column;
    gap: var(--space-100);
    justify-content: center;
    padding: var(--space-500) var(--space-300);
    text-align: center;
  }

  .empty-stage p {
    margin: 0;
    max-width: 24rem;
  }
</style>
