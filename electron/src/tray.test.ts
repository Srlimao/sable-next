import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, MenuItemConstructorOptions, NativeImage } from 'electron';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quit: vi.fn(),
  fail: false,
  menu: [] as MenuItemConstructorOptions[],
  baseIcon: {
    isEmpty: () => false,
    getSize: () => ({ width: 32, height: 32 }),
    toBitmap: () => Buffer.alloc(32 * 32 * 4, 100),
  },
  createFromBitmap: vi.fn((bitmap: Buffer, size: { width: number; height: number }) => ({
    bitmap,
    size,
  })),
  createFromDataURL: vi.fn((dataUrl: string) => ({
    dataUrl,
    isEmpty: () => !dataUrl.startsWith('data:image/png;base64,'),
    getSize: () => ({ width: 64, height: 64 }),
    toBitmap: () => Buffer.alloc(64 * 64 * 4, 50),
    resize: vi.fn((opts: { width: number; height: number; quality?: string }) => ({
      toPNG: () => Buffer.from(`png-${opts.width}x${opts.height}-${opts.quality ?? 'default'}`),
    })),
  })),
  createFromPath: vi.fn((filePath: string) => {
    if (filePath.includes('tray-call-')) {
      return {
        icoPath: filePath,
        isEmpty: () => false,
      };
    }
    return undefined;
  }),
}));

vi.mock('electron', () => ({
  app: { quit: mocks.quit },
  nativeImage: {
    createFromPath: (filePath: string) => mocks.createFromPath(filePath) ?? mocks.baseIcon,
    createFromBitmap: mocks.createFromBitmap,
    createFromDataURL: mocks.createFromDataURL,
  },
  Menu: {
    buildFromTemplate: (items: MenuItemConstructorOptions[]) => {
      mocks.menu = items;
      return items;
    },
  },
  Tray: class extends EventEmitter {
    destroy = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    setImage = vi.fn();
    constructor(readonly image: NativeImage) {
      super();
      if (mocks.fail) throw new Error('Tray unavailable');
      trayEvents.push(this);
    }
  },
}));

const trayEvents: (EventEmitter & {
  image: NativeImage;
  destroy: ReturnType<typeof vi.fn>;
  setImage: ReturnType<typeof vi.fn>;
  setToolTip: ReturnType<typeof vi.fn>;
})[] = [];

import { closeAction, DesktopTray, hideToTray } from './tray';

function setup(platform: NodeJS.Platform = 'win32') {
  let visible = true;
  let minimized = false;
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    show: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    restore: vi.fn(() => {
      minimized = false;
    }),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
  const tray = new DesktopTray('/icon.ico', () => window as unknown as BrowserWindow, platform);
  return {
    tray,
    window,
    minimize: () => {
      minimized = true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  trayEvents.length = 0;
  mocks.fail = false;
  mocks.menu = [];
});

test('Windows double-click hides and restores, while single click does not toggle', () => {
  const { tray, window, minimize } = setup();
  expect(tray.update(true)).toBe(true);
  trayEvents[0].emit('click');
  expect(window.hide).not.toHaveBeenCalled();
  trayEvents[0].emit('double-click');
  expect(window.hide).toHaveBeenCalledOnce();
  expect(window.webContents.send).toHaveBeenCalledWith('sable-window-hidden-to-tray');
  trayEvents[0].emit('double-click');
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
  minimize();
  trayEvents[0].emit('double-click');
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.isVisible()).toBe(true);
});

test.each([
  ['darwin', false, false, 'hide-app'],
  ['darwin', true, false, 'close'],
  ['linux', false, true, 'hide-to-tray'],
  ['linux', false, false, 'close'],
  ['win32', true, true, 'close'],
] as const)(
  'closing the window on %s (quitting %s, closes to tray %s) is %s',
  (platform, quitting, closesToTray, action) => {
    expect(closeAction(platform, quitting, closesToTray)).toBe(action);
  }
);

test('the menu restores a hidden window and Quit exits the app', () => {
  const { tray, window } = setup();
  tray.update(true);
  hideToTray(window as unknown as BrowserWindow);
  mocks.menu[0].click?.(undefined as never, undefined, undefined as never);
  expect(window.show).toHaveBeenCalledOnce();
  mocks.menu[2].click?.(undefined as never, undefined, undefined as never);
  expect(mocks.quit).toHaveBeenCalledOnce();
});

test('disabling the tray reveals a hidden window, and re-enabling creates one icon', () => {
  const { tray, window } = setup();
  tray.update(true);
  tray.update(true);
  expect(trayEvents).toHaveLength(1);
  hideToTray(window as unknown as BrowserWindow);
  expect(tray.update(false)).toBe(false);
  expect(tray.available).toBe(false);
  expect(trayEvents[0].destroy).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(tray.update(true)).toBe(true);
  expect(trayEvents).toHaveLength(2);
  hideToTray(window as unknown as BrowserWindow);
  tray.destroy();
  expect(tray.available).toBe(false);
  expect(window.isVisible()).toBe(false);
});

test('tray creation failure leaves close/minimize available', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.fail = true;
  const { tray } = setup();
  expect(tray.update(true)).toBe(false);
  expect(tray.available).toBe(false);
  error.mockRestore();
});

test('Linux retains click-to-show behavior', () => {
  const { tray, window } = setup('linux');
  tray.update(true);
  trayEvents[0].emit('click');
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.hide).not.toHaveBeenCalled();
});

test('Linux shows an unread dot and clears it when read', () => {
  const { tray } = setup('linux');
  tray.update(true);
  tray.setUnread(true);
  const [bitmap, size] = mocks.createFromBitmap.mock.calls[0];
  const pixel = (x: number, y: number) => [
    ...bitmap.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4),
  ];
  expect(size).toEqual({ width: 32, height: 32 });
  expect(pixel(25, 25)).toEqual([45, 45, 224, 255]);
  expect(pixel(0, 0)).toEqual([100, 100, 100, 100]);
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromBitmap.mock.results[0].value
  );
  tray.setUnread(true);
  expect(trayEvents[0].setImage).toHaveBeenCalledOnce();
  tray.setUnread(false);
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(mocks.baseIcon);
});

test('tray recreation uses the current unread state', () => {
  const { tray } = setup('linux');
  tray.setUnread(true);
  tray.update(true);
  expect(trayEvents[0].image).toBe(mocks.createFromBitmap.mock.results[0].value);
  tray.update(false);
  tray.update(true);
  expect(trayEvents[1].image).toBe(mocks.createFromBitmap.mock.results[1].value);
  tray.update(false);
  tray.setUnread(false);
  tray.update(true);
  expect(trayEvents[2].image).toBe(mocks.baseIcon);
});

test('call state switches tray image and tooltip across connected, muted, deafened, and idle', () => {
  const { tray } = setup('win32');
  tray.update(true);

  tray.setCallState('connected', 'data:image/png;base64,connected');
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Connected');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromDataURL.mock.results[0].value
  );

  tray.setCallState('connected', 'data:image/png;base64,connected');
  expect(trayEvents[0].setImage).toHaveBeenCalledTimes(1);

  tray.setCallState('muted', 'data:image/png;base64,muted');
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Muted');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromDataURL.mock.results[1].value
  );

  tray.setCallState('deafened', 'data:image/png;base64,deafened');
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Deafened');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromDataURL.mock.results[2].value
  );

  tray.setCallState('idle', null);
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(mocks.baseIcon);
});

test('unread dot composites onto the active call icon and reverts cleanly on idle', () => {
  const { tray } = setup('linux');
  tray.update(true);

  tray.setCallState('muted', 'data:image/png;base64,muted');
  tray.setUnread(true);
  const [mutedUnreadBitmap, mutedUnreadSize] = mocks.createFromBitmap.mock.calls[0];
  expect(mutedUnreadSize).toEqual({ width: 64, height: 64 });
  expect([...mutedUnreadBitmap.subarray(0, 4)]).toEqual([50, 50, 50, 50]);
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromBitmap.mock.results[0].value
  );

  tray.setCallState('idle', null);
  const [, idleUnreadSize] = mocks.createFromBitmap.mock.calls[1];
  expect(idleUnreadSize).toEqual({ width: 32, height: 32 });
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromBitmap.mock.results[1].value
  );
});

test('tray recreation preserves call state and empty data URLs fall back to baseIcon', () => {
  const { tray } = setup('win32');
  tray.setCallState('deafened', 'data:image/png;base64,deafened');
  tray.update(true);
  expect(trayEvents[0].image).toBe(mocks.createFromDataURL.mock.results[0].value);
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Deafened');

  tray.update(false);
  tray.update(true);
  expect(trayEvents[1].image).toBe(mocks.createFromDataURL.mock.results[0].value);
  expect(trayEvents[1].setToolTip).toHaveBeenLastCalledWith('Sable — Deafened');

  tray.setCallState('connected', 'invalid-url');
  expect(trayEvents[1].setToolTip).toHaveBeenLastCalledWith('Sable — Connected');
  expect(trayEvents[1].setImage).toHaveBeenLastCalledWith(mocks.baseIcon);
});

test('speaking state updates tooltip and caches decoded call icons across transitions', () => {
  const { tray } = setup('win32');
  tray.update(true);

  tray.setCallState('connected', 'data:image/png;base64,silent');
  expect(mocks.createFromDataURL).toHaveBeenCalledTimes(1);
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Connected');

  tray.setCallState('speaking', 'data:image/png;base64,speaking');
  expect(mocks.createFromDataURL).toHaveBeenCalledTimes(2);
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Speaking');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromDataURL.mock.results[1].value
  );

  tray.setCallState('connected', 'data:image/png;base64,silent');
  expect(mocks.createFromDataURL).toHaveBeenCalledTimes(2);
  expect(trayEvents[0].setToolTip).toHaveBeenLastCalledWith('Sable — Connected');
  expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(
    mocks.createFromDataURL.mock.results[0].value
  );
});

test('Windows tray writes and caches multi-resolution .ico files and refreshes on DPI changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sable-tray-ico-'));
  try {
    const tray = new DesktopTray(
      '/icon.ico',
      () =>
        ({
          isDestroyed: () => false,
          isVisible: () => true,
          isMinimized: () => false,
        }) as unknown as BrowserWindow,
      'win32',
      dir
    );
    tray.update(true);

    tray.setCallState('speaking', 'data:image/png;base64,speaking-hi');
    const icoPath = join(dir, 'tray-call-speaking.ico');
    const icoBytes = readFileSync(icoPath);
    expect(icoBytes.readUInt16LE(0)).toBe(0);
    expect(icoBytes.readUInt16LE(2)).toBe(1);
    expect(icoBytes.readUInt16LE(4)).toBe(9);
    expect(trayEvents[0].setImage).toHaveBeenLastCalledWith(expect.objectContaining({ icoPath }));

    const pathCallsAfterFirst = mocks.createFromPath.mock.calls.length;
    tray.setCallState('connected', 'data:image/png;base64,silent-hi');
    tray.setCallState('speaking', 'data:image/png;base64,speaking-hi');
    expect(mocks.createFromPath.mock.calls.length).toBe(pathCallsAfterFirst + 1);

    const imageCallsBeforeRefresh = trayEvents[0].setImage.mock.calls.length;
    tray.refresh();
    expect(trayEvents[0].setImage).toHaveBeenCalledTimes(imageCallsBeforeRefresh + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
