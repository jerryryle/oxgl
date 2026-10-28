// The pinned Khronos suite (suite.json) and its local copy under
// .cache/conformance/<sha>/: a blobless, sparse, depth-1 checkout of sdk/tests
// at the pinned commit, fetched once and reused while the pin is unchanged.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {{ repository: string, commit: string, versions: { webgl1: string, webgl2: string } }} */
export function readPin() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'conformance', 'suite.json'), 'utf8'));
}

/**
 * Returns the `sdk/tests` directory of the pinned commit, fetching it first
 * when the cache has no copy.
 */
export function ensureSuite(pin = readPin(), cacheDir = join(REPO_ROOT, '.cache', 'conformance')) {
  const checkout = join(cacheDir, pin.commit);
  const tests = join(checkout, 'sdk', 'tests');
  if (existsSync(join(tests, '00_test_list.txt'))) return tests;

  // Fetch into a scratch directory of this process's own and rename it into
  // place, so an interrupted fetch never looks like a complete copy and two
  // runs fetching at once do not share one.
  const scratch = `${checkout}.partial-${process.pid}`;
  removeAbandoned(cacheDir, pin.commit);
  mkdirSync(scratch, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: ['ignore', 'ignore', 'inherit'] });
  console.error(`conformance: fetching ${pin.repository} at ${pin.commit}`);
  git('init', '--quiet');
  git('remote', 'add', 'origin', pin.repository);
  git('sparse-checkout', 'set', '--no-cone', '/sdk/tests/');
  git('fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', pin.commit);
  git('checkout', '--quiet', 'FETCH_HEAD');
  // A copy without its test list is incomplete (edited or partly deleted).
  if (existsSync(checkout) && !existsSync(join(tests, '00_test_list.txt'))) rmSync(checkout, { recursive: true, force: true });
  try {
    renameSync(scratch, checkout);
  } catch (error) {
    // Another run finished first; its copy is the same commit.
    if (!existsSync(join(tests, '00_test_list.txt'))) throw error;
  }
  rmSync(scratch, { recursive: true, force: true });
  return tests;
}

/** A fetch takes seconds; a scratch directory this old is abandoned whatever its pid now names. */
const ABANDONED_MS = 60 * 60 * 1000;

/** Removes scratch directories of interrupted fetches: their process is gone, or they are too old to be in use. */
function removeAbandoned(cacheDir, commit) {
  if (!existsSync(cacheDir)) return;
  const prefix = `${commit}.partial-`;
  for (const name of readdirSync(cacheDir)) {
    if (!name.startsWith(prefix)) continue;
    const dir = join(cacheDir, name);
    const pid = Number(name.slice(prefix.length));
    const recent = Date.now() - statSync(dir).mtimeMs < ABANDONED_MS;
    if (pid !== process.pid && recent && isAlive(pid)) continue;
    rmSync(dir, { recursive: true, force: true });
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error?.code === 'EPERM';
  }
}
