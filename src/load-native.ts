import { createRequire } from 'node:module';

/** Result of the native `createContext`: a key and size, or an error to throw. */
export interface NativeCreated {
  index: number;
  version: number;
  width: number;
  height: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Native interface exported by the oxgl addon. Arguments are already converted
 * per WebIDL; contexts are identified by their key's `index` and `version`.
 */
export interface NativeBinding {
  nativeAbiVersion(): number;
  init(libDir: string): void;
  createContext(backend: string, width: number, height: number, webgl2: boolean): NativeCreated;
  destroy(index: number, version: number): void;
  release(index: number, version: number): void;
  liveContexts(): number;
  clearColor(index: number, version: number, red: number, green: number, blue: number, alpha: number): void;
  clear(index: number, version: number, mask: number): void;
  getError(index: number, version: number): number;
  readPixels(
    index: number,
    version: number,
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void;
}

/** Version of the JS ↔ native interface this package was built for. */
export const NATIVE_ABI_VERSION = 2;

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
