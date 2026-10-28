//! Context lifecycle, drawing, readback, and error scenarios on `SwiftShader`.

mod common;

use common::{Memory, on_gl_thread, rgba, runtime, software};
use oxgl_core::{
    CONTEXT_LOST_WEBGL, ContextRequest, RequestedBackend, key_from_parts, key_to_parts,
};
use oxgl_sys::ViewKind;
use oxgl_sys::bindings::{
    GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT, GL_INVALID_ENUM, GL_INVALID_OPERATION,
    GL_INVALID_VALUE, GL_NO_ERROR, GL_STENCIL_BUFFER_BIT,
};
use oxgl_sys::{ReadPixels, live_contexts, live_surfaces};

#[test]
fn create_and_destroy_release_everything() {
    on_gl_thread(move || {
        let mut rt = runtime();
        let before = (live_contexts(), live_surfaces());
        let key = software(&mut rt, 64.0, 32.0, false);
        let buffer = rt.context(key).unwrap().drawing_buffer();
        assert_eq!((buffer.width(), buffer.height()), (64, 32));
        assert_eq!(
            (live_contexts(), live_surfaces()),
            (before.0 + 1, before.1 + 1)
        );
        rt.destroy(key);
        rt.destroy(key);
        assert_eq!((live_contexts(), live_surfaces()), before);
        assert_eq!(rt.live_contexts(), 0);
    });
}

#[test]
fn stale_key_resolves_to_nothing() {
    on_gl_thread(move || {
        let mut rt = runtime();
        let key = software(&mut rt, 4.0, 4.0, false);
        let parts = key_to_parts(key);
        rt.destroy(key);
        let replacement = software(&mut rt, 4.0, 4.0, false);
        assert!(rt.context(key_from_parts(parts)).is_none());
        assert!(rt.context(replacement).is_some());
        rt.release(replacement);
        assert!(rt.context(replacement).is_none());
        assert_eq!(rt.live_contexts(), 0);
    });
}

#[test]
fn destroy_all_releases_everything() {
    on_gl_thread(move || {
        let before = (live_contexts(), live_surfaces());
        let mut rt = runtime();
        for _ in 0..3 {
            software(&mut rt, 8.0, 8.0, false);
        }
        rt.destroy_all();
        assert_eq!((live_contexts(), live_surfaces()), before);
    });
}

#[test]
fn interleaved_contexts_are_independent() {
    on_gl_thread(move || {
        let mut rt = runtime();
        let a = software(&mut rt, 2.0, 2.0, false);
        let b = software(&mut rt, 2.0, 2.0, false);
        rt.context(a).unwrap().clear_color(1.0, 0.0, 0.0, 1.0);
        rt.context(b).unwrap().clear_color(0.0, 0.0, 1.0, 1.0);
        rt.context(a).unwrap().clear(GL_COLOR_BUFFER_BIT);
        rt.context(b).unwrap().clear(GL_COLOR_BUFFER_BIT);
        rt.context(a).unwrap().clear(0x1);
        let read = |rt: &mut oxgl_core::Runtime, key| {
            let memory = Memory::new(ViewKind::Uint8, 16, 0);
            rt.context(key)
                .unwrap()
                .read_pixels(rgba(0, 0, 2, 2), Some(&memory));
            memory.bytes()
        };
        assert!(read(&mut rt, a).chunks(4).all(|p| p == [255, 0, 0, 255]));
        assert!(read(&mut rt, b).chunks(4).all(|p| p == [0, 0, 255, 255]));
        assert_eq!(rt.context(b).unwrap().get_error(), GL_NO_ERROR);
        assert_eq!(rt.context(a).unwrap().get_error(), GL_INVALID_VALUE);
        rt.destroy_all();
    });
}

#[test]
fn webgl2_context() {
    on_gl_thread(move || {
        let mut rt = runtime();
        let key = software(&mut rt, 64.0, 32.0, true);
        assert_eq!(rt.context(key).unwrap().get_error(), GL_NO_ERROR);
        rt.destroy(key);
    });
}

#[test]
fn oversized_request_is_clamped() {
    on_gl_thread(move || {
        let mut rt = runtime();
        let key = software(&mut rt, 1_000_000.0, 500_000.0, false);
        let buffer = rt.context(key).unwrap().drawing_buffer();
        let (w, h) = (buffer.width(), buffer.height());
        assert!(w < 1_000_000 && w > 0, "{w}x{h}");
        assert!((f64::from(w) - 2.0 * f64::from(h)).abs() <= 2.0, "{w}x{h}");
        rt.destroy(key);
    });
}

#[allow(clippy::unwrap_used, reason = "test helper")]
fn with_context(
    width: f64,
    height: f64,
    test: impl FnOnce(&mut oxgl_core::Context) + Send + 'static,
) {
    on_gl_thread(move || {
        let mut rt = runtime();
        let key = software(&mut rt, width, height, false);
        test(rt.context(key).unwrap());
        rt.destroy(key);
    });
}

#[test]
fn initial_contents_are_zero() {
    with_context(4.0, 4.0, |gl| {
        let memory = Memory::new(ViewKind::Uint8, 64, 9);
        gl.read_pixels(rgba(0, 0, 4, 4), Some(&memory));
        assert!(memory.bytes().iter().all(|&b| b == 0));
    });
}

#[test]
fn alpha_channel_is_present_and_contents_persist() {
    with_context(2.0, 2.0, |gl| {
        gl.clear_color(0.0, 0.0, 0.0, 0.5);
        gl.clear(GL_COLOR_BUFFER_BIT);
        let first = Memory::new(ViewKind::Uint8, 16, 0);
        let second = Memory::new(ViewKind::Uint8, 16, 0);
        gl.read_pixels(rgba(0, 0, 2, 2), Some(&first));
        gl.read_pixels(rgba(0, 0, 2, 2), Some(&second));
        let alpha = first.bytes()[3];
        assert!(alpha == 127 || alpha == 128, "{alpha}");
        assert_eq!(first.bytes(), second.bytes());
    });
}

#[test]
fn clear_color_is_clamped() {
    with_context(1.0, 1.0, |gl| {
        gl.clear_color(2.0, -1.0, 0.5, 1.0);
        gl.clear(GL_COLOR_BUFFER_BIT);
        let memory = Memory::new(ViewKind::Uint8, 4, 0);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&memory));
        let pixel = memory.bytes();
        assert_eq!([pixel[0], pixel[1], pixel[3]], [255, 0, 255]);
        assert!(pixel[2] == 127 || pixel[2] == 128);
    });
}

#[test]
fn clear_masks() {
    with_context(1.0, 1.0, |gl| {
        gl.clear_color(1.0, 1.0, 1.0, 1.0);
        gl.clear(0x1);
        assert_eq!(gl.get_error(), GL_INVALID_VALUE);
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        let memory = Memory::new(ViewKind::Uint8, 4, 9);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&memory));
        assert_eq!(
            memory.bytes(),
            [0, 0, 0, 0],
            "invalid mask leaves the buffer unchanged"
        );
        gl.clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&memory));
        assert_eq!(memory.bytes(), [255, 255, 255, 255]);
    });
}

#[test]
fn read_after_clear() {
    with_context(5.0, 3.0, |gl| {
        gl.clear_color(0.0, 1.0, 0.0, 1.0);
        gl.clear(GL_COLOR_BUFFER_BIT);
        let memory = Memory::new(ViewKind::Uint8, 60, 0);
        gl.read_pixels(rgba(0, 0, 5, 3), Some(&memory));
        assert!(memory.bytes().chunks(4).all(|p| p == [0, 255, 0, 255]));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
    });
}

#[test]
fn exact_required_size() {
    with_context(4.0, 4.0, |gl| {
        let exact = Memory::new(ViewKind::Uint8, 24, 9);
        gl.read_pixels(rgba(0, 0, 3, 2), Some(&exact));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        assert!(exact.bytes().iter().all(|&b| b == 0));
        let short = Memory::new(ViewKind::Uint8, 23, 9);
        gl.read_pixels(rgba(0, 0, 3, 2), Some(&short));
        assert_eq!(gl.get_error(), GL_INVALID_OPERATION);
        assert!(short.bytes().iter().all(|&b| b == 9));
    });
}

#[test]
fn uint8_clamped_is_accepted() {
    with_context(1.0, 1.0, |gl| {
        let memory = Memory::new(ViewKind::Uint8Clamped, 4, 9);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&memory));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        assert_eq!(memory.bytes(), [0, 0, 0, 0]);
    });
}

#[test]
fn invalid_format_is_an_enum_error() {
    with_context(1.0, 1.0, |gl| {
        let memory = Memory::new(ViewKind::Uint8, 4, 9);
        gl.read_pixels(
            ReadPixels {
                format: 0x1234,
                ..rgba(0, 0, 1, 1)
            },
            Some(&memory),
        );
        assert_eq!(gl.get_error(), GL_INVALID_ENUM);
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        assert!(memory.bytes().iter().all(|&b| b == 9));
    });
}

#[test]
fn destination_checks() {
    with_context(2.0, 2.0, |gl| {
        let float = Memory::new(ViewKind::Float32, 16, 9);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&float));
        assert_eq!(gl.get_error(), GL_INVALID_OPERATION);
        assert!(float.bytes().iter().all(|&b| b == 9));

        let data_view = Memory::new(ViewKind::DataView, 16, 9);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&data_view));
        assert_eq!(gl.get_error(), GL_INVALID_OPERATION);

        let small = Memory::new(ViewKind::Uint8, 15, 9);
        gl.read_pixels(rgba(0, 0, 2, 2), Some(&small));
        assert_eq!(gl.get_error(), GL_INVALID_OPERATION);
        assert!(small.bytes().iter().all(|&b| b == 9));

        gl.read_pixels(rgba(0, 0, 1, 1), None);
        assert_eq!(gl.get_error(), GL_INVALID_VALUE);

        let memory = Memory::new(ViewKind::Uint8, 4, 9);
        gl.read_pixels(rgba(0, 0, -1, 1), Some(&memory));
        assert_eq!(gl.get_error(), GL_INVALID_VALUE);
        assert!(memory.bytes().iter().all(|&b| b == 9));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
    });
}

#[test]
fn validation_and_gl_errors_share_flags() {
    with_context(1.0, 1.0, |gl| {
        let float = Memory::new(ViewKind::Float32, 16, 0);
        gl.read_pixels(rgba(0, 0, 1, 1), Some(&float));
        gl.clear(0x1);
        assert_eq!(gl.get_error(), GL_INVALID_OPERATION);
        assert_eq!(gl.get_error(), GL_INVALID_VALUE);
        assert_eq!(gl.get_error(), GL_NO_ERROR);
    });
}

#[test]
fn partially_outside_region_is_untouched() {
    with_context(4.0, 4.0, |gl| {
        gl.clear_color(1.0, 1.0, 1.0, 1.0);
        gl.clear(GL_COLOR_BUFFER_BIT);
        let memory = Memory::new(ViewKind::Uint8, 64, 7);
        gl.read_pixels(rgba(-2, -2, 4, 4), Some(&memory));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        let bytes = memory.bytes();
        for (index, pixel) in bytes.chunks(4).enumerate() {
            let (x, y) = (index % 4, index / 4);
            let expected = if x >= 2 && y >= 2 { [255; 4] } else { [7; 4] };
            assert_eq!(pixel, expected, "pixel ({x}, {y})");
        }
    });
}

#[test]
fn device_loss_enters_the_lost_state() {
    with_context(2.0, 2.0, |gl| {
        gl.clear(0x1);
        gl.lose_context();
        assert_eq!(gl.get_error(), CONTEXT_LOST_WEBGL);
        assert!(gl.is_lost());
        assert_eq!(gl.get_error(), GL_NO_ERROR);
        let memory = Memory::new(ViewKind::Uint8, 16, 9);
        gl.clear(GL_COLOR_BUFFER_BIT);
        gl.read_pixels(rgba(0, 0, 2, 2), Some(&memory));
        assert!(memory.bytes().iter().all(|&b| b == 9));
        assert_eq!(gl.get_error(), GL_NO_ERROR);
    });
}

#[test]
fn creation_failure_allocates_nothing() {
    on_gl_thread(move || {
        let before = (live_contexts(), live_surfaces());
        let mut rt = oxgl_core::Runtime::new(std::env::temp_dir().join("oxgl-no-such-bundle"));
        let error = rt
            .create_context(
                RequestedBackend::Software,
                &ContextRequest {
                    width: 1.0,
                    height: 1.0,
                    webgl2: false,
                },
            )
            .err();
        // The process-wide bundle may already be loaded by another test, in which
        // case the directory is not consulted and creation succeeds.
        if let Some(error) = error {
            assert_eq!(error.code(), "OXGL_NATIVE_MISSING");
        }
        drop(rt);
        assert_eq!((live_contexts(), live_surfaces()), before);
    });
}
