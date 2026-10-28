# Proposal

## Why

The conformance harness shows 3,723 of the 3,822 entries in `conformance/expectations.txt` failing before any test runs. They all fail at the same point: the Khronos helper `sdk/tests/js/webgl-test-utils.js` runs a self-check when it loads (line 3825 at the pinned commit) that calls `glEnumStr(GL.POINTS)` with `GL = WebGLRenderingContext`. oxgl defines only the 12 constants its current members use. Those 12 are already on the interface objects and prototypes, but `POINTS` is not one of them. `glEnumToString(undefined)` throws, so the helper never finishes loading.

The recorded reason (`WebGLRenderingContext has no static WebIDL constants (reads GL.RGBA)`) is slightly off. The interface objects do have static constants, but only a partial set. The fix is the same either way: expose every constant the WebGL IDL declares, as WebIDL §3.7.1 (constants) and WebGL 1.0 §5.14 / WebGL 2.0 §3.7 require. Until that lands, every later API change's conformance results stay hidden behind this one failure.

## What Changes

- Expose the complete WebGL 1 constant set (the 297 constants of the `WebGLRenderingContextBase` mixin) on `WebGLRenderingContext` and its prototype. Expose the complete WebGL 2 set (those plus the 262 of `WebGL2RenderingContextBase`, 559 in all) on `WebGL2RenderingContext` and its prototype. Use the WebIDL property attributes oxgl already uses for constants. WebGL 1 does not get the WebGL 2-only constants.
- Generate the constant tables from the Khronos IDL files (`specs/latest/1.0/webgl.idl`, `specs/latest/2.0/webgl2.idl`) at the commit the conformance suite is pinned to. A small script writes a checked-in `src/generated/webgl-constants.ts`. The TypeScript declarations come from the tables' types instead of one hand-written line per constant.
- Teach the conformance page loader to inline the generated module alongside `dist/context.js`.
- Replace the three per-capability constant requirements (`error-reporting`, `pixel-readback`, `drawing`) with one `context-creation` requirement that covers the full sets.
- Rerun both conformance suites with `--update` and review the reasons that surface once the helper loads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-creation`: adds the requirement that both context interfaces expose their complete WebGL IDL constant sets on the interface object and prototype.
- `error-reporting`: removes "Error constants", now covered by the `context-creation` requirement.
- `pixel-readback`: removes "Readback constants", now covered by the `context-creation` requirement.
- `drawing`: removes "Constants for drawing members", now covered by the `context-creation` requirement.

## Impact

- `src/context.ts`: the `CONSTANTS` table and per-constant `declare` lines are replaced by the generated tables. Each class gets its own set.
- New `src/generated/webgl-constants.ts` and `scripts/webgl-constants.mjs`.
- `conformance/page.mjs`: `contextSource()` inlines the generated module.
- `conformance/expectations.txt`: most entries change reason or disappear. `conformance/context/constants-and-properties.html` and `conformance2/context/constants-and-properties-2.html` are expected to pass.
- Public API: about 550 new read-only numeric properties on each context class and its instances. They only add to the API; no existing value changes. `WebGL2RenderingContext` starts exposing WebGL 2-only constants that the current table lacks.
- No native code changes and no new dependencies.

## Out of Scope

- Extension constants (for example `OES_vertex_array_object.VERTEX_ARRAY_BINDING_OES`) belong to the extension objects and the extensions change.
- Members that the constants name (`getParameter`, `bindBuffer`, …) belong to their own capability changes. This change only makes their conformance pages report their real failures.
- A general WebIDL generator for members. The generator here reads only constants. The `src/generated/` seam stays open for a wider generator later.
