import { on } from 'svelte/events';

import {
  isComposingKey,
  isDialogOpen,
  isEditableTarget,
  matchesBinding,
  matchesMouseBinding,
  suppressMouseButton,
} from './binding.js';
import { effectiveShortcuts, shortcutCapture } from './bindings.svelte.js';
import { type ShortcutDefinition, type ShortcutId } from './shortcuts.js';

export type ShortcutEvent = KeyboardEvent | MouseEvent;

type ShortcutHandler =
  | ((event: ShortcutEvent) => void)
  | { press: (event: ShortcutEvent) => void; release: () => void };

export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

type HeldShortcut =
  | { kind: 'key'; event: KeyboardEvent; release: () => void }
  | { kind: 'mouse'; event: MouseEvent; release: () => void };

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function registerGlobalShortcuts(
  handlers: ShortcutHandlers,
  isEnabled: (shortcut: ShortcutDefinition) => boolean = () => true
): () => void {
  const held = new Map<ShortcutId, HeldShortcut>();

  const releaseAll = (): void => {
    const releases = [...held.values()];
    held.clear();
    for (const { release } of releases) release();
  };

  const offKeydown = on(window, 'keydown', (event) => {
    if (event.defaultPrevented || shortcutCapture.active) return;
    if (isComposingKey(event)) return;

    const isMac = isMacPlatform();

    for (const shortcut of effectiveShortcuts()) {
      const handler = handlers[shortcut.id];
      if (!handler || !isEnabled(shortcut)) continue;
      if (!shortcut.allowInEditable && isEditableTarget(event.target)) continue;
      if (
        typeof handler !== 'function' &&
        isEditableTarget(event.target) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      )
        continue;
      if (!matchesBinding(shortcut.binding, event, isMac)) continue;
      if (isDialogOpen()) return;

      event.preventDefault();
      if (typeof handler === 'function') handler(event);
      else if (!event.repeat && !held.has(shortcut.id)) {
        held.set(shortcut.id, { kind: 'key', event, release: handler.release });
        handler.press(event);
      }
      return;
    }
  });

  const offMousedown = on(window, 'mousedown', (event) => {
    if (event.defaultPrevented || event.button === 0 || shortcutCapture.active) return;

    const isMac = isMacPlatform();

    for (const shortcut of effectiveShortcuts()) {
      const handler = handlers[shortcut.id];
      if (!handler || !isEnabled(shortcut)) continue;
      if (!matchesMouseBinding(shortcut.binding, event, isMac)) continue;
      if (isDialogOpen()) return;

      event.preventDefault();
      suppressMouseButton(event.button);
      if (typeof handler === 'function') handler(event);
      else if (!held.has(shortcut.id)) {
        held.set(shortcut.id, { kind: 'mouse', event, release: handler.release });
        handler.press(event);
      }
      return;
    }
  });

  const offKeyup = on(
    window,
    'keyup',
    (event) => {
      for (const [id, press] of held) {
        const start = press.event;
        const releasedModifier =
          (start.ctrlKey && !event.ctrlKey) ||
          (start.metaKey && !event.metaKey) ||
          (start.altKey && !event.altKey) ||
          (start.shiftKey && !event.shiftKey);
        const releasedKey =
          press.kind === 'key' &&
          (press.event.code && event.code
            ? event.code === press.event.code
            : event.key.toLowerCase() === press.event.key.toLowerCase());
        if (releasedKey || releasedModifier) {
          held.delete(id);
          press.release();
        }
      }
    },
    { capture: true }
  );

  const offMouseup = on(
    window,
    'mouseup',
    (event) => {
      for (const [id, press] of held) {
        if (press.kind === 'mouse' && press.event.button === event.button) {
          held.delete(id);
          press.release();
        }
      }
    },
    { capture: true }
  );

  const offBlur = on(window, 'blur', releaseAll);
  const offVisibility = on(document, 'visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  return () => {
    offKeydown();
    offMousedown();
    offKeyup();
    offMouseup();
    offBlur();
    offVisibility();
    releaseAll();
  };
}
