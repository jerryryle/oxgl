import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadNative, type NativeBinding } from './load-native.js';
import { resolveNative } from './resolve-native.js';

const require = createRequire(import.meta.url);

// A local build stages the addon and ANGLE in dist/ (scripts/stage-angle.mjs);
// an installed package gets them from the host's @oxgl-js platform package.
const resolved = resolveNative(
  {
    platform: process.platform,
    arch: process.arch,
    isMusl: () => {
      const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
      return report.header?.glibcVersionRuntime === undefined;
    },
  },
  {
    distDir: fileURLToPath(new URL('.', import.meta.url)),
    exists: existsSync,
    packageDir: (name) => {
      try {
        return dirname(require.resolve(`${name}/package.json`));
      } catch {
        return undefined;
      }
    },
    optionalDependencies: () => {
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        optionalDependencies?: Record<string, string>;
      };
      return manifest.optionalDependencies;
    },
  },
);

/** The native addon, initialized for this thread's Node-API environment. */
export const native: NativeBinding = loadNative(resolved.addon, import.meta.url);

native.init(resolved.libDir);
