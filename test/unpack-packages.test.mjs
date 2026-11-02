import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { unpackPackages } from '../scripts/unpack-packages.mjs';

// The fake main package's platform name, so the test sees that the unpacked
// platformString chooses the platform tarball.
const RESOLVE_NATIVE = "export const platformString = (platform, arch) => `fake-${platform}-${arch}`;\n";

/** Writes `files` (path → content) under `package/` and packs them as `<dir>/<name>`, as `npm pack` lays them out. */
function tarball(dir, name, files) {
  const src = mkdtempSync(join(dir, 'src-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(src, 'package', path)), { recursive: true });
    writeFileSync(join(src, 'package', path), content);
  }
  // Written through stdout, so tar gets no absolute path (see the script).
  const result = spawnSync('tar', ['-czf', '-', 'package'], { cwd: src, maxBuffer: 1 << 20 });
  assert.equal(result.status, 0, String(result.stderr));
  writeFileSync(join(dir, name), result.stdout);
}

/** A temporary directory, absolute as $RUNNER_TEMP is in CI, holding `packages/` and the target `dist/`. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oxgl-unpack-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = join(root, 'packages');
  mkdirSync(packages);
  return { packages, dist: join(root, 'dist') };
}

const HOST = { platform: 'testos', arch: 'arm64' };

function mainTarball(packages) {
  tarball(packages, 'oxgl-js-oxgl-1.2.3.tgz', {
    'package.json': '{}',
    'dist/index.js': 'export {};\n',
    'dist/resolve-native.js': RESOLVE_NATIVE,
    'dist/generated/webgl-constants.js': 'export {};\n',
  });
}

function platformTarball(packages, platform, version = '1.2.3') {
  tarball(packages, `oxgl-js-${platform}-${version}.tgz`, {
    'package.json': '{}',
    LICENSE: 'license\n',
    [`oxgl.${platform}.node`]: platform,
    'angle/libEGL': 'egl',
    THIRD_PARTY_NOTICES: 'notices\n',
  });
}

test('unpacks the main package and the host platform package into dist/', async (t) => {
  const { packages, dist } = fixture(t);
  mainTarball(packages);
  platformTarball(packages, 'fake-testos-arm64');
  platformTarball(packages, 'fake-otheros-x64');
  await unpackPackages(packages, dist, HOST);
  assert.deepEqual(readdirSync(dist).sort(), [
    'THIRD_PARTY_NOTICES',
    'angle',
    'generated',
    'index.js',
    'oxgl.fake-testos-arm64.node',
    'resolve-native.js',
  ]);
  assert.equal(readFileSync(join(dist, 'oxgl.fake-testos-arm64.node'), 'utf8'), 'fake-testos-arm64');
  assert.equal(readFileSync(join(dist, 'angle', 'libEGL'), 'utf8'), 'egl');
  assert.ok(existsSync(join(dist, 'generated', 'webgl-constants.js')));
});

test('fails when the host platform tarball is missing', async (t) => {
  const { packages, dist } = fixture(t);
  mainTarball(packages);
  platformTarball(packages, 'fake-otheros-x64');
  await assert.rejects(unpackPackages(packages, dist, HOST), /oxgl-js-fake-testos-arm64-1\.2\.3\.tgz not found/);
});

test('fails when the platform tarball is at another version', async (t) => {
  const { packages, dist } = fixture(t);
  mainTarball(packages);
  platformTarball(packages, 'fake-testos-arm64', '1.2.4');
  await assert.rejects(unpackPackages(packages, dist, HOST), /oxgl-js-fake-testos-arm64-1\.2\.3\.tgz not found/);
});

test('fails without exactly one main tarball', async (t) => {
  const { packages, dist } = fixture(t);
  platformTarball(packages, 'fake-testos-arm64');
  await assert.rejects(unpackPackages(packages, dist, HOST), /expected one oxgl-js-oxgl-<version>\.tgz .*found 0/);
  mainTarball(packages);
  tarball(packages, 'oxgl-js-oxgl-1.2.4.tgz', { 'dist/resolve-native.js': RESOLVE_NATIVE });
  await assert.rejects(unpackPackages(packages, dist, HOST), /found 2/);
});

test('refuses to unpack over an existing dist/', async (t) => {
  const { packages, dist } = fixture(t);
  mainTarball(packages);
  platformTarball(packages, 'fake-testos-arm64');
  mkdirSync(dist);
  await assert.rejects(unpackPackages(packages, dist, HOST), /already exists/);
});
