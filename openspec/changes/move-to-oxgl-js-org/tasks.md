# Tasks

## 1. Prerequisites (manual, by the repository owner)

- [x] 1.1 Disable `angle-bump.yml` in oxgl and oxgl-angle, and merge or close any open `angle-bump` PR. Verify that both workflows show as disabled under Actions.
- [x] 1.2 In the `oxgl-js` organization's Actions settings, set read-and-write workflow permissions and allow GitHub Actions to create and approve pull requests. Verify that both settings show as saved.
- [x] 1.3 Transfer `jerryryle/oxgl-angle`, then `jerryryle/oxgl`, to `oxgl-js`. Verify that `https://github.com/jerryryle/oxgl` redirects to `https://github.com/oxgl-js/oxgl`, and that each repository's environments (`npm` limited to `main`, `github-pages`), Pages source ("GitHub Actions") and branch rules are intact.
- [x] 1.4 On npmjs.com, change the trusted publisher owner to `oxgl-js` for all six `@oxgl-js/*` packages, keeping repository `oxgl`, workflow `ci.yml` and environment `npm`. Verify that each package's Settings page shows the new owner.
- [x] 1.5 Point the local oxgl and oxgl-angle clones at `git@github.com:oxgl-js/<repo>.git`. Verify with `git remote -v` and `git fetch`.

## 2. oxgl-angle references (in the oxgl-angle repository)

- [ ] 2.1 Point `README.md`'s oxgl link at `https://github.com/oxgl-js/oxgl`. Verify that `git grep jerryryle/` there finds nothing outside `assets/`, and open a PR whose `angle-build` check passes.

## 3. oxgl package, pin and bump references

- [x] 3.1 Point `package.json`'s `repository.url`, `homepage` and `bugs.url` at `oxgl-js/oxgl`, editing in place. Verify that `npm pack --dry-run` succeeds and `npm pkg get repository` shows the new URL.
- [x] 3.2 Change every URL in `angle/bundles.toml` (and its header comment) to `oxgl-js/oxgl-angle`, keeping the SHA-256 digests. Also change `RELEASES` in `angle/scripts/check_pin.py` and `REPO` in `angle/scripts/bump.py`. Verify that `python3 angle/scripts/check_pin.py` and `python3 angle/scripts/test_bump.py` pass, and that `OXGL_ANGLE_CACHE="$(mktemp -d)" cargo build -p oxgl-sys` (an empty bundle cache, since the cache is keyed by digest and survives `cargo clean`) downloads the bundle from the new URL and verifies its digest.
- [x] 3.3 Point the recipe link in `.github/workflows/angle-bump.yml`'s PR body and the error message in `crates/oxgl-sys/build.rs` at `oxgl-js/oxgl-angle`. Verify that `npm run lint:rust` (fmt and clippy pedantic, warnings as errors) passes.

## 4. Results page and docs

- [x] 4.1 Change `REPO` in `scripts/results-page.mjs`, the links in `scripts/results-page.html`, and the expected links in `test/results-page.test.mjs` to `https://github.com/oxgl-js/oxgl`. Verify that `npm test` and `npm run lint:js` pass.
- [x] 4.2 Point the links in `README.md` (CI badge, results page `https://oxgl-js.github.io/oxgl/`), `CONTRIBUTING.md` (recipe repository, results page, trusted-publisher owner `oxgl-js`), `angle/README.md` and `scripts/platform-README.md` at `oxgl-js`. Verify that `git grep -n jerryryle` finds only archived changes, this change's own directory, `assets/*.ai` and `angle/scripts/test_bump.py`'s user-login fixtures.
- [x] 4.3 Run `npx openspec validate move-to-oxgl-js-org --strict` and verify that it passes.

## 5. Integration

- [ ] 5.1 Open oxgl's PR and verify that its `ci` check passes in `oxgl-js/oxgl`. It doesn't depend on task 2.1's PR.
- [ ] 5.2 After merging, re-enable both `angle-bump.yml` workflows and run each once with `workflow_dispatch`. Verify that each run either finds nothing to bump or opens a PR whose check runs. Then verify that `ci.yml` on `main` deploys the results page to `https://oxgl-js.github.io/oxgl/`.

## Workflow follow-up

- Archive the change once it's merged and verified, which syncs the three spec deltas into the main specs.
