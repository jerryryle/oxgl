# Design

## Context

- The JS layer keeps a context's state (bindings, mirrors, enabled extension objects) in one `ContextState` object, and each WebGL object records the state object of the context that created it; a call with an object whose owner is not the context's current state generates `INVALID_OPERATION`.
- `oxgl-core` marks a context lost when `loseContext()` runs or when ANGLE reports a reset, and its error state reports `CONTEXT_LOST_WEBGL` once.

## Decisions

### Restoring swaps in a new state object

Restoring creates a new native context through the same native export as `createContext`, with the backend that served the first one, its version and attributes, and the canvas's current size, then replaces the context's `ContextState` with a fresh one and destroys the old native context. Objects created before keep the old state as owner, so the existing ownership check makes them invalid (`INVALID_OPERATION`) without a generation counter. Extension objects of the old state act on a destroyed state and do nothing; `WEBGL_lose_context` is carried into the new state's extension map, and its methods act on the context's current state, so the same object keeps working across restores (WebGL 1.0 §5.15.2: all extensions but `WEBGL_lose_context` are disabled).

### When loss is observed and events fire

`loseContext()` loses the context at once. A backend loss is observed when JS next asks native code (`isContextLost()`, `getError()` and any call that returns a lost result go through the same check). Observing a loss the first time queues one `setTimeout(…, 0)` task that fires `webglcontextlost` at the canvas with `dispatchEvent`, when the canvas has it. If the event was cancelled, the context becomes restorable: a backend loss is restored in the next task, a simulated one waits for `restoreContext()`. Restoring fires `webglcontextrestored` after the new state is in place.

### Errors while lost

Chromium reports errors generated on a lost context after `CONTEXT_LOST_WEBGL`, and the conformance pages rely on it for `WEBGL_lose_context` (`loseContext()` on a lost context, `restoreContext()` without a cancelled event). Every other call on a lost context must stay a silent no-op, so `oxgl-core` keeps dropping errors while lost, and the JS state queues the two `WEBGL_lose_context` errors, which `getError()` returns once native code reports `NO_ERROR`.

### Safety rules

- No `unsafe` and no new native exports: restoring uses the existing `createContext` and `destroy` exports, and no Rust changes.
- No panics: a restore whose context creation fails leaves the context lost, as a lost device would.
- Handle model: the old native context is destroyed on restore; its objects' keys name a destroyed context, which native code already treats as stale.

## Risks / Trade-offs

- [A backend loss is noticed only when JS next calls in] → Node has no compositor to notice it sooner; pages see the event one task after their next call, which the spec allows ("when the user agent detects").
