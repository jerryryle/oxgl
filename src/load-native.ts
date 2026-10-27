import { createRequire } from 'node:module';

/** Native interface exported by the oxgl addon. */
export interface NativeBinding {
  nativeAbiVersion(): number;
}

/** Version of the JS ↔ native interface this package was built for. */
export const NATIVE_ABI_VERSION = 1;

function nativeMissing(detail: string, cause?: unknown): Error {
  const error = new Error(
    `oxgl: no usable native addon for ${process.platform}-${process.arch}: ${detail}`,
    cause === undefined ? undefined : { cause },
  );
  return Object.assign(error, { code: 'OXGL_NATIVE_MISSING' });
}

/**
 * Loads the napi-rs loader (a CommonJS module, so it goes through
 * `createRequire`) and checks the addon's ABI version. Any failure becomes an
 * `Error` with `code: 'OXGL_NATIVE_MISSING'`.
 */
export function loadNative(specifier: string, parentUrl: string): NativeBinding {
  let binding: NativeBinding;
  try {
    binding = createRequire(parentUrl)(specifier) as NativeBinding;
  } catch (error) {
    throw nativeMissing(error instanceof Error ? error.message : String(error), error);
  }
  const version = binding.nativeAbiVersion();
  if (version !== NATIVE_ABI_VERSION) {
    throw nativeMissing(
      `addon ABI version ${String(version)} does not match package ABI version ${String(NATIVE_ABI_VERSION)}`,
    );
  }
  return binding;
}
