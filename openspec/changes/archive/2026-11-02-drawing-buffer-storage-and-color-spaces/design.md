# Design

## Context

See proposal.md (Why). What exists today:
- **The drawing buffer** (`crates/oxgl-core/src/drawing_buffer.rs`) is a framebuffer with a color renderbuffer, a depth/stencil renderbuffer, and a single-sample resolve framebuffer when antialiased. `try_allocate` picks `RGBA8` or `RGB8` from `alpha` and nothing else. Allocation falls back to fewer samples and then smaller sizes.
- **`readPixels`** is validated by ANGLE against the framebuffer's real format. So once the color renderbuffer is `RGBA16F`, `RGBA`/`FLOAT` reads work with no oxgl change.
- **`drawing_buffer_rgba8`** (`textures.rs`), which backs `encodePNG` and canvas uploads, always reads `RGBA`/`UNSIGNED_BYTE`. That isn't a valid read of a float buffer.
- **`TexImageSource` uploads** go through `imagePixels` in `src/context.ts`, then `native.texUpload` with RGBA8 or RGBA16 pixels. The native side applies the unpack state, flip and premultiply, where `UNPACK_COLORSPACE_CONVERSION_WEBGL` is stored but unused today.

## Goals / Non-Goals

**Goals:**
- The four members behave as WebGL 1.0 §2.2 and §5.14.1 describe, and pass `drawingbuffer-storage-test.html` and the Display P3 cases of the video upload pages.
- Color-space conversion costs nothing when the source and target color spaces match, which is the default.

**Non-Goals:**
- Displaying anything. A headless buffer is never composited, so `drawingBufferColorSpace` affects only encoding and uploads.

## Decisions

**The drawing buffer stores its color format.** `DrawingBuffer` gains a `color_format` field. It is set to `RGBA8` or `RGB8` at creation, and `try_allocate` uses it in place of the constant. A new `DrawingBuffer::storage(format, width, height, errors)` sets the format and reallocates through the existing `allocate`, so storage gets the same fallbacks (fewer samples, then smaller sizes) and the same clear as a resize. It always reallocates, even at the current size, because the format can change. It also records the stored size as `size_request`, so a later resize to the canvas's size, even the size it had before, compares against the buffer's actual size and reallocates. `resize` keeps `color_format`. A restored context builds a new `DrawingBuffer`, so its format starts over as the spec requires.

**The context validates the call, the drawing buffer allocates.** `Context::drawing_buffer_storage` checks, in this order:
1. `alpha: false` generates `INVALID_OPERATION`.
2. The format must be in the accepted set, or it generates `INVALID_ENUM`:
   - `RGBA8`;
   - `SRGB8_ALPHA8` on WebGL 2, or when `EXT_sRGB` is enabled;
   - `RGBA16F` when `EXT_color_buffer_float` or `EXT_color_buffer_half_float` is enabled.

   The context already tracks enabled extensions.
3. Width and height must be within `0..=MAX_RENDERBUFFER_SIZE`, or it generates `INVALID_VALUE`.

Only then does it call `DrawingBuffer::storage`. Sizes between `MAX_VIEWPORT_DIMS` and `MAX_RENDERBUFFER_SIZE` are clamped as a resize clamps them. Like a resize, a size of 0 gives 1.

Alternative considered: letting ANGLE's own `renderbufferStorage` validation decide. That doesn't work, because `allocate` discards errors and treats a failure as a reason to fall back. A rejected format would quietly turn into a smaller `RGBA8` buffer.

**Drawing-buffer allocations have a byte budget.** Each allocation attempt counts the bytes of its color, depth/stencil and resolve renderbuffers, across all samples. An attempt over 1 GiB is skipped as a failed attempt would be, so `allocate` falls back to single sampling and then to smaller sizes. This turns the test-only `byte_cap` into a real limit.

The conformance test asks for 8192×8192 with antialiasing and depth on. Without a budget, that would be about 2.4 GB per context under SwiftShader, and both suites run the page at once. With the budget, it becomes an 8192×8192 single-sampled buffer of about 0.5 GB. The spec allows any smaller buffer (WebGL 1.0 §2.2), and an application that asks for a giant antialiased buffer gets single sampling, as a GPU without the memory would give it. Measured on macOS arm64 with SwiftShader, for `drawingBufferStorage(RGBA8, 8192, 8192)` on a default context:
- **With the budget:** WebGL 1 and WebGL 2 both get an 8192×8192 single-sampled buffer. The call takes under 15 ms, because SwiftShader commits memory lazily, and the process peaks at 632 MB of resident memory.
- **Without it:** the 4-sample attempt makes SwiftShader fail in a way that loses the context, instead of an allocation failure the fallback can handle. Afterwards `getParameter` returns `null` and the size stays 16×16.

So the budget also prevents a lost context, not just excess memory. With 1 GiB, the conformance page's request succeeds. Larger budgets weren't measured.

**The RGBA8 readback reads a float buffer as floats.** For an `RGBA16F` drawing buffer, `drawing_buffer_rgba8` reads `RGBA`/`FLOAT` into an `f32` staging buffer, a band of rows (at most 16 MiB) at a time so the staging stays small next to the 8-bit result, then clamps each value to `[0, 1]` and rounds `v × 255`. Other formats keep the `UNSIGNED_BYTE` read. For `SRGB8_ALPHA8` that read returns the stored, sRGB-encoded bytes, which is what `encodePNG` and the conformance test expect. A premultiplied `RGBA16F` buffer is unpremultiplied while its values are still floats, before rounding, so low alphas keep their precision. `RGBA8` and `SRGB8_ALPHA8` keep the existing byte step; for `SRGB8_ALPHA8` that divides the encoded values, which is what Khronos `drawingbuffer-storage-test.html` ("Drawing transparent SRGB8_ALPHA8 to canvas") expects.

**The color spaces live in JavaScript state, and conversion is native.**
- `ContextState` gains `drawingBufferColorSpace` and `unpackColorSpace`.
- The setters run WebIDL's enumeration conversion: `ToString`, then ignore any value other than `"srgb"` or `"display-p3"`.
- A change of `drawingBufferColorSpace` calls a new `native.reallocate(index, version)`, which reallocates at the current size and format and clears. Nothing happens on a lost or destroyed context, where the setter only stores the value. Both color spaces live on `ContextState`, which a restore keeps, so they survive a loss. `drawingBufferStorage` on a lost or destroyed context returns before calling native code, as other calls do.
- `imagePixels` returns a `colorSpace` alongside the pixels: the `ImageData`-shaped object's `colorSpace` when valid, the source context's `drawingBufferColorSpace` for an oxgl canvas, otherwise `"srgb"`.
- `native.texUpload` gains source and target color-space arguments, 0 for sRGB and 1 for Display P3.

**Conversion is a small safe-Rust module.** `oxgl-core/src/color.rs` converts RGBA8 and RGBA16 pixel data in place between sRGB and Display P3:
1. Decode each color channel with the sRGB transfer function, which both color spaces use (a 256-entry table for 8-bit, direct evaluation for 16-bit).
2. Multiply by the 3×3 linear matrix between the two sets of primaries, with D65 white for both (the matrices in CSS Color Module Level 4's sample conversion code).
3. Clamp to `[0, 1]`, re-encode and round.

Alpha is untouched, and conversion runs on unpremultiplied values. `texUpload` runs it when `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `BROWSER_DEFAULT_WEBGL` and the two color spaces differ, before flip, premultiply and the format conversion (WebGL 1.0 §5.14.8: "First, ... converted to the color space specified by `unpackColorSpace`"). For sRGB red this gives `[234, 51, 35]`, the value the conformance pages expect.

Alternative considered: converting in JavaScript before `texUpload`. It is the same arithmetic, but slower on large images, and it would need the unpack flag from native state.

**`encodePNG` tags Display P3 with `cICP`.** `png.ts` writes a 4-byte `cICP` chunk, `[12, 13, 0, 1]`, after `IHDR` when the context's `drawingBufferColorSpace` is `"display-p3"`. That is shorter than embedding an ICC profile, and browsers read it. An sRGB PNG stays byte-identical to today's.

**Declarations.** `src/context.ts` declares:
- `drawingBufferFormat: GLenum` (read-only);
- `drawingBufferColorSpace` and `unpackColorSpace` as `PredefinedColorSpace`;
- `drawingBufferStorage(sizedFormat, width, height): void`.

The package exports `type PredefinedColorSpace = 'srgb' | 'display-p3'`, so the declarations still need no DOM lib. `drawingBufferFormat` reads a JavaScript cache, set at creation, after `drawingBufferStorage`, and on restore, so it needs no native call.

## Safety rules

- **No `unsafe`.** The new native code is safe Rust in `oxgl-core` and `oxgl-node`. Conversion takes slices and walks them in chunks of four, so it has no indexing that can panic.
- **No panics.** Format and size failures map to WebGL errors. A failed allocation falls back as a resize does.
- **No retained `ArrayBuffer` pointers.** Upload pixels are already copied into Rust-owned buffers before conversion.
- **Handle model unchanged.** The drawing buffer stays owned by its context.

## Risks / Trade-offs

- [Decoded images, videos and 2D canvases are treated as sRGB] → They have no color space oxgl can read: the conformance runner ignores ICC profiles, and Node 2D canvases are sRGB. The Display P3 video cases expect exactly this conversion from sRGB.
- [The conformance runner composites a Display P3 WebGL canvas into its 2D canvases unconverted] → No conformance page draws a Display P3 WebGL canvas into a 2D canvas, and `canvasPixels` can gain a color space later if one does.
- [The P3 video cases tolerate ±6 per channel, and 8-bit to linear to 8-bit conversion rounds twice] → A Rust unit test pins the known red and green values to within one unit.
- [`ImageBitmap` pixels (`asIs` uploads) may already be premultiplied, and conversion treats them as straight] → They are converted like other sources, and translucent pixels of a premultiplied bitmap can be off by a few units, as the textures spec's accepted trade-off says. Tracking each bitmap's premultiplication through the upload would cost a new field for a case no conformance page or known use exercises.
- [The 1 GiB budget lowers quality for large antialiased buffers] → With 4 samples and depth, the color, depth and resolve buffers take about 36 bytes per pixel. Antialiased buffers above about 29.8 million pixels, roughly 5460×5460, lose multisampling; that includes 8K UHD (7680×4320). Single-sampled buffers up to 8192×8192 fit, including `RGBA16F`. Task 1.1's measurements can justify a larger budget if CI memory allows.
- [`RGBA16F` support depends on SwiftShader rendering to half-float multisampled renderbuffers] → If a multisampled allocation fails, `allocate` falls back to single sampling, as a resize does.
- [The budget bounds the drawing buffer, not a readback of it] → `encodePNG` and an upload of the canvas hold the 8-bit pixels (4 bytes a pixel) beside the buffer. Half-float floats are staged in bands and rows are flipped in place, and `encodePNG` filters and deflates its scanlines in 1 MiB bands, so neither adds another full-size copy. The compressed parts are copied once, into the returned PNG. Measured on macOS arm64 at 8192×8192, `encodePNG` of a flat image brings the process to about 0.7–1.2 GB, against 1.1–2.9 GB with whole-image staging. Noise, which barely compresses (a 207 MB PNG), peaks at 1.3 GB, against 1.85 GB.

## Migration Plan

None. The change only adds members and conversion. Existing code that never sets the new members behaves as before, and sRGB-to-sRGB uploads are untouched.
