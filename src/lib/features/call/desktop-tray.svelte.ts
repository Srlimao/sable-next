import { electronBridge } from '#lib/platform/electron.js';
import type { TrayCallStatus } from '#lib/platform/tray-call-types.js';
import type { CallSession } from './call-session.svelte.js';

export type ActiveTrayCallStatus = Exclude<TrayCallStatus, 'idle'>;

const TRAY_ICON_SIZE = 256;
const SILENT_COLOR = '#b2f21d';
const SPEAKING_CENTER_COLOR = '#1b7a34';
const SPEAKING_GAP_COLOR = '#102e18';
const SPEAKING_RING_COLOR = '#c8ff3d';
const SPEAKING_RIM_COLOR = '#26a644';
const STATUS_DANGER_COLOR = '#f23f43';

// Phosphor MicrophoneSlashIcon (weight="fill") path from phosphor-svelte.
const MUTED_MIC_PATH =
  'M213.38,229.92a8,8,0,0,1-11.3-.54l-30.92-34A78.83,78.83,0,0,1,136,207.59V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64.07,64.07,0,0,0,64,64,63.41,63.41,0,0,0,32.21-8.68l-11.1-12.2A48,48,0,0,1,80,128V95.09L42.08,53.38A8,8,0,0,1,53.92,42.62l160,176A8,8,0,0,1,213.38,229.92Zm-24.19-63.13a7.88,7.88,0,0,0,3.51.82,8,8,0,0,0,7.19-4.49A79.16,79.16,0,0,0,208,128a8,8,0,0,0-16,0,63.32,63.32,0,0,1-6.48,28.09A8,8,0,0,1,189.19,166.79Zm-27.33-29.22A8,8,0,0,0,175.74,133a49.49,49.49,0,0,0,.26-5V64A48,48,0,0,0,84,44.87a8,8,0,0,0,1.41,8.57Z';

// Phosphor HeadphonesIcon (weight="fill") path from phosphor-svelte.
const HEADPHONES_FILL_PATH =
  'M232,128v56a24,24,0,0,1-24,24H192a24,24,0,0,1-24-24V144a24,24,0,0,1,24-24h23.65a87.71,87.71,0,0,0-87-80H128a88,88,0,0,0-87.64,80H64a24,24,0,0,1,24,24v40a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V128A104.11,104.11,0,0,1,201.89,54.66,103.41,103.41,0,0,1,232,128Z';

export function trayCallStatus(
  session: Pick<CallSession, 'lifecycle' | 'microphoneEnabled' | 'deafened' | 'transport'>
): TrayCallStatus {
  if (session.lifecycle !== 'active') return 'idle';
  if (session.deafened) return 'deafened';
  if (!session.microphoneEnabled) return 'muted';
  const self = session.transport.self;
  if (self?.speaking === true && self.microphone?.muted !== true) return 'speaking';
  return 'connected';
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  center: number,
  radius: number,
  mode: 'fill' | 'stroke'
): void {
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  if (mode === 'fill') ctx.fill();
  else ctx.stroke();
}

export function renderTrayCallIcon(status: ActiveTrayCallStatus): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = TRAY_ICON_SIZE;
  canvas.height = TRAY_ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = TRAY_ICON_SIZE / 2;

  if (status === 'connected') {
    ctx.fillStyle = SILENT_COLOR;
    drawCircle(ctx, center, 112, 'fill');
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 4;
    drawCircle(ctx, center, 110, 'stroke');
  } else if (status === 'speaking') {
    const glow = ctx.createRadialGradient(center, center, 92, center, center, center);
    glow.addColorStop(0, 'rgba(140, 255, 65, 0.55)');
    glow.addColorStop(0.6, 'rgba(38, 166, 68, 0.35)');
    glow.addColorStop(1, 'rgba(38, 166, 68, 0)');
    ctx.fillStyle = glow;
    drawCircle(ctx, center, center, 'fill');

    ctx.strokeStyle = SPEAKING_RIM_COLOR;
    ctx.lineWidth = 8;
    drawCircle(ctx, center, 114, 'stroke');

    ctx.strokeStyle = SPEAKING_RING_COLOR;
    ctx.lineWidth = 22;
    drawCircle(ctx, center, 96, 'stroke');

    ctx.strokeStyle = SPEAKING_GAP_COLOR;
    ctx.lineWidth = 10;
    drawCircle(ctx, center, 80, 'stroke');

    ctx.fillStyle = SPEAKING_CENTER_COLOR;
    drawCircle(ctx, center, 76, 'fill');
  } else {
    if (typeof Path2D === 'undefined') return null;
    ctx.save();
    ctx.translate(10, 10);
    const scale = (TRAY_ICON_SIZE - 20) / 256;
    ctx.scale(scale, scale);
    ctx.fillStyle = STATUS_DANGER_COLOR;
    ctx.strokeStyle = STATUS_DANGER_COLOR;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';

    const path = new Path2D(status === 'muted' ? MUTED_MIC_PATH : HEADPHONES_FILL_PATH);
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- CanvasRenderingContext2D.fill(Path2D), not Array.prototype.fill
    ctx.fill(path);
    ctx.stroke(path);

    if (status === 'deafened') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 38;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(40, 30);
      ctx.lineTo(216, 218);
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = STATUS_DANGER_COLOR;
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(44, 34);
      ctx.lineTo(212, 214);
      ctx.stroke();
    }
    ctx.restore();
  }

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.startsWith('data:image/png;base64,') ? dataUrl : null;
}

export function registerDesktopTrayStatus(session: CallSession): () => void {
  const bridge = electronBridge();
  if (!bridge?.setTrayCallState) return () => {};

  let lastStatus: TrayCallStatus | null = null;
  const icons: Partial<Record<ActiveTrayCallStatus, string | null>> = {};

  return $effect.root(() => {
    $effect(() => {
      const status = trayCallStatus(session);
      if (status === lastStatus) return;
      lastStatus = status;

      let icon: string | null = null;
      if (status !== 'idle') {
        if (!(status in icons)) {
          icons[status] = renderTrayCallIcon(status);
        }
        icon = icons[status] ?? null;
      }

      bridge.setTrayCallState?.({ status, icon });
    });

    return () => {
      lastStatus = null;
      bridge.setTrayCallState?.({ status: 'idle', icon: null });
    };
  });
}
