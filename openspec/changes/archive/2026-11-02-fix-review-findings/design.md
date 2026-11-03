# Design

## Context

See proposal.md for the four defects. The code paths involved:

- The drawing buffer is an FBO. WebGL 2's `readBuffer(BACK|NONE)` on framebuffer null calls `glReadBuffer(COLOR_ATTACHMENT0|NONE)` on that FBO and records the WebGL value in `DrawingBuffer::read_buffer`. `drawing_buffer_rgba8` (used by `encodePNG` and by canvas `TexImageSource` uploads) binds the FBO as `READ_FRAMEBUFFER` and calls `begin_read`. `begin_read` skips the multisample resolve when `read_buffer` is `NONE`, and the following `glReadPixels` fails because the FBO's read buffer is `NONE`. Its error is discarded.
- `byteRange` in `src/context.ts` wraps every source in a `Uint8Array` so native code receives byte offsets. Constructing a typed array over a detached buffer throws. Native `ReadSource` already reports a detached buffer as zero bytes.
- `Context::renderbuffer_storage` and `Context::link_program` forward to ANGLE and then update oxgl state (the `DEPTH_STENCIL` flag; the `uniform_types` cache and, in TS, `linkCount`) without knowing whether ANGLE accepted the call.

## Goals / Non-Goals

**Goals:**
- Canvas readback reads color regardless of the page's read buffer, and leaves the page's read buffer, `READ_BUFFER` query and `readPixels` errors exactly as before.
- Detached sources take the existing native zero-byte path.
- oxgl state that mirrors a GL call changes only when GL accepted the call.

**Non-Goals:**
- Changing `readPixels` or `copyTex*` with `readBuffer(NONE)`. Both already generate the `INVALID_OPERATION` WebGL requires.
- Detached destinations (`readPixels` with `dstOffset`, `getBufferSubData`). See proposal.md.

## Decisions

**1. A color read that ignores the read buffer, on `DrawingBuffer`.** Add a `DrawingBuffer` pair beside `begin_read`/`end_read` for the canvas readback. If the recorded read buffer is `NONE`, it sets the FBO's GL read buffer to `COLOR_ATTACHMENT0`, then resolves as `begin_read` does but without the `NONE` early return (the resolve blit reads the FBO's read buffer too). `glReadBuffer` acts on whatever is bound to `READ_FRAMEBUFFER`, so the restore of `glReadBuffer(NONE)` happens at a fixed point:
- Multisampled: immediately after the resolve blit, while the draw FBO is still the read framebuffer, and before `READ_FRAMEBUFFER` moves to the resolve FBO. The reads then come from the resolve FBO, whose read buffer stays `COLOR_ATTACHMENT0`.
- Single-sampled: after the last read, while the draw FBO is still the read framebuffer, and before `drawing_buffer_rgba8` rebinds the page's read framebuffer.

Restoring anywhere else would set `NONE` on the resolve FBO, which no page call ever resets, and so would break every later read of an antialiased buffer. `drawing_buffer_rgba8` uses the pair; `read_pixels` and `copy_tex` keep `begin_read`. The pair acts only when the recorded read buffer is `NONE`, which only WebGL 2 can set, so a WebGL 1 context never calls `glReadBuffer`.
- *Alternative:* temporarily set the `read_buffer` cell to `BACK` around the existing calls. Rejected because it briefly breaks the invariant that the cell mirrors the page's choice, and it relies on call order.
- *Alternative:* a `bool` parameter on `begin_read`. Rejected because the restore also differs, so a separate pair is clearer.

**2. A detached source becomes an empty `Uint8Array` in TS.** `byteRange` checks the source's buffer (`ArrayBuffer.prototype.detached`, which Node ≥ 22 provides; a `SharedArrayBuffer` cannot be detached). The check reads the property through a structural cast, `(buffer as { detached?: unknown }).detached === true`, because `tsconfig.json`'s `lib` is ES2023, which does not declare it (ES2024 does). `lib` is not widened for this one property. For a detached buffer it returns `new Uint8Array(0)` with the same element-to-byte offsets. Native code then applies its usual range rules: offset 0 uploads zero bytes, and a larger offset generates `INVALID_VALUE`.
- *Alternative:* pass the original view to native code. Rejected because native offsets would then have to be in elements, which changes the binding for every call.

**3. One helper that reports whether a GL call raised an error.** Add a core helper: it drains pending GL errors into the synthesized error flags (`drain_into`, as `drawing_buffer_rgba8` already does), runs the call, then reads `glGetError`. A raised error is re-synthesized and the helper returns `false`; otherwise it returns `true`. `renderbuffer_storage` updates `depth_stencil` only on `true`. `link_program` returns the result and drops `uniform_types` only on `true`, so a rejected link keeps `getUniform`'s cache. The `linkProgram` binding returns that `bool` (`false` on a lost context), and TS increments `linkCount` only on `true`. A link that runs and fails (compile errors) raises no GL error, so it still counts as a link, as WebGL requires.
- *Alternative:* query `RENDERBUFFER_INTERNAL_FORMAT` after the call. Rejected because `DEPTH_STENCIL` and `DEPTH24_STENCIL8` share a GL format, so the query cannot tell the alias apart, and it does nothing for `linkProgram`.
- *Alternative:* have TS test for active transform feedback before `linkProgram`. Rejected because it duplicates ANGLE's validation and misses any other rejection.

**4. ABI.** The `linkProgram` export's return type changes, so `native_abi_version` (Rust) and `NATIVE_ABI_VERSION` (TS) go from 13 to 14.

**Safety rules.** No `unsafe` is added; every change is in `oxgl-core`, `oxgl-node` or TS. The new paths add no `unwrap`, `expect` or panics. Handles are untouched. The detached path holds no pointer into JS memory: TS passes a fresh empty array, and native `ReadSource` keeps its call-scoped borrow.

## Risks / Trade-offs

- [Draining GL errors before a call folds them into the synthesized flags, which `getError` returns in a fixed order rather than GL's order.] → This is already how `drawing_buffer_rgba8` and drawing-buffer allocation preserve page errors, and WebGL allows any order among pending error flags (WebGL 1.0 §5.14.3).
- [`ArrayBuffer.prototype.detached` is missing on a runtime older than the supported engines.] → The check reads `detached === true`, so an older runtime behaves as today; `engines` already requires Node ≥ 22.22.2.
- [The extra `glGetError` per `renderbufferStorage` and `linkProgram` call.] → Both calls are rare and heavy, so the extra query is negligible.
