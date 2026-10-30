// PNG decoding and encoding as browsers do it for WebGL: decoded pixels are
// unpremultiplied RGBA8 (RGBA16 for 16-bit images, which keep their
// precision) with gamma (gAMA) and color profiles (iCCP, sRGB, cHRM)
// ignored; encoding writes
// unpremultiplied RGBA8 as is. The canvas package premultiplies, and applies
// gamma, which a WebGL upload from an image does not.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Whether `bytes` start with the PNG signature. */
export function isPng(bytes) {
  return bytes.length >= 8 && SIGNATURE.equals(bytes.subarray(0, 8));
}

/** Samples per pixel for each color type (PNG §6.1). */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7 passes: x start, y start, x step, y step (PNG §8.2). */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * Decodes a PNG to `{ data, width, height }`, top row first: a
 * Uint8ClampedArray of RGBA8, or a Uint16Array of RGBA16 for a 16-bit image.
 * `undefined` for data it cannot decode.
 */
export function decodePng(bytes) {
  if (!isPng(bytes)) return undefined;
  let header;
  let palette;
  let transparency;
  const compressed = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlaced: body[12] === 1,
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') compressed.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = header && CHANNELS[header.colorType];
  if (channels === undefined || compressed.length === 0) return undefined;
  const { width, height, depth, colorType } = header;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(compressed));
  } catch {
    return undefined;
  }
  const bitsPerPixel = channels * depth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const wide = depth === 16;
  const out = wide ? new Uint16Array(width * height * 4) : new Uint8ClampedArray(width * height * 4);
  const max = 2 ** depth - 1;
  const full = wide ? 65535 : 255;
  // Samples scaled to the output's range; palette entries are 8-bit.
  const scale = (v) => (depth === 8 || wide ? v : Math.round((v * 255) / max));
  // tRNS for gray and truecolor names one transparent sample value.
  const key = transparency && colorType === 0 ? [transparency.readUInt16BE(0)] : transparency && colorType === 2 ? [0, 2, 4].map((o) => transparency.readUInt16BE(o)) : undefined;

  const store = (x, y, samples) => {
    const o = (y * width + x) * 4;
    let rgba;
    if (colorType === 3) {
      const i = samples[0];
      rgba = [palette?.[i * 3] ?? 0, palette?.[i * 3 + 1] ?? 0, palette?.[i * 3 + 2] ?? 0, transparency?.[i] ?? full];
    } else {
      const gray = colorType === 0 || colorType === 4;
      const [r, g, b] = gray ? [samples[0], samples[0], samples[0]] : samples;
      const transparent = key !== undefined && (gray ? samples[0] === key[0] : samples.slice(0, 3).every((s, c) => s === key[c]));
      const alpha = colorType === 4 ? scale(samples[1]) : colorType === 6 ? scale(samples[3]) : transparent ? 0 : full;
      rgba = [scale(r), scale(g), scale(b), alpha];
    }
    out.set(rgba, o);
  };

  let offset = 0;
  const pass = (x0, y0, dx, dy) => {
    const columns = Math.ceil((width - x0) / dx);
    const rows = Math.ceil((height - y0) / dy);
    if (columns <= 0 || rows <= 0) return true;
    const stride = Math.ceil((columns * bitsPerPixel) / 8);
    let previous = new Uint8Array(stride);
    for (let row = 0; row < rows; row++) {
      if (offset + 1 + stride > raw.length) return false;
      const filter = raw[offset];
      const line = Uint8Array.from(raw.subarray(offset + 1, offset + 1 + stride));
      offset += 1 + stride;
      unfilter(filter, line, previous, bytesPerPixel);
      for (let column = 0; column < columns; column++) {
        store(x0 + column * dx, y0 + row * dy, samplesAt(line, column, channels, depth));
      }
      previous = line;
    }
    return true;
  };
  const passes = header.interlaced ? ADAM7 : [[0, 0, 1, 1]];
  for (const p of passes) if (!pass(...p)) return undefined;
  return { data: out, width, height };
}

/** Reverses a scanline's filter in place (PNG §9.2). */
function unfilter(filter, line, previous, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = previous[i];
    const c = i >= bpp ? previous[i - bpp] : 0;
    let add = 0;
    if (filter === 1) add = a;
    else if (filter === 2) add = b;
    else if (filter === 3) add = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    line[i] = (line[i] + add) & 0xff;
  }
}

/** The samples of pixel `column` in an unfiltered scanline. */
function samplesAt(line, column, channels, depth) {
  const samples = [];
  for (let c = 0; c < channels; c++) {
    const index = column * channels + c;
    if (depth === 16) samples.push((line[index * 2] << 8) | line[index * 2 + 1]);
    else if (depth === 8) samples.push(line[index]);
    else {
      const bit = index * depth;
      samples.push((line[bit >> 3] >> (8 - depth - (bit & 7))) & (2 ** depth - 1));
    }
  }
  return samples;
}

/** Encodes RGBA8 pixels, top row first, as a PNG without filtering. */
export function encodePng({ data, width, height }) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
