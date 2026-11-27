import { nativeImage, type NativeImage } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const WINDOWS_TRAY_ICON_SIZES = [16, 20, 24, 28, 32, 40, 48, 64, 256] as const;

export interface IcoFrame {
  size: number;
  png: Buffer;
}

/** Encodes PNG-compressed frames into a multi-resolution Windows `.ico` container. */
export function encodeIco(frames: readonly IcoFrame[]): Buffer {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(entrySize * frames.length);
  let offset = headerSize + directory.length;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const dim = frame.size >= 256 ? 0 : frame.size;
    const entryOffset = i * entrySize;
    directory[entryOffset] = dim;
    directory[entryOffset + 1] = dim;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(frame.png.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += frame.png.length;
  }

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.png)]);
}

/** Resamples `master` with Lanczos3 into all Windows tray DPI sizes and loads the `.ico`. */
export function writeMultiResIco(master: NativeImage, filePath: string): NativeImage | null {
  if (typeof master.resize !== 'function') return null;
  try {
    const frames: IcoFrame[] = [];
    for (const size of WINDOWS_TRAY_ICON_SIZES) {
      const resized = master.resize({ width: size, height: size, quality: 'best' });
      const png = resized.toPNG();
      if (png.length === 0) return null;
      frames.push({ size, png });
    }
    const ico = encodeIco(frames);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, ico);
    const loaded = nativeImage.createFromPath(filePath);
    return loaded.isEmpty() ? null : loaded;
  } catch {
    return null;
  }
}
