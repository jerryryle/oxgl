# Design

## Context

The x64 OpenGL ES backend job (`gles` in `.github/workflows/ci.yml`) is a four-leg matrix (`test`, `webgl1`, `webgl2`, `threejs`) on `ubuntu-24.04`. It downloads `addon-linux-x64-gles` from the x64 build leg, which builds it after packing, and copies it over the unpacked addon. `hostPlatform()` in `conformance/expectations.mjs` names the run `linux-x64-gles` only for `linux-x64` with `OXGL_BACKEND=gles`. `PLATFORMS` lists the six names, and the results page takes its columns from it. The update rule that keeps an OpenGL ES backend failure off the software platforms tests `platform === 'linux-x64-gles'`.

No Rust or addon code changes: `test-gles` already compiles for any Linux target (`cfg!(all(feature = "test-gles", target_os = "linux"))`), and the arm64 ANGLE bundle already includes the OpenGL ES backend.

## Goals / Non-Goals

**Goals:**
- The arm64 leg tests the same thing as the x64 leg, on arm64's llvmpipe, judged against its own expectations.
- One rule for both OpenGL ES backend platforms everywhere a name is special-cased, so a later `-gles` platform needs only a new name.

**Non-Goals:**
- Merging the two platforms' expectations into one shared name. Their outcomes differ, as `occlusion-query-scissor.html` shows.
- Changing which suites run on the OpenGL ES backend, or running the conformance and three.js suites on it in the quick checks.

## Decisions

**The OpenGL ES backend runs as legs of the jobs that already run each suite.** The `node-test`, `conformance` and `threejs` matrices gain a `backend` key, `[software]`, and `include` entries with `backend: gles` for `ubuntu-24.04` and `ubuntu-24.04-arm`. The key has to be in the matrix itself. GitHub Actions merges an `include` entry into an existing leg when it changes none of that leg's values, so without the key, `{os: ubuntu-24.04, suite: webgl1, backend: gles}` would turn the software leg into a gles leg. With it, each gles entry overrides `software`, so it becomes a new leg. An `include` entry that already makes a leg of its own gets no matrix key it doesn't name, so `node-test`'s Node 22.22.2 and Node 26 entries also name `backend: software`. Otherwise their `OXGL_BACKEND` would be empty, which oxgl treats as unset, and they would test `'auto'`. Every leg's name then carries its backend, like `conformance (macos-15, webgl1, software)` and `conformance (ubuntu-24.04-arm, webgl2, gles)`. Only the `ci` check is required, so nothing depends on the old names. Each suite keeps one set of steps: checkout, ffmpeg, caches and report upload are shared. Only three steps depend on the backend, and they run when `matrix.backend == 'gles'`: installing Mesa's EGL and llvmpipe, downloading `addon-linux-<arch>-gles` and copying it over the unpacked addon, and setting `OXGL_BACKEND` to `matrix.backend`. The separate `gles` job goes, with its entries in the `ci` job's `needs` and full-only list and in the results and release jobs' `needs`. Alternatives: an `os` dimension on the `gles` job would keep about sixty lines duplicating these jobs' steps, and a second `gles-arm64` job would double that.

**The Node test legs on the OpenGL ES backend run in the quick checks.** `node-test` isn't full-only, so its new legs run on every pull request, at about 2 minutes each. Keeping them full-only would need a per-leg skip in a job that otherwise always runs, and a regression on the OpenGL ES backend would then surface only in the merge queue. In `node-test`, a gles leg runs only `npm test`: the lavapipe backend-selection steps stay on the x64 software leg, since they test the Vulkan display.

**Report names follow their job's, with a `-gles` suffix.** The addon artifact is `addon-linux-<arch>-gles`. The reports become `conformance-results-<runner>-<suite>-gles` and `threejs-results-<runner>-gles`, next to the software legs' `conformance-results-<runner>-<suite>` and `threejs-results-<runner>`. The results job already downloads `{conformance-results-*,threejs-results*}`, and the page tells reports apart by the `platform` each records, so it needs no change beyond `PLATFORMS`. Renaming the x64 artifacts changes nothing that reads them.

**`hostPlatform` appends `-gles` on any Linux host.** It becomes `${os}-${arch}-gles` for `linux` with `OXGL_BACKEND=gles`. An unsupported Linux architecture still gives a name outside `PLATFORMS`, which `--update` refuses as it does today. The update rule tests `platform.endsWith('-gles')` instead of naming x64.

**The update rule's spec text now says what the code does.** "Expectations update adds outcomes" said a `linux-x64-gles` run "always" adds an entry for its platform alone. The code first widens an existing entry with the same outcome and applies the gles rule only otherwise. The new text says the rule applies "in the last two cases", which matches the code and gives the arm64 scenario: a failure both OpenGL ES backend platforms share ends up as one entry listing both.

**`PLATFORMS` order puts `linux-arm64-gles` last.** The results page's column order and the update run's platform-list order both follow it, so existing entries keep their order and only gain a name at the end.

**Entries without a list start applying on `linux-arm64-gles`.** The files hold no six-platform lists, because an update writes an entry for every platform without a list. So the 7 conformance and 92 three.js entries without a list apply on the new platform from the start, which is the right default. Where such a page passes on `linux-arm64-gles`, the arm64 update run gives its entry an explicit list of the six other platforms, so the other platforms keep their expectation. Where it fails the same way, the entry stays as it is.

**Expectations are recorded natively, in a container.** The development Mac is arm64, so a `linux/arm64` `ubuntu:24.04` container runs without emulation, unlike the x64 recording in `linux-gles-backend`. It installs the CI job's Mesa packages and unpacks the arm64 packages with the arm64 `test-gles` addon, then runs both update commands with `OXGL_BACKEND=gles`. Each new entry gets a reason from evidence, following the five llvmpipe entries already traced on arm64 with the same Mesa (Mesa 25.2.8). The first CI run then confirms the entries on the real runner.

**Alternative considered: run only the conformance suites on arm64.** That would save the three.js leg's 10 minutes and the `test` leg's 2. But three.js is where llvmpipe's arm64 and x64 rasterization differ most, and those 12 minutes don't lengthen the run. So the leg mirrors x64 in full.

**Safety rules.** The change touches no Rust and no JavaScript the package ships, so `unsafe` confinement, panics, the handle model and `ArrayBuffer` lifetimes are unaffected. The `test-gles` addon stays out of every package. The packed-addon check that rejects `OXGL_BACKEND=gles` already runs on the arm64 build leg through `smoke-packed.mjs`, and the new build runs after it, into `dist-gles/`.

## Risks / Trade-offs

- [The arm64 build leg gets slower by one release `cargo build` of the addon] → Every test job has `needs: build`, so each waits for the slowest build leg. That leg is `windows-11-arm`, at about 4.5 minutes, while the arm64 leg takes about 45 seconds, so the extra build doesn't delay anything. The x64 leg already runs the same build. The Rust cache is shared with the leg's main build.
- [The `ubuntu-24.04-arm` runner's Mesa may differ from the container's] → Both install from Ubuntu 24.04's archive. The first CI run is the check, and any difference is fixed in the expectations then, with its reason.
- [About 65 more job-minutes per full run] → Accepted. It doesn't lengthen the run, since the Windows conformance legs set its length.

## Migration Plan

Land it like any CI change: the merge queue runs the full checks, including every OpenGL ES backend leg. Rolling back means removing the arm64 `include` entries and the arm64 test addon build, and keeping `linux-arm64-gles` in `PLATFORMS`, so its entries still parse. Removing the name from `PLATFORMS` as well needs its entries removed in the same commit: every list naming it loses the name, and an entry naming it alone goes. Otherwise both suites refuse the expectations files as naming an unknown platform.
