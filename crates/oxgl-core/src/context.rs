//! A WebGL context: its drawing buffer, error state, and objects.

use oxgl_sys::bindings::{
    GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT, GL_FRAGMENT_SHADER, GL_GUILTY_CONTEXT_RESET_EXT,
    GL_HIGH_INT, GL_INNOCENT_CONTEXT_RESET_EXT, GL_INVALID_ENUM, GL_INVALID_OPERATION,
    GL_INVALID_VALUE, GL_LOW_FLOAT, GL_MAX_RENDERBUFFER_SIZE, GL_MAX_VIEWPORT_DIMS, GL_NO_ERROR,
    GL_PACK_ALIGNMENT, GL_PACK_ROW_LENGTH, GL_PACK_SKIP_PIXELS, GL_PACK_SKIP_ROWS,
    GL_SHADING_LANGUAGE_VERSION, GL_STENCIL_BUFFER_BIT, GL_VERSION, GL_VERTEX_SHADER,
};
use oxgl_sys::{
    ClientVersion, Current, Display, GlContext, PixelDestination, PrecisionFormat, ReadPixels,
    StateCall, ValueType, Values,
};
use slotmap::{SlotMap, new_key_type};

use crate::backend::ContextRequest;
use crate::error::ErrorState;
use crate::parameters::{self, Kind, Parameter};
use crate::pixels;
use crate::state::{PixelStore, UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL, UnpackState};

new_key_type! {
    /// Generational handle of a WebGL object within its context.
    pub struct ObjectKey;
}

/// A WebGL object owned by a context. Later capabilities add variants
/// (buffers, textures, …).
#[allow(
    clippy::empty_enums,
    reason = "no object types exist yet; the slotmap is their extension point"
)]
#[derive(Debug)]
pub enum Object {}

/// The drawing buffer: an EGL pbuffer with its context (WebGL 1.0 §2.2). The
/// pbuffer is an internal choice; a framebuffer object can replace it without
/// changing this type's interface.
#[derive(Debug)]
pub struct DrawingBuffer {
    context: GlContext,
    width: i32,
    height: i32,
}

impl DrawingBuffer {
    /// Creates a context on `display` with a buffer of the requested size, or
    /// smaller with the same aspect ratio when that exceeds the
    /// implementation's limits.
    ///
    /// # Errors
    ///
    /// The failing EGL call, for example when the display cannot create an
    /// OpenGL ES 3.0 context.
    pub fn new(display: &Display, request: &ContextRequest) -> Result<Self, String> {
        let version = if request.webgl2 {
            ClientVersion::Es3
        } else {
            ClientVersion::Es2
        };
        let mut context = display.create_context(version).map_err(|e| e.to_string())?;
        let (renderbuffer, viewport) = {
            let current = context.make_current().map_err(|e| e.to_string())?;
            (
                integers(&current, GL_MAX_RENDERBUFFER_SIZE),
                integers(&current, GL_MAX_VIEWPORT_DIMS),
            )
        };
        let limits = renderbuffer
            .zip(viewport)
            .zip(context.max_pbuffer_size())
            .map(
                |(([renderbuffer, _], [viewport_width, viewport_height]), (pw, ph))| {
                    (
                        pw.min(renderbuffer).min(viewport_width),
                        ph.min(renderbuffer).min(viewport_height),
                    )
                },
            );
        let Some((max_width, max_height)) = limits.filter(|&(w, h)| w > 0 && h > 0) else {
            return Err("cannot query the drawing buffer size limits".into());
        };
        let (width, height) = clamp_size(request.width, request.height, max_width, max_height);
        context
            .attach_pbuffer(width, height)
            .map_err(|e| e.to_string())?;
        // A new pbuffer's contents are undefined; the drawing buffer starts
        // transparent black (WebGL 1.0 §2.2). The context is fresh, so the
        // clear values are still their defaults (0,0,0,0, depth 1, stencil 0).
        // The context was first made current without a surface, which left
        // its viewport and scissor box at 0×0; both start at the drawing
        // buffer's size (WebGL 1.0 §5.14.4).
        {
            let current = context.make_current().map_err(|e| e.to_string())?;
            current.apply(StateCall::Viewport(0, 0, width, height));
            current.apply(StateCall::Scissor(0, 0, width, height));
            current.clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
        }
        Ok(Self {
            context,
            width,
            height,
        })
    }

    /// Actual width in pixels.
    #[must_use]
    pub fn width(&self) -> i32 {
        self.width
    }

    /// Actual height in pixels.
    #[must_use]
    pub fn height(&self) -> i32 {
        self.height
    }
}

/// Scales `width`×`height` down to fit `max_width`×`max_height`, preserving
/// the aspect ratio (WebGL 1.0 §2.2). Results are at least 1.
#[must_use]
pub fn clamp_size(width: f64, height: f64, max_width: i32, max_height: i32) -> (i32, i32) {
    let scale = (f64::from(max_width) / width)
        .min(f64::from(max_height) / height)
        .min(1.0);
    let fit = |value: f64, max: i32| {
        // In 1..=max by construction (and `as` saturates regardless).
        #[allow(clippy::cast_possible_truncation, reason = "bounded above")]
        let pixels = (value * scale).floor().max(1.0) as i32;
        pixels.min(max.max(1))
    };
    (fit(width, max_width), fit(height, max_height))
}

/// A live WebGL context.
#[derive(Debug)]
pub struct Context {
    buffer: DrawingBuffer,
    errors: ErrorState,
    objects: SlotMap<ObjectKey, Object>,
    unpack: UnpackState,
    webgl2: bool,
}

/// Makes `buffer`'s context current, setting the lost flag if that fails: a
/// context EGL can no longer make current is unusable.
fn current<'a>(buffer: &'a DrawingBuffer, errors: &mut ErrorState) -> Option<Current<'a>> {
    if errors.is_lost() {
        return None;
    }
    buffer
        .context
        .make_current()
        .inspect_err(|_| errors.mark_lost())
        .ok()
}

/// The first two integer values of `pname`; `None` if the query failed.
fn integers(current: &Current<'_>, pname: u32) -> Option<[i32; 2]> {
    match current.get_values(pname, ValueType::Integer)? {
        Values::Integers([a, b, ..]) => Some([a, b]),
        _ => None,
    }
}

/// The current pack parameters, read from the GL so ANGLE stays their only
/// owner. A failed query (none is expected) falls back to the initial value.
fn pack_layout(current: &Current<'_>, webgl2: bool) -> pixels::PackLayout {
    let read = |pname| match current.get_values(pname, ValueType::Integer) {
        Some(Values::Integers([value, ..])) => u64::try_from(value).unwrap_or(0),
        _ => 0,
    };
    let alignment = match read(GL_PACK_ALIGNMENT) {
        0 => 4,
        value => value,
    };
    if !webgl2 {
        return pixels::PackLayout::aligned(alignment);
    }
    pixels::PackLayout {
        alignment,
        row_length: read(GL_PACK_ROW_LENGTH),
        skip_pixels: read(GL_PACK_SKIP_PIXELS),
        skip_rows: read(GL_PACK_SKIP_ROWS),
    }
}

/// Sets the lost flag if the GL reports a graphics reset.
fn check_reset(current: &Current<'_>, errors: &mut ErrorState) {
    if current.graphics_reset_status() != GL_NO_ERROR {
        errors.mark_lost();
    }
}

impl Context {
    /// Wraps a drawing buffer.
    #[must_use]
    pub fn new(buffer: DrawingBuffer, webgl2: bool) -> Self {
        Self {
            buffer,
            errors: ErrorState::default(),
            objects: SlotMap::with_key(),
            unpack: UnpackState::default(),
            webgl2,
        }
    }

    /// The drawing buffer.
    #[must_use]
    pub fn drawing_buffer(&self) -> &DrawingBuffer {
        &self.buffer
    }

    /// Whether the webgl context lost flag is set.
    #[must_use]
    pub fn is_lost(&self) -> bool {
        self.errors.is_lost()
    }

    /// Number of live WebGL objects owned by the context.
    #[must_use]
    pub fn object_count(&self) -> usize {
        self.objects.len()
    }

    /// `clearColor` (WebGL 1.0 §5.14.3).
    pub fn clear_color(&mut self, red: f32, green: f32, blue: f32, alpha: f32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.clear_color(red, green, blue, alpha);
        }
    }

    /// A value-only state call (WebGL 1.0 §5.14.3–§5.14.4, §5.14.11),
    /// forwarded for ANGLE to validate.
    pub fn set_state(&mut self, call: StateCall) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.apply(call);
        }
    }

    /// `pixelStorei` (WebGL 1.0 §5.14.3): oxgl keeps the WebGL-only
    /// parameters and forwards the rest.
    pub fn pixel_store(&mut self, pname: u32, param: i32) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        match self.unpack.store(pname, param) {
            PixelStore::Stored => {}
            PixelStore::Error(code) => self.errors.synthesize(code),
            PixelStore::Forward => current.pixel_store(pname, param),
        }
    }

    /// `isEnabled` (WebGL 1.0 §5.14.3); `false` when lost.
    pub fn is_enabled(&mut self, cap: u32) -> bool {
        current(&self.buffer, &mut self.errors).is_some_and(|current| current.is_enabled(cap))
    }

    /// `getParameter` (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2). `None` (JS
    /// `null`) for an unknown parameter, after synthesizing `INVALID_ENUM`,
    /// for a query ANGLE rejected, and on a lost context.
    pub fn get_parameter(&mut self, pname: u32) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        let Some(entry) = parameters::lookup(pname, self.webgl2) else {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        };
        Some(match entry.kind {
            Kind::Object => Parameter::Null,
            Kind::CompressedFormats => Parameter::Uint32(Vec::new()),
            Kind::ClientWaitTimeout => Parameter::Number(0.0),
            Kind::Shadow => match pname {
                UNPACK_FLIP_Y_WEBGL => Parameter::Boolean(self.unpack.flip_y),
                UNPACK_PREMULTIPLY_ALPHA_WEBGL => Parameter::Boolean(self.unpack.premultiply_alpha),
                _ => Parameter::Number(f64::from(self.unpack.colorspace_conversion)),
            },
            Kind::String => Parameter::String(match pname {
                GL_VERSION | GL_SHADING_LANGUAGE_VERSION => parameters::version_string(
                    pname,
                    self.webgl2,
                    current.get_string(pname).as_deref(),
                ),
                _ => "oxgl".to_owned(),
            }),
            kind => {
                let ty = parameters::value_type(kind)?;
                parameters::from_values(kind, current.get_values(pname, ty)?)
            }
        })
    }

    /// `getShaderPrecisionFormat` (WebGL 1.0 §5.14.9). oxgl checks the enums,
    /// because the GLES entry point cannot report an error.
    pub fn shader_precision_format(
        &mut self,
        shader: u32,
        precision: u32,
    ) -> Option<PrecisionFormat> {
        let current = current(&self.buffer, &mut self.errors)?;
        let valid = matches!(shader, GL_VERTEX_SHADER | GL_FRAGMENT_SHADER)
            && (GL_LOW_FLOAT..=GL_HIGH_INT).contains(&precision);
        if !valid {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        Some(current.shader_precision_format(shader, precision))
    }

    /// `isContextLost` (WebGL 1.0 §5.14.13), detecting device loss first.
    pub fn is_context_lost(&mut self) -> bool {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            check_reset(&current, &mut self.errors);
        }
        self.errors.is_lost()
    }

    /// `clear` (WebGL 1.0 §5.14.11); ANGLE validates the mask.
    pub fn clear(&mut self, mask: u32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.clear(mask);
        }
    }

    /// `getError` (WebGL 1.0 §5.14.3), detecting device loss first.
    pub fn get_error(&mut self) -> u32 {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return self.errors.get_error(|| GL_NO_ERROR);
        };
        check_reset(&current, &mut self.errors);
        self.errors.get_error(|| current.get_error())
    }

    /// `readPixels` into an `ArrayBufferView` (WebGL 1.0 §5.14.12), or `None`
    /// for a `null` destination.
    ///
    /// oxgl checks what ANGLE cannot see (the destination's type and size);
    /// ANGLE validates everything else. ANGLE writes into a private buffer
    /// that is first filled from the destination, so pixels outside the
    /// framebuffer keep the destination's bytes, and the destination is
    /// written only when the read succeeds.
    pub fn read_pixels(&mut self, args: ReadPixels, destination: Option<&dyn PixelDestination>) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let Some(destination) = destination else {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        };
        let layout = pixels::components(args.format, self.webgl2)
            .zip(pixels::type_info(args.ty, self.webgl2));
        let required = match layout {
            // Unknown enums: ANGLE generates INVALID_ENUM.
            None => Some(0),
            Some((_, ty)) if !ty.views.contains(&destination.kind()) => {
                self.errors.synthesize(GL_INVALID_OPERATION);
                return;
            }
            Some((components, ty)) => {
                match (u64::try_from(args.width), u64::try_from(args.height)) {
                    (Ok(width), Ok(height)) => pixels::required_bytes(
                        width,
                        height,
                        components,
                        ty,
                        pack_layout(&current, self.webgl2),
                    ),
                    // Negative sizes: ANGLE generates INVALID_VALUE.
                    _ => Some(0),
                }
            }
        };
        let Some(required) = required.filter(|&r| pixels::fits(destination.byte_len(), r)) else {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        };
        // `fits` checked `required` <= the view's length, a usize.
        let Ok(required) = usize::try_from(required) else {
            return;
        };
        let mut staging = vec![0; required];
        destination.copy_to(&mut staging);
        if current.read_pixels(args, &mut staging) > 0 {
            destination.copy_from(&staging);
        }
        check_reset(&current, &mut self.errors);
    }

    /// Simulates a device loss through `GL_CHROMIUM_lose_context`, as
    /// `WEBGL_lose_context.loseContext()` will. The loss is observed like a
    /// real one, by the next `getError` or `readPixels`.
    pub fn lose_context(&mut self) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.request_extension(c"GL_CHROMIUM_lose_context");
            current.lose_context(GL_GUILTY_CONTEXT_RESET_EXT, GL_INNOCENT_CONTEXT_RESET_EXT);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_within_limits_are_kept() {
        assert_eq!(clamp_size(300.0, 150.0, 4096, 4096), (300, 150));
        assert_eq!(clamp_size(4096.0, 1.0, 4096, 4096), (4096, 1));
    }

    #[test]
    fn oversized_requests_keep_the_aspect_ratio() {
        assert_eq!(clamp_size(8192.0, 4096.0, 4096, 4096), (4096, 2048));
        assert_eq!(clamp_size(1000.0, 30000.0, 16384, 8192), (273, 8192));
        let (w, h) = clamp_size(1e12, 3e11, 16384, 16384);
        assert_eq!(w, 16384);
        assert!((f64::from(w) / f64::from(h) - 1e12 / 3e11).abs() * f64::from(h) <= 1.0);
    }

    #[test]
    fn extreme_ratios_keep_one_pixel() {
        assert_eq!(clamp_size(1e9, 1.0, 16384, 16384), (16384, 1));
    }
}
