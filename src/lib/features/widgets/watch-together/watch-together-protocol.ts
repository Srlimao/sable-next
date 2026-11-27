import { isRecord } from '#lib/guards.js';

export const WATCH_TOGETHER_WIDGET_TYPE = 'moe.sable.watch_together';
export const WATCH_TOGETHER_EVENT_TYPE = 'moe.sable.watch_together';
export const WATCH_TOGETHER_WIDGET_ID = 'sable-watch-together';
export const DRIFT_TOLERANCE_SEC = 2.5;

export type WatchTogetherSource = 'youtube';

export type WatchTogetherItemKind = 'video' | 'live' | 'short';

export type WatchTogetherAction =
  | 'play'
  | 'pause'
  | 'seek'
  | 'load'
  | 'queue'
  | 'skip'
  | 'lock'
  | 'clear';

export interface WatchTogetherItem {
  id: string;
  source: WatchTogetherSource;
  kind?: WatchTogetherItemKind;
  videoId: string;
  title: string;
  author: string | null;
  thumbnailUrl: string;
  addedBy: string;
}

export interface WatchTogetherSnapshot {
  v: 1;
  sessionId: string;
  hostUserId: string;
  locked: boolean;
  playing: boolean;
  positionSec: number;
  positionMs?: number;
  sentAtMs: number;
  current: WatchTogetherItem | null;
  queue: WatchTogetherItem[];
  action: WatchTogetherAction;
}

export interface WatchTogetherEvent {
  eventId: string;
  sender: string;
  originServerTs: number;
  snapshot: WatchTogetherSnapshot;
}

export interface WatchTogetherState {
  sessionId: string;
  hostUserId: string | null;
  locked: boolean;
  playing: boolean;
  positionSec: number;
  sentAtMs: number;
  current: WatchTogetherItem | null;
  queue: WatchTogetherItem[];
  lastAction: WatchTogetherAction | null;
  lastActor: string | null;
  lastEventId: string | null;
}

const VALID_ACTIONS = new Set<string>([
  'play',
  'pause',
  'seek',
  'load',
  'queue',
  'skip',
  'lock',
  'clear',
]);

export function emptyWatchTogetherState(): WatchTogetherState {
  return {
    sessionId: '',
    hostUserId: null,
    locked: false,
    playing: false,
    positionSec: 0,
    sentAtMs: 0,
    current: null,
    queue: [],
    lastAction: null,
    lastActor: null,
    lastEventId: null,
  };
}

function parseItem(value: unknown): WatchTogetherItem | null {
  if (!isRecord(value)) return null;
  const { id, source, kind, videoId, title, author, thumbnailUrl, addedBy } = value;
  if (
    typeof id !== 'string' ||
    id === '' ||
    source !== 'youtube' ||
    typeof videoId !== 'string' ||
    videoId === '' ||
    typeof title !== 'string' ||
    typeof thumbnailUrl !== 'string' ||
    typeof addedBy !== 'string'
  ) {
    return null;
  }
  const parsedKind: WatchTogetherItemKind | undefined =
    kind === 'video' || kind === 'live' || kind === 'short' ? kind : undefined;
  return {
    id,
    source,
    ...(parsedKind !== undefined ? { kind: parsedKind } : {}),
    videoId,
    title,
    author: typeof author === 'string' && author !== '' ? author : null,
    thumbnailUrl,
    addedBy,
  };
}

export function parseWatchTogetherEvent(raw: unknown): WatchTogetherEvent | null {
  if (!isRecord(raw)) return null;
  const { event_id: eventId, sender, origin_server_ts: originServerTs, content } = raw;
  if (
    typeof eventId !== 'string' ||
    eventId === '' ||
    typeof sender !== 'string' ||
    sender === '' ||
    typeof originServerTs !== 'number' ||
    !Number.isFinite(originServerTs) ||
    !isRecord(content)
  ) {
    return null;
  }

  const {
    v,
    sessionId,
    hostUserId,
    locked,
    playing,
    positionSec,
    positionMs,
    sentAtMs,
    current,
    queue,
    action,
  } = content;

  if (
    v !== 1 ||
    typeof sessionId !== 'string' ||
    sessionId === '' ||
    typeof hostUserId !== 'string' ||
    hostUserId === '' ||
    typeof locked !== 'boolean' ||
    typeof playing !== 'boolean' ||
    typeof positionSec !== 'number' ||
    !Number.isFinite(positionSec) ||
    typeof sentAtMs !== 'number' ||
    !Number.isFinite(sentAtMs) ||
    typeof action !== 'string' ||
    !VALID_ACTIONS.has(action) ||
    !Array.isArray(queue)
  ) {
    return null;
  }

  const parsedCurrent = current === null ? null : parseItem(current);
  if (current !== null && parsedCurrent === null) return null;

  const parsedQueue: WatchTogetherItem[] = [];
  for (const entry of queue) {
    const parsed = parseItem(entry);
    if (parsed !== null) parsedQueue.push(parsed);
  }

  const parsedPositionMs =
    typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0
      ? Math.round(positionMs)
      : undefined;

  return {
    eventId,
    sender,
    originServerTs,
    snapshot: {
      v: 1,
      sessionId,
      hostUserId,
      locked,
      playing,
      positionSec: Math.max(0, positionSec),
      ...(parsedPositionMs !== undefined ? { positionMs: parsedPositionMs } : {}),
      sentAtMs,
      current: parsedCurrent,
      queue: parsedQueue,
      action: action as WatchTogetherAction,
    },
  };
}

export function canUserControl(
  state: Pick<WatchTogetherState, 'locked' | 'hostUserId'>,
  userId: string,
  isModerator: boolean
): boolean {
  if (!state.locked || isModerator) return true;
  return state.hostUserId === null || state.hostUserId === userId;
}

export function canUserToggleLock(
  state: Pick<WatchTogetherState, 'hostUserId'>,
  userId: string,
  isModerator: boolean
): boolean {
  return isModerator || state.hostUserId === null || state.hostUserId === userId;
}

export function reduceWatchTogetherEvents(
  events: readonly WatchTogetherEvent[],
  moderatorIds: ReadonlySet<string> = new Set()
): WatchTogetherState {
  const ordered = [...events].sort((a, b) =>
    a.originServerTs !== b.originServerTs
      ? a.originServerTs - b.originServerTs
      : a.eventId.localeCompare(b.eventId)
  );

  let state = emptyWatchTogetherState();
  for (const event of ordered) {
    const { snapshot, sender, eventId } = event;
    const privileged =
      moderatorIds.has(sender) || state.hostUserId === null || state.hostUserId === sender;
    if (state.locked && !privileged) continue;

    const nextLocked = privileged ? snapshot.locked : state.locked;
    const hostUserId =
      state.hostUserId !== null && state.sessionId === snapshot.sessionId
        ? state.hostUserId
        : snapshot.hostUserId;

    state = {
      sessionId: snapshot.sessionId,
      hostUserId,
      locked: nextLocked,
      playing: snapshot.playing,
      positionSec: Math.max(
        0,
        snapshot.positionMs !== undefined ? snapshot.positionMs / 1000 : snapshot.positionSec
      ),
      sentAtMs: snapshot.sentAtMs,
      current: snapshot.current,
      queue: snapshot.queue,
      lastAction: snapshot.action,
      lastActor: sender,
      lastEventId: eventId,
    };
  }
  return state;
}

export function expectedPositionSec(
  state: Pick<WatchTogetherState, 'playing' | 'positionSec' | 'sentAtMs'>,
  nowMs = Date.now()
): number {
  const base = Math.max(0, state.positionSec);
  if (!state.playing || state.sentAtMs <= 0) return base;
  return base + Math.max(0, (nowMs - state.sentAtMs) / 1000);
}

export function shouldCorrectDrift(localSec: number, targetSec: number): boolean {
  return Math.abs(localSec - targetSec) > DRIFT_TOLERANCE_SEC;
}
