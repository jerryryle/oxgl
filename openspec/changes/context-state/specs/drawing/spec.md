# Spec Delta

## ADDED Requirements

### Requirement: flush and finish
`flush()` and `finish()` SHALL behave as WebGL 1.0 §5.14.11 specifies: `finish()` SHALL return only after every earlier command has completed, and neither SHALL generate an error. On a lost context both SHALL do nothing.

#### Scenario: Finish after clear
- **WHEN** `clear(COLOR_BUFFER_BIT)`, then `flush()` and `finish()` are called
- **THEN** both return `undefined`, `getError()` returns `NO_ERROR`, and a following `readPixels` sees the cleared color
