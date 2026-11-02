// Publishes the packed packages in <dir> (openspec release): every platform
// package before the main package, @oxgl-js/oxgl, skipping any version npm
// already has, so a rerun completes a release that failed partway. Then tags
// the commit and creates the GitHub Release, unless it exists. With --dry-run
// it reports what it would do and changes nothing, though it still hands each
// unpublished tarball to `npm publish --dry-run`.
//
//     node scripts/release.mjs <dir> [--dry-run]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { npm } from './npm.mjs';

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

/** Whether `start(options)` exits zero, with its output discarded. */
function succeeds(start) {
  try {
    start({ stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Reads the manifest of tarball `file` in `dir`. */
function manifest(file) {
  // From inside `dir`: GNU tar, Git Bash's on Windows, reads C:\... as host:path.
  return JSON.parse(run('tar', ['-xzOf', file, 'package/package.json'], { cwd: dir }));
}

const packages = readdirSync(dir)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => {
    // Absolute: npm reads a relative path without ./, like packages/x.tgz, as
    // a GitHub owner/repo shorthand.
    const tarball = resolve(dir, file);
    return { tarball, ...manifest(file) };
  });
// Told apart by manifest name, not file name: the main package packs to
// oxgl-js-oxgl-<version>.tgz, which looks like a platform tarball. Its name is
// the repository's, as scripts/pack.mjs packs it.
const MAIN = JSON.parse(readFileSync('package.json', 'utf8')).name;
const mains = packages.filter((pkg) => pkg.name === MAIN);
if (mains.length !== 1) throw new Error(`release: expected one ${MAIN} tarball in ${dir}, found ${String(mains.length)}`);
const [main] = mains;
const platforms = packages.filter((pkg) => pkg !== main);
const { version } = main;

// The tarballs must be one release: every optional dependency present, at
// exactly the release version.
const expected = Object.entries(main.optionalDependencies ?? {});
const found = new Map(platforms.map((pkg) => [pkg.name, pkg.version]));
for (const [name, range] of expected) {
  if (range !== version || found.get(name) !== version) {
    throw new Error(`release: ${name}@${version} is missing (found ${found.get(name) ?? 'none'}, ${MAIN} lists ${range})`);
  }
}
if (platforms.length !== expected.length) {
  throw new Error(`release: ${dir} holds packages ${MAIN} does not list: ${[...found.keys()].join(', ')}`);
}

for (const pkg of [...platforms, main]) {
  if (succeeds((options) => npm(['view', `${pkg.name}@${version}`, 'version'], options))) {
    console.log(`release: ${pkg.name}@${version} is already on npm`);
  } else {
    // Provenance needs CI's OIDC token, so a dry run leaves it out.
    console.log(`release: ${dryRun ? 'would publish' : 'publishing'} ${pkg.name}@${version} from ${pkg.tarball}`);
    npm(['publish', pkg.tarball, '--access', 'public', ...(dryRun ? ['--dry-run'] : ['--provenance'])], { stdio: 'inherit' });
  }
}

const tag = `v${version}`;
if (succeeds((options) => execFileSync('gh', ['release', 'view', tag], options))) {
  console.log(`release: GitHub Release ${tag} exists`);
} else if (dryRun) {
  console.log(`release: would create GitHub Release ${tag} on ${process.env.GITHUB_SHA ?? 'HEAD'}`);
} else {
  const sha = process.env.GITHUB_SHA;
  if (!sha) throw new Error('release: GITHUB_SHA is not set');
  run('gh', ['release', 'create', tag, '--target', sha, '--title', tag, '--generate-notes'], { stdio: 'inherit' });
}
