import { BrowserWindow, screen, type WebContents } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
  VoiceOverlayAction,
  VoiceOverlayConfig,
  VoiceOverlayRunningApp,
  VoiceOverlayState,
} from '../../src/lib/platform/voice-overlay-types';
import {
  OVERLAY_MARGIN_PX,
  computeLockedBounds,
  matchesRegisteredApp,
  type OverlayRect,
} from './voice-overlay-layout';

export interface ForegroundWindow {
  hwnd: string;
  exe: string;
  title: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
}

export interface OverlayNativeModule {
  listOverlayApps?: () => string;
  getForegroundWindowInfo?: () => string | null;
  focusWindow?: (hwnd: string) => boolean;
}

export interface OverlayWindowLike {
  readonly webContents: WebContents;
  isDestroyed(): boolean;
  isVisible(): boolean;
  setBounds(bounds: OverlayRect): void;
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  setFocusable(focusable: boolean): void;
  setSkipTaskbar(skip: boolean): void;
  moveTop(): void;
  show(): void;
  showInactive(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  loadURL(url: string): Promise<void>;
  on(event: 'closed', listener: () => void): void;
  once(event: 'ready-to-show', listener: () => void): void;
}

export interface VoiceOverlayDeps {
  platform?: string;
  selfPid?: number;
  pollMs?: number;
  loadNative?: () => OverlayNativeModule;
  createWindow?: () => OverlayWindowLike;
  screenApi?: {
    screenToDipRect: (window: BrowserWindow | null, rect: OverlayRect) => OverlayRect;
    getPrimaryWorkArea: () => OverlayRect;
  };
  onAction: (action: VoiceOverlayAction) => void;
}

const DEFAULT_CONFIG: VoiceOverlayConfig = {
  enabled: false,
  preview: false,
  displayMode: 'always',
  nameMode: 'always',
  avatarSize: 'compact',
  opacity: 0.85,
  anchorX: 0.02,
  anchorY: 0.04,
  apps: [],
};

const DEFAULT_STATE: VoiceOverlayState = {
  inCall: false,
  microphoneEnabled: true,
  deafened: false,
  participants: [],
};

const OVERLAY_URL = 'sable-app://app/__sable_overlay__/overlay.html';

function defaultOverlayWindow(): OverlayWindowLike {
  const window = new BrowserWindow({
    title: 'Sable Voice Overlay',
    width: 240,
    height: 120,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'overlay-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  if (process.platform !== 'win32') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[sable overlay] failed to load overlay page', code, description);
  });
  return window;
}

export class VoiceOverlayManager {
  readonly #platform: string;
  readonly #selfPid: number;
  readonly #pollMs: number;
  readonly #loadNative: () => OverlayNativeModule;
  readonly #createWindow: () => OverlayWindowLike;
  readonly #screenApi: NonNullable<VoiceOverlayDeps['screenApi']>;
  readonly #onAction: (action: VoiceOverlayAction) => void;

  #native: OverlayNativeModule | null | undefined;
  #window: OverlayWindowLike | null = null;
  #ready = false;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #config: VoiceOverlayConfig = DEFAULT_CONFIG;
  #state: VoiceOverlayState = DEFAULT_STATE;
  #shortcutLabel = 'Shift+`';
  #unlocked = false;
  #targetRect: OverlayRect | null = null;
  #targetHwnd: string | null = null;
  #widgetSize = { width: 220, height: 80 };
  #lastBoundsKey = '';
  #lastWindowMode: 'locked' | 'unlocked' | null = null;
  #lastTopKey = '';
  #lastRenderKey = '';

  constructor(deps: VoiceOverlayDeps) {
    this.#platform = deps.platform ?? process.platform;
    this.#selfPid = deps.selfPid ?? process.pid;
    this.#pollMs = deps.pollMs ?? 200;
    this.#loadNative =
      deps.loadNative ??
      (() =>
        createRequire(join(__dirname, 'main.cjs'))(
          join(__dirname, 'sable_node.node')
        ) as OverlayNativeModule);
    this.#createWindow = deps.createWindow ?? defaultOverlayWindow;
    this.#screenApi = deps.screenApi ?? {
      screenToDipRect: (window, rect) => screen.screenToDipRect(window, rect),
      getPrimaryWorkArea: () => screen.getPrimaryDisplay().workArea,
    };
    this.#onAction = deps.onAction;
  }

  get available(): boolean {
    return this.#platform === 'win32';
  }

  get unlocked(): boolean {
    return this.#unlocked;
  }

  isOverlaySender(sender: WebContents): boolean {
    return (
      this.#window !== null && !this.#window.isDestroyed() && this.#window.webContents === sender
    );
  }

  listRunningApps(): VoiceOverlayRunningApp[] {
    if (!this.available) return [];
    const fn = this.#nativeModule()?.listOverlayApps;
    if (!fn) return [];
    try {
      const parsed: unknown = JSON.parse(fn());
      return Array.isArray(parsed) ? (parsed as VoiceOverlayRunningApp[]) : [];
    } catch {
      return [];
    }
  }

  updateConfig(config: VoiceOverlayConfig, shortcutLabel?: string): void {
    this.#config = config;
    if (shortcutLabel) this.#shortcutLabel = shortcutLabel;
    this.#syncPolling();
    this.tick();
  }

  updateState(state: VoiceOverlayState): void {
    this.#state = state;
    this.#syncPolling();
    this.tick();
  }

  toggleLock(): void {
    if (!this.available || !this.#config.enabled) return;
    if (this.#unlocked) {
      this.#lock(true);
      return;
    }
    this.tick();
    if (!this.#targetRect) return;
    this.#unlocked = true;
    const window = this.#ensureWindow();
    const wasVisible = window.isVisible();
    if (this.#lastWindowMode !== 'unlocked' || !wasVisible) {
      window.setIgnoreMouseEvents(false);
      window.setFocusable(true);
      window.setSkipTaskbar(true);
      this.#lastWindowMode = 'unlocked';
    }
    this.#applyBounds(this.#targetRect);
    if (this.#ready) {
      if (!wasVisible) window.show();
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
      window.focus();
      this.#lastTopKey = `unlocked:${this.#targetHwnd ?? 'preview'}`;
    }
    this.#pushRender();
  }

  handleRendererReady(): void {
    if (!this.#window || this.#window.isDestroyed()) return;
    this.#onWindowReady(this.#window);
  }

  handleWidgetSize(width: number, height: number): void {
    const nextW = Math.max(48, Math.min(480, Math.ceil(width)));
    const nextH = Math.max(36, Math.min(720, Math.ceil(height)));
    if (nextW === this.#widgetSize.width && nextH === this.#widgetSize.height) return;
    this.#widgetSize = { width: nextW, height: nextH };
    if (!this.#unlocked && this.#targetRect && this.#shouldShowLockedContent()) {
      this.#applyBounds(
        computeLockedBounds(
          this.#targetRect,
          this.#widgetSize,
          this.#config.anchorX,
          this.#config.anchorY,
          OVERLAY_MARGIN_PX
        )
      );
    }
  }

  handleAction(action: VoiceOverlayAction): void {
    if (action.type === 'lock') {
      this.#lock(true);
      return;
    }
    if (action.type === 'move') {
      this.#config = { ...this.#config, anchorX: action.anchorX, anchorY: action.anchorY };
      this.#onAction(action);
      return;
    }
    this.#onAction(action);
  }

  tick(): void {
    if (
      !this.available ||
      !this.#config.enabled ||
      (!this.#state.inCall && !this.#config.preview)
    ) {
      this.#destroyWindow();
      return;
    }

    if (this.#config.preview) {
      this.#targetHwnd = null;
      this.#targetRect = this.#screenApi.getPrimaryWorkArea();
      this.#present();
      return;
    }

    const fg = this.#foregroundWindow();
    if (fg && fg.pid === this.#selfPid && this.#unlocked && this.#targetRect) {
      this.#present();
      return;
    }
    if (
      fg &&
      !fg.minimized &&
      fg.width > 0 &&
      fg.height > 0 &&
      matchesRegisteredApp(fg.exe, this.#config.apps)
    ) {
      this.#targetHwnd = fg.hwnd;
      this.#targetRect = this.#screenApi.screenToDipRect(null, {
        x: fg.x,
        y: fg.y,
        width: fg.width,
        height: fg.height,
      });
      this.#present();
      return;
    }

    this.#hide();
  }

  stop(): void {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    this.#destroyWindow();
  }

  #shouldShowLockedContent(): boolean {
    if (this.#config.preview) return true;
    if (this.#config.displayMode === 'speaking') {
      return this.#state.participants.some((p) => p.speaking && !p.muted);
    }
    return this.#state.participants.length > 0;
  }

  #present(): void {
    if (!this.#targetRect) return;
    if (!this.#unlocked && !this.#shouldShowLockedContent()) {
      if (this.#window && !this.#window.isDestroyed() && this.#window.isVisible()) {
        this.#window.hide();
      }
      this.#lastTopKey = '';
      this.#lastWindowMode = null;
      return;
    }

    const window = this.#ensureWindow();
    const mode: 'locked' | 'unlocked' = this.#unlocked ? 'unlocked' : 'locked';
    const wasVisible = window.isVisible();
    const bounds = this.#unlocked
      ? this.#targetRect
      : computeLockedBounds(
          this.#targetRect,
          this.#widgetSize,
          this.#config.anchorX,
          this.#config.anchorY,
          OVERLAY_MARGIN_PX
        );
    this.#applyBounds(bounds);
    if (this.#lastWindowMode !== mode || !wasVisible) {
      if (this.#unlocked) {
        window.setIgnoreMouseEvents(false);
        window.setFocusable(true);
      } else {
        window.setIgnoreMouseEvents(true, { forward: false });
        window.setFocusable(false);
      }
      window.setSkipTaskbar(true);
      this.#lastWindowMode = mode;
    }
    if (this.#ready) {
      if (!wasVisible) {
        if (this.#unlocked) window.show();
        else window.showInactive();
      }
      const topKey = `${mode}:${this.#targetHwnd ?? 'preview'}`;
      if (!wasVisible || topKey !== this.#lastTopKey) {
        window.setAlwaysOnTop(true, 'screen-saver');
        window.moveTop();
        this.#lastTopKey = topKey;
      }
    }
    this.#pushRender();
  }

  #lock(restoreFocus: boolean): void {
    if (!this.#unlocked) return;
    this.#unlocked = false;
    const hwnd = this.#targetHwnd;
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.setIgnoreMouseEvents(true, { forward: false });
      this.#window.setFocusable(false);
      this.#window.setSkipTaskbar(true);
      this.#lastWindowMode = 'locked';
      if (this.#targetRect && this.#shouldShowLockedContent()) {
        this.#applyBounds(
          computeLockedBounds(
            this.#targetRect,
            this.#widgetSize,
            this.#config.anchorX,
            this.#config.anchorY,
            OVERLAY_MARGIN_PX
          )
        );
        if (this.#ready) {
          this.#window.showInactive();
          this.#window.setAlwaysOnTop(true, 'screen-saver');
          this.#window.moveTop();
          this.#lastTopKey = `locked:${this.#targetHwnd ?? 'preview'}`;
        }
      } else {
        this.#window.hide();
        this.#lastTopKey = '';
      }
    }
    this.#pushRender();
    if (restoreFocus && !this.#config.preview && hwnd) {
      this.#nativeModule()?.focusWindow?.(hwnd);
    }
  }

  #hide(): void {
    if (this.#unlocked) this.#lock(false);
    this.#targetRect = null;
    this.#targetHwnd = null;
    this.#lastBoundsKey = '';
    this.#lastTopKey = '';
    this.#lastWindowMode = null;
    if (this.#window && !this.#window.isDestroyed() && this.#window.isVisible()) {
      this.#window.hide();
    }
  }

  #destroyWindow(): void {
    this.#unlocked = false;
    this.#targetRect = null;
    this.#targetHwnd = null;
    this.#lastBoundsKey = '';
    this.#lastWindowMode = null;
    this.#lastTopKey = '';
    this.#lastRenderKey = '';
    if (this.#window && !this.#window.isDestroyed()) {
      this.#window.destroy();
    }
    this.#window = null;
    this.#ready = false;
  }

  #applyBounds(bounds: OverlayRect): void {
    if (!this.#window || this.#window.isDestroyed()) return;
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key === this.#lastBoundsKey) return;
    this.#lastBoundsKey = key;
    this.#window.setBounds(bounds);
  }

  #onWindowReady(window: OverlayWindowLike): void {
    if (this.#window !== window || window.isDestroyed()) return;
    this.#ready = true;
    this.#lastRenderKey = '';
    this.#pushRender(true);
    if (this.#targetRect && (this.#unlocked || this.#shouldShowLockedContent())) {
      const mode: 'locked' | 'unlocked' = this.#unlocked ? 'unlocked' : 'locked';
      if (this.#unlocked) {
        window.show();
        window.setAlwaysOnTop(true, 'screen-saver');
        window.moveTop();
        window.focus();
      } else {
        window.showInactive();
        window.setAlwaysOnTop(true, 'screen-saver');
        window.moveTop();
      }
      this.#lastTopKey = `${mode}:${this.#targetHwnd ?? 'preview'}`;
    }
  }

  #ensureWindow(): OverlayWindowLike {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#createWindow();
    this.#ready = false;
    this.#lastWindowMode = null;
    this.#lastTopKey = '';
    this.#lastRenderKey = '';
    window.once('ready-to-show', () => {
      this.#onWindowReady(window);
    });
    window.on('closed', () => {
      if (this.#window === window) {
        this.#window = null;
        this.#ready = false;
        this.#unlocked = false;
        this.#lastWindowMode = null;
        this.#lastTopKey = '';
        this.#lastRenderKey = '';
      }
    });
    void window.loadURL(OVERLAY_URL);
    this.#window = window;
    return window;
  }

  #pushRender(force = false): void {
    if (!this.#window || this.#window.isDestroyed() || !this.#ready) return;
    const payload = {
      config: this.#config,
      state: this.#state,
      unlocked: this.#unlocked,
      targetWidth: this.#targetRect?.width ?? 1280,
      targetHeight: this.#targetRect?.height ?? 720,
      shortcutLabel: this.#shortcutLabel,
    };
    const renderKey = JSON.stringify(payload);
    if (!force && renderKey === this.#lastRenderKey) return;
    this.#lastRenderKey = renderKey;
    this.#window.webContents.send('sable-overlay-update', payload);
  }

  #syncPolling(): void {
    const active =
      this.available && this.#config.enabled && (this.#state.inCall || this.#config.preview);
    if (active && !this.#pollTimer) {
      this.#pollTimer = setInterval(() => {
        this.tick();
      }, this.#pollMs);
      this.#pollTimer.unref();
    } else if (!active) {
      if (this.#pollTimer) {
        clearInterval(this.#pollTimer);
        this.#pollTimer = undefined;
      }
      if (this.#window) {
        this.#destroyWindow();
      }
    }
  }

  #foregroundWindow(): ForegroundWindow | null {
    const fn = this.#nativeModule()?.getForegroundWindowInfo;
    if (!fn) return null;
    try {
      const raw = fn();
      return raw ? (JSON.parse(raw) as ForegroundWindow) : null;
    } catch {
      return null;
    }
  }

  #nativeModule(): OverlayNativeModule | null {
    if (this.#native !== undefined) return this.#native;
    try {
      this.#native = this.#loadNative();
    } catch {
      this.#native = null;
    }
    return this.#native;
  }
}
