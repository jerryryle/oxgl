//! Backend selection: the platform GPU backend or `SwiftShader`, with `auto`
//! fallback and process-lifetime caching of displays and GPU failures. On
//! Linux, a WebGL 2 request uses ANGLE's OpenGL ES backend when the Vulkan GPU
//! offers OpenGL ES 2.0 only.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use oxgl_sys::bindings::GL_RENDERER;
use oxgl_sys::{Angle, ClientVersion, Display, DisplayKind};

use crate::drawing_buffer::DrawingBuffer;
use crate::error::CoreError;

/// The backend a caller asked for, after the `OXGL_BACKEND` override.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestedBackend {
    /// GPU if usable, else software.
    Auto,
    /// GPU only.
    Gpu,
    /// `SwiftShader` only.
    Software,
    /// Test-only: ANGLE's OpenGL ES backend for every request, accepting a
    /// CPU renderer, with no fallback. The Node binding offers it only in a
    /// build with its `test-gles` feature, on Linux.
    Gles,
}

/// A concrete backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// The platform's native GPU backend.
    Gpu,
    /// `SwiftShader`.
    Software,
    /// ANGLE's OpenGL ES backend on the system's EGL driver (Linux).
    Gles,
}

/// What a context is created for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContextRequest {
    /// Requested drawing buffer width (a positive integer).
    pub width: f64,
    /// Requested drawing buffer height (a positive integer).
    pub height: f64,
    /// WebGL 2 (OpenGL ES 3.0) instead of WebGL 1.
    pub webgl2: bool,
    /// The requested context attributes.
    pub attributes: crate::drawing_buffer::Attributes,
}

/// Renderer names of CPU implementations, which never count as a GPU.
const CPU_RENDERERS: [&str; 8] = [
    "swiftshader",
    "llvmpipe",
    "lavapipe",
    "softpipe",
    "swrast",
    "software rasterizer",
    "microsoft basic render driver",
    "warp",
];

/// Whether `renderer` (a `GL_RENDERER` string) names a CPU implementation.
#[must_use]
pub fn is_cpu_renderer(renderer: &str) -> bool {
    let renderer = renderer.to_ascii_lowercase();
    CPU_RENDERERS.iter().any(|cpu| renderer.contains(cpu))
}

/// The backend operations selection needs; implemented over ANGLE, and by a
/// fake in tests.
pub trait BackendProbe {
    /// An initialized display.
    type Display: Clone;
    /// A created context.
    type Context;
    /// Opens and initializes the display for `backend`.
    ///
    /// # Errors
    ///
    /// Describes why the display is unusable.
    fn open_display(&self, backend: Backend) -> Result<Self::Display, String>;
    /// The `GL_RENDERER` of a throwaway context on `display`.
    ///
    /// # Errors
    ///
    /// Describes why no context could be created.
    fn renderer(&self, display: &Self::Display) -> Result<String, String>;
    /// Whether `display` offers an OpenGL ES 3.0 config.
    fn supports_es3(&self, display: &Self::Display) -> bool;
    /// Creates a context for `request` on `display`.
    ///
    /// # Errors
    ///
    /// Describes why the context could not be created.
    fn create_context(
        &self,
        display: &Self::Display,
        request: &ContextRequest,
    ) -> Result<Self::Context, String>;
}

/// An initialized display and what selection needs to know about it.
#[derive(Debug, Clone)]
struct Opened<D> {
    display: D,
    /// `GL_RENDERER`, for the GPU displays; empty for `SwiftShader`.
    renderer: String,
    /// Whether the display offers OpenGL ES 3.0.
    es3: bool,
}

type Slot<D> = Option<Result<Opened<D>, String>>;

/// Per-backend display cache. Each backend is opened at most once per
/// process, and an initialization failure is kept for the rest of the
/// process (an accepted trade-off, see the backend-selection spec). So is a
/// GPU display whose renderer is a CPU implementation: its renderer is kept,
/// and every use but the test-only [`RequestedBackend::Gles`] refuses it.
#[derive(Debug)]
pub struct Backends<P: BackendProbe> {
    probe: P,
    gpu: Slot<P::Display>,
    software: Slot<P::Display>,
    gles: Slot<P::Display>,
    /// Whether a WebGL 2 request may use the OpenGL ES backend when the GPU
    /// display offers OpenGL ES 2.0 only: on Linux, where the GPU backend is
    /// Vulkan.
    gles_fallback: bool,
}

impl<P: BackendProbe> Backends<P> {
    /// A cache with nothing opened yet.
    pub fn new(probe: P) -> Self {
        Self {
            probe,
            gpu: None,
            software: None,
            gles: None,
            gles_fallback: cfg!(target_os = "linux"),
        }
    }

    /// The probe, for tests that inspect it.
    pub fn probe(&self) -> &P {
        &self.probe
    }

    /// The opened display for `backend`, opening it on first use.
    fn opened(&mut self, backend: Backend) -> Result<Opened<P::Display>, String> {
        let probe = &self.probe;
        let slot = match backend {
            Backend::Gpu => &mut self.gpu,
            Backend::Software => &mut self.software,
            Backend::Gles => &mut self.gles,
        };
        slot.get_or_insert_with(|| {
            let display = probe.open_display(backend)?;
            let renderer = match backend {
                Backend::Software => String::new(),
                Backend::Gpu | Backend::Gles => probe.renderer(&display)?,
            };
            let es3 = probe.supports_es3(&display);
            Ok(Opened {
                display,
                renderer,
                es3,
            })
        })
        .clone()
    }

    /// The opened display for a GPU backend, refusing a CPU renderer.
    fn gpu_display(&mut self, backend: Backend) -> Result<Opened<P::Display>, String> {
        let opened = self.opened(backend)?;
        if is_cpu_renderer(&opened.renderer) {
            return Err(format!(
                "the GPU backend renders on a CPU ({})",
                opened.renderer
            ));
        }
        Ok(opened)
    }

    /// Creates a context on a GPU backend: the platform's, or on Linux, for a
    /// WebGL 2 request on a GPU display with OpenGL ES 2.0 only, the OpenGL
    /// ES backend. A context-creation failure fails only this call: it can
    /// come from normal use (out of GPU memory), unlike a display failure.
    /// The error names each backend tried.
    fn try_gpu(&mut self, request: &ContextRequest) -> Result<(Backend, P::Context), String> {
        let gpu = self
            .gpu_display(Backend::Gpu)
            .map_err(|cause| format!("{}: {cause}", gpu_name()))?;
        if request.webgl2 && self.gles_fallback && !gpu.es3 {
            let tried = format!("{}: offers OpenGL ES 2.0 only; OpenGL ES", gpu_name());
            let gles = self
                .gpu_display(Backend::Gles)
                .map_err(|cause| format!("{tried}: {cause}"))?;
            return self
                .probe
                .create_context(&gles.display, request)
                .map(|context| (Backend::Gles, context))
                .map_err(|cause| format!("{tried}: {cause}"));
        }
        self.probe
            .create_context(&gpu.display, request)
            .map(|context| (Backend::Gpu, context))
            .map_err(|cause| format!("{}: {cause}", gpu_name()))
    }

    /// Creates a context on `backend`'s display, accepting any renderer; the
    /// error is prefixed with `name`.
    fn try_on(
        &mut self,
        backend: Backend,
        name: &str,
        request: &ContextRequest,
    ) -> Result<(Backend, P::Context), String> {
        self.opened(backend)
            .and_then(|opened| self.probe.create_context(&opened.display, request))
            .map(|context| (backend, context))
            .map_err(|cause| format!("{name}: {cause}"))
    }

    /// Creates a context on the backend `requested` resolves to.
    ///
    /// # Errors
    ///
    /// [`CoreError::GpuUnavailable`] when `Gpu` was requested and failed;
    /// [`CoreError::ContextCreationFailed`] when every candidate failed.
    pub fn create(
        &mut self,
        requested: RequestedBackend,
        request: &ContextRequest,
    ) -> Result<(Backend, P::Context), CoreError> {
        match requested {
            RequestedBackend::Gpu => self.try_gpu(request).map_err(CoreError::GpuUnavailable),
            RequestedBackend::Software => self
                .try_on(Backend::Software, "SwiftShader", request)
                .map_err(CoreError::ContextCreationFailed),
            RequestedBackend::Auto => match self.try_gpu(request) {
                Ok(created) => Ok(created),
                Err(gpu) => self
                    .try_on(Backend::Software, "SwiftShader", request)
                    .map_err(|software| {
                        CoreError::ContextCreationFailed(format!("{gpu}; {software}"))
                    }),
            },
            RequestedBackend::Gles => self
                .try_on(Backend::Gles, "OpenGL ES", request)
                .map_err(CoreError::ContextCreationFailed),
        }
    }
}

/// Name of the platform GPU backend, for messages.
fn gpu_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "Metal"
    } else if cfg!(windows) {
        "D3D11"
    } else {
        "Vulkan"
    }
}

/// A failure to open the OpenGL ES display. ANGLE's own reason (such as no
/// `libEGL.so.1` to open) stays in its log; EGL returns only a code, so the
/// message says what the backend needs.
fn gles_open_error(cause: &str) -> String {
    format!(
        "{cause}; the OpenGL ES backend needs the system's EGL driver (libEGL.so.1, from Mesa's libegl1 and libegl-mesa0)"
    )
}

/// The ANGLE implementation of [`BackendProbe`].
#[derive(Debug, Clone)]
pub struct AngleProbe {
    angle: Angle,
}

impl AngleProbe {
    /// A probe over a loaded bundle.
    #[must_use]
    pub fn new(angle: Angle) -> Self {
        Self { angle }
    }
}

impl BackendProbe for AngleProbe {
    type Display = Display;
    type Context = DrawingBuffer;

    fn open_display(&self, backend: Backend) -> Result<Display, String> {
        let kind = match backend {
            Backend::Gpu => DisplayKind::Gpu,
            Backend::Software => DisplayKind::SwiftShader,
            #[cfg(target_os = "linux")]
            Backend::Gles => DisplayKind::Gles,
            #[cfg(not(target_os = "linux"))]
            Backend::Gles => return Err("ANGLE's OpenGL ES backend is used only on Linux".into()),
        };
        Display::open(&self.angle, kind).map_err(|e| match backend {
            Backend::Gles => gles_open_error(&e.to_string()),
            Backend::Gpu | Backend::Software => e.to_string(),
        })
    }

    fn renderer(&self, display: &Display) -> Result<String, String> {
        let context = display
            .create_context(ClientVersion::Es2)
            .map_err(|e| e.to_string())?;
        let current = context.make_current().map_err(|e| e.to_string())?;
        current
            .get_string(GL_RENDERER)
            .ok_or_else(|| "GL_RENDERER is unavailable".to_owned())
    }

    fn supports_es3(&self, display: &Display) -> bool {
        display.supports(ClientVersion::Es3)
    }

    fn create_context(
        &self,
        display: &Display,
        request: &ContextRequest,
    ) -> Result<DrawingBuffer, String> {
        DrawingBuffer::new(display, request)
    }
}

/// The process-wide backend cache. EGL displays are process-global, so every
/// Node-API environment (main thread and workers) shares it.
static BACKENDS: Mutex<Option<Backends<AngleProbe>>> = Mutex::new(None);

/// Creates a drawing buffer through the process-wide cache, loading the ANGLE
/// bundle from `lib_dir` on first use.
///
/// # Errors
///
/// [`CoreError::NativeMissing`] when the bundle cannot be loaded (retried on
/// the next call), else as [`Backends::create`].
pub fn create_drawing_buffer(
    lib_dir: &Path,
    requested: RequestedBackend,
    request: &ContextRequest,
) -> Result<(Backend, DrawingBuffer), CoreError> {
    let mut guard = BACKENDS.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(backends) = guard.as_mut() {
        return backends.create(requested, request);
    }
    let angle = Angle::load(lib_dir).map_err(|e| CoreError::NativeMissing(e.to_string()))?;
    guard
        .insert(Backends::new(AngleProbe::new(angle)))
        .create(requested, request)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    /// Records every call; each backend succeeds or fails as configured.
    #[derive(Default)]
    struct FakeProbe {
        gpu_display: Option<String>,
        gpu_renderer: Option<String>,
        gpu_context: Option<String>,
        /// The GPU display offers OpenGL ES 2.0 only.
        gpu_es2_only: bool,
        software_display: Option<String>,
        gles_display: Option<String>,
        gles_renderer: Option<String>,
        calls: RefCell<Vec<String>>,
    }

    impl FakeProbe {
        fn working_gpu() -> Self {
            Self {
                gpu_renderer: Some("ANGLE (Apple, M2, Metal)".into()),
                ..Self::default()
            }
        }

        /// A Raspberry Pi 5: Vulkan gives OpenGL ES 2.0 only, Mesa's GL
        /// driver gives 3.0.
        fn es2_only_vulkan() -> Self {
            Self {
                gpu_renderer: Some(
                    "ANGLE (Broadcom, Vulkan 1.3.354 (V3D 7.1.10.2 (0x55701C33)), V3DV Mesa)"
                        .into(),
                ),
                gpu_es2_only: true,
                gles_renderer: Some("ANGLE (Broadcom, V3D 7.1.10.2, OpenGL ES 3.1)".into()),
                ..Self::default()
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }

        fn count(&self, call: &str) -> usize {
            self.calls.borrow().iter().filter(|c| *c == call).count()
        }
    }

    impl BackendProbe for FakeProbe {
        type Display = Backend;
        type Context = Backend;

        fn open_display(&self, backend: Backend) -> Result<Backend, String> {
            self.calls.borrow_mut().push(format!("open {backend:?}"));
            let failure = match backend {
                Backend::Gpu => &self.gpu_display,
                Backend::Software => &self.software_display,
                Backend::Gles => &self.gles_display,
            };
            failure.clone().map_or(Ok(backend), Err)
        }

        fn renderer(&self, display: &Backend) -> Result<String, String> {
            self.calls
                .borrow_mut()
                .push(format!("renderer {display:?}"));
            let renderer = match display {
                Backend::Gles => self.gles_renderer.clone(),
                _ => self.gpu_renderer.clone(),
            };
            Ok(renderer
                .unwrap_or_else(|| "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))".into()))
        }

        fn supports_es3(&self, display: &Backend) -> bool {
            !(*display == Backend::Gpu && self.gpu_es2_only)
        }

        fn create_context(&self, display: &Backend, _: &ContextRequest) -> Result<Backend, String> {
            self.calls.borrow_mut().push(format!("create {display:?}"));
            match display {
                Backend::Gpu => self.gpu_context.clone().map_or(Ok(Backend::Gpu), Err),
                Backend::Software | Backend::Gles => Ok(*display),
            }
        }
    }

    const REQUEST: ContextRequest = ContextRequest {
        width: 4.0,
        height: 4.0,
        webgl2: false,
        attributes: crate::drawing_buffer::Attributes::DEFAULT,
    };

    const WEBGL2: ContextRequest = ContextRequest {
        webgl2: true,
        ..REQUEST
    };

    /// Backends as on Linux, where WebGL 2 may fall back to OpenGL ES.
    fn linux(probe: FakeProbe) -> Backends<FakeProbe> {
        Backends {
            gles_fallback: true,
            ..Backends::new(probe)
        }
    }

    fn no_gpu() -> FakeProbe {
        FakeProbe {
            gpu_display: Some("eglInitialize failed (EGL error 0x3001)".into()),
            ..FakeProbe::default()
        }
    }

    #[test]
    fn deny_list_matches_cpu_renderers() {
        assert!(is_cpu_renderer(
            "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))"
        ));
        assert!(is_cpu_renderer(
            "ANGLE (Mesa, llvmpipe (LLVM 17.0.6, 256 bits))"
        ));
        assert!(is_cpu_renderer("ANGLE (Mesa, Vulkan 1.3 (lavapipe))"));
        assert!(is_cpu_renderer(
            "ANGLE (Microsoft, Microsoft Basic Render Driver, D3D11)"
        ));
        assert!(!is_cpu_renderer(
            "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Version 15)"
        ));
        assert!(!is_cpu_renderer(
            "ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA GeForce RTX 4090))"
        ));
    }

    #[test]
    fn auto_prefers_a_working_gpu() {
        let mut backends = Backends::new(FakeProbe::working_gpu());
        let (backend, _) = backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        assert_eq!(backend, Backend::Gpu);
    }

    #[test]
    fn auto_falls_back_without_a_gpu() {
        let mut backends = Backends::new(no_gpu());
        let (backend, _) = backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        assert_eq!(backend, Backend::Software);
    }

    #[test]
    fn gpu_without_a_gpu_is_unavailable() {
        let mut backends = Backends::new(no_gpu());
        let error = backends
            .create(RequestedBackend::Gpu, &REQUEST)
            .unwrap_err();
        assert!(
            matches!(&error, CoreError::GpuUnavailable(m) if m.contains("0x3001")),
            "{error}"
        );
        assert_eq!(error.code(), "OXGL_GPU_UNAVAILABLE");
        assert!(
            !backends
                .probe()
                .calls()
                .iter()
                .any(|c| c.contains("Software"))
        );
    }

    #[test]
    fn cpu_renderer_is_not_a_gpu() {
        let mut backends = Backends::new(FakeProbe::default());
        assert!(matches!(
            backends.create(RequestedBackend::Gpu, &REQUEST),
            Err(CoreError::GpuUnavailable(m)) if m.contains("SwiftShader")
        ));
        let (backend, _) = backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        assert_eq!(backend, Backend::Software);
    }

    #[test]
    fn software_never_touches_the_gpu() {
        let mut backends = Backends::new(FakeProbe::working_gpu());
        let (backend, _) = backends
            .create(RequestedBackend::Software, &REQUEST)
            .unwrap();
        assert_eq!(backend, Backend::Software);
        assert_eq!(
            backends.probe().calls(),
            ["open Software", "create Software"]
        );
    }

    #[test]
    fn gpu_failure_is_not_retried() {
        let mut backends = Backends::new(no_gpu());
        backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        assert!(backends.create(RequestedBackend::Gpu, &REQUEST).is_err());
        let opens = backends
            .probe()
            .calls()
            .iter()
            .filter(|c| *c == "open Gpu")
            .count();
        assert_eq!(opens, 1);
    }

    #[test]
    fn gpu_context_failure_fails_only_that_call() {
        let mut backends = Backends::new(FakeProbe {
            gpu_context: Some("eglCreateContext failed (EGL error 0x3003)".into()),
            ..FakeProbe::working_gpu()
        });
        let (backend, _) = backends.create(RequestedBackend::Auto, &REQUEST).unwrap();
        assert_eq!(backend, Backend::Software);
        assert!(matches!(
            backends.create(RequestedBackend::Gpu, &REQUEST),
            Err(CoreError::GpuUnavailable(m)) if m.contains("0x3003")
        ));
        let creates = backends
            .probe()
            .calls()
            .iter()
            .filter(|c| *c == "create Gpu")
            .count();
        assert_eq!(creates, 2, "each call retries context creation");
        let opens = backends
            .probe()
            .calls()
            .iter()
            .filter(|c| *c == "open Gpu")
            .count();
        assert_eq!(opens, 1, "the display is still opened once");
    }

    #[test]
    fn displays_are_opened_once() {
        let mut backends = Backends::new(FakeProbe::working_gpu());
        for _ in 0..3 {
            backends.create(RequestedBackend::Gpu, &REQUEST).unwrap();
            backends
                .create(RequestedBackend::Software, &REQUEST)
                .unwrap();
        }
        let calls = backends.probe().calls();
        assert_eq!(calls.iter().filter(|c| c.starts_with("open")).count(), 2);
        assert_eq!(
            calls.iter().filter(|c| c.starts_with("renderer")).count(),
            1
        );
    }

    #[test]
    fn everything_failing_is_a_creation_failure() {
        let mut backends = Backends::new(FakeProbe {
            software_display: Some("no Vulkan ICD".into()),
            ..no_gpu()
        });
        let error = backends
            .create(RequestedBackend::Auto, &REQUEST)
            .unwrap_err();
        assert_eq!(error.code(), "OXGL_CONTEXT_CREATION_FAILED");
        assert!(error.to_string().contains("no Vulkan ICD"));
    }

    #[test]
    fn webgl2_on_es2_only_vulkan_uses_gles() {
        for requested in [RequestedBackend::Gpu, RequestedBackend::Auto] {
            let mut backends = linux(FakeProbe::es2_only_vulkan());
            let (backend, _) = backends.create(requested, &WEBGL2).unwrap();
            assert_eq!(backend, Backend::Gles, "{requested:?}");
        }
    }

    #[test]
    fn webgl1_on_es2_only_vulkan_stays_on_vulkan() {
        let mut backends = linux(FakeProbe::es2_only_vulkan());
        let (backend, _) = backends.create(RequestedBackend::Gpu, &REQUEST).unwrap();
        assert_eq!(backend, Backend::Gpu);
        assert_eq!(backends.probe().count("open Gles"), 0);
    }

    #[test]
    fn vulkan_with_es3_never_opens_gles() {
        let mut backends = linux(FakeProbe::working_gpu());
        let (backend, _) = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap();
        assert_eq!(backend, Backend::Gpu);
        assert_eq!(backends.probe().count("open Gles"), 0);
    }

    #[test]
    fn gles_needs_the_fallback() {
        let mut backends = Backends {
            gles_fallback: false,
            ..Backends::new(FakeProbe::es2_only_vulkan())
        };
        let (backend, _) = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap();
        assert_eq!(
            backend,
            Backend::Gpu,
            "elsewhere the GPU backend's own error stands"
        );
        assert_eq!(backends.probe().count("open Gles"), 0);
    }

    #[test]
    fn failed_or_cpu_vulkan_never_opens_gles() {
        for probe in [
            no_gpu(),
            FakeProbe {
                gpu_renderer: Some(
                    "ANGLE (Mesa, Vulkan 1.3 (llvmpipe (LLVM 19.1.7 128 bits)))".into(),
                ),
                gpu_es2_only: true,
                ..FakeProbe::default()
            },
        ] {
            let mut backends = linux(probe);
            let error = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap_err();
            assert_eq!(error.code(), "OXGL_GPU_UNAVAILABLE");
            let (backend, _) = backends.create(RequestedBackend::Auto, &WEBGL2).unwrap();
            assert_eq!(backend, Backend::Software);
            assert_eq!(backends.probe().count("open Gles"), 0);
        }
    }

    #[test]
    fn cpu_gles_renderer_is_refused_with_both_backends_named() {
        let renderer = "ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2)";
        let mut backends = linux(FakeProbe {
            gles_renderer: Some(renderer.into()),
            ..FakeProbe::es2_only_vulkan()
        });
        let error = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap_err();
        assert_eq!(error.code(), "OXGL_GPU_UNAVAILABLE");
        let message = error.to_string();
        let es2_only = format!("{}: offers OpenGL ES 2.0 only", gpu_name());
        assert!(message.contains(&es2_only), "{message}");
        assert!(
            message.contains("OpenGL ES: the GPU backend renders on a CPU"),
            "{message}"
        );
        assert!(message.contains(renderer), "{message}");
        let (backend, _) = backends.create(RequestedBackend::Auto, &WEBGL2).unwrap();
        assert_eq!(backend, Backend::Software);
    }

    #[test]
    fn gles_display_failure_is_named_and_remembered() {
        let mut backends = linux(FakeProbe {
            gles_display: Some(gles_open_error("eglInitialize failed (EGL error 0x3001)")),
            ..FakeProbe::es2_only_vulkan()
        });
        let error = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap_err();
        let message = error.to_string();
        assert!(
            message.contains("OpenGL ES: eglInitialize failed (EGL error 0x3001)"),
            "{message}"
        );
        assert!(message.contains("libEGL.so.1"), "{message}");
        for _ in 0..2 {
            let (backend, _) = backends.create(RequestedBackend::Auto, &WEBGL2).unwrap();
            assert_eq!(backend, Backend::Software);
        }
        assert_eq!(backends.probe().count("open Gles"), 1);
        assert_eq!(backends.probe().count("open Gpu"), 1);
    }

    #[test]
    fn vulkan_es3_context_failure_does_not_divert() {
        let mut backends = linux(FakeProbe {
            gpu_context: Some("eglCreateContext failed (EGL error 0x3003)".into()),
            ..FakeProbe::working_gpu()
        });
        let error = backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap_err();
        assert!(error.to_string().contains("0x3003"), "{error}");
        assert_eq!(backends.probe().count("open Gles"), 0);
    }

    #[test]
    fn gles_display_opens_once() {
        let mut backends = linux(FakeProbe::es2_only_vulkan());
        for _ in 0..3 {
            backends.create(RequestedBackend::Gpu, &WEBGL2).unwrap();
            backends.create(RequestedBackend::Gpu, &REQUEST).unwrap();
        }
        let probe = backends.probe();
        assert_eq!(probe.count("open Gles"), 1);
        assert_eq!(probe.count("open Gpu"), 1);
        assert_eq!(probe.count("create Gles"), 3);
        assert_eq!(probe.count("create Gpu"), 3);
    }

    #[test]
    fn test_gles_accepts_a_cpu_renderer_without_fallback() {
        let mut backends = Backends::new(FakeProbe {
            gles_renderer: Some(
                "ANGLE (Mesa, llvmpipe (LLVM 19.1.7 128 bits), OpenGL ES 3.2)".into(),
            ),
            ..FakeProbe::default()
        });
        for request in [REQUEST, WEBGL2] {
            let (backend, _) = backends.create(RequestedBackend::Gles, &request).unwrap();
            assert_eq!(backend, Backend::Gles);
        }
        assert_eq!(backends.probe().count("open Gpu"), 0);

        let mut failing = Backends::new(FakeProbe {
            gles_display: Some("eglInitialize failed (EGL error 0x3001)".into()),
            ..FakeProbe::default()
        });
        let error = failing
            .create(RequestedBackend::Gles, &REQUEST)
            .unwrap_err();
        assert_eq!(error.code(), "OXGL_CONTEXT_CREATION_FAILED");
        assert!(failing.probe().calls().iter().all(|c| c.contains("Gles")));
    }
}
