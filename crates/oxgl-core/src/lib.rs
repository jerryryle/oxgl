//! Safe core of oxgl: owns contexts, handles, validation and error state.
#![forbid(unsafe_code)]

pub mod backend;
pub mod codec;
pub mod context;
pub mod drawing_buffer;
pub mod error;
pub mod parameters;
pub mod pixels;
pub mod rendering;
pub mod runtime;
pub mod state;
pub mod textures;

pub use backend::{Backend, ContextRequest, RequestedBackend};
pub use context::Context;
pub use drawing_buffer::{Attributes, DrawingBuffer};
pub use error::{CONTEXT_LOST_WEBGL, CoreError};
pub use runtime::{
    ContextKey, Runtime, key_from_parts, key_to_parts, object_key_from_parts, object_key_to_parts,
};
