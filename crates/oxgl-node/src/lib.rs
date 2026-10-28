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

use std::path::PathBuf;

use napi::bindgen_prelude::{Env, Unknown};
use napi_derive::napi;
use oxgl_core::{
    ContextKey, ContextRequest, CoreError, RequestedBackend, Runtime, key_from_parts, key_to_parts,
};
use oxgl_sys::ReadPixels;
use oxgl_sys::bindings::GL_NO_ERROR;
use oxgl_sys::napi_view::WriteTarget;

/// Version of the JS ↔ native interface. The JS loader checks it to confirm the
/// addon it loaded matches the package.
#[napi]
#[must_use]
pub fn native_abi_version() -> u32 {
    2
}

/// The environment's runtime, created by [`init`]. Node-API instance data is
/// per environment (main thread or worker), and its finalizer, which runs at
/// environment teardown on that environment's thread, drops the runtime and
/// so destroys every context still live.
fn runtime(env: Env) -> napi::Result<&'static mut Runtime> {
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

fn key(index: u32, version: u32) -> ContextKey {
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
