# Tasks

## 1. JS layer

- [x] 1.1 Add `WebGLContextEvent`, the observed-loss task, restoring onto a new native context with a new `ContextState`, and `WEBGL_lose_context.restoreContext`. Add `WebGLContextEvent` to the conformance page's globals. Add `test/context-loss.test.mjs` scenarios for every requirement of the delta, and type checks. Verify with `OXGL_BACKEND=software npm test` on Linux arm64 (Docker) and `npm run lint`.

## 2. Conformance results

- [x] 2.1 On Linux arm64 (Docker), run both suites with `--update`, refresh reasons, commit `conformance/expectations.txt`, and record counts.
- [x] 2.2 Run `npx openspec validate context-loss --type change --strict`, `npm run lint`, clippy and `npm test`, and confirm that all pass.

## Results

`conformance/context/context-lost-restored.html` and `context-lost.html` pass on both suites, as do `context-type-test.html` and `incorrect-context-object-behaviour.html`, fixed along the way (flat interface prototypes; `is*` on another context's object returns `false` without an error).
