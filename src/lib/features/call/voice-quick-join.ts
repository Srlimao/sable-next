import type { RoomListItemView } from '#src/generated/protocol';
import { runtimeConfig } from '#lib/config/runtime-config.js';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { preferences } from '#lib/settings/preferences.svelte.js';

import { callServiceUrl } from './call-service-url.js';
import type { CallSession } from './call-session.svelte.js';

export type VoiceQuickJoinDeps = {
  core: Pick<CoreClient, 'rpc'>;
  call: Pick<CallSession, 'active' | 'lifecycle' | 'roomId' | 'switchTo'>;
  isViewingVoiceCallStage: (previousCallRoomId: string) => boolean;
  navigate: (href: string) => void;
};

/** Orchestrates Discord-style single-click joining for sidebar voice rooms. */
export class VoiceQuickJoin {
  readonly #core: VoiceQuickJoinDeps['core'];
  readonly #call: VoiceQuickJoinDeps['call'];
  readonly #isViewingVoiceCallStage: VoiceQuickJoinDeps['isViewingVoiceCallStage'];
  readonly #navigate: VoiceQuickJoinDeps['navigate'];
  #generation = 0;
  #pendingRoomId: string | null = null;

  constructor(deps: VoiceQuickJoinDeps) {
    this.#core = deps.core;
    this.#call = deps.call;
    this.#isViewingVoiceCallStage = deps.isViewingVoiceCallStage;
    this.#navigate = deps.navigate;
  }

  /** Cancel any in-flight preflight checks (e.g. on sidebar unmount). */
  cancel(): void {
    ++this.#generation;
    this.#pendingRoomId = null;
  }

  /**
   * Preflight rules and call support for `room`, then join or switch in place.
   * Navigates to `href` instead if already connecting/connected, double-clicked,
   * blocked by rules/permissions/focus, or if setup fails.
   */
  async join(room: RoomListItemView, href: string): Promise<void> {
    if (this.#call.active && this.#call.roomId === room.room_id) {
      this.#navigate(href);
      return;
    }
    if (this.#pendingRoomId === room.room_id) {
      this.#navigate(href);
      return;
    }

    const generation = ++this.#generation;
    this.#pendingRoomId = room.room_id;

    const fallbackUrl =
      callServiceUrl(preferences.callServiceUrl) ?? (await runtimeConfig()).calls.livekitServiceUrl;
    if (generation !== this.#generation) return;

    if (typeof RTCPeerConnection === 'undefined') {
      this.#pendingRoomId = null;
      this.#navigate(href);
      return;
    }

    const [rulesView, support] = await Promise.all([
      this.#core.rpc.room_state.rules({ room_id: room.room_id }).catch((error: unknown) => {
        console.debug('[sable call] rules unavailable', error);
        return null;
      }),
      this.#core.rpc.calls
        .support({ room_id: room.room_id, livekit_service_url: fallbackUrl })
        .catch((error: unknown) => {
          console.debug('[sable call] call support unavailable', error);
          return null;
        }),
    ]);
    if (generation !== this.#generation) return;

    const blockedByRules =
      rulesView !== null && rulesView.require_acceptance && !rulesView.accepted;
    const eligible =
      !blockedByRules &&
      support !== null &&
      support.can_join &&
      (support.has_focus || room.call_participants.length > 0);

    if (!eligible) {
      this.#pendingRoomId = null;
      this.#navigate(href);
      return;
    }

    const previousCallRoomId = this.#call.active ? this.#call.roomId : null;
    const followStage =
      previousCallRoomId !== null && this.#isViewingVoiceCallStage(previousCallRoomId);

    this.#pendingRoomId = null;
    if (followStage) {
      this.#navigate(href);
    }

    await this.#call.switchTo(
      room.room_id,
      { microphone: !preferences.callMicrophoneMuted, camera: false },
      fallbackUrl
    );

    if (
      generation === this.#generation &&
      this.#call.lifecycle === 'failed' &&
      this.#call.roomId === room.room_id
    ) {
      this.#navigate(href);
    }
  }
}
