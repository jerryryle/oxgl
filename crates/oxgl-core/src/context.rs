//! A WebGL context: its drawing buffer, error state, and objects.

use oxgl_sys::bindings::{
    GL_FRAGMENT_SHADER, GL_GUILTY_CONTEXT_RESET_EXT, GL_HIGH_INT, GL_INNOCENT_CONTEXT_RESET_EXT,
    GL_INVALID_ENUM, GL_INVALID_OPERATION, GL_INVALID_VALUE, GL_LOW_FLOAT, GL_NO_ERROR,
    GL_NUM_COMPRESSED_TEXTURE_FORMATS, GL_PACK_ALIGNMENT, GL_PACK_ROW_LENGTH, GL_PACK_SKIP_PIXELS,
    GL_PACK_SKIP_ROWS, GL_PRIMITIVE_RESTART_FIXED_INDEX, GL_RENDERER, GL_SHADING_LANGUAGE_VERSION,
    GL_VENDOR, GL_VERSION, GL_VERTEX_SHADER,
};
use oxgl_sys::{
    Current, PixelDestination, PrecisionFormat, ReadPixels, StateCall, ValueType, Values,
};
use slotmap::{SlotMap, new_key_type};

pub use crate::drawing_buffer::{Attributes, DrawingBuffer, clamp_size};
use crate::error::ErrorState;
use crate::parameters::{self, Kind, Parameter};
use crate::pixels;
use crate::state::{PixelStore, UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL, UnpackState};

new_key_type! {
    /// Generational handle of a WebGL object within its context.
    pub struct ObjectKey;
}

/// A WebGL object owned by a context, holding its GL name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Object {
    /// A buffer and the kind of target it was first bound to.
    Buffer {
        /// GL name.
        name: u32,
        /// WebGL's buffer target class (WebGL 1.0 §6.1).
        kind: crate::rendering::BufferKind,
    },
    /// A shader.
    Shader {
        /// GL name.
        name: u32,
    },
    /// A program.
    Program {
        /// GL name.
        name: u32,
    },
    /// A texture.
    Texture {
        /// GL name.
        name: u32,
    },
    /// A sampler (WebGL 2).
    Sampler {
        /// GL name.
        name: u32,
    },
    /// A framebuffer.
    Framebuffer {
        /// GL name.
        name: u32,
    },
    /// A renderbuffer.
    Renderbuffer {
        /// GL name.
        name: u32,
        /// Allocated as WebGL's `DEPTH_STENCIL`, reported back as such.
        depth_stencil: bool,
    },
    /// A vertex array object (WebGL 2).
    VertexArray {
        /// GL name.
        name: u32,
    },
    /// A transform feedback object (WebGL 2).
    TransformFeedback {
        /// GL name.
        name: u32,
    },
    /// A query (WebGL 2).
    Query {
        /// GL name.
        name: u32,
    },
    /// A sync object (WebGL 2).
    Sync {
        /// GL handle.
        handle: oxgl_sys::SyncHandle,
    },
}

/// A live WebGL context.
#[derive(Debug)]
pub struct Context {
    pub(crate) buffer: DrawingBuffer,
    pub(crate) errors: ErrorState,
    pub(crate) objects: SlotMap<ObjectKey, Object>,
    pub(crate) unpack: UnpackState,
    pub(crate) webgl2: bool,
    /// The renderbuffer bound to `RENDERBUFFER`, for the `DEPTH_STENCIL`
    /// format alias.
    pub(crate) bound_renderbuffer: Option<ObjectKey>,
    /// Enabled WebGL extensions.
    pub(crate) extensions: crate::extensions::ExtensionState,
    /// Shaders and programs deleted while GL keeps them alive (attached to a
    /// program, or the current program); their slots stay until GL frees
    /// them (OpenGL ES 2.0 §2.10.1, §2.10.3).
    pub(crate) flagged: Vec<ObjectKey>,
    /// Per linked program, the GL type of the uniform at each location, for
    /// `getUniform`; built on first use, dropped on link and deletion.
    pub(crate) uniform_types:
        std::collections::HashMap<ObjectKey, std::collections::HashMap<i32, u32>>,
}

/// Makes `buffer`'s context current, setting the lost flag if that fails: a
/// context EGL can no longer make current is unusable.
pub(crate) fn current<'a>(
    buffer: &'a DrawingBuffer,
    errors: &mut ErrorState,
) -> Option<Current<'a>> {
    if errors.is_lost() {
        return None;
    }
    buffer
        .context()
        .make_current()
        .inspect_err(|_| errors.mark_lost())
        .ok()
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
pub(crate) fn check_reset(current: &Current<'_>, errors: &mut ErrorState) {
    if current.graphics_reset_status() != GL_NO_ERROR {
        errors.mark_lost();
    }
}

impl Context {
    /// Wraps a drawing buffer.
    #[must_use]
    pub fn new(buffer: DrawingBuffer, webgl2: bool) -> Self {
        // WebGL 2 always restarts primitives at the fixed index (WebGL 2.0
        // §5.18), and pages cannot toggle it (see `set_state`).
        if webgl2 && let Ok(current) = buffer.context().make_current() {
            current.apply(StateCall::Enable(GL_PRIMITIVE_RESTART_FIXED_INDEX));
        }
        Self {
            buffer,
            errors: ErrorState::default(),
            objects: SlotMap::with_key(),
            unpack: UnpackState::default(),
            webgl2,
            bound_renderbuffer: None,
            extensions: crate::extensions::ExtensionState::default(),
            flagged: Vec::new(),
            uniform_types: std::collections::HashMap::new(),
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
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        match call {
            StateCall::Enable(GL_PRIMITIVE_RESTART_FIXED_INDEX)
            | StateCall::Disable(GL_PRIMITIVE_RESTART_FIXED_INDEX) => {
                self.errors.synthesize(GL_INVALID_ENUM);
            }
            call => current.apply(call),
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
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        if cap == GL_PRIMITIVE_RESTART_FIXED_INDEX {
            self.errors.synthesize(GL_INVALID_ENUM);
            return false;
        }
        current.is_enabled(cap)
    }

    /// `getParameter` (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2). `None` (JS
    /// `null`) for an unknown parameter, after synthesizing `INVALID_ENUM`,
    /// for a query ANGLE rejected, and on a lost context.
    pub fn get_parameter(&mut self, pname: u32) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        let extensions = &self.extensions;
        let entry = parameters::lookup(pname, self.webgl2)
            .or_else(|| parameters::lookup_extension(pname, |name| extensions.is_enabled(name)));
        let Some(entry) = entry else {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        };
        let draw_buffers = self.webgl2 || self.extensions.is_enabled("WEBGL_draw_buffers");
        match self.buffer.parameter(&current, pname, draw_buffers) {
            Some(Ok(value)) => return Some(Parameter::Number(f64::from(value))),
            Some(Err(code)) => {
                self.errors.synthesize(code);
                return None;
            }
            None => {}
        }
        Some(match entry.kind {
            Kind::Object => Parameter::Null,
            Kind::CompressedFormats => {
                // ANGLE lists only the formats of enabled extensions.
                let count = match current
                    .get_values(GL_NUM_COMPRESSED_TEXTURE_FORMATS, ValueType::Integer)
                {
                    Some(Values::Integers([n, ..])) => usize::try_from(n).unwrap_or(0),
                    _ => 0,
                };
                Parameter::Uint32(
                    current
                        .integers(pname, count)
                        .into_iter()
                        .map(i32::cast_unsigned)
                        .collect(),
                )
            }
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
                parameters::UNMASKED_VENDOR_WEBGL => {
                    current.get_string(GL_VENDOR).unwrap_or_default()
                }
                parameters::UNMASKED_RENDERER_WEBGL => {
                    current.get_string(GL_RENDERER).unwrap_or_default()
                }
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
        if self.pack_buffer_bound(&current) {
            // WebGL 2.0 §3.7.10: the view overload needs no pack buffer.
            self.errors.synthesize(GL_INVALID_OPERATION);
            return;
        }
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
        let resolved = self.buffer.begin_read(&current);
        let read = current.read_pixels(args, &mut staging);
        if resolved {
            self.buffer.end_read(&current);
        }
        if read > 0 {
            destination.copy_from(&staging);
        }
        check_reset(&current, &mut self.errors);
    }

    /// `getContextAttributes` (WebGL 1.0 §5.14.2); `None` when lost.
    #[must_use]
    pub fn attributes(&self) -> Option<Attributes> {
        (!self.errors.is_lost()).then(|| self.buffer.attributes())
    }

    /// Non-standard `resize`: reallocates the drawing buffer (WebGL 1.0
    /// §2.2). Marks the context lost if not even 1×1 can be allocated.
    pub fn resize(&mut self, width: f64, height: f64) {
        if self.errors.is_lost() {
            return;
        }
        if !self.buffer.resize(width, height, &mut self.errors) {
            self.errors.mark_lost();
        }
    }

    /// Simulates a device loss through `GL_CHROMIUM_lose_context`, as
    /// `WEBGL_lose_context.loseContext()` will. The loss is observed like a
    /// real one, by the next `getError` or `readPixels`.
    pub fn lose_context(&mut self) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.request_extension(c"GL_CHROMIUM_lose_context");
            current.lose_context(GL_GUILTY_CONTEXT_RESET_EXT, GL_INNOCENT_CONTEXT_RESET_EXT);
            // WebGL 1.0 §5.15.3: the context is lost as soon as the call
            // returns, not when the GL next reports it.
            self.errors.mark_lost();
        }
    }
}
