import { fileURLToPath } from 'node:url';

import { loadNative, type NativeBinding } from './load-native.js';

/** The native addon, initialized for this thread's Node-API environment. */
export const native: NativeBinding = loadNative('./native.cjs', import.meta.url);

// The ANGLE libraries are staged next to the addon (scripts/stage-angle.mjs).
native.init(fileURLToPath(new URL('./angle/', import.meta.url)));
