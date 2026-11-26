// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { setPreference } from '#lib/settings/preferences.svelte.js';
import { voiceOverlayPreview } from './voice-overlay-preview.svelte.js';
import VoiceOverlaySettings from './VoiceOverlaySettings.svelte';

afterEach(() => {
  voiceOverlayPreview.active = false;
  setPreference('callVoiceOverlay', false);
  setPreference('callVoiceOverlayApps', '[]');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('adds running and manual apps, toggles them, and cleans up preview on unmount', async () => {
  const user = userEvent.setup();
  const toggleVoiceOverlayLock = vi.fn();
  vi.stubGlobal('sableElectron', {
    voiceOverlayAvailable: true,
    listVoiceOverlayApps: vi.fn(() =>
      Promise.resolve([{ exe: 'valorant-win64-shipping.exe', title: 'VALORANT', pid: 42 }])
    ),
    toggleVoiceOverlayLock,
  });
  setPreference('callVoiceOverlay', true);

  const { unmount } = render(VoiceOverlaySettings);

  await vi.waitFor(() => {
    expect(screen.getByText('VALORANT (valorant-win64-shipping.exe)')).toBeInTheDocument();
  });

  await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);
  expect(screen.getByText('VALORANT')).toBeInTheDocument();

  await user.type(screen.getByLabelText('Add executable manually'), 'cs2');
  await user.click(screen.getAllByRole('button', { name: 'Add' })[1]);
  expect(screen.getByText('cs2.exe')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Preview overlay' }));
  expect(voiceOverlayPreview.active).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Unlock & reposition' }));
  expect(toggleVoiceOverlayLock).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: 'Remove VALORANT' }));
  expect(screen.queryByText('VALORANT')).not.toBeInTheDocument();

  unmount();
  expect(voiceOverlayPreview.active).toBe(false);
});
