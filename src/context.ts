// WebGLRenderingContext / WebGL2RenderingContext and createContext.
//
// WebIDL argument conversion happens here, before native code runs, so native
// code never re-enters JS (conversions can call user `valueOf`). This file is
// the seam a WebIDL generator will own (src/generated/).
import { native } from './native.js';

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

/** WebGL IDL constants the current members use (WebGL 1.0 §5.14). */
const CONSTANTS = {
  DEPTH_BUFFER_BIT: 0x00000100,
  STENCIL_BUFFER_BIT: 0x00000400,
  COLOR_BUFFER_BIT: 0x00004000,
  NO_ERROR: 0,
  INVALID_ENUM: 0x0500,
  INVALID_VALUE: 0x0501,
  INVALID_OPERATION: 0x0502,
  OUT_OF_MEMORY: 0x0505,
  INVALID_FRAMEBUFFER_OPERATION: 0x0506,
  CONTEXT_LOST_WEBGL: 0x9242,
  UNSIGNED_BYTE: 0x1401,
  RGBA: 0x1908,
} as const;

type Constants = typeof CONSTANTS;

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
  // Constants, defined on the classes and prototypes below from CONSTANTS;
  // `ConstantsDeclared` fails to compile if one is missing here.
  declare static readonly DEPTH_BUFFER_BIT: Constants['DEPTH_BUFFER_BIT'];
  declare static readonly STENCIL_BUFFER_BIT: Constants['STENCIL_BUFFER_BIT'];
  declare static readonly COLOR_BUFFER_BIT: Constants['COLOR_BUFFER_BIT'];
  declare static readonly NO_ERROR: Constants['NO_ERROR'];
  declare static readonly INVALID_ENUM: Constants['INVALID_ENUM'];
  declare static readonly INVALID_VALUE: Constants['INVALID_VALUE'];
  declare static readonly INVALID_OPERATION: Constants['INVALID_OPERATION'];
  declare static readonly OUT_OF_MEMORY: Constants['OUT_OF_MEMORY'];
  declare static readonly INVALID_FRAMEBUFFER_OPERATION: Constants['INVALID_FRAMEBUFFER_OPERATION'];
  declare static readonly CONTEXT_LOST_WEBGL: Constants['CONTEXT_LOST_WEBGL'];
  declare static readonly UNSIGNED_BYTE: Constants['UNSIGNED_BYTE'];
  declare static readonly RGBA: Constants['RGBA'];
  declare readonly DEPTH_BUFFER_BIT: Constants['DEPTH_BUFFER_BIT'];
  declare readonly STENCIL_BUFFER_BIT: Constants['STENCIL_BUFFER_BIT'];
  declare readonly COLOR_BUFFER_BIT: Constants['COLOR_BUFFER_BIT'];
  declare readonly NO_ERROR: Constants['NO_ERROR'];
  declare readonly INVALID_ENUM: Constants['INVALID_ENUM'];
  declare readonly INVALID_VALUE: Constants['INVALID_VALUE'];
  declare readonly INVALID_OPERATION: Constants['INVALID_OPERATION'];
  declare readonly OUT_OF_MEMORY: Constants['OUT_OF_MEMORY'];
  declare readonly INVALID_FRAMEBUFFER_OPERATION: Constants['INVALID_FRAMEBUFFER_OPERATION'];
  declare readonly CONTEXT_LOST_WEBGL: Constants['CONTEXT_LOST_WEBGL'];
  declare readonly UNSIGNED_BYTE: Constants['UNSIGNED_BYTE'];
  declare readonly RGBA: Constants['RGBA'];

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
      if (this.#lostReported) return CONSTANTS.NO_ERROR;
      this.#lostReported = true;
      return CONSTANTS.CONTEXT_LOST_WEBGL;
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

/** A WebGL 1 context (WebGL 1.0 §5.14). */
export class WebGLRenderingContext extends ContextBase {}

/** A WebGL 2 context (WebGL 2.0 §4.7). */
export class WebGL2RenderingContext extends ContextBase {}

/** Compile-time check: every constant is declared on instances and classes. */
type Assert<T extends true> = T;
export type ConstantsDeclared = Assert<
  [Exclude<keyof Constants, keyof ContextBase & keyof typeof ContextBase>] extends [never] ? true : false
>;

// WebIDL constants: on the interface object and its prototype, read-only.
for (const target of [WebGLRenderingContext, WebGLRenderingContext.prototype, WebGL2RenderingContext, WebGL2RenderingContext.prototype]) {
  for (const [name, value] of Object.entries(CONSTANTS)) {
    Object.defineProperty(target, name, { value, writable: false, enumerable: true, configurable: false });
  }
}

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
