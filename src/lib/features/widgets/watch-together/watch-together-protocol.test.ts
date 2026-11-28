import { expect, test } from 'vitest';

import {
  canUserControl,
  canUserToggleLock,
  expectedPositionSec,
  parseWatchTogetherEvent,
  reduceWatchTogetherEvents,
  shouldCorrectDrift,
  type WatchTogetherEvent,
  type WatchTogetherItem,
} from './watch-together-protocol.js';

const item = (id: string, videoId = 'dQw4w9WgXcQ'): WatchTogetherItem => ({
  id,
  source: 'youtube',
  videoId,
  title: `Video ${id}`,
  author: 'Channel',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  addedBy: '@alice:example.org',
});

function rawEvent(
  eventId: string,
  sender: string,
  originServerTs: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    event_id: eventId,
    sender,
    origin_server_ts: originServerTs,
    content: {
      v: 1,
      sessionId: 'sess-1',
      hostUserId: '@alice:example.org',
      locked: false,
      playing: true,
      positionSec: 12,
      sentAtMs: originServerTs,
      current: item('1'),
      queue: [],
      action: 'play',
      ...overrides,
    },
  };
}

function mustParse(raw: unknown): WatchTogetherEvent {
  const parsed = parseWatchTogetherEvent(raw);
  if (parsed === null) throw new Error('expected valid event');
  return parsed;
}

test('parses valid snapshots and rejects malformed events', () => {
  expect(parseWatchTogetherEvent(null)).toBeNull();
  expect(parseWatchTogetherEvent({ event_id: '$1', sender: '@a:b', origin_server_ts: 1, content: { v: 2 } })).toBeNull();

  const parsed = parseWatchTogetherEvent(rawEvent('$1', '@alice:example.org', 1000, { positionSec: -5 }));
  expect(parsed).not.toBeNull();
  expect(parsed?.snapshot.positionSec).toBe(0);
  expect(parsed?.snapshot.current?.videoId).toBe('dQw4w9WgXcQ');
});

test('replays snapshots chronologically and enforces host/mod lock', () => {
  const events: WatchTogetherEvent[] = [
    mustParse(rawEvent('$3', '@bob:example.org', 3000, { playing: false, action: 'pause' })),
    mustParse(rawEvent('$1', '@alice:example.org', 1000, { playing: true, action: 'load' })),
    mustParse(
      rawEvent('$2', '@alice:example.org', 2000, { locked: true, playing: true, action: 'lock' })
    ),
    mustParse(
      rawEvent('$4', '@mod:example.org', 4000, {
        locked: false,
        playing: false,
        positionSec: 45,
        action: 'pause',
      })
    ),
    mustParse(
      rawEvent('$5', '@bob:example.org', 5000, { playing: true, positionSec: 46, action: 'play' })
    ),
  ];

  const state = reduceWatchTogetherEvents(events, new Set(['@mod:example.org']));
  expect(state.lastEventId).toBe('$5');
  expect(state.lastActor).toBe('@bob:example.org');
  expect(state.playing).toBe(true);
  expect(state.locked).toBe(false);
  expect(state.hostUserId).toBe('@alice:example.org');

  // While locked, non-host/non-mod event ($3 at 3000ms) was ignored; verify lock-only state:
  const lockedState = reduceWatchTogetherEvents(events.slice(1, 3), new Set(['@mod:example.org']));
  expect(lockedState.locked).toBe(true);
  expect(
    reduceWatchTogetherEvents([events[1], events[2], events[0]], new Set(['@mod:example.org'])).lastEventId
  ).toBe('$2');
});

test('enforces control and lock-toggle permissions', () => {
  const locked = { locked: true, hostUserId: '@alice:example.org' };
  expect(canUserControl(locked, '@alice:example.org', false)).toBe(true);
  expect(canUserControl(locked, '@mod:example.org', true)).toBe(true);
  expect(canUserControl(locked, '@bob:example.org', false)).toBe(false);

  expect(canUserToggleLock(locked, '@bob:example.org', false)).toBe(false);
  expect(canUserToggleLock(locked, '@mod:example.org', true)).toBe(true);
});

test('projects expected playback position and drift threshold', () => {
  expect(
    expectedPositionSec({ playing: true, positionSec: 30, sentAtMs: 10_000 }, 15_500)
  ).toBe(35.5);
  expect(
    expectedPositionSec({ playing: false, positionSec: 30, sentAtMs: 10_000 }, 15_500)
  ).toBe(30);
  expect(shouldCorrectDrift(10, 12)).toBe(false);
  expect(shouldCorrectDrift(10, 13)).toBe(true);
});

test('parses integer positionMs and prefers it over integer positionSec in reducer', () => {
  const parsed = mustParse(
    rawEvent('$ms-1', '@alice:example.org', 2000, {
      positionSec: 5,
      positionMs: 5432.4,
      action: 'pause',
      playing: false,
    })
  );
  expect(parsed.snapshot.positionMs).toBe(5432);

  const state = reduceWatchTogetherEvents([parsed]);
  expect(state.positionSec).toBe(5.432);
  expect(expectedPositionSec(state, 99_000)).toBe(5.432);
});

test('preserves live and short item kinds in parsed and reduced state', () => {
  const liveEvent = mustParse(
    rawEvent('$live-1', '@alice:example.org', 3000, {
      positionSec: 0,
      current: { ...item('l1'), kind: 'live' },
      queue: [{ ...item('s1', 'jNQXAC9IVRw'), kind: 'short' }],
      action: 'load',
    })
  );

  expect(liveEvent.snapshot.current?.kind).toBe('live');
  expect(liveEvent.snapshot.queue[0]?.kind).toBe('short');

  const state = reduceWatchTogetherEvents([liveEvent]);
  expect(state.current?.kind).toBe('live');
  expect(state.queue[0]?.kind).toBe('short');
});

test('uses authoritative originServerTs for ordering and projection over skewed client sentAtMs', () => {
  const earlier = mustParse(
    rawEvent('$first', '@alice:example.org', 10_000, {
      sentAtMs: 99_999,
      positionSec: 10,
      action: 'play',
    })
  );
  const later = mustParse(
    rawEvent('$second', '@bob:example.org', 15_000, {
      sentAtMs: 5_000,
      positionSec: 25,
      action: 'seek',
    })
  );

  const state = reduceWatchTogetherEvents([later, earlier]);
  expect(state.lastEventId).toBe('$second');
  expect(state.sentAtMs).toBe(15_000);
  expect(expectedPositionSec(state, 20_000)).toBe(30);
});
