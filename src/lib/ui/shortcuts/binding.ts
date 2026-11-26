import {
  applyModifierToken,
  formatStandaloneModifier,
  hasModifierFlags,
  isStandaloneModifierKey,
  matchesStandaloneModifier,
  MODIFIER_KEY_ALIASES,
  parsedBindingsConflict,
  promoteSingleModifierFlag,
  standaloneModifierFromEvent,
} from './modifier-binding.js';
import {
  MOUSE_DISPLAY_NAMES,
  MOUSE_KEY_ALIASES,
  mouseButtonForKey,
  type MouseEventLike,
} from './mouse-binding.js';

export {
  isStandaloneModifierKey,
  matchesStandaloneModifier,
  standaloneModifierFromEvent,
  type StandaloneModifierKey,
} from './modifier-binding.js';
export {
  bindingFromMouseEvent,
  suppressMouseButton,
  type MouseEventLike,
} from './mouse-binding.js';

const KEY_ALIASES: Record<string, string> = {
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  esc: 'escape',
  space: ' ',
  ...MOUSE_KEY_ALIASES,
  ...MODIFIER_KEY_ALIASES,
};

export interface ParsedBinding {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function parseBinding(binding: string): ParsedBinding {
  const tokens = binding
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const parsed: ParsedBinding = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };

  for (const token of tokens) {
    if (!applyModifierToken(parsed, token)) parsed.key = KEY_ALIASES[token] ?? token;
  }
  promoteSingleModifierFlag(parsed);

  return parsed;
}

const NUMPAD_KEYS: Record<string, string> = {
  Numpad0: 'num0',
  Numpad1: 'num1',
  Numpad2: 'num2',
  Numpad3: 'num3',
  Numpad4: 'num4',
  Numpad5: 'num5',
  Numpad6: 'num6',
  Numpad7: 'num7',
  Numpad8: 'num8',
  Numpad9: 'num9',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
};

export function isNumpadEvent(event: KeyboardEventLike): boolean {
  return event.code in NUMPAD_KEYS;
}

const PHYSICAL_KEY = /^(?:Key|Digit)([A-Z0-9])$/;

function eventKey(event: KeyboardEventLike): string {
  const numpad = NUMPAD_KEYS[event.code];
  if (numpad) return numpad;
  const key = event.key.toLowerCase();
  // macOS Option turns a letter into another character or a dead key, so the physical key names it.
  if (event.altKey && (key === 'dead' || (key.length === 1 && !/[a-z0-9]/.test(key)))) {
    const physical = PHYSICAL_KEY.exec(event.code)?.[1];
    if (physical) return physical.toLowerCase();
  }
  return key;
}

function isNamedKey(key: string): boolean {
  return key.length > 1;
}

export function isMouseBinding(binding: string): boolean {
  return mouseButtonForKey(parseBinding(binding).key) !== undefined;
}

export function isModifierBinding(binding: string): boolean {
  const parsed = parseBinding(binding);
  return !hasModifierFlags(parsed) && isStandaloneModifierKey(parsed.key);
}

function modifiersMatch(
  parsed: ParsedBinding,
  event: Pick<KeyboardEventLike, 'ctrlKey' | 'metaKey' | 'altKey'>,
  isMac: boolean
): boolean {
  return (
    event.ctrlKey === (parsed.ctrl || (parsed.mod && !isMac)) &&
    event.metaKey === (parsed.meta || (parsed.mod && isMac)) &&
    event.altKey === parsed.alt
  );
}

export function matchesBinding(binding: string, event: KeyboardEventLike, isMac: boolean): boolean {
  const parsed = parseBinding(binding);
  if (mouseButtonForKey(parsed.key) !== undefined) return false;
  if (!hasModifierFlags(parsed) && isStandaloneModifierKey(parsed.key)) {
    return matchesStandaloneModifier(parsed.key, event, isMac);
  }
  if (!modifiersMatch(parsed, event, isMac)) return false;
  if (isNamedKey(parsed.key) && event.shiftKey !== parsed.shift) return false;
  if (parsed.shift && !event.shiftKey) return false;

  return eventKey(event) === parsed.key;
}

export function matchesMouseBinding(
  binding: string,
  event: MouseEventLike,
  isMac: boolean
): boolean {
  const parsed = parseBinding(binding);
  const button = mouseButtonForKey(parsed.key);
  if (button === undefined || event.button !== button) return false;
  return modifiersMatch(parsed, event, isMac) && event.shiftKey === parsed.shift;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function isComposingKey(event: KeyboardEvent): boolean {
  // oxlint-disable-next-line typescript/no-deprecated -- the keydown that opens a composition only carries 229, isComposing is still false
  return event.isComposing || event.keyCode === 229;
}

export function isDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector('.dialog-content, [role="dialog"]') !== null;
}

export interface ConflictCandidate {
  id: string;
  binding: string;
}

export function findShortcutConflicts(
  candidates: readonly ConflictCandidate[],
  isMac: boolean
): Array<[ConflictCandidate, ConflictCandidate]> {
  const conflicts: Array<[ConflictCandidate, ConflictCandidate]> = [];

  for (const [i, a] of candidates.entries()) {
    if (a.binding === '') continue;
    const parsedA = parseBinding(a.binding);
    for (const b of candidates.slice(i + 1)) {
      if (b.binding !== '' && parsedBindingsConflict(parsedA, parseBinding(b.binding), isMac)) {
        conflicts.push([a, b]);
      }
    }
  }

  return conflicts;
}

const DISPLAY_KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Esc',
  numdec: 'Num .',
  numadd: 'Num +',
  numsub: 'Num -',
  nummult: 'Num *',
  numdiv: 'Num /',
  ...MOUSE_DISPLAY_NAMES,
};

export function formatBinding(binding: string, isMac: boolean): string {
  const parsed = parseBinding(binding);
  if (!hasModifierFlags(parsed) && isStandaloneModifierKey(parsed.key)) {
    return formatStandaloneModifier(parsed.key, isMac);
  }
  const parts: string[] = [];

  if (parsed.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.meta) parts.push(isMac ? '⌘' : 'Meta');
  if (parsed.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (parsed.shift) parts.push(isMac ? '⇧' : 'Shift');

  const keyName =
    DISPLAY_KEY_NAMES[parsed.key] ??
    (parsed.key.length === 1
      ? parsed.key.toUpperCase()
      : parsed.key.replace(/^num(\d)$/, 'Num $1'));
  parts.push(keyName);

  return parts.join('+');
}

const PROSEMIRROR_KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  escape: 'Escape',
};

export function toProseMirrorKey(binding: string): string {
  const parsed = parseBinding(binding);
  const parts: string[] = [];

  if (parsed.mod) parts.push('Mod');
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.meta) parts.push('Meta');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  parts.push(
    PROSEMIRROR_KEY_NAMES[parsed.key] ??
      (parsed.key.length === 1
        ? parsed.key
        : parsed.key.charAt(0).toUpperCase() + parsed.key.slice(1))
  );

  return parts.join('-');
}

export function bindingFromEvent(event: KeyboardEventLike, isMac: boolean): string | null {
  if (standaloneModifierFromEvent(event) !== null) return null;
  const key = eventKey(event);

  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('mod');
  if (isMac && event.ctrlKey) parts.push('ctrl');
  if (!isMac && event.metaKey) parts.push('meta');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);

  return parts.join('+');
}
