import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const root = join(import.meta.dirname, '../..');

function resizeBilinear(src, size) {
  const data = Buffer.alloc(size * size * 4);
  const scaleX = src.width / size;
  const scaleY = src.height / size;

  for (let y = 0; y < size; y += 1) {
    const sy = Math.max(0, Math.min(src.height - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < size; x += 1) {
      const sx = Math.max(0, Math.min(src.width - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = sx - x0;

      const weights = [
        (1 - fx) * (1 - fy),
        fx * (1 - fy),
        (1 - fx) * fy,
        fx * fy,
      ];
      const indices = [
        (y0 * src.width + x0) * 4,
        (y0 * src.width + x1) * 4,
        (y1 * src.width + x0) * 4,
        (y1 * src.width + x1) * 4,
      ];

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let alphaWeight = 0;
      for (let i = 0; i < 4; i += 1) {
        const idx = indices[i];
        const w = weights[i];
        const alpha = (src.data[idx + 3] / 255) * w;
        r += src.data[idx] * alpha;
        g += src.data[idx + 1] * alpha;
        b += src.data[idx + 2] * alpha;
        a += alpha;
        alphaWeight += w;
      }

      const di = (y * size + x) * 4;
      if (a > 0) {
        data[di] = Math.round(r / a);
        data[di + 1] = Math.round(g / a);
        data[di + 2] = Math.round(b / a);
        data[di + 3] = Math.round((a / alphaWeight) * 255);
      }
    }
  }

  return { width: size, height: size, data };
}

function resizeArea(src, size) {
  if (src.width === size && src.height === size) {
    return { width: size, height: size, data: Buffer.from(src.data) };
  }
  if (size >= src.width && size >= src.height) {
    return resizeBilinear(src, size);
  }

  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const y0 = (y / size) * src.height;
    const y1 = ((y + 1) / size) * src.height;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(src.height, Math.ceil(y1));

    for (let x = 0; x < size; x += 1) {
      const x0 = (x / size) * src.width;
      const x1 = ((x + 1) / size) * src.width;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(src.width, Math.ceil(x1));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;

      for (let sy = iy0; sy < iy1; sy += 1) {
        const rowWeight = Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
        if (rowWeight <= 0) continue;
        for (let sx = ix0; sx < ix1; sx += 1) {
          const weight = rowWeight * Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx));
          if (weight <= 0) continue;
          const si = (sy * src.width + sx) * 4;
          const alpha = src.data[si + 3] / 255;
          r += src.data[si] * alpha * weight;
          g += src.data[si + 1] * alpha * weight;
          b += src.data[si + 2] * alpha * weight;
          a += alpha * weight;
          area += weight;
        }
      }

      const di = (y * size + x) * 4;
      if (a > 0) {
        data[di] = Math.round(r / a);
        data[di + 1] = Math.round(g / a);
        data[di + 2] = Math.round(b / a);
        data[di + 3] = Math.round((a / area) * 255);
      }
    }
  }

  return { width: size, height: size, data };
}

function blendPixel(img, x, y, color, coverage) {
  const srcA = (color[3] / 255) * coverage;
  if (srcA <= 0) return;
  const i = (y * img.width + x) * 4;
  const dstA = img.data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  img.data[i] = Math.round((color[0] * srcA + img.data[i] * dstA * (1 - srcA)) / outA);
  img.data[i + 1] = Math.round((color[1] * srcA + img.data[i + 1] * dstA * (1 - srcA)) / outA);
  img.data[i + 2] = Math.round((color[2] * srcA + img.data[i + 2] * dstA * (1 - srcA)) / outA);
  img.data[i + 3] = Math.round(outA * 255);
}

function drawCircle(img, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(img.width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(img.height - 1, Math.ceil(cy + radius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist));
      if (coverage > 0) blendPixel(img, x, y, color, coverage);
    }
  }
}

function withFaviconBadge(base512, dotColor) {
  const img = {
    width: base512.width,
    height: base512.height,
    data: Buffer.from(base512.data),
  };
  const cx = 414;
  const cy = 396;
  drawCircle(img, cx, cy, 82, [0x18, 0x18, 0x25, 255]);
  drawCircle(img, cx, cy, 62, dotColor);
  return img;
}

function encodePng(img) {
  return PNG.sync.write(
    { width: img.width, height: img.height, data: img.data },
    { inputColorType: 6, colorType: 6, filterType: 0, deflateLevel: 9 }
  );
}

function encodeIco(frames) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(entrySize * frames.length);
  let offset = headerSize + directory.length;
  for (let i = 0; i < frames.length; i += 1) {
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

async function writeOut(relPath, content) {
  const fullPath = join(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function main() {
  const inputPath = resolve(process.argv[2] ?? join(root, 'src/lib/assets/brand-logo.png'));
  const source = PNG.sync.read(await readFile(inputPath));
  const resizedCache = new Map();

  const pngForSize = (size) => {
    let cached = resizedCache.get(size);
    if (!cached) {
      const img = resizeArea(source, size);
      cached = { img, png: encodePng(img) };
      resizedCache.set(size, cached);
    }
    return cached;
  };

  const base512 = pngForSize(512);
  const unread512 = encodePng(withFaviconBadge(base512.img, [0x98, 0x98, 0x98, 255]));
  const highlight512 = encodePng(withFaviconBadge(base512.img, [0x31, 0xff, 0x41, 255]));

  const pngTargets = [
    ['src/lib/assets/brand-logo.png', 512],
    ['src/lib/assets/favicon.png', 512],
    ['src/lib/supporter/app-icons/default.png', 512],
    ['static/icons/logo-192x192.png', 192],
    ['static/icons/logo-512x512.png', 512],
    ['static/icons/logo-maskable-180x180.png', 180],
    ['static/icons/logo-maskable-192x192.png', 192],
    ['static/icons/logo-maskable-512x512.png', 512],
    ['src-tauri/icons/icon.png', 512],
    ['src-tauri/icons/32x32.png', 32],
    ['src-tauri/icons/64x64.png', 64],
    ['src-tauri/icons/128x128.png', 128],
    ['src-tauri/icons/128x128@2x.png', 256],
    ['src-tauri/icons/StoreLogo.png', 50],
    ['src-tauri/icons/Square30x30Logo.png', 30],
    ['src-tauri/icons/Square44x44Logo.png', 44],
    ['src-tauri/icons/Square71x71Logo.png', 71],
    ['src-tauri/icons/Square89x89Logo.png', 89],
    ['src-tauri/icons/Square107x107Logo.png', 107],
    ['src-tauri/icons/Square142x142Logo.png', 142],
    ['src-tauri/icons/Square150x150Logo.png', 150],
    ['src-tauri/icons/Square284x284Logo.png', 284],
    ['src-tauri/icons/Square310x310Logo.png', 310],
    ['packaging/flatpak/icons/32x32.png', 32],
    ['packaging/flatpak/icons/64x64.png', 64],
    ['packaging/flatpak/icons/128x128.png', 128],
    ['packaging/flatpak/icons/256x256.png', 256],
  ];

  await Promise.all([
    ...pngTargets.map(([path, size]) => writeOut(path, pngForSize(size).png)),
    writeOut('src/lib/assets/favicon-unread.png', unread512),
    writeOut('src/lib/assets/favicon-highlight.png', highlight512),
    writeOut(
      'static/favicon.ico',
      encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngForSize(size).png })))
    ),
    writeOut(
      'src-tauri/icons/icon.ico',
      encodeIco(
        [16, 20, 24, 28, 32, 40, 48, 64, 256].map((size) => ({
          size,
          png: pngForSize(size).png,
        }))
      )
    ),
  ]);

  console.log(`Generated brand icons from ${inputPath}`);
}

await main();
