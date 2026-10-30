# Spec Delta

## ADDED Requirements

### Requirement: WebGL 2 object bindings in getParameter
On WebGL 2, `getParameter` SHALL return the bound `WebGLVertexArrayObject` (or `null` for the default) for `VERTEX_ARRAY_BINDING` and the bound `WebGLTransformFeedback` (or `null`) for `TRANSFORM_FEEDBACK_BINDING` (WebGL 2.0 §3.7.2).

#### Scenario: Bound vertex array
- **WHEN** vertex array V is bound
- **THEN** `getParameter(VERTEX_ARRAY_BINDING) === V`
