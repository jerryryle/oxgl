//! GLES calls that pass values only, or that write a single value into a
//! Rust-owned local, generated as [`Current`] methods. ANGLE validates every
//! argument in WebGL-compatibility mode; none of these calls dereferences
//! client memory.

use crate::bindings::{GLbitfield, GLenum, GLint, GLintptr, GLsizei, GLsizeiptr, GLuint};
use crate::egl::Current;

/// Declares one `Current` method per GLES entry point that takes values only.
macro_rules! value_calls {
    ($($name:ident = $gl:ident($($arg:ident: $ty:ty),*) $(-> $ret:ty)?;)*) => {
        impl Current<'_> {
            $(
                #[doc = concat!("`", stringify!($gl), "`.")]
                #[allow(clippy::too_many_arguments, reason = "mirrors the GLES signature")]
                pub fn $name(&self, $($arg: $ty),*) $(-> $ret)? {
                    // SAFETY: a context is current (type invariant of
                    // `Current`), and the call passes values only, no pointers.
                    unsafe { (self.fns().$gl)($($arg),*) }
                }
            )*
        }
    };
}

/// Declares `gen_*`/`delete_*` methods for one object type's `glGen*`/
/// `glDelete*` pair, always for a single name.
macro_rules! name_calls {
    ($($gen:ident = $glgen:ident, $delete:ident = $gldelete:ident;)*) => {
        impl Current<'_> {
            $(
                #[doc = concat!("`", stringify!($glgen), "` for one name; `0` on failure.")]
                #[must_use]
                pub fn $gen(&self) -> GLuint {
                    let mut name: GLuint = 0;
                    // SAFETY: a context is current; the call writes one GLuint
                    // (n = 1) into the Rust-owned local.
                    unsafe { (self.fns().$glgen)(1, &raw mut name) };
                    name
                }

                #[doc = concat!("`", stringify!($gldelete), "` for one name.")]
                pub fn $delete(&self, name: GLuint) {
                    // SAFETY: a context is current; the call reads one GLuint
                    // (n = 1) from the Rust-owned local.
                    unsafe { (self.fns().$gldelete)(1, &raw const name) };
                }
            )*
        }
    };
}

name_calls! {
    gen_framebuffer = glGenFramebuffers, delete_framebuffer = glDeleteFramebuffers;
    gen_renderbuffer = glGenRenderbuffers, delete_renderbuffer = glDeleteRenderbuffers;
    gen_buffer = glGenBuffers, delete_buffer = glDeleteBuffers;
    gen_texture = glGenTextures, delete_texture = glDeleteTextures;
    gen_sampler = glGenSamplers, delete_sampler = glDeleteSamplers;
    gen_vertex_array = glGenVertexArrays, delete_vertex_array = glDeleteVertexArrays;
    gen_transform_feedback = glGenTransformFeedbacks,
        delete_transform_feedback = glDeleteTransformFeedbacks;
    gen_query = glGenQueries, delete_query = glDeleteQueries;
}

value_calls! {
    bind_vertex_array = glBindVertexArray(array: GLuint);
    is_vertex_array = glIsVertexArray(array: GLuint) -> u8;
    draw_arrays_instanced = glDrawArraysInstanced(
        mode: GLenum, first: GLint, count: GLsizei, instances: GLsizei);
    vertex_attrib_divisor = glVertexAttribDivisor(index: GLuint, divisor: GLuint);
    bind_buffer_base = glBindBufferBase(target: GLenum, index: GLuint, buffer: GLuint);
    bind_buffer_range = glBindBufferRange(
        target: GLenum, index: GLuint, buffer: GLuint, offset: GLintptr, size: GLsizeiptr);
    uniform_block_binding = glUniformBlockBinding(program: GLuint, index: GLuint, binding: GLuint);
    bind_transform_feedback = glBindTransformFeedback(target: GLenum, id: GLuint);
    is_transform_feedback = glIsTransformFeedback(id: GLuint) -> u8;
    begin_transform_feedback = glBeginTransformFeedback(mode: GLenum);
    end_transform_feedback = glEndTransformFeedback();
    pause_transform_feedback = glPauseTransformFeedback();
    resume_transform_feedback = glResumeTransformFeedback();
    begin_query = glBeginQuery(target: GLenum, id: GLuint);
    end_query = glEndQuery(target: GLenum);
    is_query = glIsQuery(id: GLuint) -> u8;
    bind_texture = glBindTexture(target: GLenum, texture: GLuint);
    is_texture = glIsTexture(texture: GLuint) -> u8;
    tex_parameter_i = glTexParameteri(target: GLenum, pname: GLenum, param: GLint);
    tex_parameter_f = glTexParameterf(target: GLenum, pname: GLenum, param: f32);
    generate_mipmap = glGenerateMipmap(target: GLenum);
    copy_tex_image_2d = glCopyTexImage2D(
        target: GLenum, level: GLint, internalformat: GLenum, x: GLint, y: GLint,
        width: GLsizei, height: GLsizei, border: GLint);
    copy_tex_sub_image_2d = glCopyTexSubImage2D(
        target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, x: GLint, y: GLint,
        width: GLsizei, height: GLsizei);
    copy_tex_sub_image_3d = glCopyTexSubImage3D(
        target: GLenum, level: GLint, xoffset: GLint, yoffset: GLint, zoffset: GLint,
        x: GLint, y: GLint, width: GLsizei, height: GLsizei);
    tex_storage_2d = glTexStorage2D(
        target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei);
    tex_storage_3d = glTexStorage3D(
        target: GLenum, levels: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei,
        depth: GLsizei);
    bind_sampler = glBindSampler(unit: GLuint, sampler: GLuint);
    sampler_parameter_i = glSamplerParameteri(sampler: GLuint, pname: GLenum, param: GLint);
    sampler_parameter_f = glSamplerParameterf(sampler: GLuint, pname: GLenum, param: f32);
    bind_buffer = glBindBuffer(target: GLenum, buffer: GLuint);
    copy_buffer_sub_data = glCopyBufferSubData(
        read_target: GLenum, write_target: GLenum, read_offset: GLintptr, write_offset: GLintptr,
        size: GLsizeiptr);
    create_shader = glCreateShader(kind: GLenum) -> GLuint;
    delete_shader = glDeleteShader(shader: GLuint);
    compile_shader = glCompileShader(shader: GLuint);
    create_program = glCreateProgram() -> GLuint;
    delete_program = glDeleteProgram(program: GLuint);
    attach_shader = glAttachShader(program: GLuint, shader: GLuint);
    detach_shader = glDetachShader(program: GLuint, shader: GLuint);
    link_program = glLinkProgram(program: GLuint);
    use_program = glUseProgram(program: GLuint);
    validate_program = glValidateProgram(program: GLuint);
    enable_vertex_attrib_array = glEnableVertexAttribArray(index: GLuint);
    disable_vertex_attrib_array = glDisableVertexAttribArray(index: GLuint);
    vertex_attrib_4f = glVertexAttrib4f(index: GLuint, x: f32, y: f32, z: f32, w: f32);
    vertex_attrib_i4i = glVertexAttribI4i(index: GLuint, x: GLint, y: GLint, z: GLint, w: GLint);
    vertex_attrib_i4ui = glVertexAttribI4ui(
        index: GLuint, x: GLuint, y: GLuint, z: GLuint, w: GLuint);
    draw_arrays = glDrawArrays(mode: GLenum, first: GLint, count: GLsizei);
    uniform_1f = glUniform1f(location: GLint, x: f32);
    uniform_2f = glUniform2f(location: GLint, x: f32, y: f32);
    uniform_3f = glUniform3f(location: GLint, x: f32, y: f32, z: f32);
    uniform_4f = glUniform4f(location: GLint, x: f32, y: f32, z: f32, w: f32);
    uniform_1i = glUniform1i(location: GLint, x: GLint);
    uniform_2i = glUniform2i(location: GLint, x: GLint, y: GLint);
    uniform_3i = glUniform3i(location: GLint, x: GLint, y: GLint, z: GLint);
    uniform_4i = glUniform4i(location: GLint, x: GLint, y: GLint, z: GLint, w: GLint);
    uniform_1ui = glUniform1ui(location: GLint, x: GLuint);
    uniform_2ui = glUniform2ui(location: GLint, x: GLuint, y: GLuint);
    uniform_3ui = glUniform3ui(location: GLint, x: GLuint, y: GLuint, z: GLuint);
    uniform_4ui = glUniform4ui(location: GLint, x: GLuint, y: GLuint, z: GLuint, w: GLuint);
    bind_framebuffer = glBindFramebuffer(target: GLenum, framebuffer: GLuint);
    is_framebuffer = glIsFramebuffer(framebuffer: GLuint) -> u8;
    is_renderbuffer = glIsRenderbuffer(renderbuffer: GLuint) -> u8;
    framebuffer_texture_2d = glFramebufferTexture2D(
        target: GLenum, attachment: GLenum, textarget: GLenum, texture: GLuint, level: GLint);
    framebuffer_texture_layer = glFramebufferTextureLayer(
        target: GLenum, attachment: GLenum, texture: GLuint, level: GLint, layer: GLint);
    read_buffer = glReadBuffer(src: GLenum);
    clear_buffer_fi = glClearBufferfi(buffer: GLenum, drawbuffer: GLint, depth: f32, stencil: GLint);
    bind_renderbuffer = glBindRenderbuffer(target: GLenum, renderbuffer: GLuint);
    renderbuffer_storage = glRenderbufferStorage(
        target: GLenum, internalformat: GLenum, width: GLsizei, height: GLsizei);
    renderbuffer_storage_multisample = glRenderbufferStorageMultisample(
        target: GLenum, samples: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei);
    renderbuffer_storage_multisample_angle = glRenderbufferStorageMultisampleANGLE(
        target: GLenum, samples: GLsizei, internalformat: GLenum, width: GLsizei, height: GLsizei);
    framebuffer_renderbuffer = glFramebufferRenderbuffer(
        target: GLenum, attachment: GLenum, renderbuffertarget: GLenum, renderbuffer: GLuint);
    check_framebuffer_status = glCheckFramebufferStatus(target: GLenum) -> GLenum;
    blit_framebuffer = glBlitFramebuffer(
        src_x0: GLint, src_y0: GLint, src_x1: GLint, src_y1: GLint,
        dst_x0: GLint, dst_y0: GLint, dst_x1: GLint, dst_y1: GLint,
        mask: GLbitfield, filter: GLenum);
    blit_framebuffer_angle = glBlitFramebufferANGLE(
        src_x0: GLint, src_y0: GLint, src_x1: GLint, src_y1: GLint,
        dst_x0: GLint, dst_y0: GLint, dst_x1: GLint, dst_y1: GLint,
        mask: GLbitfield, filter: GLenum);
}
