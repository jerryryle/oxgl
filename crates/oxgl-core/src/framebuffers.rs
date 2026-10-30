//! Framebuffers and renderbuffers (WebGL 1.0 §5.14.6–§5.14.7, WebGL 2.0
//! §3.7.4–§3.7.5). WebGL's `null` framebuffer is the drawing buffer's FBO;
//! WebGL 1 is held to WebGL's own target, format and attachment lists,
//! because oxgl enables ANGLE extensions internally that widen them.

#[allow(
    clippy::wildcard_imports,
    reason = "this module names many GL_ constants"
)]
use oxgl_sys::bindings::*;
use oxgl_sys::{ClearValues, Current, ReadPixels};

use crate::context::{Context, Object, ObjectKey, current};
use crate::drawing_buffer::integers;
use crate::parameters::Parameter;

/// WebGL 1's renderbuffer formats (WebGL 1.0 §5.14.7, §6.6).
const WEBGL1_RENDERBUFFER_FORMATS: [u32; 6] = [
    GL_RGBA4,
    GL_RGB565,
    GL_RGB5_A1,
    GL_DEPTH_COMPONENT16,
    GL_STENCIL_INDEX8,
    GL_DEPTH_STENCIL,
];

/// WebGL 2's renderbuffer formats: OpenGL ES 3.0 §4.4.2's color-, depth- and
/// stencil-renderable sized formats (Table 3.13), and WebGL 2.0 §3.7.5's
/// `DEPTH_STENCIL`.
const WEBGL2_RENDERBUFFER_FORMATS: [u32; 35] = [
    GL_R8,
    GL_R8UI,
    GL_R8I,
    GL_R16UI,
    GL_R16I,
    GL_R32UI,
    GL_R32I,
    GL_RG8,
    GL_RG8UI,
    GL_RG8I,
    GL_RG16UI,
    GL_RG16I,
    GL_RG32UI,
    GL_RG32I,
    GL_RGB8,
    GL_RGB565,
    GL_RGBA8,
    GL_SRGB8_ALPHA8,
    GL_RGB5_A1,
    GL_RGBA4,
    GL_RGB10_A2,
    GL_RGBA8UI,
    GL_RGBA8I,
    GL_RGB10_A2UI,
    GL_RGBA16UI,
    GL_RGBA16I,
    GL_RGBA32I,
    GL_RGBA32UI,
    GL_DEPTH_COMPONENT16,
    GL_DEPTH_COMPONENT24,
    GL_DEPTH_COMPONENT32F,
    GL_DEPTH24_STENCIL8,
    GL_DEPTH32F_STENCIL8,
    GL_STENCIL_INDEX8,
    GL_DEPTH_STENCIL,
];

/// WebGL 1's attachment points (WebGL 1.0 §5.14.6, §6.6).
const WEBGL1_ATTACHMENTS: [u32; 4] = [
    GL_COLOR_ATTACHMENT0,
    GL_DEPTH_ATTACHMENT,
    GL_STENCIL_ATTACHMENT,
    GL_DEPTH_STENCIL_ATTACHMENT,
];

/// Whether `target` is a framebuffer target of the version.
#[must_use]
pub fn is_framebuffer_target(target: u32, webgl2: bool) -> bool {
    target == GL_FRAMEBUFFER
        || (webgl2 && matches!(target, GL_READ_FRAMEBUFFER | GL_DRAW_FRAMEBUFFER))
}

/// Whether `attachment` is an attachment point of the version (WebGL 2's
/// color attachments are checked by ANGLE against `MAX_COLOR_ATTACHMENTS`).
#[must_use]
pub fn is_attachment(attachment: u32, webgl2: bool) -> bool {
    if webgl2 {
        return true;
    }
    WEBGL1_ATTACHMENTS.contains(&attachment)
}

/// The binding query for a framebuffer target.
fn binding_of(target: u32) -> u32 {
    if target == GL_READ_FRAMEBUFFER {
        GL_READ_FRAMEBUFFER_BINDING
    } else {
        GL_DRAW_FRAMEBUFFER_BINDING
    }
}

/// The default-framebuffer buffer names WebGL 2 uses for `invalidate*` and
/// attachment queries, mapped to the drawing buffer FBO's attachments.
fn default_attachment(buffer: u32) -> Option<u32> {
    match buffer {
        GL_COLOR | GL_BACK => Some(GL_COLOR_ATTACHMENT0),
        GL_DEPTH => Some(GL_DEPTH_ATTACHMENT),
        GL_STENCIL => Some(GL_STENCIL_ATTACHMENT),
        _ => None,
    }
}

/// An attachment call: a texture level (2D or a layer) or a renderbuffer.
#[derive(Debug, Clone, Copy)]
pub enum Attach {
    /// `framebufferTexture2D`.
    Texture2D {
        /// `textarget`.
        textarget: u32,
        /// Mipmap level.
        level: i32,
    },
    /// `framebufferTextureLayer`.
    Layer {
        /// Mipmap level.
        level: i32,
        /// Layer.
        layer: i32,
    },
    /// `framebufferRenderbuffer`.
    Renderbuffer {
        /// `renderbuffertarget`.
        target: u32,
    },
}

impl Context {
    /// Whether a WebGL 1 renderbuffer format comes from an enabled extension.
    fn extension_format(&self, format: u32) -> bool {
        let enabled = |name| self.extensions.is_enabled(name);
        if self.webgl2 {
            return match format {
                GL_R16F | GL_RG16F | GL_RGBA16F => {
                    enabled("EXT_color_buffer_float") || enabled("EXT_color_buffer_half_float")
                }
                GL_R16_EXT | GL_RG16_EXT | GL_RGBA16_EXT => enabled("EXT_texture_norm16"),
                GL_R32F | GL_RG32F | GL_RGBA32F | GL_R11F_G11F_B10F => {
                    enabled("EXT_color_buffer_float")
                }
                _ => false,
            };
        }
        match format {
            GL_SRGB8_ALPHA8_EXT => enabled("EXT_sRGB"),
            GL_RGBA16F_EXT | GL_RGB16F_EXT => enabled("EXT_color_buffer_half_float"),
            _ => false,
        }
    }

    /// Whether `format` is a renderbuffer format here: the version's list,
    /// grown by enabled extensions.
    fn renderbuffer_format_allowed(&self, format: u32) -> bool {
        let list: &[u32] = if self.webgl2 {
            &WEBGL2_RENDERBUFFER_FORMATS
        } else {
            &WEBGL1_RENDERBUFFER_FORMATS
        };
        list.contains(&format) || self.extension_format(format)
    }

    /// Whether `attachment` is an attachment point here: WebGL 1's list,
    /// grown by `WEBGL_draw_buffers` (ANGLE checks the maximum).
    fn attachment_allowed(&self, current: &Current<'_>, attachment: u32) -> bool {
        // Color attachment points past MAX_COLOR_ATTACHMENTS are INVALID_ENUM
        // in WebGL, checked here: ANGLE's own error for them would come with
        // a second one from `attach`'s query of the attachment.
        let color = (GL_COLOR_ATTACHMENT0..=GL_COLOR_ATTACHMENT31).contains(&attachment);
        if !color {
            return is_attachment(attachment, self.webgl2);
        }
        if !self.webgl2 && !self.extensions.is_enabled("WEBGL_draw_buffers") {
            return attachment == GL_COLOR_ATTACHMENT0;
        }
        let max = integers(current, GL_MAX_COLOR_ATTACHMENTS).map_or(1, |[max, _]| max);
        attachment - GL_COLOR_ATTACHMENT0 < max.cast_unsigned()
    }

    fn framebuffer_name(&self, key: ObjectKey) -> Option<u32> {
        match self.objects.get(key)? {
            Object::Framebuffer { name } => Some(*name),
            _ => None,
        }
    }

    /// Whether the drawing buffer is bound to `target`'s binding.
    fn default_bound(&self, current: &Current<'_>, target: u32) -> bool {
        self.buffer.is_bound(current, binding_of(target))
    }

    /// `bindFramebuffer`; `null` binds the drawing buffer. Returns whether
    /// the binding changed.
    pub fn bind_framebuffer(&mut self, target: u32, framebuffer: Option<ObjectKey>) -> bool {
        if current(&self.buffer, &mut self.errors).is_none() {
            return false;
        }
        if !is_framebuffer_target(target, self.webgl2) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return false;
        }
        let name = match framebuffer {
            None => self.buffer.framebuffer(),
            Some(key) => {
                if let Some(name) = self.framebuffer_name(key) {
                    name
                } else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return false;
                }
            }
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.bind_framebuffer(target, name);
        }
        true
    }

    /// Rebinds the drawing buffer wherever framebuffer `name` was bound,
    /// before it is deleted (GL would fall back to name 0, which has no
    /// surface here).
    pub(crate) fn unbind_framebuffer(&self, current: &Current<'_>, name: u32) {
        for (pname, target) in [
            (GL_DRAW_FRAMEBUFFER_BINDING, GL_DRAW_FRAMEBUFFER),
            (GL_READ_FRAMEBUFFER_BINDING, GL_READ_FRAMEBUFFER),
        ] {
            if integers(current, pname).map(|[n, _]| n.cast_unsigned()) == Some(name) {
                current.bind_framebuffer(target, self.buffer.framebuffer());
            }
        }
    }

    /// `bindRenderbuffer`; returns whether the binding changed.
    pub fn bind_renderbuffer(&mut self, target: u32, renderbuffer: Option<ObjectKey>) -> bool {
        if current(&self.buffer, &mut self.errors).is_none() {
            return false;
        }
        if target != GL_RENDERBUFFER {
            self.errors.synthesize(GL_INVALID_ENUM);
            return false;
        }
        let name = match renderbuffer {
            None => 0,
            Some(key) => {
                if let Some(Object::Renderbuffer { name, .. }) = self.objects.get(key) {
                    *name
                } else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return false;
                }
            }
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.bind_renderbuffer(target, name);
        }
        self.bound_renderbuffer = renderbuffer;
        true
    }

    /// `renderbufferStorage` (`samples` `None`) or WebGL 2's
    /// `renderbufferStorageMultisample`. `DEPTH_STENCIL` allocates
    /// `DEPTH24_STENCIL8` and is reported back as `DEPTH_STENCIL`.
    pub fn renderbuffer_storage(
        &mut self,
        target: u32,
        format: u32,
        width: i32,
        height: i32,
        samples: Option<i32>,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if target != GL_RENDERBUFFER {
            self.errors.synthesize(GL_INVALID_ENUM);
            return;
        }
        if !self.renderbuffer_format_allowed(format) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return;
        }
        let internal = if format == GL_DEPTH_STENCIL {
            GL_DEPTH24_STENCIL8
        } else {
            format
        };
        match samples {
            None => current.renderbuffer_storage(target, internal, width, height),
            Some(samples) => {
                current.renderbuffer_storage_multisample(target, samples, internal, width, height);
            }
        }
        if let Some(Object::Renderbuffer { depth_stencil, .. }) = self
            .bound_renderbuffer
            .and_then(|key| self.objects.get_mut(key))
        {
            *depth_stencil = format == GL_DEPTH_STENCIL;
        }
    }

    /// `getRenderbufferParameter`.
    pub fn renderbuffer_parameter(&mut self, target: u32, pname: u32) -> Option<i32> {
        let current = current(&self.buffer, &mut self.errors)?;
        // ANGLE also answers pnames of GL extensions enabled for oxgl's own
        // use, such as RENDERBUFFER_SAMPLES on ES 2.0.
        let known = matches!(
            pname,
            GL_RENDERBUFFER_WIDTH
                | GL_RENDERBUFFER_HEIGHT
                | GL_RENDERBUFFER_INTERNAL_FORMAT
                | GL_RENDERBUFFER_RED_SIZE
                | GL_RENDERBUFFER_GREEN_SIZE
                | GL_RENDERBUFFER_BLUE_SIZE
                | GL_RENDERBUFFER_ALPHA_SIZE
                | GL_RENDERBUFFER_DEPTH_SIZE
                | GL_RENDERBUFFER_STENCIL_SIZE
        ) || (pname == GL_RENDERBUFFER_SAMPLES && self.webgl2);
        if !known {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        let value = current.renderbuffer_parameter(target, pname)?;
        let alias = matches!(
            self.bound_renderbuffer
                .and_then(|key| self.objects.get(key)),
            Some(Object::Renderbuffer {
                depth_stencil: true,
                ..
            })
        );
        Some(if pname == GL_RENDERBUFFER_INTERNAL_FORMAT && alias {
            i32::try_from(GL_DEPTH_STENCIL).unwrap_or(value)
        } else {
            value
        })
    }

    /// `framebufferTexture2D`, `framebufferTextureLayer` or
    /// `framebufferRenderbuffer`; `object` is the texture or renderbuffer
    /// (`None` detaches). Returns whether GL now has it attached.
    pub fn attach(
        &mut self,
        target: u32,
        attachment: u32,
        attach: Attach,
        object: Option<ObjectKey>,
    ) -> bool {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        if !is_framebuffer_target(target, self.webgl2)
            || !self.attachment_allowed(&current, attachment)
        {
            self.errors.synthesize(GL_INVALID_ENUM);
            return false;
        }
        if self.default_bound(&current, target) {
            // The default framebuffer has no attachment points.
            self.errors.synthesize(GL_INVALID_OPERATION);
            return false;
        }
        let name = match object.map(|key| self.objects.get(key)) {
            None => 0,
            Some(Some(Object::Texture { name }))
                if !matches!(attach, Attach::Renderbuffer { .. }) =>
            {
                *name
            }
            Some(Some(Object::Renderbuffer { name, .. }))
                if matches!(attach, Attach::Renderbuffer { .. }) =>
            {
                *name
            }
            Some(_) => {
                self.errors.synthesize(GL_INVALID_OPERATION);
                return false;
            }
        };
        match attach {
            Attach::Texture2D { textarget, level } => {
                current.framebuffer_texture_2d(target, attachment, textarget, name, level);
            }
            Attach::Layer { level, layer } => {
                current.framebuffer_texture_layer(target, attachment, name, level, layer);
            }
            Attach::Renderbuffer { target: rb } => {
                current.framebuffer_renderbuffer(target, attachment, rb, name);
            }
        }
        // Ask the type first: querying the name of an empty attachment point
        // is an error in ES 2.0, which must not reach the page.
        let point = if attachment == GL_DEPTH_STENCIL_ATTACHMENT {
            GL_DEPTH_ATTACHMENT
        } else {
            attachment
        };
        let ty = current
            .framebuffer_attachment_parameter(target, point, GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)
            .unwrap_or(0);
        if ty == 0 {
            return name == 0;
        }
        current
            .framebuffer_attachment_parameter(target, point, GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)
            .is_some_and(|attached| attached.cast_unsigned() == name)
    }

    /// `checkFramebufferStatus`.
    pub fn check_framebuffer_status(&mut self, target: u32) -> u32 {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return 0;
        };
        if !is_framebuffer_target(target, self.webgl2) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return 0;
        }
        current.check_framebuffer_status(target)
    }

    /// `getFramebufferAttachmentParameter` for everything but
    /// `FRAMEBUFFER_ATTACHMENT_OBJECT_NAME` of a framebuffer object, which
    /// the TS layer answers from its attachments.
    pub fn framebuffer_attachment_parameter(
        &mut self,
        target: u32,
        attachment: u32,
        pname: u32,
    ) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        if !is_framebuffer_target(target, self.webgl2) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        let number = |v: i32| Some(Parameter::Number(f64::from(v)));
        if !self.default_bound(&current, target) {
            // The default framebuffer's buffer names are not attachments of
            // a framebuffer object (OpenGL ES 3.0 §6.1.13).
            if !self.attachment_allowed(&current, attachment)
                || default_attachment(attachment).is_some()
            {
                self.errors.synthesize(GL_INVALID_ENUM);
                return None;
            }
            // An empty attachment point answers only OBJECT_TYPE and
            // OBJECT_NAME (the TS layer answers the name), whatever else
            // pname is: INVALID_OPERATION on WebGL 2 (OpenGL ES 3.0 §6.1.13),
            // INVALID_ENUM on WebGL 1 (OpenGL ES 2.0 §6.1.3). ANGLE checks
            // pname first. ES 2.0 cannot be asked about DEPTH_STENCIL_ATTACHMENT.
            let es2_depth_stencil = !self.webgl2 && attachment == GL_DEPTH_STENCIL_ATTACHMENT;
            if !es2_depth_stencil
                && pname != GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE
                && pname != GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME
                && current.framebuffer_attachment_parameter(
                    target,
                    attachment,
                    GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
                ) == i32::try_from(GL_NONE).ok()
            {
                self.errors.synthesize(if self.webgl2 {
                    GL_INVALID_OPERATION
                } else {
                    GL_INVALID_ENUM
                });
                return None;
            }
            return number(current.framebuffer_attachment_parameter(target, attachment, pname)?);
        }
        // The drawing buffer, described as a default framebuffer (OpenGL ES
        // 3.0 §6.1.13); ES 2.0 has no queries of framebuffer 0.
        if !self.webgl2 {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return None;
        }
        let Some(mapped) = default_attachment(attachment).filter(|_| attachment != GL_COLOR) else {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        };
        let attributes = self.buffer.attributes();
        let present = match attachment {
            GL_DEPTH => attributes.depth,
            GL_STENCIL => attributes.stencil,
            _ => true,
        };
        match pname {
            GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE => number(
                i32::try_from(if present {
                    GL_FRAMEBUFFER_DEFAULT
                } else {
                    GL_NONE
                })
                .ok()?,
            ),
            GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME => {
                self.errors.synthesize(GL_INVALID_ENUM);
                None
            }
            _ if !present => {
                self.errors.synthesize(GL_INVALID_OPERATION);
                None
            }
            _ => number(current.framebuffer_attachment_parameter(target, mapped, pname)?),
        }
    }

    /// `blitFramebuffer` (WebGL 2), from the resolved drawing buffer when it
    /// is antialiased and bound for reading.
    #[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
    pub fn blit_framebuffer(&mut self, src: [i32; 4], dst: [i32; 4], mask: u32, filter: u32) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let resolved = self.buffer.begin_read(&current);
        let ([sx0, sy0, sx1, sy1], [dx0, dy0, dx1, dy1]) = (src, dst);
        current.blit_framebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter);
        if resolved {
            self.buffer.end_read(&current);
        }
    }

    /// `drawBuffers` (WebGL 2); `BACK`/`NONE` for the drawing buffer.
    pub fn draw_buffers(&mut self, buffers: &[u32]) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let draw = |buffers: &[u32]| {
            if self.webgl2 {
                current.draw_buffers(buffers);
            } else {
                current.draw_buffers_ext(buffers);
            }
        };
        if !self.buffer.is_bound(&current, GL_DRAW_FRAMEBUFFER_BINDING) {
            draw(buffers);
            return;
        }
        let [value] = buffers else {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        };
        match self.buffer.set_buffer(*value, false) {
            Ok(mapped) => draw(&[mapped]),
            Err(code) => self.errors.synthesize(code),
        }
    }

    /// `readBuffer` (WebGL 2); `BACK`/`NONE` for the drawing buffer.
    pub fn read_buffer(&mut self, source: u32) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if !self.buffer.is_bound(&current, GL_READ_FRAMEBUFFER_BINDING) {
            current.read_buffer(source);
            return;
        }
        match self.buffer.set_buffer(source, true) {
            Ok(mapped) => current.read_buffer(mapped),
            Err(code) => self.errors.synthesize(code),
        }
    }

    /// `invalidateFramebuffer`/`invalidateSubFramebuffer` (WebGL 2); the
    /// drawing buffer takes `COLOR`, `DEPTH` and `STENCIL`.
    pub fn invalidate_framebuffer(
        &mut self,
        target: u32,
        attachments: &[u32],
        region: Option<[i32; 4]>,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if !is_framebuffer_target(target, self.webgl2) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return;
        }
        if !self.default_bound(&current, target) {
            current.invalidate_framebuffer(target, attachments, region);
            return;
        }
        let mapped: Option<Vec<u32>> = attachments
            .iter()
            .map(|&a| default_attachment(a).filter(|_| a != GL_BACK))
            .collect();
        match mapped {
            Some(mapped) => current.invalidate_framebuffer(target, &mapped, region),
            None => self.errors.synthesize(GL_INVALID_ENUM),
        }
    }

    /// `clearBuffer{fv,iv,uiv}` (WebGL 2), with at least 4 values for
    /// `COLOR` and 1 for `DEPTH`/`STENCIL` (else `INVALID_VALUE`).
    pub fn clear_buffer(&mut self, buffer: u32, drawbuffer: i32, values: ClearValues<'_>) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let needed = if buffer == GL_COLOR { 4 } else { 1 };
        if values.len() < needed {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        current.clear_buffer(buffer, drawbuffer, values);
    }

    /// `clearBufferfi` (WebGL 2).
    pub fn clear_buffer_fi(&mut self, buffer: u32, drawbuffer: i32, depth: f32, stencil: i32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.clear_buffer_fi(buffer, drawbuffer, depth, stencil);
        }
    }

    /// `getInternalformatParameter` (WebGL 2): `SAMPLES` of a renderbuffer
    /// format, as an `Int32Array` in decreasing order.
    pub fn internalformat_parameter(
        &mut self,
        target: u32,
        format: u32,
        pname: u32,
    ) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        // OpenGL ES 3.0 Table 3.13 also counts unsized RGB and RGBA as
        // color-renderable, though no renderbuffer takes them (deqp queries them).
        let known = self.renderbuffer_format_allowed(format) || matches!(format, GL_RGB | GL_RGBA);
        if target != GL_RENDERBUFFER || pname != GL_SAMPLES || !known {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        let mut count = [0];
        if current.internalformat_parameter(target, format, GL_NUM_SAMPLE_COUNTS, &mut count) == 0 {
            return None;
        }
        let mut samples = vec![0; usize::try_from(count[0]).unwrap_or(0)];
        let written = current.internalformat_parameter(target, format, pname, &mut samples);
        samples.truncate(written);
        Some(Parameter::Int32(samples))
    }

    /// The `readPixels` offset overload (WebGL 2): into the bound pixel pack
    /// buffer, which must exist (`INVALID_OPERATION` otherwise).
    pub fn read_pixels_to_buffer(&mut self, args: ReadPixels, offset: i64) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if !self.pack_buffer_bound(&current) {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        }
        if offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        let resolved = self.buffer.begin_read(&current);
        current.read_pixels_to_buffer(args, offset);
        if resolved {
            self.buffer.end_read(&current);
        }
    }

    /// Whether a buffer is bound to `PIXEL_PACK_BUFFER` (WebGL 2).
    pub(crate) fn pack_buffer_bound(&self, current: &Current<'_>) -> bool {
        self.webgl2 && integers(current, GL_PIXEL_PACK_BUFFER_BINDING).is_some_and(|[n, _]| n != 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webgl1_lists() {
        assert!(is_framebuffer_target(GL_FRAMEBUFFER, false));
        assert!(!is_framebuffer_target(GL_READ_FRAMEBUFFER, false));
        assert!(is_framebuffer_target(GL_READ_FRAMEBUFFER, true));
        assert!(is_attachment(GL_DEPTH_STENCIL_ATTACHMENT, false));
        assert!(!is_attachment(GL_COLOR_ATTACHMENT0 + 1, false));
        assert!(!WEBGL1_RENDERBUFFER_FORMATS.contains(&GL_RGBA8));
    }

    #[test]
    fn default_buffers() {
        assert_eq!(default_attachment(GL_COLOR), Some(GL_COLOR_ATTACHMENT0));
        assert_eq!(default_attachment(GL_DEPTH), Some(GL_DEPTH_ATTACHMENT));
        assert_eq!(default_attachment(GL_COLOR_ATTACHMENT0), None);
    }
}
