# Tasks

Pushing either repository, running `angle-build` and publishing the release are outward-facing. Each waits for the user's go-ahead.

## 1. Recipe (jerryryle/oxgl-angle)

- [x] 1.1 Add `angle/patches/swiftshader-high-precision-filtering.patch` (paths relative to the ANGLE root) that adds `SWIFTSHADER_HIGH_PRECISION_FILTERING` to `swiftshader_libvulkan_private_config` unconditionally, keeping the crbug.com/726075 comment.
- [x] 1.2 Apply every `angle/patches/*.patch` in `build.sh` and `build.ps1` before `gn gen`: skip a patch whose reverse applies (already applied), otherwise `git apply` it and fail if that fails.
- [x] 1.3 Add `angle/patches/*` to the recipe paths in `angle-build.yml`, list `patches/` in the recipe's `angle/README.md`, and bump `bundle_version` to `angle-8078.3`.

## 2. Local verification (Linux arm64)

- [x] 2.1 Build the `linux-arm64` bundle locally with `angle/build.sh all linux-arm64`, cross-compiled in a `linux/amd64` container as CI does (Chromium publishes no Linux arm64 host clang).
- [x] 2.2 With `OXGL_ANGLE_DIR` pointing at it, in a `linux/arm64` container: the white-texel repro prints `exact` for WebGL 1 and 2 under `OXGL_BACKEND=software`, and `npm run conformance -- --filter uniform-default-values` reports `expected FAIL, got PASS` on both suites.
- [x] 2.3 `npm test` passes, and the full conformance suite with `--update` changes only the `uniform-default-values` entries. Record whether the deqp `unary_operator_00` result changes and any other shift. *(2026-10-30, Node 24: `npm test` 293 pass, 6 skipped. Full suite: webgl1 969/971, webgl2 2861/2865; only `uniform-default-values` changed. `unary_operator_00` still fails the same way. A first run under Node 22 also failed the six `conformance2/wasm/*-16gb-wasm-memory` pages with a BigInt `TypeError`; they pass on Node 24, which CI uses.)*
- [x] 2.4 Run `npm run bench` with `OXGL_BACKEND=software` on `angle-8078.2` and on the new bundle and record the difference. *(No `npm run bench` case samples a filtered texture; all its cases are within run-to-run noise. A scratch full-screen 512×512 draw sampling a 256×256 `RGBA8` texture: `LINEAR` 3844–3859 → 4031–4036 draws/s (about 5% faster), `NEAREST` unchanged at about 6030.)*

## 3. oxgl

- [x] 3.1 Remove the `uniform-default-values` entries from `conformance/expectations.txt` (via `--update`) and its row from "Known upstream issues" in `angle/README.md`.
- [x] 3.2 After `angle-8078.3` is released (user's go-ahead), copy its URLs and digests into `angle/bundles.toml` and run `python3 angle/scripts/check_pin.py`; CI then runs the conformance suites against it.
