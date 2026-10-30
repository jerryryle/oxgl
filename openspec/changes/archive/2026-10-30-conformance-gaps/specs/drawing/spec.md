# Spec Delta

## ADDED Requirements

### Requirement: Primitive restart on WebGL 2
WebGL 2 contexts SHALL restart primitives at the fixed maximum index of the index type, and `enable`, `disable` and `isEnabled` SHALL generate `INVALID_ENUM` for `PRIMITIVE_RESTART_FIXED_INDEX` (WebGL 2.0 §5.18).

#### Scenario: Restart index splits a strip
- **WHEN** a WebGL 2 `TRIANGLE_STRIP` element draw includes the index `0xFFFF` with `UNSIGNED_SHORT` indices
- **THEN** it renders as two strips (cf. deqp `primitiverestart`)
