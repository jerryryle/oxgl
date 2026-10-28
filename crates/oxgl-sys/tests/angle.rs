//! Loads the staged ANGLE bundle and drives the safe wrappers on `SwiftShader`.

use std::path::Path;

use oxgl_sys::bindings::{
    GL_COLOR_BUFFER_BIT, GL_INVALID_OPERATION, GL_NO_ERROR, GL_RENDERER, GL_RGBA, GL_UNSIGNED_BYTE,
};
use oxgl_sys::test_support::bundle_dir;
use oxgl_sys::{
    Angle, ClientVersion, Display, DisplayKind, IntegerParam, LoadErrorKind, ReadPixels,
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

#[test]
fn swiftshader_clear_and_bounded_read() {
    let angle = Angle::load(&bundle_dir()).unwrap();
    let display = Display::open(&angle, DisplayKind::SwiftShader).unwrap();
    let mut context = display.create_context(ClientVersion::Es2).unwrap();
    {
        let current = context.make_current().unwrap();
        let [max_rb, _] = current
            .get_integers(IntegerParam::MaxRenderbufferSize)
            .unwrap();
        let [vw, vh] = current.get_integers(IntegerParam::MaxViewportDims).unwrap();
        assert!(max_rb > 0 && vw > 0 && vh > 0);
    }
    context.attach_pbuffer(4, 4).unwrap();
    let current = context.make_current().unwrap();
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
