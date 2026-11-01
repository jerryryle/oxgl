import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { platformString, resolveNative } from '../dist/resolve-native.js';

const DIST = '/pkg/dist';
const PKG = '/pkg/node_modules/@oxgl-js/linux-x64-gnu';

/** A Linux x64 glibc host whose musl probe counts its calls. */
function host(overrides = {}) {
  const calls = { isMusl: 0 };
  const isMusl = overrides.musl ?? false;
  return {
    calls,
    host: {
      platform: 'linux',
      arch: 'x64',
      isMusl: () => {
        calls.isMusl += 1;
        return isMusl;
      },
      ...overrides.host,
    },
  };
}

/** A lookup over a fixed set of existing paths and installed packages. */
function lookup(options = {}) {
  const { files = [], packages = {} } = options;
  const optional = 'optional' in options ? options.optional : { '@oxgl-js/linux-x64-gnu': '0.1.0' };
  return {
    distDir: DIST,
    exists: (path) => files.includes(path),
    packageDir: (name) => packages[name],
    optionalDependencies: () => optional,
  };
}

function assertMissing(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, 'OXGL_NATIVE_MISSING');
    assert.match(error.message, pattern);
    return true;
  });
}

test('platform strings match the napi.targets file suffixes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const expected = {
    'x86_64-unknown-linux-gnu': ['linux', 'x64', 'linux-x64-gnu'],
    'aarch64-unknown-linux-gnu': ['linux', 'arm64', 'linux-arm64-gnu'],
    'aarch64-apple-darwin': ['darwin', 'arm64', 'darwin-arm64'],
    'x86_64-pc-windows-msvc': ['win32', 'x64', 'win32-x64-msvc'],
    'aarch64-pc-windows-msvc': ['win32', 'arm64', 'win32-arm64-msvc'],
  };
  assert.deepEqual(manifest.napi.targets.toSorted(), Object.keys(expected).toSorted());
  for (const [platform, arch, name] of Object.values(expected)) {
    assert.equal(platformString(platform, arch), name);
  }
});

test('a local build in dist/ takes precedence over the platform package', () => {
  const { host: h, calls } = host();
  const files = [
    join(DIST, 'oxgl.linux-x64-gnu.node'),
    join(DIST, 'angle'),
    join(PKG, 'oxgl.linux-x64-gnu.node'),
    join(PKG, 'angle'),
  ];
  const resolved = resolveNative(h, lookup({ files, packages: { '@oxgl-js/linux-x64-gnu': PKG } }));
  assert.deepEqual(resolved, { addon: join(DIST, 'oxgl.linux-x64-gnu.node'), libDir: join(DIST, 'angle') });
  assert.equal(calls.isMusl, 0, 'a successful resolution never probes libc');
});

test('the platform package is used when dist/ has no addon', () => {
  const { host: h, calls } = host();
  const files = [join(PKG, 'oxgl.linux-x64-gnu.node'), join(PKG, 'angle')];
  const resolved = resolveNative(h, lookup({ files, packages: { '@oxgl-js/linux-x64-gnu': PKG } }));
  assert.deepEqual(resolved, { addon: join(PKG, 'oxgl.linux-x64-gnu.node'), libDir: join(PKG, 'angle') });
  assert.equal(calls.isMusl, 0);
});

test('a directory with the addon but no angle/ is not chosen', () => {
  const { host: h } = host();
  const files = [join(PKG, 'oxgl.linux-x64-gnu.node')];
  assertMissing(
    () => resolveNative(h, lookup({ files, packages: { '@oxgl-js/linux-x64-gnu': PKG } })),
    /linux-x64: @oxgl-js\/linux-x64-gnu in .* lacks oxgl\.linux-x64-gnu\.node or angle\//,
  );
});

test('a listed but missing platform package is named', () => {
  const { host: h } = host();
  assertMissing(() => resolveNative(h, lookup()), /@oxgl-js\/linux-x64-gnu is not installed/);
});

test('a host with no build names no package to install', () => {
  const { host: h } = host({ host: { arch: 'ia32' } });
  assertMissing(() => resolveNative(h, lookup()), /linux-ia32: no build for linux-ia32$/);
});

test('a musl host is told it has no build', () => {
  const { host: h } = host({ musl: true });
  assertMissing(() => resolveNative(h, lookup()), /no build for linux-x64 with musl libc/);
});

test('a checkout with no optionalDependencies is told to build', () => {
  const { host: h, calls } = host();
  assertMissing(() => resolveNative(h, lookup({ optional: undefined })), /run `npm run build`/);
  assert.equal(calls.isMusl, 0);
});
