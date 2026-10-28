# Design

## Context

`src/context.ts` holds a 12-entry `CONSTANTS` table and defines each entry on both context classes and both prototypes with `{ writable: false, enumerable: true, configurable: false }`, the attributes of WebIDL §3.7.1. Each constant also needs two hand-written `declare` lines, and a compile-time check (`ConstantsDeclared`) ties them to the table. That approach does not scale to 559 constants. Both classes also share one table, but WebGL 1 and WebGL 2 need different sets.

The conformance runner (`conformance/page.mjs`, `contextSource()`) evaluates `dist/context.js` in the page's realm. It strips the one `native` import and rejects any other import or export.

## Goals / Non-Goals

**Goals:** the complete constant set of each IDL on its interface object and prototype, values identical to the IDL, TypeScript declarations for all of them, and a single source that is cheap to refresh when the suite pin moves.

**Non-Goals:** extension constants, the members the constants are used with, and a general IDL-to-TS generator.

## Decisions

### Tables generated from the Khronos IDL, checked in

`scripts/webgl-constants.mjs` fetches `specs/latest/1.0/webgl.idl` and `specs/latest/2.0/webgl2.idl` from `KhronosGroup/WebGL` at the commit in `conformance/suite.json`. It collects the `const <type> NAME = value;` members of the `WebGLRenderingContextBase` and `WebGL2RenderingContextBase` mixins and writes `src/generated/webgl-constants.ts` with two `as const` tables: `WEBGL1_CONSTANTS` (297 entries) and `WEBGL2_CONSTANTS` (the WebGL 1 entries plus 262, 559 in all). The header names the source commit.

- *Why the suite commit:* the conformance pages that check constants (`constants-and-properties*.html`) come from the same commit, so tables and tests cannot disagree.
- *Why not hand-written:* transcribing 559 values is error-prone, and the IDL is the normative list (WebGL 1.0 §5.14, WebGL 2.0 §3.7).
- *Why checked in, with no CI drift check:* the build stays offline, and the constants pages already fail if the tables drift from the pinned suite. The script runs only when the pin moves.
- *Why fetch rather than reuse the suite cache:* the cache is a sparse checkout of `sdk/tests` only. Widening it for two files would change the harness for a script that runs rarely.

Values are emitted as the IDL writes them (hex stays hex). `INVALID_INDEX` is `0xFFFFFFFF` and `TIMEOUT_IGNORED` (`GLint64`) is `-1`. Both are plain JS numbers, per the WebIDL conversion of a constant's value.

Licensing: the tables hold constant names and numeric values (interface facts, which the spec requires implementations to expose verbatim) and copy no IDL text. Any notice the IDL's MIT-style licence would still require goes into the generated file's header, and `npm run lint:licenses` must stay green.

### Each class gets its own set; attributes unchanged

`WebGLRenderingContext` and its prototype get `WEBGL1_CONSTANTS`. `WebGL2RenderingContext` and its prototype get `WEBGL2_CONSTANTS`. The existing `defineProperty` loop is kept, with the same attributes, run once per class with that class's table. Instances inherit the constants from the prototype and hold no own copies, as in browsers.

### Types derived from the tables

The per-constant `declare static` and `declare` lines and `ConstantsDeclared` are removed. The instance side uses interface merging with the class (`interface WebGLRenderingContext extends Readonly<typeof WEBGL1_CONSTANTS> {}`). The static side is typed as the constructor intersected with the table type. The emitted `.d.ts` must declare every constant with its literal type on both sides. `test/types.ts` checks this, including that a WebGL 2-only constant is absent from `WebGLRenderingContext`. If the static typing would change how `context.ts` exports the classes (for example to `export const`), the runner's `export class` rewrite is updated in the same task.

### Conformance loader inlines the generated module

`contextSource()` reads `dist/generated/webgl-constants.js`, strips its `export` keywords, prepends it to the context body and removes the matching import. Its guard still rejects any other import or export, so the loader still cannot silently diverge from the published module graph.

### One requirement instead of three

The `error-reporting`, `pixel-readback` and `drawing` capabilities each list the few constants their members use. With complete sets, those lists become subsets of a single `context-creation` requirement ("WebGL IDL constants"), which cites WebIDL §3.7.1 and the IDL instead of listing values. The three are removed so the constants have one source of truth. The drawing scenario's interface-object check moves into the new requirement.

## Risks / Trade-offs

- **The expectations churn heavily.** About 3,700 reasons change in one diff. That is the point of the change. Task 3.2 reviews the new reasons by group rather than line by line.
- **The IDL can name constants for features oxgl lacks** (for example compressed texture formats). The WebGL spec requires them anyway, and the constants pages check them. Exposing a constant promises nothing about the member that uses it.
- **Fetching IDL from GitHub in the script.** It is a developer-only, offline-safe step. If the fetch fails the script fails, and the checked-in file stays as it was.

## Migration Plan

Additive API change. Code that read the 12 existing constants sees the same values. No rollback concerns beyond reverting the commit.

## Open Questions

None.
