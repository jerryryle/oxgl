# oxgl

Standards-compliant WebGL 1 and WebGL 2 for Node.js, rendered headless through
ANGLE, with a SwiftShader software fallback. The full WebGL 1 and WebGL 2 APIs
are implemented, with extensions and context loss, and are checked against the
Khronos conformance suite; three.js renders through it unmodified.

## Platforms

Linux arm64 (glibc) is the only supported and tested platform for now. The
build also recognises Linux x64, macOS arm64, Windows x64 and Windows arm64,
and a pinned ANGLE bundle exists for each, so `npm run build` works on those
hosts for local use. They are not supported or tested until they are
restored.

Docker on a Mac exposes no GPU to Linux containers, so the Linux arm64 runs use
the software backend. The GPU backend path has been checked on macOS arm64
(ANGLE Metal on an Apple GPU): all Node tests pass, and the Khronos results match
Linux arm64 except for differences in the canvas package's image decoding.

## Known issues

- **SwiftShader initialization briefly changes process-global state.** The
  first SwiftShader context in a process (`backend: 'software'`,
  `OXGL_BACKEND=software`, or an `'auto'` context the GPU cannot provide,
  whether there is no usable GPU or one GPU context fails to create, for
  example when GPU memory runs out) makes ANGLE set
  `VK_ICD_FILENAMES` and, on Linux and Windows, change the working directory
  for a few milliseconds, then restore both. A thread that reads the
  environment or uses a relative path at that moment can misbehave or crash.
  GPU backends are unaffected. To control when this happens, create and destroy
  one software context at startup, before starting other threads. The cause is
  ANGLE's `ScopedVkLoaderEnvironment`; this entry goes away once the pinned
  ANGLE stops doing it (tracked in `angle/README.md`, "Known upstream issues").
- **Each thread that uses oxgl leaves about 72 bytes behind.** ANGLE allocates
  per-thread state on a thread's first EGL call and intentionally never frees
  it, so a worker thread that created a context leaks those bytes when it
  exits. This is per thread, not per context. Applications that churn through
  very many short-lived workers should reuse workers instead. Tracked in
  `angle/README.md`, "Known upstream issues".

## Usage

```js
import { createContext } from 'oxgl';

const gl = createContext({ width: 64, height: 32 });
gl.clearColor(0, 1, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);

const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
console.log(pixels.subarray(0, 4)); // Uint8Array(4) [ 0, 255, 0, 255 ]

gl.destroy();
```

`createContext({ width, height, backend, webgl2, attributes, canvas })` returns
a `WebGLRenderingContext`, or a `WebGL2RenderingContext` when `webgl2` is
`true`. No window system, display server, or canvas is needed. `width` and
`height` must be integers from 0 to 2147483647 (0 gives 1); a size beyond the
implementation's limits gives a smaller drawing buffer with the same aspect
ratio, so check `drawingBufferWidth` and `drawingBufferHeight`.

`attributes` takes the `WebGLContextAttributes` a browser's `getContext`
takes (`alpha`, `depth`, `stencil`, `antialias`, `premultipliedAlpha`,
`preserveDrawingBuffer`, `powerPreference`, `failIfMajorPerformanceCaveat`),
with the same defaults; `getContextAttributes()` reports what was allocated.
As in browsers, `antialias` defaults to `true`, which gives a 4-sample buffer
plus a resolve buffer, about nine times the memory of a single-sampled RGBA8
buffer; pass `antialias: false` when you don't need it. A headless buffer is
never presented, so its contents persist whatever `preserveDrawingBuffer` is.
`failIfMajorPerformanceCaveat: true` refuses the software backend: with
`'auto'` it behaves as `'gpu'`, and with `'software'` it throws
`OXGL_CONTEXT_CREATION_FAILED`.

### Canvas and resizing

`gl.canvas` is the `canvas` option's object, or a `HeadlessCanvas` (an
`EventTarget` with `width` and `height`) when none was given. Setting
`gl.canvas.width` or `height` resizes the drawing buffer, as with an HTML
canvas. `gl.resize(width, height)` (not part of WebGL) does the same for any
context, also updating a `HeadlessCanvas`. A resize clears the buffer and
keeps all other state, including the viewport.

Libraries that take a canvas and a context, such as three.js, can use both:

```js
import * as THREE from 'three';
import { createContext } from 'oxgl';

const gl = createContext({ width: 256, height: 256, webgl2: true });
const renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl });
renderer.setSize(256, 256, false); // false: a HeadlessCanvas has no style
```

### Backends

| `backend` | Renders with |
|---|---|
| `'auto'` (default) | the platform GPU backend (Metal on macOS, Vulkan on Linux, D3D11 on Windows), or SwiftShader if that fails |
| `'gpu'` | the GPU backend only; throws `OXGL_GPU_UNAVAILABLE` if it fails |
| `'software'` | SwiftShader (CPU), which works without a GPU or GPU drivers |

A CPU driver (SwiftShader, llvmpipe, lavapipe, WARP) never counts as a GPU. If
the GPU backend fails to initialize, it is not retried until the process
restarts. A failure to create one GPU context, such as running out of GPU
memory, affects only that call.

The `OXGL_BACKEND` environment variable (`auto`, `gpu`, or `software`)
overrides the `backend` option. It is read from the calling thread's
`process.env` on every `createContext` call, so a worker can set its own. An
empty value is ignored.

### Extensions

`getSupportedExtensions()` lists the WebGL extensions ANGLE can enable on the
context's backend, and `getExtension(name)` enables one and returns its object
(the same object on every call). On the software backend that includes
`ANGLE_instanced_arrays`, `OES_vertex_array_object`, `WEBGL_draw_buffers`,
`OES_texture_float`, `OES_texture_half_float`, `EXT_color_buffer_float`,
`EXT_color_buffer_half_float`, `EXT_texture_filter_anisotropic`,
`WEBGL_depth_texture`, `WEBGL_multi_draw`, the S3TC, ETC, ASTC, BPTC and RGTC
compressed-texture extensions, `WEBGL_lose_context` and the debug extensions.
`WEBGL_color_buffer_float` is not offered (SwiftShader cannot render to
`RGBA`/`FLOAT` textures under it), nor are the timer-query extensions.

### Context loss

A context lost through `WEBGL_lose_context.loseContext()` or by the backend
fires `webglcontextlost` at its canvas in a later task; calling
`preventDefault()` on it allows restoring, after which `webglcontextrestored`
fires and the context renders again with fresh state. Objects created before
the loss are invalid afterwards, as in browsers.

### Releasing contexts

`destroy()` (not part of WebGL) releases a context's native resources
immediately and puts it in the lost state: later calls do nothing, `getError()`
returns `CONTEXT_LOST_WEBGL` once and then `NO_ERROR`, and the drawing buffer
size reads as `0`. A context that becomes unreachable without `destroy()` is
released after garbage collection.

### Errors

Invalid options throw a `TypeError` or `RangeError`. Other failures throw an
`Error` with a `code`:

| `code` | Cause |
|---|---|
| `OXGL_GPU_UNAVAILABLE` | `backend: 'gpu'` (option or `OXGL_BACKEND`) could not create a context |
| `OXGL_INVALID_BACKEND` | `OXGL_BACKEND` has a value other than `auto`, `gpu`, `software`, or empty |
| `OXGL_CONTEXT_CREATION_FAILED` | no backend could create the context, for example WebGL 2 on a backend without OpenGL ES 3.0, or `failIfMajorPerformanceCaveat` with the software backend |
| `OXGL_NATIVE_MISSING` | the native addon or its ANGLE libraries are missing or failed to load |

WebGL errors are reported through `getError()`, as in a browser.

## Performance

`npm run bench` measures per-call overhead, draws, transfers and two three.js
scenes. On Linux arm64 in Docker (16 cores, software backend, 2 s per case):

| Case | Result |
|---|---|
| `enable` (a state call: WebIDL conversion and the native call) | 11.6 M calls/s |
| `uniform4f` | 7.3 M calls/s |
| `drawArrays`, one small triangle | 53 k draws/s |
| `bufferSubData`, 1 MiB | 32 GB/s |
| `texSubImage2D`, 512×512 RGBA8 | 26 GB/s |
| `readPixels`, 256×256 RGBA8 | 3.3 GB/s |
| three.js, 1000 lit meshes | 52 frames/s |
| three.js, one 128×64-segment lit sphere | 1230 frames/s |

Draws cost the same as calling ANGLE directly (51.9 k draws/s in
`cargo test -p oxgl-sys --test angle --release raw_draw_rate -- --ignored`):
the time is SwiftShader's, and a GPU backend draws much faster. oxgl adds
about 100 ns per call.

On the GPU backend (macOS arm64, ANGLE Metal, Apple M4 Max), the same
benchmarks give 715 k small draws/s and 830 frames/s for the 1000-mesh
three.js scene.

## Prerequisites

- [rustup](https://rustup.rs). The pinned toolchain in `rust-toolchain.toml` is
  installed automatically on first use.
- Node.js 22.22.2 or newer (`engines` in `package.json`).
- libclang, which generates the EGL/GLES bindings at build time: Xcode's
  command-line tools on macOS, `libclang-dev` (or any LLVM install) on Linux,
  LLVM on Windows. Set `LIBCLANG_PATH` if it is not found.
- For `npm run conformance`: ffmpeg (with ffprobe), which decodes the
  suite's videos.
- For the license check: cargo-deny and cargo-about at the versions CI pins
  (`CARGO_DENY_VERSION` and `CARGO_ABOUT_VERSION` in
  `.github/workflows/ci.yml`), installed with
  `cargo install --locked cargo-deny@<version>` and
  `cargo install --locked cargo-about@<version> --features cli`.

## Commands

```sh
npm install        # install JS tooling
npm run build      # build the native addon (release) and the TypeScript package into dist/
npm run lint       # rustfmt, clippy (pedantic, warnings as errors), ESLint, tsc, license check
npm test           # node:test suites in test/ (run after build)
npm run conformance   # Khronos WebGL conformance suites, judged against conformance/expectations.txt
npm run notices    # regenerate THIRD_PARTY_NOTICES after changing Rust dependencies
cargo test --workspace --exclude oxgl-node   # Rust tests (oxgl-node is tested from Node)
```

Specs and change proposals live in `openspec/`; run OpenSpec as `npx openspec`.
`CONTRIBUTING.md` describes the CI checks and how to run each one locally.

## License

BSD-3-Clause; see `LICENSE`. Bundled third-party components and their licenses
are listed in `THIRD_PARTY_NOTICES`.
