//! Safe core of oxgl: owns contexts, handles, validation and error state.
#![forbid(unsafe_code)]

pub mod backend;
pub mod context;
pub mod error;
pub mod pixels;
pub mod runtime;

pub use backend::{Backend, ContextRequest, RequestedBackend};
pub use context::Context;
pub use error::{CONTEXT_LOST_WEBGL, CoreError};
pub use runtime::{ContextKey, Runtime, key_from_parts, key_to_parts};
