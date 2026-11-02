import { join } from 'node:path';

import { nativeMissing } from './load-native.js';

/** Scope of the per-platform packages that carry the addon and ANGLE. */
const SCOPE = '@oxgl-js';

/** The host to resolve for: `process.platform`, `process.arch` and a libc probe. */
export interface NativeHost {
  platform: string;
  arch: string;
  /** Whether the host's libc is musl. Expensive, so called only on failure. */
  isMusl(): boolean;
}

/** The filesystem and module lookups resolution needs. */
export interface NativeLookup {
  /** Directory of this package's own build output (`dist/`). */
  distDir: string;
  exists(path: string): boolean;
  /** Directory of an installed package, or `undefined` if it isn't installed. */
  packageDir(name: string): string | undefined;
  /** This package's `optionalDependencies`, or `undefined` in a checkout. */
  optionalDependencies(): Record<string, string> | undefined;
}

/** Where to load the addon and ANGLE from. */
export interface ResolvedNative {
  addon: string;
  libDir: string;
}

/**
 * napi-rs's platform string for a host: `linux-arm64-gnu`, `darwin-arm64`,
 * `win32-x64-msvc`. It names both the addon (`oxgl.<platform>.node`) and its
 * package (`@oxgl-js/<platform>`), as scripts/pack.mjs derives them from
 * `napi.targets`.
 */
export function platformString(platform: string, arch: string): string {
  const abi = platform === 'linux' ? '-gnu' : platform === 'win32' ? '-msvc' : '';
  return `${platform}-${arch}${abi}`;
}

/**
 * Finds the addon and ANGLE directory: a local build in `dist/` first, then the
 * host's platform package. A directory counts only if it holds both, since
 * ANGLE itself loads lazily on the first context. Throws `OXGL_NATIVE_MISSING`
 * when neither has them.
 */
export function resolveNative(host: NativeHost, lookup: NativeLookup): ResolvedNative {
  const target = platformString(host.platform, host.arch);
  const pkg = `${SCOPE}/${target}`;
  const file = `oxgl.${target}.node`;
  const pkgDir = lookup.packageDir(pkg);
  for (const dir of pkgDir === undefined ? [lookup.distDir] : [lookup.distDir, pkgDir]) {
    const addon = join(dir, file);
    const libDir = join(dir, 'angle');
    if (lookup.exists(addon) && lookup.exists(libDir)) return { addon, libDir };
  }
  const hostName = `${host.platform}-${host.arch}`;
  const listed = lookup.optionalDependencies();
  if (listed === undefined) {
    throw nativeMissing(`no addon in ${lookup.distDir}; run \`npm run build\``, undefined, hostName);
  }
  if (host.platform === 'linux' && host.isMusl()) {
    throw nativeMissing(`no build for ${hostName} with musl libc; oxgl needs glibc`, undefined, hostName);
  }
  if (!(pkg in listed)) {
    throw nativeMissing(`no build for ${hostName}`, undefined, hostName);
  }
  if (pkgDir === undefined) {
    throw nativeMissing(
      `${pkg} is not installed; reinstall @oxgl-js/oxgl without omitting optional dependencies`,
      undefined,
      hostName,
    );
  }
  throw nativeMissing(`${pkg} in ${pkgDir} lacks ${file} or angle/`, undefined, hostName);
}
