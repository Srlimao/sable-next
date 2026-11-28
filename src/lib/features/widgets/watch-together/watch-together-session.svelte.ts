import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { isRecord } from '#lib/guards.js';
import { electronBridge } from '#lib/platform/electron.js';
import type { YoutubeShortsSequenceResult } from '#lib/platform/youtube-shorts-types.js';

import { acquireWidgetFeed } from '../widget-feed.js';
import {
  canUserControl,
  canUserToggleLock,
  emptyWatchTogetherState,
  expectedPositionSec,
  parseWatchTogetherEvent,
  reduceWatchTogetherEvents,
  WATCH_TOGETHER_EVENT_TYPE,
  WATCH_TOGETHER_WIDGET_ID,
  WATCH_TOGETHER_WIDGET_TYPE,
  type WatchTogetherAction,
  type WatchTogetherEvent,
  type WatchTogetherItem,
  type WatchTogetherSnapshot,
  type WatchTogetherState,
} from './watch-together-protocol.js';
import type { RoomWidget } from '../widget-content.js';
import { parseYoutubeInput, resolveYoutubeItem, youtubeWatchUrl } from './youtube-source.js';

export async function ensureWatchTogetherRoomWidget(options: {
  core: Pick<CoreClient, 'rpc' | 'session'>;
  roomId: string;
  canManage: boolean;
  widgets: readonly RoomWidget[];
  title: string;
  fallbackUrl: string;
  refreshWidgets: () => Promise<void>;
}): Promise<void> {
  if (!options.canManage) return;
  if (options.widgets.some((widget) => widget.type === WATCH_TOGETHER_WIDGET_TYPE)) return;
  try {
    await options.core.rpc.room_state.sendEvent({
      room_id: options.roomId,
      event_type: 'im.vector.modular.widgets',
      state_key: WATCH_TOGETHER_WIDGET_ID,
      content: {
        type: WATCH_TOGETHER_WIDGET_TYPE,
        url: options.fallbackUrl,
        name: options.title,
        id: WATCH_TOGETHER_WIDGET_ID,
        creatorUserId: options.core.session?.user_id ?? '',
      },
    });
    await options.refreshWidgets();
  } catch (cause) {
    console.warn('[sable watch-together] failed to pin room widget', cause);
  }
}

export interface WatchTogetherSessionOptions {
  core: Pick<CoreClient, 'rpc' | 'subscribeEvents'>;
  roomId: string;
  userId: string;
  isModerator: () => boolean;
  moderatorIds: () => ReadonlySet<string>;
  acquireFeed?: boolean;
  onEnsureRoomWidget?: (fallbackUrl: string) => Promise<void>;
  fetchShortsSequence?: (
    videoId: string,
    continuation?: string | null
  ) => Promise<YoutubeShortsSequenceResult>;
}

export class WatchTogetherSession {
  state = $state.raw<WatchTogetherState>(emptyWatchTogetherState());
  syncEpoch = $state(0);
  loading = $state(true);
  adding = $state(false);
  loadingShort = $state(false);
  error = $state<string | null>(null);

  readonly #opts: WatchTogetherSessionOptions;
  readonly #events = new SvelteMap<string, WatchTogetherEvent>();
  readonly #optimisticIds = new SvelteSet<string>();
  readonly #ownSentIds = new SvelteSet<string>();
  readonly #ownSentTimestamps = new SvelteSet<number>();
  #shortsHistory = $state.raw<WatchTogetherItem[]>([]);
  #shortsBuffer: string[] = [];
  #shortsContinuation: string | null = null;
  #shortsSeedId: string | null = null;
  readonly #seenShortIds = new SvelteSet<string>();
  #publishSeq = 0;
  #serverClockOffsetMs = 0;
  #hasServerClockOffset = false;
  #activeRoomId: string | null = null;

  constructor(opts: WatchTogetherSessionOptions) {
    this.#opts = opts;
  }

  get active(): boolean {
    return this.state.current !== null;
  }

  get canControl(): boolean {
    return canUserControl(this.state, this.#opts.userId, this.#opts.isModerator());
  }

  get canToggleLock(): boolean {
    return canUserToggleLock(this.state, this.#opts.userId, this.#opts.isModerator());
  }

  get canScrollPrevShort(): boolean {
    return this.#shortsHistory.length > 0;
  }

  expectedPosition(nowMs = Date.now()): number {
    const useServerClock =
      this.state.lastEventId !== null &&
      !this.#optimisticIds.has(this.state.lastEventId) &&
      this.#hasServerClockOffset;
    return expectedPositionSec(
      this.state,
      useServerClock ? nowMs - this.#serverClockOffsetMs : nowMs
    );
  }

  #calibrateServerClock(originServerTs: number, trustLargeSkew: boolean): void {
    if (!Number.isFinite(originServerTs) || originServerTs <= 0) return;
    const sample = Date.now() - originServerTs;
    const maxSample = trustLargeSkew ? 86_400_000 : 60_000;
    if (Math.abs(sample) >= maxSample) return;
    if (!this.#hasServerClockOffset) {
      this.#serverClockOffsetMs = sample;
      this.#hasServerClockOffset = true;
      return;
    }
    if (Math.abs(sample - this.#serverClockOffsetMs) < 30_000) {
      this.#serverClockOffsetMs = Math.round(this.#serverClockOffsetMs * 0.7 + sample * 0.3);
    }
  }

  #resetForRoom(roomId: string): void {
    this.#activeRoomId = roomId;
    this.#events.clear();
    this.#optimisticIds.clear();
    this.#ownSentIds.clear();
    this.#ownSentTimestamps.clear();
    this.#shortsHistory = [];
    this.#shortsBuffer = [];
    this.#shortsContinuation = null;
    this.#shortsSeedId = null;
    this.#seenShortIds.clear();
    this.#publishSeq = 0;
    this.#serverClockOffsetMs = 0;
    this.#hasServerClockOffset = false;
    this.state = emptyWatchTogetherState();
    this.loading = true;
    this.adding = false;
    this.loadingShort = false;
    this.error = null;
  }

  #mergeEvents(rawEvents: readonly unknown[]): void {
    let changed = false;
    let bumpEpoch = false;
    const prevEventId = this.state.lastEventId;
    for (const raw of rawEvents) {
      const parsed = parseWatchTogetherEvent(raw);
      if (parsed === null) continue;
      if (this.#optimisticIds.has(parsed.eventId)) {
        this.#optimisticIds.delete(parsed.eventId);
        this.#events.set(parsed.eventId, parsed);
        this.#calibrateServerClock(parsed.originServerTs, true);
        changed = true;
      } else if (!this.#events.has(parsed.eventId)) {
        this.#events.set(parsed.eventId, parsed);
        changed = true;
        bumpEpoch = true;
      }
    }
    if (!changed) return;
    const nextState = reduceWatchTogetherEvents(
      [...this.#events.values()],
      this.#opts.moderatorIds()
    );
    this.state = nextState;
    if (bumpEpoch || nextState.lastEventId !== prevEventId) {
      this.syncEpoch += 1;
    }
  }

  async refresh(): Promise<void> {
    const roomId = this.#opts.roomId;
    if (!roomId) return;
    try {
      const rawEvents = await this.#opts.core.rpc.timeline.events({
        room_id: roomId,
        event_type: WATCH_TOGETHER_EVENT_TYPE,
        msgtype: null,
        state_key: null,
        limit: 100,
        since: null,
      });
      if (this.#activeRoomId !== roomId) return;
      this.#mergeEvents(rawEvents);
    } catch (cause: unknown) {
      console.warn('[sable watch-together] failed to refresh history', cause);
    }
  }

  start(options: { acquireFeed?: boolean } = {}): () => void {
    const roomId = this.#opts.roomId;
    this.#resetForRoom(roomId);
    let active = true;
    const shouldAcquireFeed = options.acquireFeed ?? this.#opts.acquireFeed ?? true;
    const releaseFeed = shouldAcquireFeed ? acquireWidgetFeed(this.#opts.core as CoreClient) : null;

    const unsubscribe = this.#opts.core.subscribeEvents((event) => {
      if (!active || event.type !== 'widget_room_event') return;
      if (!isRecord(event.event)) return;
      if (event.event.room_id !== roomId) return;
      if (event.event.type !== WATCH_TOGETHER_EVENT_TYPE) return;

      const parsed = parseWatchTogetherEvent(event.event);
      if (parsed === null) return;
      const wasOptimistic = this.#optimisticIds.delete(parsed.eventId);
      if (this.#events.has(parsed.eventId) && !wasOptimistic) return;
      this.#events.set(parsed.eventId, parsed);

      const isOwn =
        wasOptimistic ||
        this.#ownSentIds.has(parsed.eventId) ||
        (parsed.sender === this.#opts.userId &&
          this.#ownSentTimestamps.has(parsed.snapshot.sentAtMs));
      if (isOwn) {
        this.#calibrateServerClock(parsed.originServerTs, true);
        const prevEventId = this.state.lastEventId;
        const nextState = reduceWatchTogetherEvents(
          [...this.#events.values()],
          this.#opts.moderatorIds()
        );
        this.state = nextState;
        if (nextState.lastEventId !== prevEventId && nextState.lastEventId !== parsed.eventId) {
          this.syncEpoch += 1;
        }
        return;
      }

      this.#calibrateServerClock(parsed.originServerTs, false);
      this.#recompute();
    });

    void this.#opts.core.rpc.timeline
      .events({
        room_id: roomId,
        event_type: WATCH_TOGETHER_EVENT_TYPE,
        msgtype: null,
        state_key: null,
        limit: 100,
        since: null,
      })
      .then((rawEvents) => {
        if (!active || this.#activeRoomId !== roomId) return;
        this.#mergeEvents(rawEvents);
      })
      .catch((cause: unknown) => {
        console.warn('[sable watch-together] failed to load history', cause);
      })
      .finally(() => {
        if (active) this.loading = false;
      });

    return () => {
      active = false;
      unsubscribe();
      releaseFeed?.();
    };
  }

  #recompute(): void {
    this.state = reduceWatchTogetherEvents([...this.#events.values()], this.#opts.moderatorIds());
    this.syncEpoch += 1;
  }

  async #publish(
    action: WatchTogetherAction,
    patch: Partial<
      Pick<WatchTogetherState, 'locked' | 'playing' | 'positionSec' | 'current' | 'queue'>
    >,
    origin: 'ui' | 'player' = 'ui'
  ): Promise<boolean> {
    let now = Math.trunc(Date.now());
    while (this.#ownSentTimestamps.has(now)) now += 1;
    this.#ownSentTimestamps.add(now);

    const sessionId = this.state.sessionId || crypto.randomUUID();
    const hostUserId = this.state.hostUserId ?? this.#opts.userId;
    const rawCurrent = patch.current !== undefined ? patch.current : this.state.current;
    const rawQueue = patch.queue ?? this.state.queue;
    const clampedSec = Math.max(0, patch.positionSec ?? this.state.positionSec);
    const positionMs = Math.round(clampedSec * 1000);
    const positionSec = Math.round(clampedSec);

    const snapshot: WatchTogetherSnapshot = {
      v: 1,
      sessionId,
      hostUserId,
      locked: patch.locked ?? this.state.locked,
      playing: patch.playing ?? this.state.playing,
      positionSec,
      positionMs,
      sentAtMs: now,
      current: rawCurrent ? { ...rawCurrent } : null,
      queue: rawQueue.map((item) => ({ ...item })),
      action,
    };

    const seq = ++this.#publishSeq;
    const previous = this.state;
    this.error = null;
    this.state = {
      sessionId,
      hostUserId,
      locked: snapshot.locked,
      playing: snapshot.playing,
      positionSec: positionMs / 1000,
      sentAtMs: snapshot.sentAtMs,
      current: snapshot.current,
      queue: snapshot.queue,
      lastAction: action,
      lastActor: this.#opts.userId,
      lastEventId: previous.lastEventId,
    };
    if (origin === 'ui') this.syncEpoch += 1;

    try {
      const eventId = await this.#opts.core.rpc.messages.sendRawEvent({
        room_id: this.#opts.roomId,
        event_type: WATCH_TOGETHER_EVENT_TYPE,
        content: snapshot,
      });
      this.#ownSentIds.add(eventId);
      if (!this.#events.has(eventId)) {
        this.#optimisticIds.add(eventId);
        const localEvent: WatchTogetherEvent = {
          eventId,
          sender: this.#opts.userId,
          originServerTs: this.#hasServerClockOffset ? now - this.#serverClockOffsetMs : now,
          snapshot,
        };
        this.#events.set(eventId, localEvent);
      }
      if (seq === this.#publishSeq) {
        this.state = { ...this.state, lastEventId: eventId };
      }
      return true;
    } catch (cause) {
      console.warn('[sable watch-together] failed to send sync event', cause);
      this.error = 'send_failed';
      if (seq === this.#publishSeq) {
        this.state = previous;
        this.syncEpoch += 1;
      }
      return false;
    }
  }

  async enqueueUrl(rawUrl: string): Promise<'ok' | 'invalid' | 'failed'> {
    if (!this.canControl) return 'failed';
    const parsed = parseYoutubeInput(rawUrl);
    if (parsed === null) return 'invalid';

    this.adding = true;
    try {
      const item: WatchTogetherItem = await resolveYoutubeItem(parsed.id, this.#opts.userId, {
        kind: parsed.kind,
      });
      const loadingFirst = this.state.current === null;
      const sent = loadingFirst
        ? await this.#publish('load', {
            current: item,
            playing: true,
            positionSec: item.kind === 'live' ? 0 : (parsed.start ?? 0),
          })
        : await this.#publish('queue', {
            queue: [...this.state.queue, item],
            positionSec: this.expectedPosition(),
          });
      if (!sent) return 'failed';
      if (loadingFirst && item.kind === 'short') {
        this.#shortsBuffer = [];
        this.#shortsContinuation = null;
        this.#shortsSeedId = item.videoId;
        this.#seenShortIds.clear();
        this.#seenShortIds.add(item.videoId);
      }
      void this.#opts.onEnsureRoomWidget?.(youtubeWatchUrl(item.videoId, item.kind));
      return 'ok';
    } finally {
      this.adding = false;
    }
  }

  async play(positionSec: number, origin: 'ui' | 'player' = 'ui'): Promise<void> {
    if (!this.canControl || this.state.current === null) return;
    await this.#publish('play', { playing: true, positionSec }, origin);
  }

  async pause(positionSec: number, origin: 'ui' | 'player' = 'ui'): Promise<void> {
    if (!this.canControl || this.state.current === null) return;
    await this.#publish('pause', { playing: false, positionSec }, origin);
  }

  async seek(positionSec: number, origin: 'ui' | 'player' = 'ui'): Promise<void> {
    if (!this.canControl || this.state.current === null) return;
    await this.#publish('seek', { positionSec }, origin);
  }

  async playItem(itemId: string): Promise<void> {
    if (!this.canControl) return;
    const index = this.state.queue.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const nextItem = this.state.queue[index];
    const remaining = this.state.queue.filter((_, idx) => idx !== index);
    const updatedQueue = this.state.current ? [...remaining, this.state.current] : remaining;
    await this.#publish('load', {
      current: nextItem,
      queue: updatedQueue,
      playing: true,
      positionSec: 0,
    });
  }

  async handleEnded(options: { loopShort?: boolean } = {}): Promise<void> {
    if (!this.canControl || this.state.current === null) return;
    if (options.loopShort && this.state.current.kind === 'short') {
      await this.#publish('play', { playing: true, positionSec: 0 }, 'ui');
      return;
    }
    if (this.state.queue.length > 0) {
      await this.skipNext();
      return;
    }
    if (this.state.current.kind === 'short') {
      await this.#publish('pause', { playing: false, positionSec: 0 }, 'ui');
      return;
    }
    await this.skipNext();
  }

  async scrollNextShort(): Promise<boolean> {
    if (!this.canControl || this.loadingShort || this.state.current === null) return false;
    const current = this.state.current;

    if (this.state.queue.length > 0) {
      this.#shortsHistory = [...this.#shortsHistory.slice(-29), current];
      await this.skipNext();
      return true;
    }

    this.loadingShort = true;
    try {
      if (this.#shortsSeedId !== current.videoId && this.#shortsBuffer.length === 0) {
        this.#shortsSeedId = current.videoId;
        this.#shortsContinuation = null;
        this.#seenShortIds.add(current.videoId);
      }

      if (this.#shortsBuffer.length === 0) {
        const fetcher =
          this.#opts.fetchShortsSequence ??
          ((id: string, cont?: string | null) =>
            electronBridge()?.fetchYoutubeShortsSequence?.(id, cont) ??
            Promise.resolve({ videoIds: [], continuation: null }));
        const result = await fetcher(this.#shortsSeedId ?? current.videoId, this.#shortsContinuation);
        this.#shortsContinuation = result.continuation;
        for (const id of result.videoIds) {
          if (id !== current.videoId && !this.#seenShortIds.has(id)) {
            this.#shortsBuffer.push(id);
          }
        }
      }

      const nextId = this.#shortsBuffer.shift();
      if (!nextId) return false;

      this.#seenShortIds.add(nextId);
      const item = await resolveYoutubeItem(nextId, this.#opts.userId, { kind: 'short' });
      this.#shortsHistory = [...this.#shortsHistory.slice(-29), current];
      return await this.#publish('load', { current: item, playing: true, positionSec: 0 }, 'ui');
    } finally {
      this.loadingShort = false;
    }
  }

  async scrollPrevShort(): Promise<boolean> {
    if (!this.canControl || this.loadingShort || this.#shortsHistory.length === 0) return false;
    const prev = this.#shortsHistory.at(-1);
    if (!prev) return false;
    const current = this.state.current;
    this.#shortsHistory = this.#shortsHistory.slice(0, -1);
    if (current && current.kind === 'short') {
      this.#shortsBuffer.unshift(current.videoId);
    }
    return this.#publish('load', { current: prev, playing: true, positionSec: 0 }, 'ui');
  }

  async skipNext(): Promise<void> {
    if (!this.canControl) return;
    const [next, ...rest] = this.state.queue;
    if (this.state.queue.length > 0 && next) {
      await this.#publish('skip', {
        current: next,
        queue: rest,
        playing: true,
        positionSec: 0,
      });
    } else {
      await this.#publish('clear', {
        current: null,
        queue: [],
        playing: false,
        positionSec: 0,
      });
    }
  }

  async removeItem(itemId: string): Promise<void> {
    if (!this.canControl) return;
    const nextQueue = this.state.queue.filter((item) => item.id !== itemId);
    if (nextQueue.length === this.state.queue.length) return;
    await this.#publish('queue', {
      queue: nextQueue,
      positionSec: this.expectedPosition(),
    });
  }

  async moveItem(itemId: string, delta: -1 | 1): Promise<void> {
    if (!this.canControl) return;
    const index = this.state.queue.findIndex((item) => item.id === itemId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= this.state.queue.length) return;
    const nextQueue = [...this.state.queue];
    const [item] = nextQueue.splice(index, 1);
    nextQueue.splice(target, 0, item);
    await this.#publish('queue', {
      queue: nextQueue,
      positionSec: this.expectedPosition(),
    });
  }

  async setLocked(locked: boolean): Promise<void> {
    if (!this.canToggleLock) return;
    await this.#publish('lock', {
      locked,
      positionSec: this.expectedPosition(),
    });
  }
}
