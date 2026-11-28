<script lang="ts">
  import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
  import YarnIcon from 'phosphor-svelte/lib/YarnIcon';
  import ImagesIcon from 'phosphor-svelte/lib/ImagesIcon';
  import GridFourIcon from 'phosphor-svelte/lib/GridFourIcon';
  import TelevisionSimpleIcon from 'phosphor-svelte/lib/TelevisionSimpleIcon';
  import { i18n } from '#lib/i18n.js';
  import PanelHeaderButton from '#lib/ui/primitives/PanelHeaderButton.svelte';
  import type { RoomPanels } from './room-panels.svelte.js';

  interface Props {
    panels: RoomPanels;
    voiceView: boolean;
    direct: boolean;
    desktop: boolean;
    widgetCount: number;
    threadsUnread?: number;
    threadsOnly?: boolean;
    watchTogetherActive?: boolean;
    watchTogetherTitle?: string | null;
    onOpenWatchTogether?: () => void;
  }

  let {
    panels,
    voiceView,
    direct,
    desktop,
    widgetCount,
    threadsUnread = 0,
    threadsOnly = false,
    watchTogetherActive = false,
    watchTogetherTitle = null,
    onOpenWatchTogether,
  }: Props = $props();
</script>

{#if !voiceView}
  <PanelHeaderButton
    label={threadsUnread > 0
      ? i18n.t('timeline.threadsUnread', { count: threadsUnread })
      : i18n.t('timeline.threadsOpen')}
    aria-pressed={panels.threadsOpen}
    onclick={() => panels.toggleThreads()}
  >
    <YarnIcon weight={panels.threadsOpen ? 'fill' : 'regular'} />
    {#if threadsUnread > 0}
      <span class="threads-count" aria-hidden="true"
        >{threadsUnread > 99 ? '99+' : threadsUnread}</span
      >
    {/if}
  </PanelHeaderButton>
  {#if !threadsOnly && !direct}
    <PanelHeaderButton
      label={i18n.t('room.notificationsOpen')}
      aria-pressed={panels.notificationsOpen}
      onclick={() => panels.toggleNotifications()}
    >
      <TrayIcon weight={panels.notificationsOpen ? 'fill' : 'regular'} />
    </PanelHeaderButton>
  {/if}
  {#if !threadsOnly && desktop}
    <PanelHeaderButton
      label={i18n.t('timeline.attachmentsTitle')}
      aria-pressed={panels.attachmentsOpen}
      onclick={() => panels.toggleAttachments()}
    >
      <ImagesIcon weight={panels.attachmentsOpen ? 'fill' : 'regular'} />
    </PanelHeaderButton>
  {/if}
{/if}
{#if !threadsOnly}
  {#if watchTogetherActive && !panels.watchTogetherVisible && onOpenWatchTogether}
    <PanelHeaderButton
      class="watch-together-header-button"
      label={watchTogetherTitle
        ? `${i18n.t('widgets.watchTogether')}: ${watchTogetherTitle}`
        : i18n.t('widgets.watchTogetherActiveBanner')}
      onclick={onOpenWatchTogether}
    >
      <TelevisionSimpleIcon weight="fill" />
      <span class="watch-live-dot" aria-hidden="true"></span>
    </PanelHeaderButton>
  {/if}
  <PanelHeaderButton
    label={i18n.t('widgets.label')}
    aria-pressed={panels.widgetsOpen || panels.watchTogetherTheater || panels.watchTogetherMaximized}
    onclick={() => panels.toggleWidgets()}
  >
    <GridFourIcon
      weight={panels.widgetsOpen || panels.watchTogetherTheater || panels.watchTogetherMaximized
        ? 'fill'
        : 'regular'}
    />
    {#if widgetCount > 0}
      <span class="widgets-count" aria-hidden="true">{widgetCount}</span>
    {/if}
  </PanelHeaderButton>
{/if}

<style>
  :global(.watch-together-header-button) {
    position: relative;
  }

  .watch-live-dot {
    background: var(--primary-main);
    border-radius: var(--radius-pill);
    height: 0.5rem;
    inset-inline-end: var(--space-050);
    position: absolute;
    top: var(--space-050);
    width: 0.5rem;
  }

  .threads-count,
  .widgets-count {
    background: var(--surface-container-active);
    border-radius: var(--radius-pill);
    color: var(--surface-on-container);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    inset-inline-start: 0;
    line-height: 1;
    min-width: 1rem;
    padding: var(--space-050) var(--space-100);
    position: absolute;
    text-align: center;
    top: 0;
  }

  .threads-count {
    background: var(--primary-main);
    color: var(--primary-on-main);
  }
</style>
