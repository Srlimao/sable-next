import { describe, expect, test } from 'vitest';
import {
  computeAnchorFromWidgetPosition,
  computeLockedBounds,
  matchesRegisteredApp,
  sanitizeOverlayConfig,
  sanitizeOverlayState,
} from './voice-overlay-layout';

describe('matchesRegisteredApp', () => {
  const apps = [
    { exe: 'valorant-win64-shipping.exe', label: 'VALORANT', enabled: true },
    { exe: 'cs2.exe', label: 'Counter-Strike 2', enabled: false },
  ];

  test('matches enabled executables case-insensitively', () => {
    expect(matchesRegisteredApp('VALORANT-Win64-Shipping.EXE', apps)).toBe(true);
    expect(matchesRegisteredApp('C:\\Games\\VALORANT-Win64-Shipping.exe', apps)).toBe(true);
  });

  test('ignores disabled or unregistered executables', () => {
    expect(matchesRegisteredApp('cs2.exe', apps)).toBe(false);
    expect(matchesRegisteredApp('notepad.exe', apps)).toBe(false);
  });
});

describe('locked bounds and anchor conversion', () => {
  const target = { x: 1920, y: 0, width: 2560, height: 1440 };
  const widget = { width: 220, height: 140 };

  test('anchors top-left and bottom-right inside target margin', () => {
    expect(computeLockedBounds(target, widget, 0, 0)).toEqual({
      x: 1932,
      y: 12,
      width: 220,
      height: 140,
    });
    expect(computeLockedBounds(target, widget, 1, 1)).toEqual({
      x: 1920 + 2560 - 12 - 220,
      y: 1440 - 12 - 140,
      width: 220,
      height: 140,
    });
  });

  test('round-trips dragged position back to normalized anchor across resolutions', () => {
    const placed = computeLockedBounds(target, widget, 0.75, 0.25);
    const anchor = computeAnchorFromWidgetPosition(
      target,
      placed.x,
      placed.y,
      placed.width,
      placed.height
    );
    expect(anchor.anchorX).toBeCloseTo(0.75, 2);
    expect(anchor.anchorY).toBeCloseTo(0.25, 2);
  });
});

describe('sanitizers', () => {
  test('sanitizes config and rejects invalid avatar URLs in state', () => {
    const config = sanitizeOverlayConfig({
      enabled: true,
      opacity: 5,
      apps: [{ exe: 'Game', label: 'Game', enabled: true }],
    });
    expect(config).toMatchObject({
      enabled: true,
      opacity: 1,
      apps: [{ exe: 'game.exe', label: 'Game', enabled: true }],
    });
    const state = sanitizeOverlayState({
      inCall: true,
      participants: [
        {
          id: 'u1',
          name: 'Alice',
          avatarUrl: 'https://evil.example/a.png',
          speaking: true,
        },
      ],
    });
    expect(state?.participants[0]?.avatarUrl).toBeNull();
  });
});
