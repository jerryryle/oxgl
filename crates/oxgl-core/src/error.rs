//! The WebGL error flag model (WebGL 1.0 §5.14.3, OpenGL ES 2.0 §2.5).

use std::fmt;

use oxgl_sys::bindings::{
    GL_INVALID_ENUM, GL_INVALID_FRAMEBUFFER_OPERATION, GL_INVALID_OPERATION, GL_INVALID_VALUE,
    GL_NO_ERROR, GL_OUT_OF_MEMORY,
};

/// `CONTEXT_LOST_WEBGL` (WebGL 1.0 §5.14).
pub const CONTEXT_LOST_WEBGL: u32 = 0x9242;

/// The error codes a flag can record, in the order `getError` reports them.
const CODES: [u32; 5] = [
    GL_INVALID_ENUM,
    GL_INVALID_VALUE,
    GL_INVALID_OPERATION,
    GL_OUT_OF_MEMORY,
    GL_INVALID_FRAMEBUFFER_OPERATION,
];

/// Per-context error state: errors synthesized by oxgl's own validation (one
/// flag per code) and the lost-context sequence. Errors recorded by ANGLE stay
/// in ANGLE and are drained by [`ErrorState::get_error`] after these.
#[derive(Debug, Default)]
pub struct ErrorState {
    /// Bit `i` set: `CODES[i]` is pending.
    flags: u8,
    lost: bool,
    lost_reported: bool,
}

impl ErrorState {
    /// Records `code` (a no-op if it is already pending or not an error code).
    pub fn synthesize(&mut self, code: u32) {
        if let Some(bit) = CODES.iter().position(|&c| c == code) {
            self.flags |= 1 << bit;
        }
    }

    /// Sets the webgl context lost flag. Pending errors are discarded: a lost
    /// context reports `CONTEXT_LOST_WEBGL` once, then `NO_ERROR`.
    pub fn mark_lost(&mut self) {
        self.lost = true;
        self.flags = 0;
    }

    /// Whether the webgl context lost flag is set.
    #[must_use]
    pub fn is_lost(&self) -> bool {
        self.lost
    }

    /// `getError`: the lost sequence if lost, else one synthesized error, else
    /// one error drained from the GL by `gl`.
    pub fn get_error(&mut self, gl: impl FnOnce() -> u32) -> u32 {
        if self.lost {
            if self.lost_reported {
                return GL_NO_ERROR;
            }
            self.lost_reported = true;
            return CONTEXT_LOST_WEBGL;
        }
        for (bit, &code) in CODES.iter().enumerate() {
            if self.flags & (1 << bit) != 0 {
                self.flags &= !(1 << bit);
                return code;
            }
        }
        gl()
    }
}

/// Errors surfaced to JS as exceptions with a stable `code`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// The ANGLE libraries could not be loaded (`OXGL_NATIVE_MISSING`).
    NativeMissing(String),
    /// `backend: 'gpu'` could not create a context (`OXGL_GPU_UNAVAILABLE`).
    GpuUnavailable(String),
    /// No backend could create a context (`OXGL_CONTEXT_CREATION_FAILED`).
    ContextCreationFailed(String),
}

impl CoreError {
    /// The stable JS error `code`.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::NativeMissing(_) => "OXGL_NATIVE_MISSING",
            Self::GpuUnavailable(_) => "OXGL_GPU_UNAVAILABLE",
            Self::ContextCreationFailed(_) => "OXGL_CONTEXT_CREATION_FAILED",
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NativeMissing(detail) => write!(f, "oxgl: {detail}"),
            Self::GpuUnavailable(detail) => {
                write!(f, "oxgl: GPU backend unavailable: {detail}")
            }
            Self::ContextCreationFailed(detail) => {
                write!(f, "oxgl: cannot create a context: {detail}")
            }
        }
    }
}

impl std::error::Error for CoreError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_error_initially() {
        let mut state = ErrorState::default();
        assert_eq!(state.get_error(|| GL_NO_ERROR), GL_NO_ERROR);
    }

    #[test]
    fn synthesized_error_is_reported_once() {
        let mut state = ErrorState::default();
        state.synthesize(GL_INVALID_VALUE);
        state.synthesize(GL_INVALID_VALUE);
        assert_eq!(state.get_error(|| GL_NO_ERROR), GL_INVALID_VALUE);
        assert_eq!(state.get_error(|| GL_NO_ERROR), GL_NO_ERROR);
    }

    #[test]
    fn synthesized_errors_come_before_gl_errors() {
        let mut state = ErrorState::default();
        let mut gl = vec![GL_INVALID_VALUE];
        state.synthesize(GL_INVALID_OPERATION);
        let mut drain = || gl.pop().unwrap_or(GL_NO_ERROR);
        assert_eq!(state.get_error(&mut drain), GL_INVALID_OPERATION);
        assert_eq!(state.get_error(&mut drain), GL_INVALID_VALUE);
        assert_eq!(state.get_error(&mut drain), GL_NO_ERROR);
    }

    #[test]
    fn several_flags_each_reported_once() {
        let mut state = ErrorState::default();
        state.synthesize(GL_INVALID_OPERATION);
        state.synthesize(GL_INVALID_ENUM);
        let mut seen = vec![
            state.get_error(|| GL_NO_ERROR),
            state.get_error(|| GL_NO_ERROR),
        ];
        seen.sort_unstable();
        assert_eq!(seen, [GL_INVALID_ENUM, GL_INVALID_OPERATION]);
        assert_eq!(state.get_error(|| GL_NO_ERROR), GL_NO_ERROR);
    }

    #[test]
    fn lost_context_reports_once_and_never_drains_gl() {
        let mut state = ErrorState::default();
        state.synthesize(GL_INVALID_ENUM);
        state.mark_lost();
        let gl = || panic!("a lost context must not call the GL");
        assert_eq!(state.get_error(gl), CONTEXT_LOST_WEBGL);
        assert_eq!(state.get_error(gl), GL_NO_ERROR);
        assert_eq!(state.get_error(gl), GL_NO_ERROR);
        assert!(state.is_lost());
    }

    #[test]
    fn unknown_codes_are_ignored() {
        let mut state = ErrorState::default();
        state.synthesize(0x1234);
        assert_eq!(state.get_error(|| GL_NO_ERROR), GL_NO_ERROR);
    }
}
