// Stages the ANGLE bundle resolved by oxgl-sys's build script next to the
// native addon (dist/angle/), and writes dist/THIRD_PARTY_NOTICES: the Rust
// crate notices from THIRD_PARTY_NOTICES followed by the license texts of
// every ANGLE bundle component.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The napi CLI builds with an explicit --target, so Cargo's output is under
// <target dir>/<triple>/release. Cargo resolves the target dir from
// CARGO_TARGET_DIR, build.target-dir in its config files, or the default, so
// ask it rather than guessing.
const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
};
const triple = TRIPLES[`${process.platform}-${process.arch}`];
const metadata = execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const targetDir = JSON.parse(metadata).target_directory;
const recorded = join(targetDir, triple ?? 'unsupported', 'release', 'oxgl-angle-dir');
if (!existsSync(recorded)) {
  console.error(`stage-angle: ${recorded} not found; build the native addon first (npm run build:native).`);
  process.exit(1);
}
const bundle = readFileSync(recorded, 'utf8').trim();

// The bundle's licenses were checked against deny.toml when it was built; the
// allowlist may have narrowed since, so re-check before staging anything.
// bundle.py owns the license rules, so both checks agree.
try {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3',
    ['angle/scripts/bundle.py', '--check-licenses', join(bundle, 'BUILD_INFO.json')], { stdio: 'inherit' });
} catch {
  process.exit(1);
}

const staged = join('dist', 'angle');
rmSync(staged, { recursive: true, force: true });
mkdirSync(staged, { recursive: true });
cpSync(join(bundle, 'lib'), staged, { recursive: true });

const info = JSON.parse(readFileSync(join(bundle, 'BUILD_INFO.json'), 'utf8'));
const licenseDir = join(bundle, 'licenses');
const licenseFiles = readdirSync(licenseDir).sort();
const sections = info.components.map((component) => {
  const texts = licenseFiles
    .filter((file) => file.startsWith(`${component.name}.`))
    .map((file) => readFileSync(join(licenseDir, file), 'utf8').trim());
  return [
    '-'.repeat(80),
    `${component.name} (${component.license}), ANGLE bundle ${info.bundle_version}`,
    '',
    ...texts,
    '',
  ].join('\n');
});

const crates = readFileSync('THIRD_PARTY_NOTICES', 'utf8').trimEnd();
writeFileSync(join('dist', 'THIRD_PARTY_NOTICES'), `${crates}\n\n${sections.join('\n')}`);
console.log(`stage-angle: staged ${bundle} into ${staged}`);
