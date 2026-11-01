# Spec Delta

## MODIFIED Requirements

### Requirement: Results report
Every run SHALL write a machine-readable report that records, per example, the outcome, the percentage of differing pixels when a frame was compared, the duration, and the first error or message. An example with an expectations entry that applies on the run's platform SHALL also record that entry's reason. It SHALL also record the pinned tag and commit, the requested backend, both time limits, the parallelism, the platform and the timestamp. Each `TIMEOUT` SHALL name the limit it reached.

#### Scenario: Timeout names its limit
- **WHEN** an example keeps a request pending forever
- **THEN** its report entry is `TIMEOUT` and names the limit without progress, and the report records both limits

#### Scenario: Reason recorded for a skipped example
- **WHEN** `css3d_youtube` is listed as `SKIP # upstream: video hangs CI` and the run does not include skipped examples
- **THEN** its report entry records the outcome `SKIP` and the reason "upstream: video hangs CI"
