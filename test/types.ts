// Type tests for the public API, checked by `tsc -p test/tsconfig.json`
// (part of `npm run lint:js`). Never executed.
import {
  createContext,
  type ContextOptions,
  HeadlessCanvas,
  type WebGLContextAttributes,
  WebGL2RenderingContext,
  WebGLRenderingContext,
  WebGLShaderPrecisionFormat,
  type WebGLActiveInfo,
  type WebGLBuffer,
  type WebGLFramebuffer,
  type WebGLRenderbuffer,
  type WebGLObject,
  type WebGLProgram,
  type WebGLSampler,
  type WebGLShader,
  type WebGLTexture,
  type WebGLUniformLocation,
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
expectType<Equal<typeof WebGLRenderingContext.RGBA, 0x1908>>();
expectType<Equal<typeof WebGLRenderingContext.prototype.RGBA, 0x1908>>();
expectType<Equal<typeof gl1.RGBA, 0x1908>>();
expectType<Equal<typeof gl2.READ_BUFFER, 0x0c02>>();
expectType<Equal<typeof WebGL2RenderingContext.TIMEOUT_IGNORED, -1>>();
// @ts-expect-error -- WebGL 2-only constant on the WebGL 1 interface object
expectType<Equal<typeof WebGLRenderingContext.READ_BUFFER, 0x0c02>>();
// @ts-expect-error -- WebGL 2-only constant on a WebGL 1 context
expectType<Equal<typeof gl1.READ_BUFFER, 0x0c02>>();

function narrowed(value: unknown): number | undefined {
  if (value instanceof WebGLRenderingContext) {
    expectType<Equal<typeof value, WebGLRenderingContext>>();
    return value.COLOR_BUFFER_BIT;
  }
  if (value instanceof WebGL2RenderingContext) return value.READ_BUFFER;
  return undefined;
}
const asType: WebGLRenderingContext | WebGL2RenderingContext = either;
export { gl1Explicit, gl2, either, narrowed, asType };

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

expectType<Equal<ReturnType<typeof gl1.getParameter>, unknown>>();
expectType<Equal<ReturnType<typeof gl1.getShaderPrecisionFormat>, WebGLShaderPrecisionFormat | null>>();
expectType<Equal<ReturnType<typeof gl2.isEnabled>, boolean>>();
expectType<Equal<ReturnType<typeof gl2.getSupportedExtensions>, string[] | null>>();
declare const precision: WebGLShaderPrecisionFormat;
expectType<Equal<typeof precision.rangeMin, number>>();
// @ts-expect-error -- the attributes are read-only
precision.precision = 1;

// drawing-buffer: attributes, canvas, resize.
const withAttributes = createContext({
  width: 0,
  height: 4,
  attributes: { alpha: false, powerPreference: 'low-power' },
  canvas: {},
});
expectType<Equal<ReturnType<typeof withAttributes.getContextAttributes>, WebGLContextAttributes | null>>();
expectType<Equal<typeof withAttributes.canvas, object>>();
withAttributes.resize(8, 8);
declare const headless: HeadlessCanvas;
expectType<Equal<typeof headless.width, number>>();
const asTarget: EventTarget = headless;
export { asTarget };
// @ts-expect-error -- unknown power preference
createContext({ width: 1, height: 1, attributes: { powerPreference: 'fast' } });
// @ts-expect-error -- HeadlessCanvas is not constructible from user code
new HeadlessCanvas();

// core-rendering: objects and their methods.
const glr = createContext({ width: 1, height: 1, webgl2: true });
const buffer: WebGLBuffer = glr.createBuffer();
const shaderOrNull: WebGLShader | null = glr.createShader(glr.VERTEX_SHADER);
const programObject: WebGLProgram = glr.createProgram();
glr.bindBuffer(glr.ARRAY_BUFFER, buffer);
glr.bufferData(glr.ARRAY_BUFFER, new Float32Array(4), glr.STATIC_DRAW);
glr.bufferData(glr.ARRAY_BUFFER, 16, glr.STATIC_DRAW);
glr.getBufferSubData(glr.ARRAY_BUFFER, 0, new Uint8Array(4));
const where: WebGLUniformLocation | null = glr.getUniformLocation(programObject, 'u');
glr.uniform4fv(where, [1, 2, 3, 4]);
glr.uniform2ui(where, 1, 2);
const info: WebGLActiveInfo | null = glr.getActiveUniform(programObject, 0);
const asObject: WebGLObject = buffer;
export { shaderOrNull, info, asObject };
// @ts-expect-error -- a shader is not a buffer
glr.bindBuffer(glr.ARRAY_BUFFER, shaderOrNull as WebGLShader);

// textures.
const texture: WebGLTexture = glr.createTexture();
glr.bindTexture(glr.TEXTURE_2D, texture);
glr.texImage2D(glr.TEXTURE_2D, 0, glr.RGBA, 1, 1, 0, glr.RGBA, glr.UNSIGNED_BYTE, new Uint8Array(4));
glr.texImage2D(glr.TEXTURE_2D, 0, glr.RGBA, glr.RGBA, glr.UNSIGNED_BYTE, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
glr.texStorage2D(glr.TEXTURE_2D, 1, glr.RGBA8, 1, 1);
const sampler: WebGLSampler = glr.createSampler();
glr.bindSampler(0, sampler);
// @ts-expect-error -- a texture is not a sampler
glr.bindSampler(0, texture);

// framebuffers.
const framebuffer: WebGLFramebuffer = glr.createFramebuffer();
const renderbuffer: WebGLRenderbuffer = glr.createRenderbuffer();
glr.bindFramebuffer(glr.FRAMEBUFFER, framebuffer);
glr.bindRenderbuffer(glr.RENDERBUFFER, renderbuffer);
glr.framebufferRenderbuffer(glr.FRAMEBUFFER, glr.COLOR_ATTACHMENT0, glr.RENDERBUFFER, renderbuffer);
glr.drawBuffers([glr.COLOR_ATTACHMENT0]);
glr.blitFramebuffer(0, 0, 1, 1, 0, 0, 1, 1, glr.COLOR_BUFFER_BIT, glr.NEAREST);
glr.readPixels(0, 0, 1, 1, glr.RGBA, glr.UNSIGNED_BYTE, 0);
// @ts-expect-error -- a renderbuffer is not a framebuffer
glr.bindFramebuffer(glr.FRAMEBUFFER, renderbuffer);
