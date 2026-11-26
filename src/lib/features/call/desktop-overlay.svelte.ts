import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { PeerProfiles } from '#lib/features/sidebar/peer-profiles.svelte.js';
import { electronBridge } from '#lib/platform/electron.js';
import {
  parseVoiceOverlayApps,
  type VoiceOverlayParticipant,
} from '#lib/platform/voice-overlay-types.js';
import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
import { loadMediaUrl } from '#lib/ui/media-url.js';
import { identityColor } from '#lib/ui/primitives/identity-color.js';
import { toInitials } from '#lib/ui/primitives/initials.js';
import { formatBinding } from '#lib/ui/shortcuts/binding.js';
import { effectiveShortcuts } from '#lib/ui/shortcuts/bindings.svelte.js';
import { isMacPlatform } from '#lib/ui/shortcuts/global-shortcuts.js';
import type { CallSession } from './call-session.svelte.js';
import { participantKeys } from './participant-keys.js';
import { voiceOverlayPreview } from './voice-overlay-preview.svelte.js';

const AVATAR_PX = 64;

const PREVIEW_PARTICIPANTS: VoiceOverlayParticipant[] = [
  {
    id: 'preview-1',
    name: 'Willow',
    avatarUrl: null,
    color: identityColor('@willow:sable.moe'),
    initials: 'W',
    speaking: true,
    muted: false,
    deafened: false,
    local: true,
  },
  {
    id: 'preview-2',
    name: 'Alex',
    avatarUrl: null,
    color: identityColor('@alex:sable.moe'),
    initials: 'A',
    speaking: false,
    muted: false,
    deafened: false,
    local: false,
  },
  {
    id: 'preview-3',
    name: 'Sam',
    avatarUrl: null,
    color: identityColor('@sam:sable.moe'),
    initials: 'S',
    speaking: false,
    muted: true,
    deafened: false,
    local: false,
  },
];

async function renderAvatarDataUrl(objectUrl: string): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, AVATAR_PX, AVATAR_PX);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function registerDesktopVoiceOverlay(session: CallSession, core: CoreClient): () => void {
  const bridge = electronBridge();
  if (
    !bridge?.voiceOverlayAvailable ||
    !bridge.updateVoiceOverlayConfig ||
    !bridge.updateVoiceOverlayState ||
    !bridge.onVoiceOverlayAction
  ) {
    return () => {};
  }

  const profiles = new PeerProfiles(core);
  const avatarDataUrls = new SvelteMap<string, string | null>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- request bookkeeping, never rendered from
  const pendingAvatars = new Set<string>();

  function avatarFor(mxc: string | null | undefined): string | null {
    if (!mxc || !mxc.startsWith('mxc://')) return null;
    const cached = avatarDataUrls.get(mxc);
    if (cached !== undefined) return cached;
    if (!pendingAvatars.has(mxc)) {
      pendingAvatars.add(mxc);
      void loadMediaUrl(core, mxc, AVATAR_PX, AVATAR_PX)
        .then(renderAvatarDataUrl)
        .then(
          (dataUrl) => avatarDataUrls.set(mxc, dataUrl),
          () => avatarDataUrls.set(mxc, null)
        );
    }
    return null;
  }

  return $effect.root(() => {
    const offActions = bridge.onVoiceOverlayAction?.((action) => {
      if (action.type === 'toggle-mute') void session.toggleMicrophone();
      else if (action.type === 'toggle-deafen') session.setDeafened(!session.deafened);
      else if (action.type === 'hang-up') void session.leave();
      else if (action.type === 'move') {
        setPreference('callVoiceOverlayAnchorX', action.anchorX);
        setPreference('callVoiceOverlayAnchorY', action.anchorY);
      }
    });

    $effect(() => {
      const binding = effectiveShortcuts().find(
        (item) => item.id === 'call.toggleOverlay'
      )?.binding;
      const shortcutLabel = binding ? formatBinding(binding, isMacPlatform()) : 'Shift+`';
      bridge.updateVoiceOverlayConfig?.(
        {
          enabled: preferences.callVoiceOverlay,
          preview: voiceOverlayPreview.active,
          displayMode: preferences.callVoiceOverlayDisplay,
          nameMode: preferences.callVoiceOverlayNames,
          avatarSize: preferences.callVoiceOverlayAvatarSize,
          opacity: preferences.callVoiceOverlayOpacity,
          anchorX: preferences.callVoiceOverlayAnchorX,
          anchorY: preferences.callVoiceOverlayAnchorY,
          apps: parseVoiceOverlayApps(preferences.callVoiceOverlayApps),
        },
        shortcutLabel
      );
    });

    $effect(() => {
      const inCall = session.active;
      const callParticipants: VoiceOverlayParticipant[] = inCall
        ? (() => {
            const ordered = [...session.members].sort((a, b) =>
              a.device_id.localeCompare(b.device_id)
            );
            const keys = participantKeys(ordered.map((m) => m.user_id));
            const selfUserId = core.session?.user_id;
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local deduplication inside effect
            const seen = new Set<string>();
            const list: VoiceOverlayParticipant[] = [];
            for (let index = 0; index < ordered.length; index += 1) {
              const member = ordered[index];
              const key = keys[index] ?? member.user_id;
              if (seen.has(member.user_id)) continue;
              seen.add(member.user_id);
              untrack(() => {
                profiles.request(member.user_id);
              });
              const profile = profiles.get(member.user_id);
              const voice = session.voiceStates.get(key);
              const name = profile?.display_name ?? member.user_id;
              list.push({
                id: member.user_id,
                name,
                avatarUrl: avatarFor(profile?.avatar_url),
                color: identityColor(member.user_id),
                initials: toInitials(name),
                speaking: voice?.speaking ?? false,
                muted: voice?.muted ?? true,
                deafened: voice?.deafened ?? false,
                local: member.user_id === selfUserId,
              });
            }
            return list;
          })()
        : [];
      const hasSpeaker = callParticipants.some((p) => p.speaking && !p.muted);
      const needsPreviewFallback =
        voiceOverlayPreview.active &&
        (!inCall ||
          callParticipants.length === 0 ||
          (preferences.callVoiceOverlayDisplay === 'speaking' && !hasSpeaker));
      const participants = needsPreviewFallback ? PREVIEW_PARTICIPANTS : callParticipants;

      bridge.updateVoiceOverlayState?.({
        inCall,
        microphoneEnabled: session.microphoneEnabled && !session.deafened,
        deafened: session.deafened,
        participants,
      });
    });

    return () => {
      offActions?.();
      bridge.updateVoiceOverlayConfig?.(
        {
          enabled: false,
          preview: false,
          displayMode: preferences.callVoiceOverlayDisplay,
          nameMode: preferences.callVoiceOverlayNames,
          avatarSize: preferences.callVoiceOverlayAvatarSize,
          opacity: preferences.callVoiceOverlayOpacity,
          anchorX: preferences.callVoiceOverlayAnchorX,
          anchorY: preferences.callVoiceOverlayAnchorY,
          apps: [],
        },
        'Shift+`'
      );
      bridge.updateVoiceOverlayState?.({
        inCall: false,
        microphoneEnabled: true,
        deafened: false,
        participants: [],
      });
    };
  });
}
