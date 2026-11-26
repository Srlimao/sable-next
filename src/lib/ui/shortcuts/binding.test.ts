import { describe, expect, test } from 'vitest';

import {
  bindingFromEvent,
  bindingFromMouseEvent,
  findShortcutConflicts,
  formatBinding,
  isEditableTarget,
  isDialogOpen,
  isModifierBinding,
  isMouseBinding,
  matchesBinding,
  matchesMouseBinding,
  parseBinding,
  standaloneModifierFromEvent,
  toProseMirrorKey,
} from './binding';

function event(overrides: Partial<Parameters<typeof matchesBinding>[1]> = {}) {
  return {
    key: 'a',
    code: 'KeyA',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function mouseEvent(overrides: Partial<Parameters<typeof matchesMouseBinding>[1]> = {}) {
  return {
    button: 3,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

test('parses a plain key with no modifiers', () => {
  expect(parseBinding('f')).toEqual({
    key: 'f',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
});

test('parses combined modifiers', () => {
  expect(parseBinding('mod+shift+n')).toEqual({
    key: 'n',
    mod: true,
    ctrl: false,
    meta: false,
    alt: false,
    shift: true,
  });
});

test('resolves aliases for arrow and space keys', () => {
  expect(parseBinding('alt+shift+down').key).toBe('arrowdown');
  expect(parseBinding('space').key).toBe(' ');
});

test('mod matches ctrl on non-mac platforms', () => {
  expect(matchesBinding('mod+k', event({ key: 'k', ctrlKey: true }), false)).toBe(true);
  expect(matchesBinding('mod+k', event({ key: 'k', metaKey: true }), false)).toBe(false);
});

test('mod matches meta on mac', () => {
  expect(matchesBinding('mod+k', event({ key: 'k', metaKey: true }), true)).toBe(true);
  expect(matchesBinding('mod+k', event({ key: 'k', ctrlKey: true }), true)).toBe(false);
});

test('an unrelated modifier held down blocks the match', () => {
  expect(matchesBinding('mod+k', event({ key: 'k', ctrlKey: true, altKey: true }), false)).toBe(
    false
  );
});

test('a letter binding ignores shiftKey, since the reported key already reflects it', () => {
  expect(matchesBinding('mod+f', event({ key: 'f', ctrlKey: true, shiftKey: true }), false)).toBe(
    true
  );
});

test('mod+shift+n matches the uppercase key browsers report for it', () => {
  expect(
    matchesBinding('mod+shift+n', event({ key: 'N', ctrlKey: true, shiftKey: true }), false)
  ).toBe(true);
});

test('a shifted letter binding does not match the unshifted key', () => {
  expect(matchesBinding('mod+shift+v', event({ key: 'v', ctrlKey: true }), false)).toBe(false);
  expect(
    matchesBinding('mod+shift+v', event({ key: 'V', ctrlKey: true, shiftKey: true }), false)
  ).toBe(true);
});

test('a named key binding requires an exact shiftKey match', () => {
  expect(matchesBinding('alt+shift+down', event({ key: 'ArrowDown', altKey: true }), false)).toBe(
    false
  );
  expect(
    matchesBinding(
      'alt+shift+down',
      event({ key: 'ArrowDown', altKey: true, shiftKey: true }),
      false
    )
  ).toBe(true);
});

test('a plain text input is editable', () => {
  const input = document.createElement('input');
  document.body.append(input);
  expect(isEditableTarget(input)).toBe(true);
  input.remove();
});

test('a contenteditable div is editable', () => {
  const div = document.createElement('div');
  div.contentEditable = 'true';
  document.body.append(div);
  expect(isEditableTarget(div)).toBe(true);
  div.remove();
});

test('a plain button is not editable', () => {
  const button = document.createElement('button');
  expect(isEditableTarget(button)).toBe(false);
});

test('a null target is not editable', () => {
  expect(isEditableTarget(null)).toBe(false);
});

test('no dialog open reports false', () => {
  expect(isDialogOpen(document)).toBe(false);
});

test('an open dialog is detected by its content class', () => {
  const dialog = document.createElement('div');
  dialog.className = 'dialog-content';
  document.body.append(dialog);
  expect(isDialogOpen(document)).toBe(true);
  dialog.remove();
});

test('an overlay that only carries the dialog role is detected', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  expect(isDialogOpen(document)).toBe(true);
  dialog.remove();
});

test('identical bindings conflict', () => {
  const conflicts = findShortcutConflicts(
    [
      { id: 'a', binding: 'mod+shift+n' },
      { id: 'b', binding: 'shift+mod+n' },
    ],
    false
  );

  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.[0].id).toBe('a');
  expect(conflicts[0]?.[1].id).toBe('b');
});

test('mod resolves to the platform modifier before comparing', () => {
  const conflicts = findShortcutConflicts(
    [
      { id: 'a', binding: 'mod+k' },
      { id: 'b', binding: 'ctrl+k' },
    ],
    false
  );

  expect(conflicts).toHaveLength(1);
});

test('unbound shortcuts never conflict', () => {
  const conflicts = findShortcutConflicts(
    [
      { id: 'a', binding: '' },
      { id: 'b', binding: '' },
    ],
    false
  );

  expect(conflicts).toHaveLength(0);
});

test('formats a mac binding with symbols', () => {
  expect(formatBinding('mod+shift+n', true)).toBe('⌘+⇧+N');
});

test('formats a non-mac binding with words', () => {
  expect(formatBinding('mod+shift+n', false)).toBe('Ctrl+Shift+N');
});

test('formats named keys by their display label', () => {
  expect(formatBinding('alt+shift+down', false)).toBe('Alt+Shift+Down');
});

test('turns an event into a binding the parser round-trips', () => {
  expect(bindingFromEvent(event({ key: 'K', ctrlKey: true, shiftKey: true }), false)).toBe(
    'mod+shift+k'
  );
  expect(bindingFromEvent(event({ key: 'K', metaKey: true }), true)).toBe('mod+k');
  expect(
    matchesBinding('mod+shift+k', event({ key: 'k', ctrlKey: true, shiftKey: true }), false)
  ).toBe(true);
});

test('reports a modifier-only event as unbindable', () => {
  expect(bindingFromEvent(event({ key: 'Shift', shiftKey: true }), false)).toBeNull();
});

test('keeps a mac control press distinct from the command modifier', () => {
  expect(bindingFromEvent(event({ key: 'p', ctrlKey: true }), true)).toBe('ctrl+p');
});

test('keeps numpad keys apart from their main-row twins', () => {
  const numpadDot = event({ key: '.', code: 'NumpadDecimal' });
  expect(bindingFromEvent(numpadDot, false)).toBe('numdec');
  expect(matchesBinding('numdec', numpadDot, false)).toBe(true);
  expect(matchesBinding('.', numpadDot, false)).toBe(false);
  expect(matchesBinding('numdec', event({ key: '.', code: 'Period' }), false)).toBe(false);
});

test('formats numpad keys', () => {
  expect(formatBinding('numdec', false)).toBe('Num .');
  expect(formatBinding('mod+num7', false)).toBe('Ctrl+Num 7');
});

describe('toProseMirrorKey', () => {
  test.each([
    ['mod+b', 'Mod-b'],
    ['mod+shift+8', 'Mod-Shift-8'],
    ['alt+up', 'Alt-ArrowUp'],
    ['ctrl+shift+escape', 'Ctrl-Shift-Escape'],
    ['mod+space', 'Mod-Space'],
  ])('%s -> %s', (binding, expected) => {
    expect(toProseMirrorKey(binding)).toBe(expected);
  });
});

test('Option on macOS still matches and records the letter it was pressed with', () => {
  const optionM = event({ key: 'µ', code: 'KeyM', altKey: true });
  const optionN = event({ key: 'Dead', code: 'KeyN', altKey: true });
  const optionShiftC = event({ key: 'Ç', code: 'KeyC', altKey: true, shiftKey: true });
  expect(matchesBinding('alt+m', optionM, true)).toBe(true);
  expect(matchesBinding('alt+n', optionN, true)).toBe(true);
  expect(matchesBinding('alt+shift+c', optionShiftC, true)).toBe(true);
  expect(bindingFromEvent(optionM, true)).toBe('alt+m');
});

test('Alt keeps the letter the layout types when it differs from the physical key', () => {
  const azertyA = event({ key: 'a', code: 'KeyQ', altKey: true });
  expect(matchesBinding('alt+a', azertyA, false)).toBe(true);
  expect(matchesBinding('alt+q', azertyA, false)).toBe(false);
});

describe('secondary mouse button bindings', () => {
  test('parses mouse button aliases to canonical tokens', () => {
    expect(parseBinding('mousemiddle').key).toBe('mouse3');
    expect(parseBinding('mouseright').key).toBe('mouse2');
    expect(parseBinding('mousex1').key).toBe('mouse4');
    expect(parseBinding('xbutton2').key).toBe('mouse5');
    expect(isMouseBinding('mouse4')).toBe(true);
    expect(isMouseBinding('alt+mouse2')).toBe(true);
    expect(isMouseBinding('mod+k')).toBe(false);
  });

  test('matches secondary mouse buttons and their modifiers', () => {
    expect(matchesMouseBinding('mouse3', mouseEvent({ button: 1 }), false)).toBe(true);
    expect(matchesMouseBinding('mouse4', mouseEvent({ button: 3 }), false)).toBe(true);
    expect(matchesMouseBinding('mouse5', mouseEvent({ button: 4 }), false)).toBe(true);
    expect(matchesMouseBinding('mouse4', mouseEvent({ button: 4 }), false)).toBe(false);
    expect(matchesMouseBinding('mouse4', mouseEvent({ button: 3, altKey: true }), false)).toBe(
      false
    );
    expect(matchesMouseBinding('mod+mouse4', mouseEvent({ button: 3, ctrlKey: true }), false)).toBe(
      true
    );
    expect(matchesMouseBinding('mod+mouse4', mouseEvent({ button: 3, metaKey: true }), true)).toBe(
      true
    );
    expect(matchesMouseBinding('alt+mouse2', mouseEvent({ button: 2, altKey: true }), false)).toBe(
      true
    );
    expect(matchesMouseBinding('mod+k', mouseEvent({ button: 3, ctrlKey: true }), false)).toBe(
      false
    );
    expect(matchesBinding('mouse4', event({ key: 'mouse4', code: '' }), false)).toBe(false);
    expect(matchesBinding('mouse4', event({ key: 'a', code: 'KeyA' }), false)).toBe(false);
  });

  test('records secondary mouse buttons while rejecting primary and unmodified right clicks', () => {
    expect(bindingFromMouseEvent(mouseEvent({ button: 0 }), false)).toBeNull();
    expect(bindingFromMouseEvent(mouseEvent({ button: 0, ctrlKey: true }), false)).toBeNull();
    expect(bindingFromMouseEvent(mouseEvent({ button: 2 }), false)).toBeNull();
    expect(bindingFromMouseEvent(mouseEvent({ button: 2, altKey: true }), false)).toBe(
      'alt+mouse2'
    );
    expect(bindingFromMouseEvent(mouseEvent({ button: 1 }), false)).toBe('mouse3');
    expect(bindingFromMouseEvent(mouseEvent({ button: 3 }), false)).toBe('mouse4');
    expect(
      bindingFromMouseEvent(mouseEvent({ button: 4, ctrlKey: true, shiftKey: true }), false)
    ).toBe('mod+shift+mouse5');
    expect(bindingFromMouseEvent(mouseEvent({ button: 3, metaKey: true }), true)).toBe(
      'mod+mouse4'
    );
  });

  test('formats mouse bindings for display and detects conflicts across aliases', () => {
    expect(formatBinding('mouse3', false)).toBe('Mouse Middle');
    expect(formatBinding('alt+mouse2', false)).toBe('Alt+Mouse Right');
    expect(formatBinding('mod+mouse4', false)).toBe('Ctrl+Mouse 4');
    expect(formatBinding('mod+shift+mouse5', true)).toBe('⌘+⇧+Mouse 5');

    const conflicts = findShortcutConflicts(
      [
        { id: 'a', binding: 'mouse4' },
        { id: 'b', binding: 'mousex1' },
      ],
      false
    );
    expect(conflicts).toHaveLength(1);
  });
});

describe('standalone modifier key bindings', () => {
  test('parses standalone modifier tokens and aliases into key', () => {
    expect(parseBinding('ctrl')).toEqual({
      key: 'ctrl',
      mod: false,
      ctrl: false,
      meta: false,
      alt: false,
      shift: false,
    });
    expect(parseBinding('rctrl').key).toBe('ctrlright');
    expect(parseBinding('ctrlleft').key).toBe('ctrlleft');
    expect(parseBinding('altgr').key).toBe('altright');
    expect(parseBinding('altleft').key).toBe('altleft');
    expect(parseBinding('lshift').key).toBe('shiftleft');
    expect(parseBinding('rshift').key).toBe('shiftright');
    expect(parseBinding('lmeta').key).toBe('metaleft');
    expect(parseBinding('rmeta').key).toBe('metaright');
    expect(parseBinding('mod').key).toBe('mod');

    expect(isModifierBinding('ctrlright')).toBe(true);
    expect(isModifierBinding('alt')).toBe(true);
    expect(isModifierBinding('mod')).toBe(true);
    expect(isModifierBinding('ctrl+k')).toBe(false);
    expect(isModifierBinding('mouse4')).toBe(false);
    expect(isModifierBinding('')).toBe(false);
  });

  test('matches side-specific, generic, mod, and Windows AltGr modifier events', () => {
    const lCtrl = event({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    const rCtrl = event({ key: 'Control', code: 'ControlRight', ctrlKey: true });
    const lAlt = event({ key: 'Alt', code: 'AltLeft', altKey: true });
    const rAlt = event({ key: 'Alt', code: 'AltRight', altKey: true });
    const altGr = event({ key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true });

    expect(matchesBinding('ctrlleft', lCtrl, false)).toBe(true);
    expect(matchesBinding('ctrlleft', rCtrl, false)).toBe(false);
    expect(matchesBinding('ctrlright', rCtrl, false)).toBe(true);
    expect(matchesBinding('ctrlright', lCtrl, false)).toBe(false);
    expect(matchesBinding('ctrl', lCtrl, false)).toBe(true);
    expect(matchesBinding('ctrl', rCtrl, false)).toBe(true);
    expect(matchesBinding('ctrl', { ...rCtrl, shiftKey: true }, false)).toBe(false);

    expect(matchesBinding('altleft', lAlt, false)).toBe(true);
    expect(matchesBinding('altright', rAlt, false)).toBe(true);
    expect(matchesBinding('altright', altGr, false)).toBe(true);
    expect(matchesBinding('alt', altGr, false)).toBe(true);
    expect(matchesBinding('altright', { ...altGr, shiftKey: true }, false)).toBe(false);
    expect(matchesBinding('altleft', altGr, false)).toBe(false);

    expect(matchesBinding('mod', lCtrl, false)).toBe(true);
    expect(
      matchesBinding('mod', event({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)
    ).toBe(true);
  });

  test('identifies standalone modifiers from keyboard events', () => {
    expect(standaloneModifierFromEvent(event({ key: 'Control', code: 'ControlRight' }))).toBe(
      'ctrlright'
    );
    expect(
      standaloneModifierFromEvent(
        event({ key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true })
      )
    ).toBe('altright');
    expect(standaloneModifierFromEvent(event({ key: 'Alt', code: '' }))).toBe('alt');
    expect(standaloneModifierFromEvent(event({ key: 'a', code: 'KeyA' }))).toBeNull();
  });

  test('formats standalone modifiers for Windows/Linux and macOS', () => {
    expect(formatBinding('ctrlleft', false)).toBe('Left Ctrl');
    expect(formatBinding('ctrlright', false)).toBe('Right Ctrl');
    expect(formatBinding('altleft', false)).toBe('Left Alt');
    expect(formatBinding('altright', false)).toBe('Right Alt');
    expect(formatBinding('ctrl', false)).toBe('Ctrl');
    expect(formatBinding('alt', false)).toBe('Alt');
    expect(formatBinding('ctrlleft', true)).toBe('Left Ctrl');
    expect(formatBinding('altright', true)).toBe('Right ⌥');
    expect(formatBinding('shiftleft', true)).toBe('Left ⇧');
    expect(formatBinding('metaright', true)).toBe('Right ⌘');
    expect(formatBinding('mod', true)).toBe('⌘');
  });

  test('detects conflicts between generic and side-specific standalone modifiers without false positives', () => {
    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'ctrlleft' },
          { id: 'b', binding: 'ctrlright' },
        ],
        false
      )
    ).toHaveLength(0);

    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'ctrlright' },
          { id: 'b', binding: 'rctrl' },
        ],
        false
      )
    ).toHaveLength(1);

    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'altright' },
          { id: 'b', binding: 'altgr' },
        ],
        false
      )
    ).toHaveLength(1);

    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'ctrl' },
          { id: 'b', binding: 'ctrlright' },
        ],
        false
      )
    ).toHaveLength(1);

    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'mod' },
          { id: 'b', binding: 'ctrlleft' },
        ],
        false
      )
    ).toHaveLength(1);

    expect(
      findShortcutConflicts(
        [
          { id: 'a', binding: 'mod' },
          { id: 'b', binding: 'metaleft' },
        ],
        true
      )
    ).toHaveLength(1);
  });
});
