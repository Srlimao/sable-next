import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron';
import { join } from 'node:path';
import type { TrayCallStatus } from '../../src/lib/platform/tray-call-types';
import { APP_NAME } from './app-name';
import { writeMultiResIco } from './tray-ico';

const TOOLTIPS: Record<TrayCallStatus, string> = {
  idle: APP_NAME,
  connected: `${APP_NAME} — Connected`,
  speaking: `${APP_NAME} — Speaking`,
  muted: `${APP_NAME} — Muted`,
  deafened: `${APP_NAME} — Deafened`,
};

function withUnreadDot(base: NativeImage): NativeImage {
  const { width, height } = base.getSize();
  const bitmap = base.toBitmap();
  const radius = Math.min(width, height) * 0.2;
  const cx = width - radius - width * 0.04;
  const cy = height - radius - height * 0.04;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) {
        // Electron bitmaps use BGRA.
        bitmap.set([45, 45, 224, 255], (y * width + x) * 4);
      }
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height });
}

export type CloseAction = 'close' | 'hide-app' | 'hide-to-tray';

/** macOS has no tray, and a destroyed window stops updating the dock badge, so closing hides the app there. */
export function closeAction(
  platform: NodeJS.Platform,
  quitting: boolean,
  closesToTray: boolean
): CloseAction {
  if (quitting) return 'close';
  if (platform === 'darwin') return 'hide-app';
  return closesToTray ? 'hide-to-tray' : 'close';
}

export function hideToTray(window: BrowserWindow): void {
  window.webContents.send('sable-window-hidden-to-tray');
  window.hide();
}

export class DesktopTray {
  private tray: Tray | null = null;
  private unread = false;
  private baseIcon: NativeImage | null = null;
  private callStatus: TrayCallStatus = 'idle';
  private callIconDataUrl: string | null = null;
  private callIcon: NativeImage | null = null;
  private readonly callIconCache = new Map<string, NativeImage>();
  private readonly windowsIcoCache = new Map<string, NativeImage>();

  constructor(
    private readonly iconPath: string,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly iconCacheDir?: string
  ) {}

  get available(): boolean {
    return this.tray !== null;
  }

  private currentImage(): NativeImage | null {
    if (this.callStatus !== 'idle' && this.callIcon) {
      const master = this.unread ? withUnreadDot(this.callIcon) : this.callIcon;
      if (this.platform === 'win32' && this.iconCacheDir && this.callIconDataUrl) {
        const key = `${this.callStatus}:${this.unread ? 'unread' : 'read'}:${this.callIconDataUrl}`;
        const cached = this.windowsIcoCache.get(key);
        if (cached) return cached;
        const icoPath = join(
          this.iconCacheDir,
          `tray-call-${this.callStatus}${this.unread ? '-unread' : ''}.ico`
        );
        const ico = writeMultiResIco(master, icoPath);
        if (ico) {
          this.windowsIcoCache.set(key, ico);
          return ico;
        }
      }
      return master;
    }
    if (!this.baseIcon) return null;
    return this.unread ? withUnreadDot(this.baseIcon) : this.baseIcon;
  }

  refresh(): void {
    if (!this.tray) return;
    const image = this.currentImage();
    if (image) this.tray.setImage(image);
  }

  setUnread(unread: boolean): void {
    if (this.unread === unread) return;
    this.unread = unread;
    if (this.tray) {
      const image = this.currentImage();
      if (image) this.tray.setImage(image);
    }
  }

  setCallState(status: TrayCallStatus, iconDataUrl: string | null): void {
    const nextDataUrl = status === 'idle' ? null : iconDataUrl;
    if (this.callStatus === status && this.callIconDataUrl === nextDataUrl) return;
    this.callStatus = status;
    this.callIconDataUrl = nextDataUrl;
    if (nextDataUrl) {
      let image = this.callIconCache.get(nextDataUrl);
      if (!image) {
        const decoded = nativeImage.createFromDataURL(nextDataUrl);
        if (!decoded.isEmpty()) {
          this.callIconCache.set(nextDataUrl, decoded);
          image = decoded;
        }
      }
      this.callIcon = image ?? null;
    } else {
      this.callIcon = null;
    }
    if (this.tray) {
      this.tray.setToolTip(TOOLTIPS[this.callStatus]);
      const image = this.currentImage();
      if (image) this.tray.setImage(image);
    }
  }

  showWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  update(show: boolean): boolean {
    if (
      !show ||
      (this.platform !== 'win32' && this.platform !== 'linux' && this.platform !== 'freebsd')
    ) {
      const wasAvailable = this.available;
      this.destroy();
      const window = this.getWindow();
      if (wasAvailable && window && !window.isDestroyed() && !window.isVisible()) {
        this.showWindow();
      }
      return false;
    }
    if (this.tray) return true;

    try {
      const icon = nativeImage.createFromPath(this.iconPath);
      if (icon.isEmpty()) throw new Error(`Could not load tray icon: ${this.iconPath}`);
      this.baseIcon = icon;
      this.tray = new Tray(this.currentImage() ?? icon);
      this.tray.setToolTip(TOOLTIPS[this.callStatus]);
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: `Show ${APP_NAME}`,
            click: () => {
              this.showWindow();
            },
          },
          { type: 'separator' },
          {
            label: `Quit ${APP_NAME}`,
            click: () => {
              app.quit();
            },
          },
        ])
      );
      if (this.platform === 'win32') {
        this.tray.on('double-click', () => {
          const window = this.getWindow();
          if (!window || window.isDestroyed()) return;
          if (window.isVisible() && !window.isMinimized()) hideToTray(window);
          else this.showWindow();
        });
      } else {
        this.tray.on('click', () => {
          this.showWindow();
        });
      }
      return true;
    } catch (error) {
      this.destroy();
      console.error('[sable tray] could not create the tray icon', error);
      return false;
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
    this.baseIcon = null;
  }
}
