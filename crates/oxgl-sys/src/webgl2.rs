//! WebGL 2 calls that take arrays, names or sync handles. Arrays are Rust
//! slices passed with their lengths, names are `CStr`s that outlive the
//! call, and results go into Rust-owned buffers bounded by robust sizes or
//! the matching length queries.

use std::ffi::{CStr, c_char, c_void};

use crate::bindings::{GLenum, GLint, GLint64, GLsizei, GLsync, GLuint, GLuint64};
use crate::egl::Current;
use crate::pointers::ActiveInfo;

/// A GL sync object, usable only through [`Current`] methods. It is a
/// pointer-typed GL handle; the field is private so other crates can store
/// and copy it but never forge one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncHandle(usize);

fn len(n: usize) -> Option<GLsizei> {
    GLsizei::try_from(n).ok()
}

/// The first `length` bytes of `buffer` as a string (lossily).
fn text(buffer: &[u8], length: GLsizei) -> String {
    let end = usize::try_from(length).unwrap_or(0).min(buffer.len());
    String::from_utf8_lossy(buffer.get(..end).unwrap_or(&[])).into_owned()
}

impl Current<'_> {
    /// `glDrawElementsInstanced` with a buffer offset.
    pub fn draw_elements_instanced(
        &self,
        mode: GLenum,
        count: GLsizei,
        ty: GLenum,
        offset: i64,
        instances: GLsizei,
    ) {
        // SAFETY: a context is current; client arrays are disabled, so the
        // pointer is an offset into the bound element array buffer and never
        // dereferenced as client memory.
        unsafe {
            (self.fns().glDrawElementsInstanced)(
                mode,
                count,
                ty,
                offset as *const c_void,
                instances,
            );
        };
    }

    /// `glDrawElementsInstancedANGLE` (ES 2.0) with a buffer offset.
    pub fn draw_elements_instanced_angle(
        &self,
        mode: GLenum,
        count: GLsizei,
        ty: GLenum,
        offset: i64,
        instances: GLsizei,
    ) {
        // SAFETY: as for `draw_elements_instanced`.
        unsafe {
            (self.fns().glDrawElementsInstancedANGLE)(
                mode,
                count,
                ty,
                offset as *const c_void,
                instances,
            );
        };
    }

    /// `glDrawBuffersEXT` (ES 2.0, `GL_EXT_draw_buffers`).
    pub fn draw_buffers_ext(&self, buffers: &[GLenum]) {
        let Some(n) = len(buffers.len()) else { return };
        // SAFETY: a context is current; the GL reads `n` enums, the slice's
        // length.
        unsafe { (self.fns().glDrawBuffersEXT)(n, buffers.as_ptr()) };
    }

    /// `glMultiDrawArrays[Instanced]ANGLE` over equal-length slices
    /// (`instances` empty for the non-instanced form).
    pub fn multi_draw_arrays(
        &self,
        mode: GLenum,
        firsts: &[GLint],
        counts: &[GLsizei],
        instances: &[GLsizei],
    ) {
        if firsts.len() != counts.len()
            || !(instances.is_empty() || instances.len() == counts.len())
        {
            return;
        }
        let Some(n) = len(counts.len()) else { return };
        let gl = self.fns();
        if instances.is_empty() {
            // SAFETY: a context is current; the GL reads `n` values from each
            // slice, all of length `n` (checked above).
            unsafe { (gl.glMultiDrawArraysANGLE)(mode, firsts.as_ptr(), counts.as_ptr(), n) };
        } else {
            // SAFETY: as above, for three slices of length `n`.
            unsafe {
                (gl.glMultiDrawArraysInstancedANGLE)(
                    mode,
                    firsts.as_ptr(),
                    counts.as_ptr(),
                    instances.as_ptr(),
                    n,
                );
            };
        }
    }

    /// `glMultiDrawElements[Instanced]ANGLE` over equal-length slices of
    /// counts and buffer offsets (`instances` empty for the non-instanced
    /// form). Client arrays are disabled, so offsets index the bound
    /// element array buffer and are never dereferenced as memory.
    pub fn multi_draw_elements(
        &self,
        mode: GLenum,
        counts: &[GLsizei],
        ty: GLenum,
        offsets: &[i64],
        instances: &[GLsizei],
    ) {
        if offsets.len() != counts.len()
            || !(instances.is_empty() || instances.len() == counts.len())
        {
            return;
        }
        let Some(n) = len(counts.len()) else { return };
        let pointers: Vec<*const c_void> = offsets.iter().map(|&o| o as *const c_void).collect();
        let gl = self.fns();
        if instances.is_empty() {
            // SAFETY: a context is current; the GL reads `n` counts and `n`
            // offset pointers (never dereferenced, see above).
            unsafe {
                (gl.glMultiDrawElementsANGLE)(mode, counts.as_ptr(), ty, pointers.as_ptr(), n);
            };
        } else {
            // SAFETY: as above, plus `n` instance counts.
            unsafe {
                (gl.glMultiDrawElementsInstancedANGLE)(
                    mode,
                    counts.as_ptr(),
                    ty,
                    pointers.as_ptr(),
                    instances.as_ptr(),
                    n,
                );
            };
        }
    }

    /// `glGetTranslatedShaderSourceANGLE`, with a buffer sized from
    /// `TRANSLATED_SHADER_SOURCE_LENGTH_ANGLE`.
    #[must_use]
    pub fn translated_shader_source(&self, shader: GLuint, max_length: usize) -> String {
        let mut buffer = vec![0u8; max_length.max(1)];
        let size = len(buffer.len()).unwrap_or(GLsizei::MAX);
        let mut length = 0;
        // SAFETY: a context is current; at most `size` bytes into `buffer`
        // and one GLsizei.
        unsafe {
            (self.fns().glGetTranslatedShaderSourceANGLE)(
                shader,
                size,
                &raw mut length,
                buffer.as_mut_ptr().cast(),
            );
        };
        text(&buffer, length)
    }

    /// `glGetInteger64i_vRobustANGLE`: up to four values (`COLOR_WRITEMASK`
    /// has four), empty after an error.
    #[must_use]
    pub fn integer64_indexed(&self, target: GLenum, index: GLuint) -> Vec<GLint64> {
        let mut values = [0; 4];
        let mut length = 0;
        // SAFETY: a context is current; at most four GLint64 (bufSize 4)
        // into the local array and one GLsizei into `length`.
        unsafe {
            (self.fns().glGetInteger64i_vRobustANGLE)(
                target,
                index,
                4,
                &raw mut length,
                values.as_mut_ptr(),
            );
        };
        values
            .into_iter()
            .take(usize::try_from(length).unwrap_or(0))
            .collect()
    }

    /// `glGetUniformBlockIndex`.
    #[must_use]
    pub fn uniform_block_index(&self, program: GLuint, name: &CStr) -> GLuint {
        // SAFETY: a context is current; `name` is NUL-terminated and outlives
        // the call.
        unsafe { (self.fns().glGetUniformBlockIndex)(program, name.as_ptr()) }
    }

    /// `glGetUniformIndices` for `names`, into `out` (same length).
    pub fn uniform_indices(&self, program: GLuint, names: &[&CStr], out: &mut [GLuint]) {
        if names.len() != out.len() {
            return;
        }
        let Some(count) = len(names.len()) else {
            return;
        };
        let pointers: Vec<*const c_char> = names.iter().map(|n| n.as_ptr()).collect();
        // SAFETY: a context is current; the GL reads `count` pointers to
        // NUL-terminated strings that outlive the call, and writes `count`
        // GLuints into `out`, which has that length.
        unsafe {
            (self.fns().glGetUniformIndices)(program, count, pointers.as_ptr(), out.as_mut_ptr());
        };
    }

    /// `glGetActiveUniformsiv` for `indices`, into `out` (same length).
    pub fn active_uniforms(
        &self,
        program: GLuint,
        indices: &[GLuint],
        pname: GLenum,
        out: &mut [GLint],
    ) {
        if indices.len() != out.len() {
            return;
        }
        let Some(count) = len(indices.len()) else {
            return;
        };
        // SAFETY: a context is current; the GL reads `count` indices and
        // writes `count` GLints, both slices of that length.
        unsafe {
            (self.fns().glGetActiveUniformsiv)(
                program,
                count,
                indices.as_ptr(),
                pname,
                out.as_mut_ptr(),
            );
        };
    }

    /// `glGetActiveUniformBlockivRobustANGLE` into `out`; values written.
    pub fn active_uniform_block(
        &self,
        program: GLuint,
        index: GLuint,
        pname: GLenum,
        out: &mut [GLint],
    ) -> usize {
        let size = len(out.len()).unwrap_or(GLsizei::MAX);
        let mut length = 0;
        // SAFETY: a context is current; at most `size` GLints (the slice's
        // length) and one GLsizei.
        unsafe {
            (self.fns().glGetActiveUniformBlockivRobustANGLE)(
                program,
                index,
                pname,
                size,
                &raw mut length,
                out.as_mut_ptr(),
            );
        };
        usize::try_from(length).unwrap_or(0).min(out.len())
    }

    /// `glGetActiveUniformBlockName` with a buffer of `max_length` bytes.
    #[must_use]
    pub fn active_uniform_block_name(
        &self,
        program: GLuint,
        index: GLuint,
        max_length: usize,
    ) -> String {
        let mut buffer = vec![0u8; max_length.max(1)];
        let size = len(buffer.len()).unwrap_or(GLsizei::MAX);
        let mut length = 0;
        // SAFETY: a context is current; at most `size` bytes into `buffer`
        // and one GLsizei.
        unsafe {
            (self.fns().glGetActiveUniformBlockName)(
                program,
                index,
                size,
                &raw mut length,
                buffer.as_mut_ptr().cast(),
            );
        };
        text(&buffer, length)
    }

    /// `glTransformFeedbackVaryings`.
    pub fn transform_feedback_varyings(&self, program: GLuint, names: &[&CStr], mode: GLenum) {
        let Some(count) = len(names.len()) else {
            return;
        };
        let pointers: Vec<*const c_char> = names.iter().map(|n| n.as_ptr()).collect();
        // SAFETY: a context is current; the GL reads `count` pointers to
        // NUL-terminated strings, all outliving the call.
        unsafe {
            (self.fns().glTransformFeedbackVaryings)(program, count, pointers.as_ptr(), mode);
        };
    }

    /// `glGetTransformFeedbackVarying` with a name buffer of `max_length`
    /// bytes.
    #[must_use]
    pub fn transform_feedback_varying(
        &self,
        program: GLuint,
        index: GLuint,
        max_length: usize,
    ) -> ActiveInfo {
        let mut buffer = vec![0u8; max_length.max(1)];
        let size = len(buffer.len()).unwrap_or(GLsizei::MAX);
        let (mut length, mut array_size, mut ty) = (0, 0, 0);
        // SAFETY: a context is current; at most `size` bytes into `buffer`
        // and one value into each local.
        unsafe {
            (self.fns().glGetTransformFeedbackVarying)(
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
            name: text(&buffer, length),
        }
    }

    /// `glGetQueryObjectuivRobustANGLE` for one value.
    #[must_use]
    pub fn query_object(&self, id: GLuint, pname: GLenum) -> Option<GLuint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: a context is current; one GLuint (bufSize 1) and one
        // GLsizei into locals.
        unsafe {
            (self.fns().glGetQueryObjectuivRobustANGLE)(
                id,
                pname,
                1,
                &raw mut length,
                &raw mut value,
            );
        };
        (length > 0).then_some(value)
    }

    /// `glGetQueryivRobustANGLE` for one value (`CURRENT_QUERY`).
    #[must_use]
    pub fn query_state(&self, target: GLenum, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: a context is current; one GLint (bufSize 1) and one
        // GLsizei into locals.
        unsafe {
            (self.fns().glGetQueryivRobustANGLE)(target, pname, 1, &raw mut length, &raw mut value);
        };
        (length > 0).then_some(value)
    }

    /// `glFenceSync`; `None` on failure.
    #[must_use]
    pub fn fence_sync(&self, condition: GLenum, flags: u32) -> Option<SyncHandle> {
        // SAFETY: a context is current; value arguments only.
        let sync = unsafe { (self.fns().glFenceSync)(condition, flags) };
        (!sync.is_null()).then_some(SyncHandle(sync as usize))
    }

    fn sync(handle: SyncHandle) -> GLsync {
        handle.0 as GLsync
    }

    /// `glDeleteSync`. The handle must not be used again.
    pub fn delete_sync(&self, sync: SyncHandle) {
        // SAFETY: a context is current; the handle came from `fence_sync` on
        // this context and is deleted once (it is removed from oxgl's table
        // first). ANGLE validates it regardless.
        unsafe { (self.fns().glDeleteSync)(Self::sync(sync)) };
    }

    /// `glIsSync`.
    #[must_use]
    pub fn is_sync(&self, sync: SyncHandle) -> bool {
        // SAFETY: a context is current; ANGLE looks the handle up and never
        // dereferences an unknown one.
        unsafe { (self.fns().glIsSync)(Self::sync(sync)) != 0 }
    }

    /// `glClientWaitSync`.
    #[must_use]
    pub fn client_wait_sync(&self, sync: SyncHandle, flags: u32, timeout: GLuint64) -> GLenum {
        // SAFETY: as for `is_sync`; value arguments otherwise.
        unsafe { (self.fns().glClientWaitSync)(Self::sync(sync), flags, timeout) }
    }

    /// `glWaitSync`.
    pub fn wait_sync(&self, sync: SyncHandle, flags: u32, timeout: GLuint64) {
        // SAFETY: as for `is_sync`.
        unsafe { (self.fns().glWaitSync)(Self::sync(sync), flags, timeout) };
    }

    /// `glGetSynciv` for one value.
    #[must_use]
    pub fn sync_parameter(&self, sync: SyncHandle, pname: GLenum) -> Option<GLint> {
        let (mut value, mut length) = (0, 0);
        // SAFETY: as for `is_sync`; at most one GLint (bufSize 1) into the
        // local and one GLsizei.
        unsafe {
            (self.fns().glGetSynciv)(Self::sync(sync), pname, 1, &raw mut length, &raw mut value);
        };
        (length > 0).then_some(value)
    }
}
