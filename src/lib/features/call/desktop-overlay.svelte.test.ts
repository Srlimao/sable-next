// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import type { CoreClient } from '#lib/core/client.svelte.js';
import type {
  VoiceOverlayAction,
  VoiceOverlayConfig,
  VoiceOverlayState,
} from '#lib/platform/voice-overlay-types.js';
import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
import type { CallSession } from './call-session.svelte';
import { registerDesktopVoiceOverlay } from './desktop-overlay.svelte.js';
import { voiceOverlayPreview } from './voice-overlay-preview.svelte.js';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  voiceOverlayPreview.active = false;
  setPreference('callVoiceOverlay', false);
  setPreference('callVoiceOverlayAnchorX', 0.02);
  setPreference('callVoiceOverlayAnchorY', 0.04);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('forwards overlay config, live voice state, preview state, and overlay actions', () => {
  let receiveAction!: (action: VoiceOverlayAction) => void;
  const updateVoiceOverlayConfig = vi.fn<(config: VoiceOverlayConfig, shortcut: string) => void>();
  const updateVoiceOverlayState = vi.fn<(state: VoiceOverlayState) => void>();
  vi.stubGlobal('sableElectron', {
    voiceOverlayAvailable: true,
    updateVoiceOverlayConfig,
    updateVoiceOverlayState,
    onVoiceOverlayAction: (cb: (action: VoiceOverlayAction) => void) => {
      receiveAction = cb;
      return vi.fn();
    },
  });

  setPreference('callVoiceOverlay', true);
  const session = $state({
    active: false,
    members: [
      {
        user_id: '@bob:x',
        device_id: 'B',
        identity: '@bob:x:B',
        backend_id: null,
        joined_ts: 1,
        screen_sharing: false,
      },
    ],
    voiceStates: new Map([
      ['@bob:x', { speaking: true, muted: false, camera: false, screen: false, deafened: false }],
    ]),
    microphoneEnabled: true,
    deafened: false,
    toggleMicrophone: vi.fn(async () => {}),
    setDeafened: vi.fn(),
    leave: vi.fn(async () => {}),
  });
  const core = {
    session: { user_id: '@me:x' },
    userProfile: vi.fn(() => Promise.resolve({ display_name: 'Bob', avatar_url: null })),
  } as unknown as CoreClient;

  stop = registerDesktopVoiceOverlay(session as unknown as CallSession, core);
  flushSync();

  expect(updateVoiceOverlayConfig).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: true, preview: false }),
    expect.any(String)
  );

  voiceOverlayPreview.active = true;
  flushSync();
  const previewState = updateVoiceOverlayState.mock.calls.at(-1)?.[0];
  expect(previewState?.inCall).toBe(false);
  expect(previewState?.participants[0]).toMatchObject({ name: 'Willow', speaking: true });

  session.active = true;
  flushSync();
  const callState = updateVoiceOverlayState.mock.calls.at(-1)?.[0];
  expect(callState?.inCall).toBe(true);
  expect(callState?.participants).toEqual([
    expect.objectContaining({ id: '@bob:x', speaking: true }),
  ]);

  receiveAction({ type: 'toggle-mute' });
  receiveAction({ type: 'toggle-deafen' });
  receiveAction({ type: 'hang-up' });
  receiveAction({ type: 'move', anchorX: 0.4, anchorY: 0.6 });
  expect(session.toggleMicrophone).toHaveBeenCalledOnce();
  expect(session.setDeafened).toHaveBeenCalledWith(true);
  expect(session.leave).toHaveBeenCalledOnce();
  expect(preferences.callVoiceOverlayAnchorX).toBe(0.4);
  expect(preferences.callVoiceOverlayAnchorY).toBe(0.6);
});
