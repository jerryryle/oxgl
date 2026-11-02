// A context's drawing buffer as a PNG. Kept out of context.ts, which the
// conformance runner inlines into its pages without imports.
import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';

import { codedError, contextPixels, isContext } from './context.js';
import type { WebGL2RenderingContext, WebGLRenderingContext } from './context.js';

const deflateAsync = promisify(deflate);

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * A PNG of `gl`'s drawing buffer: 8-bit RGBA, unpremultiplied, top row
 * first, as `toDataURL('image/png')` serializes a canvas. The pixels are
 * read during the call; only compression runs later, on libuv's thread pool.
 * Resolves with a `Buffer`, declared as `Uint8Array` so these declarations
 * need no Node types.
 */
export async function encodePNG(gl: WebGLRenderingContext | WebGL2RenderingContext): Promise<Uint8Array> {
  if (!isContext(gl)) throw new TypeError("Failed to execute 'encodePNG': parameter 1 is not a WebGL context.");
  const pixels = contextPixels(gl);
  if (pixels === null) throw codedError('OXGL_CONTEXT_LOST', 'oxgl: encodePNG on a lost or destroyed context');
  const { data, width, height } = pixels;
  // Each scanline is a filter byte (0, none) then its RGBA samples (PNG §9.2).
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, color type 6 (RGBA), deflate, adaptive filtering, no interlace (PNG §11.2.2).
  header.set([8, 6, 0, 0, 0], 8);
  const compressed = await deflateAsync(rows);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

/** A PNG chunk: length, type, body and the CRC of type and body (PNG §5.3). */
function chunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const framed = Buffer.alloc(typed.length + 8);
  framed.writeUInt32BE(body.length, 0);
  typed.copy(framed, 4);
  framed.writeUInt32BE(crc32(typed), typed.length + 4);
  return framed;
}
