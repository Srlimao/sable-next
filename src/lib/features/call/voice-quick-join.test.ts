import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { CallSupportView, RoomListItemView, RoomRulesView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { setPreference } from '#lib/settings/preferences.svelte.js';
import { roomView } from '#lib/test-support/room-views.js';

const configFixture = vi.hoisted(() => ({
  livekitServiceUrl: null as string | null,
}));
vi.mock('#lib/config/runtime-config.js', () => ({
  runtimeConfig: vi.fn(() =>
    Promise.resolve({ calls: { livekitServiceUrl: configFixture.livekitServiceUrl } })
  ),
}));

import { VoiceQuickJoin } from './voice-quick-join.js';

const realRtc = globalThis.RTCPeerConnection;

function voiceRoom(roomId = '!voice:example.org', participants: string[] = []): RoomListItemView {
  return roomView({
    room_id: roomId,
    name: roomId,
    room_kind: 'voice',
    state: 'joined',
    call_participants: participants,
  });
}

function makeSupport(overrides: Partial<CallSupportView> = {}): CallSupportView {
  return {
    supported: true,
    can_join: true,
    has_focus: true,
    ...overrides,
  } as CallSupportView;
}

function makeHarness(options?: {
  rules?: RoomRulesView | null;
  support?: CallSupportView | null;
  active?: boolean;
  roomId?: string | null;
  lifecycle?: 'idle' | 'joining' | 'connecting' | 'active' | 'leaving' | 'failed';
  viewingVoiceStage?: boolean;
}) {
  const rulesMock = vi.fn(() => Promise.resolve(options?.rules ?? null));
  const supportMock = vi.fn(() =>
    Promise.resolve(options && 'support' in options ? options.support : makeSupport())
  );
  const core = {
    rpc: {
      room_state: { rules: rulesMock },
      calls: { support: supportMock },
    },
  } as unknown as Pick<CoreClient, 'rpc'>;

  const call = {
    active: options?.active ?? false,
    lifecycle: options?.lifecycle ?? (options?.active ? 'active' : 'idle'),
    roomId: options?.roomId ?? null,
    switchTo: vi.fn((targetId: string) => {
      call.active = true;
      call.lifecycle = 'active';
      call.roomId = targetId;
      return Promise.resolve();
    }),
  };

  const navigate = vi.fn<(href: string) => void>();
  const isViewingVoiceCallStage = vi.fn(() => options?.viewingVoiceStage ?? false);

  const quickJoin = new VoiceQuickJoin({
    core,
    call,
    isViewingVoiceCallStage,
    navigate,
  });

  return { quickJoin, core, rulesMock, supportMock, call, navigate, isViewingVoiceCallStage };
}

beforeEach(() => {
  configFixture.livekitServiceUrl = null;
  setPreference('callMicrophoneMuted', false);
  setPreference('callServiceUrl', '');
  globalThis.RTCPeerConnection = vi.fn() as unknown as typeof RTCPeerConnection;
});

afterEach(() => {
  globalThis.RTCPeerConnection = realRtc;
});

test('joins an eligible voice room in place without navigating', async () => {
  configFixture.livekitServiceUrl = 'https://lk.example.org';
  setPreference('callMicrophoneMuted', true);
  const h = makeHarness();

  await h.quickJoin.join(voiceRoom('!voice:example.org'), '/rooms/!voice%3Aexample.org');

  expect(h.supportMock).toHaveBeenCalledWith({
    room_id: '!voice:example.org',
    livekit_service_url: 'https://lk.example.org',
  });
  expect(h.call.switchTo).toHaveBeenCalledWith(
    '!voice:example.org',
    { microphone: false, camera: false },
    'https://lk.example.org'
  );
  expect(h.navigate).not.toHaveBeenCalled();
});

test('prefers user callServiceUrl over runtimeConfig fallback', async () => {
  configFixture.livekitServiceUrl = 'https://deploy.example.org';
  setPreference('callServiceUrl', 'https://custom.example.org');
  const h = makeHarness();

  await h.quickJoin.join(voiceRoom(), '/rooms/!voice%3Aexample.org');

  expect(h.call.switchTo).toHaveBeenCalledWith(
    '!voice:example.org',
    { microphone: true, camera: false },
    'https://custom.example.org/'
  );
});

test('navigates without rejoining when already active in that voice room', async () => {
  const h = makeHarness({ active: true, roomId: '!voice:example.org' });

  await h.quickJoin.join(voiceRoom('!voice:example.org'), '/rooms/!voice%3Aexample.org');

  expect(h.navigate).toHaveBeenCalledWith('/rooms/!voice%3Aexample.org');
  expect(h.rulesMock).not.toHaveBeenCalled();
  expect(h.supportMock).not.toHaveBeenCalled();
  expect(h.call.switchTo).not.toHaveBeenCalled();
});

test('double-clicking the same voice room during preflight navigates without restarting preflight', async () => {
  let resolveSupport: ((value: CallSupportView) => void) | undefined;
  const h = makeHarness();
  h.supportMock.mockImplementation(
    () =>
      new Promise<CallSupportView>((resolve) => {
        resolveSupport = resolve;
      })
  );

  const first = h.quickJoin.join(voiceRoom('!voice:example.org'), '/rooms/!voice%3Aexample.org');
  await vi.waitFor(() => {
    expect(h.supportMock).toHaveBeenCalledOnce();
  });

  await h.quickJoin.join(voiceRoom('!voice:example.org'), '/rooms/!voice%3Aexample.org');
  expect(h.navigate).toHaveBeenCalledWith('/rooms/!voice%3Aexample.org');
  expect(h.supportMock).toHaveBeenCalledOnce();

  resolveSupport?.(makeSupport());
  await first;
  expect(h.call.switchTo).toHaveBeenCalledOnce();
});

test('clicking a different voice room or cancelling aborts stale preflight', async () => {
  let resolveFirst: ((value: CallSupportView) => void) | undefined;
  const h = makeHarness();
  h.supportMock
    .mockImplementationOnce(
      () =>
        new Promise<CallSupportView>((resolve) => {
          resolveFirst = resolve;
        })
    )
    .mockImplementationOnce(() => Promise.resolve(makeSupport()));

  const first = h.quickJoin.join(voiceRoom('!a:example.org'), '/rooms/!a%3Aexample.org');
  await vi.waitFor(() => {
    expect(h.supportMock).toHaveBeenCalledTimes(1);
  });

  const second = h.quickJoin.join(voiceRoom('!b:example.org'), '/rooms/!b%3Aexample.org');
  resolveFirst?.(makeSupport());
  await Promise.all([first, second]);

  expect(h.call.switchTo).toHaveBeenCalledTimes(1);
  expect(h.call.switchTo).toHaveBeenCalledWith(
    '!b:example.org',
    { microphone: true, camera: false },
    null
  );

  h.call.switchTo.mockClear();
  let resolveThird: ((value: CallSupportView) => void) | undefined;
  h.supportMock.mockImplementationOnce(
    () =>
      new Promise<CallSupportView>((resolve) => {
        resolveThird = resolve;
      })
  );
  const third = h.quickJoin.join(voiceRoom('!c:example.org'), '/rooms/!c%3Aexample.org');
  await vi.waitFor(() => {
    expect(h.supportMock).toHaveBeenCalledTimes(3);
  });
  h.quickJoin.cancel();
  resolveThird?.(makeSupport());
  await third;
  expect(h.call.switchTo).not.toHaveBeenCalled();
});

test.each([
  [
    'unaccepted rules',
    {
      rules: {
        source_room_id: '!voice-b:example.org',
        version: 1,
        html: '<p>Rules</p>',
        require_acceptance: true,
        accepted: false,
      } as RoomRulesView,
    },
  ],
  ['missing can_join permission', { support: makeSupport({ can_join: false }) }],
  ['missing focus with no live participants', { support: makeSupport({ has_focus: false }) }],
  ['support rpc failure', { support: null }],
])('navigates without dropping an active call when blocked by %s', async (_label, overrides) => {
  const h = makeHarness({
    active: true,
    roomId: '!voice-a:example.org',
    ...overrides,
  });

  await h.quickJoin.join(voiceRoom('!voice-b:example.org'), '/rooms/!voice-b%3Aexample.org');

  expect(h.navigate).toHaveBeenCalledWith('/rooms/!voice-b%3Aexample.org');
  expect(h.call.switchTo).not.toHaveBeenCalled();
});

test('navigates when RTCPeerConnection is unavailable', async () => {
  globalThis.RTCPeerConnection = undefined as unknown as typeof RTCPeerConnection;
  const h = makeHarness({ active: true, roomId: '!voice-a:example.org' });

  await h.quickJoin.join(voiceRoom('!voice-b:example.org'), '/rooms/!voice-b%3Aexample.org');

  expect(h.navigate).toHaveBeenCalledWith('/rooms/!voice-b%3Aexample.org');
  expect(h.call.switchTo).not.toHaveBeenCalled();
});

test('joins in place when has_focus is false but participants are already live', async () => {
  const h = makeHarness({ support: makeSupport({ has_focus: false }) });

  await h.quickJoin.join(
    voiceRoom('!voice:example.org', ['@alice:example.org']),
    '/rooms/!voice%3Aexample.org'
  );

  expect(h.call.switchTo).toHaveBeenCalledOnce();
  expect(h.navigate).not.toHaveBeenCalled();
});

test('follows stage to new voice room only when viewing the previous voice call stage', async () => {
  const stay = makeHarness({
    active: true,
    roomId: '!voice-a:example.org',
    viewingVoiceStage: false,
  });
  await stay.quickJoin.join(voiceRoom('!voice-b:example.org'), '/rooms/!voice-b%3Aexample.org');
  expect(stay.navigate).not.toHaveBeenCalled();
  expect(stay.call.switchTo).toHaveBeenCalledOnce();

  const follow = makeHarness({
    active: true,
    roomId: '!voice-a:example.org',
    viewingVoiceStage: true,
  });
  await follow.quickJoin.join(voiceRoom('!voice-b:example.org'), '/rooms/!voice-b%3Aexample.org');
  expect(follow.navigate).toHaveBeenCalledWith('/rooms/!voice-b%3Aexample.org');
  expect(follow.call.switchTo).toHaveBeenCalledOnce();
});

test('navigates to the voice room if call setup fails', async () => {
  const h = makeHarness();
  h.call.switchTo.mockImplementation((targetId: string) => {
    h.call.active = false;
    h.call.lifecycle = 'failed';
    h.call.roomId = targetId;
    return Promise.resolve();
  });

  await h.quickJoin.join(voiceRoom('!voice:example.org'), '/rooms/!voice%3Aexample.org');

  expect(h.navigate).toHaveBeenCalledWith('/rooms/!voice%3Aexample.org');
});
