import { afterEach, expect, test, vi } from 'vitest';

import { registerGlobalShortcuts } from './global-shortcuts';
import { rebind, resetAllBindings, shortcutCapture } from './bindings.svelte';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  document.body.replaceChildren();
  shortcutCapture.active = false;
  resetAllBindings();
  vi.restoreAllMocks();
});

function pressInEditor(key: string, init: KeyboardEventInit): void {
  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  document.body.append(editor);
  editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

test.each([
  ['ArrowUp', 'navigation.previousRoom'],
  ['ArrowDown', 'navigation.nextRoom'],
] as const)('alt+%s switches room from inside the composer', (key, id) => {
  const handler = vi.fn();
  cleanup = registerGlobalShortcuts({ [id]: handler });

  pressInEditor(key, { altKey: true });

  expect(handler).toHaveBeenCalledOnce();
});

test('a shortcut not allowed in editable fields stays out of the composer', () => {
  const handler = vi.fn();
  cleanup = registerGlobalShortcuts({ 'navigation.nextUnread': handler });

  pressInEditor('n', { altKey: true });

  expect(handler).not.toHaveBeenCalled();
});

test.each([
  ['ArrowUp', 'navigation.cyclePreviousUnread'],
  ['ArrowDown', 'navigation.cycleNextUnread'],
] as const)('alt+shift+%s switches unread rooms from inside the composer', (key, id) => {
  const handler = vi.fn();
  const previousRoom = vi.fn();
  const nextRoom = vi.fn();
  cleanup = registerGlobalShortcuts({
    [id]: handler,
    'navigation.previousRoom': previousRoom,
    'navigation.nextRoom': nextRoom,
  });

  pressInEditor(key, { altKey: true, shiftKey: true });

  expect(handler).toHaveBeenCalledOnce();
  expect(previousRoom).not.toHaveBeenCalled();
  expect(nextRoom).not.toHaveBeenCalled();
});

test('a shortcut does nothing while a dialog is open', () => {
  const handler = vi.fn();
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    altKey: true,
    bubbles: true,
    cancelable: true,
  });

  dialog.dispatchEvent(event);

  expect(handler).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

test('a shortcut handled by the focused field does not switch rooms', () => {
  const handler = vi.fn();
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });
  const input = document.createElement('input');
  input.addEventListener('keydown', (event) => {
    event.preventDefault();
  });
  document.body.append(input);
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  expect(handler).not.toHaveBeenCalled();
});

function holdShortcut() {
  const press = vi.fn();
  const release = vi.fn();
  cleanup = registerGlobalShortcuts({ 'call.pushToTalk': { press, release } });
  return { press, release };
}

function key(
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit = {},
  target: EventTarget = window
) {
  const event = new KeyboardEvent(type, {
    key: 'T',
    code: 'KeyT',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

test('push-to-talk ignores repeats and releases once', () => {
  const { press, release } = holdShortcut();
  expect(key('keydown').defaultPrevented).toBe(true);
  key('keydown', { repeat: true });
  expect(press).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
  key('keyup');
  key('keyup');
  expect(release).toHaveBeenCalledOnce();
});

test.each([
  { key: 'Control', code: 'ControlLeft', ctrlKey: false },
  { key: 'Shift', code: 'ShiftLeft', shiftKey: false },
])('releasing $key first ends the hold', (init) => {
  const { release } = holdShortcut();
  key('keydown');
  key('keyup', init);
  expect(release).toHaveBeenCalledOnce();
});

test('releasing an unrelated key leaves the hold active', () => {
  const { release } = holdShortcut();
  key('keydown');
  key('keyup', { key: 'x', code: 'KeyX' });
  expect(release).not.toHaveBeenCalled();
});

test.each(['blur', 'hidden', 'cleanup'] as const)('%s releases an active hold', (event) => {
  const { release } = holdShortcut();
  key('keydown');
  if (event === 'blur') window.dispatchEvent(new Event('blur'));
  else if (event === 'hidden') {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
  } else cleanup?.();
  key('keyup');
  expect(release).toHaveBeenCalledOnce();
});

test('keyup is handled even when a dialog opens and consumes the event', () => {
  const { release } = holdShortcut();
  key('keydown');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.addEventListener('keyup', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.append(dialog);
  key('keyup', {}, dialog);
  expect(release).toHaveBeenCalledOnce();
});

test('rebinding while held still releases the original key', () => {
  const { press, release } = holdShortcut();
  rebind('call.pushToTalk', 'alt+space');
  key('keydown', { key: ' ', code: 'Space', ctrlKey: false, shiftKey: false, altKey: true });
  expect(press).toHaveBeenCalledOnce();
  rebind('call.pushToTalk', 'alt+x');
  key('keyup', { key: ' ', code: 'Space', ctrlKey: false, shiftKey: false, altKey: true });
  expect(release).toHaveBeenCalledOnce();
});

test('unmodified hold shortcuts do not intercept typing', () => {
  const { press } = holdShortcut();
  rebind('call.pushToTalk', 'space');
  const input = document.createElement('textarea');
  document.body.append(input);
  const init = { key: ' ', code: 'Space', ctrlKey: false, shiftKey: false };
  expect(key('keydown', init, input).defaultPrevented).toBe(false);
  expect(press).not.toHaveBeenCalled();
  key('keydown', init);
  expect(press).toHaveBeenCalledOnce();
});

test('a dialog or composing event cannot start a hold', () => {
  const { press } = holdShortcut();
  key('keydown', { isComposing: true });
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  key('keydown');
  expect(press).not.toHaveBeenCalled();
});

test('a disabled shortcut leaves the key to the browser', () => {
  const handler = vi.fn();
  cleanup = registerGlobalShortcuts({ 'call.pushToTalk': handler }, () => false);

  const event = new KeyboardEvent('keydown', {
    key: 'T',
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
  });
  window.dispatchEvent(event);

  expect(handler).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

function mouse(
  type: 'mousedown' | 'mouseup' | 'auxclick' | 'contextmenu',
  init: MouseEventInit = {},
  target: EventTarget = window
) {
  const event = new MouseEvent(type, {
    button: 3,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

test('a secondary mouse button fires an action shortcut and suppresses follow-up mouse defaults', () => {
  const handler = vi.fn();
  const auxListener = vi.fn();
  document.addEventListener('auxclick', auxListener);
  rebind('navigation.nextRoom', 'mouse4');
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });

  expect(mouse('mousedown', { button: 3 }).defaultPrevented).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
  expect(mouse('mouseup', { button: 3 }).defaultPrevented).toBe(true);
  expect(mouse('auxclick', { button: 3 }, document.body).defaultPrevented).toBe(true);
  expect(auxListener).not.toHaveBeenCalled();

  document.removeEventListener('auxclick', auxListener);
});

test('a modified right-click shortcut suppresses the context menu', () => {
  const handler = vi.fn();
  const menuListener = vi.fn();
  document.addEventListener('contextmenu', menuListener);
  rebind('navigation.nextRoom', 'alt+mouse2');
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });

  expect(mouse('mousedown', { button: 2, altKey: true }).defaultPrevented).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
  expect(mouse('contextmenu', { button: 2, altKey: true }, document.body).defaultPrevented).toBe(
    true
  );
  expect(menuListener).not.toHaveBeenCalled();
  mouse('mouseup', { button: 2, altKey: true });

  document.removeEventListener('contextmenu', menuListener);
});

test('push-to-talk holds and releases on a secondary mouse button, including over editable fields', () => {
  const { press, release } = holdShortcut();
  rebind('call.pushToTalk', 'mouse4');
  const textarea = document.createElement('textarea');
  document.body.append(textarea);

  expect(mouse('mousedown', { button: 3 }, textarea).defaultPrevented).toBe(true);
  expect(press).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();

  mouse('mouseup', { button: 4 });
  expect(release).not.toHaveBeenCalled();

  mouse('mouseup', { button: 3 });
  expect(release).toHaveBeenCalledOnce();
});

test('releasing a required modifier ends a held mouse shortcut', () => {
  const { press, release } = holdShortcut();
  rebind('call.pushToTalk', 'alt+mouse4');

  mouse('mousedown', { button: 3, altKey: true });
  expect(press).toHaveBeenCalledOnce();

  key('keyup', { key: 'Alt', code: 'AltLeft', ctrlKey: false, shiftKey: false, altKey: false });
  expect(release).toHaveBeenCalledOnce();
  mouse('mouseup', { button: 3 });
});

test('active shortcut capture blocks global mouse and keyboard shortcuts', () => {
  const handler = vi.fn();
  rebind('navigation.nextRoom', 'mouse4');
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });
  shortcutCapture.active = true;

  expect(mouse('mousedown', { button: 3 }).defaultPrevented).toBe(false);
  expect(handler).not.toHaveBeenCalled();
});

test('push-to-talk holds and releases on Right Ctrl alone', () => {
  const { press, release } = holdShortcut();
  rebind('call.pushToTalk', 'ctrlright');

  expect(
    key('keydown', { key: 'Control', code: 'ControlRight', ctrlKey: true, shiftKey: false })
      .defaultPrevented
  ).toBe(true);
  expect(press).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();

  key('keyup', { key: 'x', code: 'KeyX', ctrlKey: true, shiftKey: false });
  expect(release).not.toHaveBeenCalled();

  key('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: true, shiftKey: false });
  expect(release).not.toHaveBeenCalled();

  key('keyup', { key: 'Control', code: 'ControlRight', ctrlKey: false, shiftKey: false });
  expect(release).toHaveBeenCalledOnce();
});

test('push-to-talk holds and releases on Windows AltGr (Right Alt)', () => {
  const { press, release } = holdShortcut();
  rebind('call.pushToTalk', 'altright');

  key('keydown', {
    key: 'AltGraph',
    code: 'AltRight',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
  });
  expect(press).toHaveBeenCalledOnce();

  key('keyup', {
    key: 'AltGraph',
    code: 'AltRight',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });
  expect(release).toHaveBeenCalledOnce();
});

test('action shortcut fires on Right Alt alone', () => {
  const handler = vi.fn();
  rebind('navigation.nextRoom', 'altright');
  cleanup = registerGlobalShortcuts({ 'navigation.nextRoom': handler });

  key('keydown', { key: 'Alt', code: 'AltRight', ctrlKey: false, altKey: true, shiftKey: false });
  expect(handler).toHaveBeenCalledOnce();
});

test('unmodified Shift hold shortcut does not intercept typing in editable fields', () => {
  const { press } = holdShortcut();
  rebind('call.pushToTalk', 'shiftleft');
  const textarea = document.createElement('textarea');
  document.body.append(textarea);

  const event = key(
    'keydown',
    { key: 'Shift', code: 'ShiftLeft', ctrlKey: false, shiftKey: true },
    textarea
  );
  expect(event.defaultPrevented).toBe(false);
  expect(press).not.toHaveBeenCalled();
});
