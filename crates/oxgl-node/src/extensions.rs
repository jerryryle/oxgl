//! Exports for WebGL extensions.

use napi::bindgen_prelude::Env;
use napi_derive::napi;
use oxgl_core::extensions::ExtensionCall;

use crate::rendering::{object, query};
use crate::with_context;

/// `getSupportedExtensions`; `null` when lost.
#[napi]
pub fn get_supported_extensions(
    env: Env,
    index: u32,
    version: u32,
) -> napi::Result<Option<Vec<String>>> {
    query(env, index, version, None, |c| {
        c.supported_extensions()
            .map(|names| names.into_iter().map(str::to_owned).collect())
    })
}

/// `getExtension`: enables a supported extension; its canonical name, or
/// `null`.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn enable_extension(
    env: Env,
    index: u32,
    version: u32,
    name: String,
) -> napi::Result<Option<String>> {
    query(env, index, version, None, |c| {
        c.enable_extension(&name).map(str::to_owned)
    })
}

/// A value-only extension call: `op` selects the entry point, `a`–`e` are
/// its arguments in order (floats for `polygonOffsetClampEXT`, booleans as
/// 0 or 1 for `colorMaskiOES`).
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::many_single_char_names,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "one entry point of any shape, with WebIDL-converted values"
)]
pub fn extension_call(
    env: Env,
    index: u32,
    version: u32,
    op: u32,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
) -> napi::Result<()> {
    let u = |v: f64| v as u32;
    let call = match op {
        0 => ExtensionCall::Enablei(u(a), u(b)),
        1 => ExtensionCall::Disablei(u(a), u(b)),
        2 => ExtensionCall::BlendEquationi(u(a), u(b)),
        3 => ExtensionCall::BlendEquationSeparatei(u(a), u(b), u(c)),
        4 => ExtensionCall::BlendFunci(u(a), u(b), u(c)),
        5 => ExtensionCall::BlendFuncSeparatei(u(a), u(b), u(c), u(d), u(e)),
        6 => ExtensionCall::ColorMaski(u(a), [b != 0.0, c != 0.0, d != 0.0, e != 0.0]),
        7 => ExtensionCall::ClipControl(u(a), u(b)),
        8 => ExtensionCall::PolygonOffsetClamp(a as f32, b as f32, c as f32),
        9 => ExtensionCall::ProvokingVertex(u(a)),
        _ => ExtensionCall::PolygonMode(u(a), u(b)),
    };
    with_context(env, index, version, |ctx| ctx.extension_call(call))
}

/// `WEBGL_multi_draw`: `ty` 0 for the arrays forms, else the index type;
/// `instances` empty for the non-instanced forms.
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    clippy::cast_possible_truncation,
    reason = "napi-rs passes arrays owned; WebIDL-converted integers"
)]
pub fn multi_draw(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    firsts_or_offsets: Vec<f64>,
    counts: Vec<i32>,
    instances: Vec<i32>,
    ty: u32,
) -> napi::Result<()> {
    let firsts: Vec<i64> = firsts_or_offsets.iter().map(|&v| v as i64).collect();
    let elements = (ty != 0).then_some(ty);
    with_context(env, index, version, |c| {
        c.multi_draw(mode, &firsts, &counts, &instances, elements);
    })
}

/// `WEBGL_debug_shaders.getTranslatedShaderSource`.
#[napi]
pub fn translated_shader_source(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<Option<String>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|s| c.translated_shader_source(s))
    })
}

/// `WEBGL_lose_context.loseContext`: loses the context now.
#[napi]
pub fn lose_context(env: Env, index: u32, version: u32) -> napi::Result<()> {
    with_context(env, index, version, oxgl_core::Context::lose_context)
}

/// Clears a drawing buffer without `preserveDrawingBuffer`, as compositing
/// does in a browser; for hosts that composite.
#[napi]
pub fn present_drawing_buffer(env: Env, index: u32, version: u32) -> napi::Result<()> {
    with_context(env, index, version, oxgl_core::Context::present)
}
