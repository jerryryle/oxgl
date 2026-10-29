# Design

## Context

See proposal.md for the failure and its cause. The parts of the pinned suite that matter:

- `closure-library/closure/goog/base.js` (uncompiled, `goog.ENABLE_DEBUG_LOADER` true). `goog.require(name)` looks the name up in the dependency table that `deqp/deqp-deps.js` fills with `goog.addDependency`, then `goog.writeScripts_` walks the requirements depth-first and calls `goog.importScript_(src)` once per file, dependencies first. `goog.importScript_` calls `goog.global.CLOSURE_IMPORT_SCRIPT` if it is set and `goog.writeScriptTag_` (`document.write`) otherwise. A `true` return marks the file as written so it is never imported twice. At load, base.js also imports its own `deps.js` through the same function.
- `src` is the URL of `base.js`'s directory joined with the relative path from `deqp-deps.js`. In jsdom `script.src` is absolute, so it is an absolute `http://127.0.0.1:<port>/…` URL on the runner's own server.
- No deqp file is a `goog.module` (every `addDependency` call passes `false`), so the source-text form of the hook, `CLOSURE_IMPORT_SCRIPT('', text)`, is not used by this suite. The hook returns `false` for it, so that form loads nothing, as Closure's own loader does outside an HTML document.

jsdom 30.1.3 behaviour, read from its source and checked against the pinned suite:

- The parser queues each parser-inserted script in a FIFO per-document resource queue (`browser/resources/resource-queue.js`). Only a script with nothing queued before it runs during parsing. Everything after the page's first external script, here `js-test-pre.js`, waits until the whole document is parsed.
- A script written by `document.write` from a running script is parsed in a scratch `<div>`, moved after the writing script, and fetched. The fetch is appended to the queue's tail, behind the already-queued `<body>` script.
- A `<script>` element without `src` that a script inserts (not parser-inserted) runs synchronously inside the insertion call (`HTMLScriptElement-impl.js`, `_fetchInternalScript`). An uncaught error in it is reported like any other: the window's virtual console gets an `unhandled-exception` `jsdomError`, which the child already records as the page's escaped error, and the inserting call continues.

## Decisions

### Load through `CLOSURE_IMPORT_SCRIPT`, reading files from the suite root

`installShim` sets `window.CLOSURE_IMPORT_SCRIPT = (src, text) => …`:

1. Resolve `src` against the window's URL. If it is not same-origin with the page, return `false`. Closure then neither loads nor marks the file, and the missing namespace fails the page as a failed load would in a browser.
2. If `text` is given, return `false` (see Context). Otherwise read the file with `readFileSync` from the suite root, using the path resolution `server.mjs` already applies to requests (exported from there, so the two cannot disagree about what is inside the root). A missing file or a path outside the root returns `false`, the equivalent of a 404.
3. Create a `<script>` element, set its text to the source followed by `//# sourceURL=<src>` so stack traces and recorded errors name the deqp file and not the page, append it to `document.head`, and return `true`.

This gives browser order. Each required file runs inside `goog.require`, dependencies first, so the namespaces exist when the `<head>` script returns and before the parser-queued `<body>` script runs. It also gives browser error semantics. An error in one file is an escaped error of the page, reported as one, and loading continues with the next file. In a browser, too, each written script fails on its own. Being a global the page can see does not matter: only Closure reads it, and no other suite page loads Closure.

The suite root reaches the child as a `root` field in the options JSON it already receives (`pool.mjs`), set by `run.mjs` from the directory it serves. `runPage` stores it in `state`, which `installShim` already receives for the page and for every frame window, so frames that load Closure get the same hook.

Inserting the script has one jsdom side effect. Its `_innerEval` sets `document._writeAfterElement` to itself and deletes it afterwards, which also clears the marker the requiring script set. A `document.write` later in that same script would then be written into the last open element instead of after the script. No page in the pinned suite calls `document.write` outside Closure (proposal.md), so this is accepted, not worked around (Accepted trade-offs).

Checked in jsdom 30.1.3: an error thrown by, or a SyntaxError in, a script ending in `//# sourceURL=<src>` is reported with `<src>` in its stack or location, not the page URL. Prototyped outside the repository against the pinned suite: with the hook, `functional` and `modules` are defined at the `<body>` script of `attriblocation.html`, `arrays.html` and `textureformat/unsized_2d.html`, and each page goes on to its first WebGL call.

Alternatives considered:

- **Sync XHR inside the hook.** No new child option and no file reading, but jsdom implements synchronous XHR by spawning a Node process per request, and a deqp page imports 8 to 40 files (`textureformat/unsized_2d.html`: 37). That adds seconds of process startup to each of about 780 pages, for no gain over reading the file the server would read anyway.
- **Make jsdom run written scripts in parser order.** This would mean patching jsdom's internal `ResourceQueue` or `document.write` so a written script is inserted ahead of scripts queued after its writer. These internals are private, deeper than the `createWindow` hook the child already wraps, and would change behaviour for every page to fix one loader. The hook is Closure's own documented extension point for loading scripts without `document.write`.
- **Override `goog.writeScriptTag_` after base.js loads.** That needs a hook between two parser-queued scripts, and base.js already calls `goog.importScript_` for `deps.js` while it loads. `CLOSURE_IMPORT_SCRIPT` is read at call time and can be set before parsing.
- **Compile deqp with the Closure compiler.** The suite's `run-closure.sh` is for type checking and its output is discarded (`deqp/README.md`). A compiled bundle would be code the official harness never runs.

## Risks / Trade-offs

- **Time per run.** Pages that failed instantly will now run until they fail on a missing oxgl call, or run their cases. Expected-`FAIL` pages end at their first escaped error, but deqp's test runner catches most case exceptions and reports them as failures, so some pages may report for a long time. The expectations rerun records each suite's wall-clock time. If the `webgl2` job grows by more than about half, the rerun task brings that back for a decision (for example a `SKIP` for the slowest directories) instead of accepting it silently.
- **Reasons churn.** About 780 entries change their reason in one diff. They are generated by `--update`. The review task samples the distinct reasons rather than reading each entry.

## Accepted trade-offs

- A `document.write` by a page script after it calls `goog.require` is misplaced, because jsdom clears its writer marker when an imported script runs. No pinned page does this.
- A `goog.require` from `DOMContentLoaded` on still loads its file, where a browser fails the page (Closure throws after `load`, and its `document.write` wipes the page before it). No pinned page requires that late.

A file that cannot be read is not a trade-off: it fails the page the same way a failed script load fails it in a browser.
