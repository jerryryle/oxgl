//! Node-API binding for oxgl.
//!
//! Every function takes primitives already converted per `WebIDL` by the
//! TypeScript layer (`src/context.ts`), so native code never calls back into
//! JS. Contexts are identified by their key as two `u32`s (index, version).
//
// `deny` rather than `forbid`: the `#[napi]` macro expands to FFI glue carrying
// its own `#[allow(unsafe_code)]`, which `forbid` rejects. The allowance is
// therefore scoped to macro-generated items only; any hand-written `unsafe`
// in this crate still fails the build. Unsafe code belongs in `oxgl-sys`.
#![deny(unsafe_code)]
// Each export's only error is a Node-API failure, thrown to JS by napi-rs.
#![allow(clippy::missing_errors_doc)]

pub mod extensions;
pub mod framebuffers;
pub mod rendering;
pub mod textures;
pub mod webgl2;

use std::path::PathBuf;

use napi::bindgen_prelude::{Env, Unknown};
use napi_derive::napi;
use oxgl_core::parameters::Parameter;
use oxgl_core::{
    Attributes, ContextKey, ContextRequest, CoreError, RequestedBackend, Runtime, key_from_parts,
    key_to_parts,
};
use oxgl_sys::bindings::GL_NO_ERROR;
use oxgl_sys::napi_view::WriteTarget;
use oxgl_sys::{ReadPixels, StateCall};

/// Version of the JS ↔ native interface. The JS loader checks it to confirm the
/// addon it loaded matches the package.
#[napi]
#[must_use]
pub fn native_abi_version() -> u32 {
    13
}

/// The environment's runtime, created by [`init`]. Node-API instance data is
/// per environment (main thread or worker), and its finalizer, which runs at
/// environment teardown on that environment's thread, drops the runtime and
/// so destroys every context still live.
pub(crate) fn runtime(env: Env) -> napi::Result<&'static mut Runtime> {
    env.get_instance_data::<Runtime>()?
        .ok_or_else(|| napi::Error::from_reason("oxgl: native runtime is not initialized"))
}

/// Creates this environment's runtime, which loads ANGLE from `lib_dir` (the
/// `angle` directory next to the addon) on first use. Later calls are no-ops.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn init(env: Env, lib_dir: String) -> napi::Result<()> {
    if env.get_instance_data::<Runtime>()?.is_some() {
        return Ok(());
    }
    env.set_instance_data(Runtime::new(PathBuf::from(lib_dir)), (), |context| {
        drop(context.value);
    })
}

/// Result of [`create_context`]: the key and actual size, or an error to throw.
#[napi(object)]
pub struct Created {
    /// Key slot index.
    pub index: u32,
    /// Key version.
    pub version: u32,
    /// Actual drawing buffer width.
    pub width: i32,
    /// Actual drawing buffer height.
    pub height: i32,
    /// Stable error code when creation failed.
    pub error_code: Option<String>,
    /// Error message when creation failed.
    pub error_message: Option<String>,
}

/// `WebGLContextAttributes`, converted per `WebIDL` in TS.
#[napi(object)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "mirrors the WebIDL dictionary"
)]
pub struct ContextAttributes {
    /// `alpha`.
    pub alpha: bool,
    /// `depth`.
    pub depth: bool,
    /// `stencil`.
    pub stencil: bool,
    /// `antialias`.
    pub antialias: bool,
    /// `premultipliedAlpha`.
    pub premultiplied_alpha: bool,
    /// `preserveDrawingBuffer`.
    pub preserve_drawing_buffer: bool,
    /// `powerPreference`: 0 `default`, 1 `low-power`, 2 `high-performance`.
    pub power_preference: u8,
    /// `failIfMajorPerformanceCaveat`.
    pub fail_if_major_performance_caveat: bool,
}

impl From<&ContextAttributes> for Attributes {
    fn from(a: &ContextAttributes) -> Self {
        Self {
            alpha: a.alpha,
            depth: a.depth,
            stencil: a.stencil,
            antialias: a.antialias,
            premultiplied_alpha: a.premultiplied_alpha,
            preserve_drawing_buffer: a.preserve_drawing_buffer,
            power_preference: a.power_preference,
            fail_if_major_performance_caveat: a.fail_if_major_performance_caveat,
        }
    }
}

impl From<Attributes> for ContextAttributes {
    fn from(a: Attributes) -> Self {
        Self {
            alpha: a.alpha,
            depth: a.depth,
            stencil: a.stencil,
            antialias: a.antialias,
            premultiplied_alpha: a.premultiplied_alpha,
            preserve_drawing_buffer: a.preserve_drawing_buffer,
            power_preference: a.power_preference,
            fail_if_major_performance_caveat: a.fail_if_major_performance_caveat,
        }
    }
}

/// Creates a context. `backend` is `auto`, `gpu`, or `software`, already
/// resolved against `OXGL_BACKEND` and validated in TS.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn create_context(
    env: Env,
    backend: String,
    width: f64,
    height: f64,
    webgl2: bool,
    attributes: ContextAttributes,
) -> napi::Result<Created> {
    let requested = match backend.as_str() {
        "gpu" => RequestedBackend::Gpu,
        "software" => RequestedBackend::Software,
        _ => RequestedBackend::Auto,
    };
    let runtime = runtime(env)?;
    let request = ContextRequest {
        width,
        height,
        webgl2,
        attributes: Attributes::from(&attributes),
    };
    let created = runtime.create_context(requested, &request).and_then(|key| {
        let buffer = runtime
            .context(key)
            .ok_or_else(|| CoreError::ContextCreationFailed("context vanished".into()))?
            .drawing_buffer();
        Ok((key, buffer.width(), buffer.height()))
    });
    Ok(match created {
        Ok((key, width, height)) => {
            let [index, version] = key_to_parts(key);
            Created {
                index,
                version,
                width,
                height,
                error_code: None,
                error_message: None,
            }
        }
        Err(error) => Created {
            index: 0,
            version: 0,
            width: 0,
            height: 0,
            error_code: Some(error.code().to_owned()),
            error_message: Some(error.to_string()),
        },
    })
}

pub(crate) fn key(index: u32, version: u32) -> ContextKey {
    key_from_parts([index, version])
}

/// `destroy()`: releases the context now. Idempotent.
#[napi]
pub fn destroy(env: Env, index: u32, version: u32) -> napi::Result<()> {
    runtime(env)?.destroy(key(index, version));
    Ok(())
}

/// `FinalizationRegistry` callback: the context's JS object was collected.
/// Enqueues its deletion and drains the queue. A stale key is a no-op.
#[napi]
pub fn release(env: Env, index: u32, version: u32) -> napi::Result<()> {
    runtime(env)?.release(key(index, version));
    Ok(())
}

/// Number of live contexts in this environment (for tests).
#[napi]
pub fn live_contexts(env: Env) -> napi::Result<u32> {
    Ok(u32::try_from(runtime(env)?.live_contexts()).unwrap_or(u32::MAX))
}

/// `clearColor`; components are already `Math.fround`ed in TS.
#[napi]
pub fn clear_color(
    env: Env,
    index: u32,
    version: u32,
    red: f64,
    green: f64,
    blue: f64,
    alpha: f64,
) -> napi::Result<()> {
    if let Some(context) = runtime(env)?.context(key(index, version)) {
        // Values are float32-exact (fround in TS); NaN and infinities survive.
        #[allow(clippy::cast_possible_truncation, reason = "float32-exact values")]
        context.clear_color(red as f32, green as f32, blue as f32, alpha as f32);
    }
    Ok(())
}

/// `clear`.
#[napi]
pub fn clear(env: Env, index: u32, version: u32, mask: u32) -> napi::Result<()> {
    if let Some(context) = runtime(env)?.context(key(index, version)) {
        context.clear(mask);
    }
    Ok(())
}

/// `getError`.
#[napi]
pub fn get_error(env: Env, index: u32, version: u32) -> napi::Result<u32> {
    Ok(runtime(env)?
        .context(key(index, version))
        .map_or(GL_NO_ERROR, oxgl_core::Context::get_error))
}

/// `readPixels` into an `ArrayBufferView`, or `null` (`None`). TS has already
/// thrown for anything else.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn read_pixels(
    env: Env,
    index: u32,
    version: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    format: u32,
    ty: u32,
    pixels: Option<Unknown<'_>>,
) -> napi::Result<()> {
    let target = pixels.as_ref().map(WriteTarget::new).transpose()?.flatten();
    if let Some(context) = runtime(env)?.context(key(index, version)) {
        let args = ReadPixels {
            x,
            y,
            width,
            height,
            format,
            ty,
        };
        context.read_pixels(
            args,
            target
                .as_ref()
                .map(|t| t as &dyn oxgl_sys::PixelDestination),
        );
    }
    Ok(())
}

/// Runs `f` on the context, if it is still live.
pub(crate) fn with_context(
    env: Env,
    index: u32,
    version: u32,
    f: impl FnOnce(&mut oxgl_core::Context),
) -> napi::Result<()> {
    if let Some(context) = runtime(env)?.context(key(index, version)) {
        f(context);
    }
    Ok(())
}

/// Narrows a float32-exact value (`Math.fround` in TS); NaN and infinities
/// survive.
#[allow(clippy::cast_possible_truncation, reason = "float32-exact values")]
fn f32_of(value: f64) -> f32 {
    value as f32
}

/// Declares one `#[napi]` export per value-only state call. Arguments are
/// already converted per `WebIDL` in TS.
macro_rules! state_exports {
    ($($(#[$doc:meta])* $name:ident($($arg:ident: $ty:ty),*) => $call:expr;)*) => {
        $(
            $(#[$doc])*
            #[napi]
            #[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
            pub fn $name(env: Env, index: u32, version: u32, $($arg: $ty),*) -> napi::Result<()> {
                with_context(env, index, version, |context| context.set_state($call))
            }
        )*
    };
}

state_exports! {
    /// `activeTexture`.
    active_texture(texture: u32) => StateCall::ActiveTexture(texture);
    /// `blendColor`.
    blend_color(red: f64, green: f64, blue: f64, alpha: f64) =>
        StateCall::BlendColor(f32_of(red), f32_of(green), f32_of(blue), f32_of(alpha));
    /// `blendEquation`.
    blend_equation(mode: u32) => StateCall::BlendEquation(mode);
    /// `blendEquationSeparate`.
    blend_equation_separate(mode_rgb: u32, mode_alpha: u32) =>
        StateCall::BlendEquationSeparate(mode_rgb, mode_alpha);
    /// `blendFunc`.
    blend_func(sfactor: u32, dfactor: u32) => StateCall::BlendFunc(sfactor, dfactor);
    /// `blendFuncSeparate`.
    blend_func_separate(src_rgb: u32, dst_rgb: u32, src_alpha: u32, dst_alpha: u32) =>
        StateCall::BlendFuncSeparate(src_rgb, dst_rgb, src_alpha, dst_alpha);
    /// `clearDepth`.
    clear_depth(depth: f64) => StateCall::ClearDepth(f32_of(depth));
    /// `clearStencil`.
    clear_stencil(s: i32) => StateCall::ClearStencil(s);
    /// `colorMask`.
    color_mask(red: bool, green: bool, blue: bool, alpha: bool) =>
        StateCall::ColorMask(red, green, blue, alpha);
    /// `cullFace`.
    cull_face(mode: u32) => StateCall::CullFace(mode);
    /// `depthFunc`.
    depth_func(func: u32) => StateCall::DepthFunc(func);
    /// `depthMask`.
    depth_mask(flag: bool) => StateCall::DepthMask(flag);
    /// `depthRange`.
    depth_range(z_near: f64, z_far: f64) => StateCall::DepthRange(f32_of(z_near), f32_of(z_far));
    /// `disable`.
    disable(cap: u32) => StateCall::Disable(cap);
    /// `enable`.
    enable(cap: u32) => StateCall::Enable(cap);
    /// `finish`.
    finish() => StateCall::Finish;
    /// `flush`.
    flush() => StateCall::Flush;
    /// `frontFace`.
    front_face(mode: u32) => StateCall::FrontFace(mode);
    /// `hint`.
    hint(target: u32, mode: u32) => StateCall::Hint(target, mode);
    /// `lineWidth`.
    line_width(width: f64) => StateCall::LineWidth(f32_of(width));
    /// `polygonOffset`.
    polygon_offset(factor: f64, units: f64) =>
        StateCall::PolygonOffset(f32_of(factor), f32_of(units));
    /// `sampleCoverage`.
    sample_coverage(value: f64, invert: bool) => StateCall::SampleCoverage(f32_of(value), invert);
    /// `scissor`.
    scissor(x: i32, y: i32, width: i32, height: i32) => StateCall::Scissor(x, y, width, height);
    /// `stencilFunc`.
    stencil_func(func: u32, reference: i32, mask: u32) => StateCall::StencilFunc(func, reference, mask);
    /// `stencilFuncSeparate`.
    stencil_func_separate(face: u32, func: u32, reference: i32, mask: u32) =>
        StateCall::StencilFuncSeparate(face, func, reference, mask);
    /// `stencilMask`.
    stencil_mask(mask: u32) => StateCall::StencilMask(mask);
    /// `stencilMaskSeparate`.
    stencil_mask_separate(face: u32, mask: u32) => StateCall::StencilMaskSeparate(face, mask);
    /// `stencilOp`.
    stencil_op(fail: u32, zfail: u32, zpass: u32) => StateCall::StencilOp(fail, zfail, zpass);
    /// `stencilOpSeparate`.
    stencil_op_separate(face: u32, fail: u32, zfail: u32, zpass: u32) =>
        StateCall::StencilOpSeparate(face, fail, zfail, zpass);
    /// `viewport`.
    viewport(x: i32, y: i32, width: i32, height: i32) => StateCall::Viewport(x, y, width, height);
}

/// `pixelStorei`.
#[napi]
pub fn pixel_storei(
    env: Env,
    index: u32,
    version: u32,
    pname: u32,
    param: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |context| {
        context.pixel_store(pname, param);
    })
}

/// `isEnabled`; `false` for a destroyed context.
#[napi]
pub fn is_enabled(env: Env, index: u32, version: u32, cap: u32) -> napi::Result<bool> {
    Ok(runtime(env)?
        .context(key(index, version))
        .is_some_and(|context| context.is_enabled(cap)))
}

/// A `getParameter` result for TS to turn into a JS value: `kind` names the
/// type (`number`, `boolean`, `booleans`, `string`, `float32`, `int32`,
/// `uint32`), `numbers` holds the values (booleans as 0 or 1), `text` a string.
#[napi(object)]
pub struct ParameterValue {
    /// The JS type.
    pub kind: String,
    /// Numeric values.
    pub numbers: Vec<f64>,
    /// The string value.
    pub text: Option<String>,
}

pub(crate) fn parameter_value(parameter: Parameter) -> Option<ParameterValue> {
    let (kind, numbers, text) = match parameter {
        Parameter::Null => return None,
        Parameter::Number(n) => ("number", vec![n], None),
        Parameter::Boolean(b) => ("boolean", vec![f64::from(u8::from(b))], None),
        Parameter::Booleans(v) => (
            "booleans",
            v.into_iter().map(|b| f64::from(u8::from(b))).collect(),
            None,
        ),
        Parameter::String(s) => ("string", Vec::new(), Some(s)),
        Parameter::Float32(v) => ("float32", v.into_iter().map(f64::from).collect(), None),
        Parameter::Int32(v) => ("int32", v.into_iter().map(f64::from).collect(), None),
        Parameter::Uint32(v) => ("uint32", v.into_iter().map(f64::from).collect(), None),
        Parameter::Numbers(v) => ("numbers", v, None),
    };
    Some(ParameterValue {
        kind: kind.to_owned(),
        numbers,
        text,
    })
}

/// `getParameter`; `null` for an unknown parameter, a rejected query, a WebGL
/// object binding, or a destroyed context.
#[napi]
pub fn get_parameter(
    env: Env,
    index: u32,
    version: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    Ok(runtime(env)?
        .context(key(index, version))
        .and_then(|context| context.get_parameter(pname))
        .and_then(parameter_value))
}

/// A `WebGLShaderPrecisionFormat`'s attributes.
#[napi(object)]
pub struct PrecisionValue {
    /// `rangeMin`.
    pub range_min: i32,
    /// `rangeMax`.
    pub range_max: i32,
    /// `precision`.
    pub precision: i32,
}

/// `getShaderPrecisionFormat`; `null` for an invalid enum or a destroyed
/// context.
#[napi]
pub fn get_shader_precision_format(
    env: Env,
    index: u32,
    version: u32,
    shader_type: u32,
    precision_type: u32,
) -> napi::Result<Option<PrecisionValue>> {
    Ok(runtime(env)?
        .context(key(index, version))
        .and_then(|context| context.shader_precision_format(shader_type, precision_type))
        .map(|format| PrecisionValue {
            range_min: format.range_min,
            range_max: format.range_max,
            precision: format.precision,
        }))
}

/// `isContextLost`; `true` for a destroyed context.
#[napi]
pub fn is_context_lost(env: Env, index: u32, version: u32) -> napi::Result<bool> {
    Ok(runtime(env)?
        .context(key(index, version))
        .is_none_or(oxgl_core::Context::is_context_lost))
}

/// `getContextAttributes`; `null` for a lost or destroyed context.
#[napi]
pub fn get_context_attributes(
    env: Env,
    index: u32,
    version: u32,
) -> napi::Result<Option<ContextAttributes>> {
    Ok(runtime(env)?
        .context(key(index, version))
        .and_then(|context| context.attributes())
        .map(ContextAttributes::from))
}

/// The drawing buffer's size after [`resize`].
#[napi(object)]
pub struct Size {
    /// Width in pixels; 0 when lost.
    pub width: i32,
    /// Height in pixels; 0 when lost.
    pub height: i32,
}

/// Non-standard `resize`: reallocates the drawing buffer and returns its
/// actual size (`0×0` when the context is lost or destroyed).
#[napi]
pub fn resize(env: Env, index: u32, version: u32, width: f64, height: f64) -> napi::Result<Size> {
    let mut size = Size {
        width: 0,
        height: 0,
    };
    with_context(env, index, version, |context| {
        context.resize(width, height);
        if !context.is_lost() {
            let buffer = context.drawing_buffer();
            size = Size {
                width: buffer.width(),
                height: buffer.height(),
            };
        }
    })?;
    Ok(size)
}
