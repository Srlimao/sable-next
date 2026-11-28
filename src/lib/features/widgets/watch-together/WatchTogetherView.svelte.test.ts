// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';

vi.mock('#lib/core/context.js');
vi.mock('#lib/features/room/media/embeds/youtube.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/features/room/media/embeds/youtube.js')>();
  return {
    ...actual,
    loadDetails: vi.fn().mockResolvedValue({
      title: 'Test Video',
      author: 'Test Author',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    }),
  };
});

import type { CoreEvent } from '#src/generated/protocol';
import { core, mockRpc } from '#lib/core/__mocks__/context.js';
import { i18n } from '#lib/i18n.js';
import { renderWithTooltips } from '#lib/test-support/render-with-tooltips.js';

import { WATCH_TOGETHER_EVENT_TYPE } from './watch-together-protocol.js';
import WatchTogetherView from './WatchTogetherView.svelte';

const defaultRpc = core.rpc;
let listeners: Array<(event: CoreEvent) => void> = [];

beforeEach(() => {
  listeners = [];
  core.session = { account_id: 'a', user_id: '@alice:example.org', device_id: 'DEV' };
  core.subscribeEvents = vi.fn((listener: (event: CoreEvent) => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((entry) => entry !== listener);
    };
  });
});

afterEach(() => {
  core.rpc = defaultRpc;
  delete (globalThis as { sableElectron?: unknown }).sableElectron;
  localStorage.removeItem('sable-watch-together-short-height');
  localStorage.removeItem('sable-watch-together-shorts-scroll');
  vi.restoreAllMocks();
});

test('queues a YouTube URL, sends a sync event, and pins the room widget for managers', async () => {
  const sendRawEvent = vi.fn((params: unknown) => {
    structuredClone(params);
    return Promise.resolve('$evt-1');
  });
  const ensureWidget = vi.fn().mockResolvedValue(undefined);
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
    onEnsureRoomWidget: ensureWidget,
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  expect(await screen.findByText('Test Video')).toBeInTheDocument();
  expect(sendRawEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      room_id: '!room:example.org',
      event_type: WATCH_TOGETHER_EVENT_TYPE,
      content: expect.objectContaining({
        v: 1,
        action: 'load',
        playing: true,
        current: expect.objectContaining({ videoId: 'dQw4w9WgXcQ', title: 'Test Video' }),
      }),
    })
  );
  expect(ensureWidget).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('applies incoming remote sync events and enforces Host/Mods lock for non-mods', async () => {
  core.session = { account_id: 'a', user_id: '@bob:example.org', device_id: 'DEV' };
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  render(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: false,
    members: [],
  });

  await screen.findByPlaceholderText('Paste a YouTube link or video ID…');

  for (const listener of listeners) {
    listener({
      type: 'widget_room_event',
      event: {
        room_id: '!room:example.org',
        type: WATCH_TOGETHER_EVENT_TYPE,
        event_id: '$remote-1',
        sender: '@alice:example.org',
        origin_server_ts: Date.now(),
        content: {
          v: 1,
          sessionId: 'sess-1',
          hostUserId: '@alice:example.org',
          locked: true,
          playing: true,
          positionSec: 15,
          sentAtMs: Date.now(),
          current: {
            id: 'item-1',
            source: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            title: 'Remote Video',
            author: 'Alice',
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
            addedBy: '@alice:example.org',
          },
          queue: [],
          action: 'lock',
        },
      },
    });
  }

  expect(await screen.findByText('Remote Video')).toBeInTheDocument();
  expect(
    screen.getByText('Controls are restricted to the host and room moderators.')
  ).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Paste a YouTube link or video ID…')).not.toBeInTheDocument();
});

test('queues a second video with structuredClone-safe payloads and clears input', async () => {
  let count = 0;
  const sendRawEvent = vi.fn((params: unknown) => {
    structuredClone(params);
    count += 1;
    return Promise.resolve(`$evt-${count}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(input).toHaveValue('');

  await user.type(input, 'jNQXAC9IVRw');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(input).toHaveValue('');
  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'queue',
        queue: [expect.objectContaining({ videoId: 'jNQXAC9IVRw' })],
      }),
    })
  );
});

function assertAllNumbersSafeIntegers(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isSafeInteger(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertAllNumbersSafeIntegers(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) assertAllNumbersSafeIntegers(entry);
  }
}

function getPlayerWindow(): Window {
  const iframe = document.querySelector('iframe');
  if (!iframe) throw new Error('expected player iframe');
  if (!iframe.contentWindow) {
    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      configurable: true,
    });
  }
  return iframe.contentWindow ?? window;
}

function dispatchYoutubeEvent(source: Window, data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://www.youtube-nocookie.com',
      source,
      data: JSON.stringify(data),
    })
  );
}

test('surfaces sync errors and preserves input when sending fails', async () => {
  const sendRawEvent = vi.fn().mockRejectedValue(new DOMException('proxy clone', 'DataCloneError'));
  const ensureWidget = vi.fn().mockResolvedValue(undefined);
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
    onEnsureRoomWidget: ensureWidget,
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  expect(await screen.findByText(i18n.t('errors.actionFailed'))).toBeInTheDocument();
  expect(input).toHaveValue('https://youtu.be/dQw4w9WgXcQ');
  expect(ensureWidget).not.toHaveBeenCalled();
});

test('sends integer-only Canonical JSON on pause/seek from iframe without echoing commands back', async () => {
  let nowMs = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

  let eventCounter = 0;
  const sendRawEvent = vi.fn((params: { content: unknown }) => {
    structuredClone(params);
    assertAllNumbersSafeIntegers(params.content);
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Test Video')).toBeInTheDocument();

  const win = getPlayerWindow();
  const postSpy = vi.spyOn(win, 'postMessage').mockImplementation(() => {});

  dispatchYoutubeEvent(win, { event: 'onReady' });
  postSpy.mockClear();

  nowMs += 2000;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 5.432, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  await Promise.resolve();

  nowMs += 200;
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 2 });
  await Promise.resolve();

  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'pause',
        playing: false,
        positionSec: 5,
        positionMs: 5432,
      }),
    })
  );
  expect(screen.queryByText(i18n.t('errors.actionFailed'))).not.toBeInTheDocument();
  expect(postSpy).not.toHaveBeenCalledWith(expect.stringContaining('"pauseVideo"'), '*');

  nowMs += 200;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 2, currentTime: 18.75, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  await Promise.resolve();

  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'seek',
        positionSec: 19,
        positionMs: 18750,
      }),
    })
  );
});

test('ignores YouTube ad playback events so ads never seek or skip the room', async () => {
  let nowMs = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

  let eventCounter = 0;
  const sendRawEvent = vi.fn(() => {
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Test Video')).toBeInTheDocument();

  const win = getPlayerWindow();
  vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  dispatchYoutubeEvent(win, { event: 'onReady' });
  nowMs += 2000;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 12, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  sendRawEvent.mockClear();

  // Pre-roll or mid-roll ad starts with a different video_id and plays from 0.5s to end
  nowMs += 500;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 0.5, videoData: { video_id: 'adVideo99999' } },
  });
  nowMs += 5000;
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 0 });

  // Main video resumes cleanly
  nowMs += 200;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 12.1, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  await Promise.resolve();

  expect(sendRawEvent).not.toHaveBeenCalled();
});

test('supports YouTube Live streams without initial seek or DVR drift seeks', async () => {
  let nowMs = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

  let eventCounter = 0;
  const sendRawEvent = vi.fn(() => {
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://www.youtube.com/live/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  expect(await screen.findByText('Live')).toBeInTheDocument();
  const jumpButton = screen.getByRole('button', { name: 'Jump to live' });
  expect(jumpButton).toBeInTheDocument();

  const win = getPlayerWindow();
  const postSpy = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  dispatchYoutubeEvent(win, { event: 'onReady' });
  expect(postSpy).not.toHaveBeenCalledWith(expect.stringContaining('"seekTo"'), '*');

  nowMs += 2000;
  sendRawEvent.mockClear();
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: {
      playerState: 1,
      currentTime: 340.5,
      duration: 400,
      videoData: { video_id: 'dQw4w9WgXcQ', isLive: true },
    },
  });
  nowMs += 500;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: {
      playerState: 1,
      currentTime: 390.5,
      duration: 400,
      videoData: { video_id: 'dQw4w9WgXcQ', isLive: true },
    },
  });
  await Promise.resolve();
  expect(sendRawEvent).not.toHaveBeenCalled();

  await user.click(jumpButton);
  expect(postSpy).toHaveBeenCalledWith(expect.stringContaining('"seekTo"'), '*');
});

test('supports YouTube Shorts with portrait layout and replays at 0 when queue is empty', async () => {
  let eventCounter = 0;
  const sendRawEvent = vi.fn(() => {
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  expect(await screen.findByText('Short')).toBeInTheDocument();
  expect(document.querySelector('.player-shell')).toHaveClass('short');

  const win = getPlayerWindow();
  vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  dispatchYoutubeEvent(win, { event: 'onReady' });
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 0 });
  await Promise.resolve();

  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'pause',
        playing: false,
        positionSec: 0,
        positionMs: 0,
      }),
    })
  );
  expect(await screen.findByText('Test Video')).toBeInTheDocument();
});

test('resizes Shorts player proportionally via vertical handle', async () => {
  let eventCounter = 0;
  const sendRawEvent = vi.fn(() => {
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  const slider = await screen.findByRole('slider', { name: 'Resize Short player' });
  const shell = document.querySelector('.player-shell') as HTMLElement;
  expect(shell.style.height).toBe('420px');

  slider.focus();
  await user.keyboard('{ArrowDown}');
  expect(shell.style.height).toBe('444px');
});

test('supports Shorts scroll toggle with sequence feed, previous history, and auto-loop', async () => {
  let eventCounter = 0;
  const sendRawEvent = vi.fn(() => {
    eventCounter += 1;
    return Promise.resolve(`$evt-${eventCounter}`);
  });
  const fetchYoutubeShortsSequence = vi.fn().mockResolvedValue({
    videoIds: ['jNQXAC9IVRw', 'aqz-KE-bpKQ'],
    continuation: 'cont-1',
  });
  (globalThis as { sableElectron?: unknown }).sableElectron = {
    fetchYoutubeShortsSequence,
  };
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));

  const scrollToggle = await screen.findByRole('button', { name: 'Shorts scroll' });
  expect(scrollToggle).toHaveAttribute('aria-pressed', 'false');
  await user.click(scrollToggle);
  expect(scrollToggle).toHaveAttribute('aria-pressed', 'true');

  const win = getPlayerWindow();
  vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  dispatchYoutubeEvent(win, { event: 'onReady' });
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 0 });
  await Promise.resolve();

  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'play',
        playing: true,
        positionSec: 0,
      }),
    })
  );

  const prevButton = screen.getByRole('button', { name: 'Previous Short' });
  const nextButton = screen.getByRole('button', { name: 'Next Short' });
  expect(prevButton).toBeDisabled();

  await user.click(nextButton);
  expect(fetchYoutubeShortsSequence).toHaveBeenCalledWith('dQw4w9WgXcQ', null);
  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'load',
        current: expect.objectContaining({ videoId: 'jNQXAC9IVRw', kind: 'short' }),
      }),
    })
  );
  expect(prevButton).toBeEnabled();

  await user.click(prevButton);
  expect(sendRawEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        action: 'load',
        current: expect.objectContaining({ videoId: 'dQw4w9WgXcQ', kind: 'short' }),
      }),
    })
  );
});

test('releases stuck iframe focus and hover while playing unless dragging', async () => {
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent: vi.fn().mockResolvedValue('$evt-1') },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Test Video')).toBeInTheDocument();

  const shell = document.querySelector('.player-shell') as HTMLElement;
  const frame = document.querySelector('.player-frame') as HTMLIFrameElement;
  const wrap = document.querySelector('.player-wrap') as HTMLElement;
  const win = getPlayerWindow();
  vi.spyOn(win, 'postMessage').mockImplementation(() => {});

  dispatchYoutubeEvent(win, { event: 'onReady' });
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 1 });
  await Promise.resolve();
  expect(frame).toHaveClass('unhovered');

  shell.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await Promise.resolve();
  expect(frame).not.toHaveClass('unhovered');

  // Leaving while dragging (buttons: 1) must keep iframe interactive and focused
  frame.focus();
  shell.dispatchEvent(
    new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse', buttons: 1 })
  );
  await Promise.resolve();
  expect(frame).not.toHaveClass('unhovered');
  expect(document.activeElement).toBe(frame);

  // Normal pointerleave (buttons: 0) blurs iframe onto player-wrap and clears hover state
  shell.dispatchEvent(
    new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse', buttons: 0 })
  );
  await Promise.resolve();
  expect(frame).toHaveClass('unhovered');
  expect(document.activeElement).toBe(wrap);
});

test('late-join YT_UNSTARTED -> YT_PLAYING drift seeks locally without rewinding the room', async () => {
  let nowMs = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

  const sendRawEvent = vi.fn().mockResolvedValue('$evt-1');
  core.rpc = mockRpc({
    timeline: {
      events: vi.fn().mockResolvedValue([
        {
          room_id: '!room:example.org',
          type: WATCH_TOGETHER_EVENT_TYPE,
          event_id: '$remote-1',
          sender: '@bob:example.org',
          origin_server_ts: nowMs - 10_000,
          content: {
            v: 1,
            sessionId: 'sess-1',
            hostUserId: '@bob:example.org',
            locked: false,
            playing: true,
            positionSec: 40,
            sentAtMs: nowMs - 10_000,
            current: {
              id: 'item-1',
              source: 'youtube',
              videoId: 'dQw4w9WgXcQ',
              title: 'Remote Video',
              author: 'Bob',
              thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
              addedBy: '@bob:example.org',
            },
            queue: [],
            action: 'play',
          },
        },
      ]),
    },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  expect(await screen.findByText('Remote Video')).toBeInTheDocument();
  const win = getPlayerWindow();
  const postSpy = vi.spyOn(win, 'postMessage').mockImplementation(() => {});

  dispatchYoutubeEvent(win, { event: 'onReady' });
  postSpy.mockClear();

  // Simulate infoDelivery reporting player at 0s after suppression ends, then YT_PLAYING
  nowMs += 3000;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: -1, currentTime: 0, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  dispatchYoutubeEvent(win, { event: 'onStateChange', info: 1 });
  await Promise.resolve();

  expect(sendRawEvent).not.toHaveBeenCalled();
  expect(postSpy).toHaveBeenCalledWith(expect.stringContaining('"seekTo"'), '*');
});

test('playback stalls do not emit false local seeks', async () => {
  let nowMs = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

  const sendRawEvent = vi.fn().mockResolvedValue('$evt-1');
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Test Video')).toBeInTheDocument();

  const win = getPlayerWindow();
  vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  dispatchYoutubeEvent(win, { event: 'onReady' });
  nowMs += 3000;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 10, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  sendRawEvent.mockClear();

  // Video stalls for 4 seconds without currentTime advancing
  nowMs += 4000;
  dispatchYoutubeEvent(win, {
    event: 'infoDelivery',
    info: { playerState: 1, currentTime: 10.2, videoData: { video_id: 'dQw4w9WgXcQ' } },
  });
  await Promise.resolve();

  expect(sendRawEvent).not.toHaveBeenCalled();
});

test('own echo updates optimistic timestamp so remote events with lower local clock still win', async () => {
  const localClock = 1_700_000_060_000;
  const serverClock = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => localClock);

  const sendRawEvent = vi.fn().mockResolvedValue('$own-1');
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    messages: { sendRawEvent },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const user = userEvent.setup();
  renderWithTooltips(WatchTogetherView, {
    roomId: '!room:example.org',
    canManage: true,
    members: [],
  });

  const input = await screen.findByPlaceholderText('Paste a YouTube link or video ID…');
  await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Test Video')).toBeInTheDocument();

  // Server echoes own event with authoritative earlier server timestamp
  for (const listener of listeners) {
    listener({
      type: 'widget_room_event',
      event: {
        room_id: '!room:example.org',
        type: WATCH_TOGETHER_EVENT_TYPE,
        event_id: '$own-1',
        sender: '@alice:example.org',
        origin_server_ts: serverClock,
        content: {
          v: 1,
          sessionId: 'sess-own',
          hostUserId: '@alice:example.org',
          locked: false,
          playing: true,
          positionSec: 0,
          positionMs: 0,
          sentAtMs: localClock,
          current: {
            id: 'item-own',
            source: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            title: 'Test Video',
            author: 'Test Author',
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
            addedBy: '@alice:example.org',
          },
          queue: [],
          action: 'load',
        },
      },
    });
  }

  // Remote user acts 5s later on server clock (still < localClock)
  for (const listener of listeners) {
    listener({
      type: 'widget_room_event',
      event: {
        room_id: '!room:example.org',
        type: WATCH_TOGETHER_EVENT_TYPE,
        event_id: '$remote-2',
        sender: '@bob:example.org',
        origin_server_ts: serverClock + 5000,
        content: {
          v: 1,
          sessionId: 'sess-own',
          hostUserId: '@alice:example.org',
          locked: false,
          playing: false,
          positionSec: 5,
          sentAtMs: serverClock + 5000,
          current: {
            id: 'item-own',
            source: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            title: 'Test Video',
            author: 'Test Author',
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
            addedBy: '@alice:example.org',
          },
          queue: [],
          action: 'pause',
        },
      },
    });
  }

  expect(await screen.findByText('Paused')).toBeInTheDocument();
});

test('supports maximize/restore button and collapsible queue toggle in theater/maximized modes', async () => {
  core.rpc = mockRpc({
    timeline: { events: vi.fn().mockResolvedValue([]) },
    widgets: { setWidgetFeed: vi.fn().mockResolvedValue(null) },
  });

  const onToggleMaximize = vi.fn();
  const user = userEvent.setup();
  const rendered = render(
    WatchTogetherView,
    {
      roomId: '!room:example.org',
      canManage: true,
      members: [],
      theater: true,
      onToggleMaximize,
    },
    { wrapper: TooltipProvider }
  );

  const maxBtn = await screen.findByRole('button', { name: 'Maximize Watch Together' });
  await user.click(maxBtn);
  expect(onToggleMaximize).toHaveBeenCalledOnce();

  const queueToggle = screen.getByRole('button', { name: 'Toggle queue' });
  expect(screen.getByPlaceholderText('Paste a YouTube link or video ID…')).toBeInTheDocument();
  await user.click(queueToggle);
  expect(screen.queryByPlaceholderText('Paste a YouTube link or video ID…')).not.toBeInTheDocument();

  await rendered.rerender({
    roomId: '!room:example.org',
    canManage: true,
    members: [],
    theater: false,
    maximized: true,
    onToggleMaximize,
  });
  expect(screen.getByRole('button', { name: 'Exit maximized view' })).toBeInTheDocument();
});
