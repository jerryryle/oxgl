//! Exports for textures and samplers. Views arrive with byte offsets
//! computed in TS; `TexImageSource`s arrive as RGBA8 pixels.

use napi::bindgen_prelude::{Env, Uint8Array, Unknown};
use napi_derive::napi;
use oxgl_core::Context;
use oxgl_core::textures::{TexCopy, TexSource};
use oxgl_sys::napi_view::ReadSource;
use oxgl_sys::{TexImage, Upload};

use crate::rendering::{long, object, query};
use crate::{ParameterValue, parameter_value, with_context};

/// The arguments of a texture upload, as WebGL names them.
#[napi(object)]
#[allow(
    missing_docs,
    reason = "the fields are the WebGL arguments of the same name"
)]
pub struct TexArgs {
    pub target: u32,
    pub level: i32,
    pub internalformat: i32,
    pub xoffset: i32,
    pub yoffset: i32,
    pub zoffset: i32,
    pub width: i32,
    pub height: i32,
    pub depth: i32,
    pub border: i32,
    pub format: u32,
    pub ty: u32,
}

impl From<&TexArgs> for TexImage {
    fn from(a: &TexArgs) -> Self {
        Self {
            target: a.target,
            level: a.level,
            internal_format: a.internalformat,
            x: a.xoffset,
            y: a.yoffset,
            z: a.zoffset,
            width: a.width,
            height: a.height,
            depth: a.depth,
            border: a.border,
            format: a.format,
            ty: a.ty,
        }
    }
}

fn upload_call(call: u32) -> Upload {
    match call {
        1 => Upload::SubImage2D,
        2 => Upload::Image3D,
        3 => Upload::SubImage3D,
        _ => Upload::Image2D,
    }
}

/// `bindTexture`; whether GL accepted the binding.
#[napi]
pub fn bind_texture(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_texture(target, object(oi, ov))
    })
}

/// `texParameterf` (`float` true) / `texParameteri`.
#[napi]
pub fn tex_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    pname: u32,
    value: f64,
    float: bool,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.tex_parameter(target, pname, value, float);
    })
}

/// `getTexParameter`.
#[napi]
pub fn get_tex_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        c.get_tex_parameter(target, pname).and_then(parameter_value)
    })
}

/// `generateMipmap`.
#[napi]
pub fn generate_mipmap(env: Env, index: u32, version: u32, target: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| c.generate_mipmap(target))
}

/// A texture upload. `kind` 0: `null` data; 1: a view (`source`, from
/// `offset` bytes); 2: the pixel unpack buffer at `offset`; 3: RGBA8 pixels
/// (`source`, `source_width` × `source_height`); 4: the same from an
/// `ImageBitmap`, uploaded as is.
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    reason = "one upload of any kind; napi-rs passes objects owned"
)]
pub fn tex_upload(
    env: Env,
    index: u32,
    version: u32,
    call: u32,
    args: TexArgs,
    kind: u32,
    source: Option<Unknown<'_>>,
    offset: f64,
    source_width: u32,
    source_height: u32,
) -> napi::Result<()> {
    let view = source.as_ref().map(ReadSource::new).transpose()?.flatten();
    with_context(env, index, version, |c| {
        let args = TexImage::from(&args);
        let call = upload_call(call);
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a non-negative byte offset from TS"
        )]
        let byte_offset = offset as usize;
        let source = match (kind, &view) {
            (1, Some(v)) => TexSource::View {
                source: v,
                kind: v.kind(),
                offset: byte_offset,
            },
            (2, _) => TexSource::UnpackBuffer(long(offset)),
            (3 | 4, Some(v)) => TexSource::Rgba8 {
                source: v,
                width: source_width as usize,
                height: source_height as usize,
                as_is: kind == 4,
            },
            _ => TexSource::None,
        };
        c.tex_upload(call, args, source);
    })
}

/// `compressedTex[Sub]Image[23]D` from `image_size` bytes at `offset` of
/// the bound pixel unpack buffer (WebGL 2).
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    clippy::cast_possible_truncation,
    reason = "mirrors the WebGL signature; WebIDL-converted integers"
)]
pub fn compressed_tex_upload_buffer(
    env: Env,
    index: u32,
    version: u32,
    call: u32,
    args: TexArgs,
    image_size: i32,
    offset: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.compressed_tex_upload_buffer(
            upload_call(call),
            TexImage::from(&args),
            image_size,
            offset as i64,
        );
    })
}

/// `compressedTex[Sub]Image[23]D` from `length` bytes of a view at `offset`.
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    reason = "mirrors the WebGL signature; napi-rs passes objects owned"
)]
pub fn compressed_tex_upload(
    env: Env,
    index: u32,
    version: u32,
    call: u32,
    args: TexArgs,
    source: Unknown<'_>,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let view = ReadSource::new(&source)?;
    with_context(env, index, version, |c| {
        let Some(view) = &view else {
            c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE);
            return;
        };
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "non-negative byte counts from TS"
        )]
        let (start, len) = (offset as usize, length as usize);
        let end = if len == 0 {
            view.byte_len()
        } else {
            start.saturating_add(len)
        };
        c.compressed_tex_upload(upload_call(call), TexImage::from(&args), view, start..end);
    })
}

/// `copyTexImage2D`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn copy_tex_image_2d(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    level: i32,
    internal_format: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    border: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.copy_tex(TexCopy::Image2D {
            target,
            level,
            internal_format,
            x,
            y,
            width,
            height,
            border,
        });
    })
}

/// `copyTexSubImage2D` (`zoffset` `None`) or `copyTexSubImage3D`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn copy_tex_sub_image(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    level: i32,
    xoffset: i32,
    yoffset: i32,
    zoffset: Option<i32>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.copy_tex(TexCopy::SubImage {
            target,
            level,
            xoffset,
            yoffset,
            zoffset,
            x,
            y,
            width,
            height,
        });
    })
}

/// `texStorage2D` (`depth` `None`) or `texStorage3D`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn tex_storage(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    levels: i32,
    internal_format: u32,
    width: i32,
    height: i32,
    depth: Option<i32>,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.tex_storage(target, levels, internal_format, width, height, depth);
    })
}

/// `bindSampler`; whether the unit now has the sampler.
#[napi]
pub fn bind_sampler(
    env: Env,
    index: u32,
    version: u32,
    unit: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_sampler(unit, object(oi, ov))
    })
}

/// `samplerParameterf` (`float` true) / `samplerParameteri`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn sampler_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
    value: f64,
    float: bool,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(sampler) = object(oi, ov) {
            c.sampler_parameter(sampler, pname, value, float);
        }
    })
}

/// `getSamplerParameter`.
#[napi]
pub fn get_sampler_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|s| c.get_sampler_parameter(s, pname))
            .and_then(parameter_value)
    })
}

/// A context's drawing buffer as RGBA8, top row first.
#[napi(object)]
pub struct Pixels {
    /// `width × height × 4` bytes.
    pub data: Uint8Array,
    /// Width.
    pub width: u32,
    /// Height.
    pub height: u32,
}

/// The drawing buffer's pixels, for a WebGL canvas used as a
/// `TexImageSource`; `null` when lost.
#[napi]
pub fn drawing_buffer_pixels(env: Env, index: u32, version: u32) -> napi::Result<Option<Pixels>> {
    query(env, index, version, None, |c: &mut Context| {
        c.drawing_buffer_rgba8()
            .map(|(data, width, height)| Pixels {
                data: Uint8Array::new(data),
                width: u32::try_from(width).unwrap_or(0),
                height: u32::try_from(height).unwrap_or(0),
            })
    })
}
