# Design

## Context

See proposal.md (Why) for the evidence. The current test runs two warm-up passes and then one measured pass, and compares RSS after the measured pass with RSS before it. RSS moves in occasional one-off swings that do not come from oxgl's GC path: upward high-water steps of about 15–48 MiB, and downward trims of up to 14 MiB. The `destroy()` path produces the same curve locally. When a step falls in the measured pass, the test fails.

## Goals / Non-Goals

**Goals:** a test that does not depend on when an allocator swing happens, and that still fails on any leak clearly above 32 MiB per 1,000 dropped contexts (about 32 KiB per context; one 256×256 context's buffers alone are about 512 KiB).

**Non-Goals:** catching leaks below, or only just above, the threshold (see Risks); changing the `destroy()` soak test.

## Decisions

- **Gate on the median per-pass growth over three measured passes.** A leak of L per pass adds about L to every pass, while an allocator swing is a one-off. With one swing among the three passes, the median is the value from a quiet pass: about L for a leak, about 0 for noise.
  - *Rejected: minimum.* A trim in one pass pulls the minimum down. A 40 MiB/pass leak with one 14 MiB trim gives {40, 26, 40}: the minimum, 26, passes, while the median, 40, fails as it should. Noise of {0, 0, 40} has a median of 0 either way.
  - *Rejected: raise the limit.* The noise reaches 48 MiB. A limit above that would loosen the gate, and the next larger step would make it flaky again.
  - *Rejected: longer warm-up.* The step lands at a random pass (pass 9 in one local run, none in 40 passes of another), so no fixed warm-up guarantees it happens before the baseline.
  - *Rejected: total over the passes.* It still includes the step.
- **Three passes, with the rate to be confirmed on Linux.** A false failure needs two of the three consecutive passes to step by more than 32 MiB. The only evidence so far is single passes from separate CI jobs: 3 of about 25 exceeded 32 MiB. Locally on macOS, 40 consecutive passes in one process stepped by more than 5 MiB only twice, and never twice in a row. Nobody has measured consecutive passes in one process on Linux, where the failures were. The test therefore reports all three growths, and the PR's repeated CI runs (tasks 2.1) supply that data before archive. If Linux shows steps clustering in consecutive passes, use five passes (the median then needs three steps), at about 0.4 s per extra pass.
- **One measurement helper.** It runs the warm-up and N measured passes of a given pass function, and returns the per-pass growths. The GC test calls it; the `destroy()` soak could adopt it later without restructuring.
- **Counter gate kept explicit.** Each pass already waits, failing after 10 s, until `liveContexts()` returns to its baseline every 100 contexts. After each measured pass the test also asserts that the count equals the pre-test value. The counter tracks the runtime's slotmap, whose removal drops the native context, so a dropped context that is never released fails deterministically, independent of RSS.
- **Leak injection verifies the RSS gate, not the counter.** A leak that keeps slotmap entries alive is caught by the counter wait before RSS is ever measured. So verification uses a temporary change that frees contexts normally but leaks a touched 64 KiB allocation per collected context (about 64 MiB per pass). The counter stays correct, so only the RSS assertion can fail. The change is in `oxgl-node`'s finalizer path, uses safe Rust (`Box::leak`), and is reverted before commit.

Safety rules: the committed change is test-only JS; no `unsafe`, handles, or ArrayBuffer lifetimes are touched.

## Risks / Trade-offs

- [Free memory the allocator holds after a step absorbs part of a leak] → a leak only slightly above 32 MiB per pass can read under the threshold in two of the three passes and go undetected in that run. This is accepted, and named in the spec. Whole-context leaks (about 512 MiB per pass) and the 64 MiB/pass injection are well clear of it.
- [Steps cluster on Linux] → this is unmeasured. The per-pass diagnostics from the PR's CI runs settle it; the fallback is five passes.
