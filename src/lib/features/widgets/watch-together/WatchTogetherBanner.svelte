<script lang="ts">
  import TelevisionSimpleIcon from 'phosphor-svelte/lib/TelevisionSimpleIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  import { i18n } from '#lib/i18n.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';

  interface Props {
    title: string;
    playing: boolean;
    actorName: string | null;
    onJoin: () => void;
    onDismiss: () => void;
  }

  let { title, playing, actorName, onJoin, onDismiss }: Props = $props();
</script>

<div class="watch-banner" role="region" aria-label={i18n.t('widgets.watchTogetherActiveBanner')}>
  <div class="watch-banner-info">
    <TelevisionSimpleIcon class="watch-banner-icon" weight="fill" aria-hidden="true" />
    <span class={['watch-banner-dot', { playing }]} aria-hidden="true"></span>
    <span class="watch-banner-label">{i18n.t('widgets.watchTogetherActiveBanner')}</span>
    <span class="watch-banner-title" {title}>{title}</span>
    {#if actorName}
      <span class="watch-banner-actor">
        · {i18n.t('widgets.watchTogetherLastAction', { user: actorName })}
      </span>
    {/if}
  </div>
  <div class="watch-banner-actions">
    <Button variant="primary" size="small" onclick={onJoin}>
      {i18n.t('widgets.watchTogetherJoin')}
    </Button>
    <IconButton
      variant="ghost"
      size="small"
      label={i18n.t('widgets.watchTogetherDismissBanner')}
      onclick={onDismiss}
    >
      <XIcon />
    </IconButton>
  </div>
</div>

<style>
  .watch-banner {
    align-items: center;
    background: var(--bg-container);
    border-bottom: var(--border-width) solid var(--surface-container-line);
    color: var(--bg-on-container);
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-150);
    justify-content: space-between;
    min-width: 0;
    padding: var(--space-100) var(--space-250);
  }

  .watch-banner-info {
    align-items: center;
    display: flex;
    gap: var(--space-100);
    min-width: 0;
  }

  .watch-banner-info :global(.watch-banner-icon) {
    color: var(--primary-main);
    flex-shrink: 0;
  }

  .watch-banner-dot {
    background: var(--surface-var-on-container);
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    height: 0.5rem;
    width: 0.5rem;
  }

  .watch-banner-dot.playing {
    background: var(--primary-main);
  }

  .watch-banner-label {
    flex-shrink: 0;
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .watch-banner-title {
    color: var(--surface-on-container);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .watch-banner-actor {
    color: var(--surface-var-on-container);
    flex-shrink: 0;
    font-size: var(--font-size-small);
  }

  .watch-banner-actions {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: var(--space-050);
  }
</style>
