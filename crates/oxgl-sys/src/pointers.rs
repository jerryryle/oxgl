//! GLES calls that read or write client memory. Every one takes Rust slices
//! and passes their lengths, or uses a robust (`…RobustANGLE`) variant that
//! takes a buffer size, so no call reads or writes outside Rust-owned memory.

use std::ffi::{CStr, c_char, c_void};
use std::ptr;

use crate::bindings::{
    GL_INFO_LOG_LENGTH, GL_MAP_READ_BIT, GLboolean, GLenum, GLint, GLintptr, GLsizei, GLsizeiptr,
    GLuint,
};
use crate::egl::Current;

/// Shape of a `glUniform*v` call: components per element and scalar type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UniformVector {
    /// `glUniform{n}fv`.
    Float(u8),
    /// `glUniform{n}iv`.
    Int(u8),
    /// `glUniform{n}uiv`.
    Uint(u8),
}

/// A `glUniformMatrix*fv` shape: columns × rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(missing_docs, reason = "each variant names its GLSL type")]
pub enum UniformMatrix {
    Mat2,
    Mat3,
    Mat4,
    Mat2x3,
    Mat2x4,
    Mat3x2,
    Mat3x4,
    Mat4x2,
    Mat4x3,
}

impl UniformMatrix {
    /// Floats per matrix.
    #[must_use]
    pub fn components(self) -> usize {
        match self {
            Self::Mat2 => 4,
            Self::Mat3 => 9,
            Self::Mat4 => 16,
            Self::Mat2x3 | Self::Mat3x2 => 6,
            Self::Mat2x4 | Self::Mat4x2 => 8,
            Self::Mat3x4 | Self::Mat4x3 => 12,
        }
    }
}

/// Uniform data, by scalar type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UniformData<'a> {
    /// `GLfloat`s.
    Float(&'a [f32]),
    /// `GLint`s.
    Int(&'a [i32]),
    /// `GLuint`s.
    Uint(&'a [u32]),
}

/// Which `glGetVertexAttrib*vRobustANGLE` reads a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttribQuery {
    /// `glGetVertexAttribfvRobustANGLE`.
    Float,
    /// `glGetVertexAttribivRobustANGLE`.
    Int,
    /// `glGetVertexAttribIivRobustANGLE`.
    IntegerInt,
    /// `glGetVertexAttribIuivRobustANGLE`.
    IntegerUint,
}

/// Up to four values from a vertex attribute or uniform query, as raw bits
/// of the scalar type that was asked for, and how many were written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quad {
    /// The values; `f32` and `u32` results are stored by bit pattern.
    pub bits: [u32; 4],
    /// Number of values written.
    pub len: usize,
}

/// An active attribute or uniform (`glGetActiveAttrib`/`glGetActiveUniform`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveInfo {
    /// Array size (1 for non-arrays).
    pub size: GLint,
    /// GLSL type enum.
    pub ty: GLenum,
    /// Name.
    pub name: String,
}

/// Converts a length to `GLsizei`, or `None` when it does not fit.
fn sizei(len: usize) -> Option<GLsizei> {
    GLsizei::try_from(len).ok()
}

impl Current<'_> {
    /// `glBufferData` with `data` (copied by the GL before returning).
    pub fn buffer_data(&self, target: GLenum, data: &[u8], usage: GLenum) {
        let Ok(size) = GLsizeiptr::try_from(data.len()) else {
            return;
        };
        // SAFETY: a context is current; the GL reads `size` bytes from
        // `data`, which is exactly the slice's length, before returning.
        unsafe { (self.fns().glBufferData)(target, size, data.as_ptr().cast(), usage) };
    }

    /// `glBufferData` with no data: `size` zero-initialized bytes (robust
    /// resource initialization).
    pub fn buffer_data_size(&self, target: GLenum, size: GLsizeiptr, usage: GLenum) {
        // SAFETY: a context is current; a null data pointer is allowed and
        // makes the GL read nothing.
        unsafe { (self.fns().glBufferData)(target, size, ptr::null(), usage) };
    }

    /// `glBufferSubData` with `data`.
    pub fn buffer_sub_data(&self, target: GLenum, offset: GLintptr, data: &[u8]) {
        let Ok(size) = GLsizeiptr::try_from(data.len()) else {
            return;
        };
        // SAFETY: a context is current; the GL reads `size` bytes from
        // `data`, exactly the slice's length.
        unsafe { (self.fns().glBufferSubData)(target, offset, size, data.as_ptr().cast()) };
    }

    /// Reads `out.len()` bytes at `offset` from the buffer bound to `target`
    /// through `glMapBufferRange`/`glUnmapBuffer` (OpenGL ES 3.0). `false`
    /// when mapping failed (the GL then recorded an error).
    pub fn get_buffer_sub_data(&self, target: GLenum, offset: GLintptr, out: &mut [u8]) -> bool {
        let Ok(length) = GLsizeiptr::try_from(out.len()) else {
            return false;
        };
        if out.is_empty() {
            return true;
        }
        let gl = self.fns();
        // SAFETY: a context is current; value arguments only. A non-null
        // result points at `length` readable bytes until `glUnmapBuffer`.
        let mapped = unsafe { (gl.glMapBufferRange)(target, offset, length, GL_MAP_READ_BIT) };
        if mapped.is_null() {
            return false;
        }
        // SAFETY: `mapped` points at `out.len()` bytes mapped for reading
        // (above), which do not overlap the Rust-owned `out`.
        unsafe { ptr::copy_nonoverlapping(mapped.cast::<u8>(), out.as_mut_ptr(), out.len()) };
        // SAFETY: a context is current; the buffer bound to `target` is the
        // one mapped above, and the mapping is no longer used.
        unsafe { (gl.glUnmapBuffer)(target) };
        true
    }

    /// `glShaderSource` with one string.
    pub fn shader_source(&self, shader: GLuint, source: &str) {
        let Some(length) = sizei(source.len()) else {
            return;
        };
        let string: *const c_char = source.as_ptr().cast();
        // SAFETY: a context is current; the GL reads one string pointer and
        // one length from the locals, and `length` bytes from `source`.
        unsafe { (self.fns().glShaderSource)(shader, 1, &raw const string, &raw const length) };
    }

    /// `glGetShaderivRobustANGLE` for one value.
    #[must_use]
    pub fn shader_parameter(&self, shader: GLuint, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: a context is current; at most one GLint (bufSize 1) is
        // written into `value` and one GLsizei into `length`.
        unsafe {
            (self.fns().glGetShaderivRobustANGLE)(
                shader,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// `glGetProgramivRobustANGLE` for one value.
    #[must_use]
    pub fn program_parameter(&self, program: GLuint, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: as for `shader_parameter`.
        unsafe {
            (self.fns().glGetProgramivRobustANGLE)(
                program,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// `glGetBufferParameterivRobustANGLE` for one value.
    #[must_use]
    pub fn buffer_parameter(&self, target: GLenum, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: as for `shader_parameter`.
        unsafe {
            (self.fns().glGetBufferParameterivRobustANGLE)(
                target,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// The shader's info log.
    #[must_use]
    pub fn shader_info_log(&self, shader: GLuint) -> Option<String> {
        let capacity = self.shader_parameter(shader, GL_INFO_LOG_LENGTH)?;
        let mut buffer = vec![0u8; usize::try_from(capacity).ok()?.max(1)];
        let mut length = 0;
        let size = sizei(buffer.len())?;
        // SAFETY: a context is current; the GL writes at most `size` bytes
        // (including the terminator) into `buffer` and one GLsizei into
        // `length`.
        unsafe {
            (self.fns().glGetShaderInfoLog)(
                shader,
                size,
                &raw mut length,
                buffer.as_mut_ptr().cast(),
            );
        };
        Some(utf8(&buffer, length))
    }

    /// The program's info log.
    #[must_use]
    pub fn program_info_log(&self, program: GLuint) -> Option<String> {
        let capacity = self.program_parameter(program, GL_INFO_LOG_LENGTH)?;
        let mut buffer = vec![0u8; usize::try_from(capacity).ok()?.max(1)];
        let mut length = 0;
        let size = sizei(buffer.len())?;
        // SAFETY: as for `shader_info_log`.
        unsafe {
            (self.fns().glGetProgramInfoLog)(
                program,
                size,
                &raw mut length,
                buffer.as_mut_ptr().cast(),
            );
        };
        Some(utf8(&buffer, length))
    }

    /// `glGetActiveAttrib` (`uniform` false) or `glGetActiveUniform`, with a
    /// name buffer of `max_length` bytes (`ACTIVE_*_MAX_LENGTH`).
    #[must_use]
    pub fn active_variable(
        &self,
        program: GLuint,
        index: GLuint,
        max_length: usize,
        uniform: bool,
    ) -> ActiveInfo {
        let mut buffer = vec![0u8; max_length.max(1)];
        let size = sizei(buffer.len()).unwrap_or(GLsizei::MAX);
        let (mut length, mut array_size, mut ty) = (0, 0, 0);
        let gl = self.fns();
        let call = if uniform {
            gl.glGetActiveUniform
        } else {
            gl.glGetActiveAttrib
        };
        // SAFETY: a context is current; the GL writes at most `size` bytes
        // into `buffer` (no larger than it), and one value into each of the
        // three locals.
        unsafe {
            call(
                program,
                index,
                size,
                &raw mut length,
                &raw mut array_size,
                &raw mut ty,
                buffer.as_mut_ptr().cast(),
            );
        };
        ActiveInfo {
            size: array_size,
            ty,
            name: utf8(&buffer, length),
        }
    }

    /// `glBindAttribLocation`.
    pub fn bind_attrib_location(&self, program: GLuint, index: GLuint, name: &CStr) {
        // SAFETY: a context is current; `name` is NUL-terminated and outlives
        // the call.
        unsafe { (self.fns().glBindAttribLocation)(program, index, name.as_ptr()) };
    }

    /// `glGetAttribLocation`.
    #[must_use]
    pub fn attrib_location(&self, program: GLuint, name: &CStr) -> GLint {
        // SAFETY: as for `bind_attrib_location`.
        unsafe { (self.fns().glGetAttribLocation)(program, name.as_ptr()) }
    }

    /// `glGetUniformLocation`.
    #[must_use]
    pub fn uniform_location(&self, program: GLuint, name: &CStr) -> GLint {
        // SAFETY: as for `bind_attrib_location`.
        unsafe { (self.fns().glGetUniformLocation)(program, name.as_ptr()) }
    }

    /// `glGetFragDataLocation` (OpenGL ES 3.0).
    #[must_use]
    pub fn frag_data_location(&self, program: GLuint, name: &CStr) -> GLint {
        // SAFETY: as for `bind_attrib_location`.
        unsafe { (self.fns().glGetFragDataLocation)(program, name.as_ptr()) }
    }

    /// `glUniform{n}{f,i,ui}v` for `data.len() / n` elements. Callers pass a
    /// length that is a non-zero multiple of `n`.
    pub fn uniform_vector(&self, location: GLint, shape: UniformVector, data: UniformData<'_>) {
        let gl = self.fns();
        let (n, len) = match (shape, data) {
            (UniformVector::Float(n), UniformData::Float(d)) => (n, d.len()),
            (UniformVector::Int(n), UniformData::Int(d)) => (n, d.len()),
            (UniformVector::Uint(n), UniformData::Uint(d)) => (n, d.len()),
            _ => return,
        };
        let Some(count) = len.checked_div(usize::from(n)).and_then(sizei) else {
            return;
        };
        macro_rules! call {
            ($f:ident, $d:expr) => {
                // SAFETY: a context is current; the GL reads `count × n`
                // values, at most the slice's length (integer division).
                unsafe { (gl.$f)(location, count, $d.as_ptr()) }
            };
        }
        match (n, data) {
            (1, UniformData::Float(d)) => call!(glUniform1fv, d),
            (2, UniformData::Float(d)) => call!(glUniform2fv, d),
            (3, UniformData::Float(d)) => call!(glUniform3fv, d),
            (4, UniformData::Float(d)) => call!(glUniform4fv, d),
            (1, UniformData::Int(d)) => call!(glUniform1iv, d),
            (2, UniformData::Int(d)) => call!(glUniform2iv, d),
            (3, UniformData::Int(d)) => call!(glUniform3iv, d),
            (4, UniformData::Int(d)) => call!(glUniform4iv, d),
            (1, UniformData::Uint(d)) => call!(glUniform1uiv, d),
            (2, UniformData::Uint(d)) => call!(glUniform2uiv, d),
            (3, UniformData::Uint(d)) => call!(glUniform3uiv, d),
            (4, UniformData::Uint(d)) => call!(glUniform4uiv, d),
            _ => {}
        }
    }

    /// `glUniformMatrix*fv` for `data.len() / components` matrices.
    pub fn uniform_matrix(
        &self,
        location: GLint,
        shape: UniformMatrix,
        transpose: bool,
        data: &[f32],
    ) {
        let gl = self.fns();
        let Some(count) = data.len().checked_div(shape.components()).and_then(sizei) else {
            return;
        };
        let transpose = GLboolean::from(transpose);
        macro_rules! call {
            ($f:ident) => {
                // SAFETY: a context is current; the GL reads `count ×
                // components` floats, at most `data.len()`.
                unsafe { (gl.$f)(location, count, transpose, data.as_ptr()) }
            };
        }
        match shape {
            UniformMatrix::Mat2 => call!(glUniformMatrix2fv),
            UniformMatrix::Mat3 => call!(glUniformMatrix3fv),
            UniformMatrix::Mat4 => call!(glUniformMatrix4fv),
            UniformMatrix::Mat2x3 => call!(glUniformMatrix2x3fv),
            UniformMatrix::Mat2x4 => call!(glUniformMatrix2x4fv),
            UniformMatrix::Mat3x2 => call!(glUniformMatrix3x2fv),
            UniformMatrix::Mat3x4 => call!(glUniformMatrix3x4fv),
            UniformMatrix::Mat4x2 => call!(glUniformMatrix4x2fv),
            UniformMatrix::Mat4x3 => call!(glUniformMatrix4x3fv),
        }
    }

    /// `glGetUniform{f,i,ui}vRobustANGLE` into `out`; returns the number of
    /// values written (0 on error). ANGLE takes these getters' `bufSize` in
    /// bytes.
    #[must_use]
    pub fn get_uniform(&self, program: GLuint, location: GLint, out: UniformOut<'_>) -> usize {
        let gl = self.fns();
        let mut length: GLsizei = 0;
        match out {
            UniformOut::Float(out) => {
                let size = sizei(size_of_val(out)).unwrap_or(GLsizei::MAX);
                // SAFETY: a context is current; the GL writes at most `size`
                // bytes (the slice's size) and one GLsizei.
                unsafe {
                    (gl.glGetUniformfvRobustANGLE)(
                        program,
                        location,
                        size,
                        &raw mut length,
                        out.as_mut_ptr(),
                    );
                };
            }
            UniformOut::Int(out) => {
                let size = sizei(size_of_val(out)).unwrap_or(GLsizei::MAX);
                // SAFETY: as above, for GLints.
                unsafe {
                    (gl.glGetUniformivRobustANGLE)(
                        program,
                        location,
                        size,
                        &raw mut length,
                        out.as_mut_ptr(),
                    );
                };
            }
            UniformOut::Uint(out) => {
                let size = sizei(size_of_val(out)).unwrap_or(GLsizei::MAX);
                // SAFETY: as above, for GLuints.
                unsafe {
                    (gl.glGetUniformuivRobustANGLE)(
                        program,
                        location,
                        size,
                        &raw mut length,
                        out.as_mut_ptr(),
                    );
                };
            }
        }
        usize::try_from(length).unwrap_or(0)
    }

    /// `glVertexAttribPointer` with a buffer offset (client arrays are
    /// disabled, so the pointer argument is an offset into the bound buffer).
    #[allow(clippy::too_many_arguments, reason = "mirrors the GLES signature")]
    pub fn vertex_attrib_pointer(
        &self,
        index: GLuint,
        size: GLint,
        ty: GLenum,
        normalized: bool,
        stride: GLsizei,
        offset: GLintptr,
    ) {
        // SAFETY: a context is current. The context was created with
        // EGL_CONTEXT_CLIENT_ARRAYS_ENABLED_ANGLE false, so the GL treats the
        // pointer as an offset into a buffer object and never dereferences it
        // (with no buffer bound it generates INVALID_OPERATION).
        unsafe {
            (self.fns().glVertexAttribPointer)(
                index,
                size,
                ty,
                GLboolean::from(normalized),
                stride,
                offset as *const c_void,
            );
        };
    }

    /// `glVertexAttribIPointer` (OpenGL ES 3.0) with a buffer offset.
    pub fn vertex_attrib_i_pointer(
        &self,
        index: GLuint,
        size: GLint,
        ty: GLenum,
        stride: GLsizei,
        offset: GLintptr,
    ) {
        // SAFETY: as for `vertex_attrib_pointer`.
        unsafe {
            (self.fns().glVertexAttribIPointer)(index, size, ty, stride, offset as *const c_void);
        };
    }

    /// `glDrawElements` with a buffer offset.
    pub fn draw_elements(&self, mode: GLenum, count: GLsizei, ty: GLenum, offset: GLintptr) {
        // SAFETY: a context is current; with client arrays disabled the
        // pointer is an offset into the bound element array buffer, never
        // dereferenced as client memory (see `vertex_attrib_pointer`).
        unsafe { (self.fns().glDrawElements)(mode, count, ty, offset as *const c_void) };
    }

    /// `glDrawRangeElements` (OpenGL ES 3.0) with a buffer offset.
    pub fn draw_range_elements(
        &self,
        mode: GLenum,
        start: GLuint,
        end: GLuint,
        count: GLsizei,
        ty: GLenum,
        offset: GLintptr,
    ) {
        // SAFETY: as for `draw_elements`.
        unsafe {
            (self.fns().glDrawRangeElements)(mode, start, end, count, ty, offset as *const c_void);
        };
    }

    /// One of the robust `glGetVertexAttrib*v` queries, up to four values.
    #[must_use]
    pub fn vertex_attrib(&self, index: GLuint, pname: GLenum, query: AttribQuery) -> Quad {
        let gl = self.fns();
        let mut length: GLsizei = 0;
        let mut bits = [0u32; 4];
        match query {
            AttribQuery::Float => {
                let mut values = [0f32; 4];
                // SAFETY: a context is current; at most 4 values (bufSize)
                // into `values` and one GLsizei into `length`.
                unsafe {
                    (gl.glGetVertexAttribfvRobustANGLE)(
                        index,
                        pname,
                        4,
                        &raw mut length,
                        values.as_mut_ptr(),
                    );
                };
                bits = values.map(f32::to_bits);
            }
            AttribQuery::Int | AttribQuery::IntegerInt => {
                let mut values = [0i32; 4];
                let f = if query == AttribQuery::Int {
                    gl.glGetVertexAttribivRobustANGLE
                } else {
                    gl.glGetVertexAttribIivRobustANGLE
                };
                // SAFETY: as above, for GLints.
                unsafe { f(index, pname, 4, &raw mut length, values.as_mut_ptr()) };
                bits = values.map(i32::cast_unsigned);
            }
            AttribQuery::IntegerUint => {
                // SAFETY: as above, for GLuints.
                unsafe {
                    (gl.glGetVertexAttribIuivRobustANGLE)(
                        index,
                        pname,
                        4,
                        &raw mut length,
                        bits.as_mut_ptr(),
                    );
                };
            }
        }
        Quad {
            bits,
            len: usize::try_from(length).unwrap_or(0).min(4),
        }
    }

    /// `glGetVertexAttribPointervRobustANGLE` for `VERTEX_ATTRIB_ARRAY_POINTER`:
    /// the attribute's buffer offset.
    #[must_use]
    pub fn vertex_attrib_offset(&self, index: GLuint, pname: GLenum) -> Option<GLintptr> {
        let mut pointer: *mut c_void = ptr::null_mut();
        let mut length: GLsizei = 0;
        // SAFETY: a context is current; the GL writes one pointer-sized value
        // (bufSize 1) into the local and one GLsizei into `length`. The value
        // is an offset and is never dereferenced.
        unsafe {
            (self.fns().glGetVertexAttribPointervRobustANGLE)(
                index,
                pname,
                1,
                &raw mut length,
                &raw mut pointer,
            );
        };
        (length > 0).then_some(pointer as GLintptr)
    }
}

/// Destination of [`Current::get_uniform`].
#[derive(Debug)]
pub enum UniformOut<'a> {
    /// `glGetUniformfv`.
    Float(&'a mut [f32]),
    /// `glGetUniformiv`.
    Int(&'a mut [i32]),
    /// `glGetUniformuiv`.
    Uint(&'a mut [u32]),
}

/// The first `length` bytes of `buffer` as a string (lossily).
fn utf8(buffer: &[u8], length: GLsizei) -> String {
    let end = usize::try_from(length).unwrap_or(0).min(buffer.len());
    String::from_utf8_lossy(buffer.get(..end).unwrap_or(&[])).into_owned()
}
