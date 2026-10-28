# Design

## Context

See proposal.md (Why) for the evidence. The current test runs two warm-up passes and then one measured pass, and compares RSS after the measured pass with RSS before it. RSS grows in occasional one-off steps of about 15–48 MiB: the allocator raising its high-water mark, independent of oxgl's GC path. The `destroy()` path produces the same curve locally. When a step falls in the measured pass, the test fails.

## Goals / Non-Goals

**Goals:** a test that does not depend on when an allocator step happens, and that still fails on any leak that grows RSS by more than 32 MiB per 1,000 dropped contexts (about 32 KiB per context; one 256×256 context's buffers alone are about 512 KiB).

**Non-Goals:** catching sub-threshold leaks, and changing the destroy() soak test.

## Decisions

- **Gate on the minimum per-pass growth over three measured passes.** A leak of L per pass adds about L to every pass once the allocator's free reserve is used up. A high-water step happens once and is not repeated by the next pass. So min(growth₁, growth₂, growth₃) is about L for a leak and about 0 for noise.
  - *Rejected: raise the limit.* The noise reaches 48 MiB. A limit above that would loosen the gate, and the next larger step would make it flaky again.
  - *Rejected: longer warm-up.* The step lands at a random pass (pass 9 in one local run, none in 40 passes of another), so no fixed warm-up guarantees it happens before the baseline.
  - *Rejected: median, or total over the passes.* The total still includes the step. The median of three equals the minimum unless two passes step, so it adds nothing.
- **Three passes.** A false failure would need a step above 32 MiB in each of three consecutive passes. Across recent CI runs, single measured passes exceeded 32 MiB about one time in six, and steps do not repeat back to back. Each extra pass costs about 0.4 s.
- **Counter gate kept explicit.** Each pass already waits, failing after 10 s, until `liveContexts()` returns to its baseline every 100 contexts. After each measured pass the test also asserts that the count equals the pre-test value. The counter tracks the runtime's slotmap, whose removal drops the native context, so a dropped context that is never released fails deterministically, independent of RSS.
- **Diagnostics.** The test reports all three per-pass growths, so the CI log shows the noise and any trend.

Safety rules: test-only JS change; no `unsafe`, handles, or ArrayBuffer lifetimes are touched.

## Risks / Trade-offs

- [A leak whose per-pass growth is absorbed by already-resident free memory] → this only delays detection. The reserve runs out within a pass or two, and the later passes then show the full growth, so the minimum still exceeds the threshold for any leak above 32 MiB per pass.
- [Steps above 32 MiB in all three measured passes] → not seen in local or CI data. If it happens, the diagnostics show it.
