// OffscreenCanvas and ImageBitmap for the runner's pages and their workers
// (HTML §4.12.5.3, §8.10). WebGL contexts are oxgl's; 2D ones the canvas
// package's. An ImageBitmap holds its pixels as browsers upload them.
import { createRequire } from 'node:module';

import { encodePng } from './png.mjs';

const WEBGL_TYPES = { webgl: 1, 'experimental-webgl': 1, webgl2: 2 };

/** ImageBitmaps' pixels, `{ data, width, height, asIs: true }`, by bitmap. */
export const bitmapPixels = new WeakMap();

/** An ImageBitmap class for a realm. */
export function imageBitmapClass() {
  return class ImageBitmap {
    #width;
    #height;
    constructor(pixels) {
      this.#width = pixels.width;
      this.#height = pixels.height;
      bitmapPixels.set(this, { data: pixels.data, width: pixels.width, height: pixels.height, asIs: true });
    }
    get width() {
      return this.#width;
    }
    get height() {
      return this.#height;
    }
    close() {
      this.#width = 0;
      this.#height = 0;
      bitmapPixels.set(this, { data: new Uint8ClampedArray(0), width: 0, height: 0, asIs: true });
    }
  };
}

/**
 * An OffscreenCanvas class for a realm: `globals` gives its EventTarget,
 * TypeError, DOMException and Blob; `oxgl` is the JS layer (createContext,
 * canvasPixels, presentDrawingBuffer); `ImageBitmap` is the realm's class;
 * `onContext(canvas, context)`, when given, hears of each WebGL context.
 * `transferToImageBitmap` takes the drawing buffer's pixels and clears it;
 * `convertToBlob` writes a PNG.
 */
export function offscreenCanvasClass(globals, oxgl, ImageBitmap, onContext = () => {}) {
  const { EventTarget, TypeError, DOMException, Blob } = globals;
  const { createContext, canvasPixels, presentDrawingBuffer } = oxgl;
  const size = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
      throw new TypeError("Value is outside the 'unsigned long long' value range.");
    }
    return Math.trunc(n);
  };
  return class OffscreenCanvas extends EventTarget {
    #width;
    #height;
    #type;
    #context = null;
    #canvas2d;

    constructor(width, height) {
      super();
      if (arguments.length < 2) {
        throw new TypeError(`Failed to construct 'OffscreenCanvas': 2 arguments required, but only ${arguments.length} present.`);
      }
      this.#width = size(width);
      this.#height = size(height);
    }

    get width() {
      return this.#canvas2d?.width ?? this.#width;
    }

    set width(value) {
      this.#width = size(value);
      this.#resized();
    }

    get height() {
      return this.#canvas2d?.height ?? this.#height;
    }

    set height(value) {
      this.#height = size(value);
      this.#resized();
    }

    #resized() {
      if (this.#canvas2d !== undefined) {
        this.#canvas2d.width = this.#width;
        this.#canvas2d.height = this.#height;
      } else {
        this.#context?.resize(this.#width, this.#height);
      }
    }

    getContext(type, attributes) {
      const name = String(type);
      const version = WEBGL_TYPES[name];
      if (version === undefined && name !== '2d') {
        throw new TypeError(`Failed to execute 'getContext' on 'OffscreenCanvas': The provided value '${name}' is not a valid enum value of type OffscreenRenderingContextType.`);
      }
      const kind = version === undefined ? '2d' : `webgl${String(version)}`;
      if (this.#type !== undefined) return this.#type === kind ? this.#context : null;
      if (version === undefined) {
        this.#canvas2d = createRequire(import.meta.url)('canvas').createCanvas(this.#width, this.#height);
        this.#context = this.#canvas2d.getContext('2d');
        // The context's canvas is this one, as pages resize it through it.
        Object.defineProperty(this.#context, 'canvas', { value: this, configurable: true });
      } else {
        try {
          this.#context = createContext({ width: this.#width, height: this.#height, webgl2: version === 2, canvas: this, attributes });
        } catch {
          return null;
        }
        onContext(this, this.#context);
      }
      this.#type = kind;
      return this.#context;
    }

    #pixels() {
      if (this.#canvas2d === undefined) return canvasPixels(this);
      const { width, height } = this.#canvas2d;
      return { data: this.#context.getImageData(0, 0, width, height).data, width, height };
    }

    transferToImageBitmap() {
      if (this.#type === undefined) throw new DOMException('The OffscreenCanvas has no rendering context.', 'InvalidStateError');
      const bitmap = new ImageBitmap(this.#pixels());
      // The canvas gets a new, cleared drawing buffer (HTML §4.12.5.3.1).
      if (this.#canvas2d !== undefined) this.#context.clearRect(0, 0, this.#canvas2d.width, this.#canvas2d.height);
      else presentDrawingBuffer(this.#context, true);
      return bitmap;
    }

    async convertToBlob() {
      const pixels = this.#pixels();
      if (pixels === undefined || pixels.width === 0 || pixels.height === 0) {
        throw new DOMException('The OffscreenCanvas has no pixels.', 'IndexSizeError');
      }
      return new Blob([encodePng(pixels)], { type: 'image/png' });
    }
  };
}
