// Packs the host's platform package (@oxgl-js/<platform>: the addon, its
// ANGLE libraries and THIRD_PARTY_NOTICES from dist/, and a README from
// scripts/platform-README.md) and the main package,
// @oxgl-js/oxgl, into <out-dir> (openspec release, "Packages released
// together"). The platform manifest is generated from the host's entry in
// `napi.targets`; the main manifest gains `optionalDependencies` on every
// target at exactly the root version. Neither is written to the repository:
// a lockfile cannot record a package that is not published yet, so `npm ci`
// would fail if package.json listed them.
//
//     node scripts/pack.mjs <out-dir>
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { platformString } from '../dist/resolve-native.js';
import { npm as runNpm } from './npm.mjs';

const SCOPE = '@oxgl-js';

// Target triple → the Node `process.platform`, `process.arch` and libc it
// runs on, and the OS's name in the README.
const OS = {
  linux: { platform: 'linux', label: 'Linux' },
  darwin: { platform: 'darwin', label: 'macOS' },
  windows: { platform: 'win32', label: 'Windows' },
};
const CPU = { x86_64: 'x64', aarch64: 'arm64' };

function hostOf(triple) {
  // <cpu>-<vendor>-<os>[-<abi>]: x86_64-unknown-linux-gnu, aarch64-apple-darwin.
  const [cpu, , os, abi] = triple.split('-');
  const arch = CPU[cpu];
  if (OS[os] === undefined || arch === undefined) throw new Error(`pack: unsupported target ${triple}`);
  return { ...OS[os], arch, libc: abi === 'gnu' ? 'glibc' : undefined };
}

/**
 * The platform package's README: scripts/platform-README.md with the package
 * name and the platform's label filled in (openspec release, "Platform
 * packages point to the main package").
 */
function readme({ name, label, arch, libc }) {
  const values = { package: name, platform: `${label} ${arch}${libc === undefined ? '' : ` (${libc})`}` };
  let text = readFileSync(new URL('platform-README.md', import.meta.url), 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{{${key}}}`;
    if (!text.includes(placeholder)) throw new Error(`pack: scripts/platform-README.md has no ${placeholder}`);
    text = text.replaceAll(placeholder, () => value);
  }
  const left = text.match(/\{\{[^}\n]*\}*/g);
  if (left !== null) throw new Error(`pack: scripts/platform-README.md has unknown placeholders ${left.join(', ')}`);
  return text;
}

/** Runs npm in `cwd` and returns its stdout. */
function npm(args, cwd) {
  return runNpm(args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
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
const platformReadme = readme(target);

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
  writeFileSync(join(platformDir, 'README.md'), platformReadme);
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

  // The main package holds exactly the files `npm pack` would take from the
  // repository, with the optional dependencies added to its manifest.
  const rootDir = join(stage, 'main');
  const [listing] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], '.'));
  // The addon and ANGLE belong in the platform package only (openspec
  // licensing). The smoke test can't catch them here: the loader prefers
  // the main package's own dist/, so it would never load the platform package.
  const native = listing.files.filter(({ path }) => path.endsWith('.node') || /(^|\/)angle\//.test(path));
  if (native.length > 0) {
    throw new Error(`pack: the ${root.name} package must not contain ${native.map(({ path }) => path).join(', ')}; check package.json "files"`);
  }
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
