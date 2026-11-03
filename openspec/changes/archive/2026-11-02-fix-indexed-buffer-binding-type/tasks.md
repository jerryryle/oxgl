# Tasks

## 1. Record the type only for a bind that took effect

- [x] 1.1 Add the `buffers` scenarios "Empty bindBufferRange", "Misaligned bindBufferRange", "Out-of-range index" and "Accepted bind still types the buffer" to `test/webgl2-objects.test.mjs`. The misaligned case takes its offset from `getParameter(UNIFORM_BUFFER_OFFSET_ALIGNMENT) / 2` and is skipped (`t.skip`) when the alignment is 1. Verify with `node --test test/webgl2-objects.test.mjs` that the first three fail on the current code and the fourth passes.
- [x] 1.2 In `bind_buffer_indexed` (`crates/oxgl-core/src/webgl2.rs`), check `target_allowed` without changing the buffer, make the GL call, and set an `Unbound` buffer's kind to `Other` only when the binding check that follows it passes. Verify that `cargo clippy --workspace --all-targets --locked -- -D warnings` is clean and that, after `npm run build`, all four scenarios pass.

- [x] 1.3 Add the `buffers` scenario "Rejected rebind of the buffer at that index" to `test/webgl2-objects.test.mjs` and verify that it fails on the code after 1.2. Then make `bind_buffer_indexed` decide success with `accepted` instead of reading the indexed binding back, recording the type only on success. Verify with clippy pedantic and, after `npm run build`, that all five scenarios pass.

## 2. Integration

- [x] 2.1 Run `npm run lint` and `npm test` on macOS arm64. Then run `npm run conformance -- --filter conformance/buffers/`, `npm run conformance -- --suite webgl2 --filter conformance2/buffers/`, `npm run conformance -- --suite webgl2 --filter conformance2/transform_feedback/` and `npm run conformance -- --suite webgl2 --filter conformance2/uniforms/`, and verify that each prints `conformance: ok`.
- [x] 2.2 Validate with `npx openspec validate fix-indexed-buffer-binding-type --strict`.

## Workflow follow-up

- Linux arm64 and the other platforms are covered by the pull request's CI. Per CLAUDE.md, a macOS result does not stand in for Linux arm64.
- Archive the change once it is reviewed and CI passes.
