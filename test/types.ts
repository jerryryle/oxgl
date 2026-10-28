// Type tests for the public API, checked by `tsc -p test/tsconfig.json`
// (part of `npm run lint:js`). Never executed.
import {
  createContext,
  type ContextOptions,
  WebGL2RenderingContext,
  WebGLRenderingContext,
} from '../src/index.js';

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- the standard type-equality idiom */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>(): T | undefined {
  return undefined;
}
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

const gl1 = createContext({ width: 1, height: 1 });
const gl1Explicit = createContext({ width: 1, height: 1, webgl2: false, backend: 'software' });
const gl2 = createContext({ width: 1, height: 1, webgl2: true, backend: 'gpu' });
declare const options: ContextOptions;
const either = createContext(options);

expectType<Equal<typeof gl1, WebGLRenderingContext>>();
expectType<Equal<typeof gl1Explicit, WebGLRenderingContext>>();
expectType<Equal<typeof gl2, WebGL2RenderingContext>>();
expectType<Equal<typeof either, WebGLRenderingContext | WebGL2RenderingContext>>();

expectType<Equal<typeof gl1.COLOR_BUFFER_BIT, 0x00004000>>();
expectType<Equal<typeof WebGL2RenderingContext.CONTEXT_LOST_WEBGL, 0x9242>>();
expectType<Equal<ReturnType<typeof gl2.getError>, number>>();
export { gl1Explicit, gl2, either };

gl1.clearColor(0, 0, 0, 1);
gl1.clear(gl1.COLOR_BUFFER_BIT);
gl1.readPixels(0, 0, 1, 1, gl1.RGBA, gl1.UNSIGNED_BYTE, new Uint8Array(4));
gl1.readPixels(0, 0, 1, 1, gl1.RGBA, gl1.UNSIGNED_BYTE, null);
gl1.destroy();

// @ts-expect-error -- drawing buffer attributes are read-only
gl1.drawingBufferWidth = 5;
// @ts-expect-error -- unknown backend
createContext({ width: 1, height: 1, backend: 'metal' });
// @ts-expect-error -- height is required
createContext({ width: 1 });
// @ts-expect-error -- readPixels needs a destination
gl1.readPixels(0, 0, 1, 1, gl1.RGBA, gl1.UNSIGNED_BYTE);
