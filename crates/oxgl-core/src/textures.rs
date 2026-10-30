//! Textures and samplers (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6, §3.7.13).
//! oxgl checks view types, the WebGL 2 pixel-unpack-buffer rules and the
//! WebGL-only unpack parameters, converts pixels when those parameters or a
//! `TexImageSource` need it, and leaves the rest of the validation to ANGLE.

#[allow(
    clippy::wildcard_imports,
    reason = "this module names many GL_ constants"
)]
use oxgl_sys::bindings::*;
use oxgl_sys::{ByteSource, Current, TexImage, Upload, UploadData, ValueType, Values, ViewKind};

use crate::codec::{self, Codec, HALF_FLOAT_OES, Unpack};
use crate::context::{Context, Object, ObjectKey, current};
use crate::drawing_buffer::integers;
use crate::parameters::Parameter;

/// `UNSIGNED_INT_24_8_WEBGL` (`WEBGL_depth_texture`), the same value as
/// `UNSIGNED_INT_24_8`.
const UNSIGNED_INT_24_8: u32 = 0x84FA;

/// Where an upload's pixels come from.
#[derive(Clone, Copy)]
pub enum TexSource<'a> {
    /// `null`: zero-filled storage (`texImage*` only).
    None,
    /// An `ArrayBufferView` of `kind`, as bytes from `offset`.
    View {
        /// The view's bytes.
        source: &'a dyn ByteSource,
        /// Its element type (the TS layer passes bytes).
        kind: ViewKind,
        /// Byte offset of the first pixel (WebGL 2's `srcOffset`).
        offset: usize,
    },
    /// An offset into the bound pixel unpack buffer (WebGL 2).
    UnpackBuffer(i64),
    /// RGBA8 pixels of a `TexImageSource`, top row first.
    Rgba8 {
        /// `width × height × 4` bytes.
        source: &'a dyn ByteSource,
        /// Source width.
        width: usize,
        /// Source height.
        height: usize,
    },
}

impl std::fmt::Debug for TexSource<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::None => f.write_str("None"),
            Self::View { kind, offset, .. } => write!(f, "View({kind:?} @ {offset})"),
            Self::UnpackBuffer(offset) => write!(f, "UnpackBuffer({offset})"),
            Self::Rgba8 { width, height, .. } => write!(f, "Rgba8({width}×{height})"),
        }
    }
}

/// The view types a texture upload of `ty` accepts (WebGL 1.0 §5.14.8,
/// WebGL 2.0 §3.7.6); `None` for an unknown type, which ANGLE rejects.
fn texture_views(ty: u32) -> Option<&'static [ViewKind]> {
    use ViewKind::{Float32, Int8, Int16, Int32, Uint8, Uint8Clamped, Uint16, Uint32};
    Some(match ty {
        GL_UNSIGNED_BYTE => &[Uint8, Uint8Clamped],
        GL_BYTE => &[Int8],
        GL_UNSIGNED_SHORT
        | GL_UNSIGNED_SHORT_5_6_5
        | GL_UNSIGNED_SHORT_4_4_4_4
        | GL_UNSIGNED_SHORT_5_5_5_1
        | GL_HALF_FLOAT
        | HALF_FLOAT_OES => &[Uint16],
        GL_SHORT => &[Int16],
        GL_UNSIGNED_INT
        | GL_UNSIGNED_INT_2_10_10_10_REV
        | GL_UNSIGNED_INT_10F_11F_11F_REV
        | GL_UNSIGNED_INT_5_9_9_9_REV
        | UNSIGNED_INT_24_8 => &[Uint32],
        GL_INT => &[Int32],
        GL_FLOAT => &[Float32],
        // FLOAT_32_UNSIGNED_INT_24_8_REV accepts only null.
        GL_FLOAT_32_UNSIGNED_INT_24_8_REV => &[],
        _ => return None,
    })
}

/// Unpack parameters oxgl reads from GL and restores after a converted
/// upload.
#[derive(Debug, Clone, Copy)]
struct UnpackParams {
    alignment: i32,
    row_length: i32,
    image_height: i32,
    skip_pixels: i32,
    skip_rows: i32,
    skip_images: i32,
}

const UNPACK_PNAMES: [u32; 6] = [
    GL_UNPACK_ALIGNMENT,
    GL_UNPACK_ROW_LENGTH,
    GL_UNPACK_IMAGE_HEIGHT,
    GL_UNPACK_SKIP_PIXELS,
    GL_UNPACK_SKIP_ROWS,
    GL_UNPACK_SKIP_IMAGES,
];

impl UnpackParams {
    fn read(current: &Current<'_>, webgl2: bool) -> Self {
        let get = |pname| integers(current, pname).map_or(0, |[v, _]| v);
        Self {
            alignment: get(GL_UNPACK_ALIGNMENT).max(1),
            row_length: if webgl2 { get(GL_UNPACK_ROW_LENGTH) } else { 0 },
            image_height: if webgl2 {
                get(GL_UNPACK_IMAGE_HEIGHT)
            } else {
                0
            },
            skip_pixels: if webgl2 {
                get(GL_UNPACK_SKIP_PIXELS)
            } else {
                0
            },
            skip_rows: if webgl2 { get(GL_UNPACK_SKIP_ROWS) } else { 0 },
            skip_images: if webgl2 {
                get(GL_UNPACK_SKIP_IMAGES)
            } else {
                0
            },
        }
    }

    fn values(self) -> [i32; 6] {
        [
            self.alignment,
            self.row_length,
            self.image_height,
            self.skip_pixels,
            self.skip_rows,
            self.skip_images,
        ]
    }

    fn unpack(self) -> Unpack {
        let n = |v: i32| usize::try_from(v).unwrap_or(0);
        Unpack {
            alignment: n(self.alignment),
            row_length: n(self.row_length),
            skip_pixels: n(self.skip_pixels),
            skip_rows: n(self.skip_rows),
        }
    }
}

/// Runs `f` with neutral unpack parameters (alignment 1, everything else 0),
/// for pixels oxgl has already laid out tightly, and restores `saved`.
fn with_neutral_unpack(current: &Current<'_>, saved: UnpackParams, webgl2: bool, f: impl FnOnce()) {
    let count = if webgl2 { UNPACK_PNAMES.len() } else { 1 };
    for (i, &pname) in UNPACK_PNAMES.iter().take(count).enumerate() {
        current.pixel_store(pname, i32::from(i == 0));
    }
    f();
    for (&pname, value) in UNPACK_PNAMES.iter().zip(saved.values()).take(count) {
        current.pixel_store(pname, value);
    }
}

fn usize_of(value: i32) -> Option<usize> {
    usize::try_from(value).ok()
}

impl Context {
    /// Whether a buffer is bound to `PIXEL_UNPACK_BUFFER` (WebGL 2).
    fn unpack_buffer_bound(&self, current: &Current<'_>) -> bool {
        self.webgl2
            && integers(current, GL_PIXEL_UNPACK_BUFFER_BINDING).is_some_and(|[name, _]| name != 0)
    }

    fn texture_name(&self, key: ObjectKey) -> Option<u32> {
        match self.objects.get(key)? {
            Object::Texture { name } => Some(*name),
            _ => None,
        }
    }

    fn sampler_name(&self, key: ObjectKey) -> Option<u32> {
        match self.objects.get(key)? {
            Object::Sampler { name } => Some(*name),
            _ => None,
        }
    }

    /// `bindTexture`; returns whether GL now has `texture` bound to `target`.
    pub fn bind_texture(&mut self, target: u32, texture: Option<ObjectKey>) -> bool {
        let binding = match target {
            GL_TEXTURE_2D => GL_TEXTURE_BINDING_2D,
            GL_TEXTURE_CUBE_MAP => GL_TEXTURE_BINDING_CUBE_MAP,
            GL_TEXTURE_3D if self.webgl2 => GL_TEXTURE_BINDING_3D,
            GL_TEXTURE_2D_ARRAY if self.webgl2 => GL_TEXTURE_BINDING_2D_ARRAY,
            _ => {
                if current(&self.buffer, &mut self.errors).is_some() {
                    self.errors.synthesize(GL_INVALID_ENUM);
                }
                return false;
            }
        };
        let name = match texture {
            None => 0,
            Some(key) => match self.texture_name(key) {
                Some(name) => name,
                None => {
                    self.synthesize_error(GL_INVALID_OPERATION);
                    return false;
                }
            },
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        current.bind_texture(target, name);
        integers(&current, binding).is_some_and(|[bound, _]| bound.cast_unsigned() == name)
    }

    /// `texParameterf`/`texParameteri`.
    pub fn tex_parameter(&mut self, target: u32, pname: u32, value: f64, float: bool) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            #[allow(
                clippy::cast_possible_truncation,
                reason = "WebIDL-converted GLint or GLfloat"
            )]
            if float {
                current.tex_parameter_f(target, pname, value as f32);
            } else {
                current.tex_parameter_i(target, pname, value as i32);
            }
        }
    }

    /// `getTexParameter`, with the JS type of WebGL 2.0 §3.7.6's table.
    pub fn get_tex_parameter(&mut self, target: u32, pname: u32) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        let float = matches!(
            pname,
            GL_TEXTURE_MIN_LOD | GL_TEXTURE_MAX_LOD | GL_TEXTURE_MAX_ANISOTROPY_EXT
        );
        let value = current.tex_parameter(target, pname, float)?;
        Some(if pname == GL_TEXTURE_IMMUTABLE_FORMAT {
            Parameter::Boolean(value != 0.0)
        } else {
            Parameter::Number(value)
        })
    }

    /// `generateMipmap`.
    pub fn generate_mipmap(&mut self, target: u32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.generate_mipmap(target);
        }
    }

    /// `texImage2D`/`texSubImage2D`/`texImage3D`/`texSubImage3D` from any
    /// source.
    pub fn tex_upload(&mut self, call: Upload, args: TexImage, source: TexSource<'_>) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let webgl2 = self.webgl2;
        let is_3d = matches!(call, Upload::Image3D | Upload::SubImage3D);
        let flags = self.unpack.flip_y || self.unpack.premultiply_alpha;
        let bound = self.unpack_buffer_bound(&current);
        // WebGL 2.0 §3.7.6: the buffer and client-memory forms each need the
        // pixel unpack buffer bound or unbound.
        if bound != matches!(source, TexSource::UnpackBuffer(_)) {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        }
        match source {
            TexSource::None => {
                if matches!(call, Upload::SubImage2D | Upload::SubImage3D) {
                    self.errors.synthesize(GL_INVALID_VALUE);
                    return;
                }
                current.tex_upload(call, args, UploadData::Client(None));
            }
            TexSource::UnpackBuffer(offset) => {
                if offset < 0 {
                    self.errors.synthesize(GL_INVALID_VALUE);
                    return;
                }
                if flags {
                    // WebGL 2.0 §5.36.
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                }
                current.tex_upload(call, args, UploadData::UnpackBuffer(offset));
            }
            TexSource::View {
                source,
                kind,
                offset,
            } => {
                if texture_views(args.ty).is_some_and(|views| !views.contains(&kind)) {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                }
                if offset > source.byte_len() {
                    self.errors.synthesize(GL_INVALID_VALUE);
                    return;
                }
                let codec = Codec::new(args.format, args.ty);
                if !flags || codec.is_none() {
                    if flags && is_3d {
                        self.errors.synthesize(GL_INVALID_OPERATION);
                        return;
                    }
                    source.with_bytes(offset..source.byte_len(), &mut |bytes| {
                        current.tex_upload(call, args, UploadData::Client(Some(bytes)));
                    });
                    return;
                }
                if is_3d {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                }
                let Some(codec) = codec else { return };
                let saved = UnpackParams::read(&current, webgl2);
                let (Some(width), Some(height)) = (usize_of(args.width), usize_of(args.height))
                else {
                    // Negative sizes: ANGLE generates INVALID_VALUE.
                    current.tex_upload(call, args, UploadData::Client(Some(&[])));
                    return;
                };
                let Some(rows) = saved.unpack().rows(width, height, codec.bytes_per_pixel()) else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                };
                let (flip, premultiply) = (self.unpack.flip_y, self.unpack.premultiply_alpha);
                let mut image = None;
                source.with_bytes(offset..source.byte_len(), &mut |bytes| {
                    image = codec::repack(bytes, rows, width, &codec, flip, premultiply);
                });
                let Some(image) = image else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                };
                with_neutral_unpack(&current, saved, webgl2, || {
                    current.tex_upload(call, args, UploadData::Client(Some(&image.data)));
                });
            }
            TexSource::Rgba8 {
                source,
                width,
                height,
            } => {
                let Some(codec) = Codec::new(args.format, args.ty) else {
                    // Not a TexImageSource combination: ANGLE generates the
                    // error for the format/type pair.
                    current.tex_upload(call, args, UploadData::Client(Some(&[])));
                    return;
                };
                let saved = UnpackParams::read(&current, webgl2);
                let (Some(w), Some(h), Some(d)) = (
                    usize_of(args.width),
                    usize_of(args.height),
                    usize_of(args.depth.max(1)),
                ) else {
                    current.tex_upload(call, args, UploadData::Client(Some(&[])));
                    return;
                };
                let skip_x = usize_of(saved.skip_pixels).unwrap_or(0);
                let skip_y = usize_of(saved.skip_rows).unwrap_or(0);
                let image_height = usize_of(saved.image_height).filter(|&n| n > 0).unwrap_or(h);
                let skip_images = if is_3d {
                    usize_of(saved.skip_images).unwrap_or(0)
                } else {
                    0
                };
                let (flip, premultiply) = (self.unpack.flip_y, self.unpack.premultiply_alpha);
                let mut data = Vec::new();
                let mut fits = true;
                source.with_bytes(0..source.byte_len(), &mut |bytes| {
                    for slice in 0..d {
                        let y = skip_y + (skip_images + slice) * image_height;
                        match codec::from_rgba8(
                            bytes,
                            width,
                            height,
                            (skip_x, y, w, h),
                            &codec,
                            flip,
                            premultiply,
                        ) {
                            Some(image) => data.extend_from_slice(&image.data),
                            None => fits = false,
                        }
                    }
                });
                if !fits {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return;
                }
                with_neutral_unpack(&current, saved, webgl2, || {
                    current.tex_upload(call, args, UploadData::Client(Some(&data)));
                });
            }
        }
    }

    /// `compressedTex[Sub]Image[23]D` from a view range (TS passes bytes).
    pub fn compressed_tex_upload(
        &mut self,
        call: Upload,
        args: TexImage,
        source: &dyn ByteSource,
        range: std::ops::Range<usize>,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if self.unpack_buffer_bound(&current) {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        }
        if range.end > source.byte_len() || range.start > range.end {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        source.with_bytes(range, &mut |bytes| {
            current.compressed_tex_upload(call, args, bytes)
        });
    }

    /// `copyTexImage2D`, `copyTexSubImage2D` and `copyTexSubImage3D`, from
    /// the resolved drawing buffer when it is antialiased.
    pub fn copy_tex(&mut self, copy: TexCopy) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let resolved = self.buffer.begin_read(&current);
        match copy {
            TexCopy::Image2D {
                target,
                level,
                internal_format,
                x,
                y,
                width,
                height,
                border,
            } => {
                current.copy_tex_image_2d(
                    target,
                    level,
                    internal_format,
                    x,
                    y,
                    width,
                    height,
                    border,
                );
            }
            TexCopy::SubImage {
                target,
                level,
                xoffset,
                yoffset,
                zoffset,
                x,
                y,
                width,
                height,
            } => {
                if let Some(z) = zoffset {
                    current.copy_tex_sub_image_3d(
                        target, level, xoffset, yoffset, z, x, y, width, height,
                    );
                } else {
                    current.copy_tex_sub_image_2d(
                        target, level, xoffset, yoffset, x, y, width, height,
                    );
                }
            }
        }
        if resolved {
            self.buffer.end_read(&current);
        }
    }

    /// `texStorage2D` (`depth` `None`) or `texStorage3D`.
    pub fn tex_storage(
        &mut self,
        target: u32,
        levels: i32,
        internal_format: u32,
        width: i32,
        height: i32,
        depth: Option<i32>,
    ) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            match depth {
                None => current.tex_storage_2d(target, levels, internal_format, width, height),
                Some(depth) => {
                    current.tex_storage_3d(target, levels, internal_format, width, height, depth)
                }
            }
        }
    }

    /// `bindSampler`; returns whether the unit now has the sampler.
    pub fn bind_sampler(&mut self, unit: u32, sampler: Option<ObjectKey>) -> bool {
        let name = match sampler {
            None => 0,
            Some(key) => match self.sampler_name(key) {
                Some(name) => name,
                None => {
                    self.synthesize_error(GL_INVALID_OPERATION);
                    return false;
                }
            },
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        let units = integers(&current, GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS).map_or(0, |[n, _]| n);
        if i64::from(unit) >= i64::from(units) {
            self.errors.synthesize(GL_INVALID_VALUE);
            return false;
        }
        current.bind_sampler(unit, name);
        true
    }

    /// `samplerParameterf`/`samplerParameteri`.
    pub fn sampler_parameter(&mut self, sampler: ObjectKey, pname: u32, value: f64, float: bool) {
        let Some(name) = self.sampler_name(sampler) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            #[allow(
                clippy::cast_possible_truncation,
                reason = "WebIDL-converted GLint or GLfloat"
            )]
            if float {
                current.sampler_parameter_f(name, pname, value as f32);
            } else {
                current.sampler_parameter_i(name, pname, value as i32);
            }
        }
    }

    /// `getSamplerParameter`.
    pub fn get_sampler_parameter(&mut self, sampler: ObjectKey, pname: u32) -> Option<Parameter> {
        let Some(name) = self.sampler_name(sampler) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return None;
        };
        let current = current(&self.buffer, &mut self.errors)?;
        let float = matches!(
            pname,
            GL_TEXTURE_MIN_LOD | GL_TEXTURE_MAX_LOD | GL_TEXTURE_MAX_ANISOTROPY_EXT
        );
        current
            .sampler_parameter(name, pname, float)
            .map(Parameter::Number)
    }

    /// The pixels of the drawing buffer as RGBA8, top row first: a WebGL
    /// canvas used as a `TexImageSource`. `None` when lost.
    pub fn drawing_buffer_rgba8(&mut self) -> Option<(Vec<u8>, usize, usize)> {
        let current = current(&self.buffer, &mut self.errors)?;
        let (width, height) = (self.buffer.width(), self.buffer.height());
        let (w, h) = (usize::try_from(width).ok()?, usize::try_from(height).ok()?);
        let mut pixels = vec![0u8; w.checked_mul(h)?.checked_mul(4)?];
        // Read with the default pack state, then restore it.
        let alignment = match current.get_values(GL_PACK_ALIGNMENT, ValueType::Integer) {
            Some(Values::Integers([a, ..])) => a,
            _ => 4,
        };
        let pack_buffer = if self.webgl2 {
            integers(&current, GL_PIXEL_PACK_BUFFER_BINDING).map_or(0, |[n, _]| n.cast_unsigned())
        } else {
            0
        };
        let read =
            integers(&current, GL_READ_FRAMEBUFFER_BINDING).map_or(0, |[n, _]| n.cast_unsigned());
        current.pixel_store(GL_PACK_ALIGNMENT, 1);
        if pack_buffer != 0 {
            current.bind_buffer(GL_PIXEL_PACK_BUFFER, 0);
        }
        current.bind_framebuffer(GL_READ_FRAMEBUFFER, self.buffer.framebuffer());
        let resolved = self.buffer.begin_read(&current);
        let args = oxgl_sys::ReadPixels {
            x: 0,
            y: 0,
            width,
            height,
            format: GL_RGBA,
            ty: GL_UNSIGNED_BYTE,
        };
        current.read_pixels(args, &mut pixels);
        if resolved {
            self.buffer.end_read(&current);
        }
        current.bind_framebuffer(GL_READ_FRAMEBUFFER, read);
        current.pixel_store(GL_PACK_ALIGNMENT, alignment);
        if pack_buffer != 0 {
            current.bind_buffer(GL_PIXEL_PACK_BUFFER, pack_buffer);
        }
        // GL rows are bottom first; a canvas is top first.
        let row = w * 4;
        let flipped: Vec<u8> = pixels.chunks(row.max(1)).rev().flatten().copied().collect();
        Some((flipped, w, h))
    }
}

/// A `copyTex*` call.
#[derive(Debug, Clone, Copy)]
#[allow(
    missing_docs,
    reason = "the fields are the GL arguments of the same name"
)]
pub enum TexCopy {
    /// `copyTexImage2D`.
    Image2D {
        target: u32,
        level: i32,
        internal_format: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        border: i32,
    },
    /// `copyTexSubImage2D` (`zoffset` `None`) or `copyTexSubImage3D`.
    SubImage {
        target: u32,
        level: i32,
        xoffset: i32,
        yoffset: i32,
        zoffset: Option<i32>,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    },
}
