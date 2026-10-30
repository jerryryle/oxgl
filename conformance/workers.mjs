// Dedicated workers for classic scripts (HTML §10.2.6) on Node worker
// threads, for the runner's pages and for workers they start. A worker has
// the globals the suite's worker scripts use: messages, Blob URLs, nested
// workers, OffscreenCanvas with oxgl's WebGL, and importScripts of the
// suite's own files. ImageBitmaps cross threads as their pixels.
import { resolveObjectURL } from 'node:buffer';
import { appendFileSync, readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { parentPort, Worker as ThreadWorker, workerData } from 'node:worker_threads';

import { bitmapPixels, imageBitmapClass, offscreenCanvasClass } from './offscreen.mjs';
import { resolveFile } from './server.mjs';

/** A thread's first code: loads this module and runs the worker's script. */
const PRELUDE = `import(${JSON.stringify(import.meta.url)}).then((m) => m.runWorker());`;

/** Marks an ImageBitmap's pixels in a message. */
const BITMAP = '__oxglImageBitmap';

/**
 * A message's value with each ImageBitmap replaced by its pixels, and its
 * transfer list without the bitmaps, which threads cannot transfer.
 */
export function encodeMessage(value, transfer = []) {
  const encode = (item) => {
    if (typeof item !== 'object' || item === null) return item;
    const pixels = bitmapPixels.get(item);
    if (pixels !== undefined) return { [BITMAP]: { data: pixels.data, width: pixels.width, height: pixels.height } };
    if (Array.isArray(item)) return item.map(encode);
    if (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      return Object.fromEntries(Object.entries(item).map(([key, v]) => [key, encode(v)]));
    }
    return item;
  };
  return [encode(value), Array.from(transfer ?? []).filter((item) => !bitmapPixels.has(item))];
}

/** A received message's value with bitmap pixels made into `ImageBitmap`s. */
export function decodeMessage(value, ImageBitmap) {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.hasOwn(value, BITMAP)) return new ImageBitmap(value[BITMAP]);
  if (Array.isArray(value)) return value.map((item) => decodeMessage(item, ImageBitmap));
  if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = decodeMessage(value[key], ImageBitmap);
  }
  return value;
}

/** A worker script's source, from a URL or a Blob URL this process made. */
async function workerSource(href) {
  if (href.startsWith('blob:')) {
    const blob = resolveObjectURL(href);
    if (blob === undefined) throw new Error(`${href}: no such Blob URL`);
    return blob.text();
  }
  const response = await fetch(href);
  if (!response.ok) throw new Error(`${href}: HTTP ${String(response.status)}`);
  return response.text();
}

/**
 * A `Worker` class for a realm. `realm` gives its EventTarget, a
 * `messageEvent(data)` and `errorEvent(message)` maker, `base()` for
 * resolving script URLs, `receive(data)`, which rebuilds a message in the
 * realm, and `root`, the directory the suite is served from.
 */
export function workerClass(realm) {
  return class Worker extends realm.EventTarget {
    onmessage = null;
    onerror = null;
    #thread;
    #queue = [];
    #terminated = false;

    constructor(url) {
      super();
      const href = new URL(String(url), realm.base()).href;
      workerSource(href)
        .then((source) => {
          if (this.#terminated) return;
          this.#thread = new ThreadWorker(PRELUDE, { eval: true, workerData: { source, url: href, root: realm.root } });
          this.#thread.unref();
          this.#thread.on('message', (data) => this.#fire('message', realm.messageEvent(realm.receive(data))));
          this.#thread.on('error', (error) => {
            // A debugging aid, as for the page's own failures.
            const trace = process.env.OXGL_CONFORMANCE_TRACE;
            if (trace) appendFileSync(trace, `WORKER ERROR ${href}: ${String(error?.stack ?? error)}\n`);
            this.#fire('error', realm.errorEvent(String(error?.message ?? error)));
          });
          for (const [data, transfer] of this.#queue) this.#thread.postMessage(data, transfer);
          this.#queue = [];
        })
        .catch((error) => this.#fire('error', realm.errorEvent(String(error?.message ?? error))));
    }

    postMessage(data, transfer = []) {
      if (this.#terminated) return;
      const [value, list] = encodeMessage(data, transfer);
      if (this.#thread === undefined) this.#queue.push([structuredClone(value, { transfer: list }), []]);
      else this.#thread.postMessage(value, list);
    }

    terminate() {
      this.#terminated = true;
      void this.#thread?.terminate();
    }

    #fire(type, event) {
      const handler = type === 'message' ? this.onmessage : this.onerror;
      if (typeof handler === 'function') handler.call(this, event);
      this.dispatchEvent(event);
    }
  };
}

/** ImageData in workers: RGBA8 pixels and their size (HTML §4.12.5.1.15). */
class ImageData {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
}

/** Runs in a worker thread: installs the worker globals, then the script. */
export async function runWorker() {
  const oxgl = await import('../dist/context.js');
  const self = globalThis;
  const ImageBitmap = imageBitmapClass();
  self.self = self;
  for (const [name, value] of Object.entries(await import('../dist/index.js'))) {
    if (name.startsWith('WebGL')) self[name] = value;
  }
  self.ImageData = ImageData;
  // Dedicated workers have animation frames (HTML §8.10.1).
  self.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
  self.cancelAnimationFrame = (handle) => clearTimeout(handle);
  self.ImageBitmap = ImageBitmap;
  self.OffscreenCanvas = offscreenCanvasClass(globalThis, oxgl, ImageBitmap);
  oxgl.setImageDecoder((source) => bitmapPixels.get(source));
  self.Worker = workerClass({
    EventTarget,
    messageEvent: (data) => new MessageEvent('message', { data }),
    // Node has no ErrorEvent.
    errorEvent: (message) => Object.assign(new Event('error'), { message }),
    base: () => workerData.url,
    receive: (data) => decodeMessage(data, ImageBitmap),
    root: workerData.root,
  });
  const listeners = [];
  self.postMessage = (data, transfer) => parentPort.postMessage(...encodeMessage(data, transfer));
  self.close = () => parentPort.close();
  self.addEventListener = (type, listener) => {
    if (type === 'message') listeners.push(listener);
  };
  // Synchronous, as in browsers: the suite's scripts are read from disk.
  self.importScripts = (...urls) => {
    for (const url of urls) {
      const href = new URL(String(url), workerData.url).href;
      const file = workerData.root === undefined ? undefined : resolveFile(workerData.root, href);
      if (file === undefined) throw new Error(`importScripts: ${href} is not one of the suite's files`);
      runInThisContext(readFileSync(file, 'utf8'), { filename: href });
    }
  };
  parentPort.on('message', (data) => {
    const event = { type: 'message', data: decodeMessage(data, ImageBitmap) };
    if (typeof self.onmessage === 'function') self.onmessage(event);
    for (const listener of listeners) listener(event);
  });
  runInThisContext(workerData.source, { filename: workerData.url });
}
