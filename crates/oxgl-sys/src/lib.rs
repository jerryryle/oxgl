//! Raw FFI for oxgl: ANGLE (EGL/GLES), plus minimal Node-API typed-array access
//! behind the `node` feature. This is the only workspace crate allowed to
//! contain `unsafe` code; every `unsafe` block carries a `// SAFETY:` comment.
#![deny(unsafe_op_in_unsafe_fn)]
