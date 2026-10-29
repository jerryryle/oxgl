// WebGLRenderingContext / WebGL2RenderingContext and createContext.
//
// WebIDL argument conversion happens here, before native code runs, so native
// code never re-enters JS (conversions can call user `valueOf`). This file is
// the seam a WebIDL generator will own (src/generated/).
import type { NativeParameter } from './load-native.js';
import { native } from './native.js';
import { WEBGL1_CONSTANTS, WEBGL2_CONSTANTS } from './generated/webgl-constants.js';

/** Backend for `createContext`; `OXGL_BACKEND` overrides it. */
export type ContextBackend = 'auto' | 'gpu' | 'software';

/** Options for {@link createContext}. */
export interface ContextOptions {
  /** Drawing buffer width in pixels (a positive integer). */
  width: number;
  /** Drawing buffer height in pixels (a positive integer). */
  height: number;
  /** `'auto'` (default): GPU, else SwiftShader. `'gpu'`: GPU only. `'software'`: SwiftShader. */
  backend?: ContextBackend;
  /** Create a WebGL 2 context. */
  webgl2?: boolean;
}

const BACKENDS: readonly string[] = ['auto', 'gpu', 'software'];

type ContextKey = readonly [index: number, version: number];

/** Releases a garbage-collected context. Module-level and capture-free, so
 * neither it nor the held key keeps a context reachable. */
function releaseCollected(key: ContextKey): void {
  native.release(key[0], key[1]);
}

const collected = new FinalizationRegistry<ContextKey>(releaseCollected);

/** Guards the constructors: contexts come only from `createContext`. */
const CONSTRUCTING = Symbol('oxgl.constructing');

// WebIDL conversions (https://webidl.spec.whatwg.org/#es-type-mapping).
function toNumber(value: unknown): number {
  // Unary plus is ToNumber, which throws for BigInt and Symbol as WebIDL does.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- the static type is not the runtime one
  return +(value as number);
}
function toFloat(value: unknown): number {
  return Math.fround(toNumber(value));
}
function toLong(value: unknown): number {
  return toNumber(value) | 0;
}
function toUnsignedLong(value: unknown): number {
  return toNumber(value) >>> 0;
}
function toBoolean(value: unknown): boolean {
  return Boolean(value);
}
function toDOMString(value: unknown): string {
  if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
  return String(value);
}

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

/** A shader numeric format's range and precision (WebGL 1.0 §5.12). */
export class WebGLShaderPrecisionFormat {
  readonly #rangeMin: number;
  readonly #rangeMax: number;
  readonly #precision: number;

  /** @internal Returned by `getShaderPrecisionFormat`. */
  constructor(token: symbol, rangeMin: number, rangeMax: number, precision: number) {
    if (token !== CONSTRUCTING) {
      throw new TypeError('Illegal constructor');
    }
    this.#rangeMin = rangeMin;
    this.#rangeMax = rangeMax;
    this.#precision = precision;
  }

  /** Base-2 log of the absolute value of the smallest representable number. */
  get rangeMin(): number {
    return this.#rangeMin;
  }

  /** Base-2 log of the absolute value of the largest representable number. */
  get rangeMax(): number {
    return this.#rangeMax;
  }

  /** Bits of precision. */
  get precision(): number {
    return this.#precision;
  }
}

function requireArguments(name: string, required: number, given: number): void {
  if (given < required) {
    throw new TypeError(
      `Failed to execute '${name}': ${String(required)} arguments required, but only ${String(given)} present.`,
    );
  }
}

/**
 * Members shared by WebGL 1 and WebGL 2 (the `WebGLRenderingContextBase`
 * mixin). Not exported: as in browsers, the two context classes are unrelated.
 */
abstract class ContextBase {
  readonly #index: number;
  readonly #version: number;
  // Zeroed by destroy(), as Chromium reports for a lost context.
  #width: number;
  #height: number;
  #destroyed = false;
  #lostReported = false;

  /** @internal Use {@link createContext}. */
  constructor(token: symbol, index: number, version: number, width: number, height: number) {
    if (token !== CONSTRUCTING) {
      throw new TypeError('Illegal constructor');
    }
    this.#index = index;
    this.#version = version;
    this.#width = width;
    this.#height = height;
    collected.register(this, Object.freeze([index, version] as const), this);
  }

  /** Width of the drawing buffer in pixels (WebGL 1.0 §5.14.1). */
  get drawingBufferWidth(): number {
    return this.#width;
  }

  /** Height of the drawing buffer in pixels (WebGL 1.0 §5.14.1). */
  get drawingBufferHeight(): number {
    return this.#height;
  }

  /** WebGL 1.0 §5.14.3. */
  clearColor(red: number, green: number, blue: number, alpha: number): void {
    requireArguments('clearColor', 4, arguments.length);
    const r = toFloat(red);
    const g = toFloat(green);
    const b = toFloat(blue);
    const a = toFloat(alpha);
    if (this.#destroyed) return;
    native.clearColor(this.#index, this.#version, r, g, b, a);
  }

  /** WebGL 1.0 §5.14.11. */
  clear(mask: number): void {
    requireArguments('clear', 1, arguments.length);
    const bits = toUnsignedLong(mask);
    if (this.#destroyed) return;
    native.clear(this.#index, this.#version, bits);
  }

  /** WebGL 1.0 §5.14.3. */
  getError(): number {
    if (this.#destroyed) {
      if (this.#lostReported) return WEBGL1_CONSTANTS.NO_ERROR;
      this.#lostReported = true;
      return WEBGL1_CONSTANTS.CONTEXT_LOST_WEBGL;
    }
    return native.getError(this.#index, this.#version);
  }

  /** WebGL 1.0 §5.14.12 (the `ArrayBufferView` overload). */
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void {
    requireArguments('readPixels', 7, arguments.length);
    const args = [toLong(x), toLong(y), toLong(width), toLong(height), toUnsignedLong(format), toUnsignedLong(type)] as const;
    // `ArrayBufferView?`: undefined converts to null.
    const destination = (pixels as ArrayBufferView | null | undefined) ?? null;
    if (destination !== null && !ArrayBuffer.isView(destination)) {
      throw new TypeError("Failed to execute 'readPixels': parameter 7 is not of type 'ArrayBufferView'.");
    }
    if (this.#destroyed) return;
    native.readPixels(this.#index, this.#version, ...args, destination);
  }

  /**
   * Forwards a converted state call to native code, unless the context is
   * destroyed (WebGL 1.0 §5.14, `[WebGLHandlesContextLoss]`).
   */
  #state<A extends unknown[]>(call: (index: number, version: number, ...args: A) => void, ...args: A): void {
    if (!this.#destroyed) call(this.#index, this.#version, ...args);
  }

  /** WebGL 1.0 §5.14.3. */
  activeTexture(texture: number): void {
    requireArguments('activeTexture', 1, arguments.length);
    this.#state(native.activeTexture, toUnsignedLong(texture));
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
    if (this.#destroyed) return null;
    return parameterValue(native.getParameter(this.#index, this.#version, converted));
  }

  /** WebGL 1.0 §5.14.9; `null` for an invalid enum or a lost context. */
  getShaderPrecisionFormat(shadertype: number, precisiontype: number): WebGLShaderPrecisionFormat | null {
    requireArguments('getShaderPrecisionFormat', 2, arguments.length);
    const args = [toUnsignedLong(shadertype), toUnsignedLong(precisiontype)] as const;
    if (this.#destroyed) return null;
    const format = native.getShaderPrecisionFormat(this.#index, this.#version, ...args);
    if (format === null) return null;
    return new WebGLShaderPrecisionFormat(CONSTRUCTING, format.rangeMin, format.rangeMax, format.precision);
  }

  /** WebGL 1.0 §5.14.14: no extension is supported yet; `null` when lost. */
  getSupportedExtensions(): string[] | null {
    return this.#destroyed || this.isContextLost() ? null : [];
  }

  /** WebGL 1.0 §5.14.14: no extension is supported yet, so always `null`. */
  getExtension(name: string): null {
    requireArguments('getExtension', 1, arguments.length);
    toDOMString(name);
    return null;
  }

  /** WebGL 1.0 §5.14.13. */
  isContextLost(): boolean {
    return this.#destroyed || native.isContextLost(this.#index, this.#version);
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
    if (this.#destroyed) return false;
    return native.isEnabled(this.#index, this.#version, converted);
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

  /**
   * Non-standard: releases the context's native resources now and puts it in
   * the lost state. Later calls are no-ops; calling it again does nothing.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#width = 0;
    this.#height = 0;
    collected.unregister(this);
    native.destroy(this.#index, this.#version);
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

/** A WebGL 2 context (WebGL 2.0 §3.7). */
export interface WebGL2RenderingContext extends ContextBase, WebGL2Constants {}
export const WebGL2RenderingContext: WebGL2Constants & {
  readonly prototype: WebGL2RenderingContext;
  new (...args: ContextArguments): WebGL2RenderingContext;
} = withConstants(class WebGL2RenderingContext extends ContextBase {}, WEBGL2_CONSTANTS);

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

function validateSize(name: string, value: unknown): number {
  if (typeof value !== 'number') {
    throw new TypeError(`oxgl: createContext: '${name}' must be a number`);
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`oxgl: createContext: '${name}' must be a positive integer, got ${String(value)}`);
  }
  return value;
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
  const { width: rawWidth, height: rawHeight, backend = 'auto', webgl2 = false } = options as Partial<
    Record<keyof ContextOptions, unknown>
  >;
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
  const created = native.createContext(resolveBackend(backend as ContextBackend), width, height, webgl2);
  if (created.errorCode !== undefined) {
    throw codedError(created.errorCode, created.errorMessage ?? created.errorCode);
  }
  const Class = webgl2 ? WebGL2RenderingContext : WebGLRenderingContext;
  return new Class(CONSTRUCTING, created.index, created.version, created.width, created.height);
}
