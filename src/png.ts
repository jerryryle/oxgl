// A context's drawing buffer as a PNG. Kept out of context.ts, which the
// conformance runner inlines into its pages without imports.
import { pipeline } from 'node:stream/promises';
import { createDeflate, crc32 } from 'node:zlib';

import { codedError, contextPixels, isContext } from './context.js';
import type { WebGL2RenderingContext, WebGLRenderingContext } from './context.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Bytes of filtered scanlines per deflate write.
const BAND_BYTES = 1 << 20;

/**
 * A PNG of `gl`'s drawing buffer: 8-bit RGBA, unpremultiplied, top row
 * first, as `toDataURL('image/png')` serializes a canvas. The pixels are
 * read during the call; only compression runs later, on libuv's thread pool.
 * A `"display-p3"` drawing buffer's PNG carries a `cICP` chunk saying so.
 * Resolves with a `Buffer`, declared as `Uint8Array` so these declarations
 * need no Node types.
 */
export async function encodePNG(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<Uint8Array> {
  if (!isContext(gl)) throw new TypeError("Failed to execute 'encodePNG': parameter 1 is not a WebGL context.");
  const pixels = contextPixels(gl);
  if (pixels === null) throw codedError('OXGL_CONTEXT_LOST', 'oxgl: encodePNG on a lost or destroyed context');
  const { data, width, height, colorSpace } = pixels;
  // Each scanline is a filter byte (0, none) then its RGBA samples (PNG §9.2).
  // They go to deflate in bands of about BAND_BYTES as it takes them, so the
  // filtered copy never holds the whole image.
  const stride = width * 4;
  const bandRows = Math.max(1, Math.floor(BAND_BYTES / (stride + 1)));
  const parts: Buffer[] = [];
  await pipeline(
    function* bands() {
      for (let y0 = 0; y0 < height; y0 += bandRows) {
        const rows = Math.min(bandRows, height - y0);
        const band = Buffer.alloc((stride + 1) * rows);
        for (let y = 0; y < rows; y++) band.set(data.subarray((y0 + y) * stride, (y0 + y + 1) * stride), y * (stride + 1) + 1);
        yield band;
      }
    },
    createDeflate(),
    async (compressed: AsyncIterable<Buffer>) => {
      for await (const part of compressed) parts.push(part);
    },
  );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, color type 6 (RGBA), deflate, adaptive filtering, no interlace (PNG §11.2.2).
  header.set([8, 6, 0, 0, 0], 8);
  // Display P3 primaries, the sRGB transfer function, RGB, full range: the
  // cICP chunk of PNG (Third Edition), before IDAT. sRGB needs no chunk.
  const space = colorSpace === 'display-p3' ? chunk('cICP', [Buffer.from([12, 13, 0, 1])]) : [];
  // The compressed parts are copied once, into the result.
  return Buffer.concat([SIGNATURE, ...chunk('IHDR', [header]), ...space, ...chunk('IDAT', parts), ...chunk('IEND', [])]);
}

/**
 * A PNG chunk as its pieces: length and type, the body's parts uncopied, and
 * the CRC of type and body (PNG §5.3).
 */
function chunk(type: string, body: Buffer[]): Buffer[] {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.reduce((length, part) => length + part.length, 0), 0);
  head.write(type, 4, 'latin1');
  const crc = body.reduce((value, part) => crc32(part, value), crc32(head.subarray(4)));
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc, 0);
  return [head, ...body, tail];
}
