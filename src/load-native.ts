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

/** Result of the native `getParameter`, turned into a JS value in TS. */
export interface NativeParameter {
  kind: 'number' | 'boolean' | 'booleans' | 'string' | 'float32' | 'int32' | 'uint32';
  numbers: number[];
  text?: string;
}

/** Result of the native `getShaderPrecisionFormat`. */
export interface NativePrecision {
  rangeMin: number;
  rangeMax: number;
  precision: number;
}

/** `WebGLContextAttributes` as the native layer takes and returns them. */
export interface NativeAttributes {
  alpha: boolean;
  depth: boolean;
  stencil: boolean;
  antialias: boolean;
  premultipliedAlpha: boolean;
  preserveDrawingBuffer: boolean;
  /** 0 `default`, 1 `low-power`, 2 `high-performance`. */
  powerPreference: number;
  failIfMajorPerformanceCaveat: boolean;
}

/**
 * Native interface exported by the oxgl addon. Arguments are already converted
 * per WebIDL; contexts are identified by their key's `index` and `version`.
 */
export interface NativeBinding {
  nativeAbiVersion(): number;
  init(libDir: string): void;
  createContext(
    backend: string,
    width: number,
    height: number,
    webgl2: boolean,
    attributes: NativeAttributes,
  ): NativeCreated;
  getContextAttributes(index: number, version: number): NativeAttributes | null;
  synthesizeError: (index: number, version: number, code: number) => void;
  createObject: (index: number, version: number, kind: number, shaderType: number) => [number, number] | null;
  deleteObject: (index: number, version: number, oi: number, ov: number) => void;
  releaseObject: (index: number, version: number, oi: number, ov: number) => void;
  liveObjects: () => number;
  hasObject: (index: number, version: number, oi: number, ov: number) => boolean;
  bindBuffer: (index: number, version: number, target: number, oi: number, ov: number) => boolean;
  bufferDataSize: (index: number, version: number, target: number, size: number, usage: number) => void;
  bufferData: (index: number, version: number, target: number, source: ArrayBufferView, usage: number, offset: number, length: number) => void;
  bufferSubData: (index: number, version: number, target: number, dstOffset: number, source: ArrayBufferView, offset: number, length: number) => void;
  copyBufferSubData: (index: number, version: number, readTarget: number, writeTarget: number, readOffset: number, writeOffset: number, size: number) => void;
  getBufferSubData: (index: number, version: number, target: number, srcOffset: number, destination: ArrayBufferView, offset: number, length: number) => void;
  getBufferParameter: (index: number, version: number, target: number, pname: number) => number | null;
  shaderSource: (index: number, version: number, oi: number, ov: number, source: string) => void;
  compileShader: (index: number, version: number, oi: number, ov: number) => void;
  getShaderParameter: (index: number, version: number, oi: number, ov: number, pname: number) => NativeParameter | null;
  getShaderInfoLog: (index: number, version: number, oi: number, ov: number) => string | null;
  attachShader: (index: number, version: number, pi: number, pv: number, si: number, sv: number, attach: boolean) => void;
  linkProgram: (index: number, version: number, oi: number, ov: number) => void;
  validateProgram: (index: number, version: number, oi: number, ov: number) => void;
  useProgram: (index: number, version: number, oi: number, ov: number) => boolean;
  getProgramParameter: (index: number, version: number, oi: number, ov: number, pname: number) => NativeParameter | null;
  getProgramInfoLog: (index: number, version: number, oi: number, ov: number) => string | null;
  bindAttribLocation: (index: number, version: number, oi: number, ov: number, location: number, name: string) => void;
  getLocation: (index: number, version: number, oi: number, ov: number, name: string, kind: number) => number;
  getActiveInfo: (index: number, version: number, oi: number, ov: number, position: number, uniform: boolean) => { size: number; ty: number; name: string } | null;
  uniformValues: (index: number, version: number, location: number, kind: number, n: number, x: number, y: number, z: number, w: number) => void;
  uniformVector: (index: number, version: number, location: number, kind: number, n: number, source: ArrayBufferView, offset: number, length: number) => void;
  uniformMatrix: (index: number, version: number, location: number, columns: number, rows: number, transpose: boolean, source: Float32Array, offset: number, length: number) => void;
  getUniform: (index: number, version: number, oi: number, ov: number, location: number) => NativeParameter | null;
  vertexAttribArray: (index: number, version: number, attrib: number, enable: boolean) => void;
  vertexAttribPointer: (index: number, version: number, attrib: number, size: number, type: number, normalized: number, stride: number, offset: number) => boolean;
  vertexAttrib: (index: number, version: number, attrib: number, kind: number, x: number, y: number, z: number, w: number) => void;
  getVertexAttrib: (index: number, version: number, attrib: number, pname: number, kind: number) => NativeParameter | null;
  getVertexAttribOffset: (index: number, version: number, attrib: number, pname: number) => number;
  drawArrays: (index: number, version: number, mode: number, first: number, count: number) => void;
  drawElements: (index: number, version: number, mode: number, count: number, type: number, offset: number) => void;
  drawRangeElements: (index: number, version: number, mode: number, start: number, end: number, count: number, type: number, offset: number) => void;
  resize(index: number, version: number, width: number, height: number): { width: number; height: number };
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
  activeTexture: (index: number, version: number, texture: number) => void;
  blendColor: (index: number, version: number, red: number, green: number, blue: number, alpha: number) => void;
  blendEquation: (index: number, version: number, mode: number) => void;
  blendEquationSeparate: (index: number, version: number, modeRgb: number, modeAlpha: number) => void;
  blendFunc: (index: number, version: number, sfactor: number, dfactor: number) => void;
  blendFuncSeparate: (index: number, version: number, srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number) => void;
  clearDepth: (index: number, version: number, depth: number) => void;
  clearStencil: (index: number, version: number, s: number) => void;
  colorMask: (index: number, version: number, red: boolean, green: boolean, blue: boolean, alpha: boolean) => void;
  cullFace: (index: number, version: number, mode: number) => void;
  depthFunc: (index: number, version: number, func: number) => void;
  depthMask: (index: number, version: number, flag: boolean) => void;
  depthRange: (index: number, version: number, zNear: number, zFar: number) => void;
  disable: (index: number, version: number, cap: number) => void;
  enable: (index: number, version: number, cap: number) => void;
  finish: (index: number, version: number) => void;
  flush: (index: number, version: number) => void;
  frontFace: (index: number, version: number, mode: number) => void;
  hint: (index: number, version: number, target: number, mode: number) => void;
  isEnabled: (index: number, version: number, cap: number) => boolean;
  getParameter(index: number, version: number, pname: number): NativeParameter | null;
  getShaderPrecisionFormat(
    index: number,
    version: number,
    shaderType: number,
    precisionType: number,
  ): NativePrecision | null;
  isContextLost(index: number, version: number): boolean;
  lineWidth: (index: number, version: number, width: number) => void;
  pixelStorei: (index: number, version: number, pname: number, param: number) => void;
  polygonOffset: (index: number, version: number, factor: number, units: number) => void;
  sampleCoverage: (index: number, version: number, value: number, invert: boolean) => void;
  scissor: (index: number, version: number, x: number, y: number, width: number, height: number) => void;
  stencilFunc: (index: number, version: number, func: number, ref: number, mask: number) => void;
  stencilFuncSeparate: (index: number, version: number, face: number, func: number, ref: number, mask: number) => void;
  stencilMask: (index: number, version: number, mask: number) => void;
  stencilMaskSeparate: (index: number, version: number, face: number, mask: number) => void;
  stencilOp: (index: number, version: number, fail: number, zfail: number, zpass: number) => void;
  stencilOpSeparate: (index: number, version: number, face: number, fail: number, zfail: number, zpass: number) => void;
  viewport: (index: number, version: number, x: number, y: number, width: number, height: number) => void;
}

/** Version of the JS ↔ native interface this package was built for. */
export const NATIVE_ABI_VERSION = 5;

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
