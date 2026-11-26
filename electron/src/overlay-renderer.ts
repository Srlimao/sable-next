import type {
  VoiceOverlayAction,
  VoiceOverlayConfig,
  VoiceOverlayParticipant,
  VoiceOverlayState,
} from '../../src/lib/platform/voice-overlay-types';
import {
  OVERLAY_MARGIN_PX,
  computeAnchorFromWidgetPosition,
  computeLockedBounds,
} from './voice-overlay-layout';

interface OverlayPayload {
  config: VoiceOverlayConfig;
  state: VoiceOverlayState;
  unlocked: boolean;
  targetWidth: number;
  targetHeight: number;
  shortcutLabel: string;
}

declare global {
  interface Window {
    sableOverlay?: {
      onUpdate: (callback: (payload: OverlayPayload) => void) => () => void;
      sendAction: (action: VoiceOverlayAction) => void;
      reportSize: (width: number, height: number) => void;
      ready: () => void;
    };
  }
}

const MUTED_MIC_SVG =
  '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M213.38 229.92a8 8 0 0 1-11.3-.54l-30.92-34A78.83 78.83 0 0 1 136 207.59V240a8 8 0 0 1-16 0v-32.4A80.11 80.11 0 0 1 48 128a8 8 0 0 1 16 0 64.07 64.07 0 0 0 64 64 63.41 63.41 0 0 0 32.21-8.68l-11.1-12.2A48 48 0 0 1 80 128V95.09L42.08 53.38a8 8 0 1 1 11.84-10.76l160 176a8 8 0 0 1-.54 11.3ZM96 64v32.78l64 70.4V64a32 32 0 0 0-64 0Zm96 64a63.92 63.92 0 0 1-9.36 33.46 8 8 0 0 0 13.76 8.21A79.89 79.89 0 0 0 208 128a8 8 0 0 0-16 0Z"/></svg>';
const DEAFENED_SVG =
  '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M221.92 210.62 53.92 25.38a8 8 0 1 0-11.84 10.76L73.57 70.8A104 104 0 0 0 24 160v40a24 24 0 0 0 24 24h24a24 24 0 0 0 24-24v-40a24 24 0 0 0-24-24H41.22a88.14 88.14 0 0 1 43.25-53.4l87.17 95.88A24 24 0 0 0 184 224h24a24 24 0 0 0 16.41-6.51 8 8 0 0 0-2.49-6.87ZM80 160v40a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8v-40a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8ZM128 24a103.5 103.5 0 0 0-37.3 6.91 8 8 0 0 0 5.71 15A88 88 0 0 1 214.78 136H184a24 24 0 0 0-24 24v.91l16 17.6V160a8 8 0 0 1 8-8h24a8 8 0 0 1 8 8v40a7.83 7.83 0 0 1-.47 2.68l13.21 14.53A23.85 23.85 0 0 0 232 200v-40A104.11 104.11 0 0 0 128 24Z"/></svg>';

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; user-select: none; }
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  .backdrop { position: relative; width: 100%; height: 100%; border: 2px dashed rgba(255,255,255,0.22); border-radius: 12px; background: rgba(10, 12, 16, 0.22); }
  .hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); background: rgba(18, 20, 25, 0.92); color: #f2f3f5; border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 500; pointer-events: none; white-space: nowrap; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  .widget { display: inline-flex; flex-direction: column; gap: 6px; padding: 2px; max-width: 340px; }
  .widget.unlocked { position: fixed; background: rgba(20, 22, 28, 0.88); border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; padding: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); backdrop-filter: blur(12px); }
  .toolbar { display: flex; align-items: center; gap: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .drag { flex: 1; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.72); cursor: grab; padding: 4px 6px; border-radius: 8px; }
  .drag:active { cursor: grabbing; background: rgba(255,255,255,0.08); }
  .ctrl { border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color: #fff; border-radius: 8px; height: 26px; padding: 0 8px; font-size: 11px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
  .ctrl:hover { background: rgba(255,255,255,0.16); }
  .ctrl.danger { background: rgba(218, 55, 60, 0.85); border-color: rgba(242, 63, 67, 0.9); }
  .ctrl.primary { background: rgba(88, 101, 242, 0.85); border-color: rgba(121, 131, 245, 0.9); }
  .list { display: flex; flex-direction: column; gap: 6px; }
  .row { display: inline-flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; }
  .avatar { flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.45); transition: box-shadow 100ms ease, opacity 120ms ease; }
  .compact .avatar { width: 28px; height: 28px; font-size: 11px; }
  .large .avatar { width: 40px; height: 40px; font-size: 14px; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .row.speaking .avatar { box-shadow: 0 0 0 2.5px #23a55a, 0 0 0 4px rgba(35, 165, 90, 0.28); }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; color: rgba(255,255,255,0.82); font-size: 13px; font-weight: 600; line-height: 1.2; max-width: 240px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); backdrop-filter: blur(8px); }
  .compact .pill { font-size: 12px; padding: 3px 8px; }
  .row.speaking .pill { color: #ffffff; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { width: 14px; height: 14px; flex: none; color: #f23f43; display: inline-flex; }
  .badge svg { width: 100%; height: 100%; }
  .empty { padding: 6px 10px; border-radius: 999px; color: rgba(255,255,255,0.75); font-size: 12px; }
`;
document.head.append(style);

const root = document.getElementById('root') ?? document.body;
let latest: OverlayPayload | null = null;
let dragOffset: { x: number; y: number } | null = null;
let dragPos: { left: number; top: number } | null = null;
let lastReported = '';

function visibleParticipants(payload: OverlayPayload): VoiceOverlayParticipant[] {
  const { participants } = payload.state;
  if (payload.config.displayMode === 'speaking') {
    return participants.filter((p) => p.speaking && !p.muted);
  }
  return participants;
}

function showNameFor(payload: OverlayPayload, p: VoiceOverlayParticipant): boolean {
  if (payload.config.nameMode === 'never') return false;
  if (payload.config.nameMode === 'speaking') return p.speaking && !p.muted;
  return true;
}

function reportWidgetSize(widget: HTMLElement): void {
  const rect = widget.getBoundingClientRect();
  const width = Math.max(48, Math.ceil(rect.width) + 2);
  const height = Math.max(36, Math.ceil(rect.height) + 2);
  const key = `${width}x${height}`;
  if (key === lastReported) return;
  lastReported = key;
  window.sableOverlay?.reportSize(width, height);
}

function buildRow(payload: OverlayPayload, p: VoiceOverlayParticipant): HTMLElement {
  const row = document.createElement('div');
  const speaking = p.speaking && !p.muted;
  row.className = `row${speaking ? ' speaking' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.style.background = p.color;
  if (p.avatarUrl) {
    const img = document.createElement('img');
    img.src = p.avatarUrl;
    img.alt = '';
    avatar.append(img);
  } else {
    avatar.textContent = p.initials;
  }
  row.append(avatar);

  const nameShown = showNameFor(payload, p);
  const showStatus = p.deafened || p.muted;
  if (nameShown || showStatus) {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.style.background = `rgba(18, 20, 26, ${payload.config.opacity})`;
    if (nameShown) {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      pill.append(name);
    }
    if (showStatus) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.innerHTML = p.deafened ? DEAFENED_SVG : MUTED_MIC_SVG;
      pill.append(badge);
    }
    row.append(pill);
  }
  return row;
}

function render(payload: OverlayPayload): void {
  root.replaceChildren();
  const widget = document.createElement('div');
  widget.className = `widget ${payload.config.avatarSize}${payload.unlocked ? ' unlocked' : ''}`;

  if (payload.unlocked) {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const drag = document.createElement('div');
    drag.className = 'drag';
    drag.textContent = '⋮⋮ Drag';
    toolbar.append(drag);

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = `ctrl${payload.state.microphoneEnabled ? '' : ' danger'}`;
    muteBtn.textContent = payload.state.microphoneEnabled ? 'Mute' : 'Unmute';
    muteBtn.onclick = () => window.sableOverlay?.sendAction({ type: 'toggle-mute' });
    toolbar.append(muteBtn);

    const deafenBtn = document.createElement('button');
    deafenBtn.type = 'button';
    deafenBtn.className = `ctrl${payload.state.deafened ? ' danger' : ''}`;
    deafenBtn.textContent = payload.state.deafened ? 'Undeafen' : 'Deafen';
    deafenBtn.onclick = () => window.sableOverlay?.sendAction({ type: 'toggle-deafen' });
    toolbar.append(deafenBtn);

    if (payload.state.inCall) {
      const hangBtn = document.createElement('button');
      hangBtn.type = 'button';
      hangBtn.className = 'ctrl danger';
      hangBtn.textContent = 'Leave';
      hangBtn.onclick = () => window.sableOverlay?.sendAction({ type: 'hang-up' });
      toolbar.append(hangBtn);
    }

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'ctrl primary';
    lockBtn.textContent = 'Lock';
    lockBtn.onclick = () => window.sableOverlay?.sendAction({ type: 'lock' });
    toolbar.append(lockBtn);

    widget.append(toolbar);
  }

  const list = document.createElement('div');
  list.className = 'list';
  const shown = visibleParticipants(payload);
  for (const p of shown) list.append(buildRow(payload, p));
  if (shown.length === 0 && payload.unlocked) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.background = `rgba(18, 20, 26, ${payload.config.opacity})`;
    empty.textContent = 'Nobody is speaking';
    list.append(empty);
  }
  widget.append(list);

  if (!payload.unlocked) {
    root.append(widget);
    if (shown.length > 0) {
      requestAnimationFrame(() => {
        reportWidgetSize(widget);
      });
    }
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) window.sableOverlay?.sendAction({ type: 'lock' });
  });
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = `Overlay unlocked — drag to move · Esc or ${payload.shortcutLabel || 'Shift+`'} to lock`;
  backdrop.append(hint, widget);
  root.append(backdrop);

  const rect = widget.getBoundingClientRect();
  const target = { x: 0, y: 0, width: payload.targetWidth, height: payload.targetHeight };
  const placed = computeLockedBounds(
    target,
    { width: rect.width, height: rect.height },
    payload.config.anchorX,
    payload.config.anchorY,
    OVERLAY_MARGIN_PX
  );
  widget.style.left = `${dragPos?.left ?? placed.x}px`;
  widget.style.top = `${dragPos?.top ?? placed.y}px`;

  const dragHandle = widget.querySelector<HTMLElement>('.drag');
  if (dragHandle) {
    dragHandle.onpointerdown = (event) => {
      event.preventDefault();
      dragHandle.setPointerCapture(event.pointerId);
      const box = widget.getBoundingClientRect();
      dragOffset = { x: event.clientX - box.left, y: event.clientY - box.top };
      dragPos = { left: box.left, top: box.top };
    };
    dragHandle.onpointermove = (event) => {
      if (!dragOffset) return;
      const box = widget.getBoundingClientRect();
      const maxLeft = Math.max(
        OVERLAY_MARGIN_PX,
        payload.targetWidth - OVERLAY_MARGIN_PX - box.width
      );
      const maxTop = Math.max(
        OVERLAY_MARGIN_PX,
        payload.targetHeight - OVERLAY_MARGIN_PX - box.height
      );
      const left = Math.min(maxLeft, Math.max(OVERLAY_MARGIN_PX, event.clientX - dragOffset.x));
      const top = Math.min(maxTop, Math.max(OVERLAY_MARGIN_PX, event.clientY - dragOffset.y));
      dragPos = { left, top };
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
    };
    const endDrag = () => {
      if (!dragOffset || !dragPos) return;
      const box = widget.getBoundingClientRect();
      const next = computeAnchorFromWidgetPosition(
        target,
        dragPos.left,
        dragPos.top,
        box.width,
        box.height,
        OVERLAY_MARGIN_PX
      );
      dragOffset = null;
      dragPos = null;
      window.sableOverlay?.sendAction({
        type: 'move',
        anchorX: next.anchorX,
        anchorY: next.anchorY,
      });
    };
    dragHandle.onpointerup = endDrag;
    dragHandle.onpointercancel = endDrag;
  }
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && latest?.unlocked) {
    event.preventDefault();
    window.sableOverlay?.sendAction({ type: 'lock' });
  }
});

window.sableOverlay?.onUpdate((payload) => {
  if (!payload.unlocked) {
    dragOffset = null;
    dragPos = null;
  }
  latest = payload;
  render(payload);
});

window.sableOverlay?.ready();
