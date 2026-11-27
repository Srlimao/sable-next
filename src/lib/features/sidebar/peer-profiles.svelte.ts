import { SvelteMap } from 'svelte/reactivity';

import type { ProfileView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';

const MAX_PROFILES = 500;

export class PeerProfiles {
  #core: CoreClient;
  #profiles = new SvelteMap<string, ProfileView | null>();

  constructor(core: CoreClient) {
    this.#core = core;
  }

  get(userId: string): ProfileView | null | undefined {
    return this.#profiles.get(userId);
  }

  request(userId: string): void {
    if (this.#profiles.has(userId)) return;
    if (this.#profiles.size >= MAX_PROFILES) {
      const oldest = this.#profiles.keys().next().value;
      if (oldest !== undefined) this.#profiles.delete(oldest);
    }
    this.#profiles.set(userId, null);
    void this.#core.userProfile(userId).then(
      (profile) => {
        this.#profiles.set(userId, profile);
      },
      (error: unknown) => {
        console.debug('[sable nav] peer profile unavailable', error);
      }
    );
  }
}
