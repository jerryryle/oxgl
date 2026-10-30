//! backend-selection: "Import touches nothing". Its own test binary, so no
//! other test has initialized `SwiftShader` in this process.

#![allow(clippy::unwrap_used, reason = "test")]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use oxgl_core::{ContextRequest, CoreError, RequestedBackend, Runtime};

#[test]
fn gpu_contexts_leave_the_environment_alone() {
    let mut runtime = Runtime::new(oxgl_sys::test_support::bundle_dir());
    let request = ContextRequest {
        width: 4.0,
        height: 4.0,
        webgl2: false,
        attributes: oxgl_core::Attributes::DEFAULT,
    };
    // Initializes the GPU display before watching; skip without a GPU.
    match runtime.create_context(RequestedBackend::Gpu, &request) {
        Ok(key) => runtime.destroy(key),
        Err(CoreError::GpuUnavailable(reason)) => {
            eprintln!("skipped: {reason}");
            return;
        }
        Err(error) => panic!("{error}"),
    }

    // If GPU use ever initialized SwiftShader, ANGLE would set
    // VK_ICD_FILENAMES while this thread reads it: the test may then crash
    // instead of failing the assertion, and either means the same regression.
    let stop = Arc::new(AtomicBool::new(false));
    let watcher = {
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut seen = false;
            while !stop.load(Ordering::Relaxed) {
                seen |= std::env::var_os("VK_ICD_FILENAMES").is_some();
            }
            seen
        })
    };
    for _ in 0..20 {
        let key = runtime
            .create_context(RequestedBackend::Gpu, &request)
            .unwrap();
        runtime.destroy(key);
    }
    stop.store(true, Ordering::Relaxed);
    assert!(
        !watcher.join().unwrap(),
        "VK_ICD_FILENAMES was set by GPU contexts"
    );
}
