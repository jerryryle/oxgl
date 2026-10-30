## MODIFIED Requirements

### Requirement: Pages run in parallel
The conformance command SHALL accept an option setting how many pages run at once, defaulting to the number of CPUs available to the process, but no more than one page per GiB of memory available to it (at least one).

#### Scenario: Default parallelism
- **WHEN** a developer runs the command without the parallelism option on a machine where 4 CPUs are available to the process
- **THEN** up to 4 pages run at once, and the report records 4 as the number of pages run in parallel

#### Scenario: Memory bounds the default
- **WHEN** a developer runs the command without the parallelism option on a machine with 16 CPUs and 8 GiB of memory
- **THEN** up to 8 pages run at once, so pages do not stall while the machine swaps

## ADDED Requirements

### Requirement: Canvases are composited each frame
At the start of each animation frame, before that frame's callbacks, the runner SHALL present the drawing buffer of every WebGL canvas in the document, as a browser composites it. Canvases outside the document SHALL NOT be presented.

#### Scenario: On-screen and off-screen canvases
- **WHEN** a page clears an on-screen and an off-screen canvas to red and waits for a composite
- **THEN** the on-screen canvas reads transparent black and the off-screen one still reads red (cf. Khronos `conformance/canvas/buffer-offscreen-test.html`)

### Requirement: Long-running pages load later resources
The runner's server SHALL keep a page's idle connections open however long the page runs synchronously, so a resource requested afterwards (such as `js-test-post.js`) loads instead of failing on a connection the server closed.

#### Scenario: Page busy for longer than five seconds
- **WHEN** a page runs synchronously for more than five seconds and then calls `finishTest()`
- **THEN** the page completes instead of timing out (cf. Khronos `conformance/reading/read-pixels-test.html`)
