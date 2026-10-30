// Runs one conformance page in a jsdom window and reports it to the parent
// over IPC, then exits. Usage (from the parent): fork(page.mjs, [url, options])
// where options is JSON: { endEarly: boolean, root?: string }, root being the
// directory the parent serves.
//
// Messages: { type: 'error', message } at the page's first escaped error;
// { type: 'counts', passed, failed } as results arrive (throttled);
// { type: 'outcome', ... } once the page completes or, when it ends early on
// errors, at that first error; { type: 'harness-error', message } when the
// runner itself fails. A page that never completes sends
// nothing: the parent's time limit decides it.
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';

import jsdom from 'jsdom';

import { native } from '../dist/native.js';

import { bitmapPixels, imageBitmapClass, offscreenCanvasClass } from './offscreen.mjs';
import { decodePng, encodePng } from './png.mjs';
import { resolveFile } from './server.mjs';
import { decodeMessage, workerClass } from './workers.mjs';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const CONTEXT_URL = new URL('../dist/context.js', import.meta.url);
const CONSTANTS_URL = new URL('../dist/generated/webgl-constants.js', import.meta.url);

// jsdom gives a frame a new window each time it navigates, through this
// module's createWindow, and offers no public hook for it.
const jsdomWindow = createRequire(import.meta.url)('jsdom/lib/jsdom/browser/Window.js');

// jsdom reloads an image, and fires load again, when its width attribute
// changes; browsers do that only for responsive images (srcset or sizes),
// and pages that resize an image in its load handler would loop.
const ImageImpl = createRequire(import.meta.url)('jsdom/lib/jsdom/living/nodes/HTMLImageElement-impl.js').implementation;
const imageAttributeChange = ImageImpl.prototype._attributeChangeSteps;
const elementAttributeChange = Object.getPrototypeOf(ImageImpl.prototype)._attributeChangeSteps;
if (typeof imageAttributeChange !== 'function' || typeof elementAttributeChange !== 'function') {
  throw new Error('jsdom no longer has _attributeChangeSteps on images; update the image shim');
}
ImageImpl.prototype._attributeChangeSteps = function (localName, oldValue, value, namespace) {
  const responsive = this.hasAttributeNS(null, 'srcset') || this.hasAttributeNS(null, 'sizes');
  const steps = namespace === null && localName === 'width' && !responsive ? elementAttributeChange : imageAttributeChange;
  return steps.call(this, localName, oldValue, value, namespace);
};

/**
 * Runs the page at `url`. `hooks.beforeParse(window)` runs after the shim is
 * installed and `hooks.beforeExit()` after the outcome is sent; the runner's
 * own tests use them to inject faults.
 */
export async function runPage(url, { endEarly = false, root } = {}, hooks = {}) {
  const state = {
    root: root === undefined ? undefined : resolve(root),
    passed: 0,
    failed: 0,
    firstFailure: undefined,
    error: undefined,
    contextErrors: [],
    contexts: new Set(),
    errorBeforeFailure: false,
  };
  let finished = false;
  let pageWindow;
  let countsTimer;
  let countsSentAt = -Infinity;

  // Counts reach the parent promptly but at most every 250 ms. They keep a
  // page that later times out or crashes on record, and each one restarts the
  // parent's watchdog, as each result does in the official harness. They are
  // sent from the reporting call itself, not only from a timer, so a page
  // reporting inside a long synchronous stretch, which no timer can
  // interrupt, still restarts the watchdog; the timer sends the last counts.
  const postCounts = () => {
    clearTimeout(countsTimer);
    countsTimer = undefined;
    countsSentAt = performance.now();
    process.send?.({ type: 'counts', passed: state.passed, failed: state.failed });
  };
  const sendCounts = () => {
    const wait = countsSentAt + 250 - performance.now();
    if (wait <= 0) postCounts();
    else countsTimer ??= setTimeout(postCounts, wait);
  };

  const finish = (outcome, message) => {
    if (finished) return;
    finished = true;
    clearTimeout(countsTimer);
    // Stop the page's timers and scripts, then release its contexts and any
    // its frames still hold.
    pageWindow?.close();
    for (const ref of state.contexts) release(state, ref);
    process.send?.(
      {
        type: 'outcome',
        outcome,
        passed: state.passed,
        failed: state.failed,
        message,
        error: state.error,
        errorBeforeFailure: state.errorBeforeFailure,
        contextErrors: state.contextErrors,
      },
      () => {
        hooks.beforeExit?.();
        process.exit(0);
      },
    );
  };

  const onError = (message) => {
    if (state.error !== undefined || finished) return;
    state.error = message;
    state.errorBeforeFailure = state.failed === 0;
    // Sent now, so a page that then never completes still has it on record.
    process.send?.({ type: 'error', message });
    if (endEarly) finish('FAIL', message);
  };

  // The IPC channel does not keep a child alive on its own; hold it open so a
  // page that goes idle without completing waits for the parent's time limit.
  process.channel?.ref();

  // Rejections in the page's realm reach Node's process-wide handling, whose
  // default ends the process. Browsers, and the official harness, ignore
  // them; so does this runner. The runner's own async work is awaited.
  // OXGL_CONFORMANCE_TRACE records them, a debugging aid for pages that hang.
  process.on('unhandledRejection', (reason) => {
    const trace = process.env.OXGL_CONFORMANCE_TRACE;
    if (trace) appendFileSync(trace, `UNHANDLED REJECTION: ${describe(reason)}\n`);
  });

  // Frames the page opens get the same shim before their documents parse,
  // and a console of their own: as in the official harness, a frame's
  // uncaught errors, like its results, are not the page's.
  const createWindow = jsdomWindow.createWindow;
  if (typeof createWindow !== 'function') throw new Error('jsdom no longer exports createWindow; update the frame shim');
  const frameConsole = new VirtualConsole();
  jsdomWindow.createWindow = (options) => {
    const frameWindow = createWindow({ ...options, settings: { ...options.settings, virtualConsole: frameConsole } });
    installShim(frameWindow, state);
    return frameWindow;
  };

  // Only the page's own document reports to the harness, as in the official
  // harness, where a test page's frames have no webglTestHarness above them.
  const isPage = (url) => url === pageWindow?.location.pathname;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (error.type === 'unhandled-exception') onError(describe(error.cause ?? error));
  });

  await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: { interceptors: [keepImageBytes] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      pageWindow = window;
      installShim(window, state);
      window.webglTestHarness = {
        reportResults(url, success, msg) {
          if (finished || !isPage(url)) return;
          if (success) state.passed += 1;
          else {
            state.failed += 1;
            state.firstFailure ??= String(msg);
            // A debugging aid: OXGL_CONFORMANCE_TRACE names a file that
            // collects every failed assertion, not only the first.
            const trace = process.env.OXGL_CONFORMANCE_TRACE;
            if (trace) appendFileSync(trace, `FAILED ${url}: ${String(msg)}\n${String(new Error().stack)}\n`);
          }
          sendCounts();
        },
        notifyFinished(url) {
          if (!isPage(url)) return;
          if (state.failed > 0) finish('FAIL', state.firstFailure);
          else if (state.passed === 0) finish('FAIL', state.error ?? 'no results reported');
          else finish('PASS', undefined);
        },
      };
      hooks.beforeParse?.(window);
    },
  });
}

/** The message recorded for an escaped error. */
function describe(error) {
  // Page errors come from the window's realm, so no instanceof checks.
  if (typeof error === 'object' && error !== null && typeof error.stack === 'string') return error.stack;
  return String(error?.message ?? error);
}

const WEBGL_TYPES = { webgl: 1, 'experimental-webgl': 1, webgl2: 2 };

/**
 * Evaluates oxgl's JS layer (dist/context.js) in the page's realm, as a
 * browser's WebGL objects belong to the page: errors oxgl throws and its
 * classes' prototype chains are then the page's own TypeError and Object.
 * The native addon and `process` (for `OXGL_BACKEND`) are shared with this
 * process.
 */
function loadOxgl(window) {
  contextBody ??= contextSource();
  const load = compileFunction(contextBody, ['native', 'process'], { parsingContext: window, filename: CONTEXT_URL.href });
  return load(native, process);
}

let contextBody;

/** The globals the JS layer defines in a page, beside `createContext`. */
const INTERFACES = [
  'WebGLRenderingContext',
  'WebGL2RenderingContext',
  'WebGLContextEvent',
  'WebGLShaderPrecisionFormat',
  'WebGLObject',
  'WebGLBuffer',
  'WebGLProgram',
  'WebGLShader',
  'WebGLTexture',
  'WebGLSampler',
  'WebGLFramebuffer',
  'WebGLRenderbuffer',
  'WebGLVertexArrayObject',
  'WebGLTransformFeedback',
  'WebGLQuery',
  'WebGLSync',
  'WebGLUniformLocation',
  'WebGLActiveInfo',
];

/**
 * dist/context.js and the local modules it imports, as one function body
 * returning its exports; computed once per process. Modules are inlined in
 * dependency order with their `import` statements removed and `export`
 * keywords stripped, so names must be unique across modules. Import
 * statements leave their lines behind and the generated constants collapse
 * to one line, so a stack trace's line numbers are those of the concatenated
 * body. `./native.js` is the function's `native` parameter.
 */
function contextSource() {
  const seen = new Set();
  const parts = [];
  const inline = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    const imports = [...source.matchAll(/^import (?:type )?\{[^}]*\} from '(\.[^']+)';$/gms)].map((m) => m[1]);
    for (const path of imports) {
      if (path === './native.js' || path === './load-native.js') continue;
      inline(new URL(path, url));
    }
    let body = source
      .replace(/^import (?:type )?\{[^}]*\} from '[^']+';$/gms, (statement) => statement.replace(/[^\n]/g, ''))
      .replace(/^export (class|function|const|let) /gm, '$1 ')
      .replace(/^export \{[^}]*\}(?: from '[^']+')?;$/gms, '');
    if (url.href === CONSTANTS_URL.href) {
      // The generated module holds no strings, so every `//` starts a comment.
      body = body.replace(/\/\/.*$/gm, '').replace(/\s*\n\s*/g, ' ');
    }
    if (/^\s*(import|export)\b/m.test(body)) {
      throw new Error(`${url.pathname} has imports or exports the conformance runner does not handle`);
    }
    parts.push(body);
  };
  inline(CONTEXT_URL);
  return `${parts.join('\n')}\nreturn { createContext, canvasPixels, presentDrawingBuffer, setImageDecoder, ${INTERFACES.join(', ')} };`;
}

/**
 * Destroys the context `ref` points to, if the page has not dropped it and
 * let it be collected; a throwing destroy() is recorded and must not cost the
 * page its outcome.
 */
function release(state, ref) {
  state.contexts.delete(ref);
  try {
    ref.deref()?.destroy();
  } catch (error) {
    state.contextErrors.push(`destroy() threw: ${describe(error)}`);
  }
}

/** Installs the canvas shim, the context class globals, ImageData, message delivery, Closure's loader hook and failing media. */
function installShim(window, state) {
  const oxgl = loadOxgl(window);
  const { createContext } = oxgl;
  const contexts = new WeakMap();
  // jsdom closes a frame's window when the frame navigates; its contexts go
  // with it, as a browser releases them with the document. Contexts are held
  // weakly, so one the page drops is collected and released by oxgl itself.
  const own = new Set();
  const close = window.close;
  window.close = function () {
    for (const ref of own) release(state, ref);
    own.clear();
    return close.call(this);
  };
  // jsdom's images have no decode() (HTML §4.8.4.3.4), which the suite's
  // image loaders await: resolve when the image has loaded, reject when it
  // fails, as browsers do.
  if (typeof window.HTMLImageElement.prototype.decode !== 'function') {
    window.HTMLImageElement.prototype.decode = function decode() {
      return new window.Promise((resolve, reject) => {
        const settle = () => {
          if (this.complete && this.naturalWidth > 0) resolve(undefined);
          else reject(new window.DOMException('The source image cannot be decoded.', 'EncodingError'));
        };
        // complete is true with no src as well; settle() rejects that.
        if (this.complete) {
          settle();
          return;
        }
        this.addEventListener('load', settle, { once: true });
        this.addEventListener('error', settle, { once: true });
      });
    };
  }
  // jsdom does no layout, so an element's client size is 0. A canvas's is
  // its inline CSS size in pixels when it has one, else its width and
  // height, which is what an unstyled canvas shows.
  for (const [client, size] of [['clientWidth', 'width'], ['clientHeight', 'height']]) {
    Object.defineProperty(window.HTMLCanvasElement.prototype, client, {
      configurable: true,
      enumerable: true,
      get() {
        const css = /^(\d+(?:\.\d+)?)px$/.exec(this.style[size]);
        return css ? Math.floor(Number(css[1])) : this[size];
      },
    });
  }
  // A WebGL canvas drawn into a 2D canvas, or exported with toDataURL,
  // shows its drawing buffer, which jsdom's own canvas does not have.
  const { canvasPixels } = oxgl;
  const asImage = (canvas) => {
    const pixels = canvasPixels(canvas);
    if (pixels === undefined) return undefined;
    const scratch = window.document.createElement('canvas');
    scratch.width = pixels.width;
    scratch.height = pixels.height;
    if (pixels.width > 0 && pixels.height > 0) {
      const data = new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
      getContext2d.call(scratch, '2d').putImageData(new window.ImageData(data, pixels.width, pixels.height), 0, 0);
    }
    return scratch;
  };
  // A 2D canvas that draws an image from another origin is no longer
  // origin-clean, and its pixels cannot be read (HTML §4.12.5.1.7). The
  // suite's cross-origin images come from 127.0.0.1 and localhost swapped.
  const tainted = new WeakSet();
  const originClean = (image) => {
    if (image instanceof window.HTMLCanvasElement) return !tainted.has(image);
    if (!(image instanceof window.HTMLImageElement) || image.crossOrigin !== null) return true;
    const url = new window.URL(image.src, window.document.URL);
    return url.protocol === 'data:' || url.origin === window.location.origin;
  };
  const securityError = (method) =>
    new window.DOMException(`Failed to execute '${method}': The canvas has been tainted by cross-origin data.`, 'SecurityError');
  // jsdom sets drawImage and getImageData on each 2D context it creates, so
  // getContext below wraps that instance's.
  const wrapContext2d = (context) => {
    const own = context.drawImage;
    context.drawImage = function (image, ...rest) {
      if (!originClean(image)) tainted.add(this.canvas);
      return own.call(this, (image instanceof window.HTMLCanvasElement && asImage(image)) || image, ...rest);
    };
    const getImageData = context.getImageData;
    context.getImageData = function (...args) {
      if (tainted.has(this.canvas)) throw securityError('getImageData');
      return getImageData.apply(this, args);
    };
  };
  // A WebGL canvas's PNG is written from its unpremultiplied pixels, as
  // browsers do; through the canvas package it would be premultiplied.
  const toDataURL = window.HTMLCanvasElement.prototype.toDataURL;
  window.HTMLCanvasElement.prototype.toDataURL = function (type, ...rest) {
    if (tainted.has(this)) throw securityError('toDataURL');
    const pixels = canvasPixels(this);
    if (pixels !== undefined && pixels.width > 0 && pixels.height > 0 && (type === undefined || String(type).toLowerCase() === 'image/png')) {
      return `data:image/png;base64,${encodePng(pixels).toString('base64')}`;
    }
    return toDataURL.call(asImage(this) ?? this, type, ...rest);
  };
  oxgl.setImageDecoder((image) => {
    const bitmap = bitmapPixels.get(image);
    if (bitmap !== undefined) return bitmap;
    if (!(image instanceof window.HTMLImageElement)) return undefined;
    let fetched = imageBytes.get(image);
    if (fetched?.url !== image.src) {
      const bytes = dataUrlBytes(image.src);
      if (bytes === undefined) return undefined;
      fetched = { url: image.src, bytes, decoded: undefined };
      imageBytes.set(image, fetched);
    }
    // An SVG image is drawn at the element's size (HTML §4.8.4.3.6).
    if (isSvg(fetched.bytes)) return rasterizeSvg(fetched.bytes, image.width, image.height);
    fetched.decoded ??= decodeImage(fetched.bytes) ?? null;
    return fetched.decoded ?? undefined;
  });
  installImageBitmap(window, (image) => {
    const fetched = imageBytes.get(image);
    const bytes = fetched?.url === image.src ? fetched.bytes : dataUrlBytes(image.src);
    return bytes === undefined ? undefined : decodeImage(bytes);
  }, canvasPixels);
  // An OffscreenCanvas from transferControlToOffscreen shows its frames in
  // its placeholder canvas, and is composited as that canvas would be.
  const placeholders = new WeakMap();
  window.OffscreenCanvas = offscreenCanvasClass(window, oxgl, window.ImageBitmap, (canvas, gl) => {
    if (placeholders.has(canvas)) own.add(new WeakRef(gl));
  });
  // jsdom's own getContext gives 2D contexts (through the canvas package).
  // It does not know oxgl's contexts, so one type per canvas is enforced here
  // in both directions (HTML §4.12.5).
  const getContext2d = window.HTMLCanvasElement.prototype.getContext;
  const canvases2d = new WeakSet();
  window.HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
    const version = WEBGL_TYPES[String(type)];
    const [attributes] = rest;
    const existing = contexts.get(this);
    if (existing) return existing.version === version ? existing.gl : null;
    if (version === undefined) {
      const context = getContext2d.call(this, type, ...rest);
      if (context !== null && context !== undefined && !canvases2d.has(this)) {
        canvases2d.add(this);
        wrapContext2d(context);
      }
      return context ?? null;
    }
    if (canvases2d.has(this) || placeholders.has(this)) return null;
    // WebIDL converts the attributes dictionary before anything else.
    if (attributes !== undefined && attributes !== null && typeof attributes !== 'object' && typeof attributes !== 'function') {
      throw new window.TypeError("Failed to execute 'getContext': The provided value is not of type 'WebGLContextAttributes'.");
    }
    let gl;
    try {
      gl = createContext({ width: this.width, height: this.height, webgl2: version === 2, canvas: this, attributes });
    } catch (error) {
      // A browser's getContext returns null when creation fails.
      state.contextErrors.push(String(error?.message ?? error));
      return null;
    }
    contexts.set(this, { version, gl });
    const ref = new WeakRef(gl);
    state.contexts.add(ref);
    own.add(ref);
    return gl;
  };
  forwardResizes(window, contexts);
  window.HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    if (contexts.has(this) || canvases2d.has(this) || placeholders.has(this)) {
      throw new window.DOMException("Failed to execute 'transferControlToOffscreen': Cannot transfer control from a canvas that has a rendering context.", 'InvalidStateError');
    }
    const offscreen = new window.OffscreenCanvas(this.width, this.height);
    placeholders.set(this, offscreen);
    placeholders.set(offscreen, this);
    return offscreen;
  };
  compositeEachFrame(window, own, oxgl.presentDrawingBuffer, placeholders);
  for (const name of INTERFACES) window[name] = oxgl[name];
  window.ImageData = canvasPackage().ImageData;
  if (state.root !== undefined) window.CLOSURE_IMPORT_SCRIPT = closureImport(window, state.root);
  deliverMessages(window);
  failMedia(window);
  installWorkers(window, state.root);
  loadOnce(window);
}

/**
 * Lets a window's load event through once, as browsers fire it (HTML
 * §8.4.1, "the end"). jsdom fires it again when images created after the
 * first one finish loading, which runs `<body onload>` handlers twice.
 */
function loadOnce(window) {
  let loaded = false;
  window.addEventListener(
    'load',
    (event) => {
      if (event.target !== window.document) return;
      if (loaded) event.stopImmediatePropagation();
      loaded = true;
    },
    true,
  );
}

/**
 * Composites the page's WebGL canvases at the start of each animation frame,
 * before that frame's callbacks, as a browser presents what the previous
 * frame drew: drawing buffers without preserveDrawingBuffer are cleared.
 * Canvases outside the document are never composited; an OffscreenCanvas
 * from transferControlToOffscreen is, when its placeholder is in it.
 */
function compositeEachFrame(window, own, present, placeholders) {
  const requestAnimationFrame = window.requestAnimationFrame;
  let scheduled = false;
  const composite = () => {
    scheduled = false;
    for (const ref of own) {
      const gl = ref.deref();
      const shown = placeholders.get(gl?.canvas) ?? gl?.canvas;
      if (shown?.isConnected === true) present(gl);
    }
  };
  window.requestAnimationFrame = function (callback) {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame.call(window, composite);
    }
    return requestAnimationFrame.call(window, callback);
  };
}

/**
 * Resizes a canvas's oxgl drawing buffer synchronously whenever its `width`
 * or `height` changes, through the property or the content attribute, as a
 * browser does (WebGL 1.0 §2.2). jsdom's property setters write the attribute
 * internally, so both paths are wrapped.
 */
function forwardResizes(window, contexts) {
  const resize = (canvas) => {
    const entry = contexts.get(canvas);
    entry?.gl.resize(canvas.width, canvas.height);
  };
  const proto = window.HTMLCanvasElement.prototype;
  for (const name of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor?.set) throw new Error(`jsdom's HTMLCanvasElement has no ${name} accessor; update the resize shim`);
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        resize(this);
      },
    });
  }
  const isSize = (element, name) =>
    element instanceof window.HTMLCanvasElement && ['width', 'height'].includes(String(name).toLowerCase());
  const element = window.Element.prototype;
  for (const method of ['setAttribute', 'removeAttribute', 'toggleAttribute']) {
    const original = element[method];
    element[method] = function (name, ...rest) {
      const result = original.call(this, name, ...rest);
      if (isSize(this, name)) resize(this);
      return result;
    };
  }
  const setAttributeNS = element.setAttributeNS;
  element.setAttributeNS = function (namespace, name, ...rest) {
    const result = setAttributeNS.call(this, namespace, name, ...rest);
    if (namespace === null && isSize(this, name)) resize(this);
    return result;
  };
}

/** The `canvas` package, which jsdom uses for 2D contexts and images. */
function canvasPackage() {
  if (canvasModule === undefined) {
    canvasModule = createRequire(import.meta.url)('canvas');
    loadUnsizedSvgEmpty();
  }
  return canvasModule;
}

let canvasModule;

/**
 * jsdom delivers `postMessage` with `source: null`, so the suite's
 * `setZeroTimeout`, which checks `event.source == window`, never runs its
 * callbacks. Deliver once, in a task, with the receiving window as `source`,
 * after jsdom's `targetOrigin` check. `data` is passed as is, as jsdom does.
 */
function deliverMessages(window) {
  window.postMessage = function postMessage(message, targetOrigin = '/') {
    const origin = window.location.origin;
    // postMessage(message, options) carries the origin in a dictionary.
    const target =
      typeof targetOrigin === 'object' && targetOrigin !== null
        ? String(targetOrigin.targetOrigin ?? '/')
        : String(targetOrigin);
    if (target !== '*' && target !== '/') {
      let parsed;
      try {
        parsed = new URL(target).origin;
      } catch {
        throw new window.DOMException(`Invalid target origin '${target}'`, 'SyntaxError');
      }
      if (parsed !== origin) return;
    }
    window.setTimeout(() => {
      window.dispatchEvent(new window.MessageEvent('message', { data: message, origin, source: window }));
    }, 0);
  };
}

/**
 * Closure's uncompiled loader (deqp's goog.require) imports each file with
 * document.write. jsdom queues those scripts behind the ones the parser has
 * already queued, so a page's later scripts would run before its imports; a
 * browser runs them before parsing goes on. Closure's import hook runs each
 * file at once instead, read from the served directory, as an inline script:
 * jsdom runs that synchronously and reports its errors as the page's.
 * Returns false, so nothing loads, for source text (goog.module, which the
 * suite does not use), another origin, or a file outside `root` or missing.
 */
function closureImport(window, root) {
  return (src, text) => {
    const url = new URL(src, window.location.href);
    if (text !== undefined || url.origin !== window.location.origin) return false;
    const file = resolveFile(root, url.href);
    if (file === undefined) return false;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    const script = window.document.createElement('script');
    script.text = `${source}\n//# sourceURL=${url.href}`;
    window.document.head.appendChild(script);
    return true;
  };
}

/**
 * jsdom has no video or audio decoding and never fires `load` or `error` for
 * media. Behave like a browser without codecs: `play()` rejects with
 * `NotSupportedError`, and `error` fires on the next task after a source is
 * set, so pages that wait for media fail promptly. Images load through jsdom
 * and the canvas package.
 */
/** The bytes each image element last fetched, by element: `{ url, bytes, decoded }`. */
const imageBytes = new WeakMap();

/** Keeps the bytes images fetch, for WebGL's decoding of them. */
const keepImageBytes = requestInterceptor(async (request, { element }) => {
  if (element?.localName !== 'img') return undefined;
  const response = await fetch(request.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  imageBytes.set(element, { url: request.url, bytes, decoded: undefined });
  return new Response(bytes, { status: response.status, headers: response.headers });
});

/**
 * Image bytes decoded as browsers do for WebGL: PNGs by the runner's own
 * decoder; others (JPEG) by the canvas package, which applies EXIF
 * orientation as browsers do. `undefined` for bytes neither can decode.
 */
function decodeImage(bytes) {
  const png = decodePng(bytes);
  if (png !== undefined) return png;
  const { Image, createCanvas } = canvasPackage();
  const image = new Image();
  try {
    image.src = bytes;
  } catch {
    return undefined;
  }
  if (!(image.width > 0 && image.height > 0)) return undefined;
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { data, width: image.width, height: image.height };
}

/** RGBA8 `{ data, width, height }` with color multiplied by alpha. */
function premultiply({ data, width, height }) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    out[i] = Math.round((data[i] * a) / 255);
    out[i + 1] = Math.round((data[i + 1] * a) / 255);
    out[i + 2] = Math.round((data[i + 2] * a) / 255);
    out[i + 3] = a;
  }
  return { data: out, width, height };
}

/** The rows of `{ data, width, height }` in reverse order. */
function flipRows({ data, width, height }) {
  const out = new data.constructor(data.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(data.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return { data: out, width, height };
}

/**
 * `createImageBitmap` from a Blob, an image, ImageData or a canvas, with the
 * `imageOrientation` and `premultiplyAlpha` options (HTML §8.10; `default`
 * keeps alpha unpremultiplied), and `fetch` when jsdom has none:
 * enough for pages that upload ImageBitmaps. `decodeElement` decodes an
 * image element's bytes; `canvasPixels` reads a WebGL canvas.
 */
function installImageBitmap(window, decodeElement, canvasPixels) {
  const ImageBitmap = imageBitmapClass();
  window.ImageBitmap = ImageBitmap;
  window.createImageBitmap = async (source, options = {}) => {
    let pixels;
    if (bitmapPixels.has(source)) pixels = bitmapPixels.get(source);
    else if (typeof source?.arrayBuffer === 'function') pixels = decodeImage(Buffer.from(await source.arrayBuffer()));
    else if (source instanceof window.HTMLImageElement) pixels = decodeElement(source);
    else if (ArrayBuffer.isView(source?.data)) pixels = { data: source.data, width: source.width, height: source.height };
    else if (source instanceof window.HTMLCanvasElement || source instanceof window.OffscreenCanvas) {
      pixels = canvasPixels(source) ?? source.getContext('2d')?.getImageData(0, 0, source.width, source.height);
    }
    if (pixels === undefined || pixels === null) throw new window.DOMException('The source image could not be decoded.', 'InvalidStateError');
    // An ImageData's fields are accessors, which a spread does not copy.
    pixels = { data: pixels.data, width: pixels.width, height: pixels.height };
    if (options?.imageOrientation === 'flipY') pixels = flipRows(pixels);
    if (options?.premultiplyAlpha === 'premultiply') pixels = premultiply(pixels);
    return new ImageBitmap(pixels);
  };
  if (typeof window.fetch !== 'function') {
    window.fetch = (input, init) => fetch(new URL(String(input), window.document.baseURI), init);
  }
}

/** An SVG document's root `<svg ...>` tag, or `undefined`. */
function svgRoot(text) {
  return /<svg\b[^>]*>/i.exec(text)?.[0];
}

/**
 * An SVG drawn at `width × height`, as an image element shows it: its root
 * is given that size, and a viewBox of its own size when it has none, so
 * its content scales. `undefined` for an empty size.
 */
function rasterizeSvg(bytes, width, height) {
  if (width === 0 || height === 0) return undefined;
  const text = bytes.toString('utf8');
  const root = svgRoot(text);
  if (root === undefined) return undefined;
  const size = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  const viewBox = /\sviewBox\s*=/i.test(root) || size('width') === undefined || size('height') === undefined ? '' : ` viewBox="0 0 ${parseFloat(size('width'))} ${parseFloat(size('height'))}"`;
  const sized = root
    .replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/^<svg\b/i, `<svg width="${width}" height="${height}"${viewBox}`);
  const { Image, createCanvas } = canvasPackage();
  const image = new Image();
  try {
    image.src = Buffer.from(text.replace(root, sized), 'utf8');
  } catch {
    return undefined;
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * The canvas package refuses an SVG whose root has no width or height;
 * a browser loads it with no natural size (0×0). Such an SVG is not handed
 * to the package, so the image loads empty.
 */
function loadUnsizedSvgEmpty() {
  const { Image } = canvasPackage();
  const descriptor = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  if (descriptor?.set === undefined || descriptor.get === undefined) {
    throw new Error('the canvas package no longer has an Image src accessor; update the SVG shim');
  }
  Object.defineProperty(Image.prototype, 'src', {
    ...descriptor,
    set(value) {
      if (Buffer.isBuffer(value) && isSvg(value)) {
        const root = svgRoot(value.toString('utf8')) ?? '';
        if (!/\swidth\s*=/i.test(root) || !/\sheight\s*=/i.test(root)) return;
      }
      descriptor.set.call(this, value);
    },
  });
}

/** Whether image bytes are an SVG document. */
function isSvg(bytes) {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(bytes.subarray(0, 1024).toString('latin1'));
}

/** The bytes of a `data:` URL, base64 or percent-encoded, or `undefined`. */
function dataUrlBytes(url) {
  const match = /^data:([^,]*),(.*)$/s.exec(url);
  if (match === null) return undefined;
  if (/;base64$/i.test(match[1])) return Buffer.from(match[2], 'base64');
  try {
    return Buffer.from(decodeURIComponent(match[2]), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Workers on worker threads (workers.mjs), whose `importScripts` reads the
 * suite's files under `root`, and Blob URLs for their scripts:
 * a page's Blob URL is one of Node's, so the thread that starts a worker
 * can read it.
 */
function installWorkers(window, root) {
  window.Worker = workerClass({
    root,
    EventTarget: window.EventTarget,
    messageEvent: (data) => new window.MessageEvent('message', { data }),
    errorEvent: (message) => new window.ErrorEvent('error', { message }),
    base: () => window.document.baseURI,
    receive: (data) => toRealm(window, decodeMessage(data, window.ImageBitmap)),
  });
  window.URL.createObjectURL = (blob) => URL.createObjectURL(new Blob([blobBytes(blob)], { type: blob.type }));
  window.URL.revokeObjectURL = (url) => URL.revokeObjectURL(String(url));
}

/** The bytes of a jsdom Blob, which has no synchronous reader. */
function blobBytes(blob) {
  const bytes = blobImpl(blob)?._bytes;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('URL.createObjectURL: not a Blob');
  return bytes;
}

const blobImpl = createRequire(import.meta.url)('jsdom/lib/generated/idl/utils.js').implForWrapper;

/** A structured-cloned value from Node's realm, rebuilt in `window`'s. */
function toRealm(window, value) {
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof ArrayBuffer) {
    const copy = new window.ArrayBuffer(value.byteLength);
    new window.Uint8Array(copy).set(new Uint8Array(value));
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = toRealm(window, value.buffer);
    if (value instanceof DataView) return new window.DataView(buffer, value.byteOffset, value.byteLength);
    return new window[value.constructor.name](buffer, value.byteOffset, value.length);
  }
  if (Array.isArray(value)) return window.Array.from(value, (item) => toRealm(window, item));
  if (Object.getPrototypeOf(value) === Object.prototype) {
    const copy = new window.Object();
    for (const [key, item] of Object.entries(value)) copy[key] = toRealm(window, item);
    return copy;
  }
  return value;
}

function failMedia(window) {
  const failed = new WeakSet();
  const fail = (element) => {
    failed.add(element);
    window.setTimeout(() => element.dispatchEvent(new window.Event('error')), 0);
  };
  const isMedia = (node) => node instanceof window.HTMLMediaElement;
  const proto = window.HTMLMediaElement.prototype;
  proto.play = function play() {
    return window.Promise.reject(new window.DOMException('The element has no supported sources.', 'NotSupportedError'));
  };
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
  if (descriptor?.set) {
    Object.defineProperty(proto, 'src', {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        if (String(value) !== '') fail(this);
      },
    });
  }
  const setAttribute = window.Element.prototype.setAttribute;
  window.Element.prototype.setAttribute = function (name, value) {
    setAttribute.call(this, name, value);
    if (isMedia(this) && String(name).toLowerCase() === 'src' && String(value) !== '') fail(this);
  };
  // Elements from markup get their src without the setters above. The
  // parser's are failed once parsing is done: in a browser their load ends
  // after the scripts before them have run, which jsdom does not guarantee.
  // Later ones (innerHTML) fail as they are inserted.
  const failInserted = (node) => {
    if (isMedia(node) && !failed.has(node) && node.getAttribute('src')) fail(node);
  };
  window.document.addEventListener('DOMContentLoaded', () => {
    window.document.querySelectorAll('video, audio').forEach(failInserted);
    new window.MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(failInserted);
    }).observe(window.document, { childList: true, subtree: true });
  });
}

/** The child's entry point: runs the page named on the command line. */
export async function main(hooks = {}) {
  const [url, options = '{}'] = process.argv.slice(2);
  try {
    await runPage(url, JSON.parse(options), hooks);
  } catch (error) {
    process.send?.({ type: 'harness-error', message: describe(error) }, () => process.exit(1));
  }
}

if (import.meta.main) await main();
