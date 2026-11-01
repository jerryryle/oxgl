// Publishes the packed packages in <dir> (openspec release): every platform
// package before `oxgl`, skipping any version npm already has, so a rerun
// completes a release that failed partway. Then tags the commit and creates
// the GitHub Release, unless it exists. With --dry-run it reports what it
// would do and changes nothing.
//
//     node scripts/release.mjs <dir> [--dry-run]
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = args.find((arg) => arg !== '--dry-run');
if (!dir) {
  console.error('usage: node scripts/release.mjs <dir> [--dry-run]');
  process.exit(2);
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
}

/** Whether `command` exits zero, with its output discarded. */
function succeeds(command, commandArgs) {
  try {
    execFileSync(command, commandArgs, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Reads a tarball's manifest. */
function manifest(tarball) {
  return JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']));
}

const packages = readdirSync(dir)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => {
    const tarball = join(dir, file);
    return { tarball, ...manifest(tarball) };
  });
const main = packages.filter((pkg) => pkg.name === 'oxgl');
if (main.length !== 1) throw new Error(`release: expected one oxgl tarball in ${dir}, found ${String(main.length)}`);
const [oxgl] = main;
const platforms = packages.filter((pkg) => pkg !== oxgl);
const { version } = oxgl;

// The tarballs must be one release: every optional dependency present, at
// exactly the release version.
const expected = Object.entries(oxgl.optionalDependencies ?? {});
const found = new Map(platforms.map((pkg) => [pkg.name, pkg.version]));
for (const [name, range] of expected) {
  if (range !== version || found.get(name) !== version) {
    throw new Error(`release: ${name}@${version} is missing (found ${found.get(name) ?? 'none'}, oxgl lists ${range})`);
  }
}
if (platforms.length !== expected.length) {
  throw new Error(`release: ${dir} holds packages oxgl does not list: ${[...found.keys()].join(', ')}`);
}

for (const pkg of [...platforms, oxgl]) {
  if (succeeds('npm', ['view', `${pkg.name}@${version}`, 'version'])) {
    console.log(`release: ${pkg.name}@${version} is already on npm`);
  } else if (dryRun) {
    console.log(`release: would publish ${pkg.name}@${version} from ${pkg.tarball}`);
  } else {
    run('npm', ['publish', pkg.tarball, '--provenance', '--access', 'public'], { stdio: 'inherit' });
  }
}

const tag = `v${version}`;
if (succeeds('gh', ['release', 'view', tag])) {
  console.log(`release: GitHub Release ${tag} exists`);
} else if (dryRun) {
  console.log(`release: would create GitHub Release ${tag} on ${process.env.GITHUB_SHA ?? 'HEAD'}`);
} else {
  const sha = process.env.GITHUB_SHA;
  if (!sha) throw new Error('release: GITHUB_SHA is not set');
  run('gh', ['release', 'create', tag, '--target', sha, '--title', tag, '--generate-notes'], { stdio: 'inherit' });
}
