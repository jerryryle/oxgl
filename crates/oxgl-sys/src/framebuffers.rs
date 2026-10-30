//! Framebuffer calls that take arrays or write results: every array is a
//! Rust slice passed with its length, and every query is a robust variant
//! bounded by its buffer.

use std::ffi::c_void;

use crate::ReadPixels;
use crate::bindings::{GLenum, GLint, GLintptr, GLsizei};
use crate::egl::Current;

fn len(values: usize) -> Option<GLsizei> {
    GLsizei::try_from(values).ok()
}

/// Values for `glClearBuffer{f,i,ui}v`.
#[derive(Debug, Clone, Copy)]
pub enum ClearValues<'a> {
    /// `glClearBufferfv`.
    Float(&'a [f32]),
    /// `glClearBufferiv`.
    Int(&'a [i32]),
    /// `glClearBufferuiv`.
    Uint(&'a [u32]),
}

impl ClearValues<'_> {
    /// Number of values.
    #[must_use]
    pub fn len(&self) -> usize {
        match self {
            Self::Float(v) => v.len(),
            Self::Int(v) => v.len(),
            Self::Uint(v) => v.len(),
        }
    }

    /// Whether there are no values.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Current<'_> {
    /// `glDrawBuffers` (OpenGL ES 3.0).
    pub fn draw_buffers(&self, buffers: &[GLenum]) {
        let Some(n) = len(buffers.len()) else { return };
        // SAFETY: a context is current; the GL reads `n` enums, the slice's
        // length.
        unsafe { (self.fns().glDrawBuffers)(n, buffers.as_ptr()) };
    }

    /// `glInvalidateFramebuffer`, or `glInvalidateSubFramebuffer` with a
    /// region.
    pub fn invalidate_framebuffer(
        &self,
        target: GLenum,
        attachments: &[GLenum],
        region: Option<[GLint; 4]>,
    ) {
        let Some(count) = len(attachments.len()) else {
            return;
        };
        let gl = self.fns();
        match region {
            // SAFETY: a context is current; the GL reads `n` enums.
            None => unsafe { (gl.glInvalidateFramebuffer)(target, count, attachments.as_ptr()) },
            // SAFETY: as above.
            Some([x, y, w, h]) => unsafe {
                (gl.glInvalidateSubFramebuffer)(target, count, attachments.as_ptr(), x, y, w, h);
            },
        }
    }

    /// `glClearBuffer{f,i,ui}v`. The GL reads 4 values for `COLOR` and 1 for
    /// `DEPTH`/`STENCIL`; callers pass at least that many.
    pub fn clear_buffer(&self, buffer: GLenum, drawbuffer: GLint, values: ClearValues<'_>) {
        let gl = self.fns();
        let needed = if buffer == crate::bindings::GL_COLOR {
            4
        } else {
            1
        };
        if values.len() < needed {
            return;
        }
        match values {
            // SAFETY: a context is current; the GL reads at most 4 values
            // (checked above against the slice's length).
            ClearValues::Float(v) => unsafe {
                (gl.glClearBufferfv)(buffer, drawbuffer, v.as_ptr());
            },
            // SAFETY: as above.
            ClearValues::Int(v) => unsafe { (gl.glClearBufferiv)(buffer, drawbuffer, v.as_ptr()) },
            // SAFETY: as above.
            ClearValues::Uint(v) => unsafe {
                (gl.glClearBufferuiv)(buffer, drawbuffer, v.as_ptr());
            },
        }
    }

    /// `glGetFramebufferAttachmentParameterivRobustANGLE` for one value.
    #[must_use]
    pub fn framebuffer_attachment_parameter(
        &self,
        target: GLenum,
        attachment: GLenum,
        pname: GLenum,
    ) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: a context is current; one GLint (bufSize 1) into the local
        // and one GLsizei into `length`.
        unsafe {
            (self.fns().glGetFramebufferAttachmentParameterivRobustANGLE)(
                target,
                attachment,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// `glGetRenderbufferParameterivRobustANGLE` for one value.
    #[must_use]
    pub fn renderbuffer_parameter(&self, target: GLenum, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: as for `framebuffer_attachment_parameter`.
        unsafe {
            (self.fns().glGetRenderbufferParameterivRobustANGLE)(
                target,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// `glGetInternalformativRobustANGLE` into `out`; the number of values
    /// written.
    pub fn internalformat_parameter(
        &self,
        target: GLenum,
        format: GLenum,
        pname: GLenum,
        out: &mut [GLint],
    ) -> usize {
        let size = len(out.len()).unwrap_or(GLsizei::MAX);
        let mut length = 0;
        // SAFETY: a context is current; at most `size` GLints (the slice's
        // length) and one GLsizei.
        unsafe {
            (self.fns().glGetInternalformativRobustANGLE)(
                target,
                format,
                pname,
                size,
                &raw mut length,
                out.as_mut_ptr(),
            );
        };
        usize::try_from(length).unwrap_or(0).min(out.len())
    }

    /// `glReadPixels` into the bound pixel pack buffer at `offset`. Callers
    /// must have checked that a pixel pack buffer is bound.
    pub fn read_pixels_to_buffer(&self, args: ReadPixels, offset: GLintptr) {
        // SAFETY: a context is current and a pixel pack buffer is bound
        // (caller's contract), so the GL treats the pointer as an offset into
        // that buffer, validates it, and never dereferences it.
        unsafe {
            (self.fns().glReadPixels)(
                args.x,
                args.y,
                args.width,
                args.height,
                args.format,
                args.ty,
                offset as *mut c_void,
            );
        };
    }
}
