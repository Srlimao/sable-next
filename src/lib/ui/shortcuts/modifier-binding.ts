export type StandaloneModifierKey =
  | 'ctrl'
  | 'ctrlleft'
  | 'ctrlright'
  | 'alt'
  | 'altleft'
  | 'altright'
  | 'shift'
  | 'shiftleft'
  | 'shiftright'
  | 'meta'
  | 'metaleft'
  | 'metaright'
  | 'mod';

export type ResolvedStandaloneModifierKey = Exclude<StandaloneModifierKey, 'mod'>;

export interface ModifierEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ModifierFlagsLike {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export const MODIFIER_KEY_ALIASES: Readonly<Record<string, StandaloneModifierKey>> = {
  ctrlleft: 'ctrlleft',
  ctrl_left: 'ctrlleft',
  lctrl: 'ctrlleft',
  controlleft: 'ctrlleft',
  control_left: 'ctrlleft',
  lcontrol: 'ctrlleft',
  ctrlright: 'ctrlright',
  ctrl_right: 'ctrlright',
  rctrl: 'ctrlright',
  controlright: 'ctrlright',
  control_right: 'ctrlright',
  rcontrol: 'ctrlright',
  altleft: 'altleft',
  alt_left: 'altleft',
  lalt: 'altleft',
  optleft: 'altleft',
  opt_left: 'altleft',
  lopt: 'altleft',
  optionleft: 'altleft',
  option_left: 'altleft',
  loption: 'altleft',
  altright: 'altright',
  alt_right: 'altright',
  ralt: 'altright',
  altgr: 'altright',
  optright: 'altright',
  opt_right: 'altright',
  ropt: 'altright',
  optionright: 'altright',
  option_right: 'altright',
  roption: 'altright',
  shiftleft: 'shiftleft',
  shift_left: 'shiftleft',
  lshift: 'shiftleft',
  shiftright: 'shiftright',
  shift_right: 'shiftright',
  rshift: 'shiftright',
  metaleft: 'metaleft',
  meta_left: 'metaleft',
  lmeta: 'metaleft',
  cmdleft: 'metaleft',
  cmd_left: 'metaleft',
  lcmd: 'metaleft',
  commandleft: 'metaleft',
  command_left: 'metaleft',
  lcommand: 'metaleft',
  superleft: 'metaleft',
  super_left: 'metaleft',
  lsuper: 'metaleft',
  winleft: 'metaleft',
  win_left: 'metaleft',
  lwin: 'metaleft',
  metaright: 'metaright',
  meta_right: 'metaright',
  rmeta: 'metaright',
  cmdright: 'metaright',
  cmd_right: 'metaright',
  rcmd: 'metaright',
  commandright: 'metaright',
  command_right: 'metaright',
  rcommand: 'metaright',
  superright: 'metaright',
  super_right: 'metaright',
  rsuper: 'metaright',
  winright: 'metaright',
  win_right: 'metaright',
  rwin: 'metaright',
};

const STANDALONE_MODIFIER_KEYS = new Set<string>([
  'ctrl',
  'ctrlleft',
  'ctrlright',
  'alt',
  'altleft',
  'altright',
  'shift',
  'shiftleft',
  'shiftright',
  'meta',
  'metaleft',
  'metaright',
  'mod',
]);

const MODIFIER_FLAG_NAMES = ['mod', 'ctrl', 'meta', 'alt', 'shift'] as const;

export function isStandaloneModifierKey(key: string): key is StandaloneModifierKey {
  return STANDALONE_MODIFIER_KEYS.has(key);
}

export function hasModifierFlags(parsed: ModifierFlagsLike): boolean {
  return parsed.mod || parsed.ctrl || parsed.meta || parsed.alt || parsed.shift;
}

export function applyModifierToken(parsed: ModifierFlagsLike, token: string): boolean {
  switch (token) {
    case 'mod':
      parsed.mod = true;
      return true;
    case 'control':
    case 'ctrl':
      parsed.ctrl = true;
      return true;
    case 'meta':
    case 'cmd':
    case 'command':
      parsed.meta = true;
      return true;
    case 'alt':
    case 'option':
      parsed.alt = true;
      return true;
    case 'shift':
      parsed.shift = true;
      return true;
    default:
      return false;
  }
}

export function promoteSingleModifierFlag(parsed: ModifierFlagsLike): void {
  if (parsed.key !== '') return;
  let only: (typeof MODIFIER_FLAG_NAMES)[number] | null = null;
  for (const name of MODIFIER_FLAG_NAMES) {
    if (!parsed[name]) continue;
    if (only !== null) return;
    only = name;
  }
  if (only === null) return;
  parsed.key = only;
  parsed[only] = false;
}

const CODE_TO_MODIFIER: Readonly<Record<string, StandaloneModifierKey | undefined>> = {
  ControlLeft: 'ctrlleft',
  ControlRight: 'ctrlright',
  AltLeft: 'altleft',
  AltRight: 'altright',
  ShiftLeft: 'shiftleft',
  ShiftRight: 'shiftright',
  MetaLeft: 'metaleft',
  MetaRight: 'metaright',
};

const KEY_TO_MODIFIER: Readonly<Record<string, StandaloneModifierKey | undefined>> = {
  control: 'ctrl',
  alt: 'alt',
  altgraph: 'altright',
  shift: 'shift',
  meta: 'meta',
  os: 'meta',
};

export function standaloneModifierFromEvent(
  event: ModifierEventLike
): StandaloneModifierKey | null {
  return CODE_TO_MODIFIER[event.code] ?? KEY_TO_MODIFIER[event.key.toLowerCase()] ?? null;
}

export function resolveStandaloneModifier(
  key: StandaloneModifierKey,
  isMac: boolean
): ResolvedStandaloneModifierKey {
  if (key === 'mod') return isMac ? 'meta' : 'ctrl';
  return key;
}

export function matchesStandaloneModifier(
  key: StandaloneModifierKey,
  event: ModifierEventLike,
  isMac: boolean
): boolean {
  const target = resolveStandaloneModifier(key, isMac);
  const lowerKey = event.key.toLowerCase();
  const isAltGraph = lowerKey === 'altgraph';
  const hasCode = event.code !== '';

  switch (target) {
    case 'ctrlleft':
      return event.code === 'ControlLeft' && !event.metaKey && !event.altKey && !event.shiftKey;
    case 'ctrlright':
      return event.code === 'ControlRight' && !event.metaKey && !event.altKey && !event.shiftKey;
    case 'ctrl':
      return (
        (event.code === 'ControlLeft' ||
          event.code === 'ControlRight' ||
          (!hasCode && lowerKey === 'control')) &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      );
    case 'altleft':
      return event.code === 'AltLeft' && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    case 'altright':
      return (
        (event.code === 'AltRight' || (!hasCode && isAltGraph)) &&
        !event.metaKey &&
        !event.shiftKey &&
        (isAltGraph || !event.ctrlKey)
      );
    case 'alt':
      return (
        matchesStandaloneModifier('altleft', event, isMac) ||
        matchesStandaloneModifier('altright', event, isMac) ||
        (!hasCode && lowerKey === 'alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey)
      );
    case 'shiftleft':
      return event.code === 'ShiftLeft' && !event.ctrlKey && !event.metaKey && !event.altKey;
    case 'shiftright':
      return event.code === 'ShiftRight' && !event.ctrlKey && !event.metaKey && !event.altKey;
    case 'shift':
      return (
        (event.code === 'ShiftLeft' ||
          event.code === 'ShiftRight' ||
          (!hasCode && lowerKey === 'shift')) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      );
    case 'metaleft':
      return event.code === 'MetaLeft' && !event.ctrlKey && !event.altKey && !event.shiftKey;
    case 'metaright':
      return event.code === 'MetaRight' && !event.ctrlKey && !event.altKey && !event.shiftKey;
    case 'meta':
      return (
        (event.code === 'MetaLeft' ||
          event.code === 'MetaRight' ||
          (!hasCode && (lowerKey === 'meta' || lowerKey === 'os'))) &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      );
  }
}

export function formatStandaloneModifier(key: StandaloneModifierKey, isMac: boolean): string {
  switch (key) {
    case 'ctrl':
      return 'Ctrl';
    case 'ctrlleft':
      return 'Left Ctrl';
    case 'ctrlright':
      return 'Right Ctrl';
    case 'alt':
      return isMac ? '⌥' : 'Alt';
    case 'altleft':
      return isMac ? 'Left ⌥' : 'Left Alt';
    case 'altright':
      return isMac ? 'Right ⌥' : 'Right Alt';
    case 'shift':
      return isMac ? '⇧' : 'Shift';
    case 'shiftleft':
      return isMac ? 'Left ⇧' : 'Left Shift';
    case 'shiftright':
      return isMac ? 'Right ⇧' : 'Right Shift';
    case 'meta':
      return isMac ? '⌘' : 'Meta';
    case 'metaleft':
      return isMac ? 'Left ⌘' : 'Left Meta';
    case 'metaright':
      return isMac ? 'Right ⌘' : 'Right Meta';
    case 'mod':
      return isMac ? '⌘' : 'Ctrl';
  }
}

type ModifierGroup = 'ctrl' | 'alt' | 'shift' | 'meta';

function modifierGroup(key: ResolvedStandaloneModifierKey): ModifierGroup {
  if (key.startsWith('ctrl')) return 'ctrl';
  if (key.startsWith('alt')) return 'alt';
  if (key.startsWith('shift')) return 'shift';
  return 'meta';
}

export function standaloneModifiersConflict(
  a: StandaloneModifierKey,
  b: StandaloneModifierKey,
  isMac: boolean
): boolean {
  const ra = resolveStandaloneModifier(a, isMac);
  const rb = resolveStandaloneModifier(b, isMac);
  if (ra === rb) return true;
  const groupA = modifierGroup(ra);
  const groupB = modifierGroup(rb);
  if (groupA !== groupB) return false;
  return ra === groupA || rb === groupB;
}

function canonicalBindingKey(parsed: ModifierFlagsLike, isMac: boolean): string {
  const modifiers: string[] = [];
  if (parsed.ctrl || (parsed.mod && !isMac)) modifiers.push('ctrl');
  if (parsed.meta || (parsed.mod && isMac)) modifiers.push('meta');
  if (parsed.alt) modifiers.push('alt');
  if (parsed.shift) modifiers.push('shift');
  return [...modifiers, parsed.key].join('+');
}

export function parsedBindingsConflict(
  pa: ModifierFlagsLike,
  pb: ModifierFlagsLike,
  isMac: boolean
): boolean {
  if (
    !hasModifierFlags(pa) &&
    !hasModifierFlags(pb) &&
    isStandaloneModifierKey(pa.key) &&
    isStandaloneModifierKey(pb.key)
  ) {
    return standaloneModifiersConflict(pa.key, pb.key, isMac);
  }
  return canonicalBindingKey(pa, isMac) === canonicalBindingKey(pb, isMac);
}
