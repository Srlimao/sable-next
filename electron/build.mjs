import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserCsp } from '../scripts/build/csp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const appVersion =
  process.env.VITE_APP_VERSION ||
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const release = process.argv.includes('--release');
const out = join(here, 'dist');
const addons = process.platform === 'freebsd' ? ['sable_node'] : ['sable_node', 'sable_audiofox'];

execFileSync(
  'cargo',
  [
    'build',
    ...addons.flatMap((name) => ['-p', name.replace('_', '-')]),
    ...(release ? ['--release'] : []),
  ],
  {
    cwd: root,
    stdio: 'inherit',
  }
);

const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target');
mkdirSync(out, { recursive: true });
for (const name of addons) {
  const library = {
    darwin: `lib${name}.dylib`,
    freebsd: `lib${name}.so`,
    linux: `lib${name}.so`,
    win32: `${name}.dll`,
  }[process.platform];
  const built = join(target, release ? 'release' : 'debug');
  copyFileSync(join(built, library), join(out, `${name}.node`));
  const pdb = join(built, `${name}.pdb`);
  if (process.platform === 'win32' && existsSync(pdb)) copyFileSync(pdb, join(out, `${name}.pdb`));
}

if (process.platform === 'linux') {
  const prebuild = join(
    here,
    'node_modules/@vencord/venmic/prebuilds',
    `venmic-addon-linux-${process.arch}`,
    'node-napi-v7.node'
  );
  if (existsSync(prebuild)) copyFileSync(prebuild, join(out, `venmic-${process.arch}.node`));
}

const { csp } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app
  .security;
const policy = browserCsp(csp);

await build({
  entryPoints: {
    main: join(here, 'src/main.ts'),
    preload: join(here, 'src/preload.ts'),
    'overlay-preload': join(here, 'src/overlay-preload.ts'),
    'core-host': join(here, 'src/core-host.ts'),
    'audiofox-host': join(here, 'src/audiofox-host.ts'),
  },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', './sable_node.node'],
  define: {
    __SABLE_CSP__: JSON.stringify(policy),
    __SABLE_IDENTIFIER__: JSON.stringify(process.env.SABLE_IDENTIFIER ?? 'moe.sable.next'),
    __SABLE_APP_VERSION__: JSON.stringify(appVersion),
    __SABLE_SENTRY__: JSON.stringify({
      dsn: process.env.VITE_SENTRY_DSN,
      environment: process.env.VITE_SENTRY_ENVIRONMENT,
      release: process.env.VITE_APP_VERSION,
    }),
  },
  sourcemap: true,
});

await build({
  entryPoints: {
    'overlay-renderer': join(here, 'src/overlay-renderer.ts'),
  },
  outdir: out,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  sourcemap: true,
});

writeFileSync(
  join(out, 'overlay.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:;"
    />
    <title>Sable Voice Overlay</title>
    <style>
      html, body, #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="./overlay-renderer.js"></script>
  </body>
</html>
`
);
