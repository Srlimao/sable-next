export const VOICE_OVERLAY_DISPLAY_MODES = ['always', 'speaking'] as const;
export type VoiceOverlayDisplayMode = (typeof VOICE_OVERLAY_DISPLAY_MODES)[number];

export const VOICE_OVERLAY_NAME_MODES = ['always', 'speaking', 'never'] as const;
export type VoiceOverlayNameMode = (typeof VOICE_OVERLAY_NAME_MODES)[number];

export const VOICE_OVERLAY_AVATAR_SIZES = ['compact', 'large'] as const;
export type VoiceOverlayAvatarSize = (typeof VOICE_OVERLAY_AVATAR_SIZES)[number];

export interface VoiceOverlayApp {
  exe: string;
  label: string;
  enabled: boolean;
}

export interface VoiceOverlayRunningApp {
  exe: string;
  title: string;
  pid: number;
}

export interface VoiceOverlayParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  initials: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  local: boolean;
}

export interface VoiceOverlayConfig {
  enabled: boolean;
  preview: boolean;
  displayMode: VoiceOverlayDisplayMode;
  nameMode: VoiceOverlayNameMode;
  avatarSize: VoiceOverlayAvatarSize;
  opacity: number;
  anchorX: number;
  anchorY: number;
  apps: VoiceOverlayApp[];
}

export interface VoiceOverlayState {
  inCall: boolean;
  microphoneEnabled: boolean;
  deafened: boolean;
  participants: VoiceOverlayParticipant[];
}

export type VoiceOverlayAction =
  | { type: 'toggle-mute' }
  | { type: 'toggle-deafen' }
  | { type: 'hang-up' }
  | { type: 'lock' }
  | { type: 'move'; anchorX: number; anchorY: number };

const INVALID_EXE_CHARS = /[<>:"|?*]/;

function hasInvalidExeChar(value: string): boolean {
  if (INVALID_EXE_CHARS.test(value)) return true;
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

export function normalizeOverlayExe(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return null;
  const parts = trimmed.split(/[/\\]/);
  const base = (parts.at(-1) ?? '').trim();
  if (!base || base === '.' || base === '..' || hasInvalidExeChar(base)) return null;
  const lower = base.toLowerCase();
  return lower.endsWith('.exe') ? lower : `${lower}.exe`;
}

export function parseVoiceOverlayApps(raw: string): VoiceOverlayApp[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const apps: VoiceOverlayApp[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.exe !== 'string') continue;
      const exe = normalizeOverlayExe(entry.exe);
      if (!exe || seen.has(exe)) continue;
      seen.add(exe);
      const label =
        typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : exe;
      apps.push({ exe, label, enabled: entry.enabled !== false });
    }
    return apps;
  } catch {
    return [];
  }
}
