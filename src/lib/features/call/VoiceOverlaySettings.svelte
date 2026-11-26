<script lang="ts">
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
  import LockOpenIcon from 'phosphor-svelte/lib/LockOpenIcon';
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
  import { onDestroy, onMount } from 'svelte';

  import { i18n } from '#lib/i18n.js';
  import { electronBridge } from '#lib/platform/electron.js';
  import {
    normalizeOverlayExe,
    parseVoiceOverlayApps,
    type VoiceOverlayApp,
    type VoiceOverlayRunningApp,
  } from '#lib/platform/voice-overlay-types.js';
  import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import Select from '#lib/ui/primitives/Select.svelte';
  import Switch from '#lib/ui/primitives/Switch.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';
  import { formatBinding } from '#lib/ui/shortcuts/binding.js';
  import { effectiveShortcuts } from '#lib/ui/shortcuts/bindings.svelte.js';
  import { isMacPlatform } from '#lib/ui/shortcuts/global-shortcuts.js';
  import { voiceOverlayPreview } from './voice-overlay-preview.svelte.js';
  import '#lib/ui/primitives/settings-row.css';

  const bridge = electronBridge();
  let running = $state.raw<VoiceOverlayRunningApp[]>([]);
  let selectedRunning = $state('');
  let manualExe = $state('');
  let loadingApps = $state(false);

  let registered = $derived(parseVoiceOverlayApps(preferences.callVoiceOverlayApps));
  let registeredExes = $derived(new Set(registered.map((app) => app.exe)));
  let availableRunning = $derived(running.filter((app) => !registeredExes.has(app.exe)));
  let runningOptions = $derived(
    availableRunning.map((app) => ({
      value: app.exe,
      label: `${app.title} (${app.exe})`,
    }))
  );
  let shortcutText = $derived.by(() => {
    const binding = effectiveShortcuts().find((item) => item.id === 'call.toggleOverlay')?.binding;
    return binding ? formatBinding(binding, isMacPlatform()) : 'Shift+`';
  });

  $effect(() => {
    if (!preferences.callVoiceOverlay && voiceOverlayPreview.active) {
      voiceOverlayPreview.active = false;
    }
  });

  $effect(() => {
    if (availableRunning.length === 0) {
      selectedRunning = '';
      return;
    }
    if (!availableRunning.some((app) => app.exe === selectedRunning)) {
      selectedRunning = availableRunning[0]?.exe ?? '';
    }
  });

  async function refreshRunning(): Promise<void> {
    if (!bridge?.listVoiceOverlayApps) return;
    loadingApps = true;
    try {
      running = await bridge.listVoiceOverlayApps();
    } finally {
      loadingApps = false;
    }
  }

  function saveApps(next: VoiceOverlayApp[]): void {
    setPreference('callVoiceOverlayApps', JSON.stringify(next));
  }

  function addApp(exeRaw: string, labelRaw?: string): void {
    const exe = normalizeOverlayExe(exeRaw);
    if (!exe || registeredExes.has(exe)) return;
    const label = labelRaw?.trim() || exe;
    saveApps([...registered, { exe, label, enabled: true }]);
  }

  function addSelectedRunning(): void {
    const match = availableRunning.find((app) => app.exe === selectedRunning);
    if (!match) return;
    addApp(match.exe, match.title);
  }

  function addManual(): void {
    const exe = normalizeOverlayExe(manualExe);
    if (!exe) return;
    addApp(exe, exe);
    manualExe = '';
  }

  function toggleApp(exe: string, enabled: boolean): void {
    saveApps(registered.map((app) => (app.exe === exe ? { ...app, enabled } : app)));
  }

  function removeApp(exe: string): void {
    saveApps(registered.filter((app) => app.exe !== exe));
  }

  onMount(() => {
    void refreshRunning();
  });

  onDestroy(() => {
    voiceOverlayPreview.active = false;
  });
</script>

<div class="settings-form overlay-panel">
  <div class="preview-bar">
    <Button
      variant={voiceOverlayPreview.active ? 'primary' : 'secondary'}
      size="small"
      disabled={!preferences.callVoiceOverlay}
      onclick={() => {
        voiceOverlayPreview.active = !voiceOverlayPreview.active;
      }}
    >
      {i18n.t(
        voiceOverlayPreview.active
          ? 'settings.callVoiceOverlayStopPreview'
          : 'settings.callVoiceOverlayPreview'
      )}
    </Button>
    {#if voiceOverlayPreview.active && bridge?.toggleVoiceOverlayLock}
      <Button
        variant="secondary"
        size="small"
        onclick={() => {
          bridge?.toggleVoiceOverlayLock?.();
        }}
      >
        <LockOpenIcon aria-hidden="true" />
        {i18n.t('settings.callVoiceOverlayUnlock')}
      </Button>
    {/if}
  </div>
  <p class="hint">{i18n.t('settings.callVoiceOverlayShortcutHint', { shortcut: shortcutText })}</p>

  <div class="apps-header" id="call-overlay-apps">
    <div>
      <h3>{i18n.t('settings.callVoiceOverlayAppsTitle')}</h3>
      <p class="settings-description">{i18n.t('settings.callVoiceOverlayAppsHint')}</p>
    </div>
  </div>

  <div class="picker-row">
    <div class="picker-select">
      {#if runningOptions.length > 0}
        <Select
          items={runningOptions}
          bind:value={selectedRunning}
          forceDropdown
          aria-label={i18n.t('settings.callVoiceOverlayRunningApps')}
        />
      {:else}
        <p class="hint">{i18n.t('settings.callVoiceOverlayNoRunningApps')}</p>
      {/if}
    </div>
    <IconButton
      variant="ghost"
      size="small"
      label={i18n.t('settings.callVoiceOverlayRefreshApps')}
      disabled={loadingApps}
      onclick={() => void refreshRunning()}
    >
      <ArrowsClockwiseIcon />
    </IconButton>
    <Button
      variant="secondary"
      size="small"
      disabled={!selectedRunning}
      onclick={addSelectedRunning}
    >
      <PlusIcon aria-hidden="true" />
      {i18n.t('settings.callVoiceOverlayAdd')}
    </Button>
  </div>

  <form
    class="manual-row"
    onsubmit={(event) => {
      event.preventDefault();
      addManual();
    }}
  >
    <TextInput
      bind:value={manualExe}
      placeholder={i18n.t('settings.callVoiceOverlayAddExePlaceholder')}
      aria-label={i18n.t('settings.callVoiceOverlayAddExeLabel')}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <Button
      type="submit"
      variant="secondary"
      size="small"
      disabled={!normalizeOverlayExe(manualExe)}
    >
      <PlusIcon aria-hidden="true" />
      {i18n.t('settings.callVoiceOverlayAdd')}
    </Button>
  </form>

  {#if registered.length === 0}
    <p class="hint">{i18n.t('settings.callVoiceOverlayNoRegisteredApps')}</p>
  {:else}
    <ul class="apps-list">
      {#each registered as app (app.exe)}
        <li class="app-row">
          <div class="app-info">
            <span class="app-label">{app.label}</span>
            {#if app.label !== app.exe}
              <span class="app-exe">{app.exe}</span>
            {/if}
          </div>
          <div class="app-actions">
            <Switch
              checked={app.enabled}
              label={i18n.t('settings.callVoiceOverlayToggleApp', { name: app.label })}
              onCheckedChange={(checked) => toggleApp(app.exe, checked)}
            />
            <IconButton
              variant="ghost"
              size="small"
              label={i18n.t('settings.callVoiceOverlayRemoveApp', { name: app.label })}
              onclick={() => removeApp(app.exe)}
            >
              <TrashIcon />
            </IconButton>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .overlay-panel {
    padding: var(--space-150) var(--space-400) var(--space-300);
  }

  .preview-bar,
  .picker-row,
  .manual-row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
  }

  .picker-select {
    flex: 1 1 12rem;
    min-inline-size: 0;
  }

  .manual-row :global(.text-input-root),
  .manual-row :global(input) {
    flex: 1 1 12rem;
  }

  .apps-list {
    display: grid;
    gap: var(--space-100);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .app-row {
    align-items: center;
    background: var(--surface-container-low);
    border: var(--border-width) solid var(--bg-container-line);
    border-radius: var(--radii-300);
    display: flex;
    gap: var(--space-200);
    justify-content: space-between;
    padding: var(--space-150) var(--space-200);
  }

  .app-info {
    display: grid;
    min-inline-size: 0;
  }

  .app-label {
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-exe {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-actions {
    align-items: center;
    display: flex;
    flex: none;
    gap: var(--space-150);
  }
</style>
