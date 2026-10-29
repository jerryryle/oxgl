# Proposal

## Why

The harness's own runner keeps every Khronos `deqp/` page from reaching a WebGL call. After `webgl-idl-constants` (jerryryle/oxgl#22) made `webgl-test-utils.js` load, CI run 40783921762 showed 718 pages under `deqp/functional/gles3/` failing with `ReferenceError: functional is not defined` and 64 under `deqp/data/` (the `gles2` shader pages in `webgl1`, the `gles3` ones in `webgl2`) failing with `modules is not defined`. So about 780 of the 3,836 page runs measure the runner, not oxgl. For the WebGL 2 suite, the deqp pages are most of the API coverage beyond `conformance2/`.

Each deqp page loads `closure-library/closure/goog/base.js` and `deqp/deqp-deps.js` in its `<head>`, then calls `goog.require('functional.gles3.…')` from an inline script. A later inline script in `<body>` uses that namespace. Uncompiled Closure loads each required file by calling `document.write('<script src=…>')` (`goog.writeScriptTag_`). A browser treats a script written this way as parser-blocking: it runs before the parser moves past the writing script (HTML Standard §8.4.3 `document.write()`, §4.12.1.1 "prepare the script element"). The official harness runs pages in a browser iframe, so the namespace exists by the time `<body>` runs.

jsdom (30.1.3) does run the written scripts, but too late. It parses the whole document before running any script queued behind an external one. It then appends each written script to the end of its per-document resource queue, behind the `<body>` script the parser already queued. That script runs first and throws. Reproduced locally against the pinned suite: `attriblocation.html` throws `functional is not defined` at its `<body>` script, and `functional` exists once the page settles.

## What Changes

- The page child sets Closure's documented loader hook, `CLOSURE_IMPORT_SCRIPT`, on every window it shims. Closure calls the hook in place of `goog.writeScriptTag_` and offers it for exactly this case: a context where `document.write` will not load scripts. The hook reads the requested file from the suite root through the same path resolution as the runner's server. It then runs the file at once as an inline `<script>` element inserted into the document, which jsdom runs synchronously and which reports errors through the page's normal error path. Required files therefore run in dependency order, before `goog.require` returns, as they do in a browser.
- The child is told the suite root alongside its existing options.
- The deqp expectations are regenerated, and the reasons that appear once the pages load are reviewed.

## Capabilities

### Modified Capabilities
- `conformance-testing`: adds a requirement that scripts a page loads through Closure's debug loader run in the order a browser runs them.

## Impact

- `conformance/page.mjs` (the hook), `conformance/server.mjs` (exports its path resolution), `conformance/pool.mjs` and `conformance/run.mjs` (pass the suite root), a fixture page and a test in `test/conformance-harness.test.mjs`, and `conformance/expectations.txt`.
- No change to oxgl's API or native code.
- Depends on `webgl-idl-constants` landing first. Until it does, `webgl-test-utils.js` still fails before any deqp page reaches `goog.require`, so the expectations rerun waits for it.
- CI time: deqp pages that now load run until their first escaped error (they are expected `FAIL`, so they end early) or report many cases. The rerun records each suite's wall-clock time against the current 447 s / 1,139 s.

## Out of Scope

- Making deqp pages pass. They fail on whatever oxgl lacks, and later API changes remove their entries.
- General `document.write` ordering in jsdom. Outside Closure itself, no page or script in the pinned suite calls `document.write`. If a later pin adds one, it shows up in the expectations rerun.
