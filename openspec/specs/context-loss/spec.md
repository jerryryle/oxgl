# context-loss Specification

## Purpose
Covers how a WebGL context reports and handles the loss of its context: the lost flag and its query, and later the lost and restored events and `WEBGL_lose_context` (WebGL 1.0 §5.15).

## Requirements

### Requirement: isContextLost
`isContextLost()` SHALL return whether the context's webgl context lost flag is set (WebGL 1.0 §5.14.13): `false` for a live context, and `true` after `destroy()` or after the backend has lost the context.

#### Scenario: Live context
- **WHEN** `isContextLost()` is called on a new context
- **THEN** it returns `false`

#### Scenario: After destroy
- **WHEN** a context is destroyed and `isContextLost()` is called
- **THEN** it returns `true`

#### Scenario: After a device loss
- **WHEN** the backend loses the context and `isContextLost()` is called next
- **THEN** it returns `true`, and keeps returning `true` (cf. Khronos `conformance/context/context-lost.html`)
