//! Fixed-function and pixel-store state calls (WebGL 1.0 §5.14.3–§5.14.4).
//! Every call passes values only; ANGLE validates them in WebGL-compatibility
//! mode.

use crate::bindings::{GLboolean, GLenum, GLsizei};
use crate::egl::Current;

/// One value-only GLES state call, as [`Current::apply`] issues it.
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(
    missing_docs,
    reason = "each variant is the GLES function of the same name"
)]
pub enum StateCall {
    ActiveTexture(GLenum),
    BlendColor(f32, f32, f32, f32),
    BlendEquation(GLenum),
    BlendEquationSeparate(GLenum, GLenum),
    BlendFunc(GLenum, GLenum),
    BlendFuncSeparate(GLenum, GLenum, GLenum, GLenum),
    ClearDepth(f32),
    ClearStencil(i32),
    ColorMask(bool, bool, bool, bool),
    CullFace(GLenum),
    DepthFunc(GLenum),
    DepthMask(bool),
    DepthRange(f32, f32),
    Disable(GLenum),
    Enable(GLenum),
    Finish,
    Flush,
    FrontFace(GLenum),
    Hint(GLenum, GLenum),
    LineWidth(f32),
    PolygonOffset(f32, f32),
    SampleCoverage(f32, bool),
    Scissor(i32, i32, i32, i32),
    StencilFunc(GLenum, i32, u32),
    StencilFuncSeparate(GLenum, GLenum, i32, u32),
    StencilMask(u32),
    StencilMaskSeparate(GLenum, u32),
    StencilOp(GLenum, GLenum, GLenum),
    StencilOpSeparate(GLenum, GLenum, GLenum, GLenum),
    Viewport(i32, i32, i32, i32),
}

fn boolean(value: bool) -> GLboolean {
    GLboolean::from(value)
}

impl Current<'_> {
    /// Issues `call` on the current context.
    #[allow(
        clippy::too_many_lines,
        reason = "one arm per GLES entry point, each a single call"
    )]
    pub fn apply(&self, call: StateCall) {
        let gl = self.fns();
        /// Calls one GLES entry point with value arguments.
        macro_rules! call {
            ($f:ident($($arg:expr),*)) => {
                // SAFETY: a context is current (type invariant of `Current`),
                // and the call passes values only, no pointers.
                unsafe { (gl.$f)($($arg),*); }
            };
        }
        match call {
            StateCall::ActiveTexture(texture) => call!(glActiveTexture(texture)),
            StateCall::BlendColor(r, g, b, a) => call!(glBlendColor(r, g, b, a)),
            StateCall::BlendEquation(mode) => call!(glBlendEquation(mode)),
            StateCall::BlendEquationSeparate(rgb, alpha) => {
                call!(glBlendEquationSeparate(rgb, alpha));
            }
            StateCall::BlendFunc(src, dst) => call!(glBlendFunc(src, dst)),
            StateCall::BlendFuncSeparate(src_rgb, dst_rgb, src_alpha, dst_alpha) => {
                call!(glBlendFuncSeparate(src_rgb, dst_rgb, src_alpha, dst_alpha));
            }
            StateCall::ClearDepth(depth) => call!(glClearDepthf(depth)),
            StateCall::ClearStencil(s) => call!(glClearStencil(s)),
            StateCall::ColorMask(r, g, b, a) => {
                call!(glColorMask(boolean(r), boolean(g), boolean(b), boolean(a)));
            }
            StateCall::CullFace(mode) => call!(glCullFace(mode)),
            StateCall::DepthFunc(func) => call!(glDepthFunc(func)),
            StateCall::DepthMask(flag) => call!(glDepthMask(boolean(flag))),
            StateCall::DepthRange(near, far) => call!(glDepthRangef(near, far)),
            StateCall::Disable(cap) => call!(glDisable(cap)),
            StateCall::Enable(cap) => call!(glEnable(cap)),
            StateCall::Finish => call!(glFinish()),
            StateCall::Flush => call!(glFlush()),
            StateCall::FrontFace(mode) => call!(glFrontFace(mode)),
            StateCall::Hint(target, mode) => call!(glHint(target, mode)),
            StateCall::LineWidth(width) => call!(glLineWidth(width)),
            StateCall::PolygonOffset(factor, units) => call!(glPolygonOffset(factor, units)),
            StateCall::SampleCoverage(value, invert) => {
                call!(glSampleCoverage(value, boolean(invert)));
            }
            StateCall::Scissor(x, y, w, h) => call!(glScissor(x, y, w, h)),
            StateCall::StencilFunc(func, reference, mask) => {
                call!(glStencilFunc(func, reference, mask));
            }
            StateCall::StencilFuncSeparate(face, func, reference, mask) => {
                call!(glStencilFuncSeparate(face, func, reference, mask));
            }
            StateCall::StencilMask(mask) => call!(glStencilMask(mask)),
            StateCall::StencilMaskSeparate(face, mask) => call!(glStencilMaskSeparate(face, mask)),
            StateCall::StencilOp(fail, zfail, zpass) => call!(glStencilOp(fail, zfail, zpass)),
            StateCall::StencilOpSeparate(face, fail, zfail, zpass) => {
                call!(glStencilOpSeparate(face, fail, zfail, zpass));
            }
            StateCall::Viewport(x, y, w, h) => call!(glViewport(x, y, w, h)),
        }
    }

    /// `glPixelStorei`. Kept out of [`StateCall`] so the WebGL-only
    /// parameters, which oxgl stores itself, cannot reach ANGLE through
    /// [`Current::apply`].
    pub fn pixel_store(&self, pname: GLenum, param: i32) {
        // SAFETY: a context is current (type invariant); value arguments only.
        unsafe { (self.fns().glPixelStorei)(pname, param) };
    }

    /// `glIsEnabled`.
    #[must_use]
    pub fn is_enabled(&self, cap: GLenum) -> bool {
        // SAFETY: a context is current (type invariant); value argument only.
        unsafe { (self.fns().glIsEnabled)(cap) != 0 }
    }
}

/// Values read by one of the robust `glGet*v` queries.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Values {
    /// `glGetBooleanvRobustANGLE`.
    Booleans([bool; 4]),
    /// `glGetFloatvRobustANGLE`.
    Floats([f32; 4]),
    /// `glGetIntegervRobustANGLE`.
    Integers([i32; 4]),
    /// `glGetInteger64vRobustANGLE`.
    Integer64s([i64; 4]),
}

/// Which robust `glGet*v` query [`Current::get_values`] runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueType {
    /// `glGetBooleanvRobustANGLE`.
    Boolean,
    /// `glGetFloatvRobustANGLE`.
    Float,
    /// `glGetIntegervRobustANGLE`.
    Integer,
    /// `glGetInteger64vRobustANGLE`.
    Integer64,
}

/// Range and precision of a shader numeric format, as
/// `glGetShaderPrecisionFormat` reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrecisionFormat {
    /// log2 of the smallest representable magnitude's negation.
    pub range_min: i32,
    /// log2 of the largest representable magnitude.
    pub range_max: i32,
    /// Bits of precision.
    pub precision: i32,
}

impl Current<'_> {
    /// Reads up to four values of `pname` with the robust query for `ty`.
    /// `None` if the query generated an error (ANGLE then writes nothing).
    #[must_use]
    pub fn get_values(&self, pname: GLenum, ty: ValueType) -> Option<Values> {
        let gl = self.fns();
        let mut length: GLsizei = 0;
        let values = match ty {
            ValueType::Boolean => {
                let mut data: [GLboolean; 4] = [0; 4];
                // SAFETY: a context is current; ANGLE writes at most `bufSize`
                // (4) values into `data` and one GLsizei into `length`.
                unsafe {
                    (gl.glGetBooleanvRobustANGLE)(pname, 4, &raw mut length, data.as_mut_ptr());
                };
                Values::Booleans(data.map(|b| b != 0))
            }
            ValueType::Float => {
                let mut data = [0.0; 4];
                // SAFETY: as above, for four GLfloats.
                unsafe {
                    (gl.glGetFloatvRobustANGLE)(pname, 4, &raw mut length, data.as_mut_ptr());
                };
                Values::Floats(data)
            }
            ValueType::Integer => {
                let mut data = [0; 4];
                // SAFETY: as above, for four GLints.
                unsafe {
                    (gl.glGetIntegervRobustANGLE)(pname, 4, &raw mut length, data.as_mut_ptr());
                };
                Values::Integers(data)
            }
            ValueType::Integer64 => {
                let mut data = [0; 4];
                // SAFETY: as above, for four GLint64s.
                unsafe {
                    (gl.glGetInteger64vRobustANGLE)(pname, 4, &raw mut length, data.as_mut_ptr());
                };
                Values::Integer64s(data)
            }
        };
        (length > 0).then_some(values)
    }

    /// `glGetShaderPrecisionFormat`. The entry point reports no failure, so
    /// callers pass only valid enums.
    #[must_use]
    pub fn shader_precision_format(&self, shader: GLenum, precision: GLenum) -> PrecisionFormat {
        let mut range = [0; 2];
        let mut bits = 0;
        // SAFETY: a context is current; the call writes two GLints into
        // `range` and one into `bits`, all Rust-owned locals.
        unsafe {
            (self.fns().glGetShaderPrecisionFormat)(
                shader,
                precision,
                range.as_mut_ptr(),
                &raw mut bits,
            );
        };
        PrecisionFormat {
            range_min: range[0],
            range_max: range[1],
            precision: bits,
        }
    }
}
