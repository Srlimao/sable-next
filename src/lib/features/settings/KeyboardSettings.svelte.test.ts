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

test('tapping Right Ctrl alone binds ctrlright on keyup', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Control',
      code: 'ControlRight',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(recorder).toHaveAttribute('aria-pressed', 'true');

  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Control',
      code: 'ControlRight',
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(bindingFor(first.id)).toBe('ctrlright');
  expect(recorder).toHaveAttribute('aria-pressed', 'false');
  expect(recorder).toHaveTextContent('Right Ctrl');
});

test('tapping Left Alt alone binds altleft on keyup', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Alt',
      code: 'AltLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Alt',
      code: 'AltLeft',
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(bindingFor(first.id)).toBe('altleft');
  expect(recorder).toHaveTextContent('Left Alt');
});

test('tapping Windows AltGr binds altright on keyup despite synthetic Left Ctrl events', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'AltGraph',
      code: 'AltRight',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: false,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(recorder).toHaveAttribute('aria-pressed', 'true');

  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'AltGraph',
      code: 'AltRight',
      ctrlKey: false,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(bindingFor(first.id)).toBe('altright');
  expect(recorder).toHaveTextContent('Right Alt');
});

test('pressing Ctrl+J still binds mod+j instead of ctrlleft', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'j',
      code: 'KeyJ',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(bindingFor(first.id)).toBe('mod+j');
});

test('pressing two modifiers without a regular key keeps recording active', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Shift',
      code: 'ShiftLeft',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Shift',
      code: 'ShiftLeft',
      ctrlKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: false,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(recorder).toHaveAttribute('aria-pressed', 'true');
});

test('holding Alt and clicking Mouse 4 binds alt+mouse4 instead of altleft', async () => {
  const user = userEvent.setup();
  render(KeyboardSettings);
  const [first] = SHORTCUTS;

  const [recorder] = screen.getAllByRole('button', { pressed: false });
  await user.click(recorder);

  recorder.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Alt',
      code: 'AltLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new MouseEvent('mousedown', {
      button: 3,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  window.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: 'Alt',
      code: 'AltLeft',
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
  expect(bindingFor(first.id)).toBe('alt+mouse4');
});
