# Proposal

## Why

CI runs ANGLE's OpenGL ES backend only on Linux x64, as the `gles` job on Mesa's llvmpipe. The GPU that needs this backend, the Raspberry Pi 5's V3D, is on Linux arm64, so CI never exercises the backend on the architecture it exists for. `linux-gles-backend` deferred arm64 on two grounds, and neither holds now. It said x64 covered the code path, but llvmpipe behaves differently by architecture: `occlusion-query-scissor.html` fails on x64 llvmpipe and passes on arm64. It said the CI redesign was on hold, and that redesign has since landed (`merge-queue-ci`).

## What Changes

- **The OpenGL ES backend runs as legs of the existing jobs, on both Linux architectures.** The `node-test`, `conformance` and `threejs` jobs each gain OpenGL ES backend legs on `ubuntu-24.04` and `ubuntu-24.04-arm`, named like `conformance (ubuntu-24.04-arm, webgl2, gles)`. Such a leg installs Mesa's EGL and llvmpipe, swaps the `test-gles` addon into the run's packages and runs its job's suite with `OXGL_BACKEND=gles`. The separate x64 `gles` job goes away, folded into those legs.
- **The Node test legs on the OpenGL ES backend join the quick checks**, like the rest of `node-test`, at about 2 minutes each. The conformance and three.js legs stay full-only, like their jobs.
- **The Linux arm64 build job also builds the `test-gles` addon**, after packing, and uploads it as `addon-linux-arm64-gles`. As on x64, it's never packed or released.
- **A new expectations platform, `linux-arm64-gles`**: a Linux arm64 run with `OXGL_BACKEND=gles`. The conformance and three.js expectations name it, and an update run there writes it. Like `linux-x64-gles`, its new failures are recorded for the OpenGL ES backend platforms only, never carried over to the software platforms.
- **The results page gains a linux-arm64-gles column** after linux-x64-gles.
- **The `linux-arm64-gles` entries are recorded** by update runs in a `linux/arm64` `ubuntu:24.04` container with the CI job's Mesa packages, then checked against the first CI run.

A run's wall-clock time doesn't change. The x64 `gles` legs take about 65 job-minutes, and the longest is WebGL 2 at 43 minutes, while the Windows conformance legs take 64. The arm64 legs add about the same job-minutes in parallel on `ubuntu-24.04-arm`, which CI already uses. Quick checks gain the two Node test legs, which run alongside the others.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continuous-integration`: "OpenGL ES backend job" is replaced by "OpenGL ES backend legs" of the Node test, conformance and three.js jobs, on Linux x64 and arm64. "Test addon build" also builds the `test-gles` addon on the Linux arm64 build job. "Node checks in software mode" excludes those legs from its software-only scenario.
- `conformance-testing`: "Platform-limited expectations" and "Platform of a run" add `linux-arm64-gles`. "Expectations update run" and "Expectations update adds outcomes" treat both OpenGL ES backend platforms alike.
- `results-page`: "One row per test, one column per platform" adds the linux-arm64-gles column.
- `threejs-examples`: "Platform-limited expectations" updates its scenario's platform list to the seven platforms.

## Impact

- `.github/workflows/ci.yml`: the arm64 build leg's `test-gles` build and upload; OpenGL ES backend legs in the `node-test`, `conformance` and `threejs` matrices; removing the `gles` job from the workflow, the `ci` job's needs and full-only list, and the results and release jobs' needs.
- `conformance/expectations.mjs`: `PLATFORMS`, `hostPlatform` and the OpenGL ES backend's update rule. `scripts/results-page.mjs` takes the column from `PLATFORMS`.
- `conformance/expectations.txt` and `threejs/expectations.txt`: new `linux-arm64-gles` entries. Entries without a list apply on the new platform, and where its page passes there, the entry gains a list of the six other platforms.
- Tests: `test/conformance-harness.test.mjs`, `test/threejs-harness.test.mjs` and `test/results-page.test.mjs`.
- Docs: `CONTRIBUTING.md` (job table, platform names) and the README's test prerequisites, which name the `gles` job.
- CI cost: about 65 more job-minutes per full run on arm64 runners, and about 4 per quick-check run.

### Out of scope

- A Raspberry Pi or other V3D runner. V3D's results stay hand-recorded, and they differ from llvmpipe's.
- The OpenGL ES backend on macOS or Windows, which don't build it.
- Running the conformance or three.js suites on the OpenGL ES backend in the quick checks.
- Extension point: a further OpenGL ES backend platform, such as a GPU runner with a GL driver, would be one more `<platform>-gles` name under the same rules.
