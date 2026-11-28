<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { i18n } from '#lib/i18n.js';
  import {
    ensureWatchTogetherRoomWidget,
    type WatchTogetherSession,
  } from '#lib/features/widgets/watch-together/watch-together-session.svelte.js';
  import WidgetsPanel from '#lib/features/widgets/WidgetsPanel.svelte';
  import type { RoomMemberLoader } from '#lib/rooms/room-members.svelte.js';
  import DialogFrame from '#lib/ui/primitives/DialogFrame.svelte';
  import { toasts } from '#lib/ui/toasts.svelte.js';
  import type { RoomPanels } from './room-panels.svelte.js';
  import type { RoomSession } from './room-session.svelte.js';

  interface Props {
    panels: RoomPanels;
    roomId: string;
    desktop: boolean;
    memberLoader: RoomMemberLoader;
    roomSession: RoomSession;
    canManage: boolean;
    watchTogetherSession: WatchTogetherSession;
  }

  let {
    panels,
    roomId,
    desktop,
    memberLoader,
    roomSession,
    canManage,
    watchTogetherSession,
  }: Props = $props();
  const core = useCoreClient();

  let ownMember = $derived(
    memberLoader.members.find((member) => member.user_id === core.session?.user_id) ?? null
  );

  function closeWidgets(): void {
    panels.widgetsOpen = false;
  }

  async function addWidget(name: string, url: string): Promise<void> {
    try {
      await roomSession.details.addWidget(name, url);
    } catch (error) {
      console.warn('[sable room] add widget failed', error);
      toasts.error(i18n.t('errors.actionFailed'));
    }
  }

  async function removeWidget(widgetId: string): Promise<void> {
    try {
      await roomSession.details.removeWidget(widgetId);
    } catch (error) {
      console.warn('[sable room] remove widget failed', error);
      toasts.error(i18n.t('errors.actionFailed'));
    }
  }

  async function ensureWatchWidget(fallbackUrl: string): Promise<void> {
    await ensureWatchTogetherRoomWidget({
      core,
      roomId,
      canManage,
      widgets: roomSession.widgets,
      title: i18n.t('widgets.watchTogether'),
      fallbackUrl,
      refreshWidgets: () => roomSession.details.refreshWidgets(),
    });
  }
</script>

{#snippet panel(modal: boolean)}
  <WidgetsPanel
    {roomId}
    widgets={roomSession.widgets}
    userId={core.session?.user_id ?? ''}
    displayName={ownMember?.display_name ?? core.session?.user_id ?? ''}
    avatarUrl={ownMember?.avatar_url ?? ''}
    {canManage}
    members={memberLoader.members}
    {modal}
    {watchTogetherSession}
    openWatchTogether={panels.watchTogetherActive}
    pendingWatchUrl={panels.pendingWatchUrl}
    onConsumePendingWatchUrl={() => panels.consumePendingWatchUrl()}
    onWatchTogetherOpened={() => panels.clearWatchTogetherOpen()}
    onWatchTogetherVisibilityChange={(open) => panels.setWatchTogetherDockedOpen(open)}
    onToggleTheater={desktop ? () => panels.toggleWatchTogetherTheater() : undefined}
    onToggleMaximize={() => panels.toggleWatchTogetherMaximized()}
    onEnsureWatchWidget={ensureWatchWidget}
    onClose={closeWidgets}
    onAdd={addWidget}
    onRemove={removeWidget}
  />
{/snippet}

{#if desktop}
  {#if panels.widgetsOpen}
    {@render panel(false)}
  {/if}
{:else}
  <DialogFrame
    open={panels.widgetsOpen}
    onOpenChange={(open: boolean) => {
      if (!open) closeWidgets();
    }}
    variant="drawer"
  >
    {@render panel(true)}
  </DialogFrame>
{/if}
