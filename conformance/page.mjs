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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';

import { JSDOM, VirtualConsole } from 'jsdom';

import { native } from '../dist/native.js';

import { resolveFile } from './server.mjs';

const CONTEXT_URL = new URL('../dist/context.js', import.meta.url);
const CONSTANTS_URL = new URL('../dist/generated/webgl-constants.js', import.meta.url);

// jsdom gives a frame a new window each time it navigates, through this
// module's createWindow, and offers no public hook for it.
const jsdomWindow = createRequire(import.meta.url)('jsdom/lib/jsdom/browser/Window.js');

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
  process.on('unhandledRejection', () => {});

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
    resources: 'usable',
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

/**
 * dist/context.js as a function body returning its exports; computed once per
 * process. The generated constants module it imports is inlined on the import's
 * line, joined into one line so stack traces keep context.js line numbers.
 */
function contextSource() {
  const constants = readFileSync(CONSTANTS_URL, 'utf8')
    // The generated module holds no strings, so every `//` starts a comment.
    .replace(/\/\/.*$/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/\s*\n\s*/g, ' ');
  const body = readFileSync(CONTEXT_URL, 'utf8')
    .replace("import { native } from './native.js';", '')
    .replace(/^import \{[^}]*\} from '\.\/generated\/webgl-constants\.js';$/m, constants)
    .replace(/^export (class|function|const) /gm, '$1 ');
  if (/^\s*(import|export)\b/m.test(body)) {
    throw new Error('dist/context.js has imports or exports the conformance runner does not handle');
  }
  return `${body}\nreturn { createContext, WebGLRenderingContext, WebGL2RenderingContext };`;
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

/** Installs the canvas shim, the context class globals, Closure's loader hook and failing media. */
function installShim(window, state) {
  const { createContext, WebGLRenderingContext, WebGL2RenderingContext } = loadOxgl(window);
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
  window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
    const version = WEBGL_TYPES[String(type)];
    const existing = contexts.get(this);
    if (existing) return existing.version === version ? existing.gl : null;
    if (version === undefined) return null;
    let gl;
    try {
      gl = createContext({ width: this.width, height: this.height, webgl2: version === 2 });
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
  window.WebGLRenderingContext = WebGLRenderingContext;
  window.WebGL2RenderingContext = WebGL2RenderingContext;
  if (state.root !== undefined) window.CLOSURE_IMPORT_SCRIPT = closureImport(window, state.root);
  failMedia(window);
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
 * Without the optional `canvas` package jsdom never loads images or media,
 * and never fires `load` or `error`. Fire `error` on the next task after a
 * source is set, so pages that wait for media fail promptly.
 */
function failMedia(window) {
  const failed = new WeakSet();
  const fail = (element) => {
    failed.add(element);
    window.setTimeout(() => element.dispatchEvent(new window.Event('error')), 0);
  };
  const isMedia = (node) =>
    node instanceof window.HTMLImageElement || node instanceof window.HTMLMediaElement;

  for (const proto of [window.HTMLImageElement.prototype, window.HTMLMediaElement.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!descriptor?.set) continue;
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
    window.document.querySelectorAll('img, video, audio').forEach(failInserted);
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
