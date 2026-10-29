//! Safe wrappers over the EGL and GLES calls oxgl makes.
//!
//! Invariants upheld here, so callers in `unsafe`-free crates cannot break them:
//! - A [`Display`] is an initialized ANGLE display. Displays are process-global
//!   in EGL and are never terminated.
//! - A [`GlContext`] owns its EGL context and pbuffer and destroys both on drop.
//!   It is not `Send`: it is created, used, and dropped on one thread.
//! - GLES calls are methods of [`Current`], which can only be obtained from
//!   [`GlContext::make_current`] and borrows the context, so GLES is only
//!   called while a context of this crate is current on the calling thread.
//! - Every call that writes through a pointer takes a buffer length that ANGLE
//!   checks (`GL_ANGLE_robust_client_memory`), so no GLES call writes outside
//!   Rust-owned memory.

use std::ffi::{CStr, c_char};
use std::fmt;
use std::marker::PhantomData;
use std::ptr;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::bindings::{
    EGL_ALPHA_SIZE, EGL_BLUE_SIZE, EGL_CONTEXT_BIND_GENERATES_RESOURCE_CHROMIUM,
    EGL_CONTEXT_CLIENT_ARRAYS_ENABLED_ANGLE, EGL_CONTEXT_CLIENT_VERSION, EGL_CONTEXT_LOST,
    EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT, EGL_CONTEXT_OPENGL_ROBUST_ACCESS_EXT,
    EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE, EGL_DEPTH_SIZE, EGL_DRAW, EGL_FALSE, EGL_GREEN_SIZE,
    EGL_HEIGHT, EGL_LOSE_CONTEXT_ON_RESET_EXT, EGL_MAX_PBUFFER_HEIGHT, EGL_MAX_PBUFFER_WIDTH,
    EGL_NONE, EGL_OPENGL_ES2_BIT, EGL_OPENGL_ES3_BIT, EGL_PBUFFER_BIT, EGL_PLATFORM_ANGLE_ANGLE,
    EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE, EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE,
    EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE, EGL_PLATFORM_ANGLE_TYPE_ANGLE,
    EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE, EGL_RED_SIZE, EGL_RENDERABLE_TYPE,
    EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE, EGL_STENCIL_SIZE, EGL_SURFACE_TYPE, EGL_TRUE,
    EGL_WIDTH, EGLConfig, EGLContext, EGLDisplay, EGLSurface, EGLint, GLenum, GLsizei,
};
use crate::loader::Angle;

static LIVE_CONTEXTS: AtomicUsize = AtomicUsize::new(0);
static LIVE_SURFACES: AtomicUsize = AtomicUsize::new(0);

/// Number of EGL contexts created by this crate and not yet destroyed.
#[must_use]
pub fn live_contexts() -> usize {
    LIVE_CONTEXTS.load(Ordering::SeqCst)
}

/// Number of EGL surfaces created by this crate and not yet destroyed.
#[must_use]
pub fn live_surfaces() -> usize {
    LIVE_SURFACES.load(Ordering::SeqCst)
}

/// A failed EGL call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EglError {
    /// The EGL function that failed.
    pub call: &'static str,
    /// `eglGetError()` after the failure (`EGL_SUCCESS` if none was recorded).
    pub code: EGLint,
}

impl EglError {
    /// Whether EGL reported `EGL_CONTEXT_LOST`.
    #[must_use]
    pub fn is_context_lost(&self) -> bool {
        self.code == EGL_CONTEXT_LOST
    }
}

impl fmt::Display for EglError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} failed (EGL error {:#06x})", self.call, self.code)
    }
}

impl std::error::Error for EglError {}

/// Which ANGLE device a display renders on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayKind {
    /// The platform's native GPU backend (Metal, Vulkan, or D3D11) on a
    /// hardware device.
    Gpu,
    /// `SwiftShader` through ANGLE's Vulkan backend.
    SwiftShader,
}

#[cfg(target_os = "macos")]
const GPU_PLATFORM: EGLint = crate::bindings::EGL_PLATFORM_ANGLE_TYPE_METAL_ANGLE;
#[cfg(windows)]
const GPU_PLATFORM: EGLint = crate::bindings::EGL_PLATFORM_ANGLE_TYPE_D3D11_ANGLE;
#[cfg(not(any(target_os = "macos", windows)))]
const GPU_PLATFORM: EGLint = EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE;

/// OpenGL ES client version of a context.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientVersion {
    /// OpenGL ES 2.0 (WebGL 1).
    Es2,
    /// OpenGL ES 3.0 (WebGL 2).
    Es3,
}

/// An initialized ANGLE EGL display. Cheap to clone.
#[derive(Clone)]
pub struct Display {
    angle: Angle,
    raw: EGLDisplay,
}

// SAFETY: an EGLDisplay is a process-global handle, and EGL requires display
// functions to be callable from any thread (EGL 1.5 §2.6), and an initialized
// display is usable from every thread of the process (§3.2); ANGLE locks
// internally. `Angle` is an `Arc` of immutable function pointers.
unsafe impl Send for Display {}
// SAFETY: as above; no method mutates `Display` itself.
unsafe impl Sync for Display {}

impl fmt::Debug for Display {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Display")
            .field("raw", &self.raw)
            .finish_non_exhaustive()
    }
}

impl Display {
    /// Gets and initializes the ANGLE display for `kind`.
    ///
    /// # Errors
    ///
    /// Returns the failing EGL call and error code.
    pub fn open(angle: &Angle, kind: DisplayKind) -> Result<Self, EglError> {
        let fns = angle.fns();
        let (platform, device) = match kind {
            DisplayKind::Gpu => (GPU_PLATFORM, EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE),
            DisplayKind::SwiftShader => (
                EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE,
                EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE,
            ),
        };
        let attribs = [
            EGL_PLATFORM_ANGLE_TYPE_ANGLE,
            platform,
            EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE,
            device,
            EGL_NONE,
        ];
        // SAFETY: the attribute list is EGL_NONE-terminated and outlives the
        // call; a null native display is valid for ANGLE platforms.
        let raw = unsafe {
            (fns.eglGetPlatformDisplayEXT)(
                EGL_PLATFORM_ANGLE_ANGLE.cast_unsigned(),
                ptr::null_mut(),
                attribs.as_ptr(),
            )
        };
        if raw.is_null() {
            return Err(egl_error(angle, "eglGetPlatformDisplayEXT"));
        }
        // SAFETY: `raw` is a display returned above; null version pointers are
        // allowed.
        let ok = unsafe { (fns.eglInitialize)(raw, ptr::null_mut(), ptr::null_mut()) };
        if ok == EGL_FALSE.cast_unsigned() {
            return Err(egl_error(angle, "eglInitialize"));
        }
        Ok(Self {
            angle: angle.clone(),
            raw,
        })
    }

    /// Creates a WebGL-compatible context (no surface yet) for `version`.
    ///
    /// # Errors
    ///
    /// Returns the failing EGL call and error code, for example when no config
    /// supports `version`.
    pub fn create_context(&self, version: ClientVersion) -> Result<GlContext, EglError> {
        let fns = self.angle.fns();
        let (renderable, client) = match version {
            ClientVersion::Es2 => (EGL_OPENGL_ES2_BIT, 2),
            ClientVersion::Es3 => (EGL_OPENGL_ES3_BIT, 3),
        };
        let config = self.choose_config(renderable)?;
        let attribs = [
            EGL_CONTEXT_CLIENT_VERSION,
            client,
            EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE,
            EGL_TRUE,
            EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE,
            EGL_TRUE,
            EGL_CONTEXT_OPENGL_ROBUST_ACCESS_EXT,
            EGL_TRUE,
            EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT,
            EGL_LOSE_CONTEXT_ON_RESET_EXT,
            EGL_CONTEXT_BIND_GENERATES_RESOURCE_CHROMIUM,
            EGL_FALSE,
            EGL_CONTEXT_CLIENT_ARRAYS_ENABLED_ANGLE,
            EGL_FALSE,
            EGL_NONE,
        ];
        // SAFETY: display and config are valid; the attribute list is
        // EGL_NONE-terminated and outlives the call; no share context.
        let raw =
            unsafe { (fns.eglCreateContext)(self.raw, config, ptr::null_mut(), attribs.as_ptr()) };
        if raw.is_null() {
            return Err(egl_error(&self.angle, "eglCreateContext"));
        }
        LIVE_CONTEXTS.fetch_add(1, Ordering::SeqCst);
        Ok(GlContext {
            display: self.clone(),
            config,
            raw,
            surface: ptr::null_mut(),
            not_send: PhantomData,
        })
    }

    /// Picks an RGBA8 config with a depth buffer, preferring one without
    /// stencil.
    fn choose_config(&self, renderable: EGLint) -> Result<EGLConfig, EglError> {
        let fns = self.angle.fns();
        let attribs = [
            EGL_SURFACE_TYPE,
            EGL_PBUFFER_BIT,
            EGL_RENDERABLE_TYPE,
            renderable,
            EGL_RED_SIZE,
            8,
            EGL_GREEN_SIZE,
            8,
            EGL_BLUE_SIZE,
            8,
            EGL_ALPHA_SIZE,
            8,
            EGL_DEPTH_SIZE,
            24,
            EGL_NONE,
        ];
        let mut configs: [EGLConfig; 64] = [ptr::null_mut(); 64];
        let mut count: EGLint = 0;
        // SAFETY: `configs` has room for the 64 entries the call may write and
        // `count` is a valid out-pointer.
        let ok = unsafe {
            (fns.eglChooseConfig)(
                self.raw,
                attribs.as_ptr(),
                configs.as_mut_ptr(),
                64,
                &raw mut count,
            )
        };
        if ok == EGL_FALSE.cast_unsigned() {
            return Err(egl_error(&self.angle, "eglChooseConfig"));
        }
        let found = configs
            .get(..usize::try_from(count).unwrap_or(0))
            .unwrap_or(&[]);
        let exact = found.iter().copied().find(|&config| {
            [EGL_RED_SIZE, EGL_GREEN_SIZE, EGL_BLUE_SIZE, EGL_ALPHA_SIZE]
                .iter()
                .all(|&a| self.config_attrib(config, a) == Some(8))
                && self.config_attrib(config, EGL_STENCIL_SIZE) == Some(0)
        });
        exact.or_else(|| found.first().copied()).ok_or(EglError {
            call: "eglChooseConfig",
            code: crate::bindings::EGL_BAD_MATCH,
        })
    }

    fn config_attrib(&self, config: EGLConfig, attribute: EGLint) -> Option<EGLint> {
        let mut value: EGLint = 0;
        // SAFETY: display and config are valid and `value` is a valid
        // out-pointer for one EGLint.
        let ok = unsafe {
            (self.angle.fns().eglGetConfigAttrib)(self.raw, config, attribute, &raw mut value)
        };
        (ok != EGL_FALSE.cast_unsigned()).then_some(value)
    }
}

fn egl_error(angle: &Angle, call: &'static str) -> EglError {
    // SAFETY: eglGetError has no preconditions.
    let code = unsafe { (angle.fns().eglGetError)() };
    EglError { call, code }
}

/// An EGL context with its (optional) pbuffer surface, destroyed on drop.
pub struct GlContext {
    display: Display,
    config: EGLConfig,
    raw: EGLContext,
    surface: EGLSurface,
    // Contexts are thread-affine: raw pointers already make this !Send/!Sync;
    // the marker documents it.
    not_send: PhantomData<*mut ()>,
}

impl fmt::Debug for GlContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GlContext")
            .field("raw", &self.raw)
            .field("surface", &self.surface)
            .finish_non_exhaustive()
    }
}

impl GlContext {
    /// Largest pbuffer the context's config supports, `(width, height)`;
    /// `None` if EGL cannot report it.
    #[must_use]
    pub fn max_pbuffer_size(&self) -> Option<(i32, i32)> {
        self.display
            .config_attrib(self.config, EGL_MAX_PBUFFER_WIDTH)
            .zip(
                self.display
                    .config_attrib(self.config, EGL_MAX_PBUFFER_HEIGHT),
            )
    }

    /// Creates the context's pbuffer, replacing any previous one. Its initial
    /// contents are undefined. Must not be
    /// called while a [`Current`] for this context is alive (enforced by
    /// `&mut self`).
    ///
    /// # Errors
    ///
    /// Returns the failing EGL call and error code.
    pub fn attach_pbuffer(&mut self, width: i32, height: i32) -> Result<(), EglError> {
        let fns = self.display.angle.fns();
        // No EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE here: on the Metal
        // backend it crashes the first clear. Callers clear a new pbuffer.
        let attribs = [EGL_WIDTH, width, EGL_HEIGHT, height, EGL_NONE];
        // SAFETY: display and config are valid; the attribute list is
        // EGL_NONE-terminated and outlives the call.
        let surface = unsafe {
            (fns.eglCreatePbufferSurface)(self.display.raw, self.config, attribs.as_ptr())
        };
        if surface.is_null() {
            return Err(egl_error(&self.display.angle, "eglCreatePbufferSurface"));
        }
        LIVE_SURFACES.fetch_add(1, Ordering::SeqCst);
        self.release_if_current();
        self.destroy_surface();
        self.surface = surface;
        Ok(())
    }

    /// Makes this context current on the calling thread (with its pbuffer, or
    /// surfaceless before one is attached). Skips the EGL call when it already
    /// is current.
    ///
    /// # Errors
    ///
    /// Returns the EGL error; [`EglError::is_context_lost`] reports device loss.
    pub fn make_current(&self) -> Result<Current<'_>, EglError> {
        if !self.is_current() {
            let fns = self.display.angle.fns();
            // SAFETY: display, surface (or EGL_NO_SURFACE, allowed by
            // EGL_KHR_surfaceless_context) and context are valid and owned by
            // this object; the context is only used on this thread.
            let ok = unsafe {
                (fns.eglMakeCurrent)(self.display.raw, self.surface, self.surface, self.raw)
            };
            if ok == EGL_FALSE.cast_unsigned() {
                return Err(egl_error(&self.display.angle, "eglMakeCurrent"));
            }
        }
        Ok(Current { context: self })
    }

    fn is_current(&self) -> bool {
        let fns = self.display.angle.fns();
        // SAFETY: both queries have no preconditions.
        let context = unsafe { (fns.eglGetCurrentContext)() };
        // SAFETY: as above; EGL_DRAW is a valid argument.
        let surface = unsafe { (fns.eglGetCurrentSurface)(EGL_DRAW) };
        context == self.raw && surface == self.surface
    }

    fn release_if_current(&self) {
        let fns = self.display.angle.fns();
        // SAFETY: no preconditions.
        if unsafe { (fns.eglGetCurrentContext)() } == self.raw {
            // SAFETY: releasing the current context of the calling thread with
            // null surfaces and context is always valid. A failure leaves the
            // context current, and EGL then defers its destruction until it is
            // released, so nothing dangles.
            unsafe {
                (fns.eglMakeCurrent)(
                    self.display.raw,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
        }
    }

    fn destroy_surface(&mut self) {
        if !self.surface.is_null() {
            // SAFETY: the surface was created by this object and is destroyed
            // once; it is no longer current (released by the caller).
            unsafe { (self.display.angle.fns().eglDestroySurface)(self.display.raw, self.surface) };
            self.surface = ptr::null_mut();
            LIVE_SURFACES.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

impl Drop for GlContext {
    fn drop(&mut self) {
        self.release_if_current();
        self.destroy_surface();
        // SAFETY: the context was created by this object, is destroyed once,
        // and is no longer current on this thread.
        unsafe { (self.display.angle.fns().eglDestroyContext)(self.display.raw, self.raw) };
        LIVE_CONTEXTS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Proof that a [`GlContext`] is current on this thread; GLES calls go
/// through it.
pub struct Current<'a> {
    context: &'a GlContext,
}

impl fmt::Debug for Current<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("Current").field(&self.context.raw).finish()
    }
}

/// Arguments of a `glReadPixels` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadPixels {
    /// Left edge of the region.
    pub x: i32,
    /// Bottom edge of the region.
    pub y: i32,
    /// Region width.
    pub width: i32,
    /// Region height.
    pub height: i32,
    /// Pixel format enum.
    pub format: GLenum,
    /// Pixel type enum.
    pub ty: GLenum,
}

impl Current<'_> {
    pub(crate) fn fns(&self) -> &crate::loader::Fns {
        self.context.display.angle.fns()
    }

    /// `glClearColor`.
    pub fn clear_color(&self, red: f32, green: f32, blue: f32, alpha: f32) {
        // SAFETY: a context is current (type invariant); value arguments only.
        unsafe { (self.fns().glClearColor)(red, green, blue, alpha) };
    }

    /// `glClear`.
    pub fn clear(&self, mask: u32) {
        // SAFETY: a context is current (type invariant); value argument only.
        unsafe { (self.fns().glClear)(mask) };
    }

    /// `glGetError`.
    #[must_use]
    pub fn get_error(&self) -> GLenum {
        // SAFETY: a context is current (type invariant).
        unsafe { (self.fns().glGetError)() }
    }

    /// `glGetGraphicsResetStatusEXT`: `GL_NO_ERROR` unless the context was
    /// lost.
    #[must_use]
    pub fn graphics_reset_status(&self) -> GLenum {
        // SAFETY: a context is current (type invariant).
        unsafe { (self.fns().glGetGraphicsResetStatusEXT)() }
    }

    /// `glGetString`, copied into an owned string.
    #[must_use]
    pub fn get_string(&self, name: GLenum) -> Option<String> {
        // SAFETY: a context is current (type invariant); `name` is a value.
        let raw = unsafe { (self.fns().glGetString)(name) };
        if raw.is_null() {
            return None;
        }
        // SAFETY: a non-null result is a NUL-terminated string owned by the
        // context, valid until the context is destroyed; it is copied before
        // this borrow of the context ends.
        let text = unsafe { CStr::from_ptr(raw.cast::<c_char>()) };
        Some(text.to_string_lossy().into_owned())
    }

    /// `glReadPixels` into `buffer`, bounded by its length (ANGLE generates
    /// `GL_INVALID_OPERATION` rather than writing past it). Returns the number
    /// of bytes the read covers, `0` when it generated an error.
    pub fn read_pixels(&self, args: ReadPixels, buffer: &mut [u8]) -> usize {
        let Ok(len) = GLsizei::try_from(buffer.len()) else {
            return 0;
        };
        let mut length: GLsizei = 0;
        let mut columns: GLsizei = 0;
        let mut rows: GLsizei = 0;
        // SAFETY: a context is current; ANGLE writes at most `len` bytes into
        // `buffer` (robust client memory) and one GLsizei into each out-pointer.
        // `buffer` is Rust-owned and exclusively borrowed for the call.
        unsafe {
            (self.fns().glReadPixelsRobustANGLE)(
                args.x,
                args.y,
                args.width,
                args.height,
                args.format,
                args.ty,
                len,
                &raw mut length,
                &raw mut columns,
                &raw mut rows,
                buffer.as_mut_ptr().cast(),
            );
        };
        usize::try_from(length).unwrap_or(0)
    }

    /// Enables a requestable extension (`glRequestExtensionANGLE`).
    pub fn request_extension(&self, name: &CStr) {
        // SAFETY: a context is current; `name` is NUL-terminated and outlives
        // the call.
        unsafe { (self.fns().glRequestExtensionANGLE)(name.as_ptr()) };
    }

    /// `glLoseContextCHROMIUM`: simulates a device loss (requires
    /// `GL_CHROMIUM_lose_context`, see [`Current::request_extension`]).
    pub fn lose_context(&self, current: GLenum, other: GLenum) {
        // SAFETY: a context is current; value arguments only.
        unsafe { (self.fns().glLoseContextCHROMIUM)(current, other) };
    }
}
