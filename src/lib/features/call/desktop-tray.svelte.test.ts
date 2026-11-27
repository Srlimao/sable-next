// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import type { CallLifecycle, CallSession } from './call-session.svelte';
import type { CallTransportState } from './call-transport';
import {
  registerDesktopTrayStatus,
  renderTrayCallIcon,
  trayCallStatus,
} from './desktop-tray.svelte.js';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const transportWithSelf = (self?: CallTransportState['self']): CallTransportState => ({
  connection: 'connected',
  participants: [],
  self,
  microphoneEnabled: true,
  cameraEnabled: false,
  screenShareEnabled: false,
});

test.each([
  ['idle', true, false, undefined, 'idle'],
  ['joining', true, false, { identity: '@me:x', speaking: true }, 'idle'],
  ['connecting', true, false, { identity: '@me:x', speaking: true }, 'idle'],
  ['leaving', true, false, { identity: '@me:x', speaking: true }, 'idle'],
  ['failed', true, false, { identity: '@me:x', speaking: true }, 'idle'],
  ['active', true, false, undefined, 'connected'],
  ['active', true, false, { identity: '@me:x', speaking: false }, 'connected'],
  [
    'active',
    true,
    false,
    { identity: '@me:x', speaking: true, microphone: { id: 'm', muted: true, subscribed: true } },
    'connected',
  ],
  [
    'active',
    true,
    false,
    { identity: '@me:x', speaking: true, microphone: { id: 'm', muted: false, subscribed: true } },
    'speaking',
  ],
  ['active', false, false, { identity: '@me:x', speaking: true }, 'muted'],
  ['active', true, true, { identity: '@me:x', speaking: true }, 'deafened'],
  ['active', false, true, { identity: '@me:x', speaking: true }, 'deafened'],
] as const)(
  'trayCallStatus(%s, mic=%s, deafened=%s) -> %s',
  (lifecycle, microphoneEnabled, deafened, self, expected) => {
    expect(
      trayCallStatus({
        lifecycle,
        microphoneEnabled,
        deafened,
        transport: transportWithSelf(self),
      })
    ).toBe(expected);
  }
);

class MockPath2D {
  constructor(readonly d: string) {}
}

function mockCanvasEnvironment() {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  };

  vi.stubGlobal('Path2D', MockPath2D);

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => `data:image/png;base64,${ctx.fillStyle}`),
  };

  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName !== 'canvas') {
      throw new Error(`Unexpected tag: ${tagName}`);
    }
    return canvas as unknown as HTMLCanvasElement;
  });

  return { ctx, canvas };
}

test('renderTrayCallIcon draws 256px silent light green, speaking strong green, muted mic, and deafened headphones', () => {
  const { ctx, canvas } = mockCanvasEnvironment();

  const connected = renderTrayCallIcon('connected');
  expect(canvas.width).toBe(256);
  expect(canvas.height).toBe(256);
  expect(connected).toBe('data:image/png;base64,#b2f21d');
  expect(ctx.arc).toHaveBeenCalledTimes(2);

  const speaking = renderTrayCallIcon('speaking');
  expect(speaking).toBe('data:image/png;base64,#1b7a34');
  expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
  expect(ctx.arc).toHaveBeenCalledTimes(7);

  const muted = renderTrayCallIcon('muted');
  expect(muted).toBe('data:image/png;base64,#f23f43');
  expect(ctx.fill).toHaveBeenCalledTimes(4);
  expect((ctx.fill.mock.calls[3]?.[0] as MockPath2D | undefined)?.d.length).toBeGreaterThan(0);

  const deafened = renderTrayCallIcon('deafened');
  expect(deafened).toBe('data:image/png;base64,#f23f43');
  expect(ctx.stroke).toHaveBeenCalledTimes(8);
});

test('registerDesktopTrayStatus tracks connected/speaking/muted/deafened transitions and resets on cleanup', () => {
  mockCanvasEnvironment();
  const setTrayCallState = vi.fn();
  vi.stubGlobal('sableElectron', { setTrayCallState });

  const session: {
    lifecycle: CallLifecycle;
    microphoneEnabled: boolean;
    deafened: boolean;
    transport: CallTransportState;
  } = $state({
    lifecycle: 'idle',
    microphoneEnabled: true,
    deafened: false,
    transport: transportWithSelf(undefined),
  });

  stop = registerDesktopTrayStatus(session as unknown as CallSession);
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({ status: 'idle', icon: null });

  session.lifecycle = 'active';
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'connected',
    icon: 'data:image/png;base64,#b2f21d',
  });

  session.transport = transportWithSelf({
    identity: '@me:x',
    speaking: true,
    microphone: { id: 'mic', muted: false, subscribed: true },
  });
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'speaking',
    icon: 'data:image/png;base64,#1b7a34',
  });

  session.transport = transportWithSelf({
    identity: '@me:x',
    speaking: false,
    microphone: { id: 'mic', muted: false, subscribed: true },
  });
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'connected',
    icon: 'data:image/png;base64,#b2f21d',
  });

  session.microphoneEnabled = false;
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'muted',
    icon: 'data:image/png;base64,#f23f43',
  });

  session.deafened = true;
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'deafened',
    icon: 'data:image/png;base64,#f23f43',
  });

  session.deafened = false;
  session.microphoneEnabled = true;
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({
    status: 'connected',
    icon: 'data:image/png;base64,#b2f21d',
  });

  // Repeated same state does not emit duplicate IPC calls.
  const callsBefore = setTrayCallState.mock.calls.length;
  flushSync();
  expect(setTrayCallState).toHaveBeenCalledTimes(callsBefore);

  session.lifecycle = 'idle';
  flushSync();
  expect(setTrayCallState).toHaveBeenLastCalledWith({ status: 'idle', icon: null });

  stop();
  stop = undefined;
  expect(setTrayCallState).toHaveBeenLastCalledWith({ status: 'idle', icon: null });
});
