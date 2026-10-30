//! Texture uploads and queries. Client-memory uploads use the robust
//! (`…RobustANGLE`) entry points, which take the slice's length and generate
//! `GL_INVALID_OPERATION` rather than read past it; compressed uploads pass
//! the slice's length as `imageSize`, which the GL reads exactly. Pixel-unpack-buffer
//! uploads pass an offset that the GL never dereferences as client memory;
//! callers make them only while a pixel unpack buffer is bound.

use std::ffi::c_void;
use std::ptr;

use crate::bindings::{GLenum, GLint, GLintptr, GLsizei, GLuint};
use crate::egl::Current;

/// The region and format of a texture upload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TexImage {
    /// Texture target (or cube face).
    pub target: GLenum,
    /// Mipmap level.
    pub level: GLint,
    /// Internal format (`texImage*`) — ignored by `texSubImage*`.
    pub internal_format: GLint,
    /// X offset (`texSubImage*`).
    pub x: GLint,
    /// Y offset (`texSubImage*`).
    pub y: GLint,
    /// Z offset (`texSubImage3D`).
    pub z: GLint,
    /// Width.
    pub width: GLsizei,
    /// Height.
    pub height: GLsizei,
    /// Depth (3D only).
    pub depth: GLsizei,
    /// Border (must be 0).
    pub border: GLint,
    /// Pixel format.
    pub format: GLenum,
    /// Pixel type.
    pub ty: GLenum,
}

/// Which upload call a [`TexImage`] goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upload {
    /// `texImage2D`.
    Image2D,
    /// `texSubImage2D`.
    SubImage2D,
    /// `texImage3D`.
    Image3D,
    /// `texSubImage3D`.
    SubImage3D,
}

/// Where compressed data comes from.
#[derive(Debug, Clone, Copy)]
pub enum CompressedData<'a> {
    /// Client memory; its length is the image size.
    Client(&'a [u8]),
    /// `size` bytes at an offset into the bound pixel unpack buffer.
    UnpackBuffer {
        /// The byte offset.
        offset: GLintptr,
        /// The image size in bytes.
        size: GLsizei,
    },
}

/// Where the pixels come from.
#[derive(Debug, Clone, Copy)]
pub enum UploadData<'a> {
    /// Client memory (`None`: no data, zero-filled storage for `texImage*`).
    Client(Option<&'a [u8]>),
    /// An offset into the bound pixel unpack buffer.
    UnpackBuffer(GLintptr),
}

impl Current<'_> {
    /// One texture upload. For [`UploadData::UnpackBuffer`] the caller must
    /// have checked that a pixel unpack buffer is bound.
    pub fn tex_upload(&self, call: Upload, args: TexImage, data: UploadData<'_>) {
        let gl = self.fns();
        let a = args;
        let (size, pixels): (GLsizei, *const c_void) = match data {
            UploadData::Client(Some(bytes)) => match GLsizei::try_from(bytes.len()) {
                Ok(size) => (size, bytes.as_ptr().cast()),
                Err(_) => return,
            },
            UploadData::Client(None) => (0, ptr::null()),
            UploadData::UnpackBuffer(offset) => (0, offset as *const c_void),
        };
        /// Issues one upload entry point.
        macro_rules! call {
            ($f:ident($($arg:expr),*)) => {
                // SAFETY: a context is current. For client memory `pixels` is
                // null or points at `size` readable bytes of a Rust slice, and
                // the robust entry point reads at most `size` bytes (it
                // generates INVALID_OPERATION when the unpack parameters would
                // need more). For a pixel unpack buffer, which the caller has
                // bound, `pixels` is an offset the GL validates against that
                // buffer and never dereferences.
                unsafe { (gl.$f)($($arg),*) }
            };
        }
        let robust = matches!(data, UploadData::Client(_));
        match (call, robust) {
            (Upload::Image2D, true) => call!(glTexImage2DRobustANGLE(
                a.target,
                a.level,
                a.internal_format,
                a.width,
                a.height,
                a.border,
                a.format,
                a.ty,
                size,
                pixels
            )),
            (Upload::SubImage2D, true) => call!(glTexSubImage2DRobustANGLE(
                a.target, a.level, a.x, a.y, a.width, a.height, a.format, a.ty, size, pixels
            )),
            (Upload::Image3D, true) => call!(glTexImage3DRobustANGLE(
                a.target,
                a.level,
                a.internal_format,
                a.width,
                a.height,
                a.depth,
                a.border,
                a.format,
                a.ty,
                size,
                pixels
            )),
            (Upload::SubImage3D, true) => call!(glTexSubImage3DRobustANGLE(
                a.target, a.level, a.x, a.y, a.z, a.width, a.height, a.depth, a.format, a.ty, size,
                pixels
            )),
            (Upload::Image2D, false) => call!(glTexImage2D(
                a.target,
                a.level,
                a.internal_format,
                a.width,
                a.height,
                a.border,
                a.format,
                a.ty,
                pixels
            )),
            (Upload::SubImage2D, false) => call!(glTexSubImage2D(
                a.target, a.level, a.x, a.y, a.width, a.height, a.format, a.ty, pixels
            )),
            (Upload::Image3D, false) => call!(glTexImage3D(
                a.target,
                a.level,
                a.internal_format,
                a.width,
                a.height,
                a.depth,
                a.border,
                a.format,
                a.ty,
                pixels
            )),
            (Upload::SubImage3D, false) => call!(glTexSubImage3D(
                a.target, a.level, a.x, a.y, a.z, a.width, a.height, a.depth, a.format, a.ty,
                pixels
            )),
        }
    }

    /// A compressed upload (`format` is the internal format for `Image*`,
    /// the format for `SubImage*`). For [`CompressedData::UnpackBuffer`] the
    /// caller must have checked that a pixel unpack buffer is bound.
    pub fn compressed_tex_upload(&self, call: Upload, args: TexImage, data: CompressedData<'_>) {
        let gl = self.fns();
        let a = args;
        let (size, pixels): (GLsizei, *const c_void) = match data {
            CompressedData::Client(bytes) => match GLsizei::try_from(bytes.len()) {
                Ok(size) => (size, bytes.as_ptr().cast()),
                Err(_) => return,
            },
            CompressedData::UnpackBuffer { offset, size } => (size, offset as *const c_void),
        };
        let internal = a.internal_format.cast_unsigned();
        /// Issues one compressed upload entry point.
        macro_rules! call {
            ($f:ident($($arg:expr),*)) => {
                // SAFETY: a context is current. From client memory the GL
                // reads exactly `imageSize` bytes, the slice's length
                // (INVALID_VALUE, reading nothing, when that does not match
                // the format). From a pixel unpack buffer, which the caller
                // has bound, `pixels` is an offset the GL validates against
                // that buffer and never dereferences.
                unsafe { (gl.$f)($($arg),*) }
            };
        }
        match call {
            Upload::Image2D => call!(glCompressedTexImage2D(
                a.target, a.level, internal, a.width, a.height, a.border, size, pixels
            )),
            Upload::SubImage2D => call!(glCompressedTexSubImage2D(
                a.target, a.level, a.x, a.y, a.width, a.height, a.format, size, pixels
            )),
            Upload::Image3D => call!(glCompressedTexImage3D(
                a.target, a.level, internal, a.width, a.height, a.depth, a.border, size, pixels
            )),
            Upload::SubImage3D => call!(glCompressedTexSubImage3D(
                a.target, a.level, a.x, a.y, a.z, a.width, a.height, a.depth, a.format, size,
                pixels
            )),
        }
    }

    /// `glGetTexParameter{i,f}vRobustANGLE` (`float` selects the float
    /// query) for one value, as `f64`.
    #[must_use]
    pub fn tex_parameter(&self, target: GLenum, pname: GLenum, float: bool) -> Option<f64> {
        let gl = self.fns();
        let mut length: GLsizei = 0;
        if float {
            let mut value = 0f32;
            // SAFETY: a context is current; at most one value (bufSize 1)
            // into the local and one GLsizei into `length`.
            unsafe {
                (gl.glGetTexParameterfvRobustANGLE)(
                    target,
                    pname,
                    1,
                    &raw mut length,
                    &raw mut value,
                );
            };
            (length > 0).then_some(f64::from(value))
        } else {
            let mut value: GLint = 0;
            // SAFETY: as above, for a GLint.
            unsafe {
                (gl.glGetTexParameterivRobustANGLE)(
                    target,
                    pname,
                    1,
                    &raw mut length,
                    &raw mut value,
                );
            };
            (length > 0).then_some(f64::from(value))
        }
    }

    /// `glGetSamplerParameter{i,f}vRobustANGLE` for one value, as `f64`.
    #[must_use]
    pub fn sampler_parameter(&self, sampler: GLuint, pname: GLenum, float: bool) -> Option<f64> {
        let gl = self.fns();
        let mut length: GLsizei = 0;
        if float {
            let mut value = 0f32;
            // SAFETY: as for `tex_parameter`.
            unsafe {
                (gl.glGetSamplerParameterfvRobustANGLE)(
                    sampler,
                    pname,
                    1,
                    &raw mut length,
                    &raw mut value,
                );
            };
            (length > 0).then_some(f64::from(value))
        } else {
            let mut value: GLint = 0;
            // SAFETY: as for `tex_parameter`.
            unsafe {
                (gl.glGetSamplerParameterivRobustANGLE)(
                    sampler,
                    pname,
                    1,
                    &raw mut length,
                    &raw mut value,
                );
            };
            (length > 0).then_some(f64::from(value))
        }
    }
}
