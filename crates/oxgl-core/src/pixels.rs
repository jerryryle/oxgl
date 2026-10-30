//! Pixel-transfer arithmetic and `ArrayBufferView` type rules for `readPixels`
//! (WebGL 1.0 §5.14.12, WebGL 2.0 §4.7.10, OpenGL ES 2.0 §4.3.1 and 3.0 §4.3.2).

use oxgl_sys::ViewKind;
use oxgl_sys::bindings::{
    GL_ALPHA, GL_BYTE, GL_FLOAT, GL_HALF_FLOAT, GL_INT, GL_LUMINANCE, GL_LUMINANCE_ALPHA, GL_RED,
    GL_RED_INTEGER, GL_RG, GL_RG_INTEGER, GL_RGB, GL_RGB_INTEGER, GL_RGBA, GL_RGBA_INTEGER,
    GL_SHORT, GL_UNSIGNED_BYTE, GL_UNSIGNED_INT, GL_UNSIGNED_INT_2_10_10_10_REV,
    GL_UNSIGNED_INT_5_9_9_9_REV, GL_UNSIGNED_INT_10F_11F_11F_REV, GL_UNSIGNED_SHORT,
    GL_UNSIGNED_SHORT_4_4_4_4, GL_UNSIGNED_SHORT_5_5_5_1, GL_UNSIGNED_SHORT_5_6_5,
};

/// The pack parameters that lay out `readPixels` rows (OpenGL ES 3.0
/// §4.3.2, §3.7.1). WebGL 1 has only `alignment`; the rest stay 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackLayout {
    /// `PACK_ALIGNMENT`.
    pub alignment: u64,
    /// `PACK_ROW_LENGTH`; 0 means the read's width.
    pub row_length: u64,
    /// `PACK_SKIP_PIXELS`.
    pub skip_pixels: u64,
    /// `PACK_SKIP_ROWS`.
    pub skip_rows: u64,
}

impl PackLayout {
    /// A layout with only `alignment` set.
    #[must_use]
    pub fn aligned(alignment: u64) -> Self {
        Self {
            alignment,
            row_length: 0,
            skip_pixels: 0,
            skip_rows: 0,
        }
    }
}

/// Components per pixel of `format`, if it is a `readPixels` format of the
/// WebGL version.
#[must_use]
pub fn components(format: u32, webgl2: bool) -> Option<u64> {
    match format {
        GL_ALPHA => Some(1),
        GL_RGB => Some(3),
        GL_RGBA => Some(4),
        _ if !webgl2 => None,
        GL_RED | GL_RED_INTEGER | GL_LUMINANCE => Some(1),
        GL_RG | GL_RG_INTEGER | GL_LUMINANCE_ALPHA => Some(2),
        GL_RGB_INTEGER => Some(3),
        GL_RGBA_INTEGER => Some(4),
        _ => None,
    }
}

/// How a pixel type is laid out and which view types may receive it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypeInfo {
    /// Bytes per component, or per pixel when `packed`.
    pub bytes: u64,
    /// One value holds a whole pixel.
    pub packed: bool,
    /// The `ArrayBufferView` types accepted for this type.
    pub views: &'static [ViewKind],
}

const fn info(bytes: u64, packed: bool, views: &'static [ViewKind]) -> TypeInfo {
    TypeInfo {
        bytes,
        packed,
        views,
    }
}

/// Layout of `ty`, if it is a `readPixels` type of the WebGL version.
#[must_use]
pub fn type_info(ty: u32, webgl2: bool) -> Option<TypeInfo> {
    use ViewKind::{Float32, Int8, Int16, Int32, Uint8, Uint8Clamped, Uint16, Uint32};
    match ty {
        GL_UNSIGNED_BYTE => Some(info(1, false, &[Uint8, Uint8Clamped])),
        GL_UNSIGNED_SHORT_5_6_5 | GL_UNSIGNED_SHORT_4_4_4_4 | GL_UNSIGNED_SHORT_5_5_5_1 => {
            Some(info(2, true, &[Uint16]))
        }
        GL_FLOAT => Some(info(4, false, &[Float32])),
        // OES_texture_half_float's type; ANGLE checks that it is enabled.
        crate::codec::HALF_FLOAT_OES if !webgl2 => Some(info(2, false, &[Uint16])),
        _ if !webgl2 => None,
        GL_BYTE => Some(info(1, false, &[Int8])),
        GL_SHORT => Some(info(2, false, &[Int16])),
        GL_UNSIGNED_SHORT | GL_HALF_FLOAT => Some(info(2, false, &[Uint16])),
        GL_INT => Some(info(4, false, &[Int32])),
        GL_UNSIGNED_INT => Some(info(4, false, &[Uint32])),
        GL_UNSIGNED_INT_2_10_10_10_REV
        | GL_UNSIGNED_INT_10F_11F_11F_REV
        | GL_UNSIGNED_INT_5_9_9_9_REV => Some(info(4, true, &[Uint32])),
        _ => None,
    }
}

/// Bytes a `width`×`height` read of `components`/`ty` needs under `layout`:
/// the skipped rows and pixels, then every row but the last padded to the
/// alignment at the row length's stride, then the last row unpadded (OpenGL
/// ES 3.0 §4.3.2). `None` on overflow.
#[must_use]
pub fn required_bytes(
    width: u64,
    height: u64,
    components: u64,
    ty: TypeInfo,
    layout: PackLayout,
) -> Option<u64> {
    if width == 0 || height == 0 {
        return Some(0);
    }
    let pixel = if ty.packed {
        ty.bytes
    } else {
        components.checked_mul(ty.bytes)?
    };
    let row_pixels = if layout.row_length > 0 {
        layout.row_length
    } else {
        width
    };
    let stride = row_pixels
        .checked_mul(pixel)?
        .checked_next_multiple_of(layout.alignment)?;
    let skipped = layout
        .skip_rows
        .checked_mul(stride)?
        .checked_add(layout.skip_pixels.checked_mul(pixel)?)?;
    stride
        .checked_mul(height - 1)?
        .checked_add(width.checked_mul(pixel)?)?
        .checked_add(skipped)
}

/// Whether a destination of `byte_len` bytes holds `required` bytes.
#[must_use]
pub fn fits(byte_len: usize, required: u64) -> bool {
    u64::try_from(byte_len).is_ok_and(|len| len >= required)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb_ubyte() -> (u64, TypeInfo) {
        (3, type_info(GL_UNSIGNED_BYTE, false).unwrap())
    }

    #[test]
    fn rgba_rows_need_no_padding() {
        let ty = type_info(GL_UNSIGNED_BYTE, false).unwrap();
        assert_eq!(
            required_bytes(3, 2, 4, ty, PackLayout::aligned(4)),
            Some(24)
        );
        assert_eq!(required_bytes(0, 5, 4, ty, PackLayout::aligned(4)), Some(0));
        assert_eq!(required_bytes(5, 0, 4, ty, PackLayout::aligned(4)), Some(0));
    }

    #[test]
    fn rgb_rows_are_padded_except_the_last() {
        let (components, ty) = rgb_ubyte();
        // 3x2 RGB: rows of 9 bytes.
        for (alignment, expected) in [(1, 18), (2, 19), (4, 21), (8, 25)] {
            let required =
                required_bytes(3, 2, components, ty, PackLayout::aligned(alignment)).unwrap();
            assert_eq!(
                required,
                u64::try_from(expected).unwrap(),
                "alignment {alignment}"
            );
            assert!(fits(expected, required));
            assert!(!fits(expected - 1, required));
        }
    }

    #[test]
    fn one_byte_rows_are_padded_except_the_last() {
        let ty = type_info(GL_UNSIGNED_BYTE, false).unwrap();
        // 5x3 ALPHA: rows of 5 bytes.
        for (alignment, expected) in [(1, 15), (2, 17), (4, 21), (8, 21)] {
            let required = required_bytes(5, 3, 1, ty, PackLayout::aligned(alignment)).unwrap();
            assert_eq!(
                required,
                u64::try_from(expected).unwrap(),
                "alignment {alignment}"
            );
            assert!(fits(expected, required));
            assert!(!fits(expected - 1, required));
        }
    }

    #[test]
    fn packed_types_count_whole_pixels() {
        let ty = type_info(GL_UNSIGNED_SHORT_5_6_5, false).unwrap();
        assert_eq!(
            required_bytes(3, 2, 3, ty, PackLayout::aligned(4)),
            Some(14)
        );
    }

    #[test]
    fn row_length_and_skips() {
        let ty = type_info(GL_UNSIGNED_BYTE, false).unwrap();
        // 2x2 RGBA, row length 4, skip 1 pixel: stride 16, offset 4.
        let layout = PackLayout {
            alignment: 4,
            row_length: 4,
            skip_pixels: 1,
            skip_rows: 0,
        };
        assert_eq!(required_bytes(2, 2, 4, ty, layout), Some(28));
        // Skipping a row adds one stride.
        let layout = PackLayout {
            skip_rows: 1,
            ..layout
        };
        assert_eq!(required_bytes(2, 2, 4, ty, layout), Some(44));
        // A row length shorter than the width still sets the stride.
        let layout = PackLayout {
            alignment: 1,
            row_length: 1,
            skip_pixels: 0,
            skip_rows: 0,
        };
        assert_eq!(required_bytes(2, 2, 4, ty, layout), Some(12));
    }

    #[test]
    fn skip_overflow_is_reported() {
        let ty = type_info(GL_UNSIGNED_BYTE, false).unwrap();
        let layout = PackLayout {
            alignment: 4,
            row_length: 0,
            skip_pixels: 0,
            skip_rows: u64::MAX / 2,
        };
        assert_eq!(required_bytes(4, 2, 4, ty, layout), None);
    }

    #[test]
    fn overflow_is_reported() {
        let ty = type_info(GL_UNSIGNED_BYTE, false).unwrap();
        assert_eq!(
            required_bytes(u64::MAX / 2, 3, 4, ty, PackLayout::aligned(4)),
            None
        );
        assert_eq!(
            required_bytes(u64::MAX, 1, 1, ty, PackLayout::aligned(4)),
            None
        );
    }

    #[test]
    fn webgl2_enums_are_rejected_in_webgl1() {
        assert!(components(GL_RED, false).is_none());
        assert!(components(GL_RED, true).is_some());
        assert!(type_info(GL_INT, false).is_none());
        assert!(type_info(GL_INT, true).is_some());
    }
}
