//! Shared helpers for the `SwiftShader` integration tests.

#![allow(dead_code, reason = "each test binary uses a subset")]
#![allow(clippy::unwrap_used, clippy::indexing_slicing, reason = "test helpers")]

use std::cell::RefCell;
use std::panic::{self, AssertUnwindSafe};
use std::sync::{OnceLock, mpsc};

use oxgl_core::{ContextKey, ContextRequest, RequestedBackend, Runtime};
use oxgl_sys::bindings::{GL_RGBA, GL_UNSIGNED_BYTE};
use oxgl_sys::{PixelDestination, ReadPixels, ViewKind};

/// Runs `f` on one long-lived thread shared by every test in the binary,
/// which also serializes them (the live-object counters are process-wide).
///
/// ANGLE intentionally never frees the per-thread state it allocates when a
/// thread first calls EGL. A thread that stays alive keeps it reachable, so
/// `LeakSanitizer` does not report it as it would for libtest's per-test
/// threads. Panics are re-raised on the calling thread.
pub fn on_gl_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    type Job = Box<dyn FnOnce() + Send>;
    static GL_THREAD: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
    let sender = GL_THREAD.get_or_init(|| {
        let (sender, jobs) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("gl".into())
            .spawn(move || jobs.into_iter().for_each(|job| job()))
            .unwrap();
        sender
    });
    let (done, result) = mpsc::channel();
    sender
        .send(Box::new(move || {
            let _ = done.send(panic::catch_unwind(AssertUnwindSafe(f)));
        }))
        .unwrap();
    result
        .recv()
        .unwrap()
        .unwrap_or_else(|payload| panic::resume_unwind(payload))
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
