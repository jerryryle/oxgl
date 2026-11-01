// Frames as three.js's end-to-end test sees them (its test/e2e/image.js):
// composited over the page, halved, and compared pixel by pixel with the
// reference screenshot. Images are RGBA8 `{ data, width, height }`, top row
// first.
import { createRequire } from 'node:module';

import { DEFAULT_TOLERANCE } from '../conformance/expectations.mjs';

export { DEFAULT_TOLERANCE };

/** A pixel differs when its RGB distance, as a fraction of the maximum, exceeds this. */
export const PIXEL_THRESHOLD = 0.1;

/**
 * A CSS color as `{ r, g, b, a }` (0–255, alpha 0–1) from the `rgb()` or
 * `rgba()` form `getComputedStyle` gives, or `undefined`.
 */
export function parseColor(css) {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(String(css).trim());
  if (match === null) return undefined;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

/**
 * An unpremultiplied frame composited over the page's background color
 * (itself over white, as a browser's canvas area shows a transparent page).
 */
export function composite({ data, width, height }, background) {
  const page = parseColor(background) ?? { r: 255, g: 255, b: 255, a: 0 };
  const over = (channel) => channel * page.a + 255 * (1 - page.a);
  const bg = [over(page.r), over(page.g), over(page.b)];
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(data[i + c] * a + bg[c] * (1 - a));
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/** An image halved in each dimension by averaging 2×2 blocks, as upstream's `scale(1 / 2)`. */
export function halve({ data, width, height }) {
  const w = Math.round(width / 2);
  const h = Math.round(height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let count = 0;
        for (let sy = 2 * y; sy < Math.min(2 * y + 2, height); sy++) {
          for (let sx = 2 * x; sx < Math.min(2 * x + 2, width); sx++) {
            sum += data[(sy * width + sx) * 4 + c];
            count += 1;
          }
        }
        out[(y * w + x) * 4 + c] = Math.round(sum / count);
      }
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Compares `actual` with `expected` as upstream does. Returns
 * `{ percent, diff }`: the share of differing pixels, and an image marking
 * them red over a dimmed `actual`. `undefined` when the sizes differ.
 */
export function compare(actual, expected) {
  if (actual.width !== expected.width || actual.height !== expected.height) return undefined;
  const maxDelta = 255 * 255 * 3;
  const diff = new Uint8ClampedArray(actual.data.length);
  let differing = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    const dr = actual.data[i] - expected.data[i];
    const dg = actual.data[i + 1] - expected.data[i + 1];
    const db = actual.data[i + 2] - expected.data[i + 2];
    if ((dr * dr + dg * dg + db * db) / maxDelta > PIXEL_THRESHOLD * PIXEL_THRESHOLD) {
      differing += 1;
      diff.set([255, 0, 0, 255], i);
    } else {
      diff.set([actual.data[i] * 0.2, actual.data[i + 1] * 0.2, actual.data[i + 2] * 0.2, 255], i);
    }
  }
  return { percent: (differing / (actual.width * actual.height)) * 100, diff: { data: diff, width: actual.width, height: actual.height } };
}

/** Whether a difference of `percent` matches a `tolerance` (in percent): the tolerance itself matches. */
export function matches(percent, tolerance = DEFAULT_TOLERANCE) {
  return percent <= tolerance;
}

/** A JPEG's pixels, decoded by the `canvas` package, or `undefined`. */
export async function decodeJpeg(bytes) {
  const { Image, createCanvas } = createRequire(import.meta.url)('canvas');
  const image = new Image();
  try {
    image.src = bytes;
    // The package decodes after the source is set.
    await image.decode();
  } catch {
    return undefined;
  }
  if (!(image.width > 0 && image.height > 0)) return undefined;
  const context = createCanvas(image.width, image.height).getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { data, width: image.width, height: image.height };
}
