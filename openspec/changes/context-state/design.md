# Design

## Context

- The EGL context is already created in ANGLE's WebGL-compatibility mode, with robust access and robust resource initialization enabled and client arrays disabled (`crates/oxgl-sys/src/egl.rs`, `Display::create_context`). ANGLE therefore applies WebGL's enum and value validation to every GLES call oxgl forwards: which `enable` caps exist on each version, the constant-color blend rule, `pixelStorei` values, and so on.
- Each WebGL call crosses three layers: a WebIDL conversion in `src/context.ts`, a `#[napi]` export taking `(index, version, …)` primitives in `crates/oxgl-node`, and a `Context` method in `crates/oxgl-core` that makes the context current and calls a `Current` method in `crates/oxgl-sys`. Errors oxgl detects itself go into `ErrorState::synthesize`; errors ANGLE detects stay in ANGLE and are drained by `getError`.
- The conformance harness evaluates `dist/context.js` in the page's jsdom realm and rejects every import except `native` (`conformance/page.mjs`, `contextSource()`). Any new class must therefore live in `src/context.ts`.

## Goals / Non-Goals

**Goals:** state calls are thin pass-throughs, and ANGLE stays the only validator of what it can see. One table defines `getParameter` for both versions, and later changes extend it.

**Non-Goals:** shadowing GL state in oxgl for speed. Every query goes to ANGLE, apart from the three WebGL-only unpack parameters ANGLE does not know.

## Decisions

### Forward state calls to ANGLE unvalidated

Each setter (`blendFunc`, `stencilOpSeparate`, `viewport`, `enable`, …) gets a `Current` method in `oxgl-sys` that takes values only, and a `Context` method in `oxgl-core` that forwards it. ANGLE's WebGL-compatibility validation generates `INVALID_ENUM`/`INVALID_VALUE`/`INVALID_OPERATION` exactly where WebGL requires. oxgl itself validates only:

- `pixelStorei` for `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_COLORSPACE_CONVERSION_WEBGL`. ANGLE does not know these parameters, so `oxgl-core` stores them in an `UnpackState` on the context and never forwards them.
- `getShaderPrecisionFormat`. The GLES entry point has no robust variant and no way to report failure, so `oxgl-core` checks the two enums (2 shader types × 6 precision types) and synthesizes `INVALID_ENUM` before it calls ANGLE.
- `getParameter` table membership (below).

*Alternative:* validate in oxgl and call GL only with valid arguments. That duplicates thousands of rules ANGLE already applies in WebGL-compatibility mode, which is how Chromium uses it, and the two would drift apart.

### getParameter: one table, robust getters, values built in TS

`oxgl-core` holds a static table of `(pname, kind, count, since)`. `kind` is `Bool`, `Bools`, `Int`, `UInt`, `Int64`, `Float`, `Floats`, `Ints`, `UInts`, `Enum`, `String`, `Object` or `Shadow`. `since` is WebGL 1 or 2. Lookup behaves as follows:

- **Missing from the table, or WebGL 2-only on a WebGL 1 context:** synthesize `INVALID_ENUM` and return `None`, without calling ANGLE. Extension parameters are absent, so they fail the same way until an extension change adds them, guarded by whether that extension is enabled.
- **`Object`:** return the null value without a GL call. Later object changes replace these entries with the binding the context tracks in its slotmap, never a GL name read back from ANGLE.
- **`Shadow`:** answer from `UnpackState`.
- **`String`:** `VENDOR` and `RENDERER` are `oxgl`. `VERSION` and `SHADING_LANGUAGE_VERSION` are the WebGL prefix followed by ANGLE's own string in parentheses, for example `WebGL 1.0 (OpenGL ES 2.0.0 (ANGLE …))`.
- **Everything else:** read with `glGet{Booleanv,Floatv,Integerv,Integer64v}RobustANGLE` into a Rust array of the table's `count`. A returned `length` of `0` means ANGLE recorded an error, and the result is `None`. `UInt` values are reinterpreted as `u32`. Floats are widened from `f32`.

The node layer returns `{ kind, numbers: f64[], text? }` and `src/context.ts` builds the JS value: number, boolean, boolean array, string, a new `Float32Array`/`Int32Array`/`Uint32Array`, or `null`. `f64` holds every `GLint64` parameter in the tables exactly; `MAX_SERVER_WAIT_TIMEOUT` is at most 2^53.

*Alternatives:* building typed arrays in napi-rs needs more glue in the one crate that may not hold hand-written `unsafe`, for no gain. One query per JS type (`getParameterFloat`, …) would put the table in TS and split it from the GL call it describes.

### Pack parameters are read from GL at readPixels time

`readPixels` queries `PACK_ALIGNMENT` and, on WebGL 2, `PACK_ROW_LENGTH`, `PACK_SKIP_PIXELS` and `PACK_SKIP_ROWS` through the robust integer getter, then passes them to a generalized `pixels::required_bytes` (OpenGL ES 3.0 §4.3.2 layout: skip offset plus row stride). The `PACK_ALIGNMENT` constant goes away. That is four integer reads per `readPixels`, which is noise beside the read itself, and it keeps ANGLE as the single owner of that state.

### Native surface

Each IDL operation gets its own `#[napi]` export taking `(index, version, …)`, following the existing pattern. That is about 30 new exports, and `native_abi_version` goes to 3. A single `dispatch(op, args)` export was rejected: it would hide argument types from clippy and from the TS declarations. `getSupportedExtensions` and `getExtension` stay in TS, returning `[]` and `null`, or `null` when lost. `isContextLost` returns `true` in TS for a destroyed context. Otherwise it asks native code, which checks `glGetGraphicsResetStatusEXT` as `getError` does, so a device loss shows up on the first query.

### Safety rules

- **Unsafe confinement:** every new GLES entry point is wrapped in `oxgl-sys` as a `Current` method with a `// SAFETY:` comment. Setters pass values only. Getters write only into Rust-owned fixed arrays, and their size goes to ANGLE as `bufSize`. `glGetShaderPrecisionFormat` writes into a local `[i32; 2]` and a local `i32`. `oxgl-core` and `oxgl-node` stay free of hand-written `unsafe`.
- **No panics:** table lookup returns `Option`/`Result`. Out-of-range values are converted with `try_from`, as today. A context that cannot be made current is marked lost by the existing `current()` helper.
- **Handle model:** no object types yet. `Object` table entries are where bindings will be answered from slotmap handles rather than GL names.
- **ArrayBuffer lifetime:** unchanged. Only `readPixels` touches a JS buffer, through the existing staging copy, and none of the new calls takes a buffer.

## Risks / Trade-offs

- [The `getParameter` table is large and easy to get subtly wrong] → Unit tests cover each kind. `conformance/state/gl-get-calls.html`, `gl-initial-state.html` and `gl-enum-tests.html`, plus their WebGL 2 versions, check the table against the IDL, and their outcomes are reviewed when expectations are regenerated.
- [`getParameter(ALPHA_BITS)` and friends describe the pbuffer until `drawing-buffer` lands] → They report the buffer that actually exists, which is correct at every point. `drawing-buffer` changes what they report by changing the buffer, not this table.

## Migration Plan

The package is unpublished (`0.0.0`), and the ABI bump makes a stale addon fail at load with the existing mismatch error. Existing callers see no behaviour change. The drawing buffer is untouched here.
