# Spec Delta

## MODIFIED Requirements

### Requirement: Results report
Every run SHALL write a machine-readable report recording, per suite and page, the outcome, the counts of passing and failing results, the duration, and the first failure message or error. A page with an expectations entry that applies on the run's platform SHALL also record that entry's reason. The report SHALL also record the suite commit, the requested oxgl backend, the per-page time limit, the number of pages run in parallel, platform and timestamp.

#### Scenario: Report after a failed run
- **WHEN** a run fails because of a regression
- **THEN** the report is still written and contains the regressed page's failure message

#### Scenario: Reason recorded
- **WHEN** a page has the entry `webgl1 conformance/glsl/misc/shader-with-double-underscore.html FAIL # ANGLE: rejects identifiers containing __ in WebGL shaders (TParseContext::checkIsNotReserved), which the test expects to compile; see angle/README.md` (it applies on every platform)
- **THEN** that page's report entry records the outcome, the expected `FAIL` and that reason, and a page without an applicable entry records no reason
