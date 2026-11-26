import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WebContents } from 'electron';
import type {
  VoiceOverlayAction,
  VoiceOverlayConfig,
  VoiceOverlayState,
} from '../../src/lib/platform/voice-overlay-types';
import { VoiceOverlayManager, type OverlayWindowLike } from './voice-overlay';

function createFakeWindow() {
  let visible = false;
  let destroyed = false;
  let readyListener: (() => void) | undefined;
  const send = vi.fn();
  const setBounds = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const setIgnoreMouseEvents = vi.fn();
  const setFocusable = vi.fn();
  const show = vi.fn(() => {
    visible = true;
  });
  const showInactive = vi.fn(() => {
    visible = true;
  });
  const hide = vi.fn(() => {
    visible = false;
  });
  const focus = vi.fn();
  const destroy = vi.fn(() => {
    destroyed = true;
    visible = false;
  });
  const win: OverlayWindowLike = {
    webContents: { send } as unknown as WebContents,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    setBounds,
    setAlwaysOnTop,
    setIgnoreMouseEvents,
    setFocusable,
    setSkipTaskbar: vi.fn(),
    moveTop: vi.fn(),
    show,
    showInactive,
    hide,
    focus,
    destroy,
    loadURL: () => Promise.resolve(),
    on: vi.fn(),
    once: (_event: 'ready-to-show', listener: () => void) => {
      readyListener = listener;
    },
  };
  return {
    win,
    send,
    setBounds,
    setIgnoreMouseEvents,
    setFocusable,
    showInactive,
    hide,
    focus,
    triggerReady: () => readyListener?.(),
  };
}

const baseConfig: VoiceOverlayConfig = {
  enabled: true,
  preview: false,
  displayMode: 'always',
  nameMode: 'always',
  avatarSize: 'compact',
  opacity: 0.85,
  anchorX: 0,
  anchorY: 0,
  apps: [{ exe: 'game.exe', label: 'My Game', enabled: true }],
};

const baseState: VoiceOverlayState = {
  inCall: true,
  microphoneEnabled: true,
  deafened: false,
  participants: [
    {
      id: 'u1',
      name: 'Alice',
      avatarUrl: null,
      color: '#5865f2',
      initials: 'A',
      speaking: true,
      muted: false,
      deafened: false,
      local: true,
    },
  ],
};

let manager: VoiceOverlayManager | undefined;
afterEach(() => {
  manager?.stop();
  manager = undefined;
});

describe('VoiceOverlayManager', () => {
  test('shows click-through overlay over a registered foreground app and hides on other apps', () => {
    const fake = createFakeWindow();
    let fg: string | null = JSON.stringify({
      hwnd: '101',
      exe: 'game.exe',
      title: 'My Game',
      pid: 999,
      x: 100,
      y: 50,
      width: 1920,
      height: 1080,
      minimized: false,
    });
    const focusWindow = vi.fn(() => true);
    manager = new VoiceOverlayManager({
      platform: 'win32',
      selfPid: 111,
      pollMs: 10_000,
      loadNative: () => ({
        getForegroundWindowInfo: () => fg,
        focusWindow,
      }),
      createWindow: () => fake.win,
      screenApi: {
        screenToDipRect: (_w, rect) => rect,
        getPrimaryWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
      },
      onAction: vi.fn(),
    });

    manager.updateState(baseState);
    manager.updateConfig(baseConfig);
    fake.triggerReady();

    expect(fake.showInactive).toHaveBeenCalled();
    expect(fake.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: false });
    expect(fake.setBounds).toHaveBeenLastCalledWith({
      x: 112,
      y: 62,
      width: 220,
      height: 80,
    });

    fg = JSON.stringify({
      hwnd: '202',
      exe: 'chrome.exe',
      title: 'Browser',
      pid: 888,
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      minimized: false,
    });
    manager.tick();
    expect(fake.hide).toHaveBeenCalled();
  });

  test('unlocks to full target bounds and restores focus to the game when re-locked', () => {
    const fake = createFakeWindow();
    const focusWindow = vi.fn(() => true);
    const onAction = vi.fn<(action: VoiceOverlayAction) => void>();
    manager = new VoiceOverlayManager({
      platform: 'win32',
      selfPid: 111,
      pollMs: 10_000,
      loadNative: () => ({
        getForegroundWindowInfo: () =>
          JSON.stringify({
            hwnd: '777',
            exe: 'game.exe',
            title: 'My Game',
            pid: 999,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            minimized: false,
          }),
        focusWindow,
      }),
      createWindow: () => fake.win,
      screenApi: {
        screenToDipRect: (_w, rect) => rect,
        getPrimaryWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
      },
      onAction,
    });

    manager.updateState(baseState);
    manager.updateConfig(baseConfig);
    fake.triggerReady();

    manager.toggleLock();
    expect(manager.unlocked).toBe(true);
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(fake.setFocusable).toHaveBeenLastCalledWith(true);
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(fake.focus).toHaveBeenCalled();

    manager.handleAction({ type: 'move', anchorX: 0.5, anchorY: 0.5 });
    expect(onAction).toHaveBeenCalledWith({ type: 'move', anchorX: 0.5, anchorY: 0.5 });

    manager.handleAction({ type: 'lock' });
    expect(manager.unlocked).toBe(false);
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: false });
    expect(focusWindow).toHaveBeenCalledWith('777');
  });

  test('shows preview on primary work area even when not in a call', () => {
    const fake = createFakeWindow();
    manager = new VoiceOverlayManager({
      platform: 'win32',
      selfPid: 111,
      pollMs: 10_000,
      loadNative: () => ({ getForegroundWindowInfo: () => null }),
      createWindow: () => fake.win,
      screenApi: {
        screenToDipRect: (_w, rect) => rect,
        getPrimaryWorkArea: () => ({ x: 0, y: 0, width: 1600, height: 900 }),
      },
      onAction: vi.fn(),
    });

    manager.updateState({ ...baseState, inCall: false });
    manager.updateConfig({ ...baseConfig, preview: true });
    fake.triggerReady();

    expect(fake.showInactive).toHaveBeenCalled();
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 12, y: 12, width: 220, height: 80 });
  });

  test('pushes render update when renderer signals ready', () => {
    const fake = createFakeWindow();
    manager = new VoiceOverlayManager({
      platform: 'win32',
      selfPid: 111,
      pollMs: 10_000,
      loadNative: () => ({ getForegroundWindowInfo: () => null }),
      createWindow: () => fake.win,
      screenApi: {
        screenToDipRect: (_w, rect) => rect,
        getPrimaryWorkArea: () => ({ x: 0, y: 0, width: 1600, height: 900 }),
      },
      onAction: vi.fn(),
    });

    manager.updateState({ ...baseState, inCall: false });
    manager.updateConfig({ ...baseConfig, preview: true });
    expect(fake.send).not.toHaveBeenCalled();

    manager.handleRendererReady();
    const sent = fake.send.mock.calls.at(-1);
    expect(sent?.[0]).toBe('sable-overlay-update');
    expect(sent?.[1]).toMatchObject({
      unlocked: false,
      config: { preview: true },
    });
  });
});
