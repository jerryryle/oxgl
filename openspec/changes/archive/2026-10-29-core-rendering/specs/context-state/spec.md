# Spec Delta

## ADDED Requirements

### Requirement: Buffer and program bindings in getParameter
`getParameter` SHALL return the bound buffer object, or `null`, for the binding parameter of each buffer target the context has (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2), and the current program object, or `null`, for `CURRENT_PROGRAM`. The object returned SHALL be the one that was bound.

#### Scenario: Same object returned
- **WHEN** `buffer` is bound to `ELEMENT_ARRAY_BUFFER`
- **THEN** `getParameter(ELEMENT_ARRAY_BUFFER_BINDING) === buffer` (cf. Khronos `conformance/state/gl-object-get-calls.html`)

#### Scenario: Deleted buffer unbinds
- **WHEN** the bound `ARRAY_BUFFER` is deleted
- **THEN** `getParameter(ARRAY_BUFFER_BINDING)` returns `null`
