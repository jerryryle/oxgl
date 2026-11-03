# oxgl

[![ci](https://github.com/oxgl-js/oxgl/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/oxgl-js/oxgl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@oxgl-js/oxgl)](https://www.npmjs.com/package/@oxgl-js/oxgl)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)

Oxgl is headless WebGL 1 and WebGL 2 for Node.js that strives for standards
compliance. It renders through ANGLE. By default it uses the GPU when one is
available and the SwiftShader software renderer otherwise. It implements the
WebGL 1 and WebGL 2 APIs, including extensions and context loss, and is tested
against the Khronos WebGL conformance suites.

Three.js works with oxgl without any changes to three.js (see three.js below).

## Install

```sh
npm install @oxgl-js/oxgl
```

Oxgl needs Node.js 22.22.2 or newer, on one of the platforms below. Installing
needs no Rust toolchain, compiler or install script: npm downloads only the
package for your platform, which holds the native addon and its ANGLE
libraries. To build from source, see Prerequisites below and
`CONTRIBUTING.md`.

## Platforms

| Platform | Package | GPU backend |
|---|---|---|
| Linux x64 (glibc) | `@oxgl-js/linux-x64-gnu` | Vulkan, or OpenGL ES for WebGL 2 (see Backends) |
| Linux arm64 (glibc) | `@oxgl-js/linux-arm64-gnu` | Vulkan, or OpenGL ES for WebGL 2 (see Backends) |
| macOS arm64 | `@oxgl-js/darwin-arm64` | Metal |
| Windows x64 | `@oxgl-js/win32-x64-msvc` | Direct3D 11 |
| Windows arm64 | `@oxgl-js/win32-arm64-msvc` | Direct3D 11 |

On Linux, oxgl needs glibc 2.34 or newer, such as Ubuntu 22.04 or Debian 12.
There is no build for Linux with musl (such as Alpine), for macOS on Intel, or
for any other platform; importing oxgl there throws an error with
`code === 'OXGL_NATIVE_MISSING'`.

CI runs the Rust and Node tests, both Khronos conformance suites and three.js's
examples on all five platforms with the software backend, and on Linux x64 with
ANGLE's OpenGL ES backend on Mesa's llvmpipe; it does not yet test on GPUs. The
[results page](https://oxgl-js.github.io/oxgl/) shows every conformance page's
and three.js example's result on each platform for the latest release, with the
reason for each one that doesn't pass.
The results are the same on every platform, apart from the x64 pages listed
under Known issues and the three.js examples noted in the three.js section
below.

## Known issues

- **18 WebGL 2 conformance pages fail with the software backend on x64.** On
  Linux x64 and Windows x64, 18 deqp pages that render to 32-bit integer color
  buffers (`rgba32i`, `r32ui` and similar) fail their image comparisons. The
  bug is in the tests: their shaders convert floats just outside the 32-bit
  integer range, which GLSL leaves undefined, and the reference images assume
  the result is clamped. On arm64 the conversion clamps and on x86 it does not,
  so the same pages pass on arm64. The native dEQP tests fixed this in 2018
  (VK-GL-CTS commit 6624c8aa); their WebGL port has not.
  `conformance/expectations.txt` lists the pages.
- **SwiftShader initialization briefly changes process-global state.** When a
  process creates its first SwiftShader context, ANGLE sets `VK_ICD_FILENAMES`
  and, on Linux and Windows, changes the working directory for a few
  milliseconds, then restores both. A thread that reads the environment or uses
  a relative path at that moment can misbehave or crash. This happens with
  `backend: 'software'`, with `OXGL_BACKEND=software`, and when an `'auto'`
  context falls back to SwiftShader, for example because there is no usable GPU
  or GPU memory has run out. GPU contexts are unaffected. To control when it
  happens, create and destroy one software context at startup, before starting
  other threads. The cause is ANGLE's `ScopedVkLoaderEnvironment`, and the issue
  will go away when the pinned ANGLE stops doing this (tracked in
  `angle/README.md`, "Known upstream issues").
- **SwiftShader can get the depth of a near-clipped triangle wrong.** With the
  software backend, a large triangle that the near plane clips can be drawn
  with depths that are too near, hiding geometry in front of it. A typical
  case is a ground plane of two triangles that passes under the camera, which
  then hides objects standing on it. GPU backends are unaffected. Subdividing
  the large geometry (for example `new THREE.PlaneGeometry(6, 6, 32, 32)`
  instead of `PlaneGeometry(6, 6)`) avoids it. Tracked in `angle/README.md`,
  "Known upstream issues".
- **Each thread that uses oxgl leaves about 72 bytes behind.** ANGLE allocates
  per-thread state on a thread's first EGL call and intentionally never frees
  it, so a worker thread that created a context leaks those bytes when it
  exits. This is per thread, not per context. Applications that churn through
  very many short-lived workers should reuse workers instead. Tracked in
  `angle/README.md`, "Known upstream issues".

## Usage

```js
import { createContext } from '@oxgl-js/oxgl';

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

`gl.drawingBufferStorage(format, width, height)` reallocates the drawing buffer
in `RGBA8`, `SRGB8_ALPHA8` (WebGL 2, or WebGL 1 with `EXT_sRGB`) or `RGBA16F`
(with `EXT_color_buffer_float` or `EXT_color_buffer_half_float`), and
`gl.drawingBufferFormat` reports the current format. A half-float drawing
buffer reads back as `RGBA`/`FLOAT`. Resizing afterwards keeps the format.

A drawing buffer whose storage would take more than 1 GiB is allocated
without multisampling, and then smaller, as the WebGL specification allows. For
example, an antialiased buffer larger than about 5460×5460 loses its
multisampling.

### Color spaces

`gl.unpackColorSpace` (`"srgb"`, the default, or `"display-p3"`) is the color
space that `TexImageSource` uploads are converted into. An `ImageData`-shaped
object's `colorSpace` property gives its own color space, and another oxgl
context's canvas has that context's `drawingBufferColorSpace`. Every other
source counts as sRGB. Uploads from typed arrays are not converted, and
`pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, NONE)` turns conversion off.

`gl.drawingBufferColorSpace` records the color space of the drawing buffer's
values; changing it clears the buffer. `encodePNG` marks a Display P3 buffer's
PNG with a `cICP` chunk.

### three.js

Three.js needs no changes to work with oxgl. Pass it an oxgl context and that
context's canvas:

```js
import * as THREE from 'three';
import { createContext } from '@oxgl-js/oxgl';

const gl = createContext({ width: 256, height: 256, webgl2: true });
const renderer = new THREE.WebGLRenderer({ canvas: gl.canvas, context: gl });
renderer.setSize(256, 256, false); // false: a HeadlessCanvas has no style
```

`npm run threejs` renders three.js's own WebGL examples (release r186) through
oxgl and compares each frame with the reference screenshot the release keeps
for it (see `CONTRIBUTING.md`). On Linux arm64 with the software backend, of
the 354 examples it runs (377 less 23 that three.js's own test also skips):

- 228 match their reference within three.js's threshold (0.1% of pixels);
- 67 differ by up to 5% of pixels: 63 at line, polygon and text edges, where
  SwiftShader rasterizes differently from the GPU that made the reference,
  and 4 by HTML drawn over the canvas, which the runner does not render;
- 59 do not match. 51 of these hit limits of the test runner rather than
  oxgl: remote assets it refuses, pages drawn with CSS, SVG or a 2D canvas,
  views placed by CSS flow layout, HTML content around the canvas, module
  workers, or no `AudioContext`. 8 differ for known reasons: SwiftShader (3,
  including the near-clipped triangle under "Known issues"), random noise
  (3), more compressed texture formats in SwiftShader, and a wall-clock
  timer.

The other platforms give the same outcomes, with two exceptions. 3 of the
examples that differ on Linux arm64 (`webgl_shadowmap_viewer` and the two
`webxr_vr_handinput_pointer*` examples) match their reference within 0.1%
everywhere else; why only Linux arm64 differs is not yet known. On x64 (Linux
and Windows), `webgl_camera_logarithmicdepthbuffer` differs in 2.20% of
pixels rather than 1.73%, mostly where its normal z-buffer view shows
z-fighting. `threejs/expectations.txt` lists the platforms each entry applies
to.

### Images and textures

Node has no `<img>` element or image decoder, so the `TexImageSource` forms of
`texImage2D`, `texSubImage2D`, `texImage3D` and `texSubImage3D` take:

- an `ImageData`-shaped object, `{ width, height, data }`, whose `data` is an
  8-bit typed array (a `Uint8Array`, `Uint8ClampedArray` or Node `Buffer`) of
  RGBA pixels, top row first and not premultiplied, or a `Uint16Array` of
  16-bit RGBA pixels. Other arrays, such as a `Float32Array`, throw a
  `TypeError`, and `data` too short for `width × height` pixels generates
  `INVALID_OPERATION`;
- another oxgl context's `canvas`;
- any object with `getContext('2d')`, such as an `@napi-rs/canvas` canvas.

Decoding a file with an image library gives an `ImageData`-shaped object
directly. With [`sharp`](https://www.npmjs.com/package/sharp):

```js
import sharp from 'sharp';

const { data, info } = await sharp('wood.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { width: info.width, height: info.height, data });
```

With [`pngjs`](https://www.npmjs.com/package/pngjs), whose decoded image is
already `{ width, height, data }`:

```js
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const image = PNG.sync.read(readFileSync('wood.png'));
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
```

A 2D canvas library works too, by drawing the image into a canvas and uploading
the canvas. A 2D canvas stores premultiplied pixels, so semi-transparent pixels
lose some precision this way; opaque images upload exactly.

```js
import { createCanvas, loadImage } from '@napi-rs/canvas';

const img = await loadImage('wood.png');
const canvas = createCanvas(img.width, img.height);
canvas.getContext('2d').drawImage(img, 0, 0);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
```

In three.js, an `ImageData`-shaped object is a texture's image like any other:

```js
const texture = new THREE.Texture(image); // image from sharp or pngjs, as above
texture.colorSpace = THREE.SRGBColorSpace;
texture.needsUpdate = true;
```

### Saving a PNG

`encodePNG(gl)` (not part of WebGL) resolves with a PNG of the context's
drawing buffer, as a browser's `canvas.toDataURL('image/png')` would encode
it: top row first, with alpha unpremultiplied. It reads the drawing buffer
whatever framebuffer is bound and leaves all context state unchanged.

```js
import { writeFile } from 'node:fs/promises';
import { createContext, encodePNG } from '@oxgl-js/oxgl';

const gl = createContext({ width: 64, height: 32 });
gl.clearColor(0, 1, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
await writeFile('frame.png', await encodePNG(gl));
gl.destroy();
```

The pixels are read during the call, so drawing afterwards does not change the
result. Compression runs on libuv's thread pool, so it does not block the event
loop; that pool has 4 threads by default, shared with `fs` and `dns.lookup`, so
a server encoding many large frames at once may want a larger
`UV_THREADPOOL_SIZE`. The result is a Node `Buffer`, declared as `Uint8Array`
so the package's TypeScript declarations need no Node types. On a lost or
destroyed context the promise rejects with `OXGL_CONTEXT_LOST`.

### Backends

| `backend` | Renders with |
|---|---|
| `'auto'` (default) | the platform GPU backend (Metal on macOS, Vulkan on Linux, D3D11 on Windows), or SwiftShader if that fails |
| `'gpu'` | the GPU backend only; throws `OXGL_GPU_UNAVAILABLE` if it fails |
| `'software'` | SwiftShader (CPU), which works without a GPU or GPU drivers |

On Linux, a WebGL 2 context uses ANGLE's OpenGL ES backend on the system's
EGL driver when the Vulkan GPU offers only OpenGL ES 2.0, as on a Raspberry Pi
5, whose V3D GPU gets OpenGL ES 3.1 from Mesa's GL driver. This applies to
`'auto'` and `'gpu'` alike; WebGL 1 contexts stay on Vulkan, and nothing changes
where Vulkan gives OpenGL ES 3.0. It needs Mesa's EGL (`libegl1` and
`libegl-mesa0` on Debian and Ubuntu), opened only when such a context is first
created; without it, `'gpu'` throws `OXGL_GPU_UNAVAILABLE`, whose message says
the backend needs `libEGL.so.1`, and `'auto'` uses SwiftShader. The user needs access to the GPU
(on Raspberry Pi OS, membership of the `render` group); otherwise Mesa falls
back to llvmpipe, which `'gpu'` refuses.

A CPU driver (SwiftShader, llvmpipe, lavapipe, softpipe, WARP) never counts as a
GPU. If a GPU backend fails to initialize, it is not retried until the process
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
| `OXGL_GPU_UNAVAILABLE` | `backend: 'gpu'` (option or `OXGL_BACKEND`) could not create a context, including when the only driver renders on a CPU; the message names each GPU backend tried and why it failed, with the refused renderer |
| `OXGL_INVALID_BACKEND` | `OXGL_BACKEND` has a value other than `auto`, `gpu`, `software`, or empty |
| `OXGL_CONTEXT_CREATION_FAILED` | no backend could create the context, for example WebGL 2 on a backend without OpenGL ES 3.0, or `failIfMajorPerformanceCaveat` with the software backend |
| `OXGL_NATIVE_MISSING` | the native addon or its ANGLE libraries are missing or failed to load |
| `OXGL_CONTEXT_LOST` | `encodePNG` was given a lost or destroyed context (the promise rejects) |

WebGL errors are reported through `getError()`, as in a browser.

## Performance

To measure performance on your own machine, build oxgl and run the benchmarks:

```sh
npm run build
npm run bench
```

They measure state calls, uniform updates, draws, buffer and texture uploads,
`readPixels`, and two three.js scenes, and report operations per second or
bytes per second for each. They use the backend `OXGL_BACKEND` selects (the
default is `auto`) and run each case for 1 second; to run longer, set
`OXGL_BENCH_MS` to a time in milliseconds. `npm run bench -- --webgl1` measures
WebGL 1 contexts instead of WebGL 2, skipping the three.js scenes, which need
WebGL 2. Results vary widely between
machines and backends, so compare them on one machine.

Oxgl adds little overhead of its own: about 100 ns per WebGL call on Linux
arm64, for checking the arguments and calling into native code. Most of the
time for draws and three.js frames is spent in the renderer, which on the
software backend is SwiftShader, so a GPU backend is usually much faster for
draws. To compare draws with calling ANGLE directly, run
`cargo test -p oxgl-sys --test angle --release raw_draw_rate -- --ignored`.

## Prerequisites

To build from source:

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
npm run threejs    # three.js's WebGL examples, judged against threejs/expectations.txt
npm run notices    # regenerate THIRD_PARTY_NOTICES after changing Rust dependencies
cargo test --workspace --exclude oxgl-node   # Rust tests (oxgl-node is tested from Node)
```

Specs and change proposals live in `openspec/`; run OpenSpec as `npx openspec`.
`CONTRIBUTING.md` describes the CI checks and how to run each one locally.

## License

BSD-3-Clause; see `LICENSE`. Bundled third-party components and their licenses
are listed in `THIRD_PARTY_NOTICES`.
