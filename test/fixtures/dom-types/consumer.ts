// A consumer that type-checks with the DOM library and without @types/node
// (pixel-readback: "PNG result typed without Node types").
import { createContext, encodePNG } from '../../../dist/index.js';

const gl = createContext({ width: 1, height: 1 });
export const png: Promise<Uint8Array> = encodePNG(gl);
