//! Create/destroy soak on `SwiftShader`: no EGL context or surface outlives
//! its WebGL context. Also run under `AddressSanitizer` in CI (`asan` job).

mod common;

use common::{Memory, rgba, runtime, serial, software};
use oxgl_sys::ViewKind;
use oxgl_sys::bindings::GL_COLOR_BUFFER_BIT;
use oxgl_sys::{live_contexts, live_surfaces};

const CYCLES: usize = 1000;

#[test]
fn contexts_and_surfaces_return_to_zero() {
    let _serial = serial();
    let before = (live_contexts(), live_surfaces());
    let mut rt = runtime();
    let pixel = Memory::new(ViewKind::Uint8, 4, 0);
    for cycle in 0..CYCLES {
        let key = software(&mut rt, 256.0, 256.0, cycle % 2 == 1);
        let context = rt.context(key).unwrap();
        context.clear_color(0.0, 1.0, 0.0, 1.0);
        context.clear(GL_COLOR_BUFFER_BIT);
        context.read_pixels(rgba(0, 0, 1, 1), Some(&pixel));
        // Alternate the two release paths: destroy() and GC release.
        if cycle % 3 == 0 {
            rt.release(key);
        } else {
            rt.destroy(key);
        }
        assert_eq!((live_contexts(), live_surfaces()), before, "cycle {cycle}");
    }
    assert_eq!(pixel.bytes(), [0, 255, 0, 255]);
    assert_eq!(rt.live_contexts(), 0);
}
