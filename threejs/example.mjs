// Runs one three.js example in a jsdom window against oxgl, captures its
// deterministic frame, compares it with the release's reference screenshot,
// reports to the parent over IPC and exits. Usage (from the parent, with
// --experimental-vm-modules): fork(example.mjs, [name, options]) where
// options is JSON: { root, tolerance?, output?, timing? }, root being the
// release checkout and output the directory for a failing example's images.
//
// Messages: { type: 'counts', passed: 0, failed: 0 } as the example makes
// progress, each restarting the pool's watchdog; { type: 'outcome', outcome,
// message, error, extra: { diffPercent, imageOnly, refused } } once it is
// judged; { type: 'harness-error', message } when the runner itself fails.
import { resolveObjectURL } from 'node:buffer';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceTextModule } from 'node:vm';

import jsdom from 'jsdom';

import { encodePng } from '../conformance/png.mjs';
import { startServer } from '../conformance/server.mjs';
import { describe, installShim, keepImageBytes, release } from '../conformance/window.mjs';
import { crossOrigin } from '../conformance/workers.mjs';

import { compare, composite, DEFAULT_TOLERANCE, decodeJpeg, halve, matches } from './image.mjs';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

/** The viewport of three.js's end-to-end test, at device pixel ratio 1. */
export const WIDTH = 800;
export const HEIGHT = 500;

/**
 * The frame sequence's waits: the quiet period that counts as idle, the
 * parse allowance per megabyte served and its cap, and the longest waits
 * for videos and for the released frame.
 */
export const TIMING = { idleMs: 1000, allowanceMsPerMB: 1000, allowanceCapMs: 30_000, videoWaitMs: 5000, renderWaitMs: 5000 };

/** The builds upstream's test rewrites so UUIDs do not draw from the seeded `Math.random`. */
const UUID_BUILDS = ['three.core.js', 'three.module.js', 'three.webgpu.js'];

/**
 * Runs the example `name` from the checkout `root` and judges its frame
 * against `tolerance` (percent of pixels). Resolves to the outcome message's
 * fields. `hooks.beforeParse(window)` runs after the runner's own setup, and
 * `hooks.holdFirst` registers the load-event hold before the shim; the
 * runner's tests use them.
 */
export async function runExample(name, { root, tolerance = DEFAULT_TOLERANCE, output, timing = {} }, hooks = {}) {
  const wait = { ...TIMING, ...timing };
  const state = { root, contexts: new Set(), contextErrors: [] };
  const errors = [];
  const refused = [];
  const error = (message) => {
    errors.push(message);
    // A debugging aid: OXGL_THREEJS_TRACE names a file that collects every
    // error, not only the first.
    const trace = process.env.OXGL_THREEJS_TRACE;
    if (trace) appendFileSync(trace, `${name}: ${message}\n`);
  };
  const refuse = (url) => {
    if (refused.includes(url)) return;
    refused.push(url);
    error(`refused a request to another origin: ${url}`);
  };

  // Progress reaches the parent at most every 250 ms; each restarts its watchdog.
  let progressAt = -Infinity;
  const progress = (force = false) => {
    if (!force && performance.now() - progressAt < 250) return;
    progressAt = performance.now();
    process.send?.({ type: 'counts', passed: 0, failed: 0 });
  };

  const server = await startServer(root, {
    onResponse: (request, response) => {
      // A browser logs a failed load as an error, which upstream's test fails on.
      if (response.statusCode >= 400) error(`Failed to load resource: the server responded with a status of ${String(response.statusCode)} (${request.url})`);
      progress();
    },
  });

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (failure) => {
    if (failure.type === 'unhandled-exception') error(describe(failure.cause ?? failure));
  });
  virtualConsole.on('error', (...args) => error(args.map((arg) => (typeof arg?.message === 'string' ? arg.message : String(arg))).join(' ')));
  // Rejections in the page's realm reach Node's process-wide handling. In a
  // browser they are uncaught errors, which upstream's test fails on. An
  // error of this process's own realm that no page code was running under
  // (none of its stack frames is from the page's origin) comes from the
  // runner, and is a harness error rather than the example's. One raised
  // under page code, by jsdom, the canvas package or oxgl's native layer, is
  // the example's.
  let runnerFailure;
  // Node keeps 10 frames by default; jsdom's and libraries' own frames can
  // push the page's out of that, so keep enough to reach them.
  Error.stackTraceLimit = 100;
  process.on('unhandledRejection', (reason) => {
    const fromPage = typeof reason?.stack === 'string' && reason.stack.includes(server.origin);
    if (reason instanceof Error && !fromPage) runnerFailure ??= reason;
    else error(`Uncaught (in promise) ${describe(reason)}`);
  });

  const refuseOtherOrigins = requestInterceptor((request) => {
    if (!crossOrigin(request.url, server.origin)) return undefined;
    refuse(request.url);
    throw new TypeError(`refused: ${request.url} is on another origin`);
  });

  const injection = readFileSync(join(root, 'test', 'e2e', 'deterministic-injection.js'), 'utf8');
  let canvasPixels;
  let parsed;
  let loaded;
  const held = new WeakSet();
  const dom = await JSDOM.fromURL(`${server.origin}/examples/${name}.html`, {
    runScripts: 'dangerously',
    resources: { interceptors: [refuseOtherOrigins, keepImageBytes] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // The hold works whichever of it and the shim's load-once guard is
      // registered first; the runner's tests try both orders.
      if (hooks.holdFirst === true) ({ parsed, loaded } = holdLoadEvents(window, held));
      ({ canvasPixels } = installShim(window, state, { sameOriginOnly: true, onRefused: refuse }));
      if (hooks.holdFirst !== true) ({ parsed, loaded } = holdLoadEvents(window, held));
      setViewport(window);
      installFetch(window, server.origin, refuse);
      // After the shim, so its requestAnimationFrame gate replaces the
      // shim's compositing wrapper and nothing presents before capture.
      window.eval(injection);
      hooks.beforeParse?.(window);
    },
  });
  const { window } = dom;

  try {
    await parsed;
    await runModules(dom, server.origin, refuse, error);
    const own = (type, target) => {
      const event = new window.Event(type, { bubbles: type === 'DOMContentLoaded' });
      held.add(event);
      target.dispatchEvent(event);
    };
    own('DOMContentLoaded', window.document);
    await loaded;
    own('load', window);

    window.eval(readFileSync(join(root, 'test', 'e2e', 'clean-page.js'), 'utf8'));
    await waitForIdle(server, wait.idleMs);
    progress(true);
    // Upstream's injection throws for a video that failed, which fails the example.
    const videosReady = () => {
      try {
        return window._videosReady();
      } catch (failure) {
        error(describe(failure));
        return true;
      }
    };
    if (!(await until(videosReady, wait.videoWaitMs))) error(`videos were not ready within ${String(wait.videoWaitMs / 1000)} s`);
    const megabytes = server.activity().bytes / 1024 / 1024;
    await sleep(Math.min(megabytes * wait.allowanceMsPerMB, wait.allowanceCapMs));
    progress(true);
    window._renderStarted = true;
    progress(true);
    await until(() => window._renderFinished === true, wait.renderWaitMs);

    const frame = capture(window, canvasPixels);
    if (runnerFailure !== undefined) throw runnerFailure;
    return await judge(name, { root, tolerance, output }, frame, errors, refused);
  } finally {
    window.close();
    for (const ref of state.contexts) release(state, ref);
  }
}

/** The viewport of upstream's test: 800×500 at device pixel ratio 1. */
function setViewport(window) {
  const sizes = { innerWidth: WIDTH, innerHeight: HEIGHT, outerWidth: WIDTH, outerHeight: HEIGHT, devicePixelRatio: 1 };
  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(window, name, { configurable: true, enumerable: true, writable: true, value });
  }
}

/**
 * `fetch`, `Request` and `Response` for the page, which jsdom does not
 * have: relative URLs resolve against the document, other origins are
 * refused, and bodies arrive as the page's own objects (`instanceof
 * ArrayBuffer` holds in the page, as three.js's loaders test).
 */
function installFetch(window, origin, refuse) {
  const base = () => window.document.baseURI;
  // The page's AbortSignal is jsdom's, which Node's Request does not accept.
  const nodeSignal = (signal) => {
    if (signal === undefined || signal === null || signal instanceof AbortSignal) return signal;
    const controller = new AbortController();
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    return controller.signal;
  };
  class Request extends globalThis.Request {
    constructor(input, init) {
      const url = input instanceof globalThis.Request ? input : new URL(String(input), base()).href;
      super(url, init === undefined ? init : { ...init, signal: nodeSignal(init.signal) });
    }
  }
  const inRealm = (buffer) => {
    const copy = new window.ArrayBuffer(buffer.byteLength);
    new window.Uint8Array(copy).set(new Uint8Array(buffer));
    return copy;
  };
  const pageResponse = (response) => {
    const bytes = () => globalThis.Response.prototype.arrayBuffer.call(response);
    return Object.assign(response, {
      arrayBuffer: async () => inRealm(await bytes()),
      blob: async () => new window.Blob([inRealm(await bytes())], { type: response.headers.get('content-type') ?? '' }),
      json: async () => window.JSON.parse(await globalThis.Response.prototype.text.call(response)),
    });
  };
  window.Request = Request;
  window.Response = globalThis.Response;
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (crossOrigin(request.url, origin)) {
      refuse(request.url);
      throw new window.TypeError('Failed to fetch');
    }
    if (request.url.startsWith('blob:')) {
      const blob = resolveObjectURL(request.url);
      if (blob === undefined) throw new window.TypeError('Failed to fetch');
      return pageResponse(new globalThis.Response(blob));
    }
    // A network failure rejects with the page's own TypeError, as a browser's does.
    let response;
    try {
      response = await fetch(request);
    } catch (failure) {
      throw new window.TypeError(`Failed to fetch: ${describe(failure)}`);
    }
    return pageResponse(response);
  };
}

/**
 * Stops the `DOMContentLoaded` and `load` events jsdom fires, which come
 * before module scripts run (jsdom does not run them), so the runner can
 * dispatch its own, kept in `held`, once they have. Resolves `parsed` at
 * jsdom's first `DOMContentLoaded` and `loaded` at its first `load`. Every
 * jsdom `load` is stopped, so the page sees one whatever the order of these
 * listeners and the shim's load-once guard.
 */
function holdLoadEvents(window, held) {
  let parsed;
  let loaded;
  const result = { parsed: new Promise((resolve) => (parsed = resolve)), loaded: new Promise((resolve) => (loaded = resolve)) };
  window.addEventListener(
    'DOMContentLoaded',
    (event) => {
      if (held.has(event)) return;
      event.stopImmediatePropagation();
      parsed();
    },
    true,
  );
  window.addEventListener(
    'load',
    (event) => {
      if (held.has(event) || event.target !== window.document) return;
      event.stopImmediatePropagation();
      loaded();
    },
    true,
  );
  return result;
}

/**
 * Runs the document's module scripts in order as `SourceTextModule`s in the
 * page's context (HTML §8.1.3.6), resolving specifiers through its import
 * map (HTML §8.1.5.3) and loading every module over HTTP from `origin`.
 * Evaluation is not awaited, as a browser does not wait for top-level
 * await before the next script; its errors go to `error`.
 */
async function runModules(dom, origin, refuse, error) {
  const { window } = dom;
  const context = dom.getInternalVMContext();
  const documentURL = window.document.URL;
  const map = importMap(window);
  const modules = new Map();
  const linking = new WeakMap();

  const resolveSpecifier = (specifier, referrer) => {
    const relative = /^(\/|\.\/|\.\.\/)/.test(specifier);
    let url;
    if (relative) url = new URL(specifier, referrer).href;
    else if (URL.canParse(specifier)) url = new URL(specifier).href;
    const mapped = lookup(map, url ?? specifier);
    if (mapped !== undefined) return mapped;
    if (url !== undefined) return url;
    throw new window.TypeError(`Failed to resolve module specifier "${specifier}"`);
  };
  const compile = (source, identifier, metaURL) =>
    new SourceTextModule(source, {
      context,
      identifier,
      initializeImportMeta: (meta) => {
        meta.url = metaURL;
      },
      importModuleDynamically: async (specifier, referrer) => {
        const module = await load(resolveSpecifier(specifier, referrer.identifier));
        await link(module);
        if (module.status === 'linked') await module.evaluate();
        return module;
      },
    });
  const fetchModule = async (url) => {
    if (crossOrigin(url, origin)) {
      refuse(url);
      throw new window.TypeError(`Failed to fetch module ${url}`);
    }
    let response;
    let source;
    try {
      response = await fetch(url);
      source = await response.text();
    } catch (failure) {
      throw new window.TypeError(`Failed to fetch module ${url}: ${describe(failure)}`);
    }
    if (!response.ok) throw new window.TypeError(`Failed to fetch module ${url}: HTTP ${String(response.status)}`);
    const file = new URL(url).pathname.split('/');
    if (file.at(-2) === 'build' && UUID_BUILDS.includes(file.at(-1))) {
      source = source.replaceAll('Math.random() * 0xffffffff', 'Math._random() * 0xffffffff');
    }
    return compile(source, url, url);
  };
  const load = (url) => {
    let module = modules.get(url);
    if (module === undefined) {
      module = fetchModule(url);
      modules.set(url, module);
    }
    return module;
  };
  const link = (module) => {
    let done = linking.get(module);
    if (done === undefined) {
      done = module.status === 'unlinked' ? module.link((specifier, referrer) => load(resolveSpecifier(specifier, referrer.identifier))) : Promise.resolve();
      linking.set(module, done);
    }
    return done;
  };

  const scripts = [...window.document.querySelectorAll('script[type="module"]')];
  for (const [index, script] of scripts.entries()) {
    try {
      const module = script.hasAttribute('src')
        ? await load(new URL(script.getAttribute('src'), documentURL).href)
        : compile(script.textContent, `${documentURL}#module-${String(index)}`, documentURL);
      await link(module);
      module.evaluate().catch((failure) => error(describe(failure)));
    } catch (failure) {
      error(describe(failure));
    }
  }
}

/** The document's import map: `imports` with keys and addresses resolved against the document. */
function importMap(window) {
  const base = window.document.baseURI;
  const imports = new Map();
  for (const script of window.document.querySelectorAll('script[type="importmap"]')) {
    const parsed = JSON.parse(script.textContent);
    for (const [key, address] of Object.entries(parsed.imports ?? {})) {
      const urlKey = /^(\/|\.\/|\.\.\/)/.test(key) ? new URL(key, base).href : key;
      imports.set(urlKey, new URL(address, base).href);
    }
  }
  return imports;
}

/** A specifier's address in an import map: an exact key, or the longest key ending in `/` that prefixes it. */
function lookup(imports, specifier) {
  if (imports.has(specifier)) return imports.get(specifier);
  let best;
  for (const key of imports.keys()) {
    if (key.endsWith('/') && specifier.startsWith(key) && (best === undefined || key.length > best.length)) best = key;
  }
  return best === undefined ? undefined : imports.get(best) + specifier.slice(best.length);
}

/**
 * The frame the document's one WebGL canvas holds, composited over the
 * page's background and halved, or `{ error }` naming what was found.
 */
function capture(window, canvasPixels) {
  const canvases = [...window.document.querySelectorAll('canvas')]
    .map((canvas) => canvasPixels(canvas))
    .filter((pixels) => pixels !== undefined);
  if (canvases.length === 0) return { error: 'the document has no WebGL canvas' };
  if (canvases.length > 1) return { error: `the document has ${String(canvases.length)} WebGL canvases; the frame cannot be captured from more than one canvas` };
  const [pixels] = canvases;
  if (pixels.width !== WIDTH || pixels.height !== HEIGHT) {
    return { error: `the WebGL canvas is ${String(pixels.width)}×${String(pixels.height)}, not ${String(WIDTH)}×${String(HEIGHT)}` };
  }
  const background = window.getComputedStyle(window.document.body).backgroundColor;
  return { frame: halve(composite(pixels, background)) };
}

/** The outcome message's fields, writing a failing example's images to `output`. */
async function judge(name, { root, tolerance, output }, { frame, error: captureError }, errors, refused) {
  let diffPercent;
  let mismatch;
  let expected;
  let diff;
  if (frame !== undefined) {
    const reference = join(root, 'examples', 'screenshots', `${name}.jpg`);
    expected = existsSync(reference) ? await decodeJpeg(readFileSync(reference)) : undefined;
    const result = expected === undefined ? undefined : compare(frame, expected);
    if (expected === undefined) mismatch = `no reference screenshot examples/screenshots/${name}.jpg`;
    else if (result === undefined) mismatch = `the reference is ${String(expected.width)}×${String(expected.height)}, the frame ${String(frame.width)}×${String(frame.height)}`;
    else if (!matches(result.percent, tolerance)) mismatch = `${result.percent.toFixed(2)}% of pixels differ (tolerance ${String(tolerance)}%)`;
    diffPercent = result?.percent ?? 100;
    diff = result?.diff;
  }
  const fault = errors[0] ?? captureError ?? mismatch;
  const outcome = fault === undefined ? 'PASS' : 'FAIL';
  if (outcome !== 'PASS' && output !== undefined && frame !== undefined) {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, `${name}-actual.png`), encodePng(frame));
    if (expected !== undefined) writeFileSync(join(output, `${name}-expected.png`), encodePng(expected));
    if (diff !== undefined) writeFileSync(join(output, `${name}-diff.png`), encodePng(diff));
  }
  return {
    outcome,
    message: fault,
    error: errors[0],
    extra: { diffPercent, imageOnly: errors.length === 0 && captureError === undefined && mismatch !== undefined, refused: refused[0] },
  };
}

/** Resolves once no request has been in flight for `idleMs`. */
async function waitForIdle(server, idleMs) {
  for (;;) {
    const { inFlight, lastChange } = server.activity();
    if (inFlight === 0 && performance.now() - lastChange >= idleMs) return;
    await sleep(50);
  }
}

/** Polls `test` every 100 ms; resolves to whether it held within `ms`. A throwing test throws. */
async function until(test, ms) {
  const end = performance.now() + ms;
  for (;;) {
    if (test()) return true;
    if (performance.now() >= end) return false;
    await sleep(100);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The child's entry point: runs the example named on the command line. */
export async function main(hooks = {}) {
  const [name, options = '{}'] = process.argv.slice(2);
  // The IPC channel does not keep a child alive on its own; hold it open so
  // an example that stalls waits for the parent's time limit.
  process.channel?.ref();
  try {
    const result = await runExample(name, JSON.parse(options), hooks);
    process.send?.({ type: 'outcome', ...result }, () => process.exit(0));
  } catch (failure) {
    process.send?.({ type: 'harness-error', message: describe(failure) }, () => process.exit(1));
  }
}

if (import.meta.main) await main();
