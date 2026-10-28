# Tasks

## 1. Constant tables

- [ ] 1.1 Write `scripts/webgl-constants.mjs`. It fetches `specs/latest/1.0/webgl.idl` and `specs/latest/2.0/webgl2.idl` at the commit in `conformance/suite.json` and writes `src/generated/webgl-constants.ts`: `WEBGL1_CONSTANTS` from the `WebGLRenderingContextBase` mixin and `WEBGL2_CONSTANTS` from that plus `WebGL2RenderingContextBase`, both `as const`, with a header naming the source commit. Make it fail on a constant it cannot parse or a name declared twice. Run it and verify 297 and 559 entries, `POINTS === 0`, `INVALID_INDEX === 0xFFFFFFFF` and `TIMEOUT_IGNORED === -1`. Then confirm that running it again leaves the file unchanged.
- [ ] 1.2 Check the IDL files' licence header against what the generated file contains, add any notice it requires to the generated header, and verify that `npm run lint:licenses` passes.

## 2. Context classes

- [ ] 2.1 In `src/context.ts`, replace `CONSTANTS`, the per-constant `declare` lines and `ConstantsDeclared` with the generated tables. Define `WEBGL1_CONSTANTS` on `WebGLRenderingContext` and its prototype and `WEBGL2_CONSTANTS` on `WebGL2RenderingContext` and its prototype, with the current attributes. Derive the instance and static declarations from the tables' types (design: "Types derived from the tables"). Point `getError`'s `NO_ERROR`/`CONTEXT_LOST_WEBGL` uses at the generated table. Verify with `npm run build` and that the emitted `.d.ts` declares `RGBA` on both classes and both instance types, and `READ_BUFFER` only on the WebGL 2 ones.
- [ ] 2.2 Update `contextSource()` in `conformance/page.mjs` to inline `dist/generated/webgl-constants.js` (design: "Conformance loader inlines the generated module"), and adjust its `export class` rewrite if 2.1 changed how the classes are exported. Verify that `npm test` passes, harness tests included, and that `npm run conformance -- --filter conformance/context/constants-and-properties` passes the WebGL 1 page.
- [ ] 2.3 Add tests for each scenario of the `context-creation` requirement "WebGL IDL constants" that can run without the suite: interface-object values, property descriptors on both classes and prototypes, no own property on instances, and WebGL 2-only constants absent from WebGL 1, in `test/context-creation.test.mjs`; the declaration checks in `test/types.ts`. Verify that `npm run lint` and `npm test` (with `OXGL_BACKEND=software`) pass.

## 3. Conformance results

- [ ] 3.1 On Linux arm64 (a Pi 5, or the `conformance` CI job with a temporary `--update` step, as task 5.1 of `conformance-harness` did), run both suites with `OXGL_BACKEND=software npm run conformance -- --update`, and commit the rewritten `conformance/expectations.txt`. Verify that `conformance/context/constants-and-properties.html` and `conformance2/context/constants-and-properties-2.html` have no entry, that no entry still has the `webgl-test-utils.js fails at load` reason, and that a plain `npm run conformance` then passes. Record the number of entries before and after in this task.
- [ ] 3.2 Review the new reasons. Group them by reason, confirm that each large group is a missing member or an out-of-scope feature (DOM media, canvas resizing, extensions) and not a harness or constants defect, and fix any group this change caused. Record the largest groups and their page counts in this task as input for ordering the next API changes.
- [ ] 3.3 Run `npx openspec validate webgl-idl-constants --strict`, `npm run lint` and `npm test`, and confirm that all three pass.
