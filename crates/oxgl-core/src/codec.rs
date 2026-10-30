//! Pixel conversion for texture uploads: the CPU work WebGL adds on top of
//! the GL (WebGL 1.0 §5.14.8, WebGL 2.0 §3.7.6). Pixels decode to four
//! floats and encode back, per format and type; RGBA8 sources (`ImageData`
//! and canvases) encode to every upload format, and `UNPACK_FLIP_Y_WEBGL`
//! and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` are applied here.

#[allow(
    clippy::wildcard_imports,
    reason = "the codec names most format and type constants"
)]
use oxgl_sys::bindings::*;

/// `HALF_FLOAT_OES` (`OES_texture_half_float`), a different value from
/// WebGL 2's `HALF_FLOAT`.
pub const HALF_FLOAT_OES: u32 = 0x8D61;

/// The channels a format stores, in memory order, as indices into RGBA
/// (`L` reads R, as browsers do for luminance from color sources).
fn channels(format: u32) -> Option<&'static [usize]> {
    Some(match format {
        // EXT_sRGB's formats (WebGL 1) store bytes like RGB and RGBA.
        GL_RGBA | GL_RGBA_INTEGER | GL_SRGB_ALPHA_EXT => &[0, 1, 2, 3],
        GL_RGB | GL_RGB_INTEGER | GL_SRGB_EXT => &[0, 1, 2],
        GL_RG | GL_RG_INTEGER => &[0, 1],
        GL_RED | GL_RED_INTEGER | GL_LUMINANCE => &[0],
        GL_ALPHA => &[3],
        GL_LUMINANCE_ALPHA => &[0, 3],
        _ => return None,
    })
}

/// Whether `format` is an integer format (no normalization; views of it are
/// not premultiplied, `TexImageSource` pixels are).
fn is_integer(format: u32) -> bool {
    matches!(
        format,
        GL_RGBA_INTEGER | GL_RGB_INTEGER | GL_RG_INTEGER | GL_RED_INTEGER
    )
}

/// How one pixel is stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Layout {
    /// One component per channel of `size` bytes.
    Components { size: usize, kind: Component },
    /// All channels packed into one 16-bit word, high bits first, with these
    /// bit widths.
    Packed16(&'static [u32]),
    /// `UNSIGNED_INT_2_10_10_10_REV`.
    Rgb10A2,
    /// `UNSIGNED_INT_10F_11F_11F_REV`.
    R11G11B10F,
    /// `UNSIGNED_INT_5_9_9_9_REV`.
    Rgb9E5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Component {
    Unorm,
    Snorm,
    Uint,
    Sint,
    Half,
    Float,
}

fn layout(format: u32, ty: u32) -> Option<Layout> {
    let integer = is_integer(format);
    let components = |size, kind| Some(Layout::Components { size, kind });
    match ty {
        GL_UNSIGNED_BYTE if integer => components(1, Component::Uint),
        GL_UNSIGNED_BYTE => components(1, Component::Unorm),
        GL_BYTE if integer => components(1, Component::Sint),
        GL_BYTE => components(1, Component::Snorm),
        GL_UNSIGNED_SHORT if integer => components(2, Component::Uint),
        GL_SHORT if integer => components(2, Component::Sint),
        GL_UNSIGNED_INT if integer => components(4, Component::Uint),
        GL_INT if integer => components(4, Component::Sint),
        GL_HALF_FLOAT | HALF_FLOAT_OES => components(2, Component::Half),
        GL_FLOAT => components(4, Component::Float),
        GL_UNSIGNED_SHORT_5_6_5 if format == GL_RGB => Some(Layout::Packed16(&[5, 6, 5])),
        GL_UNSIGNED_SHORT_4_4_4_4 if format == GL_RGBA => Some(Layout::Packed16(&[4, 4, 4, 4])),
        GL_UNSIGNED_SHORT_5_5_5_1 if format == GL_RGBA => Some(Layout::Packed16(&[5, 5, 5, 1])),
        GL_UNSIGNED_INT_2_10_10_10_REV if matches!(format, GL_RGBA | GL_RGBA_INTEGER) => {
            Some(Layout::Rgb10A2)
        }
        GL_UNSIGNED_INT_10F_11F_11F_REV if format == GL_RGB => Some(Layout::R11G11B10F),
        GL_UNSIGNED_INT_5_9_9_9_REV if format == GL_RGB => Some(Layout::Rgb9E5),
        _ => None,
    }
}

/// Bytes per pixel of a format/type pair the codec knows.
#[must_use]
pub fn bytes_per_pixel(format: u32, ty: u32) -> Option<usize> {
    Some(match layout(format, ty)? {
        Layout::Components { size, .. } => size * channels(format)?.len(),
        Layout::Packed16(_) => 2,
        Layout::Rgb10A2 | Layout::R11G11B10F | Layout::Rgb9E5 => 4,
    })
}

/// A format/type pair's codec, or `None` when the codec does not know it
/// (oxgl then leaves the data to ANGLE, which rejects it if it is invalid).
#[derive(Debug, Clone, Copy)]
pub struct Codec {
    channels: &'static [usize],
    layout: Layout,
    integer: bool,
}

impl Codec {
    /// The codec for `format` and `type`.
    #[must_use]
    pub fn new(format: u32, ty: u32) -> Option<Self> {
        Some(Self {
            channels: channels(format)?,
            layout: layout(format, ty)?,
            integer: is_integer(format),
        })
    }

    /// A codec that only knows the pixel size, for formats with no color to
    /// convert (depth and depth-stencil): rows can be flipped, and
    /// premultiplying leaves them unchanged.
    #[must_use]
    pub fn opaque(format: u32, ty: u32) -> Option<Self> {
        let size = match (format, ty) {
            (GL_DEPTH_COMPONENT, GL_UNSIGNED_SHORT) => 2,
            (GL_DEPTH_COMPONENT, GL_UNSIGNED_INT | GL_FLOAT)
            | (GL_DEPTH_STENCIL, GL_UNSIGNED_INT_24_8) => 4,
            (GL_DEPTH_STENCIL, GL_FLOAT_32_UNSIGNED_INT_24_8_REV) => 8,
            _ => return None,
        };
        Some(Self {
            channels: &[0],
            layout: Layout::Components {
                size,
                kind: Component::Uint,
            },
            integer: true,
        })
    }

    /// Bytes per pixel.
    #[must_use]
    pub fn bytes_per_pixel(&self) -> usize {
        match self.layout {
            Layout::Components { size, .. } => size * self.channels.len(),
            Layout::Packed16(_) => 2,
            Layout::Rgb10A2 | Layout::R11G11B10F | Layout::Rgb9E5 => 4,
        }
    }

    /// Whether premultiplication changes this format: it has alpha and
    /// color, and is not an integer format.
    #[must_use]
    pub fn premultipliable(&self) -> bool {
        !self.integer && self.channels.contains(&3) && self.channels.len() > 1
    }

    /// Decodes one pixel to RGBA (missing channels 0, alpha 1).
    #[must_use]
    pub fn decode(&self, pixel: &[u8]) -> [f32; 4] {
        let mut rgba = [0.0, 0.0, 0.0, 1.0];
        match self.layout {
            Layout::Components { size, kind } => {
                for (i, &channel) in self.channels.iter().enumerate() {
                    let bytes = pixel.get(i * size..(i + 1) * size).unwrap_or(&[]);
                    if let Some(slot) = rgba.get_mut(channel) {
                        *slot = decode_component(bytes, kind);
                    }
                }
            }
            Layout::Packed16(bits) => {
                let word = u16::from_ne_bytes([
                    pixel.first().copied().unwrap_or(0),
                    pixel.get(1).copied().unwrap_or(0),
                ]);
                let mut shift = 16;
                for (&channel, &width) in self.channels.iter().zip(bits) {
                    shift -= width;
                    let max = (1u32 << width) - 1;
                    let value = (u32::from(word) >> shift) & max;
                    if let Some(slot) = rgba.get_mut(channel) {
                        *slot = unorm(value, max);
                    }
                }
            }
            Layout::Rgb10A2 => {
                let word = u32_of(pixel);
                let max = if self.integer { 1 } else { 1023 };
                let alpha_max = if self.integer { 1 } else { 3 };
                rgba = [
                    unorm(word & 1023, max),
                    unorm((word >> 10) & 1023, max),
                    unorm((word >> 20) & 1023, max),
                    unorm(word >> 30, alpha_max),
                ];
            }
            Layout::R11G11B10F => {
                let word = u32_of(pixel);
                rgba = [
                    small_float(word & 0x7ff, 6),
                    small_float((word >> 11) & 0x7ff, 6),
                    small_float((word >> 22) & 0x3ff, 5),
                    1.0,
                ];
            }
            Layout::Rgb9E5 => {
                let word = u32_of(pixel);
                let exponent = i32::try_from(word >> 27).unwrap_or(0) - 15 - 9;
                let scale = 2f32.powi(exponent);
                #[allow(clippy::cast_precision_loss, reason = "9-bit mantissas")]
                let channel = |shift: u32| ((word >> shift) & 0x1ff) as f32 * scale;
                rgba = [channel(0), channel(9), channel(18), 1.0];
            }
        }
        rgba
    }

    /// Encodes RGBA into one pixel of `out` (`bytes_per_pixel` bytes).
    /// Values are clamped to the format's range; integer formats take the
    /// value as an integer.
    pub fn encode(&self, rgba: [f32; 4], out: &mut [u8]) {
        let channel = |i: usize| rgba.get(i).copied().unwrap_or(0.0);
        match self.layout {
            Layout::Components { size, kind } => {
                for (i, &c) in self.channels.iter().enumerate() {
                    if let Some(bytes) = out.get_mut(i * size..(i + 1) * size) {
                        encode_component(channel(c), kind, bytes);
                    }
                }
            }
            Layout::Packed16(bits) => {
                let mut word = 0u32;
                for (&c, &width) in self.channels.iter().zip(bits) {
                    let max = (1u32 << width) - 1;
                    word = (word << width) | to_unorm(channel(c), max);
                }
                let bytes = u16::try_from(word).unwrap_or(0).to_ne_bytes();
                copy_into(out, &bytes);
            }
            Layout::Rgb10A2 => {
                let (max, alpha_max) = (1023, 3);
                let value = |c: usize, m: u32| {
                    if self.integer {
                        to_uint(channel(c), m)
                    } else {
                        to_unorm(channel(c), m)
                    }
                };
                let word = value(0, max)
                    | (value(1, max) << 10)
                    | (value(2, max) << 20)
                    | (value(3, alpha_max) << 30);
                copy_into(out, &word.to_ne_bytes());
            }
            Layout::R11G11B10F => {
                let word = to_small_float(channel(0), 6)
                    | (to_small_float(channel(1), 6) << 11)
                    | (to_small_float(channel(2), 5) << 22);
                copy_into(out, &word.to_ne_bytes());
            }
            Layout::Rgb9E5 => copy_into(
                out,
                &to_rgb9e5([channel(0), channel(1), channel(2)]).to_ne_bytes(),
            ),
        }
    }
}

fn copy_into(out: &mut [u8], bytes: &[u8]) {
    for (o, b) in out.iter_mut().zip(bytes) {
        *o = *b;
    }
}

fn u32_of(pixel: &[u8]) -> u32 {
    let mut word = [0u8; 4];
    copy_into(&mut word, pixel);
    u32::from_ne_bytes(word)
}

#[allow(clippy::cast_precision_loss, reason = "values of at most 16 bits")]
fn unorm(value: u32, max: u32) -> f32 {
    value as f32 / max as f32
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "clamped to 0..=max first"
)]
fn to_unorm(value: f32, max: u32) -> u32 {
    let max_f = max as f32;
    (value.clamp(0.0, 1.0) * max_f).round() as u32
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "clamped to 0..=max first"
)]
fn to_uint(value: f32, max: u32) -> u32 {
    value.round().clamp(0.0, max as f32) as u32
}

fn decode_component(bytes: &[u8], kind: Component) -> f32 {
    let byte = |i: usize| bytes.get(i).copied().unwrap_or(0);
    #[allow(clippy::cast_precision_loss, reason = "integer texel values")]
    match (kind, bytes.len()) {
        (Component::Unorm, _) => f32::from(byte(0)) / 255.0,
        (Component::Snorm, _) => (f32::from(byte(0).cast_signed()) / 127.0).max(-1.0),
        (Component::Uint, 1) => f32::from(byte(0)),
        (Component::Sint, 1) => f32::from(byte(0).cast_signed()),
        (Component::Uint, 2) => f32::from(u16::from_ne_bytes([byte(0), byte(1)])),
        (Component::Sint, 2) => f32::from(i16::from_ne_bytes([byte(0), byte(1)])),
        (Component::Uint, _) => u32_of(bytes) as f32,
        (Component::Sint, _) => u32_of(bytes).cast_signed() as f32,
        (Component::Half, _) => half_to_f32(u16::from_ne_bytes([byte(0), byte(1)])),
        (Component::Float, _) => f32::from_bits(u32_of(bytes)),
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "each value is clamped to its type's range first"
)]
fn encode_component(value: f32, kind: Component, out: &mut [u8]) {
    match (kind, out.len()) {
        (Component::Unorm, _) => copy_into(out, &[(value.clamp(0.0, 1.0) * 255.0).round() as u8]),
        (Component::Snorm, _) => {
            copy_into(
                out,
                &[((value.clamp(-1.0, 1.0) * 127.0).round() as i8).cast_unsigned()],
            );
        }
        (Component::Uint, 1) => copy_into(out, &[value.round().clamp(0.0, 255.0) as u8]),
        (Component::Sint, 1) => {
            copy_into(
                out,
                &[(value.round().clamp(-128.0, 127.0) as i8).cast_unsigned()],
            );
        }
        (Component::Uint, 2) => copy_into(
            out,
            &(value.round().clamp(0.0, 65535.0) as u16).to_ne_bytes(),
        ),
        (Component::Sint, 2) => {
            copy_into(
                out,
                &(value.round().clamp(-32768.0, 32767.0) as i16).to_ne_bytes(),
            );
        }
        (Component::Uint, _) => copy_into(out, &(value.round().max(0.0) as u32).to_ne_bytes()),
        (Component::Sint, _) => copy_into(out, &(value.round() as i32).to_ne_bytes()),
        (Component::Half, _) => copy_into(out, &f32_to_half(value).to_ne_bytes()),
        (Component::Float, _) => copy_into(out, &value.to_bits().to_ne_bytes()),
    }
}

/// IEEE 754 binary16 to f32.
#[must_use]
pub fn half_to_f32(half: u16) -> f32 {
    let sign = if half & 0x8000 == 0 { 1.0 } else { -1.0 };
    let exponent = i32::from((half >> 10) & 0x1f);
    let mantissa = f32::from(half & 0x3ff);
    sign * match exponent {
        0 => mantissa * 2f32.powi(-24),
        31 if mantissa == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + mantissa / 1024.0) * 2f32.powi(e - 15),
    }
}

/// f32 to IEEE 754 binary16, rounding to nearest.
#[must_use]
pub fn f32_to_half(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = u16::try_from((bits >> 16) & 0x8000).unwrap_or(0);
    if value.is_nan() {
        return sign | 0x7e00;
    }
    let abs = value.abs();
    if abs >= 65520.0 {
        return sign | 0x7c00;
    }
    if abs < 2f32.powi(-24) / 2.0 {
        return sign;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "abs is in half range here"
    )]
    if abs < 2f32.powi(-14) {
        // Subnormal.
        return sign | (abs / 2f32.powi(-24)).round() as u16;
    }
    #[allow(
        clippy::cast_possible_truncation,
        reason = "log2 of a half-range value"
    )]
    let mut e = abs.log2().floor() as i32;
    let mut mantissa = (abs / 2f32.powi(e) - 1.0) * 1024.0;
    mantissa = mantissa.round();
    if mantissa >= 1024.0 {
        mantissa = 0.0;
        e += 1;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "exponent in -14..=15, mantissa in 0..1024"
    )]
    let half = (((e + 15) as u16) << 10) | mantissa as u16;
    sign | half
}

/// An unsigned float with `mantissa_bits` and a 5-bit exponent (the
/// R11F/G11F/B10F channels) to f32.
fn small_float(bits: u32, mantissa_bits: u32) -> f32 {
    let exponent = i32::try_from(bits >> mantissa_bits).unwrap_or(0);
    #[allow(clippy::cast_precision_loss, reason = "at most 6 mantissa bits")]
    let mantissa = (bits & ((1 << mantissa_bits) - 1)) as f32;
    let scale = 2f32.powi(i32::try_from(mantissa_bits).unwrap_or(0));
    match exponent {
        0 => mantissa / scale * 2f32.powi(-14),
        31 => f32::INFINITY,
        e => (1.0 + mantissa / scale) * 2f32.powi(e - 15),
    }
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "values are clamped to the encodable range"
)]
fn to_small_float(value: f32, mantissa_bits: u32) -> u32 {
    if value.is_nan() || value <= 0.0 {
        return 0;
    }
    let scale = 2f32.powi(i32::try_from(mantissa_bits).unwrap_or(0));
    let max = (2.0 - 1.0 / scale) * 2f32.powi(15);
    let value = value.min(max);
    if value < 2f32.powi(-14) {
        return (value / 2f32.powi(-14) * scale).round() as u32;
    }
    let mut e = value.log2().floor() as i32;
    let mut mantissa = ((value / 2f32.powi(e) - 1.0) * scale).round() as u32;
    if mantissa >= 1 << mantissa_bits {
        mantissa = 0;
        e += 1;
    }
    (((e + 15) as u32) << mantissa_bits) | mantissa
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "values are clamped to the encodable range"
)]
fn to_rgb9e5(rgb: [f32; 3]) -> u32 {
    let max_value = 511.0 / 512.0 * 2f32.powi(16);
    let clamped = rgb.map(|c| {
        if c.is_nan() {
            0.0
        } else {
            c.clamp(0.0, max_value)
        }
    });
    let max = clamped.iter().copied().fold(0.0f32, f32::max);
    let mut exponent = (max.log2().floor() as i32).max(-16) + 1 + 15;
    let mut scale = 2f32.powi(exponent - 15 - 9);
    if (max / scale).round() >= 512.0 {
        exponent += 1;
        scale *= 2.0;
    }
    let [r, g, b] = clamped.map(|c| (c / scale).round() as u32 & 0x1ff);
    r | (g << 9) | (b << 18) | ((exponent.clamp(0, 31) as u32) << 27)
}

/// A tightly packed image: `width × height` pixels of `codec`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    /// Bytes.
    pub data: Vec<u8>,
    /// Width in pixels.
    pub width: usize,
    /// Height in pixels.
    pub height: usize,
}

/// Where an image's rows are in a source buffer: unpack parameters resolved
/// for one image (OpenGL ES 3.0 §3.7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rows {
    /// Byte offset of the first pixel.
    pub start: usize,
    /// Bytes between rows.
    pub stride: usize,
    /// Bytes per row of pixels.
    pub row_bytes: usize,
    /// Number of rows.
    pub height: usize,
}

impl Rows {
    /// Bytes a source needs for these rows (the last row is not padded).
    #[must_use]
    pub fn required(&self) -> Option<usize> {
        if self.height == 0 || self.row_bytes == 0 {
            return Some(0);
        }
        self.start
            .checked_add(self.stride.checked_mul(self.height - 1)?)?
            .checked_add(self.row_bytes)
    }
}

/// The unpack layout of a `width × height` view upload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unpack {
    /// `UNPACK_ALIGNMENT`.
    pub alignment: usize,
    /// `UNPACK_ROW_LENGTH` (0: the width).
    pub row_length: usize,
    /// `UNPACK_SKIP_PIXELS`.
    pub skip_pixels: usize,
    /// `UNPACK_SKIP_ROWS`.
    pub skip_rows: usize,
}

impl Unpack {
    /// Where the rows of a `width × height` image of `bpp`-byte pixels are.
    #[must_use]
    pub fn rows(&self, width: usize, height: usize, bpp: usize) -> Option<Rows> {
        let pixels = if self.row_length == 0 {
            width
        } else {
            self.row_length
        };
        let alignment = self.alignment.max(1);
        let unaligned = pixels.checked_mul(bpp)?;
        let stride = unaligned.checked_add(alignment - 1)? / alignment * alignment;
        Some(Rows {
            start: self
                .skip_rows
                .checked_mul(stride)?
                .checked_add(self.skip_pixels.checked_mul(bpp)?)?,
            stride,
            row_bytes: width.checked_mul(bpp)?,
            height,
        })
    }
}

/// Copies `rows` out of `source` into a tight image, last row first when
/// `flip`, premultiplying with `codec` when `premultiply`. `None` when the
/// source is too short.
#[must_use]
pub fn repack(
    source: &[u8],
    rows: Rows,
    width: usize,
    codec: &Codec,
    flip: bool,
    premultiply: bool,
) -> Option<Image> {
    if source.len() < rows.required()? {
        return None;
    }
    let mut data = Vec::with_capacity(rows.row_bytes.checked_mul(rows.height)?);
    for r in 0..rows.height {
        let row = if flip { rows.height - 1 - r } else { r };
        let at = rows.start + row * rows.stride;
        data.extend_from_slice(source.get(at..at + rows.row_bytes)?);
    }
    if premultiply && codec.premultipliable() {
        let bpp = codec.bytes_per_pixel();
        for pixel in data.chunks_mut(bpp) {
            let [r, g, b, a] = codec.decode(pixel);
            codec.encode([r * a, g * a, b * a, a], pixel);
        }
    }
    Some(Image {
        data,
        width,
        height: rows.height,
    })
}

/// A sub-rectangle of an RGBA8 source (`source_width × source_height`, top
/// row first) encoded with `codec`, premultiplied when asked. The first row
/// uploaded is the source's top row (WebGL 1.0 §5.14.8); with `flip` the
/// source is flipped first, and the rectangle is selected in the flipped
/// image (WebGL 2.0 §5.35 "Pixel store parameters for uploads from
/// `TexImageSource`"). `None` when the rectangle is outside the source.
#[allow(
    clippy::too_many_arguments,
    clippy::many_single_char_names,
    reason = "an image, its selection and RGBA channels"
)]
#[must_use]
pub fn from_rgba8(
    source: &[u8],
    source_width: usize,
    source_height: usize,
    rect: (usize, usize, usize, usize),
    codec: &Codec,
    flip: bool,
    premultiply: bool,
) -> Option<Image> {
    let (x, y, width, height) = rect;
    if x.checked_add(width)? > source_width || y.checked_add(height)? > source_height {
        return None;
    }
    let bpp = codec.bytes_per_pixel();
    let mut data = vec![0u8; width.checked_mul(height)?.checked_mul(bpp)?];
    for (i, out) in data.chunks_mut(width.max(1) * bpp).enumerate() {
        let source_row = if flip {
            source_height - 1 - (y + i)
        } else {
            y + i
        };
        for (column, pixel) in out.chunks_mut(bpp).enumerate() {
            let at = (source_row * source_width + x + column) * 4;
            let texel = source.get(at..at + 4)?;
            let mut rgba = [0f32; 4];
            for (slot, &byte) in rgba.iter_mut().zip(texel) {
                *slot = if codec.integer {
                    f32::from(byte)
                } else {
                    f32::from(byte) / 255.0
                };
            }
            // Integer formats are premultiplied too, in 8-bit units, as
            // Chromium does for a TexImageSource.
            if premultiply && codec.integer {
                let [r, g, b, a] = rgba;
                let scale = a / 255.0;
                rgba = [
                    (r * scale).round(),
                    (g * scale).round(),
                    (b * scale).round(),
                    a,
                ];
            } else if premultiply {
                let [r, g, b, a] = rgba;
                rgba = [r * a, g * a, b * a, a];
            }
            codec.encode(rgba, pixel);
        }
    }
    Some(Image {
        data,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing, reason = "tests")]

    use super::*;

    #[test]
    fn layout_arithmetic() {
        let unpack = Unpack {
            alignment: 4,
            row_length: 0,
            skip_pixels: 0,
            skip_rows: 0,
        };
        let rows = unpack.rows(3, 2, 3).unwrap();
        assert_eq!(
            (rows.stride, rows.row_bytes, rows.required()),
            (12, 9, Some(21))
        );
        let skipped = Unpack {
            alignment: 1,
            row_length: 10,
            skip_pixels: 2,
            skip_rows: 1,
        };
        let rows = skipped.rows(4, 3, 4).unwrap();
        assert_eq!(rows.start, 40 + 8);
        assert_eq!(rows.required(), Some(48 + 80 + 16));
        assert_eq!(unpack.rows(usize::MAX, 2, 4), None);
    }

    #[test]
    fn round_trips() {
        let cases = [
            (GL_RGBA, GL_UNSIGNED_BYTE),
            (GL_RGB, GL_UNSIGNED_SHORT_5_6_5),
            (GL_RGBA, GL_UNSIGNED_SHORT_4_4_4_4),
            (GL_RGBA, GL_UNSIGNED_SHORT_5_5_5_1),
            (GL_RGBA, GL_FLOAT),
            (GL_RGBA, GL_HALF_FLOAT),
            (GL_RGBA, GL_UNSIGNED_INT_2_10_10_10_REV),
            (GL_LUMINANCE_ALPHA, GL_UNSIGNED_BYTE),
            (GL_RG, GL_BYTE),
            (GL_RGB, GL_UNSIGNED_INT_10F_11F_11F_REV),
            (GL_RGB, GL_UNSIGNED_INT_5_9_9_9_REV),
            (GL_RGBA_INTEGER, GL_UNSIGNED_SHORT),
        ];
        for (format, ty) in cases {
            let codec = Codec::new(format, ty).unwrap();
            let mut pixel = vec![0u8; codec.bytes_per_pixel()];
            let value = if codec.integer {
                [1.0, 2.0, 3.0, 4.0]
            } else {
                [1.0, 0.0, 1.0, 1.0]
            };
            codec.encode(value, &mut pixel);
            let decoded = codec.decode(&pixel);
            for &c in codec.channels {
                assert!(
                    (decoded[c] - value[c]).abs() < 1e-3,
                    "{format:#x}/{ty:#x}: {decoded:?}"
                );
            }
        }
    }

    #[test]
    fn halves() {
        for value in [0.0, 1.0, -2.5, 65504.0, 0.000_061_035_156] {
            assert_eq!(half_to_f32(f32_to_half(value)), value);
        }
        assert_eq!(f32_to_half(1e9), 0x7c00);
    }

    #[test]
    fn flip_and_premultiply() {
        let codec = Codec::new(GL_RGBA, GL_UNSIGNED_BYTE).unwrap();
        let source = [255, 0, 0, 255, 255, 255, 255, 128];
        let rows = Unpack {
            alignment: 4,
            row_length: 0,
            skip_pixels: 0,
            skip_rows: 0,
        }
        .rows(1, 2, 4)
        .unwrap();
        let image = repack(&source, rows, 1, &codec, true, true).unwrap();
        assert_eq!(image.data, [128, 128, 128, 128, 255, 0, 0, 255]);
        assert_eq!(repack(&source[..7], rows, 1, &codec, false, false), None);
    }

    #[test]
    fn rgba8_sources_are_bottom_up_and_selectable() {
        let codec = Codec::new(GL_RGB, GL_UNSIGNED_SHORT_5_6_5).unwrap();
        // 1×2: red on top, green below.
        let source = [255, 0, 0, 255, 0, 255, 0, 255];
        let red = 0xf800u16.to_ne_bytes();
        let green = 0x07e0u16.to_ne_bytes();
        let image = from_rgba8(&source, 1, 2, (0, 0, 1, 2), &codec, false, false).unwrap();
        assert_eq!(image.data, [red, green].concat());
        let flipped = from_rgba8(&source, 1, 2, (0, 0, 1, 2), &codec, true, false).unwrap();
        assert_eq!(flipped.data, [green, red].concat());
        let top = from_rgba8(&source, 1, 2, (0, 0, 1, 1), &codec, false, false).unwrap();
        assert_eq!(top.data, red.to_vec());
        let flipped_top = from_rgba8(&source, 1, 2, (0, 0, 1, 1), &codec, true, false).unwrap();
        assert_eq!(flipped_top.data, green.to_vec());
        assert_eq!(
            from_rgba8(&source, 1, 2, (0, 1, 1, 2), &codec, false, false),
            None
        );
    }
}
