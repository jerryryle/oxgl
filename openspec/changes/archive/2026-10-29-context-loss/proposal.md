# Proposal

## Why

A WebGL context can lose its drawing buffer, and `WEBGL_lose_context` lets pages and test suites simulate that. oxgl reports a lost context through `isContextLost()` and `getError()`, but fires no `webglcontextlost` or `webglcontextrestored` event and cannot restore a context, so `WEBGL_lose_context.restoreContext()` always fails. Applications that handle loss (three.js listens for both events) and the Khronos pages under `conformance/context` need the full sequence of WebGL 1.0 §5.15.

## What Changes

- **Lost event** (WebGL 1.0 §5.15.2): when oxgl observes a loss, by `loseContext()` or from the backend, it queues a task that fires a cancelable `webglcontextlost` `WebGLContextEvent` at the context's canvas (the `HeadlessCanvas` or the caller's canvas). Cancelling it allows restoring.
- **Restore** (WebGL 1.0 §5.15.3): `restoreContext()` on a context lost by `loseContext()` whose lost event was cancelled queues the restore; a backend loss whose event was cancelled is restored at once. Restoring creates a new native context with the original creation parameters and the canvas's size, starts over with fresh state (no bindings, no enabled extensions except `WEBGL_lose_context`), and fires `webglcontextrestored`. Objects created before the restore stay invalid for the restored context.
- **Errors while lost**: after `CONTEXT_LOST_WEBGL` has been reported, the `INVALID_OPERATION` of `loseContext()` on a lost context or of a refused `restoreContext()` is reported by `getError()`, as Chromium does; other calls on a lost context stay silent no-ops.
- **`WebGLContextEvent`** is exported, constructible as its IDL defines.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-loss`: events, restoring and `WEBGL_lose_context`.

## Impact

- `src/`: the loss and restore sequence, `WebGLContextEvent`, `WEBGL_lose_context`.
- `conformance/page.mjs`: `WebGLContextEvent` among the page's globals.

## Out of Scope and Extension Points

- **Restoring a context destroyed with `destroy()`**: `destroy()` frees the native context for good; it is lost and never restored, and fires no event.
