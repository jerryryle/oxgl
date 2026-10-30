// WebGL extension objects (WebGL 1.0 §5.14.14), one class per extension
// interface of the Khronos WebGL extension registry. `oxgl-core` decides
// which extensions exist and enables their GL extensions; these objects
// convert arguments per WebIDL and call the context's native exports.
import { native } from './native.js';
import { WebGLShader, WebGLVertexArrayObjectOES } from './objects.js';
import { CONSTRUCTING, exposeMembers, requireArguments, toBoolean, toFloat, toList, toLong, toLongLong, toUnsignedLong, toUnsignedLongLong } from './webidl.js';
import {
  bindVertexArrayIn,
  checkObject,
  type ContextState,
  createVertexArrayIn,
  deleteVertexArrayIn,
  isVertexArrayIn,
  keyOf,
} from './context.js';

const INVALID_ENUM = 0x0500;
const INVALID_VALUE = 0x0501;
const INVALID_OPERATION = 0x0502;

/** The context state of each extension object. */
const owners = new WeakMap<object, ContextState>();

function ownerOf(extension: object): ContextState {
  const s = owners.get(extension);
  if (s === undefined) throw new TypeError('Illegal invocation');
  return s;
}

/** An extension class: constructible only by `createExtension`. */
type ExtensionClass = new (token: symbol) => object;

/**
 * Checks the construction token, as the context classes do: extension
 * interfaces have no constructor (WebIDL `LegacyNoInterfaceObject`).
 */
function constructing(token: symbol): void {
  if (token !== CONSTRUCTING) throw new TypeError('Illegal constructor');
}

/**
 * Defines `table` as WebIDL constants on the class and its prototype
 * (read-only, enumerable), as `withConstants` in context.ts does for the contexts.
 */
function extensionConstants<C extends ExtensionClass, K extends Readonly<Record<string, number>>>(
  cls: C,
  table: K,
): C & K & { readonly prototype: InstanceType<C> & K } {
  for (const target of [cls, cls.prototype] as object[]) {
    for (const [name, value] of Object.entries(table)) {
      Object.defineProperty(target, name, { value, writable: false, enumerable: true, configurable: false });
    }
  }
  return cls as C & K & { readonly prototype: InstanceType<C> & K };
}

/** An extension that adds only constants, formats or shader features. */
function constantsOnly<K extends Readonly<Record<string, number>>>(name: string, table: K) {
  const cls = {
    // An interface with constants only is still a class of its own.
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    [name]: class {
      constructor(token: symbol) {
        constructing(token);
      }
    },
  }[name] as ExtensionClass;
  return extensionConstants(cls, table);
}

/** The arguments of a native call on a live context, or `undefined`. */
function live(extension: object): ContextState | undefined {
  const s = ownerOf(extension);
  return s.destroyed ? undefined : s;
}

// --- Extensions with entry points --------------------------------------

/** ANGLE_instanced_arrays (WebGL 1). */
export const ANGLE_instanced_arrays = extensionConstants(
  class ANGLE_instanced_arrays {
    constructor(token: symbol) {
      constructing(token);
    }

    drawArraysInstancedANGLE(mode: number, first: number, count: number, primcount: number): void {
      requireArguments('drawArraysInstancedANGLE', 4, arguments.length);
      const args = [toUnsignedLong(mode), toLong(first), toLong(count), toLong(primcount)] as const;
      const s = live(this);
      if (s) native.drawArraysInstanced(s.index, s.version, ...args);
    }

    drawElementsInstancedANGLE(mode: number, count: number, type: number, offset: number, primcount: number): void {
      requireArguments('drawElementsInstancedANGLE', 5, arguments.length);
      const args = [toUnsignedLong(mode), toLong(count), toUnsignedLong(type), toLongLong(offset), toLong(primcount)] as const;
      const s = live(this);
      if (s) native.drawElementsInstanced(s.index, s.version, ...args);
    }

    vertexAttribDivisorANGLE(index: number, divisor: number): void {
      requireArguments('vertexAttribDivisorANGLE', 2, arguments.length);
      const args = [toUnsignedLong(index), toUnsignedLong(divisor)] as const;
      const s = live(this);
      if (s) native.vertexAttribDivisor(s.index, s.version, ...args);
    }
  },
  { VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 0x88fe },
);

/** OES_vertex_array_object (WebGL 1); shares the context's vertex array mirror. */
export const OES_vertex_array_object = extensionConstants(
  class OES_vertex_array_object {
    constructor(token: symbol) {
      constructing(token);
    }

    createVertexArrayOES(): WebGLVertexArrayObjectOES {
      return createVertexArrayIn(ownerOf(this), WebGLVertexArrayObjectOES);
    }

    deleteVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): void {
      requireArguments('deleteVertexArrayOES', 1, arguments.length);
      deleteVertexArrayIn(ownerOf(this), arrayObject, WebGLVertexArrayObjectOES, 'deleteVertexArrayOES');
    }

    isVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): boolean {
      requireArguments('isVertexArrayOES', 1, arguments.length);
      return isVertexArrayIn(ownerOf(this), arrayObject, WebGLVertexArrayObjectOES, 'isVertexArrayOES');
    }

    bindVertexArrayOES(arrayObject: WebGLVertexArrayObjectOES | null): void {
      requireArguments('bindVertexArrayOES', 1, arguments.length);
      bindVertexArrayIn(ownerOf(this), arrayObject, WebGLVertexArrayObjectOES, 'bindVertexArrayOES');
    }
  },
  { VERTEX_ARRAY_BINDING_OES: 0x85b5 },
);

const DRAW_BUFFERS_CONSTANTS = Object.fromEntries([
  ...Array.from({ length: 16 }, (_, i) => [`COLOR_ATTACHMENT${String(i)}_WEBGL`, 0x8ce0 + i] as const),
  ...Array.from({ length: 16 }, (_, i) => [`DRAW_BUFFER${String(i)}_WEBGL`, 0x8825 + i] as const),
  ['MAX_COLOR_ATTACHMENTS_WEBGL', 0x8cdf],
  ['MAX_DRAW_BUFFERS_WEBGL', 0x8824],
]) as Readonly<Record<string, number>>;

/** WEBGL_draw_buffers (WebGL 1). */
export const WEBGL_draw_buffers = extensionConstants(
  class WEBGL_draw_buffers {
    constructor(token: symbol) {
      constructing(token);
    }

    drawBuffersWEBGL(buffers: Iterable<number>): void {
      requireArguments('drawBuffersWEBGL', 1, arguments.length);
      const list = [...toList(Uint32Array, toUnsignedLong, buffers, 'drawBuffersWEBGL')];
      const s = live(this);
      if (s) native.drawBuffers(s.index, s.version, list);
    }
  },
  DRAW_BUFFERS_CONSTANTS,
);

/** WEBGL_debug_shaders. */
export const WEBGL_debug_shaders = extensionConstants(
  class WEBGL_debug_shaders {
    constructor(token: symbol) {
      constructing(token);
    }

    /** ANGLE's translation of a compiled shader; `''` before compiling. */
    getTranslatedShaderSource(shader: WebGLShader): string {
      requireArguments('getTranslatedShaderSource', 1, arguments.length);
      const s = ownerOf(this);
      const state = checkObject(s, shader, WebGLShader, 'getTranslatedShaderSource', 1, false, INVALID_VALUE);
      if (!state) return '';
      return native.translatedShaderSource(s.index, s.version, ...keyOf(state)) ?? '';
    }
  },
  {},
);

/** A `WEBGL_multi_draw` list from `offset` on, `drawcount` long; `undefined` after an error. */
function drawList(s: ContextState, list: Int32Array, offset: number, drawcount: number): number[] | undefined {
  if (drawcount > list.length || offset > list.length - drawcount) {
    native.synthesizeError(s.index, s.version, INVALID_OPERATION);
    return undefined;
  }
  return [...list.subarray(offset, offset + drawcount)];
}

function int32List(value: unknown, method: string): Int32Array {
  return toList(Int32Array, toLong, value, method);
}

/** WEBGL_multi_draw. */
export const WEBGL_multi_draw = extensionConstants(
  class WEBGL_multi_draw {
    constructor(token: symbol) {
      constructing(token);
    }

    multiDrawArraysWEBGL(mode: number, firstsList: Iterable<number>, firstsOffset: number, countsList: Iterable<number>, countsOffset: number, drawcount: number): void {
      requireArguments('multiDrawArraysWEBGL', 6, arguments.length);
      multiDraw(this, 'multiDrawArraysWEBGL', mode, [firstsList, firstsOffset], [countsList, countsOffset], null, 0, drawcount);
    }

    multiDrawElementsWEBGL(mode: number, countsList: Iterable<number>, countsOffset: number, type: number, offsetsList: Iterable<number>, offsetsOffset: number, drawcount: number): void {
      requireArguments('multiDrawElementsWEBGL', 7, arguments.length);
      multiDraw(this, 'multiDrawElementsWEBGL', mode, [offsetsList, offsetsOffset], [countsList, countsOffset], null, toUnsignedLong(type), drawcount, true);
    }

    multiDrawArraysInstancedWEBGL(mode: number, firstsList: Iterable<number>, firstsOffset: number, countsList: Iterable<number>, countsOffset: number, instanceCountsList: Iterable<number>, instanceCountsOffset: number, drawcount: number): void {
      requireArguments('multiDrawArraysInstancedWEBGL', 8, arguments.length);
      multiDraw(this, 'multiDrawArraysInstancedWEBGL', mode, [firstsList, firstsOffset], [countsList, countsOffset], [instanceCountsList, instanceCountsOffset], 0, drawcount);
    }

    multiDrawElementsInstancedWEBGL(mode: number, countsList: Iterable<number>, countsOffset: number, type: number, offsetsList: Iterable<number>, offsetsOffset: number, instanceCountsList: Iterable<number>, instanceCountsOffset: number, drawcount: number): void {
      requireArguments('multiDrawElementsInstancedWEBGL', 9, arguments.length);
      multiDraw(this, 'multiDrawElementsInstancedWEBGL', mode, [offsetsList, offsetsOffset], [countsList, countsOffset], [instanceCountsList, instanceCountsOffset], toUnsignedLong(type), drawcount, true);
    }
  },
  {},
);

/**
 * The `WEBGL_multi_draw` calls: WebIDL conversion of each list and offset,
 * then Chromium's checks (a negative drawcount is `INVALID_VALUE`; a list
 * too short for offset + drawcount is `INVALID_OPERATION`).
 */
function multiDraw(
  extension: object,
  method: string,
  modeValue: number,
  firsts: [unknown, number],
  counts: [unknown, number],
  instances: [unknown, number] | null,
  type: number,
  drawcountValue: number,
  elements = false,
): void {
  const mode = toUnsignedLong(modeValue);
  const firstsList = int32List(firsts[0], method);
  const firstsOffset = toUnsignedLongLong(firsts[1]);
  const countsList = int32List(counts[0], method);
  const countsOffset = toUnsignedLongLong(counts[1]);
  const instancesList = instances && int32List(instances[0], method);
  const instancesOffset = instances ? toUnsignedLongLong(instances[1]) : 0;
  const drawcount = toLong(drawcountValue);
  const s = live(extension);
  if (!s) return;
  if (drawcount < 0) {
    native.synthesizeError(s.index, s.version, INVALID_VALUE);
    return;
  }
  // Index type 0 means "arrays" to the native call.
  if (elements && type === 0) {
    native.synthesizeError(s.index, s.version, INVALID_ENUM);
    return;
  }
  const f = drawList(s, firstsList, firstsOffset, drawcount);
  const c = f && drawList(s, countsList, countsOffset, drawcount);
  const i = instancesList ? c && drawList(s, instancesList, instancesOffset, drawcount) : [];
  if (f && c && i) native.multiDraw(s.index, s.version, mode, f, c, i, type);
}

/** Calls an `ExtensionCall` (`oxgl-core`) on a live context. */
function extensionCall(extension: object, op: number, a: number, b = 0, c = 0, d = 0, e = 0): void {
  const s = live(extension);
  if (s) native.extensionCall(s.index, s.version, op, a, b, c, d, e);
}

/** OES_draw_buffers_indexed (WebGL 2). */
export const OES_draw_buffers_indexed = extensionConstants(
  class OES_draw_buffers_indexed {
    constructor(token: symbol) {
      constructing(token);
    }

    enableiOES(target: number, index: number): void {
      requireArguments('enableiOES', 2, arguments.length);
      extensionCall(this, 0, toUnsignedLong(target), toUnsignedLong(index));
    }

    disableiOES(target: number, index: number): void {
      requireArguments('disableiOES', 2, arguments.length);
      extensionCall(this, 1, toUnsignedLong(target), toUnsignedLong(index));
    }

    blendEquationiOES(buf: number, mode: number): void {
      requireArguments('blendEquationiOES', 2, arguments.length);
      extensionCall(this, 2, toUnsignedLong(buf), toUnsignedLong(mode));
    }

    blendEquationSeparateiOES(buf: number, modeRGB: number, modeAlpha: number): void {
      requireArguments('blendEquationSeparateiOES', 3, arguments.length);
      extensionCall(this, 3, toUnsignedLong(buf), toUnsignedLong(modeRGB), toUnsignedLong(modeAlpha));
    }

    blendFunciOES(buf: number, src: number, dst: number): void {
      requireArguments('blendFunciOES', 3, arguments.length);
      extensionCall(this, 4, toUnsignedLong(buf), toUnsignedLong(src), toUnsignedLong(dst));
    }

    blendFuncSeparateiOES(buf: number, srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void {
      requireArguments('blendFuncSeparateiOES', 5, arguments.length);
      extensionCall(this, 5, toUnsignedLong(buf), toUnsignedLong(srcRGB), toUnsignedLong(dstRGB), toUnsignedLong(srcAlpha), toUnsignedLong(dstAlpha));
    }

    colorMaskiOES(buf: number, r: boolean, g: boolean, b: boolean, a: boolean): void {
      requireArguments('colorMaskiOES', 5, arguments.length);
      const mask = [r, g, b, a].map((v) => (toBoolean(v) ? 1 : 0));
      extensionCall(this, 6, toUnsignedLong(buf), mask[0], mask[1], mask[2], mask[3]);
    }
  },
  {},
);

/** EXT_clip_control. */
export const EXT_clip_control = extensionConstants(
  class EXT_clip_control {
    constructor(token: symbol) {
      constructing(token);
    }

    clipControlEXT(origin: number, depth: number): void {
      requireArguments('clipControlEXT', 2, arguments.length);
      extensionCall(this, 7, toUnsignedLong(origin), toUnsignedLong(depth));
    }
  },
  {
    LOWER_LEFT_EXT: 0x8ca1,
    UPPER_LEFT_EXT: 0x8ca2,
    NEGATIVE_ONE_TO_ONE_EXT: 0x935e,
    ZERO_TO_ONE_EXT: 0x935f,
    CLIP_ORIGIN_EXT: 0x935c,
    CLIP_DEPTH_MODE_EXT: 0x935d,
  },
);

/** EXT_polygon_offset_clamp. */
export const EXT_polygon_offset_clamp = extensionConstants(
  class EXT_polygon_offset_clamp {
    constructor(token: symbol) {
      constructing(token);
    }

    polygonOffsetClampEXT(factor: number, units: number, clamp: number): void {
      requireArguments('polygonOffsetClampEXT', 3, arguments.length);
      extensionCall(this, 8, toFloat(factor), toFloat(units), toFloat(clamp));
    }
  },
  { POLYGON_OFFSET_CLAMP_EXT: 0x8e1b },
);

/** WEBGL_provoking_vertex (WebGL 2). */
export const WEBGL_provoking_vertex = extensionConstants(
  class WEBGL_provoking_vertex {
    constructor(token: symbol) {
      constructing(token);
    }

    provokingVertexWEBGL(provokeMode: number): void {
      requireArguments('provokingVertexWEBGL', 1, arguments.length);
      extensionCall(this, 9, toUnsignedLong(provokeMode));
    }
  },
  {
    FIRST_VERTEX_CONVENTION_WEBGL: 0x8e4d,
    LAST_VERTEX_CONVENTION_WEBGL: 0x8e4e,
    PROVOKING_VERTEX_WEBGL: 0x8e4f,
  },
);

/** WEBGL_polygon_mode. */
export const WEBGL_polygon_mode = extensionConstants(
  class WEBGL_polygon_mode {
    constructor(token: symbol) {
      constructing(token);
    }

    polygonModeWEBGL(face: number, mode: number): void {
      requireArguments('polygonModeWEBGL', 2, arguments.length);
      extensionCall(this, 10, toUnsignedLong(face), toUnsignedLong(mode));
    }
  },
  {
    POLYGON_MODE_WEBGL: 0x0b40,
    POLYGON_OFFSET_LINE_WEBGL: 0x2a02,
    LINE_WEBGL: 0x1b01,
    FILL_WEBGL: 0x1b02,
  },
);

/** WEBGL_lose_context (WebGL 1.0 §5.15.3). */
export const WEBGL_lose_context = extensionConstants(
  class WEBGL_lose_context {
    constructor(token: symbol) {
      constructing(token);
    }

    loseContext(): void {
      const s = live(this);
      if (s) native.loseContext(s.index, s.version);
    }

    restoreContext(): void {
      const s = live(this);
      if (s) native.synthesizeError(s.index, s.version, INVALID_OPERATION);
    }
  },
  {},
);

const ASTC_SIZES = ['4x4', '5x4', '5x5', '6x5', '6x6', '8x5', '8x6', '8x8', '10x5', '10x6', '10x8', '10x10', '12x10', '12x12'];

/** WEBGL_compressed_texture_astc. */
export const WEBGL_compressed_texture_astc = extensionConstants(
  class WEBGL_compressed_texture_astc {
    constructor(token: symbol) {
      constructing(token);
    }

    /** ANGLE exposes the LDR profile (`KHR_texture_compression_astc_ldr`). */
    getSupportedProfiles(): string[] {
      return ['ldr'];
    }
  },
  Object.fromEntries([
    ...ASTC_SIZES.map((size, i) => [`COMPRESSED_RGBA_ASTC_${size}_KHR`, 0x93b0 + i] as const),
    ...ASTC_SIZES.map((size, i) => [`COMPRESSED_SRGB8_ALPHA8_ASTC_${size}_KHR`, 0x93d0 + i] as const),
  ]) as Readonly<Record<string, number>>,
);

// --- Extensions with constants only ------------------------------------

const COLOR_BUFFER_CONSTANTS = { FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211, UNSIGNED_NORMALIZED_EXT: 0x8c17 };

const CONSTANTS_ONLY = {
  EXT_blend_minmax: { MIN_EXT: 0x8007, MAX_EXT: 0x8008 },
  EXT_color_buffer_float: {},
  EXT_color_buffer_half_float: { RGBA16F_EXT: 0x881a, RGB16F_EXT: 0x881b, ...COLOR_BUFFER_CONSTANTS },
  EXT_conservative_depth: {},
  EXT_depth_clamp: { DEPTH_CLAMP_EXT: 0x864f },
  EXT_float_blend: {},
  EXT_frag_depth: {},
  EXT_shader_texture_lod: {},
  EXT_sRGB: { SRGB_EXT: 0x8c40, SRGB_ALPHA_EXT: 0x8c42, SRGB8_ALPHA8_EXT: 0x8c43, FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT: 0x8210 },
  EXT_texture_compression_bptc: {
    COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c,
    COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT: 0x8e8d,
    COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT: 0x8e8e,
    COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT: 0x8e8f,
  },
  EXT_texture_compression_rgtc: {
    COMPRESSED_RED_RGTC1_EXT: 0x8dbb,
    COMPRESSED_SIGNED_RED_RGTC1_EXT: 0x8dbc,
    COMPRESSED_RED_GREEN_RGTC2_EXT: 0x8dbd,
    COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT: 0x8dbe,
  },
  EXT_texture_filter_anisotropic: { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff },
  EXT_texture_mirror_clamp_to_edge: { MIRROR_CLAMP_TO_EDGE_EXT: 0x8743 },
  EXT_texture_norm16: {
    R16_EXT: 0x822a,
    RG16_EXT: 0x822c,
    RGB16_EXT: 0x8054,
    RGBA16_EXT: 0x805b,
    R16_SNORM_EXT: 0x8f98,
    RG16_SNORM_EXT: 0x8f99,
    RGB16_SNORM_EXT: 0x8f9a,
    RGBA16_SNORM_EXT: 0x8f9b,
  },
  KHR_parallel_shader_compile: { COMPLETION_STATUS_KHR: 0x91b1 },
  NV_shader_noperspective_interpolation: {},
  OES_element_index_uint: {},
  OES_fbo_render_mipmap: {},
  OES_standard_derivatives: { FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8b8b },
  OES_texture_float: {},
  OES_texture_float_linear: {},
  OES_texture_half_float: { HALF_FLOAT_OES: 0x8d61 },
  OES_texture_half_float_linear: {},
  WEBGL_blend_func_extended: {
    SRC1_COLOR_WEBGL: 0x88f9,
    SRC1_ALPHA_WEBGL: 0x8589,
    ONE_MINUS_SRC1_COLOR_WEBGL: 0x88fa,
    ONE_MINUS_SRC1_ALPHA_WEBGL: 0x88fb,
    MAX_DUAL_SOURCE_DRAW_BUFFERS_WEBGL: 0x88fc,
  },
  WEBGL_clip_cull_distance: {
    MAX_CLIP_DISTANCES_WEBGL: 0x0d32,
    MAX_CULL_DISTANCES_WEBGL: 0x82f9,
    MAX_COMBINED_CLIP_AND_CULL_DISTANCES_WEBGL: 0x82fa,
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`CLIP_DISTANCE${String(i)}_WEBGL`, 0x3000 + i])),
  },
  WEBGL_color_buffer_float: { RGBA32F_EXT: 0x8814, ...COLOR_BUFFER_CONSTANTS },
  WEBGL_compressed_texture_etc: {
    COMPRESSED_R11_EAC: 0x9270,
    COMPRESSED_SIGNED_R11_EAC: 0x9271,
    COMPRESSED_RG11_EAC: 0x9272,
    COMPRESSED_SIGNED_RG11_EAC: 0x9273,
    COMPRESSED_RGB8_ETC2: 0x9274,
    COMPRESSED_SRGB8_ETC2: 0x9275,
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9276,
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: 0x9277,
    COMPRESSED_RGBA8_ETC2_EAC: 0x9278,
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: 0x9279,
  },
  WEBGL_compressed_texture_etc1: { COMPRESSED_RGB_ETC1_WEBGL: 0x8d64 },
  WEBGL_compressed_texture_s3tc: {
    COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0,
    COMPRESSED_RGBA_S3TC_DXT1_EXT: 0x83f1,
    COMPRESSED_RGBA_S3TC_DXT3_EXT: 0x83f2,
    COMPRESSED_RGBA_S3TC_DXT5_EXT: 0x83f3,
  },
  WEBGL_compressed_texture_s3tc_srgb: {
    COMPRESSED_SRGB_S3TC_DXT1_EXT: 0x8c4c,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT: 0x8c4d,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT: 0x8c4e,
    COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT: 0x8c4f,
  },
  WEBGL_debug_renderer_info: { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 },
  WEBGL_depth_texture: { UNSIGNED_INT_24_8_WEBGL: 0x84fa },
  WEBGL_render_shared_exponent: {},
  WEBGL_stencil_texturing: { DEPTH_STENCIL_TEXTURE_MODE_WEBGL: 0x90ea, STENCIL_INDEX_WEBGL: 0x1901 },
} as const;

type ConstantsOnly = typeof CONSTANTS_ONLY;

const CLASSES = new Map<string, ExtensionClass>([
  ['ANGLE_instanced_arrays', ANGLE_instanced_arrays],
  ['OES_vertex_array_object', OES_vertex_array_object],
  ['WEBGL_draw_buffers', WEBGL_draw_buffers],
  ['WEBGL_debug_shaders', WEBGL_debug_shaders],
  ['WEBGL_multi_draw', WEBGL_multi_draw],
  ['OES_draw_buffers_indexed', OES_draw_buffers_indexed],
  ['EXT_clip_control', EXT_clip_control],
  ['EXT_polygon_offset_clamp', EXT_polygon_offset_clamp],
  ['WEBGL_provoking_vertex', WEBGL_provoking_vertex],
  ['WEBGL_polygon_mode', WEBGL_polygon_mode],
  ['WEBGL_lose_context', WEBGL_lose_context],
  ['WEBGL_compressed_texture_astc', WEBGL_compressed_texture_astc],
  ...Object.entries(CONSTANTS_ONLY).map(([name, table]) => [name, constantsOnly(name, table)] as const),
]);

exposeMembers(...CLASSES.values());

/** The object type `getExtension` returns for each name. */
export type ExtensionMap = {
  ANGLE_instanced_arrays: InstanceType<typeof ANGLE_instanced_arrays>;
  OES_vertex_array_object: InstanceType<typeof OES_vertex_array_object>;
  WEBGL_draw_buffers: InstanceType<typeof WEBGL_draw_buffers>;
  WEBGL_debug_shaders: InstanceType<typeof WEBGL_debug_shaders>;
  WEBGL_multi_draw: InstanceType<typeof WEBGL_multi_draw>;
  OES_draw_buffers_indexed: InstanceType<typeof OES_draw_buffers_indexed>;
  EXT_clip_control: InstanceType<typeof EXT_clip_control>;
  EXT_polygon_offset_clamp: InstanceType<typeof EXT_polygon_offset_clamp>;
  WEBGL_provoking_vertex: InstanceType<typeof WEBGL_provoking_vertex>;
  WEBGL_polygon_mode: InstanceType<typeof WEBGL_polygon_mode>;
  WEBGL_lose_context: InstanceType<typeof WEBGL_lose_context>;
  WEBGL_compressed_texture_astc: InstanceType<typeof WEBGL_compressed_texture_astc>;
} & { readonly [K in keyof ConstantsOnly]: ConstantsOnly[K] };

/**
 * A new object for the enabled extension `name` (canonical case) of the
 * context `s`. Every name `oxgl-core` enables has a class here.
 */
export function createExtension(name: string, s: ContextState): object {
  const Class = CLASSES.get(name);
  if (Class === undefined) throw new Error(`oxgl: no class for extension ${name}`);
  const extension = new Class(CONSTRUCTING);
  owners.set(extension, s);
  return extension;
}
