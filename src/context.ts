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
  type FramebufferState,
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
    case 'booleans':
      return numbers.map((n) => n !== 0);
    case 'string':
      return text ?? '';
    case 'float32':
      return new Float32Array(numbers);
    case 'int32':
      return new Int32Array(numbers);
    case 'uint32':
      return new Uint32Array(numbers);
  }
}

/** The vertex array state oxgl mirrors: what GL holds references to. */
interface VertexArrayState {
  element: WebGLBuffer | null;
  readonly attribs: (WebGLBuffer | null)[];
}

/**
 * A context's state. Bound objects are kept here, as Blink keeps them, so a
 * bound object is never collected and object-valued queries return the
 * object that was bound.
 */
interface ContextState {
  readonly index: number;
  readonly version: number;
  readonly webgl2: boolean;
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
  readonly textureUnits: Map<number, WebGLTexture | null>[];
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
  const document = shaped.ownerDocument as { createElement?: (name: string) => unknown } | null | undefined;
  if (typeof shaped.naturalWidth === 'number' && typeof document?.createElement === 'function') {
    const w = shaped.naturalWidth >>> 0;
    const h = Number(shaped.naturalHeight) >>> 0;
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
  throw typeError(method, position, 'TexImageSource');
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
  const ranged = srcOffset !== undefined;
  if (sourceOnly) {
    const pixels = imagePixels(data, method, position);
    if (s.destroyed) return;
    args.width = pixels.width;
    args.height = pixels.height;
    native.texUpload(s.index, s.version, call, args, 3, pixels.data, 0, pixels.width, pixels.height);
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
  if (!s.destroyed) native.texUpload(s.index, s.version, call, args, 3, pixels.data, 0, pixels.width, pixels.height);
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
    toLong(data);
    toLongLong(srcOffset);
    if (!s.destroyed) native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
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
/** `framebufferTextureLayer`'s attachment; assigned by `ContextBase`'s static block. */
let attachLayer: (gl: ContextBase, target: number, attachment: number, texture: unknown, level: number, layer: number) => void;

const GL = WEBGL2_CONSTANTS;

/** WebIDL `AllowSharedBufferSource`. */
type AllowSharedBufferSource = ArrayBufferLike | ArrayBufferView;

/** Deletes a collected object on its context's thread. Module-level and capture-free. */
function releaseCollectedObject(held: readonly [number, number, number, number]): void {
  native.releaseObject(held[0], held[1], held[2], held[3]);
}

const collectedObjects = new FinalizationRegistry<readonly [number, number, number, number]>(releaseCollectedObject);

type ObjectClass<T extends WebGLObject> = abstract new (token: symbol, state: ObjectState) => T;

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
 * belongs to another context (`INVALID_OPERATION`), or it is deleted
 * (`deletedError`, or a silent stop when 0). Returns `null` for `null`.
 */
function checkObject(
  s: ContextState,
  value: unknown,
  Class: ObjectClass<WebGLObject>,
  method: string,
  position: number,
  nullable: boolean,
  deletedError: number,
): ObjectState | null | undefined {
  if (value === null || value === undefined) {
    if (!nullable) throw typeError(method, position, Class.name);
    return s.destroyed ? undefined : null;
  }
  if (!(value instanceof Class)) throw typeError(method, position, Class.name);
  if (s.destroyed) return undefined;
  const state = objectState(value);
  if (state.owner !== s) {
    native.synthesizeError(s.index, s.version, GL.INVALID_OPERATION);
    return undefined;
  }
  if (state.deleted || state.key === null) {
    if (deletedError !== 0) native.synthesizeError(s.index, s.version, deletedError);
    return undefined;
  }
  return state;
}

/** The native `[index, version]` of an object state, `[0, 0]` for `null`. */
function keyOf(state: ObjectState | null): readonly [number, number] {
  return state?.key ?? NULL_KEY;
}
const NULL_KEY = [0, 0] as const;

/** Drops `buffer` from every binding GL clears when it is deleted (OpenGL ES 3.0 §2.9–§2.10). */
function unbindBuffer(s: ContextState, buffer: WebGLBuffer): void {
  for (const [target, bound] of s.buffers) if (bound === buffer) s.buffers.set(target, null);
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
  if (!s.webgl2) return undefined;
  switch (pname) {
    case GL.TEXTURE_BINDING_3D:
      return unitOf(s).get(GL.TEXTURE_3D) ?? null;
    case GL.TEXTURE_BINDING_2D_ARRAY:
      return unitOf(s).get(GL.TEXTURE_2D_ARRAY) ?? null;
    case GL.SAMPLER_BINDING:
      return s.samplers[s.activeUnit] ?? null;
    case GL.READ_FRAMEBUFFER_BINDING:
      return s.readFramebuffer;
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

/**
 * Members shared by WebGL 1 and WebGL 2 (the `WebGLRenderingContextBase`
 * mixin). Not exported: as in browsers, the two context classes are unrelated.
 */
abstract class ContextBase {
  readonly #s: ContextState;

  static {
    resizeDrawingBuffer = (gl, width, height) => {
      gl.#resizeTo(width, height);
    };
    contextState = (gl) => gl.#s;
    attachLayer = (gl, target, attachment, texture, level, layer) => {
      gl.#attachLayer(target, attachment, texture, level, layer);
    };
  }

  /** @internal Use {@link createContext}. */
  constructor(
    token: symbol,
    index: number,
    version: number,
    width: number,
    height: number,
    canvas: object | undefined,
    requestedWidth: number,
    requestedHeight: number,
  ) {
    if (token !== CONSTRUCTING) {
      throw new TypeError('Illegal constructor');
    }
    const webgl2 = this instanceof WebGL2RenderingContext;
    this.#s = {
      index,
      version,
      webgl2,
      width,
      height,
      destroyed: false,
      lostReported: false,
      canvas: undefined as unknown as object,
      buffers: new Map(),
      vao: { element: null, attribs: [] },
      program: null,
      attribKinds: [],
      textureUnits: [],
      samplers: [],
      activeUnit: 0,
      maxUnits: 0,
      drawFramebuffer: null,
      readFramebuffer: null,
      renderbuffer: null,
    };
    const units = native.getParameter(index, version, GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    this.#s.maxUnits = units?.numbers[0] ?? 0;
    this.#s.canvas = canvas ?? new HeadlessCanvas(CONSTRUCTING, this, requestedWidth, requestedHeight);
    canvasContexts.set(this.#s.canvas, this.#s);
    collected.register(this, Object.freeze([index, version] as const), this);
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
    return native.getError(this.#s.index, this.#s.version);
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

  /** WebGL 1.0 §5.14.14: no extension is supported yet; `null` when lost. */
  getSupportedExtensions(): string[] | null {
    return this.#s.destroyed || this.isContextLost() ? null : [];
  }

  /** WebGL 1.0 §5.14.14: no extension is supported yet, so always `null`. */
  getExtension(name: string): null {
    requireArguments('getExtension', 1, arguments.length);
    toDOMString(name);
    return null;
  }

  /** WebGL 1.0 §5.14.13. */
  isContextLost(): boolean {
    return this.#s.destroyed || native.isContextLost(this.#s.index, this.#s.version);
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
    const state = checkObject(s, buffer, WebGLBuffer, 'isBuffer', 1, true, 0);
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
    const state = checkObject(s, shader, WebGLShader, 'isShader', 1, true, 0);
    return !!state && native.hasObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.9. */
  isProgram(program: WebGLProgram | null): boolean {
    requireArguments('isProgram', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, program, WebGLProgram, 'isProgram', 1, true, 0);
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
    const p = checkObject(this.#s, program, WebGLProgram, 'getAttachedShaders', 1, false, GL.INVALID_VALUE) as ProgramState | null | undefined;
    return p ? [...p.attached] : null;
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
    if (native.useProgram(s.index, s.version, ...keyOf(p))) s.program = program;
  }

  /** WebGL 1.0 §5.14.9. */
  getProgramParameter(program: WebGLProgram, pname: number): unknown {
    requireArguments('getProgramParameter', 2, arguments.length);
    const s = this.#s;
    const name = toUnsignedLong(pname);
    const p = checkObject(s, program, WebGLProgram, 'getProgramParameter', 1, false, GL.INVALID_VALUE);
    if (!p) return null;
    return parameterValue(native.getProgramParameter(s.index, s.version, ...keyOf(p), name));
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
    return parameterValue(native.getVertexAttrib(s.index, s.version, i, p, s.attribKinds[i] ?? 0));
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
    const state = checkObject(s, framebuffer, WebGLFramebuffer, 'isFramebuffer', 1, true, 0);
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
    const state = checkObject(s, renderbuffer, WebGLRenderbuffer, 'isRenderbuffer', 1, true, 0);
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
    const points = attachment === GL.DEPTH_STENCIL_ATTACHMENT ? [GL.DEPTH_ATTACHMENT, GL.STENCIL_ATTACHMENT] : [attachment];
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
    if (s.destroyed) return 0;
    return native.checkFramebufferStatus(s.index, s.version, t);
  }

  /** WebGL 1.0 §5.14.6. */
  getFramebufferAttachmentParameter(target: number, attachment: number, pname: number): unknown {
    requireArguments('getFramebufferAttachmentParameter', 3, arguments.length);
    const s = this.#s;
    const args = [toUnsignedLong(target), toUnsignedLong(attachment), toUnsignedLong(pname)] as const;
    if (s.destroyed) return null;
    const framebuffer = framebufferFor(s, args[0]);
    if (args[2] === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME && framebuffer !== null) {
      // The type query validates the target and attachment.
      const type = native.getFramebufferAttachmentParameter(s.index, s.version, args[0], args[1], GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE);
      if (type === null || type.numbers[0] === GL.NONE) return null;
      const point = args[1] === GL.DEPTH_STENCIL_ATTACHMENT ? GL.DEPTH_ATTACHMENT : args[1];
      return (objectState(framebuffer) as FramebufferState).attachments.get(point) ?? null;
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
    for (const unit of s.textureUnits) {
      for (const [target, bound] of unit) if (bound === texture) unit.set(target, null);
    }
    detach(s, texture);
    native.deleteObject(s.index, s.version, ...keyOf(state));
  }

  /** WebGL 1.0 §5.14.8: true once the texture has been bound. */
  isTexture(texture: WebGLTexture | null): boolean {
    requireArguments('isTexture', 1, arguments.length);
    const s = this.#s;
    const state = checkObject(s, texture, WebGLTexture, 'isTexture', 1, true, 0);
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
    const state = checkObject(s, sampler, WebGLSampler, 'isSampler', 1, true, 0);
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
    }
  }
}

/** A WebGL 2 context (WebGL 2.0 §3.7). */
export interface WebGL2RenderingContext extends WebGL2Members, WebGL2Constants {}
export const WebGL2RenderingContext: WebGL2Constants & {
  readonly prototype: WebGL2RenderingContext;
  new (...args: ContextArguments): WebGL2RenderingContext;
} = withConstants(class WebGL2RenderingContext extends WebGL2Members {}, WEBGL2_CONSTANTS);

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
  return new Class(
    CONSTRUCTING,
    created.index,
    created.version,
    created.width,
    created.height,
    canvas,
    width,
    height,
  );
}
