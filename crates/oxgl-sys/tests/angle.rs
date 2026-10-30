//! Loads the staged ANGLE bundle and drives the safe wrappers on `SwiftShader`.

#![allow(
    clippy::unwrap_used,
    clippy::indexing_slicing,
    clippy::panic,
    reason = "test helpers"
)]

use std::path::Path;

use oxgl_sys::bindings::{
    GL_COLOR_ATTACHMENT0, GL_COLOR_BUFFER_BIT, GL_DEPTH_ATTACHMENT, GL_DEPTH_COMPONENT24,
    GL_DEPTH_STENCIL_ATTACHMENT, GL_DEPTH24_STENCIL8, GL_FRAMEBUFFER, GL_FRAMEBUFFER_COMPLETE,
    GL_INVALID_OPERATION, GL_MAX_RENDERBUFFER_SIZE, GL_MAX_VIEWPORT_DIMS, GL_NO_ERROR,
    GL_RENDERBUFFER, GL_RENDERER, GL_RGB8, GL_RGBA, GL_RGBA8, GL_STENCIL_ATTACHMENT,
    GL_STENCIL_INDEX8, GL_UNSIGNED_BYTE,
};
use oxgl_sys::test_support::bundle_dir;
use oxgl_sys::{
    Angle, ClientVersion, Display, DisplayKind, LoadErrorKind, ReadPixels, ValueType, Values,
};

#[test]
fn loads_the_staged_bundle() {
    Angle::load(&bundle_dir()).unwrap();
}

#[test]
fn empty_directory_is_a_missing_file() {
    let dir = std::env::temp_dir().join(format!("oxgl-empty-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let error = Angle::load(&dir).unwrap_err();
    std::fs::remove_dir_all(&dir).unwrap();
    assert_eq!(error.kind, LoadErrorKind::MissingFile);
    assert!(error.detail.contains("libEGL"), "{error}");
}

#[test]
fn relative_directory_is_rejected() {
    let error = Angle::load(Path::new("angle/lib")).unwrap_err();
    assert_eq!(error.kind, LoadErrorKind::RelativeDirectory);
}

/// Runs `f` on a thread that stays alive (parked) afterwards. ANGLE never frees
/// the per-thread state a thread allocates on its first EGL call; a live
/// thread keeps it reachable, so `LeakSanitizer` does not report it.
fn on_lasting_thread(f: impl FnOnce() + Send + 'static) {
    let (done, result) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)));
        loop {
            std::thread::park();
        }
    });
    if let Err(payload) = result.recv().unwrap() {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn swiftshader_clear_and_bounded_read() {
    on_lasting_thread(swiftshader_clear_and_bounded_read_body);
}

fn swiftshader_clear_and_bounded_read_body() {
    let angle = Angle::load(&bundle_dir()).unwrap();
    let display = Display::open(&angle, DisplayKind::SwiftShader).unwrap();
    let context = display.create_context(ClientVersion::Es2).unwrap();
    {
        let current = context.make_current().unwrap();
        let Some(Values::Integers([max_rb, ..])) =
            current.get_values(GL_MAX_RENDERBUFFER_SIZE, ValueType::Integer)
        else {
            panic!("MAX_RENDERBUFFER_SIZE query failed");
        };
        let Some(Values::Integers([vw, vh, ..])) =
            current.get_values(GL_MAX_VIEWPORT_DIMS, ValueType::Integer)
        else {
            panic!("MAX_VIEWPORT_DIMS query failed");
        };
        assert!(max_rb > 0 && vw > 0 && vh > 0);
    }
    let current = context.make_current().unwrap();
    current.request_extension(c"GL_OES_rgb8_rgba8");
    let framebuffer = current.gen_framebuffer();
    let color = current.gen_renderbuffer();
    current.bind_framebuffer(GL_FRAMEBUFFER, framebuffer);
    current.bind_renderbuffer(GL_RENDERBUFFER, color);
    current.renderbuffer_storage(GL_RENDERBUFFER, GL_RGBA8, 4, 4);
    current.framebuffer_renderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, color);
    assert_eq!(
        current.check_framebuffer_status(GL_FRAMEBUFFER),
        GL_FRAMEBUFFER_COMPLETE
    );
    let renderer = current.get_string(GL_RENDERER).unwrap();
    assert!(renderer.contains("SwiftShader"), "{renderer}");
    current.clear_color(0.0, 1.0, 0.0, 1.0);
    current.clear(GL_COLOR_BUFFER_BIT);
    let args = ReadPixels {
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        format: GL_RGBA,
        ty: GL_UNSIGNED_BYTE,
    };
    let mut pixels = vec![0u8; 64];
    assert_eq!(current.read_pixels(args, &mut pixels), 64);
    assert_eq!(current.get_error(), GL_NO_ERROR);
    assert!(pixels.chunks(4).all(|p| p == [0, 255, 0, 255]));

    let mut short = vec![9u8; 63];
    assert_eq!(current.read_pixels(args, &mut short), 0);
    assert_eq!(current.get_error(), GL_INVALID_OPERATION);
    assert!(short.iter().all(|&b| b == 9));

    let mut outside = vec![7u8; 64];
    let partial = ReadPixels {
        x: -2,
        y: -2,
        ..args
    };
    let n = current.read_pixels(partial, &mut outside);
    eprintln!("partial read length {n}: {outside:?}");
}

#[test]
fn drawing_buffer_attachment_combinations_are_complete() {
    on_lasting_thread(drawing_buffer_attachment_combinations_body);
}

/// Every attachment combination of the drawing-buffer design's table, single-
/// sampled and with 4 samples, on ES2 (with the requested ANGLE extensions)
/// and ES3 `SwiftShader`.
fn drawing_buffer_attachment_combinations_body() {
    let angle = Angle::load(&bundle_dir()).unwrap();
    let display = Display::open(&angle, DisplayKind::SwiftShader).unwrap();
    for version in [ClientVersion::Es2, ClientVersion::Es3] {
        let context = display.create_context(version).unwrap();
        let current = context.make_current().unwrap();
        if version == ClientVersion::Es2 {
            current.request_extension(c"GL_OES_rgb8_rgba8");
            current.request_extension(c"GL_ANGLE_framebuffer_multisample");
            current.request_extension(c"GL_ANGLE_framebuffer_blit");
        }
        for color_format in [GL_RGBA8, GL_RGB8] {
            for depth_stencil in [
                None,
                Some((GL_DEPTH24_STENCIL8, GL_DEPTH_STENCIL_ATTACHMENT)),
                Some((GL_DEPTH_COMPONENT24, GL_DEPTH_ATTACHMENT)),
                Some((GL_STENCIL_INDEX8, GL_STENCIL_ATTACHMENT)),
            ] {
                for samples in [0, 4] {
                    let framebuffer = current.gen_framebuffer();
                    current.bind_framebuffer(GL_FRAMEBUFFER, framebuffer);
                    let storage = |format| {
                        let renderbuffer = current.gen_renderbuffer();
                        current.bind_renderbuffer(GL_RENDERBUFFER, renderbuffer);
                        match (samples, version) {
                            (0, _) => current.renderbuffer_storage(GL_RENDERBUFFER, format, 8, 8),
                            (_, ClientVersion::Es2) => current
                                .renderbuffer_storage_multisample_angle(
                                    GL_RENDERBUFFER,
                                    samples,
                                    format,
                                    8,
                                    8,
                                ),
                            (_, ClientVersion::Es3) => current.renderbuffer_storage_multisample(
                                GL_RENDERBUFFER,
                                samples,
                                format,
                                8,
                                8,
                            ),
                        }
                        renderbuffer
                    };
                    let color = storage(color_format);
                    current.framebuffer_renderbuffer(
                        GL_FRAMEBUFFER,
                        GL_COLOR_ATTACHMENT0,
                        GL_RENDERBUFFER,
                        color,
                    );
                    let other = depth_stencil.map(|(format, attachment)| {
                        let renderbuffer = storage(format);
                        current.framebuffer_renderbuffer(
                            GL_FRAMEBUFFER,
                            attachment,
                            GL_RENDERBUFFER,
                            renderbuffer,
                        );
                        renderbuffer
                    });
                    assert_eq!(
                        current.check_framebuffer_status(GL_FRAMEBUFFER),
                        GL_FRAMEBUFFER_COMPLETE,
                        "{version:?} {color_format:#x} {depth_stencil:?} {samples} samples"
                    );
                    assert_eq!(current.get_error(), GL_NO_ERROR);
                    current.delete_framebuffer(framebuffer);
                    current.delete_renderbuffer(color);
                    if let Some(renderbuffer) = other {
                        current.delete_renderbuffer(renderbuffer);
                    }
                }
            }
        }
    }
}

#[test]
fn swiftshader_draws_a_triangle() {
    on_lasting_thread(swiftshader_draws_a_triangle_body);
}

/// Compiles, links and draws a full-viewport triangle into an RGBA8
/// framebuffer through the safe wrappers, on ES2 and ES3.
fn swiftshader_draws_a_triangle_body() {
    use oxgl_sys::bindings::{
        GL_ARRAY_BUFFER, GL_COMPILE_STATUS, GL_FLOAT, GL_FRAGMENT_SHADER, GL_LINK_STATUS,
        GL_STATIC_DRAW, GL_TRIANGLES, GL_VERTEX_SHADER,
    };
    let angle = Angle::load(&bundle_dir()).unwrap();
    let display = Display::open(&angle, DisplayKind::SwiftShader).unwrap();
    for version in [ClientVersion::Es2, ClientVersion::Es3] {
        let context = display.create_context(version).unwrap();
        let current = context.make_current().unwrap();
        current.request_extension(c"GL_OES_rgb8_rgba8");
        let framebuffer = current.gen_framebuffer();
        let color = current.gen_renderbuffer();
        current.bind_framebuffer(GL_FRAMEBUFFER, framebuffer);
        current.bind_renderbuffer(GL_RENDERBUFFER, color);
        current.renderbuffer_storage(GL_RENDERBUFFER, GL_RGBA8, 2, 2);
        current.framebuffer_renderbuffer(
            GL_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_RENDERBUFFER,
            color,
        );
        current.apply(oxgl_sys::StateCall::Viewport(0, 0, 2, 2));

        let compile = |kind, source| {
            let shader = current.create_shader(kind);
            current.shader_source(shader, source);
            current.compile_shader(shader);
            assert_eq!(
                current.shader_parameter(shader, GL_COMPILE_STATUS),
                Some(1),
                "{:?}",
                current.shader_info_log(shader)
            );
            shader
        };
        let vertex = compile(
            GL_VERTEX_SHADER,
            "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }",
        );
        let fragment = compile(
            GL_FRAGMENT_SHADER,
            "precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }",
        );
        let program = current.create_program();
        current.attach_shader(program, vertex);
        current.attach_shader(program, fragment);
        current.link_program(program);
        assert_eq!(current.program_parameter(program, GL_LINK_STATUS), Some(1));
        current.use_program(program);

        let buffer = current.gen_buffer();
        current.bind_buffer(GL_ARRAY_BUFFER, buffer);
        let vertices: Vec<u8> = [-1f32, -1.0, 3.0, -1.0, -1.0, 3.0]
            .iter()
            .flat_map(|v| v.to_ne_bytes())
            .collect();
        current.buffer_data(GL_ARRAY_BUFFER, &vertices, GL_STATIC_DRAW);
        let location = u32::try_from(current.attrib_location(program, c"p")).unwrap();
        current.enable_vertex_attrib_array(location);
        current.vertex_attrib_pointer(location, 2, GL_FLOAT, false, 0, 0);
        current.draw_arrays(GL_TRIANGLES, 0, 3);

        let mut pixels = [0u8; 16];
        let args = ReadPixels {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            format: GL_RGBA,
            ty: GL_UNSIGNED_BYTE,
        };
        assert_eq!(current.read_pixels(args, &mut pixels), 16);
        assert!(
            pixels.chunks(4).all(|p| p == [255, 0, 255, 255]),
            "{version:?}: {pixels:?}"
        );
        assert_eq!(current.get_error(), GL_NO_ERROR);
    }
}
