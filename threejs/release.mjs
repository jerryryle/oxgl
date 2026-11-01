// The pinned three.js release (pin.json) and its local copy under
// .cache/threejs/<sha>/: build/, examples/ and test/e2e/ at the pinned
// commit, fetched once and reused while the pin is unchanged.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCheckout, REPO_ROOT } from '../conformance/suite.mjs';

/** @returns {{ repository: string, tag: string, commit: string }} */
export function readPin() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'threejs', 'pin.json'), 'utf8'));
}

/** Returns the checkout of the pinned release, fetching it first when the cache has no copy. */
export function ensureRelease(pin = readPin(), cacheDir = join(REPO_ROOT, '.cache', 'threejs')) {
  return ensureCheckout(pin, cacheDir, { paths: ['/build/', '/examples/', '/test/e2e/'], marker: 'build/three.module.js' });
}

/**
 * The suite: every `examples/*.html` page under `root` except `index.html`
 * and the WebGPU examples, named without `.html`, sorted.
 */
export function listExamples(root) {
  return readdirSync(join(root, 'examples'))
    .filter((name) => name.endsWith('.html') && name !== 'index.html' && !name.startsWith('webgpu_'))
    .map((name) => name.slice(0, -'.html'.length))
    .sort();
}
