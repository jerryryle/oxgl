## ADDED Requirements

### Requirement: Rejected links keep uniform locations
A `linkProgram` call that GL rejects without attempting a link, such as one on a program active in transform feedback (OpenGL ES 3.0 §2.15.2), SHALL NOT count as a link: the program's earlier uniform locations SHALL stay valid and `getUniform` SHALL keep answering for them. An attempted link, successful or failed, still invalidates them (WebGL 1.0 §5.14.10).

#### Scenario: Link rejected during transform feedback (WebGL 2)
- **WHEN** a WebGL 2 program with a `float` uniform is current and active in transform feedback, `linkProgram` on it generates `INVALID_OPERATION`, and `uniform1f` is then called with a location obtained before that call
- **THEN** no error is generated and `getUniform` returns the new value (cf. Khronos `conformance2/transform_feedback/switching-programs.html`)
