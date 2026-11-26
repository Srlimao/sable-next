import {
  VOICE_OVERLAY_AVATAR_SIZES,
  VOICE_OVERLAY_DISPLAY_MODES,
  VOICE_OVERLAY_NAME_MODES,
  normalizeOverlayExe,
  type VoiceOverlayApp,
  type VoiceOverlayConfig,
  type VoiceOverlayParticipant,
  type VoiceOverlayState,
} from '../../src/lib/platform/voice-overlay-types';

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const OVERLAY_MARGIN_PX = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function matchesRegisteredApp(exe: string, apps: readonly VoiceOverlayApp[]): boolean {
  const normalized = normalizeOverlayExe(exe);
  if (!normalized) return false;
  return apps.some((app) => app.enabled && normalizeOverlayExe(app.exe) === normalized);
}

export function computeLockedBounds(
  target: OverlayRect,
  widget: { width: number; height: number },
  anchorX: number,
  anchorY: number,
  margin = OVERLAY_MARGIN_PX
): OverlayRect {
  const maxWidth = Math.max(1, target.width - margin * 2);
  const maxHeight = Math.max(1, target.height - margin * 2);
  const width = Math.min(Math.max(1, Math.ceil(widget.width)), maxWidth);
  const height = Math.min(Math.max(1, Math.ceil(widget.height)), maxHeight);
  const availX = Math.max(0, target.width - margin * 2 - width);
  const availY = Math.max(0, target.height - margin * 2 - height);
  return {
    x: Math.round(target.x + margin + clamp(anchorX, 0, 1) * availX),
    y: Math.round(target.y + margin + clamp(anchorY, 0, 1) * availY),
    width,
    height,
  };
}

export function computeAnchorFromWidgetPosition(
  target: OverlayRect,
  widgetLeft: number,
  widgetTop: number,
  widgetWidth: number,
  widgetHeight: number,
  margin = OVERLAY_MARGIN_PX
): { anchorX: number; anchorY: number } {
  const availX = Math.max(0, target.width - margin * 2 - widgetWidth);
  const availY = Math.max(0, target.height - margin * 2 - widgetHeight);
  const ratio = (pos: number, origin: number, avail: number) =>
    avail <= 0 ? 0 : Math.round(clamp((pos - (origin + margin)) / avail, 0, 1) * 10_000) / 10_000;
  return {
    anchorX: ratio(widgetLeft, target.x, availX),
    anchorY: ratio(widgetTop, target.y, availY),
  };
}

function isEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function sanitizeOverlayConfig(raw: unknown): VoiceOverlayConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const rawApps = Array.isArray(obj.apps) ? obj.apps : [];
  const apps: VoiceOverlayApp[] = [];
  const seen = new Set<string>();
  for (const item of rawApps) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.exe !== 'string') continue;
    const exe = normalizeOverlayExe(entry.exe);
    if (!exe || seen.has(exe)) continue;
    seen.add(exe);
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : exe;
    apps.push({ exe, label: label.slice(0, 120), enabled: entry.enabled !== false });
  }
  return {
    enabled: obj.enabled === true,
    preview: obj.preview === true,
    displayMode: isEnumValue(VOICE_OVERLAY_DISPLAY_MODES, obj.displayMode)
      ? obj.displayMode
      : 'always',
    nameMode: isEnumValue(VOICE_OVERLAY_NAME_MODES, obj.nameMode) ? obj.nameMode : 'always',
    avatarSize: isEnumValue(VOICE_OVERLAY_AVATAR_SIZES, obj.avatarSize)
      ? obj.avatarSize
      : 'compact',
    opacity:
      typeof obj.opacity === 'number' && Number.isFinite(obj.opacity)
        ? clamp(obj.opacity, 0.2, 1)
        : 0.85,
    anchorX:
      typeof obj.anchorX === 'number' && Number.isFinite(obj.anchorX)
        ? clamp(obj.anchorX, 0, 1)
        : 0.02,
    anchorY:
      typeof obj.anchorY === 'number' && Number.isFinite(obj.anchorY)
        ? clamp(obj.anchorY, 0, 1)
        : 0.04,
    apps,
  };
}

export function sanitizeOverlayState(raw: unknown): VoiceOverlayState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const rawParticipants = Array.isArray(obj.participants) ? obj.participants : [];
  const participants: VoiceOverlayParticipant[] = [];
  for (const item of rawParticipants.slice(0, 100)) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    const avatarUrl =
      typeof p.avatarUrl === 'string' && p.avatarUrl.startsWith('data:image/') ? p.avatarUrl : null;
    participants.push({
      id: p.id.slice(0, 200),
      name: p.name.slice(0, 120),
      avatarUrl,
      color: typeof p.color === 'string' ? p.color.slice(0, 32) : '#5865f2',
      initials: typeof p.initials === 'string' ? p.initials.slice(0, 4) : '?',
      speaking: p.speaking === true,
      muted: p.muted === true,
      deafened: p.deafened === true,
      local: p.local === true,
    });
  }
  return {
    inCall: obj.inCall === true,
    microphoneEnabled: obj.microphoneEnabled !== false,
    deafened: obj.deafened === true,
    participants,
  };
}
