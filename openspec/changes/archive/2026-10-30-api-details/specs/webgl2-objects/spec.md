# Spec Delta

## MODIFIED Requirements

### Requirement: Sync objects
`fenceSync`, `isSync`, `deleteSync`, `clientWaitSync`, `waitSync` and `getSyncParameter` SHALL behave as WebGL 2.0 §3.7.14 specifies. `clientWaitSync` SHALL NOT block; a timeout above `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` SHALL generate `INVALID_OPERATION`, and the sync SHALL NOT signal before control returns to the event loop.

#### Scenario: Signaled after a turn
- **WHEN** `fenceSync` is called and `getSyncParameter(sync, SYNC_STATUS)` is read at once and after a `setTimeout`
- **THEN** it is `UNSIGNALED`, then `SIGNALED`, and `clientWaitSync(sync, 0, 0)` then returns `ALREADY_SIGNALED` or `CONDITION_SATISFIED` (cf. Khronos `conformance2/sync/sync-webgl-specific.html`)

## ADDED Requirements

### Requirement: Query lifetime details
`getQueryParameter` SHALL generate `INVALID_OPERATION` for a query never begun, and `deleteQuery` on an active query SHALL end it first, leaving its target free.

#### Scenario: Delete an active query
- **WHEN** a `TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN` query is begun and deleted, and a new query is begun on that target
- **THEN** no error is generated (cf. Khronos `conformance2/query/query.html`)
