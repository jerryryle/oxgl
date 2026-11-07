# Contributing

Changes follow OpenSpec: a proposal in `openspec/changes/` is reviewed before
code is written. Run OpenSpec as `npx openspec`. See the README for
prerequisites and everyday commands.

## Continuous integration

Changes reach `main` through the merge queue. `.github/workflows/ci.yml`
chooses its jobs by event, never by which files changed:

- **Pull request:** the quick checks (`workflow-lint`, `repo-checks`, `build`,
  `check`, `node-test`) on every platform. With the `full-ci` label, the
  pull request's runs from its next push on run the full checks too. To run
  them on its current commit, start `ci` by hand on its branch (Actions → ci →
  Run workflow). Adding or removing a label starts no run.
- **Merge group** (the queue, after "Merge when ready"): the full checks, the
  quick ones plus `asan`, `conformance`, `threejs` and `results`, on the
  commit that will land. Documentation changes run them too.
- **Push to `main`:** builds and tests nothing. `release` publishes what the
  merge group run for that commit built, and `caches` warms caches (see
  below).
- **Manual run** (`workflow_dispatch`): the full checks on any branch; on
  `main` it also releases, which is how a change merged past the queue
  releases.

A newer run for the same pull request, or a manual run on the same branch
other than `main`, cancels the earlier one; merge group runs and runs on
`main` are never cancelled.

| Job | Runs on | Checks |
|---|---|---|
| `workflow-lint` | Linux | actionlint, and zizmor with `.github/zizmor.yml` (every action pinned to a commit SHA, minimal permissions, no template injection) |
| `build` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | native + TS build, then the packed packages installed into an empty project and rendered with (`scripts/pack.mjs`, `scripts/smoke-packed.mjs`) and, on Linux, that no library in the package needs glibc newer than 2.34 (`scripts/check-glibc.sh`); on Linux it then also builds the addon with the test-only `test-gles` feature into `dist-gles/` and uploads it as `addon-linux-<arch>-gles`, never packed; the platform tarball is uploaded as `packages-<runner>`, and Linux arm64 also uploads the `@oxgl-js/oxgl` tarball as `package-main`, each kept 7 days in a run whose version isn't on npm and 3 days otherwise |
| `check` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | rustfmt, clippy (pedantic, warnings as errors), Rust tests, ESLint and tsc |
| `repo-checks` | Linux | the ANGLE pin check and the bump script's tests, dependency licenses and `THIRD_PARTY_NOTICES` |
| `node-test` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | Node tests with `OXGL_BACKEND=software` on Node 24, and on Linux arm64 also on Node 22.22.2 (the `engines` floor) and Node 26. On Linux x64, the backend-selection tests run again without `OXGL_BACKEND`, with Mesa's lavapipe installed. On Linux x64 and arm64, a `gles` leg also runs them on Node 24 on ANGLE's OpenGL ES backend (see below) |
| `asan` | Linux arm64 and x64 | full checks: Rust tests under AddressSanitizer and LeakSanitizer |
| `conformance` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | full checks: both Khronos conformance suites with `OXGL_BACKEND=software`, judged against the `conformance/expectations.txt` entries that apply on each platform; each report is uploaded as `conformance-results-<runner>-<suite>` (see Conformance tests below). On Linux x64 and arm64, `gles` legs also run both suites on ANGLE's OpenGL ES backend (see below), reporting as `conformance-results-<runner>-<suite>-gles` |
| `threejs` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | full checks: three.js's own WebGL examples with `OXGL_BACKEND=software`, each frame judged against its reference screenshot and the `threejs/expectations.txt` entries that apply on each platform; the report and failing examples' images are uploaded as `threejs-results-<runner>` (see three.js examples below). On Linux x64 and arm64, a `gles` leg also runs them on ANGLE's OpenGL ES backend (see below), reporting as `threejs-results-<runner>-gles` |
| `ci` | Linux | succeeds only when every job above succeeded; on the quick checks, `asan`, `conformance` and `threejs` may be skipped |
| `results` | Linux | full checks, after `conformance` and `threejs`, even when they fail: builds a preview of the results page and uploads it as `results-page`; not part of `ci` |
| `release` | Linux | on `main`, when npm doesn't have `package.json`'s version yet: publishes the tested run's tarballs and builds the results page (see Releases below) |
| `pages` | Linux | after a release: publishes the page `release` built to GitHub Pages |
| `caches` | Linux x64 and arm64, macOS arm64, Windows x64 and arm64 | on a push to `main` that changes a cache key's input, and on a manual run on `main`: saves the download caches (see below) |

`build` builds and packs oxgl once per platform. `node-test`, `conformance`
and `threejs` don't build: each downloads the run's `@oxgl-js/oxgl`
tarball and its platform's, and unpacks them into `dist/` with
`scripts/unpack-packages.mjs`, so every test runs the files the release
publishes. They wait for every platform's `build`, and none runs when one
fails. Locally, `npm run build` gives an equivalent `dist/`, with source maps
and `native.d.cts` besides. For a run's exact files, download `package-main`
and your platform's `packages-<runner>`, move both tarballs into one directory,
remove `dist/`, and run `node scripts/unpack-packages.mjs <that directory>`.

The `gles` legs run on ANGLE's OpenGL ES backend on Mesa's llvmpipe. Each
installs Mesa's EGL and llvmpipe, copies its platform's test addon
(`addon-linux-<arch>-gles` from `build`) over the unpacked one with
`.github/actions/use-gles-addon`, and sets `OXGL_BACKEND=gles`, so it's judged
against the `linux-x64-gles` or `linux-arm64-gles` expectations. The Node test
legs run in the quick checks, and the conformance and three.js legs in the full
checks, like the rest of their jobs.

`build`, `check`, `node-test`, `conformance` and `threejs` run on every
supported platform (see the README). `node-test`'s extra Node versions run on
Linux arm64 only: N-API makes the addon independent of the Node version. The
README lists the conformance pages and three.js examples whose results differ
by platform, and why.

The `main` ruleset requires the single `ci` check and the merge queue (squash,
default grouping, a 2-hour status-check timeout, branches need not be up to
date before queueing). Jobs can be added or renamed without changing it. The
queue gives each pull request its own run, on top of the ones queued ahead of
it.

Caches a merge group or pull request run saves are never restored by another
run, so only runs on `main` save the ones every run restores. A push to `main`
that changes `angle/bundles.toml`, `conformance/suite.json`,
`threejs/pin.json` or `package-lock.json` runs `caches`, which saves the
bundle (with the AddressSanitizer symbols on Linux), suite, three.js and npm
caches on each platform. A push that changes `Cargo.lock`,
`rust-toolchain.toml` or `ci.yml` (which sets `ASAN_NIGHTLY`) also runs
`build`, `check` and `asan` after it, only to save their Rust build caches.
After the caches are evicted, a manual run on `main` saves them all.

ANGLE is never built here: its recipe and bundle releases live in
[oxgl-js/oxgl-angle](https://github.com/oxgl-js/oxgl-angle) (see
`angle/README.md`). Every job uses the pinned bundle from
`angle/bundles.toml`, cached by the manifest's hash. `oxgl-sys/build.rs`
verifies the digest when it downloads the bundle; a restored cache entry is
used as-is.

Tool versions live in one place, `ci.yml`: the `env` block (license tools and
the ASan nightly, actionlint, zizmor). The commands below name them by those
`env` keys.
Dependabot bumps only the SHA-pinned actions, so bump these by hand.

## Releases

A release is a version on `main` that npm doesn't have yet. To release your own
changes, bump `version` in `package.json` and `package-lock.json` in a pull
request (`npm version patch --no-git-tag-version`, or `minor`/`major`).
Nothing checks that you did: a change landed without a bump waits for the next
release, and `main` ahead of the latest tag shows it. Several changes may land
before one release. When a version lands through the queue, the `release` job
of the push run on `main`:

1. Finds the passing merge group run for that commit and downloads its
   tarballs, the ones its `build` jobs packed and smoke-tested and its test
   jobs ran.
2. Publishes the five platform packages (`@oxgl-js/<platform>`), then
   `@oxgl-js/oxgl`, with npm trusted publishing and provenance. No npm token
   is stored anywhere.
3. Creates the tag `v<version>` and a GitHub Release with generated notes, and
   builds the results page from that run's reports, which `pages` publishes.

Pushes that leave the version alone publish nothing. If a release fails
partway, rerun its `release` job: it skips every package npm already has and
creates the tag and GitHub Release if they're missing. The tarballs are kept for
7 days; after that, start `ci` by hand on `main`. A change merged past the
queue has no merge group run, so its push fails the release with a message
saying so; start `ci` by hand on `main` (Actions → ci → Run workflow), which
builds, tests and releases it.

New ANGLE releases arrive by themselves. When oxgl-angle releases a bundle
version, its release job starts `angle-bump.yml` here, which opens a pull
request that pins it and bumps the patch version, as the `oxgl-js` GitHub App
so that CI runs, with auto-merge on. Once its quick checks pass it enters the
queue, and when the queue lands it, the push releases it. The bump also runs
on every push to `main` and by hand: it rebuilds an open bump only when it
went stale (a newer release, a version no longer greater than `main`'s, or a
conflict), so a queued bump stays in the queue. A bump whose queue run fails
(for example, a conformance page's result changed) leaves the queue and stays
open: push the fix to `angle-bump`, and it lands through the queue once its
checks pass. To skip an oxgl-angle release, label its pull request `skip-bump`
and close it. `angle/README.md` describes the checks on where a release came
from.

### Setup

Done once, by the maintainer:

- The `oxgl-js` GitHub App, installed on `oxgl` and `oxgl-angle` only, with
  contents and pull requests read-and-write and nothing else. Its client ID
  and private key are the organization secrets `OXGL_BOT_CLIENT_ID` and
  `OXGL_BOT_PRIVATE_KEY`, limited to those two repositories. The bumps open
  their pull requests with it, because pull requests the default token opens
  start no CI and couldn't enter the queue. Releases and npm publishing don't
  use it.
- A `full-ci` label in both repositories.
- The `main` ruleset with the merge queue (see Continuous integration).
- On each of the six packages' Settings page on npmjs.com, a trusted
  publisher: GitHub Actions, owner `oxgl-js`, repository `oxgl`, workflow
  `ci.yml`, environment `npm`, with "Require two-factor authentication and
  disallow tokens" set. The `npm` GitHub environment, which only `main` may
  deploy to, holds no secrets.

## Results page

The [results page](https://oxgl-js.github.io/oxgl/) is one table of every
conformance page's and three.js example's result on each platform. Its fixed
parts are in `scripts/results-page.html`; `scripts/results-page.mjs` fills in
the rows from the runs' reports. The published page belongs to the latest
release: the `release` job builds it from the reports of the run whose
packages it published, naming that version and commit, and `pages` publishes
it. Nothing else deploys it, so a change to the page goes live with the next
release. The `results` job builds a preview on every run of the full checks;
label a pull request `full-ci` to get one.

- **Building it locally** from any run's artifacts:

  ```sh
  gh run download <run-id> -p 'conformance-results-*' -p 'threejs-results*' -D results
  node scripts/results-page.mjs --commit "$(gh run view <run-id> --json headSha -q .headSha)" results results.html
  ```

  Then open `results.html` in a browser.

## Reproducing a job locally

`check`:

```sh
npm ci
npm run lint:rust
npm run lint:js
cargo test --workspace --exclude oxgl-node --locked
npm run build
OXGL_BACKEND=software npm test
node scripts/pack.mjs /tmp/oxgl-packages
node scripts/smoke-packed.mjs /tmp/oxgl-packages
```

`scripts/release.mjs /tmp/oxgl-packages --dry-run` reports what the `release`
job would publish; it needs all six tarballs, so it refuses the one platform a
local pack produces.

`repo-checks` (needs Python 3.11+ and the license tools at the versions in
`ci.yml`'s `env`):

```sh
python3 angle/scripts/check_pin.py
python3 angle/scripts/test_bump.py
npx eslint scripts/results-page.mjs test/results-page.test.mjs
node --test test/results-page.test.mjs
npm run lint:licenses
```

`workflow-lint` (needs Go and uv):

```sh
go install github.com/rhysd/actionlint/cmd/actionlint@<ACTIONLINT_VERSION>
"$(go env GOPATH)/bin/actionlint"
uvx zizmor@<ZIZMOR_VERSION> --config .github/zizmor.yml .github/workflows .github/actions
```

`asan` on Linux arm64:

```sh
NIGHTLY=<ASAN_NIGHTLY>
rustup toolchain install "$NIGHTLY" --profile minimal
RUSTFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
RUSTDOCFLAGS="-Zsanitizer=address -Cforce-frame-pointers=yes" \
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:detect_stack_use_after_return=1:fast_unwind_on_malloc=0 \
ASAN_SYMBOLIZER_PATH="$(command -v llvm-symbolizer)" \
OXGL_ANGLE_SYMBOLS=1 \
LSAN_OPTIONS="suppressions=$PWD/.github/lsan-suppressions.txt" \
cargo +"$NIGHTLY" test --workspace --exclude oxgl-node --locked \
  --target aarch64-unknown-linux-gnu
```

The arm64 job does not rebuild std with `-Zbuild-std`: on aarch64 that
instruments `compiler_builtins`, and every test binary then crashes inside
`__asan_init`. On Linux x64 it does, which needs `rust-src`, and the frame-pointer
unwinder suffices:

```sh
rustup toolchain install "$NIGHTLY" --profile minimal --component rust-src
# same environment as above, but without :fast_unwind_on_malloc=0 in ASAN_OPTIONS
cargo +"$NIGHTLY" test --workspace --exclude oxgl-node --locked \
  -Zbuild-std --target x86_64-unknown-linux-gnu
```

`OXGL_ANGLE_SYMBOLS=1` builds the tests against the unstripped ANGLE libraries
from the pinned symbols archive, and on arm64 `fast_unwind_on_malloc=0` lets
the unwinder follow ANGLE's signed return addresses, so suppressions can match
ANGLE-internal frames. Read the header of `.github/lsan-suppressions.txt`
before adding an entry: suppressions name one specific internal function,
never a library or an exported EGL/GL/Vulkan entry point.

## Conformance tests

`npm run conformance` runs the Khronos WebGL conformance suites against the
built package (`npm run build` first). The suite is `sdk/tests` of the
`KhronosGroup/WebGL` commit pinned in `conformance/suite.json`. The first run
fetches it into `.cache/conformance/`, and later runs reuse that copy until the
pin changes. Each page runs in jsdom in its own Node process, with
`canvas.getContext` returning oxgl contexts.

The runner needs the `canvas` devDependency, the local package in
`conformance/canvas/`. It presents `@napi-rs/canvas` (Skia, pinned exactly in
`package.json`) through the node-canvas API that jsdom expects. jsdom uses it
for 2D contexts and image decoding, and the runner exposes its `ImageData`
class to pages; many texture pages need these before they reach oxgl. `npm ci`
installs its prebuilt binary on every target, with no system libraries; the
runner stops with an error naming it if it cannot be loaded. It is a
devDependency only, so `npm install @oxgl-js/oxgl` never downloads it.

The WebGL constants in `src/generated/webgl-constants.ts` come from the IDL
files at the same commit. When you move the pin, regenerate them with `node
scripts/webgl-constants.mjs` and commit the result.

There are two suites. `webgl1` runs the 1.0.x test list with WebGL 1 contexts,
and `webgl2` runs the 2.0.x list, which includes `conformance/`, with WebGL 2
contexts. Every page gets one outcome: `PASS`, `FAIL`, `TIMEOUT` or `CRASH`.

`conformance/expectations.txt` lists every page that is not expected to pass,
one per line as `<suite> <path> <OUTCOME> [<platform> ...] # <reason>`. The
bracketed list is optional and names the platforms an entry applies to
(`linux-x64`, `linux-arm64`, `macos-arm64`, `windows-x64`, `windows-arm64`,
plus `linux-x64-gles` and `linux-arm64-gles` for a Linux run on ANGLE's OpenGL ES
backend, which a run with the test-only `test-gles` addon and
`OXGL_BACKEND=gles` is); elsewhere
the page is expected to pass. An entry without a list applies on every
platform. A page may have several listed entries, one per outcome, as long as no
platform is in two of them. A run fails on any
difference: a page that regressed, a page that passes but is still listed, a
different failure than the one listed, or an entry for a page the suite no
longer has. A change that makes pages pass removes their entries. `SKIP`
entries are for pages confirmed to hang, or too timing-dependent to judge on a
platform; they are not run.

An uncaught error ends a page at once only when its entry is `FAIL`. Every other
page keeps running after the error, as in the official harness, until it
completes or goes the time limit without a new result. Once the file is empty, every page is
judged as the official harness judges it.

Run CI's configuration (`OXGL_BACKEND=software`) when comparing with CI. Each
run is judged against the entries that apply on its host's platform, so a local
run matches the CI job for the same platform.

```sh
OXGL_BACKEND=software npm run conformance                       # both suites
OXGL_BACKEND=software npm run conformance -- --suite webgl1     # one suite
OXGL_BACKEND=software npm run conformance -- --filter conformance/buffers/   # pages whose path contains this
OXGL_BACKEND=software npm run conformance -- --filter conformance/buffers/ --update   # rewrite their entries
```

Other options: `--include-skipped` runs `SKIP` pages and reports them without
judging them. `--fast-errors` ends every page at its first uncaught error, which
helps when exploring an area that oxgl does not implement yet. `--timeout
<seconds>` sets how long a page may go without a new result before it times
out (default 60; the official harness's watchdog is 20, but some pages report
only after draw loops that take longer than half of that on SwiftShader); each
result restarts the clock. `--jobs <n>` sets how many pages run at once (default: the number of
CPUs).

`--update` rewrites the entries of the pages that ran from their outcomes on
this host's platform, and leaves other platforms' expectations alone: an entry
without a list counts as listing all five. It keeps the reason of an entry whose
outcome did not change, takes this platform out of an entry whose page now
passes or fails differently (removing the entry when no platform is left), adds
a new outcome to the page's entry with that outcome or to an entry for this
platform alone, and takes new reasons from the page's first failure message. A
failure on a page with no entry gets an entry without a list; narrow it by hand
if the page passes elsewhere. On a run without `--filter`, it also drops entries for pages the suite
no longer has. Review the diff, and replace generated reasons with better ones
where it helps. Moving a page to `SKIP` is a manual edit.

Every run writes `conformance-results.json` with each page's outcome, result
counts, duration and first failure message or error.

## three.js examples

`npm run threejs` runs three.js's own WebGL examples against the built package
(`npm run build` first) and compares each rendered frame with the reference
screenshot the release keeps for it. The release is the commit pinned in
`threejs/pin.json` (r186). The first run fetches its `build/`, `examples/` and
`test/e2e/` into `.cache/threejs/` (about 290 MB to download, 720 MB on disk;
about a minute), and later runs reuse that copy until the pin changes. The
suite is every `examples/*.html` except `index.html` and the WebGPU examples
(`webgpu_*`). The `three` devDependency, which the benchmarks and unit tests
use, is separate from the pin.

Each example runs in jsdom in its own Node process, with the same window the
conformance runner gives its pages (oxgl contexts, images, workers, video), an
800×500 viewport at device pixel ratio 1, element sizes and offsets from CSS
lengths (`width`, `height`, and `top`, `right`, `bottom`, `left` for
absolutely positioned elements, but no flow layout), a `matchMedia` that
matches nothing, and its `<script type="module">` run as ES modules through
its import map. Requests are served from the
checkout; `http:` and `https:` requests to any other origin are refused and
named in the report, so examples that load remote assets fail. Every example
follows the sequence of three.js's `test/e2e/puppeteer.js`, using the
release's own `deterministic-injection.js` (seeded `Math.random`, frozen
clock, held animation frames) and `clean-page.js`:

1. wait until no request has been in flight for 1 s, and for videos;
2. wait 1 s per MB served, at most 30 s, for parsing;
3. release one animation frame, and wait up to 5 s for it;
4. build the viewport: start from the body's background, read each WebGL
   canvas's drawing buffer as it holds it, and composite it as a browser
   does (premultiplied or not, by its context) at its place: its parent's
   origin, with canvases that share an origin side by side in document
   order. Then halve the frame to 400×250;
5. compare it with `examples/screenshots/<example>.jpg`: a pixel differs when
   its RGB distance exceeds 0.1 of the maximum, and the frame matches when at
   most 0.1% of its pixels differ (the example's tolerance).

An escaped error, a `console.error` (three.js reports shader errors that way)
or a failed request fails the example even when its frame matches, as in
upstream's test. A page without a WebGL canvas, or with one past the
viewport, fails with a message saying so. HTML and CSS content around or
behind the canvases is not drawn.

`threejs/expectations.txt` lists every example that is not expected to pass,
one per line as `<example> <OUTCOME> # <reason>`, where OUTCOME is `FAIL`,
`TIMEOUT`, `CRASH`, `SKIP` or `DIFF <p>%`. A `DIFF` entry is a tolerance: the
example passes while at most p% of its pixels differ (0.1 < p <= 5). It is for
frames that differ from Chrome's only by rasterization noise, so a regression
past the tolerance still fails. A run fails on any difference from the file,
as the conformance run does; an example listed as `FAIL` or `DIFF` that now
matches within 0.1% must lose its entry.

```sh
OXGL_BACKEND=software npm run threejs                              # every example
OXGL_BACKEND=software npm run threejs -- --filter webgl_shadowmap   # examples whose name contains this
OXGL_BACKEND=software npm run threejs -- --filter webgl_shadowmap --update   # rewrite their entries
```

Other options: `--include-skipped`, `--jobs <n>` (default: as for the
conformance run), `--timeout <seconds>`, how long an example may go without
progress (default 60; each finished request and each step above counts), and
`--total-timeout <seconds>`, how long it may run in all (default 300, upstream's
network timeout).

`--update` rewrites the entries of the examples that ran. An example whose only
fault is an image difference of at most 5% gets `DIFF` at that percentage,
rounded up to a whole percent; a larger difference is written as `FAIL` with
its percentage. An existing `DIFF` is kept while its example stays within it,
removed once the example matches within 0.1%, and never raised: an example
beyond its tolerance is written as `FAIL`. Review the diff. Triage each new
`FAIL`, `TIMEOUT` and `CRASH` to name its cause: an oxgl defect, ANGLE or
SwiftShader, or a runner gap (no flow layout or HTML rendering, module
workers are not supported, remote assets are refused).

Every run writes `threejs-results.json`, with each example's outcome, the
percentage of differing pixels, duration, the time limit it reached for a
`TIMEOUT`, and its first error or refused request. For every example that did
not pass, `threejs-output/` holds `<example>-actual.png`, `-expected.png` and
`-diff.png` (differing pixels in red). Compare with CI on Linux arm64 under
`OXGL_BACKEND=software`; other platforms' SwiftShader can render differently.
