<script lang="ts">
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
  import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon';

  import { i18n } from '#lib/i18n.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';

  import type { WatchTogetherItem } from './watch-together-protocol.js';

  interface Props {
    queue: readonly WatchTogetherItem[];
    canControl: boolean;
    adding: boolean;
    urlError: string | null;
    memberName: (userId: string) => string;
    onAddUrl: (url: string) => Promise<boolean>;
    onPlayItem: (itemId: string) => void;
    onMoveItem: (itemId: string, delta: -1 | 1) => void;
    onRemoveItem: (itemId: string) => void;
  }

  let {
    queue,
    canControl,
    adding,
    urlError,
    memberName,
    onAddUrl,
    onPlayItem,
    onMoveItem,
    onRemoveItem,
  }: Props = $props();

  let inputUrl = $state('');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed || adding || !canControl) return;
    const added = await onAddUrl(trimmed);
    if (added) inputUrl = '';
  }
</script>

<section class="queue-section" aria-label={i18n.t('widgets.watchTogetherQueue')}>
  {#if canControl}
    <form class="add-form" onsubmit={submit}>
      <TextInput
        bind:value={inputUrl}
        placeholder={i18n.t('widgets.watchTogetherUrlPlaceholder')}
        aria-label={i18n.t('widgets.watchTogetherUrlPlaceholder')}
      />
      <Button type="submit" variant="primary" size="small" loading={adding} disabled={!inputUrl.trim()}>
        <PlusIcon />
        {i18n.t('widgets.watchTogetherAdd')}
      </Button>
    </form>
  {:else}
    <p class="locked-note">{i18n.t('widgets.watchTogetherLockedHint')}</p>
  {/if}

  {#if urlError}
    <p class="url-error" role="alert">{urlError}</p>
  {/if}

  <div class="queue-header">
    <span>{i18n.t('widgets.watchTogetherUpNext')}</span>
    <span class="queue-count">{queue.length}</span>
  </div>

  {#if queue.length === 0}
    <p class="queue-empty">{i18n.t('widgets.watchTogetherQueueEmpty')}</p>
  {:else}
    <ul class="queue-list">
      {#each queue as item, index (item.id)}
        <li class="queue-item">
          <img class="thumb" src={item.thumbnailUrl} alt="" loading="lazy" />
          <div class="meta">
            <div class="title-row">
              <span class="title">{item.title}</span>
              {#if item.kind === 'live'}
                <span class="kind-tag live">{i18n.t('widgets.watchTogetherLive')}</span>
              {:else if item.kind === 'short'}
                <span class="kind-tag">{i18n.t('widgets.watchTogetherShort')}</span>
              {/if}
            </div>
            <span class="sub">
              {#if item.author}{item.author} · {/if}{i18n.t('widgets.watchTogetherAddedBy', {
                user: memberName(item.addedBy),
              })}
            </span>
          </div>
          {#if canControl}
            <div class="actions">
              <IconButton
                variant="ghost"
                size="small"
                label={i18n.t('widgets.watchTogetherPlay')}
                onclick={() => onPlayItem(item.id)}
              >
                <PlayIcon weight="fill" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="small"
                label={i18n.t('widgets.watchTogetherMoveUp')}
                disabled={index === 0}
                onclick={() => onMoveItem(item.id, -1)}
              >
                <ArrowUpIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="small"
                label={i18n.t('widgets.watchTogetherMoveDown')}
                disabled={index === queue.length - 1}
                onclick={() => onMoveItem(item.id, 1)}
              >
                <ArrowDownIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="small"
                label={i18n.t('widgets.watchTogetherRemoveItem')}
                onclick={() => onRemoveItem(item.id)}
              >
                <TrashIcon />
              </IconButton>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .queue-section {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-200);
    min-height: 0;
  }

  .add-form {
    display: grid;
    gap: var(--space-150);
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .locked-note,
  .queue-empty {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }

  .url-error {
    color: var(--error-main, var(--danger-main));
    font-size: var(--font-size-small);
    margin: 0;
  }

  .queue-header {
    align-items: center;
    color: var(--surface-var-on-container);
    display: flex;
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    justify-content: space-between;
  }

  .queue-count {
    background: var(--surface-container-active);
    border-radius: var(--radius-pill);
    padding: var(--space-050) var(--space-150);
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-150);
    list-style: none;
    margin: 0;
    overflow-y: auto;
    padding: 0;
  }

  .queue-item {
    align-items: center;
    background: var(--surface-container);
    border-radius: var(--radius-inner);
    display: grid;
    gap: var(--space-150);
    grid-template-columns: 4rem minmax(0, 1fr) auto;
    padding: var(--space-100);
  }

  .thumb {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-small, var(--radius-inner));
    object-fit: cover;
    width: 4rem;
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title-row {
    align-items: center;
    display: flex;
    gap: var(--space-100);
    min-width: 0;
  }

  .title {
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-semibold, 600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind-tag {
    background: var(--surface-container-active);
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    padding: var(--space-050) var(--space-100);
  }

  .kind-tag.live {
    background: var(--crit-container);
    color: var(--crit-on-container);
  }

  .sub {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: var(--space-050);
  }
</style>
