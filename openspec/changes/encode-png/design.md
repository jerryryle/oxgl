# Design

## Context

`canvasPixels` in `src/context.ts` already returns a context's drawing buffer as RGBA8, unpremultiplied, top row first, through the native `drawingBufferPixels`, which calls `Context::drawing_buffer_rgba8` in `oxgl-core`. That read binds the drawing buffer for reading, resolves an antialiased buffer, resets pack state and the pack buffer, drains and restores the `getError` queue, and restores everything after. It returns `None` on a lost context. The conformance runner encodes pixels with its own `encodePng` in `conformance/png.mjs` (unfiltered scanlines, `deflateSync`, a JS CRC table).

## Goals / Non-Goals

**Goals:**
- One public function built from the existing read, with no native change.
- Compression, the costly step, runs off the main thread. The rest (the read with its flip and unpremultiply, assembling scanlines, and chunk CRCs) stays on it; each is a linear pass at roughly memory-copy speed.

**Non-Goals:**
- Speed beyond what Node's zlib gives. Deflate dominates the cost and already runs in native code.

## Decisions

- **Async, with a synchronous read.** `encodePNG` is an `async` function. Its body reads the pixels before its first `await`, so the read runs during the call, on the context's thread as every GL call must, and the snapshot is fixed before the caller can draw again. The pixels are then compressed with zlib's callback `deflate` (promisified), which runs on libuv's thread pool. The read (one `readPixels`, a flip and an unpremultiply), assembling scanlines and the chunk CRCs stay on the main thread; each is a linear pass at roughly memory-copy speed. Only deflate moves off it. Deflating a 1080p RGBA buffer synchronously would block the event loop for an amount of time proportional to its size, which matters to a server encoding per request. A synchronous variant is out of scope; it would be a second export sharing the same code.
- **Errors reject, never throw.** Being an `async` function, a `TypeError` or `OXGL_CONTEXT_LOST` raised in the body rejects the returned promise, as WebIDL promise-returning operations do. Callers handle one failure path.
- **JS, not Rust.** The pixels already arrive in JS from the native read; the PNG framing is a few dozen lines, and deflate is Node's native zlib. A Rust encoder would add a PNG crate and a deflate crate to the license check and the addon on all five platforms, for no measured gain.
- **Encoder in `src/png.ts`, written like `conformance/png.mjs`'s.** It writes unfiltered scanlines with zlib's default level and uses `zlib.crc32` (Node 22.2 and later; oxgl requires 22.22.2) for chunk CRCs. Per-row filtering would shrink files, but it is an optimization the spec does not need; it can be added later without changing behavior. The runners keep their own encoder: they encode composed frames and OffscreenCanvas bitmaps from plain pixels, which `encodePNG(gl)` does not take, and exporting a pixels-in encoder only for them would widen the public API. The duplicate is about 30 lines of test code. Tests decode the output with `png.mjs`'s decoder.
- **`encodePNG` lives in `png.ts`, not `context.ts`.** The conformance runner inlines `src/context.ts` into its pages as source text, strips its imports and throws for imports it doesn't handle (`conformance/window.mjs`). `context.ts` therefore gains only import-free helpers: `isContext`, and a `contextPixels(gl)` that reads a context's drawing buffer as `canvasPixels` does for a canvas (`null` when lost or destroyed). `encodePNG` and its `node:zlib` import live in `png.ts`, which imports both, and `index.ts` re-exports it.
- **Error checks.** A value without the private context state is a `TypeError`. `#s` is private to the context class in `src/context.ts`, so the brand check is a small `isContext` helper assigned beside `contextState` in that class's static block (`#s in gl`), rather than letting `contextState`'s private-field read fail with an unclear message. A lost or destroyed context, where the read returns nothing, raises `codedError('OXGL_CONTEXT_LOST', …)`, the helper the other coded errors use. Resolving with an empty buffer was rejected: a 0×0 PNG is invalid (PNG §11.2.2), and a silent empty file is worse than an error for a call whose only purpose is output.
- **Name `encodePNG`.** Acronyms are upper case in web API names (`toDataURL`).
- **Declared as `Promise<Uint8Array>`.** It resolves with a `Buffer`, a `Uint8Array` subclass that `fs.writeFile` and HTTP responses accept, but the published declarations use only globals that either the DOM library or `@types/node` provides (`EventTarget`, `Event`), and no Node-only type (`@types/node` is a devDependency only). Declaring `Buffer`, which only `@types/node` has, would break consumers who type-check with the DOM library and without `@types/node`; callers who want `Buffer` methods can narrow, or wrap with `Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)` at no copy.

### Safety rules

No `unsafe`, FFI or native code changes. The native read copies the pixels into a new `Uint8Array` it owns before returning, so no pointer into a JS `ArrayBuffer` is retained, and the off-thread deflate works on that JS-owned copy, never on GL or addon memory. The encoder runs in JS and cannot panic the addon. Handle validity is unchanged: a destroyed or lost context is detected from the read's `null` result, as `canvasPixels` does, and destroying the context while the deflate runs is safe because the deflate holds only the copy.

## Risks / Trade-offs

- [Unfiltered PNGs are larger than a tuned encoder's] → Acceptable for screenshots and tests; filtering is an internal improvement for later.
- [Deflates share libuv's thread pool (4 threads by default) with `fs`, `dns.lookup` and `crypto`] → A server encoding several large frames at once can delay its file and DNS work behind them. The README notes `UV_THREADPOOL_SIZE` for that case; no mechanism is added.
- [The pixel copy is held until the promise settles] → One drawing buffer's worth of memory per pending call; a caller encoding many frames at once holds that many copies, as it would with its own `readPixels` buffers.
