import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: vi.fn(),
  },
}));

import { encodeIco, WINDOWS_TRAY_ICON_SIZES } from './tray-ico';

test('encodeIco writes a valid multi-resolution PNG-in-ICO container', () => {
  const frames = WINDOWS_TRAY_ICON_SIZES.map((size, index) => ({
    size,
    png: Buffer.from(`png-${size}-${index}`),
  }));

  const ico = encodeIco(frames);

  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(frames.length);

  let expectedOffset = 6 + frames.length * 16;
  for (let i = 0; i < frames.length; i++) {
    const entryOffset = 6 + i * 16;
    const frame = frames[i];
    const expectedDim = frame.size >= 256 ? 0 : frame.size;
    expect(ico[entryOffset]).toBe(expectedDim);
    expect(ico[entryOffset + 1]).toBe(expectedDim);
    expect(ico[entryOffset + 2]).toBe(0);
    expect(ico[entryOffset + 3]).toBe(0);
    expect(ico.readUInt16LE(entryOffset + 4)).toBe(1);
    expect(ico.readUInt16LE(entryOffset + 6)).toBe(32);
    expect(ico.readUInt32LE(entryOffset + 8)).toBe(frame.png.length);
    const dataOffset = ico.readUInt32LE(entryOffset + 12);
    expect(dataOffset).toBe(expectedOffset);
    expect(ico.subarray(dataOffset, dataOffset + frame.png.length)).toEqual(frame.png);
    expectedOffset += frame.png.length;
  }

  expect(ico.length).toBe(expectedOffset);
});
