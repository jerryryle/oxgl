// Test-list parsing, mirroring getFileList and greaterThanOrEqualToVersion in
// the pinned suite's js/webgl-test-harness.js so each suite selects exactly
// the pages the official harness runs for the same version.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Suite name → WebGL major version used for its contexts. */
export const SUITES = { webgl1: 1, webgl2: 2 };

/** Whether version `have` is at least `want` ("2.0.1 (beta)" compares as 2.0.1). */
export function versionAtLeast(have, want) {
  const h = have.split(' ')[0].split('.');
  const w = want.split(' ')[0].split('.');
  for (let i = 0; i < w.length; i += 1) {
    const wantNum = parseInt(w[i], 10);
    const haveNum = h[i] ? parseInt(h[i], 10) : 0;
    if (haveNum > wantNum) return true;
    if (haveNum < wantNum) return false;
  }
  return true;
}

/**
 * Lists the pages under `root` (the suite's sdk/tests) that the top-level
 * 00_test_list.txt selects for `version`, as paths relative to `root`, in
 * list order.
 */
export function listPages(root, version, readText = (path) => readFileSync(path, 'utf8')) {
  const pages = [];
  const visit = (listPath, inherited) => {
    const prefix = listPath.includes('/') ? listPath.slice(0, listPath.lastIndexOf('/') + 1) : '';
    const lines = readText(join(root, listPath)).split('\n');
    lines.forEach((raw, index) => {
      const line = raw.trim();
      // The harness ignores lines of four characters or fewer.
      if (line.length <= 4 || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) return;
      const where = `${listPath}:${index + 1}`;
      const args = line.split(/\s+/);
      const names = [];
      let minVersion;
      let maxVersion;
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith('-')) {
          names.push(arg);
        } else if (arg === '--slow') {
          // Only the harness's "fast" mode uses it.
        } else if (arg === '--min-version' || arg === '--max-version') {
          i += 1;
          if (args[i] === undefined) throw new Error(`${where}: ${arg} needs a value`);
          if (arg === '--min-version') minVersion = args[i];
          else maxVersion = args[i];
        } else {
          throw new Error(`${where}: unknown option ${arg}`);
        }
      }
      const path = prefix + names.join(' ');
      if (path.endsWith('.txt')) {
        // A list is always read; its versions become its entries' defaults.
        visit(path, {
          minVersion: minVersion ?? inherited.minVersion,
          maxVersion: maxVersion ?? inherited.maxVersion,
        });
        return;
      }
      const min = minVersion ?? inherited.minVersion;
      const max = maxVersion ?? inherited.maxVersion;
      if (versionAtLeast(version, min) && (max === undefined || versionAtLeast(max, version))) pages.push(path);
    });
  };
  visit('00_test_list.txt', { minVersion: '1.0', maxVersion: undefined });
  return pages;
}
