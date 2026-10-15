import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Copies only what the extension loads at runtime into dist/, leaving out the
// source atlas, README previews and build scripts. No npm dependencies.
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const files = [
  'manifest.json',
  'LICENSE',
  'src/content.js',
  'src/content.css',
  'assets/cat-sprite.png',
  ...new Set(Object.values(manifest.icons))
];

const dist = join(root, 'dist');
const unpacked = join(dist, 'ragdoll-progress');
await rm(unpacked, { recursive: true, force: true });
for (const file of files) {
  await mkdir(join(unpacked, file, '..'), { recursive: true });
  await cp(join(root, file), join(unpacked, file));
}
console.log(`Unpacked extension: dist/ragdoll-progress (${files.length} files)`);

const zipName = `ragdoll-progress-${manifest.version}.zip`;
await rm(join(dist, zipName), { force: true });
try {
  await promisify(execFile)('zip', ['-qr', join(dist, zipName), '.'], { cwd: unpacked });
  console.log(`Zip for the Chrome Web Store: dist/${zipName}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('`zip` was not found; load dist/ragdoll-progress unpacked instead.');
}
