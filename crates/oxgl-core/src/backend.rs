//! Backend selection: the platform GPU backend or `SwiftShader`, with `auto`
//! fallback and process-lifetime caching of displays and GPU failures.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use oxgl_sys::bindings::GL_RENDERER;
use oxgl_sys::{Angle, ClientVersion, Display, DisplayKind};

use crate::context::DrawingBuffer;
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
}

/// A concrete backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// The platform's native GPU backend.
    Gpu,
    /// `SwiftShader`.
    Software,
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
}

/// Renderer names of CPU implementations, which never count as a GPU.
const CPU_RENDERERS: [&str; 6] = [
    "swiftshader",
    "llvmpipe",
    "lavapipe",
    "softpipe",
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

/// Per-backend display cache. Each backend is opened at most once per
/// process, and an initialization failure, including a GPU display whose
/// renderer is a CPU implementation, is kept for the rest of the process (an
/// accepted trade-off, see the backend-selection spec).
#[derive(Debug)]
pub struct Backends<P: BackendProbe> {
    probe: P,
    gpu: Option<Result<P::Display, String>>,
    software: Option<Result<P::Display, String>>,
}

impl<P: BackendProbe> Backends<P> {
    /// A cache with nothing opened yet.
    pub fn new(probe: P) -> Self {
        Self {
            probe,
            gpu: None,
            software: None,
        }
    }

    /// The probe, for tests that inspect it.
    pub fn probe(&self) -> &P {
        &self.probe
    }

    fn display(&mut self, backend: Backend) -> Result<P::Display, String> {
        let probe = &self.probe;
        let slot = match backend {
            Backend::Gpu => &mut self.gpu,
            Backend::Software => &mut self.software,
        };
        slot.get_or_insert_with(|| {
            let display = probe.open_display(backend)?;
            if backend == Backend::Gpu {
                let renderer = probe.renderer(&display)?;
                if is_cpu_renderer(&renderer) {
                    return Err(format!("the GPU backend renders on a CPU ({renderer})"));
                }
            }
            Ok(display)
        })
        .clone()
    }

    /// Creates a context on `backend`. A context-creation failure fails only
    /// this call: it can come from normal use (out of GPU memory, a WebGL 2
    /// request on an OpenGL ES 2.0-only GPU), unlike a display failure.
    fn try_backend(
        &mut self,
        backend: Backend,
        request: &ContextRequest,
    ) -> Result<P::Context, String> {
        let display = self.display(backend)?;
        self.probe.create_context(&display, request)
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
            RequestedBackend::Gpu => self
                .try_backend(Backend::Gpu, request)
                .map(|context| (Backend::Gpu, context))
                .map_err(|cause| CoreError::GpuUnavailable(format!("{}: {cause}", gpu_name()))),
            RequestedBackend::Software => self
                .try_backend(Backend::Software, request)
                .map(|context| (Backend::Software, context))
                .map_err(|cause| CoreError::ContextCreationFailed(format!("SwiftShader: {cause}"))),
            RequestedBackend::Auto => match self.try_backend(Backend::Gpu, request) {
                Ok(context) => Ok((Backend::Gpu, context)),
                Err(gpu) => self
                    .try_backend(Backend::Software, request)
                    .map(|context| (Backend::Software, context))
                    .map_err(|software| {
                        CoreError::ContextCreationFailed(format!(
                            "{}: {gpu}; SwiftShader: {software}",
                            gpu_name()
                        ))
                    }),
            },
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
        };
        Display::open(&self.angle, kind).map_err(|e| e.to_string())
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
        software_display: Option<String>,
        calls: RefCell<Vec<String>>,
    }

    impl FakeProbe {
        fn working_gpu() -> Self {
            Self {
                gpu_renderer: Some("ANGLE (Apple, M2, Metal)".into()),
                ..Self::default()
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
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
            };
            failure.clone().map_or(Ok(backend), Err)
        }

        fn renderer(&self, display: &Backend) -> Result<String, String> {
            self.calls
                .borrow_mut()
                .push(format!("renderer {display:?}"));
            Ok(self
                .gpu_renderer
                .clone()
                .unwrap_or_else(|| "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))".into()))
        }

        fn create_context(&self, display: &Backend, _: &ContextRequest) -> Result<Backend, String> {
            self.calls.borrow_mut().push(format!("create {display:?}"));
            match display {
                Backend::Gpu => self.gpu_context.clone().map_or(Ok(Backend::Gpu), Err),
                Backend::Software => Ok(Backend::Software),
            }
        }
    }

    const REQUEST: ContextRequest = ContextRequest {
        width: 4.0,
        height: 4.0,
        webgl2: false,
    };

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
}
