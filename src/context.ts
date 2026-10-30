// WebGLRenderingContext / WebGL2RenderingContext and createContext.
//
// WebIDL argument conversion happens here, before native code runs, so native
// code never re-enters JS (conversions can call user `valueOf`). This file is
// the seam a WebIDL generator will own (src/generated/).
import type { NativeAttributes, NativeParameter, NativeTexArgs } from './load-native.js';
import { native } from './native.js';
import {
  objectState,
  type ProgramState,
  type ShaderState,
  WebGLActiveInfo,
  WebGLBuffer,
  WebGLFramebuffer,
  WebGLObject,
  WebGLRenderbuffer,
  WebGLQuery,
  WebGLSync,
  WebGLTransformFeedback,
  WebGLVertexArrayObject,
  type FramebufferState,
  type PendingState,
  type VertexArrayState,
  WebGLProgram,
  WebGLShader,
  WebGLSampler,
  WebGLShaderPrecisionFormat,
  WebGLTexture,
  WebGLUniformLocation,
  locationState,
  type ObjectState,
} from './objects.js';
import {
  CONSTRUCTING,
  exposeMembers,
  isBufferSource,
  requireArguments,
  toBoolean,
  toDOMString,
  toFloat,
  toList,
  toLong,
  toLongLong,
  toUnsignedLong,
  toUnsignedLongLong,
} from './webidl.js';
import { WEBGL1_CONSTANTS, WEBGL2_CONSTANTS } from './generated/webgl-constants.js';
import { createExtension, type ExtensionMap } from './extensions.js';

/** Backend for `createContext`; `OXGL_BACKEND` overrides it. */
export type ContextBackend = 'auto' | 'gpu' | 'software';

/** `WebGLPowerPreference` (WebGL 1.0 §5.2). */
export type WebGLPowerPreference = 'default' | 'low-power' | 'high-performance';

/** `WebGLContextAttributes` (WebGL 1.0 §5.2). */
export interface WebGLContextAttributes {
  alpha?: boolean;
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: WebGLPowerPreference;
  failIfMajorPerformanceCaveat?: boolean;
  desynchronized?: boolean;
}

/** Options for {@link createContext}. */
export interface ContextOptions {
  /** Drawing buffer width in pixels (a non-negative integer; 0 gives 1). */
  width: number;
  /** Drawing buffer height in pixels (a non-negative integer; 0 gives 1). */
  height: number;
  /** `'auto'` (default): GPU, else SwiftShader. `'gpu'`: GPU only. `'software'`: SwiftShader. */
  backend?: ContextBackend;
  /** Create a WebGL 2 context. */
  webgl2?: boolean;
  /** The object `gl.canvas` returns; a {@link HeadlessCanvas} when absent. */
  canvas?: object;
  /** Context creation attributes, as for `canvas.getContext`. */
  attributes?: WebGLContextAttributes | null;
}

const POWER_PREFERENCES: readonly string[] = ['default', 'low-power', 'high-performance'];
/** The largest canvas dimension HTML allows (`unsigned long` limited to 2^31 − 1). */
const MAX_DIMENSION = 2147483647;

const BACKENDS: readonly string[] = ['auto', 'gpu', 'software'];

type ContextKey = readonly [index: number, version: number];

/** Releases a garbage-collected context. Module-level and capture-free, so
 * neither it nor the held key keeps a context reachable. */
function releaseCollected(key: ContextKey): void {
  native.release(key[0], key[1]);
}

const collected = new FinalizationRegistry<ContextKey>(releaseCollected);

/** The JS value of a native `getParameter` result (WebGL 1.0 §5.14.3 table). */
function parameterValue(result: NativeParameter | null): unknown {
  if (result === null) return null;
  const { kind, numbers, text } = result;
  switch (kind) {
    case 'number':
      return numbers[0];
    case 'boolean':
      return numbers[0] !== 0;
    // Arrays are built here, not taken from native code: native arrays
    // belong to Node's main realm, and pages compare constructors.
    case 'booleans':
      return Array.from(numbers, (n) => n !== 0);
    case 'string':
      return text ?? '';
    case 'float32':
      return new Float32Array(numbers);
    case 'int32':
      return new Int32Array(numbers);
    case 'uint32':
      return new Uint32Array(numbers);
    case 'numbers':
      return Array.from(numbers);
  }
}


/**
 * A context's state. Bound objects are kept here, as Blink keeps them, so a
 * bound object is never collected and object-valued queries return the
 * object that was bound.
 */
export interface ContextState {
  readonly index: number;
  readonly version: number;
  readonly webgl2: boolean;
  /**
   * The context these are the state of, which a restore gives a new state.
   * Weak: objects reference their state, and must not keep a dropped
   * context (and its native context) alive.
   */
  readonly gl: WeakRef<ContextBase>;
  /** What created the native context, for creating it again on restore. */
  readonly creation: Creation;
  /** A loss was observed and its `webglcontextlost` task queued. */
  lossObserved: boolean;
  /** The loss came from `WEBGL_lose_context.loseContext()`. */
  lostByExtension: boolean;
  /** The `webglcontextlost` event was cancelled, so restoring is allowed. */
  restorable: boolean;
  restoreQueued: boolean;
  /**
   * Errors `WEBGL_lose_context` generates on a lost context, which
   * `getError` reports after `CONTEXT_LOST_WEBGL`, as Chromium does; other
   * calls on a lost context generate none.
   */
  readonly lostErrors: number[];
  // Zeroed by destroy(), as Chromium reports for a lost context.
  width: number;
  height: number;
  destroyed: boolean;
  lostReported: boolean;
  canvas: object;
  /** Buffer bindings by target, except `ELEMENT_ARRAY_BUFFER` (vertex array state). */
  readonly buffers: Map<number, WebGLBuffer | null>;
  vao: VertexArrayState;
  program: WebGLProgram | null;
  /** Per attribute: the type of the last `vertexAttrib*` setter (0 float, 1 int, 2 uint). */
  readonly attribKinds: number[];
  /** Per texture unit: the texture bound to each target. */
  readonly textureUnits: (Map<number, WebGLTexture | null> | undefined)[];
  /** Per texture unit: the bound sampler (WebGL 2). */
  readonly samplers: (WebGLSampler | null)[];
  /** `activeTexture` − `TEXTURE0`. */
  activeUnit: number;
  /** `MAX_COMBINED_TEXTURE_IMAGE_UNITS`. */
  maxUnits: number;
  /** The framebuffer bound for drawing; `null` is the drawing buffer. */
  drawFramebuffer: WebGLFramebuffer | null;
  /** The framebuffer bound for reading (WebGL 2; the same as drawing on WebGL 1). */
  readFramebuffer: WebGLFramebuffer | null;
  renderbuffer: WebGLRenderbuffer | null;
  /** The default vertex array's state. */
  readonly defaultVao: VertexArrayState;
  /** The bound vertex array: a `WebGLVertexArrayObject`, or on WebGL 1 a `WebGLVertexArrayObjectOES`. */
  vertexArray: WebGLObject | null;
  /** Enabled extensions' objects by canonical name. */
  readonly extensions: Map<string, object>;
  transformFeedback: WebGLTransformFeedback | null;
  /** The bound transform feedback's indexed buffer bindings. */
  tfBuffers: (WebGLBuffer | null)[];
  readonly defaultTfBuffers: (WebGLBuffer | null)[];
  readonly uniformBuffers: (WebGLBuffer | null)[];
  /** The active query per target. */
  readonly queries: Map<number, WebGLQuery>;
}

/**
 * The event loop's turn count, for query and sync results that must not
 * become available before control returns to the event loop (WebGL 2.0
 * §5.35). A pending result schedules one unreferenced timer.
 */
let turn = 0;
let turnScheduled = false;
function nextTurn(): number {
  if (!turnScheduled) {
    turnScheduled = true;
    const timer = setTimeout(() => {
      turn += 1;
      turnScheduled = false;
    }, 0) as unknown as { unref?: () => void };
    timer.unref?.();
  }
  return turn;
}

/** Detaches `object` from the bound framebuffers, as GL does when it is deleted (OpenGL ES 3.0 §4.4.2.4). */
function detach(s: ContextState, object: WebGLTexture | WebGLRenderbuffer): void {
  for (const framebuffer of [s.drawFramebuffer, s.readFramebuffer]) {
    if (framebuffer === null) continue;
    const { attachments } = objectState(framebuffer) as FramebufferState;
    for (const [point, attached] of attachments) if (attached === object) attachments.delete(point);
  }
}

/** The framebuffer bound to `target`. */
function framebufferFor(s: ContextState, target: number): WebGLFramebuffer | null {
  return target === GL.READ_FRAMEBUFFER ? s.readFramebuffer : s.drawFramebuffer;
}

/** The contexts of canvases, so a canvas can be a `TexImageSource`. */
const canvasContexts = new WeakMap<object, ContextState>();

/** The active unit's texture bindings. */
function unitOf(s: ContextState): Map<number, WebGLTexture | null> {
  let unit = s.textureUnits[s.activeUnit];
  if (unit === undefined) {
    unit = new Map();
    s.textureUnits[s.activeUnit] = unit;
  }
  return unit;
}

/** The arguments of a texture upload, converted per WebIDL in call order by the caller's argument order. */
function texArgs(
  target: unknown,
  level: unknown,
  internalformat: unknown,
  xoffset: unknown,
  yoffset: unknown,
  zoffset: unknown,
  width: unknown,
  height: unknown,
  depth: unknown,
  border: unknown,
  format: unknown,
  type: unknown,
): NativeTexArgs {
  return {
    target: toUnsignedLong(target),
    level: toLong(level),
    internalformat: toLong(internalformat),
    xoffset: toLong(xoffset),
    yoffset: toLong(yoffset),
    zoffset: toLong(zoffset),
    width: toLong(width),
    height: toLong(height),
    depth: toLong(depth),
    border: toLong(border),
    format: toUnsignedLong(format),
    ty: toUnsignedLong(type),
  };
}

interface Pixels {
  data: ArrayBufferView;
  width: number;
  height: number;
  /** An `ImageBitmap`'s pixels, uploaded without the flip and premultiply unpack parameters. */
  asIs?: boolean;
}

const EMPTY: Pixels = { data: new Uint8Array(0), width: 0, height: 0 };

interface Canvas2D {
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayBufferView };
  drawImage?(image: unknown, x: number, y: number): void;
}

/** The 2D context of an object with `getContext('2d')`, if it has one. */
function context2d(canvas: unknown): Canvas2D | null {
  const getContext = (canvas as { getContext?: unknown }).getContext;
  if (typeof getContext !== 'function') return null;
  const context = (getContext as (type: string) => unknown).call(canvas, '2d') as Partial<Canvas2D> | null;
  return context !== null && typeof context === 'object' && typeof context.getImageData === 'function'
    ? (context as Canvas2D)
    : null;
}

/**
 * What compositing does to `gl`'s drawing buffer in a browser: cleared when
 * `preserveDrawingBuffer` is false. For hosts that composite canvases (the
 * conformance runner's DOM); headless contexts are never composited.
 */
export function presentDrawingBuffer(gl: ContextBase): void {
  const s = contextState(gl);
  if (!s.destroyed) native.presentDrawingBuffer(s.index, s.version);
}

/**
 * The drawing buffer of the oxgl context on `canvas` as unpremultiplied
 * RGBA8, top row first, or `undefined` when no oxgl context draws for it:
 * what a host that displays or exports canvases (the conformance runner's
 * DOM) shows for a WebGL canvas.
 */
export function canvasPixels(canvas: object): Pixels | undefined {
  const owner = canvasContexts.get(canvas);
  if (owner === undefined) return undefined;
  if (owner.destroyed) return EMPTY;
  return native.drawingBufferPixels(owner.index, owner.version) ?? EMPTY;
}

let imageDecoder: ((image: object) => Pixels | undefined) | undefined;

/**
 * Lets a host that has a document image's bytes (the conformance runner's
 * DOM) decode it as browsers do for WebGL: unpremultiplied RGBA8, top row
 * first, without gamma or color profiles. Without one, or when it returns
 * `undefined`, the image is read through a 2D canvas, which premultiplies.
 * The host's other image objects (ImageBitmap) are read through it too.
 */
export function setImageDecoder(decoder: ((image: object) => Pixels | undefined) | undefined): void {
  imageDecoder = decoder;
}

/**
 * A `TexImageSource` as RGBA8, top row first (design: "TexImageSource"):
 * an `ImageData`-shaped object, an oxgl context's canvas, an object with a
 * 2D context, or a document image. Anything else is a `TypeError`.
 */
function imagePixels(source: unknown, method: string, position: number): Pixels {
  if (typeof source !== 'object' || source === null) throw typeError(method, position, 'TexImageSource');
  const shaped = source as Partial<Pixels> & { naturalWidth?: unknown; naturalHeight?: unknown; ownerDocument?: unknown };
  if (ArrayBuffer.isView(shaped.data) && typeof shaped.width === 'number' && typeof shaped.height === 'number') {
    return { data: shaped.data, width: shaped.width, height: shaped.height };
  }
  const owner = canvasContexts.get(source);
  if (owner !== undefined) {
    if (owner.destroyed) return EMPTY;
    return native.drawingBufferPixels(owner.index, owner.version) ?? EMPTY;
  }
  const width = Number((shaped as { width?: unknown }).width) >>> 0;
  const height = Number((shaped as { height?: unknown }).height) >>> 0;
  const canvas = context2d(source);
  if (canvas !== null) {
    if (width === 0 || height === 0) return EMPTY;
    return { data: canvas.getImageData(0, 0, width, height).data, width, height };
  }
  // A video element: Node decodes no video, so it never has a frame and
  // uploads as 0×0, as one without data does in browsers.
  if (typeof (shaped as { videoWidth?: unknown }).videoWidth === 'number') return EMPTY;
  const document = shaped.ownerDocument as { createElement?: (name: string) => unknown; URL?: unknown } | null | undefined;
  if (typeof shaped.naturalWidth === 'number' && typeof document?.createElement === 'function') {
    const w = shaped.naturalWidth >>> 0;
    const h = Number(shaped.naturalHeight) >>> 0;
    if (!originClean(source, document)) {
      throw new DOMException(`Failed to execute '${method}': The image element contains cross-origin data, and may not be loaded.`, 'SecurityError');
    }
    // Before the size check: an SVG without a natural size is drawn at the
    // element's size.
    const decoded = imageDecoder?.(source);
    if (decoded !== undefined) return decoded;
    // A broken or unloaded image uploads as 0×0, as in browsers.
    if (w === 0 || h === 0) return EMPTY;
    const scratch = document.createElement('canvas') as { width: number; height: number };
    scratch.width = w;
    scratch.height = h;
    const drawn = context2d(scratch);
    if (drawn?.drawImage === undefined) throw typeError(method, position, 'TexImageSource');
    drawn.drawImage(source, 0, 0);
    return { data: drawn.getImageData(0, 0, w, h).data, width: w, height: h };
  }
  // Another host image object, such as an ImageBitmap.
  const decoded = imageDecoder?.(source);
  if (decoded !== undefined) return decoded;
  throw typeError(method, position, 'TexImageSource');
}

/**
 * Whether a document image may be read (WebGL 1.0 §4.2): fetched from its
 * document's origin, from a `data:` or `blob:` URL, or with CORS requested
 * (`crossOrigin` set; a failed CORS check fails the load itself). A host
 * without document URLs has no origins, and its images are clean.
 */
function originClean(image: { src?: unknown; currentSrc?: unknown; crossOrigin?: unknown }, document: { URL?: unknown }): boolean {
  if (image.crossOrigin !== null && image.crossOrigin !== undefined) return true;
  if (typeof document.URL !== 'string') return true;
  const src = typeof image.currentSrc === 'string' && image.currentSrc !== '' ? image.currentSrc : image.src;
  if (typeof src !== 'string' || !URL.canParse(src, document.URL)) return true;
  const url = new URL(src, document.URL);
  return url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === new URL(document.URL).origin;
}

/**
 * One texture upload whose source is `data`: a `TexImageSource` when
 * `sourceOnly` (WebGL 1's six-argument forms), else a view, `null`, a pixel
 * unpack buffer offset (WebGL 2) or a `TexImageSource` (WebGL 2), resolved
 * as WebIDL overloads are. `call` is 0 texImage2D, 1 texSubImage2D, 2
 * texImage3D, 3 texSubImage3D.
 */
function upload(
  s: ContextState,
  call: number,
  args: NativeTexArgs,
  data: unknown,
  srcOffset: unknown,
  method: string,
  position: number,
  sourceOnly: boolean,
): void {
  // WebGL 1 has no srcOffset; WebIDL ignores extra arguments.
  const ranged = s.webgl2 && srcOffset !== undefined;
  if (sourceOnly) {
    const pixels = imagePixels(data, method, position);
    if (s.destroyed) return;
    args.width = pixels.width;
    args.height = pixels.height;
    native.texUpload(s.index, s.version, call, args, pixels.asIs === true ? 4 : 3, pixels.data, 0, pixels.width, pixels.height);
    return;
  }
  if (data === null || data === undefined) {
    if (ranged) throw typeError(method, position, 'ArrayBufferView');
    if (!s.destroyed) native.texUpload(s.index, s.version, call, args, 0, null, 0, 0, 0);
    return;
  }
  if (ArrayBuffer.isView(data)) {
    const size = (data as Partial<{ BYTES_PER_ELEMENT: number }>).BYTES_PER_ELEMENT ?? 1;
    const offset = ranged ? toUnsignedLongLong(srcOffset) * size : 0;
    if (!s.destroyed) native.texUpload(s.index, s.version, call, args, 1, data, offset, 0, 0);
    return;
  }
  if (typeof data !== 'object' && typeof data !== 'function') {
    if (!s.webgl2 || ranged) throw typeError(method, position, 'ArrayBufferView');
    const offset = toLongLong(data);
    if (!s.destroyed) native.texUpload(s.index, s.version, call, args, 2, null, offset, 0, 0);
    return;
  }
  if (!s.webgl2 || ranged) throw typeError(method, position, 'ArrayBufferView');
  const pixels = imagePixels(data, method, position);
  if (!s.destroyed) native.texUpload(s.index, s.version, call, args, pixels.asIs === true ? 4 : 3, pixels.data, 0, pixels.width, pixels.height);
}

/**
 * A compressed upload: `rest` is `[data]` (WebGL 1), or on WebGL 2
 * `[srcData, srcOffset?, srcLengthOverride?]` or `[imageSize, offset]` for a
 * pixel unpack buffer, which oxgl does not support yet (no compressed format
 * exists before the extensions change), so that form generates
 * `INVALID_OPERATION`.
 */
function compressed(s: ContextState, call: number, args: NativeTexArgs, rest: unknown[], method: string, position: number): void {
  const [data, srcOffset, length] = rest;
  if (s.webgl2 && typeof data === 'number') {
    // The pixel unpack buffer form: (imageSize, offset).
    const imageSize = toLong(data);
    const offset = toLongLong(srcOffset);
    if (!s.destroyed) native.compressedTexUploadBuffer(s.index, s.version, call, args, imageSize, offset);
    return;
  }
  if (!ArrayBuffer.isView(data)) throw typeError(method, position, 'ArrayBufferView');
  const size = (data as Partial<{ BYTES_PER_ELEMENT: number }>).BYTES_PER_ELEMENT ?? 1;
  const offset = s.webgl2 ? toUnsignedLongLong(srcOffset) * size : 0;
  const count = s.webgl2 ? toUnsignedLong(length) * size : 0;
  if (!s.destroyed) native.compressedTexUpload(s.index, s.version, call, args, data, offset, count);
}

/** A context's state; assigned by `ContextBase`'s static block. */
let contextState: (gl: ContextBase) => ContextState;
/** Gives a restored context its new state; assigned by `ContextBase`'s static block. */
let replaceState: (gl: ContextBase, s: ContextState) => void;
/** `framebufferTextureLayer`'s attachment; assigned by `ContextBase`'s static block. */
let attachLayer: (gl: ContextBase, target: number, attachment: number, texture: unknown, level: number, layer: number) => void;

const GL = WEBGL2_CONSTANTS;
/** `KHR_parallel_shader_compile`'s pname. */
const COMPLETION_STATUS_KHR = 0x91b1;

/** WebIDL `AllowSharedBufferSource`. */
type AllowSharedBufferSource = ArrayBufferLike | ArrayBufferView;

/** Deletes a collected object on its context's thread. Module-level and capture-free. */
function releaseCollectedObject(held: readonly [number, number, number, number]): void {
  native.releaseObject(held[0], held[1], held[2], held[3]);
}

const collectedObjects = new FinalizationRegistry<readonly [number, number, number, number]>(releaseCollectedObject);

export type ObjectClass<T extends WebGLObject> = abstract new (token: symbol, state: ObjectState) => T;

/** Creates a native object and its JS wrapper; on a lost context, an invalid wrapper. */
function createObject<T extends WebGLObject>(
  s: ContextState,
  Class: new (token: symbol, state: ObjectState) => T,
  kind: number,
  shaderType: number,
  extra: object,
): T | null {
  const key = s.destroyed ? null : native.createObject(s.index, s.version, kind, shaderType);
  if (key === null && !s.destroyed && !native.isContextLost(s.index, s.version)) return null;
  const state = { owner: s, key: key === null ? null : ([key[0], key[1]] as const), deleted: key === null, ...extra };
  const object = new Class(CONSTRUCTING, state);
  if (key !== null) collectedObjects.register(object, Object.freeze([s.index, s.version, key[0], key[1]] as const), object);
  return object;
}

function typeError(method: string, position: number, type: string): TypeError {
  return new TypeError(`Failed to execute '${method}': parameter ${String(position)} is not of type '${type}'.`);
}

/**
 * Checks an object argument. Throws `TypeError` for a value of the wrong
 * type (or `null` when not nullable), as WebIDL conversion does. Returns
 * `undefined` when the call must stop: the context is lost, the object
 * belongs to another context (`foreignError`, `INVALID_OPERATION` unless
 * given; `is*` give 0 and stop silently), or it is deleted (`deletedError`,
 * or a silent stop when 0). Returns `null` for `null`.
 */
export function checkObject(
  s: ContextState,
  value: unknown,
  Class: ObjectClass<WebGLObject>,
  method: string,
  position: number,
  nullable: boolean,
  deletedError: number,
  foreignError: number = GL.INVALID_OPERATION,
): ObjectState | null | undefined {
  if (value === null || value === undefined) {
    if (!nullable) throw typeError(method, position, Class.name);
    return s.destroyed ? undefined : null;
  }
  if (!(value instanceof Class)) throw typeError(method, position, Class.name);
  if (s.destroyed) return undefined;
  const state = objectState(value);
  if (state.owner !== s) {
    if (foreignError !== 0) native.synthesizeError(s.index, s.version, foreignError);
    return undefined;
  }
  // GL keeps a deleted shader alive while attached, and a deleted program
  // while current (OpenGL ES 2.0 §2.10.1, §2.10.3); native code knows.
  const alive = state.deleted && (value instanceof WebGLShader || value instanceof WebGLProgram) && native.hasObject(s.index, s.version, ...keyOf(state));
  if ((state.deleted && !alive) || state.key === null) {
    if (deletedError !== 0) native.synthesizeError(s.index, s.version, deletedError);
    return undefined;
  }
  return state;
}

// Vertex array calls, shared by WebGL 2 and OES_vertex_array_object.

/** `createVertexArray` with the version's class. */
export function createVertexArrayIn<T extends WebGLObject>(
  s: ContextState,
  Class: new (token: symbol, state: ObjectState) => T,
): T {
  return createObject(s, Class, 7, 0, { element: null, attribs: [], normalized: [] }) as T;
}

/** `deleteVertexArray`; the default vertex array is bound if it was. */
export function deleteVertexArrayIn(s: ContextState, vertexArray: unknown, Class: ObjectClass<WebGLObject>, method: string): void {
  const state = checkObject(s, vertexArray, Class, method, 1, true, 0);
  if (!state || vertexArray === null) return;
  state.deleted = true;
  collectedObjects.unregister(vertexArray as WebGLObject);
  if (s.vertexArray === vertexArray) {
    s.vertexArray = null;
    s.vao = s.defaultVao;
  }
  native.deleteObject(s.index, s.version, ...keyOf(state));
}

/** `isVertexArray`: true once bound. */
export function isVertexArrayIn(s: ContextState, vertexArray: unknown, Class: ObjectClass<WebGLObject>, method: string): boolean {
  const state = checkObject(s, vertexArray, Class, method, 1, true, 0, 0);
  return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
}

/** `bindVertexArray`. */
export function bindVertexArrayIn(s: ContextState, vertexArray: unknown, Class: ObjectClass<WebGLObject>, method: string): void {
  const state = checkObject(s, vertexArray, Class, method, 1, true, GL.INVALID_OPERATION);
  if (state === undefined) return;
  if (!native.bindVertexArray(s.index, s.version, ...keyOf(state))) return;
  s.vertexArray = vertexArray as WebGLObject | null;
  s.vao = state === null ? s.defaultVao : (state as unknown as VertexArrayState);
}

/** The native `[index, version]` of an object state, `[0, 0]` for `null`. */
export function keyOf(state: ObjectState | null): readonly [number, number] {
  return state?.key ?? NULL_KEY;
}
const NULL_KEY = [0, 0] as const;

/** Drops `buffer` from every binding GL clears when it is deleted (OpenGL ES 3.0 §2.9–§2.10). */
function unbindBuffer(s: ContextState, buffer: WebGLBuffer): void {
  for (const [target, bound] of s.buffers) if (bound === buffer) s.buffers.set(target, null);
  for (const list of [s.tfBuffers, s.uniformBuffers]) {
    list.forEach((bound, i) => {
      if (bound === buffer) list[i] = null;
    });
  }
  if (s.vao.element === buffer) s.vao.element = null;
  s.vao.attribs.forEach((bound, i) => {
    if (bound === buffer) s.vao.attribs[i] = null;
  });
}

/** The location's GL value for a uniform call, or `undefined` to skip it (null location, lost, or an error). */
function uniformLocation(s: ContextState, location: unknown, method: string): number | undefined {
  if (location === null || location === undefined) return undefined;
  if (!(location instanceof WebGLUniformLocation)) throw typeError(method, 1, 'WebGLUniformLocation');
  if (s.destroyed) return undefined;
  const state = locationState(location);
  const current = s.program === null ? null : (objectState as (o: WebGLObject) => ProgramState)(s.program);
  if (state.program.owner !== s) {
    native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
    return undefined;
  }
  if (current !== state.program || state.linkCount !== state.program.linkCount) {
    native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
    return undefined;
  }
  return state.location;
}

/** Binding parameters oxgl answers from its own references. */
function boundObject(s: ContextState, pname: number): WebGLObject | null | undefined {
  switch (pname) {
    case GL.ARRAY_BUFFER_BINDING:
      return s.buffers.get(GL.ARRAY_BUFFER) ?? null;
    case GL.ELEMENT_ARRAY_BUFFER_BINDING:
      return s.vao.element;
    case GL.CURRENT_PROGRAM:
      return s.program;
    case GL.FRAMEBUFFER_BINDING:
      return s.drawFramebuffer;
    case GL.RENDERBUFFER_BINDING:
      return s.renderbuffer;
    case GL.TEXTURE_BINDING_2D:
      return unitOf(s).get(GL.TEXTURE_2D) ?? null;
    case GL.TEXTURE_BINDING_CUBE_MAP:
      return unitOf(s).get(GL.TEXTURE_CUBE_MAP) ?? null;
  }
  if (!s.webgl2) {
    // VERTEX_ARRAY_BINDING_OES has VERTEX_ARRAY_BINDING's value.
    return pname === GL.VERTEX_ARRAY_BINDING && s.extensions.has('OES_vertex_array_object') ? s.vertexArray : undefined;
  }
  switch (pname) {
    case GL.TEXTURE_BINDING_3D:
      return unitOf(s).get(GL.TEXTURE_3D) ?? null;
    case GL.TEXTURE_BINDING_2D_ARRAY:
      return unitOf(s).get(GL.TEXTURE_2D_ARRAY) ?? null;
    case GL.SAMPLER_BINDING:
      return s.samplers[s.activeUnit] ?? null;
    case GL.READ_FRAMEBUFFER_BINDING:
      return s.readFramebuffer;
    case GL.VERTEX_ARRAY_BINDING:
      return s.vertexArray;
    case GL.TRANSFORM_FEEDBACK_BINDING:
      return s.transformFeedback;
  }
  const target = BINDING_TARGETS.get(pname);
  return target === undefined ? undefined : (s.buffers.get(target) ?? null);
}

const BINDING_TARGETS = new Map<number, number>([
  [GL.COPY_READ_BUFFER_BINDING, GL.COPY_READ_BUFFER],
  [GL.COPY_WRITE_BUFFER_BINDING, GL.COPY_WRITE_BUFFER],
  [GL.PIXEL_PACK_BUFFER_BINDING, GL.PIXEL_PACK_BUFFER],
  [GL.PIXEL_UNPACK_BUFFER_BINDING, GL.PIXEL_UNPACK_BUFFER],
  [GL.TRANSFORM_FEEDBACK_BUFFER_BINDING, GL.TRANSFORM_FEEDBACK_BUFFER],
  [GL.UNIFORM_BUFFER_BINDING, GL.UNIFORM_BUFFER],
]);

/**
 * A source as bytes, with WebGL 2's element `srcOffset`/`length` (when
 * `ranged`) converted to byte counts, so native code never needs element
 * sizes (`BYTES_PER_ELEMENT`, 1 for a `DataView` or a bare buffer).
 */
function byteRange(
  source: AllowSharedBufferSource,
  ranged: boolean,
  srcOffset: unknown,
  length: unknown,
): [Uint8Array, number, number] {
  const offset = ranged ? toUnsignedLongLong(srcOffset) : 0;
  const count = ranged ? toUnsignedLong(length) : 0;
  if (!ArrayBuffer.isView(source)) return [new Uint8Array(source), 0, 0];
  const size = (source as Partial<{ BYTES_PER_ELEMENT: number }>).BYTES_PER_ELEMENT ?? 1;
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  // An offset past the view stays past it, so native code reports INVALID_VALUE.
  return [bytes, offset * size, count * size];
}

/** Resizes a context's drawing buffer; assigned by `ContextBase`'s static block. */
let resizeDrawingBuffer: (gl: ContextBase, width: number, height: number) => void;
/** Stores a canvas's size; assigned by `HeadlessCanvas`'s static block. */
let storeCanvasSize: (canvas: HeadlessCanvas, width: number, height: number) => void;

/** HTML's reflection of a canvas dimension: `unsigned long`, with values above 2^31 − 1 replaced by the default. */
function canvasDimension(value: unknown, fallback: number): number {
  const converted = toUnsignedLong(value);
  return converted > MAX_DIMENSION ? fallback : converted;
}

/**
 * The canvas of a context created without one: an `EventTarget` whose
 * `width` and `height` resize the drawing buffer, like an HTML canvas.
 */
export class HeadlessCanvas extends EventTarget {
  #context: ContextBase;
  #width: number;
  #height: number;

  static {
    storeCanvasSize = (canvas, width, height) => {
      canvas.#width = width;
      canvas.#height = height;
    };
  }

  /** @internal Created by `createContext`. */
  constructor(token: symbol, context: ContextBase, width: number, height: number) {
    if (token !== CONSTRUCTING) {
      throw new TypeError('Illegal constructor');
    }
    super();
    this.#context = context;
    this.#width = width;
    this.#height = height;
  }

  /** Width in CSS pixels; setting it resizes the drawing buffer. */
  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    this.#width = canvasDimension(value, 300);
    resizeDrawingBuffer(this.#context, this.#width, this.#height);
  }

  /** Height in CSS pixels; setting it resizes the drawing buffer. */
  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = canvasDimension(value, 150);
    resizeDrawingBuffer(this.#context, this.#width, this.#height);
  }
}

/** WebGL 1.0 §5.15.1. */
export interface WebGLContextEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
  statusMessage?: string;
}

/** The event of a lost or restored context (WebGL 1.0 §5.15.1). */
export class WebGLContextEvent extends Event {
  readonly #statusMessage: string;

  constructor(type: string, eventInit: WebGLContextEventInit = {}) {
    requireArguments('WebGLContextEvent', 1, arguments.length);
    super(type, eventInit);
    this.#statusMessage = eventInit.statusMessage === undefined ? '' : toDOMString(eventInit.statusMessage);
  }

  /** Additional information about the loss, `''` here. */
  get statusMessage(): string {
    return this.#statusMessage;
  }
}

/** Fires `event` at the canvas, when it is an event target. */
function fire(canvas: object, event: Event): void {
  const target = canvas as Partial<EventTarget>;
  if (typeof target.dispatchEvent === 'function') target.dispatchEvent(event);
}

/**
 * WebGL 1.0 §5.15.2's steps, once per loss: a task fires
 * `webglcontextlost`; cancelling it allows restoring, which a backend loss
 * then does at once and a simulated one on `restoreContext()`.
 */
function observeLoss(s: ContextState): void {
  if (s.destroyed || s.lossObserved) return;
  s.lossObserved = true;
  setTimeout(() => {
    if (s.destroyed) return;
    const event = new WebGLContextEvent('webglcontextlost', { cancelable: true });
    fire(s.canvas, event);
    if (!event.defaultPrevented) return;
    s.restorable = true;
    // A backend loss restores in a task of its own (WebGL 1.0 §5.15.2).
    if (!s.lostByExtension) {
      setTimeout(() => {
        restore(s);
      }, 0);
    }
  }, 0);
}

/** A canvas dimension for a restored drawing buffer, or `fallback`. */
function canvasSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DIMENSION ? value : fallback;
}

/**
 * WebGL 1.0 §5.15.3: gives the context a new native context with the original
 * creation parameters and fresh state, then fires `webglcontextrestored`.
 * Objects of the old state fail the ownership check from then on. A failed
 * creation leaves the context lost.
 */
function restore(s: ContextState): void {
  const gl = s.gl.deref();
  if (s.destroyed || gl === undefined) return;
  const { canvas, creation } = s;
  const { width, height } = canvas as Partial<Record<'width' | 'height', unknown>>;
  const created = native.createContext(
    creation.backend,
    canvasSize(width, creation.width),
    canvasSize(height, creation.height),
    s.webgl2,
    creation.attributes,
  );
  if (created.errorCode !== undefined) return;
  const next = initialState(gl, s.webgl2, created, creation, canvas);
  // WEBGL_lose_context stays enabled, as the same object (WebGL 1.0 §5.15.2).
  const loseContext = s.extensions.get('WEBGL_lose_context');
  if (loseContext !== undefined) {
    native.enableExtension(next.index, next.version, 'WEBGL_lose_context');
    next.extensions.set('WEBGL_lose_context', loseContext);
  }
  s.destroyed = true;
  collected.unregister(gl);
  native.destroy(s.index, s.version);
  replaceState(gl, next);
  canvasContexts.set(canvas, next);
  collected.register(gl, Object.freeze([next.index, next.version] as const), gl);
  fire(canvas, new WebGLContextEvent('webglcontextrestored'));
}

/** Records an error of `WEBGL_lose_context`, which may run on a lost context. */
function loseContextError(s: ContextState): void {
  if (!native.isContextLost(s.index, s.version)) {
    native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
  } else if (!s.lostErrors.includes(GL.INVALID_OPERATION)) {
    s.lostErrors.push(GL.INVALID_OPERATION);
  }
}

/** `WEBGL_lose_context.loseContext()`: `INVALID_OPERATION` when already lost. */
export function loseContext(gl: ContextBase): void {
  const s = contextState(gl);
  if (s.destroyed) return;
  if (native.isContextLost(s.index, s.version)) {
    observeLoss(s);
    loseContextError(s);
    return;
  }
  native.loseContext(s.index, s.version);
  s.lostByExtension = true;
  observeLoss(s);
}

/**
 * `WEBGL_lose_context.restoreContext()`: queues the restore of a lost
 * context whose lost event was cancelled; `INVALID_OPERATION` otherwise.
 */
export function restoreContext(gl: ContextBase): void {
  const s = contextState(gl);
  if (s.destroyed) return;
  if (!native.isContextLost(s.index, s.version) || !s.restorable) {
    loseContextError(s);
    return;
  }
  if (s.restoreQueued) return;
  s.restoreQueued = true;
  setTimeout(() => {
    restore(s);
  }, 0);
}

/** The native context `createContext` returns. */
interface CreatedContext {
  readonly index: number;
  readonly version: number;
  readonly width: number;
  readonly height: number;
}

/** The arguments a context was created with. */
interface Creation {
  readonly backend: ContextBackend;
  readonly attributes: NativeAttributes;
  /** The size first requested, used on restore when the canvas has none. */
  readonly width: number;
  readonly height: number;
}

/** The state of a new or restored context. */
function initialState(gl: ContextBase, webgl2: boolean, created: CreatedContext, creation: Creation, canvas: object): ContextState {
  const s: ContextState = {
    index: created.index,
    version: created.version,
    webgl2,
    gl: new WeakRef(gl),
    creation,
    lossObserved: false,
    lostByExtension: false,
    restorable: false,
    restoreQueued: false,
    lostErrors: [],
    width: created.width,
    height: created.height,
    destroyed: false,
    lostReported: false,
    canvas,
    buffers: new Map(),
    vao: { element: null, attribs: [], normalized: [] },
    program: null,
    attribKinds: [],
    textureUnits: [],
    samplers: [],
    activeUnit: 0,
    maxUnits: 0,
    drawFramebuffer: null,
    readFramebuffer: null,
    renderbuffer: null,
    defaultVao: { element: null, attribs: [], normalized: [] },
    vertexArray: null,
    extensions: new Map(),
    transformFeedback: null,
    tfBuffers: [],
    defaultTfBuffers: [],
    uniformBuffers: [],
    queries: new Map(),
  };
  s.vao = s.defaultVao;
  s.tfBuffers = s.defaultTfBuffers;
  const units = native.getParameter(s.index, s.version, GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  s.maxUnits = units?.numbers[0] ?? 0;
  return s;
}

/**
 * Members shared by WebGL 1 and WebGL 2 (the `WebGLRenderingContextBase`
 * mixin). Not exported: as in browsers, the two context classes are unrelated.
 */
abstract class ContextBase {
  #s: ContextState;

  static {
    resizeDrawingBuffer = (gl, width, height) => {
      gl.#resizeTo(width, height);
    };
    contextState = (gl) => gl.#s;
    replaceState = (gl, s) => {
      gl.#s = s;
    };
    attachLayer = (gl, target, attachment, texture, level, layer) => {
      gl.#attachLayer(target, attachment, texture, level, layer);
    };
  }

  /** @internal Use {@link createContext}. */
  constructor(token: symbol, created: CreatedContext, canvas: object | undefined, creation: Creation) {
    if (token !== CONSTRUCTING) {
      throw new TypeError('Illegal constructor');
    }
    const webgl2 = this instanceof WebGL2RenderingContext;
    this.#s = initialState(this, webgl2, created, creation, undefined as unknown as object);
    this.#s.canvas = canvas ?? new HeadlessCanvas(CONSTRUCTING, this, creation.width, creation.height);
    canvasContexts.set(this.#s.canvas, this.#s);
    collected.register(this, Object.freeze([created.index, created.version] as const), this);
  }

  /** The canvas this context draws for (WebGL 1.0 §5.14.1). */
  get canvas(): object {
    return this.#s.canvas;
  }

  /** Reallocates the drawing buffer; a no-op when lost. Never touches the canvas. */
  #resizeTo(width: number, height: number): void {
    if (this.#s.destroyed) return;
    // 0×0 when the resize lost the context, as a lost context reports.
    const size = native.resize(this.#s.index, this.#s.version, width, height);
    this.#s.width = size.width;
    this.#s.height = size.height;
  }

  /**
   * Non-standard: reallocates the drawing buffer at `width`×`height`
   * (clamped to the implementation's limits), with cleared contents. Other
   * state, including the viewport, is kept. A no-op on a lost context.
   */
  resize(width: number, height: number): void {
    requireArguments('resize', 2, arguments.length);
    const w = validateSize('width', width, 'resize');
    const h = validateSize('height', height, 'resize');
    if (this.isContextLost()) return;
    if (this.#s.canvas instanceof HeadlessCanvas) storeCanvasSize(this.#s.canvas, w, h);
    this.#resizeTo(w, h);
  }

  /** WebGL 1.0 §5.14.2; a new object per call, `null` when lost. */
  getContextAttributes(): WebGLContextAttributes | null {
    if (this.#s.destroyed) return null;
    const attributes = native.getContextAttributes(this.#s.index, this.#s.version);
    if (attributes === null) return null;
    return {
      alpha: attributes.alpha,
      antialias: attributes.antialias,
      depth: attributes.depth,
      desynchronized: false,
      failIfMajorPerformanceCaveat: attributes.failIfMajorPerformanceCaveat,
      powerPreference: POWER_PREFERENCES[attributes.powerPreference] as WebGLPowerPreference,
      premultipliedAlpha: attributes.premultipliedAlpha,
      preserveDrawingBuffer: attributes.preserveDrawingBuffer,
      stencil: attributes.stencil,
    };
  }

  /** Width of the drawing buffer in pixels (WebGL 1.0 §5.14.1). */
  get drawingBufferWidth(): number {
    return this.#s.width;
  }

  /** Height of the drawing buffer in pixels (WebGL 1.0 §5.14.1). */
  get drawingBufferHeight(): number {
    return this.#s.height;
  }

  /** WebGL 1.0 §5.14.3. */
  clearColor(red: number, green: number, blue: number, alpha: number): void {
    requireArguments('clearColor', 4, arguments.length);
    const r = toFloat(red);
    const g = toFloat(green);
    const b = toFloat(blue);
    const a = toFloat(alpha);
    if (this.#s.destroyed) return;
    native.clearColor(this.#s.index, this.#s.version, r, g, b, a);
  }

  /** WebGL 1.0 §5.14.11. */
  clear(mask: number): void {
    requireArguments('clear', 1, arguments.length);
    const bits = toUnsignedLong(mask);
    if (this.#s.destroyed) return;
    native.clear(this.#s.index, this.#s.version, bits);
  }

  /** WebGL 1.0 §5.14.3. */
  getError(): number {
    if (this.#s.destroyed) {
      if (this.#s.lostReported) return WEBGL1_CONSTANTS.NO_ERROR;
      this.#s.lostReported = true;
      return WEBGL1_CONSTANTS.CONTEXT_LOST_WEBGL;
    }
    const s = this.#s;
    const error = native.getError(s.index, s.version);
    if (error === WEBGL1_CONSTANTS.CONTEXT_LOST_WEBGL) observeLoss(s);
    if (error === WEBGL1_CONSTANTS.NO_ERROR && s.lostErrors.length > 0) return s.lostErrors.shift() ?? error;
    return error;
  }

  /** WebGL 1.0 §5.14.12 (the `ArrayBufferView` overload). */
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null | undefined | number,
    dstOffset?: number,
  ): void {
    requireArguments('readPixels', 7, arguments.length);
    const s = this.#s;
    const args = [toLong(x), toLong(y), toLong(width), toLong(height), toUnsignedLong(format), toUnsignedLong(type)] as const;
    if (s.webgl2 && typeof pixels !== 'object' && pixels !== undefined) {
      // WebGL 2.0 §3.7.10: the pixel pack buffer overload.
      const offset = toLongLong(pixels);
      if (!s.destroyed) native.readPixelsToBuffer(s.index, s.version, ...args, offset);
      return;
    }
    // `ArrayBufferView?`: undefined converts to null.
    let destination = (pixels as ArrayBufferView | null | undefined) ?? null;
    if (destination !== null && !ArrayBuffer.isView(destination)) {
      throw new TypeError("Failed to execute 'readPixels': parameter 7 is not of type 'ArrayBufferView'.");
    }
    if (s.webgl2 && arguments.length > 7) {
      if (destination === null) throw new TypeError("Failed to execute 'readPixels': parameter 7 is not of type 'ArrayBufferView'.");
      const offset = toUnsignedLongLong(dstOffset);
      const length = (destination as Partial<Uint8Array>).length ?? destination.byteLength;
      if (offset > length) {
        if (!s.destroyed) native.synthesizeError(s.index, s.version, GL.INVALID_VALUE);
        return;
      }
      const view = destination as Partial<Uint8Array>;
      destination = typeof view.subarray === 'function' ? view.subarray(offset) : new DataView(destination.buffer, destination.byteOffset + offset);
    }
    if (s.destroyed) return;
    native.readPixels(s.index, s.version, ...args, destination);
  }

  /**
   * Forwards a converted state call to native code, unless the context is
   * destroyed (WebGL 1.0 §5.14, `[WebGLHandlesContextLoss]`).
   */
  #state<A extends unknown[]>(call: (index: number, version: number, ...args: A) => void, ...args: A): void {
    if (!this.#s.destroyed) call(this.#s.index, this.#s.version, ...args);
  }

  /** WebGL 1.0 §5.14.3. */
  activeTexture(texture: number): void {
    requireArguments('activeTexture', 1, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(texture);
    if (s.destroyed) return;
    native.activeTexture(s.index, s.version, t);
    const unit = t - GL.TEXTURE0;
    if (unit >= 0 && unit < s.maxUnits) s.activeUnit = unit;
  }

  /** WebGL 1.0 §5.14.3. */
  blendColor(red: number, green: number, blue: number, alpha: number): void {
    requireArguments('blendColor', 4, arguments.length);
    this.#state(native.blendColor, toFloat(red), toFloat(green), toFloat(blue), toFloat(alpha));
  }

  /** WebGL 1.0 §5.14.3. */
  blendEquation(mode: number): void {
    requireArguments('blendEquation', 1, arguments.length);
    this.#state(native.blendEquation, toUnsignedLong(mode));
  }

  /** WebGL 1.0 §5.14.3. */
  blendEquationSeparate(modeRGB: number, modeAlpha: number): void {
    requireArguments('blendEquationSeparate', 2, arguments.length);
    this.#state(native.blendEquationSeparate, toUnsignedLong(modeRGB), toUnsignedLong(modeAlpha));
  }

  /** WebGL 1.0 §5.14.3. */
  blendFunc(sfactor: number, dfactor: number): void {
    requireArguments('blendFunc', 2, arguments.length);
    this.#state(native.blendFunc, toUnsignedLong(sfactor), toUnsignedLong(dfactor));
  }

  /** WebGL 1.0 §5.14.3. */
  blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void {
    requireArguments('blendFuncSeparate', 4, arguments.length);
    this.#state(
      native.blendFuncSeparate,
      toUnsignedLong(srcRGB),
      toUnsignedLong(dstRGB),
      toUnsignedLong(srcAlpha),
      toUnsignedLong(dstAlpha),
    );
  }

  /** WebGL 1.0 §5.14.3. */
  clearDepth(depth: number): void {
    requireArguments('clearDepth', 1, arguments.length);
    this.#state(native.clearDepth, toFloat(depth));
  }

  /** WebGL 1.0 §5.14.3. */
  clearStencil(s: number): void {
    requireArguments('clearStencil', 1, arguments.length);
    this.#state(native.clearStencil, toLong(s));
  }

  /** WebGL 1.0 §5.14.3. */
  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
    requireArguments('colorMask', 4, arguments.length);
    this.#state(native.colorMask, toBoolean(red), toBoolean(green), toBoolean(blue), toBoolean(alpha));
  }

  /** WebGL 1.0 §5.14.3. */
  cullFace(mode: number): void {
    requireArguments('cullFace', 1, arguments.length);
    this.#state(native.cullFace, toUnsignedLong(mode));
  }

  /** WebGL 1.0 §5.14.3. */
  depthFunc(func: number): void {
    requireArguments('depthFunc', 1, arguments.length);
    this.#state(native.depthFunc, toUnsignedLong(func));
  }

  /** WebGL 1.0 §5.14.3. */
  depthMask(flag: boolean): void {
    requireArguments('depthMask', 1, arguments.length);
    this.#state(native.depthMask, toBoolean(flag));
  }

  /** WebGL 1.0 §5.14.3. */
  depthRange(zNear: number, zFar: number): void {
    requireArguments('depthRange', 2, arguments.length);
    this.#state(native.depthRange, toFloat(zNear), toFloat(zFar));
  }

  /** WebGL 1.0 §5.14.3. */
  disable(cap: number): void {
    requireArguments('disable', 1, arguments.length);
    this.#state(native.disable, toUnsignedLong(cap));
  }

  /** WebGL 1.0 §5.14.3. */
  enable(cap: number): void {
    requireArguments('enable', 1, arguments.length);
    this.#state(native.enable, toUnsignedLong(cap));
  }

  /** WebGL 1.0 §5.14.11. */
  finish(): void {
    this.#state(native.finish);
  }

  /** WebGL 1.0 §5.14.11. */
  flush(): void {
    this.#state(native.flush);
  }

  /** WebGL 1.0 §5.14.3. */
  frontFace(mode: number): void {
    requireArguments('frontFace', 1, arguments.length);
    this.#state(native.frontFace, toUnsignedLong(mode));
  }

  /** WebGL 1.0 §5.14.3; `null` for an unknown parameter or a lost context. */
  getParameter(pname: number): unknown {
    requireArguments('getParameter', 1, arguments.length);
    const converted = toUnsignedLong(pname);
    const s = this.#s;
    if (s.destroyed) return null;
    const bound = boundObject(s, converted);
    if (bound !== undefined) return native.isContextLost(s.index, s.version) ? null : bound;
    return parameterValue(native.getParameter(s.index, s.version, converted));
  }

  /** WebGL 1.0 §5.14.9; `null` for an invalid enum or a lost context. */
  getShaderPrecisionFormat(shadertype: number, precisiontype: number): WebGLShaderPrecisionFormat | null {
    requireArguments('getShaderPrecisionFormat', 2, arguments.length);
    const args = [toUnsignedLong(shadertype), toUnsignedLong(precisiontype)] as const;
    if (this.#s.destroyed) return null;
    const format = native.getShaderPrecisionFormat(this.#s.index, this.#s.version, ...args);
    if (format === null) return null;
    return new WebGLShaderPrecisionFormat(CONSTRUCTING, format.rangeMin, format.rangeMax, format.precision);
  }

  /** WebGL 1.0 §5.14.14; `null` when lost. */
  getSupportedExtensions(): string[] | null {
    const s = this.#s;
    if (s.destroyed) return null;
    const names = native.getSupportedExtensions(s.index, s.version);
    return names === null ? null : Array.from(names);
  }

  /**
   * WebGL 1.0 §5.14.14: enables the extension and returns its object, the
   * same one on every call; `null` for an unknown or unsupported name, or
   * when lost. Names match ASCII case-insensitively.
   */
  getExtension<K extends keyof ExtensionMap>(name: K): ExtensionMap[K] | null;
  getExtension(name: string): object | null;
  getExtension(name: string): object | null {
    requireArguments('getExtension', 1, arguments.length);
    const text = toDOMString(name);
    const s = this.#s;
    if (s.destroyed) return null;
    const canonical = native.enableExtension(s.index, s.version, text);
    if (canonical === null) return null;
    let extension = s.extensions.get(canonical);
    if (extension === undefined) {
      extension = createExtension(canonical, s);
      s.extensions.set(canonical, extension);
    }
    return extension;
  }

  /** WebGL 1.0 §5.14.13. */
  isContextLost(): boolean {
    const s = this.#s;
    if (s.destroyed) return true;
    const lost = native.isContextLost(s.index, s.version);
    if (lost) observeLoss(s);
    return lost;
  }

  /** WebGL 1.0 §5.14.3. */
  hint(target: number, mode: number): void {
    requireArguments('hint', 2, arguments.length);
    this.#state(native.hint, toUnsignedLong(target), toUnsignedLong(mode));
  }

  /** WebGL 1.0 §5.14.3; `false` on a lost context. */
  isEnabled(cap: number): boolean {
    requireArguments('isEnabled', 1, arguments.length);
    const converted = toUnsignedLong(cap);
    if (this.#s.destroyed) return false;
    return native.isEnabled(this.#s.index, this.#s.version, converted);
  }

  /** WebGL 1.0 §5.14.3. */
  lineWidth(width: number): void {
    requireArguments('lineWidth', 1, arguments.length);
    this.#state(native.lineWidth, toFloat(width));
  }

  /** WebGL 1.0 §5.14.3. */
  pixelStorei(pname: number, param: number): void {
    requireArguments('pixelStorei', 2, arguments.length);
    this.#state(native.pixelStorei, toUnsignedLong(pname), toLong(param));
  }

  /** WebGL 1.0 §5.14.3. */
  polygonOffset(factor: number, units: number): void {
    requireArguments('polygonOffset', 2, arguments.length);
    this.#state(native.polygonOffset, toFloat(factor), toFloat(units));
  }

  /** WebGL 1.0 §5.14.3. */
  sampleCoverage(value: number, invert: boolean): void {
    requireArguments('sampleCoverage', 2, arguments.length);
    this.#state(native.sampleCoverage, toFloat(value), toBoolean(invert));
  }

  /** WebGL 1.0 §5.14.4. */
  scissor(x: number, y: number, width: number, height: number): void {
    requireArguments('scissor', 4, arguments.length);
    this.#state(native.scissor, toLong(x), toLong(y), toLong(width), toLong(height));
  }

  /** WebGL 1.0 §5.14.3. */
  stencilFunc(func: number, ref: number, mask: number): void {
    requireArguments('stencilFunc', 3, arguments.length);
    this.#state(native.stencilFunc, toUnsignedLong(func), toLong(ref), toUnsignedLong(mask));
  }

  /** WebGL 1.0 §5.14.3. */
  stencilFuncSeparate(face: number, func: number, ref: number, mask: number): void {
    requireArguments('stencilFuncSeparate', 4, arguments.length);
    this.#state(
      native.stencilFuncSeparate,
      toUnsignedLong(face),
      toUnsignedLong(func),
      toLong(ref),
      toUnsignedLong(mask),
    );
  }

  /** WebGL 1.0 §5.14.3. */
  stencilMask(mask: number): void {
    requireArguments('stencilMask', 1, arguments.length);
    this.#state(native.stencilMask, toUnsignedLong(mask));
  }

  /** WebGL 1.0 §5.14.3. */
  stencilMaskSeparate(face: number, mask: number): void {
    requireArguments('stencilMaskSeparate', 2, arguments.length);
    this.#state(native.stencilMaskSeparate, toUnsignedLong(face), toUnsignedLong(mask));
  }

  /** WebGL 1.0 §5.14.3. */
  stencilOp(fail: number, zfail: number, zpass: number): void {
    requireArguments('stencilOp', 3, arguments.length);
    this.#state(native.stencilOp, toUnsignedLong(fail), toUnsignedLong(zfail), toUnsignedLong(zpass));
  }

  /** WebGL 1.0 §5.14.3. */
  stencilOpSeparate(face: number, fail: number, zfail: number, zpass: number): void {
    requireArguments('stencilOpSeparate', 4, arguments.length);
    this.#state(
      native.stencilOpSeparate,
      toUnsignedLong(face),
      toUnsignedLong(fail),
      toUnsignedLong(zfail),
      toUnsignedLong(zpass),
    );
  }

  /** WebGL 1.0 §5.14.4. */
  viewport(x: number, y: number, width: number, height: number): void {
    requireArguments('viewport', 4, arguments.length);
    this.#state(native.viewport, toLong(x), toLong(y), toLong(width), toLong(height));
  }

  // --- Buffers (WebGL 1.0 §5.14.5) ---------------------------------------

  /** WebGL 1.0 §5.14.5. */
  createBuffer(): WebGLBuffer {
    return createObject(this.#s, WebGLBuffer, 0, 0, {}) as WebGLBuffer;
  }

  /** WebGL 1.0 §5.14.5. */
  bindBuffer(target: number, buffer: WebGLBuffer | null): void {
    requireArguments('bindBuffer', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const state = checkObject(s, buffer, WebGLBuffer, 'bindBuffer', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    const [oi, ov] = keyOf(state);
    if (!native.bindBuffer(s.index, s.version, t, oi, ov)) return;
    if (t === GL.ELEMENT_ARRAY_BUFFER) s.vao.element = buffer;
    else s.buffers.set(t, buffer);
  }

  /** WebGL 1.0 §5.14.5. */
  deleteBuffer(buffer: WebGLBuffer | null): void {
    requireArguments('deleteBuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, buffer, WebGLBuffer, 'deleteBuffer', 1, true, 0);
    if (!state || buffer === null) return;
    state.deleted = true;
    collectedObjects.unregister(buffer);
    unbindBuffer(s, buffer);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.5. */
  isBuffer(buffer: WebGLBuffer | null): boolean {
    requireArguments('isBuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, buffer, WebGLBuffer, 'isBuffer', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /**
   * WebGL 1.0 §5.14.5; on WebGL 2 the `ArrayBufferView` form also takes
   * `srcOffset` and `length` in elements (WebGL 2.0 §3.7.3).
   */
  bufferData(
    target: number,
    sizeOrData: number | AllowSharedBufferSource | null | undefined,
    usage: number,
    srcOffset?: number,
    length?: number,
  ): void {
    requireArguments('bufferData', 3, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const ranged = s.webgl2 && arguments.length > 3;
    // WebIDL overload resolution: null or undefined selects the nullable
    // buffer-source overload, a buffer source that overload, anything else
    // the GLsizeiptr one.
    if (sizeOrData === null || sizeOrData === undefined) {
      if (ranged) throw typeError('bufferData', 2, 'ArrayBufferView');
      toUnsignedLong(usage);
      if (!s.destroyed) native.synthesizeError(s.index, s.version, GL.INVALID_VALUE);
      return;
    }
    if (ranged || isBufferSource(sizeOrData)) {
      if (ranged && !ArrayBuffer.isView(sizeOrData)) throw typeError('bufferData', 2, 'ArrayBufferView');
      const u = toUnsignedLong(usage);
      const [view, offset, count] = byteRange(sizeOrData as AllowSharedBufferSource, ranged, srcOffset, length);
      if (s.destroyed) return;
      native.bufferData(s.index, s.version, t, view, u, offset, count);
      return;
    }
    const size = toLongLong(sizeOrData);
    const u = toUnsignedLong(usage);
    if (s.destroyed) return;
    native.bufferDataSize(s.index, s.version, t, size, u);
  }

  /** WebGL 1.0 §5.14.5; WebGL 2 adds `srcOffset` and `length` for views. */
  bufferSubData(target: number, offset: number, data: AllowSharedBufferSource, srcOffset?: number, length?: number): void {
    requireArguments('bufferSubData', 3, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const dst = toLongLong(offset);
    const ranged = s.webgl2 && arguments.length > 3;
    if (ranged ? !ArrayBuffer.isView(data) : !isBufferSource(data)) {
      throw typeError('bufferSubData', 3, ranged ? 'ArrayBufferView' : 'ArrayBuffer or ArrayBufferView');
    }
    const [view, from, count] = byteRange(data, ranged, srcOffset, length);
    if (s.destroyed) return;
    native.bufferSubData(s.index, s.version, t, dst, view, from, count);
  }

  /** WebGL 1.0 §5.14.5: `BUFFER_SIZE` or `BUFFER_USAGE`. */
  getBufferParameter(target: number, pname: number): unknown {
    requireArguments('getBufferParameter', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return null;
    return native.getBufferParameter(s.index, s.version, t, p);
  }

  // --- Shaders and programs (WebGL 1.0 §5.14.9) -------------------------

  /** WebGL 1.0 §5.14.9. */
  createShader(type: number): WebGLShader | null {
    requireArguments('createShader', 1, arguments.length);
    const t = toUnsignedLong(type);
    return createObject(this.#s, WebGLShader, 1, t, { type: t, source: '' });
  }

  /** WebGL 1.0 §5.14.9. */
  createProgram(): WebGLProgram {
    return createObject(this.#s, WebGLProgram, 2, 0, {
      attached: new Set(),
      linkCount: 0,
    }) as WebGLProgram;
  }

  /** WebGL 1.0 §5.14.9. */
  deleteShader(shader: WebGLShader | null): void {
    requireArguments('deleteShader', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, shader, WebGLShader, 'deleteShader', 1, true, 0);
    if (!state || shader === null) return;
    state.deleted = true;
    collectedObjects.unregister(shader);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. The program stays current until replaced. */
  deleteProgram(program: WebGLProgram | null): void {
    requireArguments('deleteProgram', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, program, WebGLProgram, 'deleteProgram', 1, true, 0);
    if (!state || program === null) return;
    state.deleted = true;
    collectedObjects.unregister(program);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. */
  isShader(shader: WebGLShader | null): boolean {
    requireArguments('isShader', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, shader, WebGLShader, 'isShader', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. */
  isProgram(program: WebGLProgram | null): boolean {
    requireArguments('isProgram', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, program, WebGLProgram, 'isProgram', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. */
  shaderSource(shader: WebGLShader, source: string): void {
    requireArguments('shaderSource', 2, arguments.length);
    const s = this.#s;
    const text = toDOMString(source);
    const state = checkObject(s, shader, WebGLShader, 'shaderSource', 1, false, GL.INVALID_VALUE) as ShaderState | null | undefined;
    if (!state) return;
    state.source = text;
    native.shaderSource(s.index, s.version, ...keyOf(state), text);
  }

  /** WebGL 1.0 §5.14.9. */
  compileShader(shader: WebGLShader): void {
    requireArguments('compileShader', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, shader, WebGLShader, 'compileShader', 1, false, GL.INVALID_VALUE);
    if (state) native.compileShader(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9: the last source given, exactly. */
  getShaderSource(shader: WebGLShader): string | null {
    requireArguments('getShaderSource', 1, arguments.length);
    const state = checkObject(this.#s, shader, WebGLShader, 'getShaderSource', 1, false, GL.INVALID_VALUE) as ShaderState | null | undefined;
    return state ? state.source : null;
  }

  /** WebGL 1.0 §5.14.9. */
  getShaderParameter(shader: WebGLShader, pname: number): unknown {
    requireArguments('getShaderParameter', 2, arguments.length);
    const s = this.#s;
    const p = toUnsignedLong(pname);
    const state = checkObject(s, shader, WebGLShader, 'getShaderParameter', 1, false, GL.INVALID_VALUE);
    if (!state) return null;
    if (this.#completedByLoss(p)) return true;
    return parameterValue(native.getShaderParameter(s.index, s.version, ...keyOf(state), p));
  }

  /** WebGL 1.0 §5.14.9. */
  getShaderInfoLog(shader: WebGLShader): string | null {
    requireArguments('getShaderInfoLog', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, shader, WebGLShader, 'getShaderInfoLog', 1, false, GL.INVALID_VALUE);
    if (!state) return null;
    return native.getShaderInfoLog(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. */
  attachShader(program: WebGLProgram, shader: WebGLShader): void {
    requireArguments('attachShader', 2, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'attachShader', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    const sh = checkObject(s, shader, WebGLShader, 'attachShader', 2, false, GL.INVALID_VALUE) as ShaderState | null | undefined;
    if (!p || !sh) return;
    // Attaching twice, or a second shader of a type, is INVALID_OPERATION (WebGL 1.0 §5.14.9).
    if ([...p.attached].some((other) => other === shader || (objectState(other) as ShaderState).type === sh.type)) {
      native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
      return;
    }
    p.attached.add(shader);
    native.attachShader(s.index, s.version, ...keyOf(p), ...keyOf(sh), true);
  }

  /** WebGL 1.0 §5.14.9. */
  detachShader(program: WebGLProgram, shader: WebGLShader): void {
    requireArguments('detachShader', 2, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'detachShader', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    const sh = checkObject(s, shader, WebGLShader, 'detachShader', 2, false, GL.INVALID_VALUE) as ShaderState | null | undefined;
    if (!p || !sh) return;
    if (!p.attached.delete(shader)) {
      native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
      return;
    }
    native.attachShader(s.index, s.version, ...keyOf(p), ...keyOf(sh), false);
  }

  /** WebGL 1.0 §5.14.9: the attached shaders, deleted ones included. */
  getAttachedShaders(program: WebGLProgram): WebGLShader[] | null {
    requireArguments('getAttachedShaders', 1, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'getAttachedShaders', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    // The mirror answers, so a lost context must say null itself.
    return p && !native.isContextLost(s.index, s.version) ? [...p.attached] : null;
  }

  /** WebGL 1.0 §5.14.9. Invalidates the program's earlier uniform locations. */
  linkProgram(program: WebGLProgram): void {
    requireArguments('linkProgram', 1, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'linkProgram', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    if (!p) return;
    p.linkCount += 1;
    native.linkProgram(s.index, s.version, ...keyOf(p));
  }

  /** WebGL 1.0 §5.14.9. */
  validateProgram(program: WebGLProgram): void {
    requireArguments('validateProgram', 1, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'validateProgram', 1, false, GL.INVALID_VALUE);
    if (p) native.validateProgram(s.index, s.version, ...keyOf(p));
  }

  /** WebGL 1.0 §5.14.9. */
  useProgram(program: WebGLProgram | null): void {
    requireArguments('useProgram', 1, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'useProgram', 1, true, GL.INVALID_VALUE);
    if (p === undefined) return;
    if (!native.useProgram(s.index, s.version, ...keyOf(p))) return;
    s.program = program;
  }

  /** WebGL 1.0 §5.14.9. */
  getProgramParameter(program: WebGLProgram, pname: number): unknown {
    requireArguments('getProgramParameter', 2, arguments.length);
    const s = this.#s;
    const name = toUnsignedLong(pname);
    const p = checkObject(s, program, WebGLProgram, 'getProgramParameter', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    if (this.#completedByLoss(name)) return true;
    return parameterValue(native.getProgramParameter(s.index, s.version, ...keyOf(p), name));
  }

  /**
   * `COMPLETION_STATUS_KHR` on a lost context is `true`, so a page polling
   * for completion does not wait forever (KHR_parallel_shader_compile).
   */
  #completedByLoss(pname: number): boolean {
    return pname === COMPLETION_STATUS_KHR && this.#s.extensions.has('KHR_parallel_shader_compile') && this.isContextLost();
  }

  /** WebGL 1.0 §5.14.9. */
  getProgramInfoLog(program: WebGLProgram): string | null {
    requireArguments('getProgramInfoLog', 1, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'getProgramInfoLog', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    return native.getProgramInfoLog(s.index, s.version, ...keyOf(p));
  }

  /** WebGL 1.0 §5.14.10. */
  bindAttribLocation(program: WebGLProgram, index: number, name: string): void {
    requireArguments('bindAttribLocation', 3, arguments.length);
    const s = this.#s;
    const i = toUnsignedLong(index);
    const n = toDOMString(name);
    const p = checkObject(s, program, WebGLProgram, 'bindAttribLocation', 1, false, GL.INVALID_VALUE);
    if (p) native.bindAttribLocation(s.index, s.version, ...keyOf(p), i, n);
  }

  /** WebGL 1.0 §5.14.10; -1 when absent or lost. */
  getAttribLocation(program: WebGLProgram, name: string): number {
    requireArguments('getAttribLocation', 2, arguments.length);
    const s = this.#s;
    const n = toDOMString(name);
    const p = checkObject(s, program, WebGLProgram, 'getAttribLocation', 1, false, GL.INVALID_VALUE);
    if (!p) return -1;
    return native.getLocation(s.index, s.version, ...keyOf(p), n, 0);
  }

  /** WebGL 1.0 §5.14.10. */
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    requireArguments('getUniformLocation', 2, arguments.length);
    const s = this.#s;
    const n = toDOMString(name);
    const p = checkObject(s, program, WebGLProgram, 'getUniformLocation', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    if (!p) return null;
    const location = native.getLocation(s.index, s.version, ...keyOf(p), n, 1);
    if (location < 0) return null;
    return new WebGLUniformLocation(CONSTRUCTING, { program: p, linkCount: p.linkCount, location });
  }

  #activeInfo(method: string, program: WebGLProgram, index: number, uniform: boolean): WebGLActiveInfo | null {
    const s = this.#s;
    const i = toUnsignedLong(index);
    const p = checkObject(s, program, WebGLProgram, method, 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    const info = native.getActiveInfo(s.index, s.version, ...keyOf(p), i, uniform);
    return info === null ? null : new WebGLActiveInfo(CONSTRUCTING, info.size, info.ty, info.name);
  }

  /** WebGL 1.0 §5.14.10. */
  getActiveAttrib(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    requireArguments('getActiveAttrib', 2, arguments.length);
    return this.#activeInfo('getActiveAttrib', program, index, false);
  }

  /** WebGL 1.0 §5.14.10. */
  getActiveUniform(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    requireArguments('getActiveUniform', 2, arguments.length);
    return this.#activeInfo('getActiveUniform', program, index, true);
  }

  /** WebGL 1.0 §5.14.10. */
  getUniform(program: WebGLProgram, location: WebGLUniformLocation): unknown {
    requireArguments('getUniform', 2, arguments.length);
    const s = this.#s;
    const p = checkObject(s, program, WebGLProgram, 'getUniform', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    if (!(location instanceof WebGLUniformLocation)) throw typeError('getUniform', 2, 'WebGLUniformLocation');
    if (!p) return null;
    const l = locationState(location);
    if (l.program !== p || l.linkCount !== p.linkCount) {
      native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
      return null;
    }
    return parameterValue(native.getUniform(s.index, s.version, ...keyOf(p), l.location));
  }

  // --- Uniforms (WebGL 1.0 §5.14.10) -------------------------------------

  /** Sets a uniform from up to four converted values; `kind` 0 float, 1 int, 2 uint. */
  #uniform(method: string, kind: number, n: number, location: unknown, values: number[]): void {
    const s = this.#s;
    const l = uniformLocation(s, location, method);
    if (l === undefined) return;
    native.uniformValues(s.index, s.version, l, kind, n, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  }

  /** Sets a uniform from a list; on WebGL 2 with `srcOffset`/`srcLength`. */
  #uniformv(
    method: string,
    kind: number,
    n: number,
    count: number,
    location: unknown,
    values: unknown,
    srcOffset: unknown,
    srcLength: unknown,
  ): void {
    const s = this.#s;
    requireArguments(method, 2, count);
    const list =
      kind === 0
        ? toList(Float32Array, toFloat, values, method)
        : kind === 1
          ? toList(Int32Array, toLong, values, method)
          : toList(Uint32Array, toUnsignedLong, values, method);
    const offset = s.webgl2 ? toUnsignedLongLong(srcOffset) : 0;
    const length = s.webgl2 ? toUnsignedLong(srcLength) : 0;
    const l = uniformLocation(s, location, method);
    if (l === undefined) return;
    native.uniformVector(s.index, s.version, l, kind, n, list, offset, length);
  }

  /** Sets a matrix uniform; on WebGL 2 with `srcOffset`/`srcLength`. */
  #uniformMatrix(
    method: string,
    columns: number,
    rows: number,
    count: number,
    location: unknown,
    transpose: unknown,
    values: unknown,
    srcOffset: unknown,
    srcLength: unknown,
  ): void {
    const s = this.#s;
    requireArguments(method, 3, count);
    const t = toBoolean(transpose);
    const list = toList(Float32Array, toFloat, values, method);
    const offset = s.webgl2 ? toUnsignedLongLong(srcOffset) : 0;
    const length = s.webgl2 ? toUnsignedLong(srcLength) : 0;
    const l = uniformLocation(s, location, method);
    if (l === undefined) return;
    native.uniformMatrix(s.index, s.version, l, columns, rows, t, list, offset, length);
  }

  uniform1f(location: WebGLUniformLocation | null, x: number): void {
    requireArguments('uniform1f', 2, arguments.length);
    this.#uniform('uniform1f', 0, 1, location, [toFloat(x)]);
  }
  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void {
    requireArguments('uniform2f', 3, arguments.length);
    this.#uniform('uniform2f', 0, 2, location, [toFloat(x), toFloat(y)]);
  }
  uniform3f(location: WebGLUniformLocation | null, x: number, y: number, z: number): void {
    requireArguments('uniform3f', 4, arguments.length);
    this.#uniform('uniform3f', 0, 3, location, [toFloat(x), toFloat(y), toFloat(z)]);
  }
  uniform4f(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void {
    requireArguments('uniform4f', 5, arguments.length);
    this.#uniform('uniform4f', 0, 4, location, [toFloat(x), toFloat(y), toFloat(z), toFloat(w)]);
  }
  uniform1i(location: WebGLUniformLocation | null, x: number): void {
    requireArguments('uniform1i', 2, arguments.length);
    this.#uniform('uniform1i', 1, 1, location, [toLong(x)]);
  }
  uniform2i(location: WebGLUniformLocation | null, x: number, y: number): void {
    requireArguments('uniform2i', 3, arguments.length);
    this.#uniform('uniform2i', 1, 2, location, [toLong(x), toLong(y)]);
  }
  uniform3i(location: WebGLUniformLocation | null, x: number, y: number, z: number): void {
    requireArguments('uniform3i', 4, arguments.length);
    this.#uniform('uniform3i', 1, 3, location, [toLong(x), toLong(y), toLong(z)]);
  }
  uniform4i(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void {
    requireArguments('uniform4i', 5, arguments.length);
    this.#uniform('uniform4i', 1, 4, location, [toLong(x), toLong(y), toLong(z), toLong(w)]);
  }
  uniform1fv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform1fv', 0, 1, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform2fv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform2fv', 0, 2, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform3fv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform3fv', 0, 3, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform4fv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform4fv', 0, 4, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform1iv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform1iv', 1, 1, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform2iv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform2iv', 1, 2, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform3iv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform3iv', 1, 3, arguments.length, location, v, srcOffset, srcLength);
  }
  uniform4iv(location: WebGLUniformLocation | null, v: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformv('uniform4iv', 1, 4, arguments.length, location, v, srcOffset, srcLength);
  }
  uniformMatrix2fv(location: WebGLUniformLocation | null, transpose: boolean, value: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformMatrix('uniformMatrix2fv', 2, 2, arguments.length, location, transpose, value, srcOffset, srcLength);
  }
  uniformMatrix3fv(location: WebGLUniformLocation | null, transpose: boolean, value: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformMatrix('uniformMatrix3fv', 3, 3, arguments.length, location, transpose, value, srcOffset, srcLength);
  }
  uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: boolean, value: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    this.#uniformMatrix('uniformMatrix4fv', 4, 4, arguments.length, location, transpose, value, srcOffset, srcLength);
  }

  // --- Vertex attributes (WebGL 1.0 §5.14.10) ----------------------------

  /** WebGL 1.0 §5.14.10. */
  enableVertexAttribArray(index: number): void {
    requireArguments('enableVertexAttribArray', 1, arguments.length);
    this.#state(native.vertexAttribArray, toUnsignedLong(index), true);
  }

  /** WebGL 1.0 §5.14.10. */
  disableVertexAttribArray(index: number): void {
    requireArguments('disableVertexAttribArray', 1, arguments.length);
    this.#state(native.vertexAttribArray, toUnsignedLong(index), false);
  }

  /** WebGL 1.0 §5.14.10. */
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    requireArguments('vertexAttribPointer', 6, arguments.length);
    const i = toUnsignedLong(index);
    const args = [toLong(size), toUnsignedLong(type), toBoolean(normalized) ? 1 : 0, toLong(stride), toLongLong(offset)] as const;
    this.#attribPointer(i, args[0], args[1], args[2], args[3], args[4]);
  }

  #attribPointer(index: number, size: number, type: number, normalized: number, stride: number, offset: number): void {
    const s = this.#s;
    if (s.destroyed) return;
    if (native.vertexAttribPointer(s.index, s.version, index, size, type, normalized, stride, offset)) {
      s.vao.attribs[index] = s.buffers.get(GL.ARRAY_BUFFER) ?? null;
      s.vao.normalized[index] = normalized === 1;
    }
  }

  /** `vertexAttrib*` with `kind` 0 float, 1 int, 2 uint. */
  #attrib(index: number, kind: number, values: ArrayLike<number>): void {
    const s = this.#s;
    if (s.destroyed) return;
    s.attribKinds[index] = kind;
    native.vertexAttrib(s.index, s.version, index, kind, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1);
  }

  vertexAttrib1f(index: number, x: number): void {
    requireArguments('vertexAttrib1f', 2, arguments.length);
    this.#attrib(toUnsignedLong(index), 0, [toFloat(x), 0, 0, 1]);
  }
  vertexAttrib2f(index: number, x: number, y: number): void {
    requireArguments('vertexAttrib2f', 3, arguments.length);
    this.#attrib(toUnsignedLong(index), 0, [toFloat(x), toFloat(y), 0, 1]);
  }
  vertexAttrib3f(index: number, x: number, y: number, z: number): void {
    requireArguments('vertexAttrib3f', 4, arguments.length);
    this.#attrib(toUnsignedLong(index), 0, [toFloat(x), toFloat(y), toFloat(z), 1]);
  }
  vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void {
    requireArguments('vertexAttrib4f', 5, arguments.length);
    this.#attrib(toUnsignedLong(index), 0, [toFloat(x), toFloat(y), toFloat(z), toFloat(w)]);
  }
  #attribv(method: string, n: number, index: unknown, values: unknown): void {
    const i = toUnsignedLong(index);
    const list = toList(Float32Array, toFloat, values, method);
    if (list.length < n) {
      if (!this.#s.destroyed) native.synthesizeError(this.#s.index, this.#s.version, GL.INVALID_VALUE);
      return;
    }
    const v = [0, 0, 0, 1];
    for (let c = 0; c < n; c++) v[c] = list[c] ?? 0;
    this.#attrib(i, 0, v);
  }
  vertexAttrib1fv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttrib1fv', 2, arguments.length);
    this.#attribv('vertexAttrib1fv', 1, index, values);
  }
  vertexAttrib2fv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttrib2fv', 2, arguments.length);
    this.#attribv('vertexAttrib2fv', 2, index, values);
  }
  vertexAttrib3fv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttrib3fv', 2, arguments.length);
    this.#attribv('vertexAttrib3fv', 3, index, values);
  }
  vertexAttrib4fv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttrib4fv', 2, arguments.length);
    this.#attribv('vertexAttrib4fv', 4, index, values);
  }

  /** WebGL 1.0 §5.14.10. */
  getVertexAttrib(index: number, pname: number): unknown {
    requireArguments('getVertexAttrib', 2, arguments.length);
    const s = this.#s;
    const i = toUnsignedLong(index);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return null;
    if (p === GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) {
      // Validate the index through a native query; it generates INVALID_VALUE.
      if (native.getVertexAttrib(s.index, s.version, i, GL.VERTEX_ATTRIB_ARRAY_ENABLED, 0) === null) return null;
      return s.vao.attribs[i] ?? null;
    }
    const value = parameterValue(native.getVertexAttrib(s.index, s.version, i, p, s.attribKinds[i] ?? 0));
    // ANGLE derives the flag from the vertex format, false for FLOAT, so
    // the flag the page passed comes from the mirror.
    if (p === GL.VERTEX_ATTRIB_ARRAY_NORMALIZED && value !== null) return s.vao.normalized[i] ?? false;
    return value;
  }

  /** WebGL 1.0 §5.14.10. */
  getVertexAttribOffset(index: number, pname: number): number {
    requireArguments('getVertexAttribOffset', 2, arguments.length);
    const s = this.#s;
    const i = toUnsignedLong(index);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return 0;
    return native.getVertexAttribOffset(s.index, s.version, i, p);
  }

  // --- Drawing (WebGL 1.0 §5.14.11) --------------------------------------

  /** WebGL 1.0 §5.14.11. */
  drawArrays(mode: number, first: number, count: number): void {
    requireArguments('drawArrays', 3, arguments.length);
    this.#state(native.drawArrays, toUnsignedLong(mode), toLong(first), toLong(count));
  }

  /** WebGL 1.0 §5.14.11. */
  drawElements(mode: number, count: number, type: number, offset: number): void {
    requireArguments('drawElements', 4, arguments.length);
    this.#state(native.drawElements, toUnsignedLong(mode), toLong(count), toUnsignedLong(type), toLongLong(offset));
  }

  // --- Framebuffers and renderbuffers (WebGL 1.0 §5.14.6–§5.14.7) -------

  /** WebGL 1.0 §5.14.6. */
  createFramebuffer(): WebGLFramebuffer {
    return createObject(this.#s, WebGLFramebuffer, 5, 0, { attachments: new Map() }) as WebGLFramebuffer;
  }

  /** WebGL 1.0 §5.14.6; `null` binds the drawing buffer. */
  bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null): void {
    requireArguments('bindFramebuffer', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const state = checkObject(s, framebuffer, WebGLFramebuffer, 'bindFramebuffer', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (!native.bindFramebuffer(s.index, s.version, t, ...keyOf(state))) return;
    if (t !== GL.READ_FRAMEBUFFER) s.drawFramebuffer = framebuffer;
    if (t !== GL.DRAW_FRAMEBUFFER) s.readFramebuffer = framebuffer;
  }

  /** WebGL 1.0 §5.14.6; a bound framebuffer falls back to the drawing buffer. */
  deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void {
    requireArguments('deleteFramebuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, framebuffer, WebGLFramebuffer, 'deleteFramebuffer', 1, true, 0);
    if (!state || framebuffer === null) return;
    state.deleted = true;
    collectedObjects.unregister(framebuffer);
    if (s.drawFramebuffer === framebuffer) s.drawFramebuffer = null;
    if (s.readFramebuffer === framebuffer) s.readFramebuffer = null;
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.6: true once the framebuffer has been bound. */
  isFramebuffer(framebuffer: WebGLFramebuffer | null): boolean {
    requireArguments('isFramebuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, framebuffer, WebGLFramebuffer, 'isFramebuffer', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.7. */
  createRenderbuffer(): WebGLRenderbuffer {
    return createObject(this.#s, WebGLRenderbuffer, 6, 0, {}) as WebGLRenderbuffer;
  }

  /** WebGL 1.0 §5.14.7. */
  bindRenderbuffer(target: number, renderbuffer: WebGLRenderbuffer | null): void {
    requireArguments('bindRenderbuffer', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const state = checkObject(s, renderbuffer, WebGLRenderbuffer, 'bindRenderbuffer', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.bindRenderbuffer(s.index, s.version, t, ...keyOf(state))) s.renderbuffer = renderbuffer;
  }

  /** WebGL 1.0 §5.14.7; detached from the bound framebuffers. */
  deleteRenderbuffer(renderbuffer: WebGLRenderbuffer | null): void {
    requireArguments('deleteRenderbuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, renderbuffer, WebGLRenderbuffer, 'deleteRenderbuffer', 1, true, 0);
    if (!state || renderbuffer === null) return;
    state.deleted = true;
    collectedObjects.unregister(renderbuffer);
    if (s.renderbuffer === renderbuffer) s.renderbuffer = null;
    detach(s, renderbuffer);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.7: true once the renderbuffer has been bound. */
  isRenderbuffer(renderbuffer: WebGLRenderbuffer | null): boolean {
    requireArguments('isRenderbuffer', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, renderbuffer, WebGLRenderbuffer, 'isRenderbuffer', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.7. */
  renderbufferStorage(target: number, internalformat: number, width: number, height: number): void {
    requireArguments('renderbufferStorage', 4, arguments.length);
    this.#state(native.renderbufferStorage, toUnsignedLong(target), toUnsignedLong(internalformat), toLong(width), toLong(height), null);
  }

  /** WebGL 1.0 §5.14.7. */
  getRenderbufferParameter(target: number, pname: number): unknown {
    requireArguments('getRenderbufferParameter', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return null;
    return native.getRenderbufferParameter(s.index, s.version, t, p);
  }

  /** Records an attachment GL accepted. */
  #attached(target: number, attachment: number, object: WebGLTexture | WebGLRenderbuffer | null): void {
    const framebuffer = framebufferFor(this.#s, target);
    if (framebuffer === null) return;
    const { attachments } = objectState(framebuffer) as FramebufferState;
    // WebGL 2's DEPTH_STENCIL_ATTACHMENT sets both points; WebGL 1's is a
    // point of its own (WebGL 1.0 §6.6).
    const points = this.#s.webgl2 && attachment === GL.DEPTH_STENCIL_ATTACHMENT ? [GL.DEPTH_ATTACHMENT, GL.STENCIL_ATTACHMENT] : [attachment];
    for (const point of points) {
      if (object === null) attachments.delete(point);
      else attachments.set(point, object);
    }
  }

  /** WebGL 1.0 §5.14.6. */
  framebufferTexture2D(target: number, attachment: number, textarget: number, texture: WebGLTexture | null, level: number): void {
    requireArguments('framebufferTexture2D', 5, arguments.length);
    const s = this.#s;
    const args = [toUnsignedLong(target), toUnsignedLong(attachment), toUnsignedLong(textarget)] as const;
    const l = toLong(level);
    const state = checkObject(s, texture, WebGLTexture, 'framebufferTexture2D', 4, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.attach(s.index, s.version, args[0], args[1], 0, args[2], l, ...keyOf(state))) {
      this.#attached(args[0], args[1], texture);
    }
  }

  /** WebGL 1.0 §5.14.6. */
  framebufferRenderbuffer(target: number, attachment: number, renderbuffertarget: number, renderbuffer: WebGLRenderbuffer | null): void {
    requireArguments('framebufferRenderbuffer', 4, arguments.length);
    const s = this.#s;
    const args = [toUnsignedLong(target), toUnsignedLong(attachment), toUnsignedLong(renderbuffertarget)] as const;
    const state = checkObject(s, renderbuffer, WebGLRenderbuffer, 'framebufferRenderbuffer', 4, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.attach(s.index, s.version, args[0], args[1], 2, args[2], 0, ...keyOf(state))) {
      this.#attached(args[0], args[1], renderbuffer);
    }
  }

  /** `framebufferTextureLayer` (WebGL 2), reached through `attachLayer`. */
  #attachLayer(target: number, attachment: number, texture: unknown, level: number, layer: number): void {
    const s = this.#s;
    const state = checkObject(s, texture, WebGLTexture, 'framebufferTextureLayer', 3, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.attach(s.index, s.version, target, attachment, 1, level, layer, ...keyOf(state))) {
      this.#attached(target, attachment, texture as WebGLTexture | null);
    }
  }

  /** WebGL 1.0 §5.14.6. */
  checkFramebufferStatus(target: number): number {
    requireArguments('checkFramebufferStatus', 1, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    // FRAMEBUFFER_UNSUPPORTED when lost (WebGL 1.0 §5.14.6, [WebGLHandlesContextLoss]).
    if (s.destroyed) return GL.FRAMEBUFFER_UNSUPPORTED;
    const status = native.checkFramebufferStatus(s.index, s.version, t);
    return status === 0 && native.isContextLost(s.index, s.version) ? GL.FRAMEBUFFER_UNSUPPORTED : status;
  }

  /** WebGL 1.0 §5.14.6. */
  getFramebufferAttachmentParameter(target: number, attachment: number, pname: number): unknown {
    requireArguments('getFramebufferAttachmentParameter', 3, arguments.length);
    const s = this.#s;
    const args = [toUnsignedLong(target), toUnsignedLong(attachment), toUnsignedLong(pname)] as const;
    if (s.destroyed) return null;
    const framebuffer = framebufferFor(s, args[0]);
    if (args[2] === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME && framebuffer !== null) {
      // On WebGL 2, DEPTH_STENCIL_ATTACHMENT names the object at both the
      // depth and stencil points, compared as objects (WebGL 2.0 §3.7.4);
      // ANGLE's own query also fails for different layers of one texture.
      const combined = s.webgl2 && args[1] === GL.DEPTH_STENCIL_ATTACHMENT;
      // The type query validates the target and attachment.
      const point = combined ? GL.DEPTH_ATTACHMENT : args[1];
      const type = native.getFramebufferAttachmentParameter(s.index, s.version, args[0], point, GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
      if (type === null) return null;
      const { attachments } = objectState(framebuffer) as FramebufferState;
      if (combined && (attachments.get(GL.DEPTH_ATTACHMENT) ?? null) !== (attachments.get(GL.STENCIL_ATTACHMENT) ?? null)) {
        native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
        return null;
      }
      if (type.numbers[0] === GL.NONE) {
        // WebGL 1 has no name to report for an empty point (OpenGL ES 2.0 §6.1.3).
        if (!s.webgl2) native.synthesizeError(s.index, s.version, GL.INVALID_ENUM);
        return null;
      }
      return attachments.get(point) ?? null;
    }
    return parameterValue(native.getFramebufferAttachmentParameter(s.index, s.version, ...args));
  }

  // --- Textures (WebGL 1.0 §5.14.8) --------------------------------------

  /** WebGL 1.0 §5.14.8. */
  createTexture(): WebGLTexture {
    return createObject(this.#s, WebGLTexture, 3, 0, {}) as WebGLTexture;
  }

  /** WebGL 1.0 §5.14.8. */
  bindTexture(target: number, texture: WebGLTexture | null): void {
    requireArguments('bindTexture', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const state = checkObject(s, texture, WebGLTexture, 'bindTexture', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.bindTexture(s.index, s.version, t, ...keyOf(state))) unitOf(s).set(t, texture);
  }

  /** WebGL 1.0 §5.14.8; GL unbinds it from every unit of this context. */
  deleteTexture(texture: WebGLTexture | null): void {
    requireArguments('deleteTexture', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, texture, WebGLTexture, 'deleteTexture', 1, true, 0);
    if (!state || texture === null) return;
    state.deleted = true;
    collectedObjects.unregister(texture);
    // Units get their map when first used, so the array has holes.
    for (const unit of s.textureUnits) {
      if (unit === undefined) continue;
      for (const [target, bound] of unit) if (bound === texture) unit.set(target, null);
    }
    detach(s, texture);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.8: true once the texture has been bound. */
  isTexture(texture: WebGLTexture | null): boolean {
    requireArguments('isTexture', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, texture, WebGLTexture, 'isTexture', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.8. */
  texParameterf(target: number, pname: number, param: number): void {
    requireArguments('texParameterf', 3, arguments.length);
    this.#state(native.texParameter, toUnsignedLong(target), toUnsignedLong(pname), toFloat(param), true);
  }

  /** WebGL 1.0 §5.14.8. */
  texParameteri(target: number, pname: number, param: number): void {
    requireArguments('texParameteri', 3, arguments.length);
    this.#state(native.texParameter, toUnsignedLong(target), toUnsignedLong(pname), toLong(param), false);
  }

  /** WebGL 1.0 §5.14.8. */
  getTexParameter(target: number, pname: number): unknown {
    requireArguments('getTexParameter', 2, arguments.length);
    const s = this.#s;
    const t = toUnsignedLong(target);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return null;
    return parameterValue(native.getTexParameter(s.index, s.version, t, p));
  }

  /** WebGL 1.0 §5.14.8. */
  generateMipmap(target: number): void {
    requireArguments('generateMipmap', 1, arguments.length);
    this.#state(native.generateMipmap, toUnsignedLong(target));
  }

  /**
   * WebGL 1.0 §5.14.8 and WebGL 2.0 §3.7.6: the `ArrayBufferView`,
   * `TexImageSource` and (WebGL 2) pixel-unpack-buffer forms.
   */
  texImage2D(target: number, level: number, internalformat: number, ...rest: unknown[]): void {
    const count = arguments.length;
    const s = this.#s;
    if (count === 6) {
      requireArguments('texImage2D', 6, count);
      const args = texArgs(target, level, internalformat, 0, 0, 0, 0, 0, 0, 0, rest[0], rest[1]);
      upload(s, 0, args, rest[2], undefined, 'texImage2D', 6, true);
      return;
    }
    requireArguments('texImage2D', 9, count);
    const args = texArgs(target, level, internalformat, 0, 0, 0, rest[0], rest[1], 1, rest[2], rest[3], rest[4]);
    upload(s, 0, args, rest[5], count > 9 ? rest[6] : undefined, 'texImage2D', 9, false);
  }

  /** WebGL 1.0 §5.14.8 and WebGL 2.0 §3.7.6. */
  texSubImage2D(target: number, level: number, xoffset: number, yoffset: number, ...rest: unknown[]): void {
    const count = arguments.length;
    const s = this.#s;
    if (count === 7) {
      const args = texArgs(target, level, 0, xoffset, yoffset, 0, 0, 0, 0, 0, rest[0], rest[1]);
      upload(s, 1, args, rest[2], undefined, 'texSubImage2D', 7, true);
      return;
    }
    requireArguments('texSubImage2D', 9, count);
    const args = texArgs(target, level, 0, xoffset, yoffset, 0, rest[0], rest[1], 1, 0, rest[2], rest[3]);
    upload(s, 1, args, rest[4], count > 9 ? rest[5] : undefined, 'texSubImage2D', 9, false);
  }

  /** WebGL 1.0 §5.14.8; WebGL 2 adds the unpack-buffer and `srcOffset` forms. */
  compressedTexImage2D(target: number, level: number, internalformat: number, width: number, height: number, border: number, ...rest: unknown[]): void {
    requireArguments('compressedTexImage2D', 7, arguments.length);
    const args = texArgs(target, level, internalformat, 0, 0, 0, width, height, 1, border, 0, 0);
    compressed(this.#s, 0, args, rest, 'compressedTexImage2D', 7);
  }

  /** WebGL 1.0 §5.14.8; WebGL 2 adds the unpack-buffer and `srcOffset` forms. */
  compressedTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, width: number, height: number, format: number, ...rest: unknown[]): void {
    requireArguments('compressedTexSubImage2D', 8, arguments.length);
    const args = texArgs(target, level, 0, xoffset, yoffset, 0, width, height, 1, 0, format, 0);
    compressed(this.#s, 1, args, rest, 'compressedTexSubImage2D', 8);
  }

  /** WebGL 1.0 §5.14.8. */
  copyTexImage2D(target: number, level: number, internalformat: number, x: number, y: number, width: number, height: number, border: number): void {
    requireArguments('copyTexImage2D', 8, arguments.length);
    this.#state(
      native.copyTexImage2D,
      toUnsignedLong(target),
      toLong(level),
      toUnsignedLong(internalformat),
      toLong(x),
      toLong(y),
      toLong(width),
      toLong(height),
      toLong(border),
    );
  }

  /** WebGL 1.0 §5.14.8. */
  copyTexSubImage2D(target: number, level: number, xoffset: number, yoffset: number, x: number, y: number, width: number, height: number): void {
    requireArguments('copyTexSubImage2D', 8, arguments.length);
    this.#state(
      native.copyTexSubImage,
      toUnsignedLong(target),
      toLong(level),
      toLong(xoffset),
      toLong(yoffset),
      null,
      toLong(x),
      toLong(y),
      toLong(width),
      toLong(height),
    );
  }

  /**
   * Non-standard: releases the context's native resources now and puts it in
   * the lost state. Later calls are no-ops; calling it again does nothing.
   */
  destroy(): void {
    if (this.#s.destroyed) return;
    this.#s.destroyed = true;
    this.#s.width = 0;
    this.#s.height = 0;
    collected.unregister(this);
    native.destroy(this.#s.index, this.#s.version);
  }
}

type WithConstants<A extends unknown[], I, K> = K & { readonly prototype: I & K; new (...args: A): I & K };

/**
 * Defines `table` as WebIDL constants (WebIDL §3.7.1) on the interface object
 * `cls` and its prototype: read-only, enumerable, not configurable.
 */
function withConstants<A extends unknown[], I extends object, K extends Readonly<Record<string, number>>>(
  cls: new (...args: A) => I,
  table: K,
): WithConstants<A, I, K> {
  for (const target of [cls, cls.prototype] as object[]) {
    for (const [name, value] of Object.entries(table)) {
      Object.defineProperty(target, name, { value, writable: false, enumerable: true, configurable: false });
    }
  }
  return cls as unknown as WithConstants<A, I, K>;
}

type ContextArguments = ConstructorParameters<typeof ContextBase>;
type WebGL1Constants = typeof WEBGL1_CONSTANTS;
type WebGL2Constants = typeof WEBGL2_CONSTANTS;

/** A WebGL 1 context (WebGL 1.0 §5.14). */
export interface WebGLRenderingContext extends ContextBase, WebGL1Constants {}
exposeMembers(WebGLContextEvent);

export const WebGLRenderingContext: WebGL1Constants & {
  readonly prototype: WebGLRenderingContext;
  new (...args: ContextArguments): WebGLRenderingContext;
} = withConstants(class WebGLRenderingContext extends ContextBase {}, WEBGL1_CONSTANTS);

/** The WebGL 2-only members (WebGL 2.0 §3.7). */
abstract class WebGL2Members extends ContextBase {
  /** WebGL 2.0 §3.7.3. */
  copyBufferSubData(readTarget: number, writeTarget: number, readOffset: number, writeOffset: number, size: number): void {
    requireArguments('copyBufferSubData', 5, arguments.length);
    const s = contextState(this);
    const args = [
      toUnsignedLong(readTarget),
      toUnsignedLong(writeTarget),
      toLongLong(readOffset),
      toLongLong(writeOffset),
      toLongLong(size),
    ] as const;
    if (!s.destroyed) native.copyBufferSubData(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.3. */
  getBufferSubData(target: number, srcByteOffset: number, dstBuffer: ArrayBufferView, dstOffset = 0, length = 0): void {
    requireArguments('getBufferSubData', 3, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const src = toLongLong(srcByteOffset);
    if (!ArrayBuffer.isView(dstBuffer)) throw typeError('getBufferSubData', 3, 'ArrayBufferView');
    const offset = toUnsignedLongLong(dstOffset);
    const count = toUnsignedLong(length);
    if (!s.destroyed) native.getBufferSubData(s.index, s.version, t, src, dstBuffer, offset, count);
  }

  /** WebGL 2.0 §3.7.9. */
  drawRangeElements(mode: number, start: number, end: number, count: number, type: number, offset: number): void {
    requireArguments('drawRangeElements', 6, arguments.length);
    const s = contextState(this);
    const args = [
      toUnsignedLong(mode),
      toUnsignedLong(start),
      toUnsignedLong(end),
      toLong(count),
      toUnsignedLong(type),
      toLongLong(offset),
    ] as const;
    if (!s.destroyed) native.drawRangeElements(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.7; -1 when absent or lost. */
  getFragDataLocation(program: WebGLProgram, name: string): number {
    requireArguments('getFragDataLocation', 2, arguments.length);
    const s = contextState(this);
    const n = toDOMString(name);
    const p = checkObject(s, program, WebGLProgram, 'getFragDataLocation', 1, false, GL.INVALID_VALUE);
    if (!p) return -1;
    return native.getLocation(s.index, s.version, ...keyOf(p), n, 2);
  }

  uniform1ui(location: WebGLUniformLocation | null, v0: number): void {
    requireArguments('uniform1ui', 2, arguments.length);
    uniformUint(this, 'uniform1ui', location, [toUnsignedLong(v0)]);
  }
  uniform2ui(location: WebGLUniformLocation | null, v0: number, v1: number): void {
    requireArguments('uniform2ui', 3, arguments.length);
    uniformUint(this, 'uniform2ui', location, [toUnsignedLong(v0), toUnsignedLong(v1)]);
  }
  uniform3ui(location: WebGLUniformLocation | null, v0: number, v1: number, v2: number): void {
    requireArguments('uniform3ui', 4, arguments.length);
    uniformUint(this, 'uniform3ui', location, [toUnsignedLong(v0), toUnsignedLong(v1), toUnsignedLong(v2)]);
  }
  uniform4ui(location: WebGLUniformLocation | null, v0: number, v1: number, v2: number, v3: number): void {
    requireArguments('uniform4ui', 5, arguments.length);
    uniformUint(this, 'uniform4ui', location, [
      toUnsignedLong(v0),
      toUnsignedLong(v1),
      toUnsignedLong(v2),
      toUnsignedLong(v3),
    ]);
  }
  uniform1uiv(location: WebGLUniformLocation | null, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformList(this, 'uniform1uiv', 1, arguments.length, location, data, srcOffset, srcLength);
  }
  uniform2uiv(location: WebGLUniformLocation | null, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformList(this, 'uniform2uiv', 2, arguments.length, location, data, srcOffset, srcLength);
  }
  uniform3uiv(location: WebGLUniformLocation | null, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformList(this, 'uniform3uiv', 3, arguments.length, location, data, srcOffset, srcLength);
  }
  uniform4uiv(location: WebGLUniformLocation | null, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformList(this, 'uniform4uiv', 4, arguments.length, location, data, srcOffset, srcLength);
  }
  uniformMatrix2x3fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix2x3fv', 2, 3, arguments.length, location, transpose, data, srcOffset, srcLength);
  }
  uniformMatrix3x2fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix3x2fv', 3, 2, arguments.length, location, transpose, data, srcOffset, srcLength);
  }
  uniformMatrix2x4fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix2x4fv', 2, 4, arguments.length, location, transpose, data, srcOffset, srcLength);
  }
  uniformMatrix4x2fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix4x2fv', 4, 2, arguments.length, location, transpose, data, srcOffset, srcLength);
  }
  uniformMatrix3x4fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix3x4fv', 3, 4, arguments.length, location, transpose, data, srcOffset, srcLength);
  }
  uniformMatrix4x3fv(location: WebGLUniformLocation | null, transpose: boolean, data: Iterable<number>, srcOffset?: number, srcLength?: number): void {
    uniformMatrixList(this, 'uniformMatrix4x3fv', 4, 3, arguments.length, location, transpose, data, srcOffset, srcLength);
  }

  /** WebGL 2.0 §3.7.4. */
  framebufferTextureLayer(target: number, attachment: number, texture: WebGLTexture | null, level: number, layer: number): void {
    requireArguments('framebufferTextureLayer', 5, arguments.length);
    const t = toUnsignedLong(target);
    const a = toUnsignedLong(attachment);
    const l = toLong(level);
    const y = toLong(layer);
    attachLayer(this, t, a, texture, l, y);
  }

  /** WebGL 2.0 §3.7.4. */
  blitFramebuffer(srcX0: number, srcY0: number, srcX1: number, srcY1: number, dstX0: number, dstY0: number, dstX1: number, dstY1: number, mask: number, filter: number): void {
    requireArguments('blitFramebuffer', 10, arguments.length);
    const s = contextState(this);
    const args = [toLong(srcX0), toLong(srcY0), toLong(srcX1), toLong(srcY1), toLong(dstX0), toLong(dstY0), toLong(dstX1), toLong(dstY1), toUnsignedLong(mask), toUnsignedLong(filter)] as const;
    if (!s.destroyed) native.blitFramebuffer(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.11. */
  drawBuffers(buffers: Iterable<number>): void {
    requireArguments('drawBuffers', 1, arguments.length);
    const s = contextState(this);
    const list = [...toList(Uint32Array, toUnsignedLong, buffers, 'drawBuffers')];
    if (!s.destroyed) native.drawBuffers(s.index, s.version, list);
  }

  /** WebGL 2.0 §3.7.4. */
  readBuffer(src: number): void {
    requireArguments('readBuffer', 1, arguments.length);
    const s = contextState(this);
    const v = toUnsignedLong(src);
    if (!s.destroyed) native.readBuffer(s.index, s.version, v);
  }

  /** WebGL 2.0 §3.7.4. */
  invalidateFramebuffer(target: number, attachments: Iterable<number>): void {
    requireArguments('invalidateFramebuffer', 2, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const list = [...toList(Uint32Array, toUnsignedLong, attachments, 'invalidateFramebuffer')];
    if (!s.destroyed) native.invalidateFramebuffer(s.index, s.version, t, list, null);
  }

  /** WebGL 2.0 §3.7.4. */
  invalidateSubFramebuffer(target: number, attachments: Iterable<number>, x: number, y: number, width: number, height: number): void {
    requireArguments('invalidateSubFramebuffer', 6, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const list = [...toList(Uint32Array, toUnsignedLong, attachments, 'invalidateSubFramebuffer')];
    const region = [toLong(x), toLong(y), toLong(width), toLong(height)];
    if (!s.destroyed) native.invalidateFramebuffer(s.index, s.version, t, list, region);
  }

  /** WebGL 2.0 §3.7.9. */
  clearBufferfv(buffer: number, drawbuffer: number, values: Iterable<number>, srcOffset = 0): void {
    requireArguments('clearBufferfv', 3, arguments.length);
    clearBuffer(this, buffer, drawbuffer, 0, toList(Float32Array, toFloat, values, 'clearBufferfv'), srcOffset);
  }

  /** WebGL 2.0 §3.7.9. */
  clearBufferiv(buffer: number, drawbuffer: number, values: Iterable<number>, srcOffset = 0): void {
    requireArguments('clearBufferiv', 3, arguments.length);
    clearBuffer(this, buffer, drawbuffer, 1, toList(Int32Array, toLong, values, 'clearBufferiv'), srcOffset);
  }

  /** WebGL 2.0 §3.7.9. */
  clearBufferuiv(buffer: number, drawbuffer: number, values: Iterable<number>, srcOffset = 0): void {
    requireArguments('clearBufferuiv', 3, arguments.length);
    clearBuffer(this, buffer, drawbuffer, 2, toList(Uint32Array, toUnsignedLong, values, 'clearBufferuiv'), srcOffset);
  }

  /** WebGL 2.0 §3.7.9. */
  clearBufferfi(buffer: number, drawbuffer: number, depth: number, stencil: number): void {
    requireArguments('clearBufferfi', 4, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(buffer), toLong(drawbuffer), toFloat(depth), toLong(stencil)] as const;
    if (!s.destroyed) native.clearBufferFi(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.5. */
  renderbufferStorageMultisample(target: number, samples: number, internalformat: number, width: number, height: number): void {
    requireArguments('renderbufferStorageMultisample', 5, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(target), toLong(samples), toUnsignedLong(internalformat), toLong(width), toLong(height)] as const;
    if (!s.destroyed) native.renderbufferStorage(s.index, s.version, args[0], args[2], args[3], args[4], args[1]);
  }

  /** WebGL 2.0 §3.7.5. */
  getInternalformatParameter(target: number, internalformat: number, pname: number): unknown {
    requireArguments('getInternalformatParameter', 3, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(target), toUnsignedLong(internalformat), toUnsignedLong(pname)] as const;
    if (s.destroyed) return null;
    return parameterValue(native.getInternalformatParameter(s.index, s.version, ...args));
  }

  // --- Vertex arrays and instancing (WebGL 2.0 §3.7.9, §3.7.17) --------

  /** WebGL 2.0 §3.7.17. */
  createVertexArray(): WebGLVertexArrayObject {
    return createVertexArrayIn(contextState(this), WebGLVertexArrayObject);
  }

  /** WebGL 2.0 §3.7.17; the default vertex array is bound if it was. */
  deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
    requireArguments('deleteVertexArray', 1, arguments.length);
    deleteVertexArrayIn(contextState(this), vertexArray, WebGLVertexArrayObject, 'deleteVertexArray');
  }

  /** WebGL 2.0 §3.7.17: true once bound. */
  isVertexArray(vertexArray: WebGLVertexArrayObject | null): boolean {
    requireArguments('isVertexArray', 1, arguments.length);
    return isVertexArrayIn(contextState(this), vertexArray, WebGLVertexArrayObject, 'isVertexArray');
  }

  /** WebGL 2.0 §3.7.17. */
  bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
    requireArguments('bindVertexArray', 1, arguments.length);
    bindVertexArrayIn(contextState(this), vertexArray, WebGLVertexArrayObject, 'bindVertexArray');
  }

  /** WebGL 2.0 §3.7.9. */
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void {
    requireArguments('drawArraysInstanced', 4, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(mode), toLong(first), toLong(count), toLong(instanceCount)] as const;
    if (!s.destroyed) native.drawArraysInstanced(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.9. */
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instanceCount: number): void {
    requireArguments('drawElementsInstanced', 5, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(mode), toLong(count), toUnsignedLong(type), toLongLong(offset), toLong(instanceCount)] as const;
    if (!s.destroyed) native.drawElementsInstanced(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.8. */
  vertexAttribDivisor(index: number, divisor: number): void {
    requireArguments('vertexAttribDivisor', 2, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(index), toUnsignedLong(divisor)] as const;
    if (!s.destroyed) native.vertexAttribDivisor(s.index, s.version, ...args);
  }

  // --- Indexed bindings and uniform blocks (WebGL 2.0 §3.7.3, §3.7.16) ---

  /** WebGL 2.0 §3.7.3. */
  bindBufferBase(target: number, index: number, buffer: WebGLBuffer | null): void {
    requireArguments('bindBufferBase', 3, arguments.length);
    bindIndexed(this, target, index, buffer, null);
  }

  /** WebGL 2.0 §3.7.3. */
  bindBufferRange(target: number, index: number, buffer: WebGLBuffer | null, offset: number, size: number): void {
    requireArguments('bindBufferRange', 5, arguments.length);
    bindIndexed(this, target, index, buffer, [offset, size]);
  }

  /** WebGL 2.0 §3.7.2. */
  getIndexedParameter(target: number, index: number): unknown {
    requireArguments('getIndexedParameter', 2, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const i = toUnsignedLong(index);
    if (s.destroyed) return null;
    if (t === GL.TRANSFORM_FEEDBACK_BUFFER_BINDING || t === GL.UNIFORM_BUFFER_BINDING) {
      // Validates the index (and generates its error) through GL.
      const start = t === GL.UNIFORM_BUFFER_BINDING ? GL.UNIFORM_BUFFER_START : GL.TRANSFORM_FEEDBACK_BUFFER_START;
      if (native.getIndexedParameter(s.index, s.version, start, i) === null) return null;
      return (t === GL.UNIFORM_BUFFER_BINDING ? s.uniformBuffers : s.tfBuffers)[i] ?? null;
    }
    return parameterValue(native.getIndexedParameter(s.index, s.version, t, i));
  }

  /** WebGL 2.0 §3.7.16. */
  getUniformIndices(program: WebGLProgram, uniformNames: Iterable<string>): number[] | null {
    requireArguments('getUniformIndices', 2, arguments.length);
    const s = contextState(this);
    const names = toStrings(uniformNames, 'getUniformIndices');
    const p = checkObject(s, program, WebGLProgram, 'getUniformIndices', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    const indices = native.getUniformIndices(s.index, s.version, ...keyOf(p), names);
    return indices === null ? null : Array.from(indices);
  }

  /** WebGL 2.0 §3.7.16. */
  getActiveUniforms(program: WebGLProgram, uniformIndices: Iterable<number>, pname: number): unknown {
    requireArguments('getActiveUniforms', 3, arguments.length);
    const s = contextState(this);
    const indices = [...toList(Uint32Array, toUnsignedLong, uniformIndices, 'getActiveUniforms')];
    const name = toUnsignedLong(pname);
    const p = checkObject(s, program, WebGLProgram, 'getActiveUniforms', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    return parameterValue(native.getActiveUniforms(s.index, s.version, ...keyOf(p), indices, name));
  }

  /** WebGL 2.0 §3.7.16. */
  getUniformBlockIndex(program: WebGLProgram, uniformBlockName: string): number {
    requireArguments('getUniformBlockIndex', 2, arguments.length);
    const s = contextState(this);
    const name = toDOMString(uniformBlockName);
    const p = checkObject(s, program, WebGLProgram, 'getUniformBlockIndex', 1, false, GL.INVALID_VALUE);
    if (!p) return GL.INVALID_INDEX;
    return native.getUniformBlockIndex(s.index, s.version, ...keyOf(p), name);
  }

  /** WebGL 2.0 §3.7.16. */
  getActiveUniformBlockParameter(program: WebGLProgram, uniformBlockIndex: number, pname: number): unknown {
    requireArguments('getActiveUniformBlockParameter', 3, arguments.length);
    const s = contextState(this);
    const block = toUnsignedLong(uniformBlockIndex);
    const name = toUnsignedLong(pname);
    const p = checkObject(s, program, WebGLProgram, 'getActiveUniformBlockParameter', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    return parameterValue(native.getActiveUniformBlockParameter(s.index, s.version, ...keyOf(p), block, name));
  }

  /** WebGL 2.0 §3.7.16. */
  getActiveUniformBlockName(program: WebGLProgram, uniformBlockIndex: number): string | null {
    requireArguments('getActiveUniformBlockName', 2, arguments.length);
    const s = contextState(this);
    const block = toUnsignedLong(uniformBlockIndex);
    const p = checkObject(s, program, WebGLProgram, 'getActiveUniformBlockName', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    return native.getActiveUniformBlockName(s.index, s.version, ...keyOf(p), block);
  }

  /** WebGL 2.0 §3.7.16. */
  uniformBlockBinding(program: WebGLProgram, uniformBlockIndex: number, uniformBlockBinding: number): void {
    requireArguments('uniformBlockBinding', 3, arguments.length);
    const s = contextState(this);
    const block = toUnsignedLong(uniformBlockIndex);
    const binding = toUnsignedLong(uniformBlockBinding);
    const p = checkObject(s, program, WebGLProgram, 'uniformBlockBinding', 1, false, GL.INVALID_VALUE);
    if (p) native.uniformBlockBinding(s.index, s.version, ...keyOf(p), block, binding);
  }

  // --- Transform feedback (WebGL 2.0 §3.7.15) ----------------------------

  /** WebGL 2.0 §3.7.15. */
  createTransformFeedback(): WebGLTransformFeedback {
    return createObject(contextState(this), WebGLTransformFeedback, 8, 0, { buffers: [] }) as WebGLTransformFeedback;
  }

  /** WebGL 2.0 §3.7.15. */
  deleteTransformFeedback(transformFeedback: WebGLTransformFeedback | null): void {
    requireArguments('deleteTransformFeedback', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, transformFeedback, WebGLTransformFeedback, 'deleteTransformFeedback', 1, true, 0);
    if (!state || transformFeedback === null) return;
    if (s.transformFeedback === transformFeedback) {
      // An active transform feedback cannot be deleted (OpenGL ES 3.0 §2.15.1).
      const active = native.getParameter(s.index, s.version, GL.TRANSFORM_FEEDBACK_ACTIVE);
      if (active !== null && active.numbers[0] !== 0) {
        native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
        return;
      }
      s.transformFeedback = null;
      s.tfBuffers = s.defaultTfBuffers;
    }
    state.deleted = true;
    collectedObjects.unregister(transformFeedback);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.15: true once bound. */
  isTransformFeedback(transformFeedback: WebGLTransformFeedback | null): boolean {
    requireArguments('isTransformFeedback', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, transformFeedback, WebGLTransformFeedback, 'isTransformFeedback', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.15. */
  bindTransformFeedback(target: number, transformFeedback: WebGLTransformFeedback | null): void {
    requireArguments('bindTransformFeedback', 2, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const state = checkObject(s, transformFeedback, WebGLTransformFeedback, 'bindTransformFeedback', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (!native.bindTransformFeedback(s.index, s.version, t, ...keyOf(state))) return;
    s.transformFeedback = transformFeedback;
    s.tfBuffers = state === null ? s.defaultTfBuffers : (state as unknown as { buffers: (WebGLBuffer | null)[] }).buffers;
  }

  /** WebGL 2.0 §3.7.15. */
  beginTransformFeedback(primitiveMode: number): void {
    requireArguments('beginTransformFeedback', 1, arguments.length);
    const s = contextState(this);
    const mode = toUnsignedLong(primitiveMode);
    if (!s.destroyed) native.transformFeedback(s.index, s.version, 0, mode);
  }

  /** WebGL 2.0 §3.7.15. */
  endTransformFeedback(): void {
    const s = contextState(this);
    if (!s.destroyed) native.transformFeedback(s.index, s.version, 1, 0);
  }

  /** WebGL 2.0 §3.7.15. */
  pauseTransformFeedback(): void {
    const s = contextState(this);
    if (!s.destroyed) native.transformFeedback(s.index, s.version, 2, 0);
  }

  /** WebGL 2.0 §3.7.15. */
  resumeTransformFeedback(): void {
    const s = contextState(this);
    if (!s.destroyed) native.transformFeedback(s.index, s.version, 3, 0);
  }

  /** WebGL 2.0 §3.7.15. */
  transformFeedbackVaryings(program: WebGLProgram, varyings: Iterable<string>, bufferMode: number): void {
    requireArguments('transformFeedbackVaryings', 3, arguments.length);
    const s = contextState(this);
    const names = toStrings(varyings, 'transformFeedbackVaryings');
    const mode = toUnsignedLong(bufferMode);
    const p = checkObject(s, program, WebGLProgram, 'transformFeedbackVaryings', 1, false, GL.INVALID_VALUE);
    if (p) native.transformFeedbackVaryings(s.index, s.version, ...keyOf(p), names, mode);
  }

  /** WebGL 2.0 §3.7.15. */
  getTransformFeedbackVarying(program: WebGLProgram, index: number): WebGLActiveInfo | null {
    requireArguments('getTransformFeedbackVarying', 2, arguments.length);
    const s = contextState(this);
    const i = toUnsignedLong(index);
    const p = checkObject(s, program, WebGLProgram, 'getTransformFeedbackVarying', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    const info = native.getTransformFeedbackVarying(s.index, s.version, ...keyOf(p), i);
    return info === null ? null : new WebGLActiveInfo(CONSTRUCTING, info.size, info.ty, info.name);
  }

  // --- Queries (WebGL 2.0 §3.7.12) ---------------------------------------

  /** WebGL 2.0 §3.7.12. */
  createQuery(): WebGLQuery {
    return createObject(contextState(this), WebGLQuery, 9, 0, { turn: 0, target: 0 }) as WebGLQuery;
  }

  /** WebGL 2.0 §3.7.12. */
  deleteQuery(query: WebGLQuery | null): void {
    requireArguments('deleteQuery', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, query, WebGLQuery, 'deleteQuery', 1, true, 0);
    if (!state || query === null) return;
    state.deleted = true;
    collectedObjects.unregister(query);
    // GL keeps a deleted active query active (OpenGL ES 3.0 §2.14); WebGL
    // ends it first, as Chromium does, so its target can begin another.
    for (const [target, active] of s.queries) {
      if (active !== query) continue;
      native.endQuery(s.index, s.version, target);
      s.queries.delete(target);
    }
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.12: true once begun. */
  isQuery(query: WebGLQuery | null): boolean {
    requireArguments('isQuery', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, query, WebGLQuery, 'isQuery', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.12. */
  beginQuery(target: number, query: WebGLQuery): void {
    requireArguments('beginQuery', 2, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const state = checkObject(s, query, WebGLQuery, 'beginQuery', 2, false, GL.INVALID_OPERATION) as PendingState | null | undefined;
    if (!state) return;
    if (native.beginQuery(s.index, s.version, t, ...keyOf(state))) {
      s.queries.set(t, query);
      state.target = t;
    }
  }

  /** WebGL 2.0 §3.7.12; the result waits for the event loop (§5.35). */
  endQuery(target: number): void {
    requireArguments('endQuery', 1, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    if (s.destroyed || !native.endQuery(s.index, s.version, t)) return;
    // Submit the work, as a browser does at the end of each frame, so the
    // result can be ready by the next turn.
    native.flush(s.index, s.version);
    const query = s.queries.get(t);
    s.queries.delete(t);
    if (query !== undefined) (objectState(query) as PendingState).turn = nextTurn();
  }

  /** WebGL 2.0 §3.7.12: `CURRENT_QUERY` only. */
  getQuery(target: number, pname: number): WebGLQuery | null {
    requireArguments('getQuery', 2, arguments.length);
    const s = contextState(this);
    const t = toUnsignedLong(target);
    const p = toUnsignedLong(pname);
    if (s.destroyed) return null;
    const targets: number[] = [GL.ANY_SAMPLES_PASSED, GL.ANY_SAMPLES_PASSED_CONSERVATIVE, GL.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN];
    if (!targets.includes(t) || p !== GL.CURRENT_QUERY) {
      native.synthesizeError(s.index, s.version, GL.INVALID_ENUM);
      return null;
    }
    return s.queries.get(t) ?? null;
  }

  /** WebGL 2.0 §3.7.12. */
  getQueryParameter(query: WebGLQuery, pname: number): unknown {
    requireArguments('getQueryParameter', 2, arguments.length);
    const s = contextState(this);
    const p = toUnsignedLong(pname);
    const state = checkObject(s, query, WebGLQuery, 'getQueryParameter', 1, false, GL.INVALID_OPERATION) as PendingState | null | undefined;
    if (!state) return null;
    // An active query, or one never begun, has no result (OpenGL ES 3.0 §6.1.7).
    if (state.target === 0 || [...s.queries.values()].includes(query)) {
      native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
      return null;
    }
    const ready = turn > state.turn;
    if (p === GL.QUERY_RESULT_AVAILABLE && !ready) return false;
    if (p === GL.QUERY_RESULT && !ready) return 0;
    return parameterValue(native.getQueryParameter(s.index, s.version, ...keyOf(state), p));
  }

  // --- Sync objects (WebGL 2.0 §3.7.14) ----------------------------------

  /** WebGL 2.0 §3.7.14; signals no earlier than the next turn (§5.35). */
  fenceSync(condition: number, flags: number): WebGLSync | null {
    requireArguments('fenceSync', 2, arguments.length);
    const s = contextState(this);
    const c = toUnsignedLong(condition);
    const f = toUnsignedLong(flags);
    if (s.destroyed) return null;
    const key = native.fenceSync(s.index, s.version, c, f);
    if (key === null) return null;
    native.flush(s.index, s.version);
    const state = { owner: s, key: [key[0], key[1]] as const, deleted: false, turn: nextTurn(), target: 0 };
    const sync = new WebGLSync(CONSTRUCTING, state);
    collectedObjects.register(sync, Object.freeze([s.index, s.version, key[0], key[1]] as const), sync);
    return sync;
  }

  /** WebGL 2.0 §3.7.14. */
  isSync(sync: WebGLSync | null): boolean {
    requireArguments('isSync', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, sync, WebGLSync, 'isSync', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.14. */
  deleteSync(sync: WebGLSync | null): void {
    requireArguments('deleteSync', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, sync, WebGLSync, 'deleteSync', 1, true, 0);
    if (!state || sync === null) return;
    state.deleted = true;
    collectedObjects.unregister(sync);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.14: never blocks; `TIMEOUT_EXPIRED` before the next turn. */
  clientWaitSync(sync: WebGLSync, flags: number, timeout: number): number {
    requireArguments('clientWaitSync', 3, arguments.length);
    const s = contextState(this);
    const f = toUnsignedLong(flags);
    const t = toUnsignedLongLong(timeout);
    const state = checkObject(s, sync, WebGLSync, 'clientWaitSync', 1, false, GL.INVALID_VALUE) as PendingState | null | undefined;
    if (!state) return GL.WAIT_FAILED;
    const result = native.clientWaitSync(s.index, s.version, ...keyOf(state), f, t);
    if (result !== GL.WAIT_FAILED && turn <= state.turn) return GL.TIMEOUT_EXPIRED;
    return result;
  }

  /** WebGL 2.0 §3.7.14. */
  waitSync(sync: WebGLSync, flags: number, timeout: number): void {
    requireArguments('waitSync', 3, arguments.length);
    const s = contextState(this);
    const f = toUnsignedLong(flags);
    const t = toLongLong(timeout);
    const state = checkObject(s, sync, WebGLSync, 'waitSync', 1, false, GL.INVALID_VALUE);
    if (state) native.waitSync(s.index, s.version, ...keyOf(state), f, t);
  }

  /** WebGL 2.0 §3.7.14; `UNSIGNALED` before the next turn. */
  getSyncParameter(sync: WebGLSync, pname: number): unknown {
    requireArguments('getSyncParameter', 2, arguments.length);
    const s = contextState(this);
    const p = toUnsignedLong(pname);
    const state = checkObject(s, sync, WebGLSync, 'getSyncParameter', 1, false, GL.INVALID_VALUE) as PendingState | null | undefined;
    if (!state) return null;
    const value = native.getSyncParameter(s.index, s.version, ...keyOf(state), p);
    if (p === GL.SYNC_STATUS && value !== null && turn <= state.turn) return GL.UNSIGNALED;
    return value;
  }

  /** WebGL 2.0 §3.7.6. */
  texImage3D(target: number, level: number, internalformat: number, width: number, height: number, depth: number, border: number, format: number, type: number, ...rest: unknown[]): void {
    requireArguments('texImage3D', 10, arguments.length);
    const args = texArgs(target, level, internalformat, 0, 0, 0, width, height, depth, border, format, type);
    upload(contextState(this), 2, args, rest[0], rest.length > 1 ? rest[1] : undefined, 'texImage3D', 10, false);
  }

  /** WebGL 2.0 §3.7.6. */
  texSubImage3D(target: number, level: number, xoffset: number, yoffset: number, zoffset: number, width: number, height: number, depth: number, format: number, type: number, ...rest: unknown[]): void {
    requireArguments('texSubImage3D', 11, arguments.length);
    const args = texArgs(target, level, 0, xoffset, yoffset, zoffset, width, height, depth, 0, format, type);
    upload(contextState(this), 3, args, rest[0], rest.length > 1 ? rest[1] : undefined, 'texSubImage3D', 11, false);
  }

  /** WebGL 2.0 §3.7.6. */
  compressedTexImage3D(target: number, level: number, internalformat: number, width: number, height: number, depth: number, border: number, ...rest: unknown[]): void {
    requireArguments('compressedTexImage3D', 8, arguments.length);
    const args = texArgs(target, level, internalformat, 0, 0, 0, width, height, depth, border, 0, 0);
    compressed(contextState(this), 2, args, rest, 'compressedTexImage3D', 8);
  }

  /** WebGL 2.0 §3.7.6. */
  compressedTexSubImage3D(target: number, level: number, xoffset: number, yoffset: number, zoffset: number, width: number, height: number, depth: number, format: number, ...rest: unknown[]): void {
    requireArguments('compressedTexSubImage3D', 10, arguments.length);
    const args = texArgs(target, level, 0, xoffset, yoffset, zoffset, width, height, depth, 0, format, 0);
    compressed(contextState(this), 3, args, rest, 'compressedTexSubImage3D', 10);
  }

  /** WebGL 2.0 §3.7.6. */
  copyTexSubImage3D(target: number, level: number, xoffset: number, yoffset: number, zoffset: number, x: number, y: number, width: number, height: number): void {
    requireArguments('copyTexSubImage3D', 9, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(target), toLong(level), toLong(xoffset), toLong(yoffset), toLong(zoffset), toLong(x), toLong(y), toLong(width), toLong(height)] as const;
    if (!s.destroyed) native.copyTexSubImage(s.index, s.version, ...args);
  }

  /** WebGL 2.0 §3.7.6. */
  texStorage2D(target: number, levels: number, internalformat: number, width: number, height: number): void {
    requireArguments('texStorage2D', 5, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(target), toLong(levels), toUnsignedLong(internalformat), toLong(width), toLong(height)] as const;
    if (!s.destroyed) native.texStorage(s.index, s.version, ...args, null);
  }

  /** WebGL 2.0 §3.7.6. */
  texStorage3D(target: number, levels: number, internalformat: number, width: number, height: number, depth: number): void {
    requireArguments('texStorage3D', 6, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(target), toLong(levels), toUnsignedLong(internalformat), toLong(width), toLong(height), toLong(depth)] as const;
    if (!s.destroyed) native.texStorage(s.index, s.version, ...args);
  }

  // --- Samplers (WebGL 2.0 §3.7.13) --------------------------------------

  /** WebGL 2.0 §3.7.13. */
  createSampler(): WebGLSampler {
    return createObject(contextState(this), WebGLSampler, 4, 0, {}) as WebGLSampler;
  }

  /** WebGL 2.0 §3.7.13; GL unbinds it from every unit of this context. */
  deleteSampler(sampler: WebGLSampler | null): void {
    requireArguments('deleteSampler', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, sampler, WebGLSampler, 'deleteSampler', 1, true, 0);
    if (!state || sampler === null) return;
    state.deleted = true;
    collectedObjects.unregister(sampler);
    s.samplers.forEach((bound, unit) => {
      if (bound === sampler) s.samplers[unit] = null;
    });
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.13. */
  isSampler(sampler: WebGLSampler | null): boolean {
    requireArguments('isSampler', 1, arguments.length);
    const s = contextState(this);
    const state = checkObject(s, sampler, WebGLSampler, 'isSampler', 1, true, 0, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 2.0 §3.7.13. */
  bindSampler(unit: number, sampler: WebGLSampler | null): void {
    requireArguments('bindSampler', 2, arguments.length);
    const s = contextState(this);
    const u = toUnsignedLong(unit);
    const state = checkObject(s, sampler, WebGLSampler, 'bindSampler', 2, true, GL.INVALID_OPERATION);
    if (state === undefined) return;
    if (native.bindSampler(s.index, s.version, u, ...keyOf(state))) s.samplers[u] = sampler;
  }

  /** WebGL 2.0 §3.7.13. */
  samplerParameteri(sampler: WebGLSampler, pname: number, param: number): void {
    requireArguments('samplerParameteri', 3, arguments.length);
    samplerParameter(this, sampler, toUnsignedLong(pname), toLong(param), false, 'samplerParameteri');
  }

  /** WebGL 2.0 §3.7.13. */
  samplerParameterf(sampler: WebGLSampler, pname: number, param: number): void {
    requireArguments('samplerParameterf', 3, arguments.length);
    samplerParameter(this, sampler, toUnsignedLong(pname), toFloat(param), true, 'samplerParameterf');
  }

  /** WebGL 2.0 §3.7.13. */
  getSamplerParameter(sampler: WebGLSampler, pname: number): unknown {
    requireArguments('getSamplerParameter', 2, arguments.length);
    const s = contextState(this);
    const p = toUnsignedLong(pname);
    const state = checkObject(s, sampler, WebGLSampler, 'getSamplerParameter', 1, false, GL.INVALID_OPERATION);
    if (!state) return null;
    return parameterValue(native.getSamplerParameter(s.index, s.version, ...keyOf(state), p));
  }

  /** WebGL 2.0 §3.7.8. */
  vertexAttribI4i(index: number, x: number, y: number, z: number, w: number): void {
    requireArguments('vertexAttribI4i', 5, arguments.length);
    setAttrib(this, toUnsignedLong(index), 1, [toLong(x), toLong(y), toLong(z), toLong(w)]);
  }
  vertexAttribI4ui(index: number, x: number, y: number, z: number, w: number): void {
    requireArguments('vertexAttribI4ui', 5, arguments.length);
    setAttrib(this, toUnsignedLong(index), 2, [
      toUnsignedLong(x),
      toUnsignedLong(y),
      toUnsignedLong(z),
      toUnsignedLong(w),
    ]);
  }
  vertexAttribI4iv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttribI4iv', 2, arguments.length);
    const i = toUnsignedLong(index);
    setAttribList(this, i, 1, toList(Int32Array, toLong, values, 'vertexAttribI4iv'));
  }
  vertexAttribI4uiv(index: number, values: Iterable<number>): void {
    requireArguments('vertexAttribI4uiv', 2, arguments.length);
    const i = toUnsignedLong(index);
    setAttribList(this, i, 2, toList(Uint32Array, toUnsignedLong, values, 'vertexAttribI4uiv'));
  }

  /** WebGL 2.0 §3.7.8. */
  vertexAttribIPointer(index: number, size: number, type: number, stride: number, offset: number): void {
    requireArguments('vertexAttribIPointer', 5, arguments.length);
    const s = contextState(this);
    const args = [toUnsignedLong(index), toLong(size), toUnsignedLong(type), toLong(stride), toLongLong(offset)] as const;
    if (s.destroyed) return;
    if (native.vertexAttribPointer(s.index, s.version, args[0], args[1], args[2], -1, args[3], args[4])) {
      s.vao.attribs[args[0]] = s.buffers.get(GL.ARRAY_BUFFER) ?? null;
      s.vao.normalized[args[0]] = false;
    }
  }
}

/** A WebGL 2 context (WebGL 2.0 §3.7). */
export interface WebGL2RenderingContext extends WebGL2Members, WebGL2Constants {}
export const WebGL2RenderingContext: WebGL2Constants & {
  readonly prototype: WebGL2RenderingContext;
  new (...args: ContextArguments): WebGL2RenderingContext;
} = withConstants(class WebGL2RenderingContext extends WebGL2Members {}, WEBGL2_CONSTANTS);

/**
 * Moves the members a context class inherits from its implementation base
 * classes onto its own prototype, whose prototype becomes
 * `Object.prototype`: WebIDL interfaces without a parent have only Object in
 * their prototype chain (Khronos `conformance/context/context-type-test.html`).
 * Construction is unchanged, since `super()` follows the constructor's own
 * prototype, not the prototype object's.
 */
function flattenPrototype(cls: { readonly prototype: object }): void {
  const prototype = cls.prototype;
  for (let base = Object.getPrototypeOf(prototype) as object | null; base !== null && base !== Object.prototype; base = Object.getPrototypeOf(base) as object | null) {
    for (const key of Reflect.ownKeys(base)) {
      const descriptor = Object.getOwnPropertyDescriptor(base, key);
      if (key !== 'constructor' && descriptor !== undefined && !Object.hasOwn(prototype, key)) Object.defineProperty(prototype, key, descriptor);
    }
  }
  Object.setPrototypeOf(prototype, Object.prototype);
}

/** A `sequence<DOMString>`. */
function toStrings(value: unknown, method: string): string[] {
  if (typeof value !== 'object' || value === null || !(Symbol.iterator in value)) {
    throw new TypeError(`Failed to execute '${method}': The provided value cannot be converted to a sequence.`);
  }
  return Array.from(value as Iterable<unknown>, toDOMString);
}

/** `bindBufferBase` (`range` null) or `bindBufferRange`. */
function bindIndexed(gl: ContextBase, target: unknown, index: unknown, buffer: unknown, range: [unknown, unknown] | null): void {
  const s = contextState(gl);
  const t = toUnsignedLong(target);
  const i = toUnsignedLong(index);
  const state = checkObject(s, buffer, WebGLBuffer, range === null ? 'bindBufferBase' : 'bindBufferRange', 3, true, GL.INVALID_OPERATION);
  const r = range === null ? null : [toLongLong(range[0]), toLongLong(range[1])];
  if (state === undefined) return;
  if (!native.bindBufferIndexed(s.index, s.version, t, i, ...keyOf(state), r)) return;
  const b = buffer as WebGLBuffer | null;
  s.buffers.set(t, b);
  if (t === GL.UNIFORM_BUFFER) s.uniformBuffers[i] = b;
  else s.tfBuffers[i] = b;
}

/** `clearBuffer{fv,iv,uiv}`; `kind` 0 float, 1 int, 2 uint. */
function clearBuffer(gl: ContextBase, buffer: unknown, drawbuffer: unknown, kind: number, values: ArrayBufferView, srcOffset: unknown): void {
  const s = contextState(gl);
  const b = toUnsignedLong(buffer);
  const d = toLong(drawbuffer);
  const offset = toUnsignedLongLong(srcOffset);
  if (!s.destroyed) native.clearBuffer(s.index, s.version, b, d, kind, values, offset);
}

/** `samplerParameter[if]`. */
function samplerParameter(gl: ContextBase, sampler: unknown, pname: number, value: number, float: boolean, method: string): void {
  const s = contextState(gl);
  const state = checkObject(s, sampler, WebGLSampler, method, 1, false, GL.INVALID_OPERATION);
  if (state) native.samplerParameter(s.index, s.version, ...keyOf(state), pname, value, float);
}

/** `uniform[1234]ui` on a WebGL 2 context. */
function uniformUint(gl: ContextBase, method: string, location: unknown, values: number[]): void {
  const s = contextState(gl);
  const l = uniformLocation(s, location, method);
  if (l === undefined) return;
  native.uniformValues(s.index, s.version, l, 2, values.length, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
}

/** `uniform[1234]uiv` on a WebGL 2 context. */
function uniformList(
  gl: ContextBase,
  method: string,
  n: number,
  count: number,
  location: unknown,
  values: unknown,
  srcOffset: unknown,
  srcLength: unknown,
): void {
  const s = contextState(gl);
  requireArguments(method, 2, count);
  const list = toList(Uint32Array, toUnsignedLong, values, method);
  const offset = toUnsignedLongLong(srcOffset);
  const length = toUnsignedLong(srcLength);
  const l = uniformLocation(s, location, method);
  if (l === undefined) return;
  native.uniformVector(s.index, s.version, l, 2, n, list, offset, length);
}

/** A non-square `uniformMatrix*fv` on a WebGL 2 context. */
function uniformMatrixList(
  gl: ContextBase,
  method: string,
  columns: number,
  rows: number,
  count: number,
  location: unknown,
  transpose: unknown,
  values: unknown,
  srcOffset: unknown,
  srcLength: unknown,
): void {
  const s = contextState(gl);
  requireArguments(method, 3, count);
  const t = toBoolean(transpose);
  const list = toList(Float32Array, toFloat, values, method);
  const offset = toUnsignedLongLong(srcOffset);
  const length = toUnsignedLong(srcLength);
  const l = uniformLocation(s, location, method);
  if (l === undefined) return;
  native.uniformMatrix(s.index, s.version, l, columns, rows, t, list, offset, length);
}

/** A `vertexAttribI4*` setter; `kind` 1 int, 2 uint. */
function setAttrib(gl: ContextBase, index: number, kind: number, values: ArrayLike<number>): void {
  const s = contextState(gl);
  if (s.destroyed) return;
  s.attribKinds[index] = kind;
  native.vertexAttrib(s.index, s.version, index, kind, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
}

function setAttribList(gl: ContextBase, index: number, kind: number, values: ArrayLike<number>): void {
  const s = contextState(gl);
  if (values.length < 4) {
    if (!s.destroyed) native.synthesizeError(s.index, s.version, GL.INVALID_VALUE);
    return;
  }
  setAttrib(gl, index, kind, values);
}

exposeMembers(ContextBase, WebGL2Members);
flattenPrototype(WebGLRenderingContext);
flattenPrototype(WebGL2RenderingContext);

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** The backend after the `OXGL_BACKEND` override, read from this thread's `process.env` on every call. */
function resolveBackend(option: ContextBackend): ContextBackend {
  const override = process.env.OXGL_BACKEND;
  if (override === undefined || override === '') return option;
  if (!BACKENDS.includes(override)) {
    throw codedError(
      'OXGL_INVALID_BACKEND',
      `oxgl: OXGL_BACKEND is '${override}'; expected one of 'auto', 'gpu', 'software'`,
    );
  }
  return override as ContextBackend;
}

function validateSize(name: string, value: unknown, method = 'createContext'): number {
  if (typeof value !== 'number') {
    throw new TypeError(`oxgl: ${method}: '${name}' must be a number`);
  }
  if (!Number.isInteger(value) || value < 0 || value > MAX_DIMENSION) {
    throw new RangeError(
      `oxgl: ${method}: '${name}' must be an integer from 0 to ${String(MAX_DIMENSION)}, got ${String(value)}`,
    );
  }
  return value;
}

/** Converts `attributes` as a WebIDL `WebGLContextAttributes` dictionary, members in IDL order. */
function convertAttributes(value: unknown): NativeAttributes {
  if (value === undefined || value === null) value = {};
  if (typeof value !== 'object' && typeof value !== 'function') {
    throw new TypeError("oxgl: createContext: 'attributes' must be an object");
  }
  const dict = value as Record<string, unknown>;
  const bool = (name: string, fallback: boolean): boolean => {
    const member = dict[name];
    return member === undefined ? fallback : toBoolean(member);
  };
  const alpha = bool('alpha', true);
  const antialias = bool('antialias', true);
  const depth = bool('depth', true);
  bool('desynchronized', false);
  const failIfMajorPerformanceCaveat = bool('failIfMajorPerformanceCaveat', false);
  const rawPower = dict.powerPreference;
  const power = rawPower === undefined ? 'default' : toDOMString(rawPower);
  const powerPreference = POWER_PREFERENCES.indexOf(power);
  if (powerPreference < 0) {
    throw new TypeError(
      `oxgl: createContext: 'powerPreference' must be one of 'default', 'low-power', 'high-performance', got ${power}`,
    );
  }
  const premultipliedAlpha = bool('premultipliedAlpha', true);
  const preserveDrawingBuffer = bool('preserveDrawingBuffer', false);
  const stencil = bool('stencil', false);
  bool('xrCompatible', false);
  return {
    alpha,
    depth,
    stencil,
    antialias,
    premultipliedAlpha,
    preserveDrawingBuffer,
    powerPreference,
    failIfMajorPerformanceCaveat,
  };
}

/**
 * Creates a headless WebGL context. No window system, display server, or
 * canvas is needed. Call `destroy()` to release it promptly; otherwise it is
 * released after garbage collection.
 */
export function createContext(options: ContextOptions & { webgl2: true }): WebGL2RenderingContext;
export function createContext(options: ContextOptions & { webgl2?: false }): WebGLRenderingContext;
export function createContext(options: ContextOptions): WebGLRenderingContext | WebGL2RenderingContext;
export function createContext(options: unknown): WebGLRenderingContext | WebGL2RenderingContext {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('oxgl: createContext: options must be an object');
  }
  // Each member is read once, as WebIDL dictionary conversion does.
  const {
    width: rawWidth,
    height: rawHeight,
    backend = 'auto',
    webgl2 = false,
    canvas,
    attributes: rawAttributes,
  } = options as Partial<Record<keyof ContextOptions, unknown>>;
  if (typeof rawWidth !== 'number' || typeof rawHeight !== 'number') {
    throw new TypeError("oxgl: createContext: 'width' and 'height' must be numbers");
  }
  const width = validateSize('width', rawWidth);
  const height = validateSize('height', rawHeight);
  if (typeof backend !== 'string' || !BACKENDS.includes(backend)) {
    throw new TypeError(
      `oxgl: createContext: 'backend' must be one of 'auto', 'gpu', 'software', got ${String(backend)}`,
    );
  }
  if (typeof webgl2 !== 'boolean') {
    throw new TypeError("oxgl: createContext: 'webgl2' must be a boolean");
  }
  if (canvas !== undefined && (typeof canvas !== 'object' || canvas === null) && typeof canvas !== 'function') {
    throw new TypeError("oxgl: createContext: 'canvas' must be an object");
  }
  const attributes = convertAttributes(rawAttributes);
  let resolved = resolveBackend(backend as ContextBackend);
  if (attributes.failIfMajorPerformanceCaveat) {
    // SwiftShader is a major performance caveat (WebGL 1.0 §5.2.1).
    if (resolved === 'software') {
      throw codedError(
        'OXGL_CONTEXT_CREATION_FAILED',
        'oxgl: failIfMajorPerformanceCaveat is set and the software backend was requested',
      );
    }
    resolved = 'gpu';
  }
  const created = native.createContext(resolved, width, height, webgl2, attributes);
  if (created.errorCode !== undefined) {
    throw codedError(created.errorCode, created.errorMessage ?? created.errorCode);
  }
  const Class = webgl2 ? WebGL2RenderingContext : WebGLRenderingContext;
  return new Class(CONSTRUCTING, created, canvas, { backend: resolved, attributes, width, height });
}
