//! Conversion of `TexImageSource` pixels between the predefined color spaces
//! (WebGL 1.0 §5.14.8, `unpackColorSpace`): sRGB and Display P3, which share
//! the sRGB transfer function and D65 white and differ in their primaries.

/// A `PredefinedColorSpace` (HTML §4.12.5.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSpace {
    /// `"srgb"`.
    Srgb,
    /// `"display-p3"`.
    DisplayP3,
}

impl ColorSpace {
    /// The color space a binding's code stands for: 1 Display P3, else sRGB.
    #[must_use]
    pub fn from_code(code: u32) -> Self {
        if code == 1 {
            Self::DisplayP3
        } else {
            Self::Srgb
        }
    }
}

/// Linear sRGB to linear Display P3, from CSS Color Module Level 4's
/// sample conversion code (`lin_sRGB_to_XYZ` then `XYZ_to_lin_P3`).
const SRGB_TO_P3: [[f32; 3]; 3] = [
    [0.822_461_97, 0.177_538_03, 0.0],
    [0.033_194_2, 0.966_805_8, 0.0],
    [0.017_082_63, 0.072_397_44, 0.910_519_9],
];

/// Linear Display P3 to linear sRGB, likewise (`lin_P3_to_XYZ` then
/// `XYZ_to_lin_sRGB`).
const P3_TO_SRGB: [[f32; 3]; 3] = [
    [1.224_940_2, -0.224_940_18, 0.0],
    [-0.042_056_955, 1.042_056_9, 0.0],
    [-0.019_637_555, -0.078_636_05, 1.098_273_6],
];

/// The sRGB transfer function's decoding, for a value in `0..=1`.
fn decode(encoded: f32) -> f32 {
    if encoded <= 0.040_45 {
        encoded / 12.92
    } else {
        ((encoded + 0.055) / 1.055).powf(2.4)
    }
}

/// The sRGB transfer function's encoding, clamping to `0..=1` first.
fn encode(linear: f32) -> f32 {
    let linear = linear.clamp(0.0, 1.0);
    if linear <= 0.003_130_8 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

/// The matrix from `from` to `to`, or `None` when they are the same.
fn matrix(from: ColorSpace, to: ColorSpace) -> Option<&'static [[f32; 3]; 3]> {
    match (from, to) {
        (ColorSpace::Srgb, ColorSpace::DisplayP3) => Some(&SRGB_TO_P3),
        (ColorSpace::DisplayP3, ColorSpace::Srgb) => Some(&P3_TO_SRGB),
        _ => None,
    }
}

/// Converts one linear RGB triple with `m`.
fn apply(m: &[[f32; 3]; 3], rgb: [f32; 3]) -> [f32; 3] {
    m.map(|row| row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])
}

/// Rounds a value in `0..=1` (after clamping) to `0..=max`.
fn quantize(value: f32, max: f32) -> f32 {
    (value.clamp(0.0, 1.0) * max).round()
}

/// Converts unpremultiplied RGBA8 pixels from `from` to `to` in place,
/// clamping colors outside the target gamut. Alpha is unchanged. A trailing
/// partial pixel is left as it is.
pub fn convert_rgba8(pixels: &mut [u8], from: ColorSpace, to: ColorSpace) {
    let Some(m) = matrix(from, to) else {
        return;
    };
    let table: [f32; 256] = std::array::from_fn(|i| {
        #[allow(clippy::cast_precision_loss, reason = "i is below 256")]
        decode(i as f32 / 255.0)
    });
    let linear = |byte: u8| table.get(usize::from(byte)).copied().unwrap_or(0.0);
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "quantize bounds it to 0..=255"
    )]
    let byte = |value: f32| quantize(encode(value), 255.0) as u8;
    for [r, g, b, _] in pixels.as_chunks_mut::<4>().0 {
        let [r2, g2, b2] = apply(m, [linear(*r), linear(*g), linear(*b)]);
        (*r, *g, *b) = (byte(r2), byte(g2), byte(b2));
    }
}

/// Converts unpremultiplied RGBA16 pixels, as native-endian `u16` bytes,
/// from `from` to `to` in place; see [`convert_rgba8`].
pub fn convert_rgba16(pixels: &mut [u8], from: ColorSpace, to: ColorSpace) {
    let Some(m) = matrix(from, to) else {
        return;
    };
    let linear = |bytes: [u8; 2]| decode(f32::from(u16::from_ne_bytes(bytes)) / 65535.0);
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "quantize bounds it to 0..=65535"
    )]
    let bytes = |value: f32| (quantize(encode(value), 65535.0) as u16).to_ne_bytes();
    for [r0, r1, g0, g1, b0, b1, _, _] in pixels.as_chunks_mut::<8>().0 {
        let rgb = apply(
            m,
            [linear([*r0, *r1]), linear([*g0, *g1]), linear([*b0, *b1])],
        );
        let [[nr0, nr1], [ng0, ng1], [nb0, nb1]] = rgb.map(bytes);
        (*r0, *r1, *g0, *g1, *b0, *b1) = (nr0, nr1, ng0, ng1, nb0, nb1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn converted(rgba: [u8; 4], from: ColorSpace, to: ColorSpace) -> [u8; 4] {
        let mut pixel = rgba;
        convert_rgba8(&mut pixel, from, to);
        pixel
    }

    fn close(actual: [u8; 4], expected: [u8; 4], tolerance: u8) -> bool {
        actual
            .iter()
            .zip(expected)
            .all(|(&a, e)| a.abs_diff(e) <= tolerance)
    }

    #[test]
    fn srgb_primaries_in_display_p3() {
        // The values Khronos `tex-image-and-sub-image-2d-with-video.js`
        // expects (webgl-test-utils.js `namedColorInColorSpace`).
        let red = converted([255, 0, 0, 255], ColorSpace::Srgb, ColorSpace::DisplayP3);
        let green = converted([0, 255, 0, 255], ColorSpace::Srgb, ColorSpace::DisplayP3);
        assert!(close(red, [234, 51, 35, 255], 1), "{red:?}");
        assert!(close(green, [117, 251, 76, 255], 1), "{green:?}");
    }

    #[test]
    fn round_trip() {
        // Colors well inside both gamuts. Near the sRGB gamut's edge, a dark
        // channel of a saturated color can move several units, because
        // 8-bit Display P3 holds it too coarsely.
        for rgba in [
            [200, 100, 50, 255],
            [60, 120, 180, 128],
            [128, 128, 128, 255],
            [255, 255, 255, 0],
            [0, 0, 0, 255],
        ] {
            let there = converted(rgba, ColorSpace::Srgb, ColorSpace::DisplayP3);
            let back = converted(there, ColorSpace::DisplayP3, ColorSpace::Srgb);
            assert!(close(back, rgba, 2), "{rgba:?} -> {there:?} -> {back:?}");
        }
    }

    #[test]
    fn display_p3_green_clamps_to_srgb_green() {
        let green = converted([0, 255, 0, 255], ColorSpace::DisplayP3, ColorSpace::Srgb);
        assert_eq!(green, [0, 255, 0, 255]);
    }

    #[test]
    fn same_space_and_alpha_untouched() {
        assert_eq!(
            converted([200, 100, 50, 77], ColorSpace::Srgb, ColorSpace::Srgb),
            [200, 100, 50, 77]
        );
        assert_eq!(
            converted([255, 0, 0, 77], ColorSpace::Srgb, ColorSpace::DisplayP3)[3],
            77
        );
    }

    #[test]
    fn sixteen_bit_matches_eight_bit() {
        let mut pixel = Vec::new();
        for value in [65535u16, 0, 0, 65535] {
            pixel.extend_from_slice(&value.to_ne_bytes());
        }
        convert_rgba16(&mut pixel, ColorSpace::Srgb, ColorSpace::DisplayP3);
        let red: Vec<u16> = pixel
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&b| u16::from_ne_bytes(b))
            .collect();
        // 257 maps 16-bit values onto 8-bit ones exactly: 65535 / 255.
        let eight: Vec<u16> = red
            .iter()
            .map(|&v| v / 257 + u16::from(v % 257 > 128))
            .collect();
        assert!(
            eight
                .iter()
                .zip([234, 51, 35, 255])
                .all(|(&a, e)| a.abs_diff(e) <= 1),
            "{red:?}"
        );
    }
}
