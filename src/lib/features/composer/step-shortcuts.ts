import type { ReplyDirection } from '#lib/features/room/timeline/timeline-format.js';
import { matchesBinding, matchesMouseBinding } from '#lib/ui/shortcuts/binding.js';
import { effectiveShortcuts } from '#lib/ui/shortcuts/bindings.svelte.js';
import { isMacPlatform } from '#lib/ui/shortcuts/global-shortcuts.js';

const REPLY_STEPS: Partial<Record<string, ReplyDirection>> = {
  'room.replyOlder': 'older',
  'room.replyNewer': 'newer',
};

const EDIT_STEPS: Partial<Record<string, ReplyDirection>> = {
  'room.editOlder': 'older',
  'room.editNewer': 'newer',
};

function stepFor(
  steps: Partial<Record<string, ReplyDirection>>,
  event: KeyboardEvent | MouseEvent
): ReplyDirection | undefined {
  const isMac = isMacPlatform();
  const shortcut = effectiveShortcuts().find(
    (candidate) =>
      steps[candidate.id] &&
      ('key' in event
        ? matchesBinding(candidate.binding, event, isMac)
        : matchesMouseBinding(candidate.binding, event, isMac))
  );
  return shortcut && steps[shortcut.id];
}

export function replyStep(event: KeyboardEvent | MouseEvent): ReplyDirection | undefined {
  return stepFor(REPLY_STEPS, event);
}

export function editStep(event: KeyboardEvent | MouseEvent): ReplyDirection | undefined {
  return stepFor(EDIT_STEPS, event);
}
