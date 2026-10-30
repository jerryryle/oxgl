//! Exports for framebuffers and renderbuffers.

use napi::bindgen_prelude::{Env, Unknown};
use napi_derive::napi;
use oxgl_core::framebuffers::Attach;
use oxgl_sys::napi_view::ReadSource;
use oxgl_sys::{ClearValues, ReadPixels};

use crate::rendering::{long, object, query};
use crate::{ParameterValue, parameter_value, with_context};

/// `bindFramebuffer`; `null` (`[0, 0]`) binds the drawing buffer.
#[napi]
pub fn bind_framebuffer(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_framebuffer(target, object(oi, ov))
    })
}

/// `bindRenderbuffer`.
#[napi]
pub fn bind_renderbuffer(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_renderbuffer(target, object(oi, ov))
    })
}

/// `renderbufferStorage` (`samples` `None`) or `renderbufferStorageMultisample`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn renderbuffer_storage(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    format: u32,
    width: i32,
    height: i32,
    samples: Option<i32>,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.renderbuffer_storage(target, format, width, height, samples);
    })
}

/// `getRenderbufferParameter`.
#[napi]
pub fn get_renderbuffer_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    pname: u32,
) -> napi::Result<Option<i32>> {
    query(env, index, version, None, |c| {
        c.renderbuffer_parameter(target, pname)
    })
}

/// `framebufferTexture2D` (`kind` 0, `a` textarget, `b` level),
/// `framebufferTextureLayer` (1, `a` level, `b` layer) or
/// `framebufferRenderbuffer` (2, `a` renderbuffer target); whether GL now
/// has the object attached.
#[napi]
#[allow(clippy::too_many_arguments, reason = "one attachment call of any kind")]
pub fn attach(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    attachment: u32,
    kind: u32,
    a: i32,
    b: i32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    let attach = match kind {
        0 => Attach::Texture2D {
            textarget: a.cast_unsigned(),
            level: b,
        },
        1 => Attach::Layer { level: a, layer: b },
        _ => Attach::Renderbuffer {
            target: a.cast_unsigned(),
        },
    };
    query(env, index, version, false, |c| {
        c.attach(target, attachment, attach, object(oi, ov))
    })
}

/// `checkFramebufferStatus`; 0 when lost.
#[napi]
pub fn check_framebuffer_status(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
) -> napi::Result<u32> {
    query(env, index, version, 0, |c| {
        c.check_framebuffer_status(target)
    })
}

/// `getFramebufferAttachmentParameter` (but `OBJECT_NAME` of a framebuffer
/// object, which TS answers).
#[napi]
pub fn get_framebuffer_attachment_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    attachment: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        c.framebuffer_attachment_parameter(target, attachment, pname)
            .and_then(parameter_value)
    })
}

/// `blitFramebuffer`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn blit_framebuffer(
    env: Env,
    index: u32,
    version: u32,
    sx0: i32,
    sy0: i32,
    sx1: i32,
    sy1: i32,
    dx0: i32,
    dy0: i32,
    dx1: i32,
    dy1: i32,
    mask: u32,
    filter: u32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.blit_framebuffer([sx0, sy0, sx1, sy1], [dx0, dy0, dx1, dy1], mask, filter);
    })
}

/// `drawBuffers`.
#[napi]
#[allow(clippy::needless_pass_by_value, reason = "napi-rs passes arrays owned")]
pub fn draw_buffers(env: Env, index: u32, version: u32, buffers: Vec<u32>) -> napi::Result<()> {
    with_context(env, index, version, |c| c.draw_buffers(&buffers))
}

/// `readBuffer`.
#[napi]
pub fn read_buffer(env: Env, index: u32, version: u32, source: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| c.read_buffer(source))
}

/// `invalidateFramebuffer` (no region) or `invalidateSubFramebuffer`.
#[napi]
#[allow(clippy::needless_pass_by_value, reason = "napi-rs passes arrays owned")]
pub fn invalidate_framebuffer(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    attachments: Vec<u32>,
    region: Option<Vec<i32>>,
) -> napi::Result<()> {
    let region = region.and_then(|r| <[i32; 4]>::try_from(r).ok());
    with_context(env, index, version, |c| {
        c.invalidate_framebuffer(target, &attachments, region);
    })
}

/// `clearBuffer{fv,iv,uiv}`: `kind` 0 float, 1 int, 2 uint, from element
/// `offset` of a typed array.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn clear_buffer(
    env: Env,
    index: u32,
    version: u32,
    buffer: u32,
    drawbuffer: i32,
    kind: u32,
    values: Unknown<'_>,
    offset: f64,
) -> napi::Result<()> {
    let source = ReadSource::new(&values)?;
    with_context(env, index, version, |c| {
        let Some(source) = &source else {
            c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE);
            return;
        };
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a non-negative element offset from TS"
        )]
        let start = (offset as usize).saturating_mul(4);
        if start > source.byte_len() {
            c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE);
            return;
        }
        source.read(start..source.byte_len(), |bytes| {
            let words = bytes.as_chunks::<4>().0;
            match kind {
                1 => {
                    let v: Vec<i32> = words.iter().map(|&w| i32::from_ne_bytes(w)).collect();
                    c.clear_buffer(buffer, drawbuffer, ClearValues::Int(&v));
                }
                2 => {
                    let v: Vec<u32> = words.iter().map(|&w| u32::from_ne_bytes(w)).collect();
                    c.clear_buffer(buffer, drawbuffer, ClearValues::Uint(&v));
                }
                _ => {
                    let v: Vec<f32> = words.iter().map(|&w| f32::from_ne_bytes(w)).collect();
                    c.clear_buffer(buffer, drawbuffer, ClearValues::Float(&v));
                }
            }
        });
    })
}

/// `clearBufferfi`.
#[napi]
#[allow(clippy::cast_possible_truncation, reason = "float32-exact values")]
pub fn clear_buffer_fi(
    env: Env,
    index: u32,
    version: u32,
    buffer: u32,
    drawbuffer: i32,
    depth: f64,
    stencil: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.clear_buffer_fi(buffer, drawbuffer, depth as f32, stencil);
    })
}

/// `getInternalformatParameter`.
#[napi]
pub fn get_internalformat_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    format: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        c.internalformat_parameter(target, format, pname)
            .and_then(parameter_value)
    })
}

/// The `readPixels` offset overload (WebGL 2).
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn read_pixels_to_buffer(
    env: Env,
    index: u32,
    version: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    format: u32,
    ty: u32,
    offset: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.read_pixels_to_buffer(
            ReadPixels {
                x,
                y,
                width,
                height,
                format,
                ty,
            },
            long(offset),
        );
    })
}
