//! Shared helpers for the `SwiftShader` integration tests.

#![allow(dead_code, reason = "each test binary uses a subset")]
#![allow(clippy::unwrap_used, clippy::indexing_slicing, reason = "test helpers")]

use std::cell::RefCell;
use std::sync::{Mutex, MutexGuard, PoisonError};

use oxgl_core::{ContextKey, ContextRequest, RequestedBackend, Runtime};
use oxgl_sys::bindings::{GL_RGBA, GL_UNSIGNED_BYTE};
use oxgl_sys::{PixelDestination, ReadPixels, ViewKind};

/// Serializes tests that create contexts: the live-object counters are
/// process-wide.
static SERIAL: Mutex<()> = Mutex::new(());

pub fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn runtime() -> Runtime {
    Runtime::new(oxgl_sys::test_support::bundle_dir())
}

pub fn software(runtime: &mut Runtime, width: f64, height: f64, webgl2: bool) -> ContextKey {
    runtime
        .create_context(
            RequestedBackend::Software,
            &ContextRequest {
                width,
                height,
                webgl2,
            },
        )
        .unwrap()
}

/// Plain memory standing in for a typed array.
pub struct Memory {
    pub kind: ViewKind,
    pub bytes: RefCell<Vec<u8>>,
}

impl Memory {
    pub fn new(kind: ViewKind, len: usize, fill: u8) -> Self {
        Self {
            kind,
            bytes: RefCell::new(vec![fill; len]),
        }
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.borrow().clone()
    }
}

impl PixelDestination for Memory {
    fn kind(&self) -> ViewKind {
        self.kind
    }

    fn byte_len(&self) -> usize {
        self.bytes.borrow().len()
    }

    fn copy_to(&self, buffer: &mut [u8]) {
        let bytes = self.bytes.borrow();
        let n = buffer.len().min(bytes.len());
        buffer[..n].copy_from_slice(&bytes[..n]);
    }

    fn copy_from(&self, buffer: &[u8]) {
        let mut bytes = self.bytes.borrow_mut();
        let n = buffer.len().min(bytes.len());
        bytes[..n].copy_from_slice(&buffer[..n]);
    }
}

pub fn rgba(x: i32, y: i32, width: i32, height: i32) -> ReadPixels {
    ReadPixels {
        x,
        y,
        width,
        height,
        format: GL_RGBA,
        ty: GL_UNSIGNED_BYTE,
    }
}
