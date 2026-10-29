//! Context state oxgl keeps itself: the WebGL-only pixel storage parameters,
//! which ANGLE does not know (WebGL 1.0 §5.14.3 `pixelStorei`).

use oxgl_sys::bindings::{GL_INVALID_VALUE, GL_NONE};

/// `UNPACK_FLIP_Y_WEBGL` (WebGL 1.0 §5.14).
pub const UNPACK_FLIP_Y_WEBGL: u32 = 0x9240;
/// `UNPACK_PREMULTIPLY_ALPHA_WEBGL` (WebGL 1.0 §5.14).
pub const UNPACK_PREMULTIPLY_ALPHA_WEBGL: u32 = 0x9241;
/// `UNPACK_COLORSPACE_CONVERSION_WEBGL` (WebGL 1.0 §5.14).
pub const UNPACK_COLORSPACE_CONVERSION_WEBGL: u32 = 0x9243;
/// `BROWSER_DEFAULT_WEBGL` (WebGL 1.0 §5.14).
pub const BROWSER_DEFAULT_WEBGL: u32 = 0x9244;

/// The three WebGL-only unpack parameters, read by texture uploads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnpackState {
    /// `UNPACK_FLIP_Y_WEBGL`.
    pub flip_y: bool,
    /// `UNPACK_PREMULTIPLY_ALPHA_WEBGL`.
    pub premultiply_alpha: bool,
    /// `UNPACK_COLORSPACE_CONVERSION_WEBGL`: `NONE` or `BROWSER_DEFAULT_WEBGL`.
    pub colorspace_conversion: u32,
}

impl Default for UnpackState {
    fn default() -> Self {
        Self {
            flip_y: false,
            premultiply_alpha: false,
            colorspace_conversion: BROWSER_DEFAULT_WEBGL,
        }
    }
}

/// What `pixelStorei` does with a parameter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelStore {
    /// Stored by oxgl.
    Stored,
    /// Rejected; synthesize this error.
    Error(u32),
    /// Not a WebGL-only parameter; forward it to ANGLE.
    Forward,
}

impl UnpackState {
    /// Applies `pixelStorei(pname, param)` if `pname` is a WebGL-only
    /// parameter. WebGL 1.0 §5.14.3 names no error for a bad colorspace
    /// value; `INVALID_VALUE` follows Chromium.
    pub fn store(&mut self, pname: u32, param: i32) -> PixelStore {
        match pname {
            UNPACK_FLIP_Y_WEBGL => self.flip_y = param != 0,
            UNPACK_PREMULTIPLY_ALPHA_WEBGL => self.premultiply_alpha = param != 0,
            UNPACK_COLORSPACE_CONVERSION_WEBGL => match u32::try_from(param) {
                Ok(value @ (GL_NONE | BROWSER_DEFAULT_WEBGL)) => {
                    self.colorspace_conversion = value;
                }
                _ => return PixelStore::Error(GL_INVALID_VALUE),
            },
            _ => return PixelStore::Forward,
        }
        PixelStore::Stored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_values() {
        let state = UnpackState::default();
        assert!(!state.flip_y && !state.premultiply_alpha);
        assert_eq!(state.colorspace_conversion, BROWSER_DEFAULT_WEBGL);
    }

    #[test]
    fn webgl_parameters_are_stored() {
        let mut state = UnpackState::default();
        assert_eq!(state.store(UNPACK_FLIP_Y_WEBGL, 5), PixelStore::Stored);
        assert_eq!(
            state.store(UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1),
            PixelStore::Stored
        );
        assert_eq!(
            state.store(UNPACK_COLORSPACE_CONVERSION_WEBGL, 0),
            PixelStore::Stored
        );
        assert!(state.flip_y && state.premultiply_alpha);
        assert_eq!(state.colorspace_conversion, GL_NONE);
        assert_eq!(state.store(UNPACK_FLIP_Y_WEBGL, 0), PixelStore::Stored);
        assert!(!state.flip_y);
    }

    #[test]
    fn bad_colorspace_value_is_invalid_value() {
        let mut state = UnpackState::default();
        for param in [0x1234, -1] {
            assert_eq!(
                state.store(UNPACK_COLORSPACE_CONVERSION_WEBGL, param),
                PixelStore::Error(GL_INVALID_VALUE)
            );
        }
        assert_eq!(state.colorspace_conversion, BROWSER_DEFAULT_WEBGL);
    }

    #[test]
    fn other_parameters_are_forwarded() {
        let mut state = UnpackState::default();
        assert_eq!(state.store(0x0D05, 4), PixelStore::Forward);
        assert_eq!(state, UnpackState::default());
    }
}
