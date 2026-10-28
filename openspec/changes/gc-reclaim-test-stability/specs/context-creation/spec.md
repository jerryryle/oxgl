# Spec Delta

## MODIFIED Requirements

### Requirement: Garbage-collected contexts release resources
A context that becomes unreachable without `destroy()` SHALL have its native resources released after garbage collection, on the thread that created it, without requiring further API calls.

Accepted trade-off (allocator noise): resident memory is gated on the median growth of three passes. A leak only slightly above the soak-test threshold can be absorbed by free memory the allocator already holds after a high-water step, and then goes undetected in that run. A leak of whole contexts (about 512 KiB each at 256×256) is far above this margin.

#### Scenario: Dropped contexts are reclaimed
- **WHEN** 1,000 contexts are created one per iteration, each dropped without `destroy()` before the next is created, with garbage collection forced every 100 iterations, and the test then repeatedly forces garbage collection and yields to the event loop until its own `FinalizationRegistry` has seen every context collected (failing after 10 seconds), then yields 10 more event-loop turns; and this pass runs three times in a row after the warm-up, with resident memory measured after a forced garbage collection before the first pass and after each pass
- **THEN** the live-context count is back at its pre-test value after every pass, and the median of the three per-pass resident-memory increases is within the soak-test threshold, with no further oxgl call needed
