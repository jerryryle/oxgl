//! The drawing buffer (WebGL 1.0 §2.2): framebuffer objects on a surfaceless
//! context, allocated from the context attributes with fallbacks, and
//! resolved before reads when antialiased.

use oxgl_sys::bindings::{
    GL_BACK, GL_COLOR_ATTACHMENT0, GL_COLOR_BUFFER_BIT, GL_COLOR_CLEAR_VALUE, GL_COLOR_WRITEMASK,
    GL_DEPTH_ATTACHMENT, GL_DEPTH_BUFFER_BIT, GL_DEPTH_CLEAR_VALUE, GL_DEPTH_COMPONENT24,
    GL_DEPTH_STENCIL_ATTACHMENT, GL_DEPTH_WRITEMASK, GL_DEPTH24_STENCIL8, GL_DRAW_FRAMEBUFFER,
    GL_DRAW_FRAMEBUFFER_BINDING, GL_FRAMEBUFFER_COMPLETE, GL_INVALID_OPERATION,
    GL_MAX_DRAW_BUFFERS, GL_MAX_RENDERBUFFER_SIZE, GL_MAX_SAMPLES, GL_MAX_VIEWPORT_DIMS,
    GL_NEAREST, GL_NO_ERROR, GL_NONE, GL_RASTERIZER_DISCARD, GL_READ_FRAMEBUFFER,
    GL_READ_FRAMEBUFFER_BINDING, GL_RENDERBUFFER, GL_RENDERBUFFER_BINDING, GL_RGB8, GL_RGBA8,
    GL_SCISSOR_TEST, GL_STENCIL_ATTACHMENT, GL_STENCIL_BACK_WRITEMASK, GL_STENCIL_BUFFER_BIT,
    GL_STENCIL_CLEAR_VALUE, GL_STENCIL_INDEX8, GL_STENCIL_WRITEMASK,
};
use oxgl_sys::{ClientVersion, Current, Display, GlContext, StateCall, ValueType, Values};

use crate::backend::ContextRequest;
use crate::error::ErrorState;

/// `WebGLContextAttributes` (WebGL 1.0 §5.2), after `WebIDL` conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "mirrors the WebIDL dictionary"
)]
pub struct Attributes {
    /// `alpha`.
    pub alpha: bool,
    /// `depth`.
    pub depth: bool,
    /// `stencil`.
    pub stencil: bool,
    /// `antialias`.
    pub antialias: bool,
    /// `premultipliedAlpha`.
    pub premultiplied_alpha: bool,
    /// `preserveDrawingBuffer`.
    pub preserve_drawing_buffer: bool,
    /// `powerPreference`: 0 `default`, 1 `low-power`, 2 `high-performance`.
    pub power_preference: u8,
    /// `failIfMajorPerformanceCaveat`.
    pub fail_if_major_performance_caveat: bool,
}

impl Default for Attributes {
    fn default() -> Self {
        Self::DEFAULT
    }
}

impl Attributes {
    /// The IDL defaults.
    pub const DEFAULT: Self = Self {
        alpha: true,
        depth: true,
        stencil: false,
        antialias: true,
        premultiplied_alpha: true,
        preserve_drawing_buffer: false,
        power_preference: 0,
        fail_if_major_performance_caveat: false,
    };
}

/// Implementation limits that bound the drawing buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Largest width: the smaller of `MAX_RENDERBUFFER_SIZE` and
    /// `MAX_VIEWPORT_DIMS[0]`.
    pub max_width: i32,
    /// Largest height, likewise.
    pub max_height: i32,
    /// `MAX_SAMPLES` (`MAX_SAMPLES_ANGLE` on WebGL 1).
    pub max_samples: i32,
    /// `MAX_DRAW_BUFFERS` (WebGL 2), else 1.
    pub max_draw_buffers: i32,
    /// Test-only: storage larger than this many bytes fails as
    /// `OUT_OF_MEMORY` would.
    #[cfg(test)]
    pub byte_cap: Option<u64>,
}

impl Limits {
    /// Reads the limits from the current context.
    fn read(current: &Current<'_>, webgl2: bool) -> Option<Self> {
        let [renderbuffer, _] = integers(current, GL_MAX_RENDERBUFFER_SIZE)?;
        let [viewport_width, viewport_height] = integers(current, GL_MAX_VIEWPORT_DIMS)?;
        let [max_samples, _] = integers(current, GL_MAX_SAMPLES)?;
        let max_draw_buffers = if webgl2 {
            integers(current, GL_MAX_DRAW_BUFFERS)?[0]
        } else {
            1
        };
        let limits = Self {
            max_width: renderbuffer.min(viewport_width),
            max_height: renderbuffer.min(viewport_height),
            max_samples,
            max_draw_buffers,
            #[cfg(test)]
            byte_cap: None,
        };
        (limits.max_width > 0 && limits.max_height > 0).then_some(limits)
    }
}

/// The first two integer values of `pname`; `None` if the query failed.
pub(crate) fn integers(current: &Current<'_>, pname: u32) -> Option<[i32; 2]> {
    match current.get_values(pname, ValueType::Integer)? {
        Values::Integers([a, b, ..]) => Some([a, b]),
        _ => None,
    }
}

/// Scales `width`×`height` down to fit `max_width`×`max_height`, preserving
/// the aspect ratio (WebGL 1.0 §2.2). Results are at least 1.
#[must_use]
pub fn clamp_size(width: f64, height: f64, max_width: i32, max_height: i32) -> (i32, i32) {
    let width = width.max(1.0);
    let height = height.max(1.0);
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

/// GL names of the drawing buffer's internal objects. They live as long as
/// the context; resizing gives the renderbuffers new storage.
#[derive(Debug, Clone, Copy)]
struct Names {
    draw: u32,
    color: u32,
    depth_stencil: u32,
    resolve: u32,
    resolve_color: u32,
}

/// What one allocation attempt asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Attempt {
    width: i32,
    height: i32,
    samples: i32,
    depth: bool,
    stencil: bool,
}

/// The drawing buffer and its context.
#[derive(Debug)]
pub struct DrawingBuffer {
    context: GlContext,
    names: Names,
    webgl2: bool,
    requested: Attributes,
    limits: Limits,
    allocated: Attempt,
    /// The default framebuffer's draw buffer (WebGL 2): `BACK` or `NONE`.
    draw_buffer: std::cell::Cell<u32>,
    /// The default framebuffer's read buffer (WebGL 2): `BACK` or `NONE`.
    read_buffer: std::cell::Cell<u32>,
}

impl DrawingBuffer {
    /// Creates a context on `display` with a drawing buffer for `request`,
    /// smaller than requested when that exceeds the implementation's limits
    /// or cannot be allocated.
    ///
    /// # Errors
    ///
    /// The failing EGL call, or a description of why no buffer, not even
    /// 1×1, could be allocated.
    pub fn new(display: &Display, request: &ContextRequest) -> Result<Self, String> {
        let version = if request.webgl2 {
            ClientVersion::Es3
        } else {
            ClientVersion::Es2
        };
        let context = display.create_context(version).map_err(|e| e.to_string())?;
        let (names, limits) = {
            let current = context.make_current().map_err(|e| e.to_string())?;
            if !request.webgl2 {
                // Renderbuffer formats and blits the WebGL 1 drawing buffer
                // needs. No WebGL entry point reaches them (design).
                current.request_extension(c"GL_OES_rgb8_rgba8");
                current.request_extension(c"GL_ANGLE_framebuffer_multisample");
                current.request_extension(c"GL_ANGLE_framebuffer_blit");
            }
            let limits = Limits::read(&current, request.webgl2)
                .ok_or("cannot query the drawing buffer size limits")?;
            let names = Names {
                draw: current.gen_framebuffer(),
                color: current.gen_renderbuffer(),
                depth_stencil: current.gen_renderbuffer(),
                resolve: current.gen_framebuffer(),
                resolve_color: current.gen_renderbuffer(),
            };
            (names, limits)
        };
        let mut buffer = Self {
            context,
            names,
            webgl2: request.webgl2,
            requested: request.attributes,
            limits,
            allocated: Attempt {
                width: 0,
                height: 0,
                samples: 0,
                depth: false,
                stencil: false,
            },
            draw_buffer: std::cell::Cell::new(GL_BACK),
            read_buffer: std::cell::Cell::new(GL_BACK),
        };
        let mut errors = ErrorState::default();
        buffer
            .allocate(request.width, request.height, &mut errors)
            .ok_or("cannot allocate the drawing buffer")?;
        // The context was first made current without a surface, which left
        // its viewport and scissor box at 0×0; both start at the drawing
        // buffer's size (WebGL 1.0 §5.14.4).
        let current = buffer.context.make_current().map_err(|e| e.to_string())?;
        let (width, height) = (buffer.width(), buffer.height());
        current.apply(StateCall::Viewport(0, 0, width, height));
        current.apply(StateCall::Scissor(0, 0, width, height));
        Ok(buffer)
    }

    /// Test constructor taking explicit limits.
    #[cfg(test)]
    pub(crate) fn with_limits(
        display: &Display,
        request: &ContextRequest,
        limits: Limits,
    ) -> Result<Self, String> {
        let mut buffer = Self::new(
            display,
            &ContextRequest {
                width: 1.0,
                height: 1.0,
                ..*request
            },
        )?;
        buffer.limits = limits;
        let mut errors = ErrorState::default();
        buffer
            .allocate(request.width, request.height, &mut errors)
            .ok_or("cannot allocate the drawing buffer")?;
        Ok(buffer)
    }

    /// The GL context.
    #[must_use]
    pub fn context(&self) -> &GlContext {
        &self.context
    }

    /// Actual width in pixels.
    #[must_use]
    pub fn width(&self) -> i32 {
        self.allocated.width
    }

    /// Actual height in pixels.
    #[must_use]
    pub fn height(&self) -> i32 {
        self.allocated.height
    }

    /// Samples per pixel of the draw buffer; 0 when single-sampled.
    #[must_use]
    pub fn samples(&self) -> i32 {
        self.allocated.samples
    }

    /// The limits allocation used.
    #[must_use]
    pub fn limits(&self) -> Limits {
        self.limits
    }

    /// The GL name of the framebuffer drawing goes to, which WebGL's `null`
    /// framebuffer binding stands for.
    #[must_use]
    pub fn framebuffer(&self) -> u32 {
        self.names.draw
    }

    /// `getContextAttributes`: `alpha`, `depth`, `stencil` and `antialias` as
    /// allocated, the rest as requested.
    #[must_use]
    pub fn attributes(&self) -> Attributes {
        Attributes {
            depth: self.allocated.depth,
            stencil: self.allocated.stencil,
            antialias: self.allocated.samples > 0,
            ..self.requested
        }
    }

    /// The drawing buffer's answer to a default-framebuffer `getParameter`
    /// query (design: "getParameter describes the default framebuffer"):
    /// `Some(Ok(value))` for a value oxgl answers, `Some(Err(code))` for an
    /// error to synthesize, `None` when ANGLE answers.
    pub(crate) fn parameter(&self, current: &Current<'_>, pname: u32) -> Option<Result<i32, u32>> {
        use oxgl_sys::bindings::{
            GL_DRAW_BUFFER0, GL_IMPLEMENTATION_COLOR_READ_FORMAT,
            GL_IMPLEMENTATION_COLOR_READ_TYPE, GL_INVALID_ENUM, GL_READ_BUFFER,
        };
        let enum_value = |value: u32| Some(Ok(i32::try_from(value).ok()?));
        let bound = |pname| {
            integers(current, pname).map(|[name, _]| name.cast_unsigned()) == Some(self.names.draw)
        };
        match pname {
            GL_IMPLEMENTATION_COLOR_READ_FORMAT | GL_IMPLEMENTATION_COLOR_READ_TYPE => {
                // Reads go through the single-sample buffer; ask ANGLE about
                // that one, which it may refuse to describe while the
                // multisampled one is bound.
                if !self.reads_resolve(current) {
                    return None;
                }
                current.bind_framebuffer(GL_READ_FRAMEBUFFER, self.names.resolve);
                let value = integers(current, pname).map(|[value, _]| value);
                current.bind_framebuffer(GL_READ_FRAMEBUFFER, self.names.draw);
                value.map(Ok)
            }
            GL_READ_BUFFER if self.webgl2 && bound(GL_READ_FRAMEBUFFER_BINDING) => {
                enum_value(self.read_buffer.get())
            }
            GL_DRAW_BUFFER0 if self.webgl2 && bound(GL_DRAW_FRAMEBUFFER_BINDING) => {
                enum_value(self.draw_buffer.get())
            }
            _ if self.webgl2 && pname > GL_DRAW_BUFFER0 && pname <= GL_DRAW_BUFFER0 + 15 => {
                let index = i64::from(pname - GL_DRAW_BUFFER0);
                if index >= i64::from(self.limits.max_draw_buffers) {
                    // ANGLE reports INVALID_OPERATION here; WebGL 2.0
                    // §3.7.2 lists an unknown pname as INVALID_ENUM.
                    Some(Err(GL_INVALID_ENUM))
                } else if bound(GL_DRAW_FRAMEBUFFER_BINDING) {
                    enum_value(GL_NONE)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Whether `pname`'s framebuffer binding (`DRAW_FRAMEBUFFER_BINDING` or
    /// `READ_FRAMEBUFFER_BINDING`) is the drawing buffer.
    pub(crate) fn is_bound(&self, current: &Current<'_>, pname: u32) -> bool {
        integers(current, pname).map(|[name, _]| name.cast_unsigned()) == Some(self.names.draw)
    }

    /// `drawBuffers` or `readBuffer` (`read`) while the drawing buffer is
    /// bound (WebGL 2): `BACK` maps to the FBO's color attachment, `NONE`
    /// stays; anything else is `INVALID_OPERATION` (OpenGL ES 3.0 §4.2.1,
    /// §4.3.1). Returns the GL value to set, or the error.
    pub(crate) fn set_buffer(&self, value: u32, read: bool) -> Result<u32, u32> {
        let mapped = match value {
            GL_BACK => GL_COLOR_ATTACHMENT0,
            GL_NONE => GL_NONE,
            _ => return Err(GL_INVALID_OPERATION),
        };
        if read {
            self.read_buffer.set(value);
        } else {
            self.draw_buffer.set(value);
        }
        Ok(mapped)
    }

    /// Whether reads of the bound read framebuffer go through the resolve
    /// buffer: the drawing buffer is multisampled and bound for reading.
    fn reads_resolve(&self, current: &Current<'_>) -> bool {
        self.allocated.samples > 0
            && integers(current, GL_READ_FRAMEBUFFER_BINDING).map(|[name, _]| name)
                == i32::try_from(self.names.draw).ok()
    }

    /// Reallocates at `width`×`height` (clamped and with the fallbacks of
    /// creation) and clears. Errors pending before the call stay pending.
    /// `false` if not even 1×1 could be allocated.
    pub fn resize(&mut self, width: f64, height: f64, errors: &mut ErrorState) -> bool {
        self.allocate(width, height, errors).is_some()
    }

    /// Allocates storage, falling back to no multisampling, then to half the
    /// size down to 1×1, and finally without depth and stencil, and clears
    /// the result (design: "Allocation falls back instead of failing").
    fn allocate(&mut self, width: f64, height: f64, errors: &mut ErrorState) -> Option<()> {
        let current = self.context.make_current().ok()?;
        drain_into(&current, errors);
        let saved = Bindings::save(&current);
        let wanted = self.requested;
        let samples = if wanted.antialias {
            self.limits.max_samples.clamp(0, 4)
        } else {
            0
        };
        let mut depth_stencil = vec![(wanted.depth, wanted.stencil)];
        if wanted.depth || wanted.stencil {
            depth_stencil.push((false, false));
        }
        let result = depth_stencil.into_iter().find_map(|(depth, stencil)| {
            let (mut w, mut h) =
                clamp_size(width, height, self.limits.max_width, self.limits.max_height);
            loop {
                let first = Attempt {
                    width: w,
                    height: h,
                    samples,
                    depth,
                    stencil,
                };
                let single = Attempt {
                    samples: 0,
                    ..first
                };
                if self.try_allocate(&current, first) {
                    break Some(first);
                }
                if samples > 0 && self.try_allocate(&current, single) {
                    break Some(single);
                }
                if w == 1 && h == 1 {
                    break None;
                }
                w = (w / 2).max(1);
                h = (h / 2).max(1);
            }
        });
        if let Some(attempt) = result {
            self.allocated = attempt;
            clear(&current, self.names.draw, self.webgl2);
        }
        saved.restore(&current, self.names.draw);
        discard_errors(&current);
        result.map(|_| ())
    }

    /// One allocation attempt; leaves the renderbuffers with storage and the
    /// framebuffers complete on success.
    fn try_allocate(&self, current: &Current<'_>, attempt: Attempt) -> bool {
        // A failed attempt may leave several flags; only this attempt's count.
        discard_errors(current);
        #[cfg(test)]
        if let Some(cap) = self.limits.byte_cap {
            let pixels = u64::from(attempt.width.unsigned_abs())
                * u64::from(attempt.height.unsigned_abs())
                * u64::from(attempt.samples.max(1).unsigned_abs());
            let depth_stencil = if attempt.depth || attempt.stencil {
                4
            } else {
                0
            };
            if pixels * (4 + depth_stencil) > cap {
                return false;
            }
        }
        let names = self.names;
        let color_format = if self.requested.alpha {
            GL_RGBA8
        } else {
            GL_RGB8
        };
        let storage = |renderbuffer: u32, samples: i32, format: u32| {
            current.bind_renderbuffer(GL_RENDERBUFFER, renderbuffer);
            if samples == 0 {
                current.renderbuffer_storage(
                    GL_RENDERBUFFER,
                    format,
                    attempt.width,
                    attempt.height,
                );
            } else if self.webgl2 {
                current.renderbuffer_storage_multisample(
                    GL_RENDERBUFFER,
                    samples,
                    format,
                    attempt.width,
                    attempt.height,
                );
            } else {
                current.renderbuffer_storage_multisample_angle(
                    GL_RENDERBUFFER,
                    samples,
                    format,
                    attempt.width,
                    attempt.height,
                );
            }
        };
        current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, names.draw);
        storage(names.color, attempt.samples, color_format);
        current.framebuffer_renderbuffer(
            GL_DRAW_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_RENDERBUFFER,
            names.color,
        );
        let depth_stencil = match (attempt.depth, attempt.stencil) {
            (true, true) => Some((GL_DEPTH24_STENCIL8, GL_DEPTH_STENCIL_ATTACHMENT)),
            (true, false) => Some((GL_DEPTH_COMPONENT24, GL_DEPTH_ATTACHMENT)),
            (false, true) => Some((GL_STENCIL_INDEX8, GL_STENCIL_ATTACHMENT)),
            (false, false) => None,
        };
        for attachment in [GL_DEPTH_ATTACHMENT, GL_STENCIL_ATTACHMENT] {
            current.framebuffer_renderbuffer(GL_DRAW_FRAMEBUFFER, attachment, GL_RENDERBUFFER, 0);
        }
        if let Some((format, attachment)) = depth_stencil {
            storage(names.depth_stencil, attempt.samples, format);
            current.framebuffer_renderbuffer(
                GL_DRAW_FRAMEBUFFER,
                attachment,
                GL_RENDERBUFFER,
                names.depth_stencil,
            );
        } else {
            // Release the previous storage.
            current.bind_renderbuffer(GL_RENDERBUFFER, names.depth_stencil);
            current.renderbuffer_storage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, 0, 0);
        }
        let mut ok =
            current.check_framebuffer_status(GL_DRAW_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
        current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, names.resolve);
        if attempt.samples > 0 {
            storage(names.resolve_color, 0, color_format);
        } else {
            current.bind_renderbuffer(GL_RENDERBUFFER, names.resolve_color);
            current.renderbuffer_storage(GL_RENDERBUFFER, color_format, 0, 0);
        }
        current.framebuffer_renderbuffer(
            GL_DRAW_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_RENDERBUFFER,
            names.resolve_color,
        );
        if attempt.samples > 0 {
            ok &= current.check_framebuffer_status(GL_DRAW_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
        }
        ok && current.get_error() == GL_NO_ERROR
    }

    /// When the drawing buffer is multisampled and bound for reading,
    /// resolves it into the single-sample buffer and binds that for reading;
    /// returns whether it did. [`DrawingBuffer::end_read`] undoes the binding.
    pub(crate) fn begin_read(&self, current: &Current<'_>) -> bool {
        // With the read buffer at NONE there is nothing to resolve, and the
        // GL reports the read's error against the drawing buffer itself.
        if !self.reads_resolve(current) || self.read_buffer.get() == GL_NONE {
            return false;
        }
        let draw = integers(current, GL_DRAW_FRAMEBUFFER_BINDING).map_or(0, |[name, _]| name);
        let scissor = current.is_enabled(GL_SCISSOR_TEST);
        if scissor {
            current.apply(StateCall::Disable(GL_SCISSOR_TEST));
        }
        current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, self.names.resolve);
        let (w, h) = (self.allocated.width, self.allocated.height);
        if self.webgl2 {
            current.blit_framebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        } else {
            current.blit_framebuffer_angle(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        }
        current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, draw.unsigned_abs());
        current.bind_framebuffer(GL_READ_FRAMEBUFFER, self.names.resolve);
        if scissor {
            current.apply(StateCall::Enable(GL_SCISSOR_TEST));
        }
        true
    }

    /// Rebinds the draw framebuffer for reading after
    /// [`DrawingBuffer::begin_read`] returned `true`.
    pub(crate) fn end_read(&self, current: &Current<'_>) {
        current.bind_framebuffer(GL_READ_FRAMEBUFFER, self.names.draw);
    }
}

impl Drop for DrawingBuffer {
    fn drop(&mut self) {
        // Destroying the context frees its objects; nothing to do unless it
        // can be made current, in which case deleting them first is cheap.
        if let Ok(current) = self.context.make_current() {
            current.delete_framebuffer(self.names.draw);
            current.delete_framebuffer(self.names.resolve);
            current.delete_renderbuffer(self.names.color);
            current.delete_renderbuffer(self.names.depth_stencil);
            current.delete_renderbuffer(self.names.resolve_color);
        }
    }
}

/// Framebuffer and renderbuffer bindings, saved around allocation.
struct Bindings {
    draw: u32,
    read: u32,
    renderbuffer: u32,
}

impl Bindings {
    fn save(current: &Current<'_>) -> Self {
        let name = |pname| integers(current, pname).map_or(0, |[name, _]| name.unsigned_abs());
        Self {
            draw: name(GL_DRAW_FRAMEBUFFER_BINDING),
            read: name(GL_READ_FRAMEBUFFER_BINDING),
            renderbuffer: name(GL_RENDERBUFFER_BINDING),
        }
    }

    /// Restores the bindings; framebuffer 0 (a new context) becomes the
    /// drawing buffer's framebuffer.
    fn restore(&self, current: &Current<'_>, default: u32) {
        let framebuffer = |name: u32| if name == 0 { default } else { name };
        current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, framebuffer(self.draw));
        current.bind_framebuffer(GL_READ_FRAMEBUFFER, framebuffer(self.read));
        current.bind_renderbuffer(GL_RENDERBUFFER, self.renderbuffer);
    }
}

/// Moves every error pending in the GL into `errors`, so internal calls
/// neither lose nor reveal them.
pub(crate) fn drain_into(current: &Current<'_>, errors: &mut ErrorState) {
    for _ in 0..8 {
        match current.get_error() {
            GL_NO_ERROR => break,
            code => errors.synthesize(code),
        }
    }
}

/// Drops the errors oxgl's own calls generated.
pub(crate) fn discard_errors(current: &Current<'_>) {
    for _ in 0..8 {
        if current.get_error() == GL_NO_ERROR {
            break;
        }
    }
}

/// Clears `framebuffer`'s color, depth and stencil to their defaults with
/// default masks and no scissor test, restoring that state afterwards
/// (design: "Clearing a new or resized buffer").
fn clear(current: &Current<'_>, framebuffer: u32, webgl2: bool) {
    let floats = |pname| match current.get_values(pname, ValueType::Float) {
        Some(Values::Floats(values)) => values,
        _ => [0.0; 4],
    };
    let booleans = |pname| match current.get_values(pname, ValueType::Boolean) {
        Some(Values::Booleans(values)) => values,
        _ => [true; 4],
    };
    let integer = |pname| match current.get_values(pname, ValueType::Integer) {
        Some(Values::Integers([value, ..])) => value,
        _ => 0,
    };
    let color = floats(GL_COLOR_CLEAR_VALUE);
    let mask = booleans(GL_COLOR_WRITEMASK);
    let depth = floats(GL_DEPTH_CLEAR_VALUE)[0];
    let depth_mask = booleans(GL_DEPTH_WRITEMASK)[0];
    let stencil = integer(GL_STENCIL_CLEAR_VALUE);
    let stencil_front = integer(GL_STENCIL_WRITEMASK).cast_unsigned();
    let stencil_back = integer(GL_STENCIL_BACK_WRITEMASK).cast_unsigned();
    let scissor = current.is_enabled(GL_SCISSOR_TEST);
    let discard = webgl2 && current.is_enabled(GL_RASTERIZER_DISCARD);

    current.bind_framebuffer(GL_DRAW_FRAMEBUFFER, framebuffer);
    current.apply(StateCall::Disable(GL_SCISSOR_TEST));
    if discard {
        current.apply(StateCall::Disable(GL_RASTERIZER_DISCARD));
    }
    current.clear_color(0.0, 0.0, 0.0, 0.0);
    current.apply(StateCall::ColorMask(true, true, true, true));
    current.apply(StateCall::ClearDepth(1.0));
    current.apply(StateCall::DepthMask(true));
    current.apply(StateCall::ClearStencil(0));
    current.apply(StateCall::StencilMask(u32::MAX));
    current.clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);

    current.clear_color(color[0], color[1], color[2], color[3]);
    current.apply(StateCall::ColorMask(mask[0], mask[1], mask[2], mask[3]));
    current.apply(StateCall::ClearDepth(depth));
    current.apply(StateCall::DepthMask(depth_mask));
    current.apply(StateCall::ClearStencil(stencil));
    current.apply(StateCall::StencilMaskSeparate(
        oxgl_sys::bindings::GL_FRONT,
        stencil_front,
    ));
    current.apply(StateCall::StencilMaskSeparate(
        oxgl_sys::bindings::GL_BACK,
        stencil_back,
    ));
    if scissor {
        current.apply(StateCall::Enable(GL_SCISSOR_TEST));
    }
    if discard {
        current.apply(StateCall::Enable(GL_RASTERIZER_DISCARD));
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing, reason = "tests")]

    use super::*;

    #[test]
    fn sizes_within_limits_are_kept() {
        assert_eq!(clamp_size(300.0, 150.0, 4096, 4096), (300, 150));
        assert_eq!(clamp_size(4096.0, 1.0, 4096, 4096), (4096, 1));
    }

    #[test]
    fn zero_sizes_become_one() {
        assert_eq!(clamp_size(0.0, 10.0, 4096, 4096), (1, 10));
        assert_eq!(clamp_size(0.0, 0.0, 4096, 4096), (1, 1));
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

    use oxgl_sys::bindings::{GL_INVALID_ENUM, GL_RGBA, GL_UNSIGNED_BYTE};
    use oxgl_sys::{Angle, DisplayKind};

    /// Runs `f` with a `SwiftShader` display on a thread that stays alive, so
    /// ANGLE's never-freed per-thread state stays reachable for
    /// `LeakSanitizer`.
    fn with_display(f: impl FnOnce(&Display) + Send + 'static) {
        let (done, result) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let angle = Angle::load(&oxgl_sys::test_support::bundle_dir()).unwrap();
                let display = Display::open(&angle, DisplayKind::SwiftShader).unwrap();
                f(&display);
            }));
            let _ = done.send(run);
            loop {
                std::thread::park();
            }
        });
        if let Err(payload) = result.recv().unwrap() {
            std::panic::resume_unwind(payload);
        }
    }

    fn request(webgl2: bool, attributes: Attributes) -> ContextRequest {
        ContextRequest {
            width: 8.0,
            height: 8.0,
            webgl2,
            attributes,
        }
    }

    fn limits(display: &Display, webgl2: bool) -> Limits {
        DrawingBuffer::new(display, &request(webgl2, Attributes::DEFAULT))
            .unwrap()
            .limits()
    }

    #[test]
    fn cap_on_multisampling_drops_antialias_and_keeps_the_size() {
        with_display(|display| {
            for webgl2 in [false, true] {
                // 8×8: 4 samples need 2048 bytes, single-sampled 512.
                let limits = Limits {
                    byte_cap: Some(1000),
                    ..limits(display, webgl2)
                };
                let buffer = DrawingBuffer::with_limits(
                    display,
                    &request(webgl2, Attributes::DEFAULT),
                    limits,
                )
                .unwrap();
                assert_eq!((buffer.width(), buffer.height()), (8, 8));
                assert!(!buffer.attributes().antialias);
                assert!(buffer.attributes().depth);
            }
        });
    }

    #[test]
    fn cap_on_single_sampling_halves_the_size() {
        with_display(|display| {
            let limits = Limits {
                byte_cap: Some(300),
                ..limits(display, true)
            };
            let buffer =
                DrawingBuffer::with_limits(display, &request(true, Attributes::DEFAULT), limits)
                    .unwrap();
            assert_eq!((buffer.width(), buffer.height()), (4, 4));
            assert!(!buffer.attributes().antialias);
            assert!(buffer.attributes().depth);
        });
    }

    #[test]
    fn no_multisampling_available() {
        with_display(|display| {
            let limits = Limits {
                max_samples: 0,
                ..limits(display, false)
            };
            let buffer =
                DrawingBuffer::with_limits(display, &request(false, Attributes::DEFAULT), limits)
                    .unwrap();
            assert!(!buffer.attributes().antialias);
            assert_eq!(buffer.samples(), 0);
        });
    }

    #[test]
    fn pending_errors_survive_allocation() {
        with_display(|display| {
            let mut buffer =
                DrawingBuffer::new(display, &request(true, Attributes::DEFAULT)).unwrap();
            buffer
                .context()
                .make_current()
                .unwrap()
                .apply(StateCall::Enable(0x1234));
            let mut errors = ErrorState::default();
            assert!(buffer.resize(16.0, 16.0, &mut errors));
            assert_eq!(errors.get_error(|| GL_NO_ERROR), GL_INVALID_ENUM);
            assert_eq!(
                errors.get_error(|| buffer.context().make_current().unwrap().get_error()),
                GL_NO_ERROR
            );
        });
    }

    #[test]
    fn resize_keeps_state_that_affects_clearing() {
        with_display(|display| {
            let mut buffer =
                DrawingBuffer::new(display, &request(false, Attributes::DEFAULT)).unwrap();
            {
                let current = buffer.context().make_current().unwrap();
                current.clear_color(1.0, 0.0, 0.0, 1.0);
                current.apply(StateCall::ColorMask(true, false, false, false));
                current.apply(StateCall::Enable(GL_SCISSOR_TEST));
            }
            assert!(buffer.resize(4.0, 2.0, &mut ErrorState::default()));
            let current = buffer.context().make_current().unwrap();
            assert_eq!(
                current.get_values(GL_COLOR_CLEAR_VALUE, ValueType::Float),
                Some(Values::Floats([1.0, 0.0, 0.0, 1.0]))
            );
            assert_eq!(
                current.get_values(GL_COLOR_WRITEMASK, ValueType::Boolean),
                Some(Values::Booleans([true, false, false, false]))
            );
            assert!(current.is_enabled(GL_SCISSOR_TEST));
            assert!(buffer.begin_read(&current));
            let mut pixels = [9u8; 32];
            let read = current.read_pixels(
                oxgl_sys::ReadPixels {
                    x: 0,
                    y: 0,
                    width: 4,
                    height: 2,
                    format: GL_RGBA,
                    ty: GL_UNSIGNED_BYTE,
                },
                &mut pixels,
            );
            buffer.end_read(&current);
            assert_eq!(read, 32);
            assert_eq!(pixels, [0; 32]);
        });
    }

    #[test]
    fn drawing_buffer_parameters() {
        with_display(|display| {
            use oxgl_sys::bindings::{
                GL_DRAW_BUFFER0, GL_DRAW_BUFFER1, GL_IMPLEMENTATION_COLOR_READ_FORMAT,
                GL_IMPLEMENTATION_COLOR_READ_TYPE, GL_READ_BUFFER,
            };
            for antialias in [false, true] {
                for alpha in [false, true] {
                    let attributes = Attributes {
                        alpha,
                        antialias,
                        ..Attributes::DEFAULT
                    };
                    let buffer = DrawingBuffer::new(display, &request(true, attributes)).unwrap();
                    let current = buffer.context().make_current().unwrap();
                    let as_int = |v: u32| Some(Ok(i32::try_from(v).unwrap()));
                    let read_format =
                        buffer.parameter(&current, GL_IMPLEMENTATION_COLOR_READ_FORMAT);
                    let read_type = buffer.parameter(&current, GL_IMPLEMENTATION_COLOR_READ_TYPE);
                    // Antialiased: answered from the resolve buffer; else ANGLE answers.
                    assert_eq!(read_format.is_some(), antialias);
                    assert_eq!(read_type.is_some(), antialias);
                    assert_eq!(current.get_error(), GL_NO_ERROR);
                    assert_eq!(buffer.parameter(&current, GL_DRAW_BUFFER0), as_int(GL_BACK));
                    assert_eq!(buffer.parameter(&current, GL_READ_BUFFER), as_int(GL_BACK));
                    assert_eq!(buffer.parameter(&current, GL_DRAW_BUFFER1), as_int(GL_NONE));
                    let max = u32::try_from(buffer.limits().max_draw_buffers).unwrap();
                    assert_eq!(
                        buffer.parameter(&current, GL_DRAW_BUFFER0 + max),
                        Some(Err(GL_INVALID_ENUM))
                    );
                    assert_eq!(buffer.attributes().antialias, antialias);
                }
            }
        });
    }
}
