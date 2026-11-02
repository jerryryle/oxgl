## MODIFIED Requirements

### Requirement: The deterministic frame
Each example SHALL run with the pinned `test/e2e/deterministic-injection.js` installed before any page script, and its `requestAnimationFrame` gate replacing the runner's. After load, `test/e2e/clean-page.js` runs. The runner waits until no request is pending, every video is ready and upstream's parse allowance (1 s per MB served, at most 30 s) has passed. It releases one animation frame and waits up to 5 s for it, then captures either way.

#### Scenario: Seeded randomness
- **WHEN** an example places objects with `Math.random()` and is run twice
- **THEN** both runs capture the same frame

#### Scenario: Example without an animation loop
- **WHEN** an example renders once on load and never calls `requestAnimationFrame`
- **THEN** the frame is captured 5 s after the release, and the example is judged on the frame it rendered on load

#### Scenario: Large assets
- **WHEN** an example loads 80 MB of models and textures
- **THEN** the parse allowance is 30 s, and the example is not timed out by the runner's own waits

#### Scenario: Allowance from the bytes served
- **WHEN** an example is served 4 MB in all and draws its content 3 s after its last load arrives (cf. three.js `webgl_loader_gltf_transmission`, whose model is decoded after the idle wait)
- **THEN** the runner releases the frame no sooner than 4 s after the idle wait, and the frame shows the content
