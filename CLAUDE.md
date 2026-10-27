# oxgl

Standards-compliant WebGL 1/2 for Node.js: Rust + napi-rs over ANGLE (EGL/GLES), headless, with a SwiftShader software fallback. Full project context lives in `openspec/config.yaml`.

## Workflow: OpenSpec, strictly

- Specs and proposals come before code. Do not implement a change until the user has reviewed and approved its proposal.
- Always run OpenSpec as `npx openspec ...` (pinned devDependency). Never use a bare `openspec` command or a global install. The generated skills in `.claude/` show bare `openspec`; run those through `npx`.
- Validate with `npx openspec validate <change> --strict` before presenting a change.
- When editing `package.json`, edit in place and keep the `@fission-ai/openspec` devDependency.

## Safety rules

- `unsafe` only in `oxgl-sys`. `oxgl-core` and `oxgl-node` use `#![forbid(unsafe_code)]` (napi-rs macro exemptions in `oxgl-node` must be scoped and justified).
- Every `unsafe` block has a `// SAFETY:` comment; `#![deny(unsafe_op_in_unsafe_fn)]`.
- No `unwrap`, `expect`, or `panic!` outside tests. Map errors to WebGL semantics (`getError`, context loss) or to JS exceptions where the WebGL spec requires them.
- WebGL objects are generational slotmap handles, never raw pointers. JS finalizers enqueue GL deletion; the owning context drains the queue on its own thread. Destroying or losing a context invalidates all its handles.
- Never retain pointers into JS `ArrayBuffer`s beyond the duration of a call.
- Clippy pedantic, warnings as errors.

## Spec conventions

- Capabilities mirror the WebGL spec (context-creation, buffers, textures, shaders-programs, framebuffers, drawing, extensions, context-loss) plus backend-selection, node-api, and infrastructure capabilities.
- Cite Khronos spec sections instead of restating them; reference Khronos conformance tests in scenarios where they exist.

## Correct, simple and fast enough is the bar

Designs, code and reviews all aim at the same three things: behaviour that is correct in the
conditions the system actually meets, code no more complex than that behaviour needs, and no
wildly wasteful work. The behaviour asked for is itself open to question when a simpler one
would serve. Surviving rare infrastructure failure is not a goal. A reviewer does not ask for
handling of it, and machinery added only for it is complexity to remove.

- **Correct means correct in normal operation.** Normal operation includes concurrent users
  and boards, the retries the code makes itself, a request the user abandons, and every input
  the interface admits. A defect there is always in scope.
- **A rare failure matters only when it does visible, lasting damage.** A rare failure is one
  that real use seldom produces: a lost Valkey lease, a crash between two writes, a task that
  dies mid-request, an AWS or regional outage. It is in scope only when it silently loses or
  corrupts a user's content, or leaves state the user can neither see nor repair from the UI,
  and then the fix is the simplest one that prevents that damage. An error the user retries,
  a cache that empties, a delay, or an inconsistency that the next write heals or the user can
  fix from a page is accepted and needs no handling.
- **Cheap handling of a rare error is welcome.** Handling one is fine when it stays inside the
  code path that already exists and adds no mechanism, stored field or new failure mode:
  checking a reply the code already gets, choosing a safer order for two writes it already
  makes, or folding two writes into the transaction it already uses. A reviewer neither asks
  for such handling nor flags it for removal.
- **Nothing has to stay up through an outage.** A request may fail while a dependency it needs
  is down. Fallbacks, failover, extra retry layers, circuit breakers and duplicated state that
  exist to ride out an outage are out of scope unless the user asks for them.
- **Complexity is a cost the finding must pay for.** A fix that adds a mechanism, a stored
  field or a new failure mode has to prevent damage that is likely or severe. Weigh a trigger
  by how often real use produces it, never by whether it can happen at all.
- **Inefficient means wildly inefficient.** In scope is work that is wasteful by an order of
  magnitude or that grows with data it does not need: reading every row to answer for one, a
  round trip per item where one would do, unbounded growth. A redundant read on a rare path,
  or a constant-factor saving nobody would notice, is below the bar.
- **A simpler design is worth a small change to the requirement.** When a requirement drives
  much of the complexity and a nearby one would serve the same purpose with far less, say so:
  before building it, in the proposal or design discussion, and in a review of existing code,
  as an entry in the improvements list. Name the requirement to change, the complexity it
  removes and what the user gives up. A byte quota per namespace, for example, needed counters
  on every write, while a key limit and a per-value cap bound the same storage with neither.
  This is pushback, never a unilateral change: the user decides, and the work follows the
  requirement they choose.
- **Security and privacy sit outside this bar.** An authorization gap, a data leak, an
  injection or mishandled credentials is surfaced however unlikely its trigger.
- **What falls below the bar is left out.** A reviewer does not report it, not even as
  accepted, and a design adds no machinery for it. When a design accepts a rare failure, the
  spec's "Accepted trade-offs" names it once with the damage it accepts.

Applied to oxgl:

- **The safety rules above sit outside this bar, like security.** Undefined behavior, memory
  unsafety, panics or crashes of the host Node process, and leaks in normal operation (including
  contexts and objects dropped without explicit cleanup) are always in scope.
- **Rare backend and driver failures are below the bar unless they cause that kind of damage.**
  Examples are a GPU driver reset, a lost device, or a backend that fails once and works later.
  Failing the call, losing the context, or falling back until the process restarts is accepted.
- Every review in this repo, including `/code-review`, applies this bar before reporting a finding.
