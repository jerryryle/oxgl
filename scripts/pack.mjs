// Packs the host's platform package (@oxgl-js/<platform>: the addon, its
// ANGLE libraries and THIRD_PARTY_NOTICES from dist/) and the `oxgl` package
// into <out-dir> (openspec release, "Packages released together"). The
// platform manifest is generated from the host's entry in `napi.targets`; the
// `oxgl` manifest gains `optionalDependencies` on every target at exactly the
// root version. Neither is written to the repository: a lockfile cannot record
// a package that is not published yet, so `npm ci` would fail if
// package.json listed them.
//
//     node scripts/pack.mjs <out-dir>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { platformString } from '../dist/resolve-native.js';

const SCOPE = '@oxgl-js';

// Target triple → the Node `process.platform`, `process.arch` and libc it runs on.
const OS = { linux: 'linux', darwin: 'darwin', windows: 'win32' };
const CPU = { x86_64: 'x64', aarch64: 'arm64' };

function hostOf(triple) {
  // <cpu>-<vendor>-<os>[-<abi>]: x86_64-unknown-linux-gnu, aarch64-apple-darwin.
  const [cpu, , os, abi] = triple.split('-');
  const platform = OS[os];
  const arch = CPU[cpu];
  if (platform === undefined || arch === undefined) throw new Error(`pack: unsupported target ${triple}`);
  return { platform, arch, libc: abi === 'gnu' ? 'glibc' : undefined };
}

/** Runs npm (npm.cmd on Windows, which needs a shell) and returns its stdout. */
function npm(args, cwd) {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/pack.mjs <out-dir>');
  process.exit(2);
}
const outDir = resolve(out);
mkdirSync(outDir, { recursive: true });

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const targets = root.napi.targets.map((triple) => {
  const host = hostOf(triple);
  return { ...host, name: `${SCOPE}/${platformString(host.platform, host.arch)}` };
});
const hostTarget = platformString(process.platform, process.arch);
const target = targets.find((t) => t.name === `${SCOPE}/${hostTarget}`);
if (target === undefined) throw new Error(`pack: ${hostTarget} is not in napi.targets`);

const stage = mkdtempSync(join(tmpdir(), 'oxgl-pack-'));
try {
  // The platform package mirrors dist/'s platform files.
  const addon = `oxgl.${hostTarget}.node`;
  const platformDir = join(stage, 'platform');
  mkdirSync(platformDir);
  for (const file of [addon, 'angle', 'THIRD_PARTY_NOTICES']) {
    const from = join('dist', file);
    if (!existsSync(from)) throw new Error(`pack: ${from} not found; run \`npm run build\` first`);
    cpSync(from, join(platformDir, file), { recursive: true });
  }
  cpSync('LICENSE', join(platformDir, 'LICENSE'));
  writeFileSync(
    join(platformDir, 'package.json'),
    `${JSON.stringify(
      {
        name: target.name,
        version: root.version,
        description: `oxgl's native addon and ANGLE libraries for ${hostTarget}`,
        license: root.license,
        repository: root.repository,
        os: [target.platform],
        cpu: [target.arch],
        ...(target.libc === undefined ? {} : { libc: [target.libc] }),
        files: [addon, 'angle', 'THIRD_PARTY_NOTICES', 'LICENSE'],
        publishConfig: { access: 'public' },
      },
      null,
      2,
    )}\n`,
  );

  // `oxgl` holds exactly the files `npm pack` would take from the repository,
  // with the optional dependencies added to its manifest.
  const rootDir = join(stage, 'oxgl');
  const [listing] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], '.'));
  for (const { path } of listing.files) {
    mkdirSync(join(rootDir, dirname(path)), { recursive: true });
    cpSync(path, join(rootDir, path));
  }
  const optionalDependencies = Object.fromEntries(targets.map((t) => [t.name, root.version]));
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ ...root, optionalDependencies }, null, 2)}\n`);

  for (const dir of [platformDir, rootDir]) {
    const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', outDir], dir));
    console.log(`pack: ${join(outDir, packed.filename)} (${String(packed.entryCount)} files)`);
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
