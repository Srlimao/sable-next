export interface MouseEventLike {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MOUSE_BUTTON_KEYS: Readonly<Record<number, string>> = {
  1: 'mouse3',
  2: 'mouse2',
  3: 'mouse4',
  4: 'mouse5',
};

const MOUSE_KEY_BUTTONS: Readonly<Record<string, number>> = {
  mouse2: 2,
  mouse3: 1,
  mouse4: 3,
  mouse5: 4,
};

export const MOUSE_KEY_ALIASES: Readonly<Record<string, string>> = {
  mouseright: 'mouse2',
  rightclick: 'mouse2',
  rmb: 'mouse2',
  mousemiddle: 'mouse3',
  middleclick: 'mouse3',
  mmb: 'mouse3',
  mousex1: 'mouse4',
  xbutton1: 'mouse4',
  mousex2: 'mouse5',
  xbutton2: 'mouse5',
};

export const MOUSE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  mouse2: 'Mouse Right',
  mouse3: 'Mouse Middle',
  mouse4: 'Mouse 4',
  mouse5: 'Mouse 5',
};

export function mouseButtonForKey(key: string): number | undefined {
  return MOUSE_KEY_BUTTONS[key];
}

export function bindingFromMouseEvent(event: MouseEventLike, isMac: boolean): string | null {
  const key = MOUSE_BUTTON_KEYS[event.button];
  if (!key) return null;

  const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  // Unmodified right-click stays reserved for context menus and is ignored by global mouse hooks.
  if (key === 'mouse2' && !hasModifier) return null;

  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('mod');
  if (isMac && event.ctrlKey) parts.push('ctrl');
  if (!isMac && event.metaKey) parts.push('meta');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key);

  return parts.join('+');
}

const suppressedButtons = new Map<number, ReturnType<typeof setTimeout> | null>();
let suppressionInstalled = false;

function clearSuppressed(): void {
  for (const timer of suppressedButtons.values()) {
    if (timer !== null) clearTimeout(timer);
  }
  suppressedButtons.clear();
}

function installSuppression(): void {
  if (suppressionInstalled || typeof window === 'undefined') return;
  suppressionInstalled = true;

  window.addEventListener(
    'mouseup',
    (event) => {
      if (!suppressedButtons.has(event.button)) return;
      event.preventDefault();
      const existing = suppressedButtons.get(event.button);
      if (existing !== null && existing !== undefined) clearTimeout(existing);
      const button = event.button;
      suppressedButtons.set(
        button,
        setTimeout(() => {
          suppressedButtons.delete(button);
        }, 0)
      );
    },
    { capture: true }
  );

  window.addEventListener(
    'auxclick',
    (event) => {
      if (!suppressedButtons.has(event.button)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true }
  );

  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!suppressedButtons.has(2)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true }
  );

  window.addEventListener('blur', clearSuppressed);
}

/**
 * Suppresses the follow-up mouseup, auxclick, and contextmenu defaults for a
 * secondary mouse button whose mousedown was consumed by a shortcut or capture.
 */
export function suppressMouseButton(button: number): void {
  installSuppression();
  const existing = suppressedButtons.get(button);
  if (existing !== null && existing !== undefined) clearTimeout(existing);
  suppressedButtons.set(button, null);
}
