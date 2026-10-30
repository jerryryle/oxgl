# Spec Delta

## ADDED Requirements

### Requirement: Results in the caller's realm
Arrays that WebGL calls return SHALL be created by the JS layer, so that in a page realm (such as the conformance runner's) their constructor is that realm's `Array`.

#### Scenario: Color write mask in a page
- **WHEN** a page compares `getParameter(COLOR_WRITEMASK).constructor` with its own `Array`
- **THEN** they are the same (cf. deqp `booleanstatequery`)
