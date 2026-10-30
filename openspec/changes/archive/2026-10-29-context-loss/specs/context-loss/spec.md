# Spec Delta

## ADDED Requirements

### Requirement: Context lost event
When a context's webgl context lost flag becomes set, other than by `destroy()`, oxgl SHALL queue a task that fires a cancelable `webglcontextlost` event, a `WebGLContextEvent` with an empty `statusMessage`, at the context's canvas, as WebGL 1.0 §5.15.2 specifies. The context SHALL be lost before the event fires.

#### Scenario: Event after loseContext
- **WHEN** `WEBGL_lose_context.loseContext()` is called with a `webglcontextlost` listener on the canvas
- **THEN** `isContextLost()` is `true` and `getError()` returns `CONTEXT_LOST_WEBGL` then `NO_ERROR` at once, and the listener runs in a later task (cf. Khronos `conformance/context/context-lost-restored.html`)

#### Scenario: loseContext on a lost context
- **WHEN** `loseContext()` is called on a context that is already lost, after `CONTEXT_LOST_WEBGL` was reported
- **THEN** `getError()` returns `INVALID_OPERATION` (cf. Khronos `conformance/context/context-lost.html`)

### Requirement: Restoring a context
A context lost by `loseContext()` whose `webglcontextlost` event was cancelled SHALL be restored after `restoreContext()`, and one lost by the backend whose event was cancelled SHALL be restored without it (WebGL 1.0 §5.15.3): a new drawing buffer with the original creation parameters, fresh state, then `webglcontextrestored` at the canvas. Objects created before SHALL generate `INVALID_OPERATION` with the restored context.

#### Scenario: Restore after a cancelled event
- **WHEN** the `webglcontextlost` listener calls `preventDefault()` and `restoreContext()` is called afterwards, twice
- **THEN** neither call generates an error, the context stays lost until `webglcontextrestored` fires, and then it is not lost, renders, and `bindTexture` with a texture created before the loss generates `INVALID_OPERATION` (cf. Khronos `conformance/context/context-lost-restored.html`)

#### Scenario: Extensions after a restore
- **WHEN** a context with `OES_vertex_array_object` and `WEBGL_lose_context` enabled is restored
- **THEN** `getExtension('WEBGL_lose_context')` returns the same object as before, `getExtension('OES_vertex_array_object')` returns a new object, and the old one's `createVertexArrayOES()` returns an object for which `isVertexArrayOES` is `false`

### Requirement: Refused restore
`restoreContext()` SHALL generate `INVALID_OPERATION` when the context is not lost, or when its lost event has not fired or was not cancelled.

#### Scenario: No restore without cancelling
- **WHEN** the `webglcontextlost` listener does not call `preventDefault()` and `restoreContext()` is called afterwards
- **THEN** it generates `INVALID_OPERATION` and no `webglcontextrestored` event fires

### Requirement: WebGLContextEvent
`WebGLContextEvent` SHALL be exported and constructible as its IDL defines (WebGL 1.0 §5.15.1), with `statusMessage` from the init dictionary, `''` by default.

#### Scenario: Construct an event
- **WHEN** `new WebGLContextEvent('webglcontextlost', { statusMessage: 'x', cancelable: true })` is created
- **THEN** its `type` is `webglcontextlost`, `statusMessage` is `x` and `cancelable` is `true`
