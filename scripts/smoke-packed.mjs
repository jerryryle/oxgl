// Installs the tarballs scripts/pack.mjs wrote into an empty project outside
// the repository, then renders with them there (openspec continuous-integration,
// "Packed packages are smoke-tested"). `npm install`, not `npm ci`: at an
// unpublished version the other platforms' packages return 404, and
// `npm install` skips missing optional dependencies.
//
//     node scripts/smoke-packed.mjs <dir-with-tarballs>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const from = process.argv[2];
if (!from) {
  console.error('usage: node scripts/smoke-packed.mjs <dir-with-tarballs>');
  process.exit(2);
}
const tarballs = readdirSync(from)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => resolve(from, file));
if (tarballs.length !== 2) throw new Error(`smoke: expected 2 tarballs in ${from}, found ${String(tarballs.length)}`);

// The rendering check, run by node inside the project so `oxgl` and its
// platform package resolve from that project's node_modules.
const CHECK = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createContext } from 'oxgl';

const resolved = createRequire(import.meta.url).resolve('oxgl');
assert.ok(resolved.startsWith(process.cwd()), \`oxgl resolved outside the project: \${resolved}\`);

const gl = createContext({ width: 4, height: 4, backend: 'software' });
gl.clearColor(0, 1, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
const pixels = new Uint8Array(4 * 4 * 4);
gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
gl.destroy();
for (let i = 0; i < pixels.length; i += 4) {
  assert.deepEqual([...pixels.subarray(i, i + 4)], [0, 255, 0, 255], \`pixel \${String(i / 4)}\`);
}
console.log(\`smoke: rendered with \${resolved}\`);
`;

const project = mkdtempSync(join(tmpdir(), 'oxgl-smoke-'));
try {
  writeFileSync(join(project, 'package.json'), '{ "private": true, "type": "module" }\n');
  writeFileSync(join(project, 'check.mjs'), CHECK);
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: project,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  execFileSync(process.execPath, ['check.mjs'], { cwd: project, stdio: 'inherit' });
} finally {
  rmSync(project, { recursive: true, force: true });
}
