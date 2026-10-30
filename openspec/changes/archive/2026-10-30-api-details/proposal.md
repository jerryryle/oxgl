# Proposal

## Why

The last Khronos pages that fail on API behavior, rather than on the headless environment, need small corrections: a `clientWaitSync` timeout above the maximum is `INVALID_OPERATION`, not `INVALID_VALUE`; a query never begun has no result; deleting an active query leaves its target active in GL; `DEPTH_STENCIL` is not a multisampled renderbuffer format; `vertexAttribIPointer` without a buffer accepts only offset 0; and WebGL 1's `DEPTH_STENCIL_ATTACHMENT` name query failed on ES 2.0.

## What Changes

- `clientWaitSync` with a timeout above `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` generates `INVALID_OPERATION` (WebGL 2.0 §3.7.14).
- `getQueryParameter` on a query never begun generates `INVALID_OPERATION`; `deleteQuery` on an active query ends it first, as Chromium does.
- `renderbufferStorageMultisample` with `DEPTH_STENCIL` and samples above 0 generates `INVALID_OPERATION`.
- `vertexAttribPointer` and `vertexAttribIPointer` with no `ARRAY_BUFFER` and a nonzero offset generate `INVALID_OPERATION` (WebGL 1.0 §6.4).
- On WebGL 1, the `DEPTH_STENCIL_ATTACHMENT` object name comes from the depth point's type, as ES 2.0 cannot be asked about the combined point.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webgl2-objects`, `framebuffers`, `drawing`.

## Impact

- `crates/oxgl-core`, `src/context.ts`; no ABI change.
