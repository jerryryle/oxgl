//! Safe wrappers over the EGL and GLES calls oxgl makes.
//!
//! Invariants upheld here, so callers in `unsafe`-free crates cannot break them:
//! - A [`Display`] is an initialized ANGLE display. Displays are process-global
//!   in EGL and are never terminated.
//! - A [`GlContext`] owns its EGL context and destroys it on drop. Contexts
//!   are always current without a surface (`EGL_KHR_surfaceless_context`);
//!   rendering goes to framebuffer objects. A context is not `Send`: it is
//!   created, used, and dropped on one thread.
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
use std::sync::atomic::{AtomicI32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use std::cell::{Cell, RefCell};

use crate::bindings::{
    EGL_CONTEXT_BIND_GENERATES_RESOURCE_CHROMIUM, EGL_CONTEXT_CLIENT_ARRAYS_ENABLED_ANGLE,
    EGL_CONTEXT_CLIENT_VERSION, EGL_CONTEXT_LOST,
    EGL_CONTEXT_OPENGL_RESET_NOTIFICATION_STRATEGY_EXT, EGL_CONTEXT_OPENGL_ROBUST_ACCESS_EXT,
    EGL_CONTEXT_WEBGL_COMPATIBILITY_ANGLE, EGL_FALSE, EGL_LOSE_CONTEXT_ON_RESET_EXT, EGL_NONE,
    EGL_OPENGL_ES2_BIT, EGL_OPENGL_ES3_BIT, EGL_PLATFORM_ANGLE_ANGLE,
    EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE, EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE,
    EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE, EGL_PLATFORM_ANGLE_TYPE_ANGLE,
    EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE, EGL_RENDERABLE_TYPE,
    EGL_ROBUST_RESOURCE_INITIALIZATION_ANGLE, EGL_SURFACE_TYPE, EGL_TRUE, EGLAttrib, EGLConfig,
    EGLContext, EGLDisplay, EGLint, GLenum, GLsizei,
};
use crate::loader::Angle;

static LIVE_CONTEXTS: AtomicUsize = AtomicUsize::new(0);

/// `EGL_FEATURE_OVERRIDES_DISABLED_ANGLE`: a null-terminated list of ANGLE
/// feature names to disable.
#[cfg(target_os = "linux")]
const EGL_FEATURE_OVERRIDES_DISABLED_ANGLE: EGLAttrib = 0x3467;

/// `EGL_FEATURE_OVERRIDES_ENABLED_ANGLE`: as above, to enable.
#[cfg(target_os = "linux")]
const EGL_FEATURE_OVERRIDES_ENABLED_ANGLE: EGLAttrib = 0x3466;

/// A null-terminated list of C strings.
#[cfg(target_os = "linux")]
struct FeatureNames<const N: usize>([*const c_char; N]);

// SAFETY: the pointers are to immutable static strings.
#[cfg(target_os = "linux")]
unsafe impl<const N: usize> Sync for FeatureNames<N> {}

/// ANGLE features the OpenGL ES display disables. This one reads `RG16` as
/// `RG`/`UNSIGNED_SHORT`, a driver bug's workaround that Mesa refuses, since
/// Mesa's own read format for it is `RGBA`, and the error loses the context.
#[cfg(target_os = "linux")]
static GLES_DISABLED_FEATURES: FeatureNames<2> = FeatureNames([
    c"readPixelsUsingImplementationColorReadFormatForNorm16".as_ptr(),
    ptr::null(),
]);

/// ANGLE features the OpenGL ES display enables, for defects in Mesa or in
/// this backend (`angle/upstream-reports.md`).
#[cfg(target_os = "linux")]
static GLES_ENABLED_FEATURES: FeatureNames<5> = FeatureNames([
    // V3D filters sRGB mipmaps in encoded space.
    c"decodeEncodeSRGBForGenerateMipmap".as_ptr(),
    // Mesa compiles synchronously here, so the extension offers nothing.
    c"disableNativeParallelCompile".as_ptr(),
    // Mesa before 26 writes blit destinations from outside the source.
    c"clipSrcRegionForBlitFramebuffer".as_ptr(),
    // llvmpipe clips with clip distances even after they're disabled.
    c"emulateClipDistanceState".as_ptr(),
    ptr::null(),
]);

/// A key for a per-thread display, returned to the pool when dropped. It
/// starts at 1, since 0 is the null native display [`Display::open`] uses.
#[derive(Debug)]
struct DisplayKey(usize);

/// Keys free for reuse. A key's display stays initialized, so a later thread
/// reuses it: ANGLE leaks a little for each new key, even when terminated.
static FREE_DISPLAY_KEYS: Mutex<Vec<usize>> = Mutex::new(Vec::new());

/// The next key never used.
static NEXT_DISPLAY_KEY: AtomicUsize = AtomicUsize::new(1);

impl DisplayKey {
    fn take() -> Self {
        let free = FREE_DISPLAY_KEYS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop();
        Self(free.unwrap_or_else(|| NEXT_DISPLAY_KEY.fetch_add(1, Ordering::Relaxed)))
    }
}

impl Drop for DisplayKey {
    fn drop(&mut self) {
        FREE_DISPLAY_KEYS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(self.0);
    }
}

thread_local! {
    /// This thread's display, on backends with one per thread.
    static THREAD_DISPLAY: RefCell<Option<Display>> = const { RefCell::new(None) };
}

/// `EGL_CONTEXT_VIRTUALIZATION_GROUP_ANGLE`.
const EGL_CONTEXT_VIRTUALIZATION_GROUP_ANGLE: EGLint = 0x3481;

/// The next thread's virtualization group.
static NEXT_VIRTUALIZATION_GROUP: AtomicI32 = AtomicI32::new(1);

thread_local! {
    /// This thread's virtualization group. ANGLE's OpenGL ES backend puts a
    /// group's contexts on one native context, which only one thread can have
    /// current, so a group per thread lets each thread hold contexts.
    static VIRTUALIZATION_GROUP: EGLint =
        NEXT_VIRTUALIZATION_GROUP.fetch_add(1, Ordering::Relaxed);
}

/// Whether `kind` is the OpenGL ES backend's display.
fn is_gles(kind: DisplayKind) -> bool {
    #[cfg(target_os = "linux")]
    {
        matches!(kind, DisplayKind::Gles)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = kind;
        false
    }
}

/// `EGL_DONT_CARE`, `((EGLint)-1)` in the headers: a cast macro bindgen skips.
const EGL_DONT_CARE: EGLint = -1;

thread_local! {
    /// The context this crate last made current on this thread, or null.
    /// Every `eglMakeCurrent` in the process goes through this crate (the
    /// bundle is private to oxgl), so this mirrors EGL's current context
    /// without querying it on every GL call.
    static CURRENT: Cell<EGLContext> = const { Cell::new(ptr::null_mut()) };
}

/// Number of EGL contexts created by this crate and not yet destroyed.
#[must_use]
pub fn live_contexts() -> usize {
    LIVE_CONTEXTS.load(Ordering::SeqCst)
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
    /// ANGLE's OpenGL ES backend on the system's EGL driver, reached through
    /// Mesa's surfaceless platform. ANGLE opens `libEGL.so.1` only when this
    /// display is initialized.
    #[cfg(target_os = "linux")]
    Gles,
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
    /// Shared by every clone of this handle, contexts' included, so
    /// [`Display::terminate`] can tell whether it holds the only one. It
    /// counts this open's handles only: another `Display::open` that ANGLE
    /// maps to the same display (on Linux, the GPU and `SwiftShader` kinds)
    /// has its own.
    handles: Arc<()>,
    /// Which display this is.
    kind: DisplayKind,
    /// The key this display holds, shared by its clones, which goes back to
    /// the pool with the last of them; `None` for the key [`Display::open`]
    /// uses, which is never pooled.
    _key: Option<Arc<DisplayKey>>,
}

// SAFETY: an EGLDisplay is a process-global handle, and EGL requires display
// functions to be callable from any thread (EGL 1.5 §2.6), and an initialized
// display is usable from every thread of the process (§3.2); ANGLE locks
// internally. `Angle` is an `Arc` of immutable function pointers, and
// `handles` an `Arc<()>`.
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
        Self::open_keyed(angle, kind, None)
    }

    /// Opens the display for `key`: ANGLE keeps one display per platform
    /// attribute list and native display value, and the Metal backend takes
    /// the value as an opaque key. `None` is the null native display.
    fn open_keyed(
        angle: &Angle,
        kind: DisplayKind,
        key: Option<Arc<DisplayKey>>,
    ) -> Result<Self, EglError> {
        let fns = angle.fns();
        let native_display = ptr::without_provenance_mut(key.as_ref().map_or(0, |key| key.0));
        // Only the OpenGL ES backend adds attributes; elsewhere EGL_NONE in
        // their place ends the list.
        let none = EGL_NONE as EGLAttrib;
        let (platform, device, extra) = match kind {
            DisplayKind::Gpu => (
                GPU_PLATFORM,
                EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE,
                [none; 6],
            ),
            DisplayKind::SwiftShader => (
                EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE,
                EGL_PLATFORM_ANGLE_DEVICE_TYPE_SWIFTSHADER_ANGLE,
                [none; 6],
            ),
            #[cfg(target_os = "linux")]
            DisplayKind::Gles => (
                crate::bindings::EGL_PLATFORM_ANGLE_TYPE_OPENGLES_ANGLE,
                EGL_PLATFORM_ANGLE_DEVICE_TYPE_HARDWARE_ANGLE,
                [
                    crate::bindings::EGL_PLATFORM_ANGLE_NATIVE_PLATFORM_TYPE_ANGLE as EGLAttrib,
                    crate::bindings::EGL_PLATFORM_SURFACELESS_MESA as EGLAttrib,
                    EGL_FEATURE_OVERRIDES_DISABLED_ANGLE,
                    GLES_DISABLED_FEATURES
                        .0
                        .as_ptr()
                        .expose_provenance()
                        .cast_signed(),
                    EGL_FEATURE_OVERRIDES_ENABLED_ANGLE,
                    GLES_ENABLED_FEATURES
                        .0
                        .as_ptr()
                        .expose_provenance()
                        .cast_signed(),
                ],
            ),
        };
        let attribs = [
            EGL_PLATFORM_ANGLE_TYPE_ANGLE as EGLAttrib,
            platform as EGLAttrib,
            EGL_PLATFORM_ANGLE_DEVICE_TYPE_ANGLE as EGLAttrib,
            device as EGLAttrib,
            extra[0],
            extra[1],
            extra[2],
            extra[3],
            extra[4],
            extra[5],
            none,
        ];
        // SAFETY: the attribute list is EGL_NONE-terminated and outlives the
        // call, and the feature list it may point to is static, as ANGLE keeps
        // the pointer; ANGLE platforms take any native display value, and use
        // it only as a key.
        let raw = unsafe {
            (fns.eglGetPlatformDisplay)(
                EGL_PLATFORM_ANGLE_ANGLE.cast_unsigned(),
                native_display,
                attribs.as_ptr(),
            )
        };
        if raw.is_null() {
            return Err(egl_error(angle, "eglGetPlatformDisplay"));
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
            handles: Arc::new(()),
            kind,
            _key: key,
        })
    }

    /// The display this thread creates contexts on. That is `self`, except on
    /// Metal, where each thread gets its own: ANGLE's Metal backend shares
    /// its command queue and state caches across a display's contexts without
    /// a lock. Threads sharing one read stale pixels and can crash the
    /// process. A thread's display goes back to a pool when the thread and
    /// its contexts are gone, so the number of displays follows the peak
    /// number of threads.
    ///
    /// # Errors
    ///
    /// Returns the failing EGL call and error code.
    pub fn for_this_thread(&self) -> Result<Self, EglError> {
        // Metal's displays are not safe to share between threads.
        if !(cfg!(target_os = "macos") && matches!(self.kind, DisplayKind::Gpu)) {
            return Ok(self.clone());
        }
        THREAD_DISPLAY.with(|slot| {
            if let Some(display) = slot.borrow().as_ref() {
                return Ok(display.clone());
            }
            let key = Arc::new(DisplayKey::take());
            let display = Self::open_keyed(&self.angle, self.kind, Some(key))?;
            *slot.borrow_mut() = Some(display.clone());
            Ok(display)
        })
    }

    /// Terminates the display, so that it holds no device. ANGLE keeps the
    /// display itself, and initializes it again, possibly on another device,
    /// when it is next opened. Does nothing while another handle from the
    /// same open exists, such as a clone or a live context's. Handles from
    /// another open of the same ANGLE display are not seen, so the caller
    /// must ensure none is in use (on Linux, `oxgl-core`'s backend cache
    /// never opens the GPU kind while `SwiftShader` holds the display).
    pub fn terminate(self) {
        if Arc::strong_count(&self.handles) > 1 {
            return;
        }
        // SAFETY: `raw` is a display returned by eglGetPlatformDisplay.
        // eglTerminate accepts any valid display, initialized or not, and
        // later calls on a terminated display fail with EGL_NOT_INITIALIZED
        // (EGL 1.5 §3.2) rather than misbehave. Its result is ignored: the
        // only failure is EGL_BAD_DISPLAY, which `raw` rules out.
        unsafe { (self.angle.fns().eglTerminate)(self.raw) };
    }

    /// Creates a WebGL-compatible, surfaceless context for `version`.
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
            if is_gles(self.kind) {
                EGL_CONTEXT_VIRTUALIZATION_GROUP_ANGLE
            } else {
                EGL_NONE
            },
            VIRTUALIZATION_GROUP.with(|group| *group),
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
            raw,
            not_send: PhantomData,
        })
    }

    /// Whether the display offers a config for `version`. ANGLE offers no
    /// OpenGL ES 3 config on a device it caps at OpenGL ES 2.0.
    #[must_use]
    pub fn supports(&self, version: ClientVersion) -> bool {
        let renderable = match version {
            ClientVersion::Es2 => EGL_OPENGL_ES2_BIT,
            ClientVersion::Es3 => EGL_OPENGL_ES3_BIT,
        };
        self.choose_config(renderable).is_ok()
    }

    /// Picks a config that can create a context of the `renderable` API. The
    /// context is used surfaceless, so the config's buffers are irrelevant.
    /// `EGL_SURFACE_TYPE` defaults to `EGL_WINDOW_BIT`, which no config of
    /// the OpenGL ES display has: Mesa's surfaceless configs are pbuffer-only.
    fn choose_config(&self, renderable: EGLint) -> Result<EGLConfig, EglError> {
        let fns = self.angle.fns();
        let attribs = [
            EGL_RENDERABLE_TYPE,
            renderable,
            EGL_SURFACE_TYPE,
            EGL_DONT_CARE,
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
        configs
            .get(..usize::try_from(count).unwrap_or(0))
            .and_then(|found| found.first().copied())
            .ok_or(EglError {
                call: "eglChooseConfig",
                code: crate::bindings::EGL_BAD_MATCH,
            })
    }
}

fn egl_error(angle: &Angle, call: &'static str) -> EglError {
    // SAFETY: eglGetError has no preconditions.
    let code = unsafe { (angle.fns().eglGetError)() };
    EglError { call, code }
}

/// An EGL context, destroyed on drop.
pub struct GlContext {
    display: Display,
    raw: EGLContext,
    // Contexts are thread-affine: raw pointers already make this !Send/!Sync;
    // the marker documents it.
    not_send: PhantomData<*mut ()>,
}

impl fmt::Debug for GlContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GlContext")
            .field("raw", &self.raw)
            .finish_non_exhaustive()
    }
}

impl GlContext {
    /// Makes this context current on the calling thread, without a surface.
    /// Skips the EGL call when it already is current.
    ///
    /// # Errors
    ///
    /// Returns the EGL error; [`EglError::is_context_lost`] reports device loss.
    pub fn make_current(&self) -> Result<Current<'_>, EglError> {
        if CURRENT.get() != self.raw {
            let fns = self.display.angle.fns();
            // SAFETY: display and context are valid and owned by this object;
            // EGL_NO_SURFACE for both surfaces is allowed by
            // EGL_KHR_surfaceless_context, which ANGLE always exposes. The
            // context is only used on this thread.
            let ok = unsafe {
                (fns.eglMakeCurrent)(self.display.raw, ptr::null_mut(), ptr::null_mut(), self.raw)
            };
            if ok == EGL_FALSE.cast_unsigned() {
                let error = egl_error(&self.display.angle, "eglMakeCurrent");
                // The previous context usually stays current, but not after
                // every error; ask EGL which one is.
                // SAFETY: no preconditions.
                CURRENT.set(unsafe { (fns.eglGetCurrentContext)() });
                return Err(error);
            }
            CURRENT.set(self.raw);
        }
        Ok(Current { context: self })
    }

    fn release_if_current(&self) {
        if CURRENT.get() != self.raw {
            return;
        }
        CURRENT.set(ptr::null_mut());
        // SAFETY: releasing the current context of the calling thread with
        // null surfaces and context is always valid. A failure leaves the
        // context current, and EGL then defers its destruction until it is
        // released, so nothing dangles.
        unsafe {
            (self.display.angle.fns().eglMakeCurrent)(
                self.display.raw,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
    }
}

impl Drop for GlContext {
    fn drop(&mut self) {
        self.release_if_current();
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
