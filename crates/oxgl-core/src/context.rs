//! A WebGL context: its drawing buffer, error state, and objects.

use oxgl_sys::bindings::{
    GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT, GL_GUILTY_CONTEXT_RESET_EXT,
    GL_INNOCENT_CONTEXT_RESET_EXT, GL_INVALID_OPERATION, GL_INVALID_VALUE, GL_NO_ERROR,
    GL_STENCIL_BUFFER_BIT,
};
use oxgl_sys::{
    ClientVersion, Current, Display, GlContext, IntegerParam, PixelDestination, ReadPixels,
};
use slotmap::{SlotMap, new_key_type};

use crate::backend::ContextRequest;
use crate::error::ErrorState;
use crate::pixels;

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
                current.get_integers(IntegerParam::MaxRenderbufferSize),
                current.get_integers(IntegerParam::MaxViewportDims),
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
        context
            .make_current()
            .map_err(|e| e.to_string())?
            .clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
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
                        pixels::PACK_ALIGNMENT,
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
