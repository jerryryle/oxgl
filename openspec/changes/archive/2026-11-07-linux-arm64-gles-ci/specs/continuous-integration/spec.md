## MODIFIED Requirements

### Requirement: Node checks in software mode
On each platform, CI SHALL install dependencies with `npm ci` and run the JS lint and type check. It SHALL run the Node test suite (including the soak test) with `OXGL_BACKEND=software` against that platform's packages from the run's build (Each platform is built once per run), on Node 24 on every platform and on both ends of `engines` on Linux arm64. On Linux x64 it SHALL then install Mesa's Vulkan driver (`mesa-vulkan-drivers`) and run the backend-selection tests without `OXGL_BACKEND`.

#### Scenario: Software rendering on every platform
- **WHEN** the Node test step runs
- **THEN** `OXGL_BACKEND` is `software` and clear-then-readPixels and soak tests execute (not skip) in every leg of the matrix other than the OpenGL ES backend legs ("OpenGL ES backend legs")

#### Scenario: Oldest supported Node
- **WHEN** the Node tests run on Linux arm64 on Node 22.22.2
- **THEN** they use the same Linux arm64 packages as the Node 24 leg, and pass

#### Scenario: A Vulkan GPU display rejected as a CPU
- **WHEN** the Linux x64 leg runs the backend-selection tests with lavapipe as the only Vulkan device
- **THEN** the test that creates an `'auto'` context and then a `'software'` one runs (not skips), and both render on SwiftShader

### Requirement: Test addon build
The Linux x64 and Linux arm64 build jobs SHALL also build the addon with the Cargo feature `test-gles`, after packing and outside the packed directory, and upload it as a separate artifact per platform, which SHALL NOT be packed into any package or released. The OpenGL ES backend legs SHALL replace their platform's addon with that platform's build, its one departure from "Each platform is built once per run".

#### Scenario: Test addon never packed
- **WHEN** the Linux x64 or Linux arm64 build job packs its platform package (`@oxgl-js/linux-x64-gnu` or `@oxgl-js/linux-arm64-gnu`)
- **THEN** the packed addon is the one built without `test-gles`, and with it `OXGL_BACKEND=gles` throws `OXGL_INVALID_BACKEND`

## ADDED Requirements

### Requirement: OpenGL ES backend legs
On Linux x64 and Linux arm64, the Node test, conformance and three.js jobs SHALL each also run a leg on ANGLE's OpenGL ES backend. Such a leg SHALL install Mesa's EGL and GL driver packages, swap its platform's `test-gles` addon into the run's packages, and run its job's suite with `OXGL_BACKEND=gles`, judged against the expectations for its `-gles` platform. It SHALL run, be required and upload reports as its job's other legs do, its report names ending in `-gles`.

#### Scenario: GL code path tested on llvmpipe
- **WHEN** an OpenGL ES backend leg runs
- **THEN** every context it creates renders through ANGLE's OpenGL ES backend on Mesa's llvmpipe, which the leg's log shows in the renderer string

#### Scenario: Regression on the OpenGL ES backend only
- **WHEN** a change breaks a conformance page only on the OpenGL ES backend
- **THEN** the conformance job's OpenGL ES backend legs fail and the `ci` check fails, while its software legs pass

#### Scenario: Regression on one architecture only
- **WHEN** a change breaks a conformance page on the OpenGL ES backend on Linux arm64 only
- **THEN** the conformance job's Linux arm64 OpenGL ES backend leg fails and the `ci` check fails, while its Linux x64 one passes

#### Scenario: Quick checks run the Node test legs
- **WHEN** a pull request without `full-ci` runs the quick checks
- **THEN** the Node test job's OpenGL ES backend legs run on both architectures, the conformance and three.js jobs, with their OpenGL ES backend legs, are skipped, and the `ci` check can succeed

## REMOVED Requirements

### Requirement: OpenGL ES backend job
**Reason**: The OpenGL ES backend runs as legs of the Node test, conformance and three.js jobs, on Linux x64 and arm64, instead of as a job of its own.
**Migration**: See "OpenGL ES backend legs". The reports keep their contents and gain the runner in their names.
