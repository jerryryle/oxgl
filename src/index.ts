import { loadNative } from './load-native.js';

const native = loadNative('./native.cjs', import.meta.url);

/** Version of the JS ↔ native interface reported by the loaded addon. */
export const nativeAbiVersion: number = native.nativeAbiVersion();
