# Proposal

## Why

oxgl passes both Khronos conformance suites on all five supported platforms, but it can only be used by cloning and building it, which needs Rust and a download of the ANGLE bundle. Publishing it to npm with prebuilt binaries makes it installable with `npm install oxgl`. ANGLE updates already arrive in oxgl-angle without anyone doing anything. This change carries them through to npm the same way, once oxgl's CI passes on them.

## What Changes

- **Platform packages.** oxgl is published as `oxgl` plus one package per supported platform under the `@oxgl-js` npm scope: `@oxgl-js/linux-x64-gnu`, `@oxgl-js/linux-arm64-gnu`, `@oxgl-js/darwin-arm64`, `@oxgl-js/win32-x64-msvc` and `@oxgl-js/win32-arm64-msvc`. Each platform package holds the native addon, that platform's ANGLE libraries and the third-party notices. `oxgl` lists all five as optional dependencies, so an install downloads only the host's. `package.json` stops being `private`, and the first version is `0.1.0`.
- **The version triggers releases.** After `ci` passes on `main`, a release job publishes the version in `package.json` if npm doesn't have it yet. Otherwise it does nothing. Pushes that don't change the version publish nothing, and you release your own work by bumping the version in a pull request.
- **Linux packages run on glibc 2.34.** That's what the addon built on the Ubuntu 24.04 runners needs; CI fails if a Linux package ever needs a newer one.
- **What CI tested is what ships.** On every pull request and push, each platform's CI job packs the packages it built, installs them from the packed files into an empty project and renders with them. The release job publishes those tarballs from the same run on `main` and builds nothing itself.
- **Publishing without stored secrets.** Publishing uses npm trusted publishing (OIDC) through the `npm` GitHub environment, which only `main` can deploy from. No npm token is stored anywhere, and every version gets a provenance attestation. Each release also creates a `v<version>` tag and a GitHub Release.
- **Automatic ANGLE bumps.** A daily workflow checks oxgl-angle for a release newer than the one oxgl pins. When it finds one, it updates `angle/bundles.toml` from that release's digests and bumps the patch version (unless `main`'s version isn't on npm yet). It then opens or refreshes an `angle-bump` pull request and starts CI on that branch. When CI passes and the branch is exactly the bot's change, CI merges the pull request and starts CI on `main`, whose release job publishes the new version. A bump that fails, or that someone has pushed a fix to, waits for a person, as in oxgl-angle. The bump does nothing until the first version of `oxgl` is on npm.
- `ci.yml` can also be started manually (`workflow_dispatch`), which the bump uses.
- `assets/` (the GitHub social card) joins CI's skip list, so a change to it alone runs only the lint and repository checks.
- README: install instructions, platform requirements (glibc ≥ 2.34, no musl), and badges for CI status, npm version and license. CONTRIBUTING: how to release, and the one-time npm setup.

Out of scope:
- Platforms with no ANGLE bundle: musl/Alpine, macOS x64 and 32-bit Arm.
- Prerelease dist-tags (`next`, canaries), and writing changelogs beyond GitHub's generated release notes.
- Updating conformance expectations automatically when an ANGLE bump changes results. Such a bump fails CI and waits for a person.
- Publishing from the self-hosted GPU job.

Extension points left for later:
- A new platform is a `napi.targets` entry plus CI matrix entries. Its platform package's manifest is generated from that entry.
- A `next` dist-tag can be added by giving prerelease versions their own publish rule.

## Capabilities

### New Capabilities
- `release`: how oxgl versions become npm packages. It covers when a release happens, which packages make one up and how their versions relate, where the published files come from, and how publishing is authenticated and recorded.

### Modified Capabilities
- `node-api`: adds the install-time contract. A plain `npm install oxgl` on a supported host works without Rust or a network fetch of ANGLE, and a host with no platform package reports `OXGL_NATIVE_MISSING`.
- `licensing`: notices ship in each platform package, next to the binaries they cover.
- `continuous-integration`: adds the manual trigger, `assets/` on the skip list, and the packed-package smoke test on every platform.
- `angle-distribution`: adds automatic incorporation of new oxgl-angle releases.

## Impact

- `package.json`: drops `private`, sets the version to `0.1.0`, narrows the `files` list and adds repository metadata. It never lists `optionalDependencies`, because `npm ci` fails while they're unpublished; only the packed `oxgl` manifest has them. Edited in place, and `@fission-ai/openspec` stays.
- New `scripts/pack.mjs`, which generates each platform package's manifest from `napi.targets` and packs it and `oxgl` (whose published manifest alone lists the optional dependencies) from `dist/`.
- `src/native.ts`: finds the ANGLE directory in the platform package when the addon isn't next to it.
- `.github/workflows/ci.yml`: adds the `workflow_dispatch` trigger, a concurrency group that also cancels superseded manual runs off `main`, a `release` output on the `changes` job, the pack-and-smoke steps, artifact uploads only for runs that will release, and new `release` and `merge-bump` jobs.
- New `.github/workflows/angle-bump.yml` and a bump script.
- `README.md` and `CONTRIBUTING.md`.
- Setup only the maintainer can do:
  - On GitHub: turn on "Allow GitHub Actions to create and approve pull requests" for jerryryle/oxgl, which the bump needs to open its pull request.
  - On npmjs.com (the `oxgl-js` org already exists):
    - Bootstrap-publish `0.1.0` of all six packages.
    - Add a trusted publisher to each package.
    - Then disallow token publishing.
