// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/state', () => import('#lib/test-support/app-state.js'));
vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));
vi.mock('#lib/i18n.js', () => import('#lib/test-support/i18n.js'));

import { bindingFor, isRebound, resetAllBindings } from '#lib/ui/shortcuts/bindings.svelte.js';
import { SHORTCUTS } from '#lib/ui/shortcuts/shortcuts.js';
import KeyboardSettings from './KeyboardSettings.svelte';

afterEach(() => {
  resetAllBindings();
});

test('Escape while recording cancels it without binding Escape or reaching the dialog', async () => {
  const user = userEvent.setup();
  const dialogEscape = vi.fn();
  const listen = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dialogEscape();
  };
  document.addEventListener('keydown', listen);
  render(KeyboardSettings);

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);
  expect(recorder).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('{Escape}');

  expect(recorder).toHaveAttribute('aria-pressed', 'false');
  expect(dialogEscape).not.toHaveBeenCalled();
  expect(SHORTCUTS.some((shortcut) => isRebound(shortcut.id))).toBe(false);
  document.removeEventListener('keydown', listen);
});

test('removing a shortcut leaves it unbound until reset', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [remove] = screen.getAllByRole('button', { name: 'shortcuts.unbind' });
  await user.click(remove);

  expect(bindingFor(first.id)).toBe('');
  expect(screen.getByRole('button', { name: 'shortcuts.unbound' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'shortcuts.resetOne' }));
  expect(bindingFor(first.id)).toBe(first.binding);
});

test('recording a secondary mouse button binds it and suppresses follow-up mouse defaults', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);
  expect(recorder).toHaveAttribute('aria-pressed', 'true');

  const down = new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true });
  window.dispatchEvent(down);
  flushSync();
  expect(down.defaultPrevented).toBe(true);
  expect(bindingFor(first.id)).toBe('mouse4');
  expect(recorder).toHaveAttribute('aria-pressed', 'false');
  expect(recorder).toHaveTextContent('Mouse 4');

  const up = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true });
  window.dispatchEvent(up);
  expect(up.defaultPrevented).toBe(true);
});

test('recording ignores unmodified right click but accepts modified right click', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  const plainRight = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true });
  window.dispatchEvent(plainRight);
  flushSync();
  expect(plainRight.defaultPrevented).toBe(false);
  expect(recorder).toHaveAttribute('aria-pressed', 'true');

  const altRight = new MouseEvent('mousedown', {
    button: 2,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(altRight);
  flushSync();
  expect(altRight.defaultPrevented).toBe(true);
  expect(bindingFor(first.id)).toBe('alt+mouse2');
  expect(recorder).toHaveTextContent('Alt+Mouse Right');
});
