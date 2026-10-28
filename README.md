# oxgl

Standards-compliant WebGL 1 and WebGL 2 for Node.js, rendered headless through
ANGLE, with a SwiftShader software fallback. Early development: contexts
support `clearColor`, `clear`, `readPixels`, and `getError` so far.

## Platforms

Linux arm64 (glibc) is the only supported and tested platform for now. The
build also recognises Linux x64, macOS arm64, Windows x64 and Windows arm64,
and a pinned ANGLE bundle exists for each, so `npm run build` works on those
hosts for local use. They are not supported or tested until they are
restored.

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
  ANGLE stops doing it.
- **Each thread that uses oxgl leaves about 72 bytes behind.** ANGLE allocates
  per-thread state on a thread's first EGL call and intentionally never frees
  it, so a worker thread that created a context leaks those bytes when it
  exits. This is per thread, not per context. Applications that churn through
  very many short-lived workers should reuse workers instead.

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

`createContext({ width, height, backend, webgl2 })` returns a
`WebGLRenderingContext`, or a `WebGL2RenderingContext` when `webgl2` is `true`.
No window system, display server, or canvas is needed. `width` and `height` must
be positive integers; a size beyond the implementation's limits gives a smaller
drawing buffer with the same aspect ratio, so check `drawingBufferWidth` and
`drawingBufferHeight`.

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
| `OXGL_CONTEXT_CREATION_FAILED` | no backend could create the context, for example WebGL 2 on a backend without OpenGL ES 3.0 |
| `OXGL_NATIVE_MISSING` | the native addon or its ANGLE libraries are missing or failed to load |

WebGL errors are reported through `getError()`, as in a browser.

## Prerequisites

- [rustup](https://rustup.rs). The pinned toolchain in `rust-toolchain.toml` is
  installed automatically on first use.
- Node.js 22.22.2 or newer (`engines` in `package.json`).
- libclang, which generates the EGL/GLES bindings at build time: Xcode's
  command-line tools on macOS, `libclang-dev` (or any LLVM install) on Linux,
  LLVM on Windows. Set `LIBCLANG_PATH` if it is not found.
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
