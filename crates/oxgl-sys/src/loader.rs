//! Runtime loading of the ANGLE bundle.
//!
//! Only `libEGL` is opened, by absolute path inside an explicit bundle
//! directory; there is no fallback path and the system search path is never
//! used. `libEGL` loads `libGLESv2` from its own directory, and every EGL and
//! GLES entry point is resolved through `eglGetProcAddress`, as ANGLE supports
//! for core functions.

use std::ffi::{CStr, c_void};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use libloading::Library;

use crate::bindings::{
    EGLBoolean, EGLContext, EGLDisplay, EGLSurface, EGLint, GLenum, PFNEGLGETPROCADDRESSPROC,
};

#[cfg(target_os = "macos")]
const LIB_EGL: &str = "libEGL.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const LIB_EGL: &str = "libEGL.so";
#[cfg(windows)]
const LIB_EGL: &str = "libEGL.dll";

/// Why the ANGLE bundle could not be loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadErrorKind {
    /// The bundle directory is not an absolute path.
    RelativeDirectory,
    /// A required library file does not exist.
    MissingFile,
    /// The library exists but the platform loader rejected it.
    LoadFailed,
    /// A required entry point is missing from the loaded library.
    MissingSymbol,
}

/// Failure to load the ANGLE bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadError {
    /// What went wrong.
    pub kind: LoadErrorKind,
    /// Human-readable detail (path, symbol, loader message).
    pub detail: String,
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let what = match self.kind {
            LoadErrorKind::RelativeDirectory => "ANGLE bundle directory is not absolute",
            LoadErrorKind::MissingFile => "ANGLE bundle file is missing",
            LoadErrorKind::LoadFailed => "cannot load the ANGLE bundle",
            LoadErrorKind::MissingSymbol => "ANGLE bundle lacks an entry point",
        };
        write!(f, "{what}: {}", self.detail)
    }
}

impl std::error::Error for LoadError {}

/// The function type inside a bindgen `PFN…PROC` (`Option<fn>`).
pub(crate) trait Pfn {
    type Fn: Copy;
}

impl<F: Copy> Pfn for Option<F> {
    type Fn = F;
}

type Inner<P> = <P as Pfn>::Fn;

/// Resolves one entry point through `eglGetProcAddress`.
fn resolve<P: Pfn>(
    get_proc: Inner<PFNEGLGETPROCADDRESSPROC>,
    name: &CStr,
) -> Result<P::Fn, LoadError> {
    let missing = || LoadError {
        kind: LoadErrorKind::MissingSymbol,
        detail: name.to_string_lossy().into_owned(),
    };
    // SAFETY: `get_proc` is ANGLE's `eglGetProcAddress`, which takes a
    // NUL-terminated name and may be called before any display exists.
    let proc = unsafe { get_proc(name.as_ptr()) }.ok_or_else(missing)?;
    if size_of::<P::Fn>() != size_of_val(&proc) {
        return Err(missing());
    }
    // SAFETY: `P::Fn` is the bindgen function-pointer type for `name`, taken
    // from the same headers ANGLE was built with, and its size equals that of
    // the returned function pointer (checked above).
    Ok(unsafe { std::mem::transmute_copy::<_, P::Fn>(&proc) })
}

fn entry_point_name(name: &'static str) -> Result<&'static CStr, LoadError> {
    CStr::from_bytes_with_nul(name.as_bytes()).map_err(|_| LoadError {
        kind: LoadErrorKind::MissingSymbol,
        detail: name.to_owned(),
    })
}

macro_rules! entry_points {
    ($($field:ident: $pfn:ident,)*) => {
        /// Resolved EGL and GLES entry points.
        #[allow(non_snake_case, reason = "fields carry the C entry point names")]
        pub(crate) struct Fns {
            $(pub(crate) $field: Inner<crate::bindings::$pfn>,)*
        }

        impl Fns {
            fn load(get_proc: Inner<PFNEGLGETPROCADDRESSPROC>) -> Result<Self, LoadError> {
                Ok(Self {
                    $($field: resolve::<crate::bindings::$pfn>(get_proc, entry_point_name(
                        concat!(stringify!($field), "\0"),
                    )?)?,)*
                })
            }
        }
    };
}

entry_points! {
    eglGetPlatformDisplayEXT: PFNEGLGETPLATFORMDISPLAYEXTPROC,
    eglInitialize: PFNEGLINITIALIZEPROC,
    eglChooseConfig: PFNEGLCHOOSECONFIGPROC,
    eglGetConfigAttrib: PFNEGLGETCONFIGATTRIBPROC,
    eglCreatePbufferSurface: PFNEGLCREATEPBUFFERSURFACEPROC,
    eglCreateContext: PFNEGLCREATECONTEXTPROC,
    eglMakeCurrent: PFNEGLMAKECURRENTPROC,
    eglGetCurrentContext: PFNEGLGETCURRENTCONTEXTPROC,
    eglGetCurrentSurface: PFNEGLGETCURRENTSURFACEPROC,
    eglDestroyContext: PFNEGLDESTROYCONTEXTPROC,
    eglDestroySurface: PFNEGLDESTROYSURFACEPROC,
    eglGetError: PFNEGLGETERRORPROC,
    glActiveTexture: PFNGLACTIVETEXTUREPROC,
    glBlendColor: PFNGLBLENDCOLORPROC,
    glBlendEquation: PFNGLBLENDEQUATIONPROC,
    glBlendEquationSeparate: PFNGLBLENDEQUATIONSEPARATEPROC,
    glBlendFunc: PFNGLBLENDFUNCPROC,
    glBlendFuncSeparate: PFNGLBLENDFUNCSEPARATEPROC,
    glClear: PFNGLCLEARPROC,
    glClearColor: PFNGLCLEARCOLORPROC,
    glClearDepthf: PFNGLCLEARDEPTHFPROC,
    glClearStencil: PFNGLCLEARSTENCILPROC,
    glColorMask: PFNGLCOLORMASKPROC,
    glCullFace: PFNGLCULLFACEPROC,
    glDepthFunc: PFNGLDEPTHFUNCPROC,
    glDepthMask: PFNGLDEPTHMASKPROC,
    glDepthRangef: PFNGLDEPTHRANGEFPROC,
    glDisable: PFNGLDISABLEPROC,
    glEnable: PFNGLENABLEPROC,
    glFinish: PFNGLFINISHPROC,
    glFlush: PFNGLFLUSHPROC,
    glFrontFace: PFNGLFRONTFACEPROC,
    glGetBooleanvRobustANGLE: PFNGLGETBOOLEANVROBUSTANGLEPROC,
    glGetError: PFNGLGETERRORPROC,
    glGetFloatvRobustANGLE: PFNGLGETFLOATVROBUSTANGLEPROC,
    glGetGraphicsResetStatusEXT: PFNGLGETGRAPHICSRESETSTATUSEXTPROC,
    glGetInteger64vRobustANGLE: PFNGLGETINTEGER64VROBUSTANGLEPROC,
    glGetIntegervRobustANGLE: PFNGLGETINTEGERVROBUSTANGLEPROC,
    glGetShaderPrecisionFormat: PFNGLGETSHADERPRECISIONFORMATPROC,
    glGetString: PFNGLGETSTRINGPROC,
    glHint: PFNGLHINTPROC,
    glIsEnabled: PFNGLISENABLEDPROC,
    glLineWidth: PFNGLLINEWIDTHPROC,
    glLoseContextCHROMIUM: PFNGLLOSECONTEXTCHROMIUMPROC,
    glPixelStorei: PFNGLPIXELSTOREIPROC,
    glPolygonOffset: PFNGLPOLYGONOFFSETPROC,
    glReadPixelsRobustANGLE: PFNGLREADPIXELSROBUSTANGLEPROC,
    glRequestExtensionANGLE: PFNGLREQUESTEXTENSIONANGLEPROC,
    glSampleCoverage: PFNGLSAMPLECOVERAGEPROC,
    glScissor: PFNGLSCISSORPROC,
    glStencilFunc: PFNGLSTENCILFUNCPROC,
    glStencilFuncSeparate: PFNGLSTENCILFUNCSEPARATEPROC,
    glStencilMask: PFNGLSTENCILMASKPROC,
    glStencilMaskSeparate: PFNGLSTENCILMASKSEPARATEPROC,
    glStencilOp: PFNGLSTENCILOPPROC,
    glStencilOpSeparate: PFNGLSTENCILOPSEPARATEPROC,
    glViewport: PFNGLVIEWPORTPROC,
}

struct Loaded {
    fns: Fns,
    // Keeps libEGL (and through it libGLESv2) mapped while `fns` is reachable.
    _library: Library,
}

/// A loaded ANGLE bundle. Cheap to clone; the libraries stay loaded while any
/// clone (or any object created from it) is alive.
#[derive(Clone)]
pub struct Angle(Arc<Loaded>);

impl fmt::Debug for Angle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Angle")
    }
}

impl Angle {
    /// Loads the bundle's libraries from `lib_dir`, which must be absolute.
    ///
    /// # Errors
    ///
    /// Returns a [`LoadError`] when the directory is relative, a library is
    /// missing or cannot be loaded, or an entry point is missing.
    pub fn load(lib_dir: &Path) -> Result<Self, LoadError> {
        if !lib_dir.is_absolute() {
            return Err(LoadError {
                kind: LoadErrorKind::RelativeDirectory,
                detail: lib_dir.display().to_string(),
            });
        }
        let path: PathBuf = lib_dir.join(LIB_EGL);
        if !path.is_file() {
            return Err(LoadError {
                kind: LoadErrorKind::MissingFile,
                detail: path.display().to_string(),
            });
        }
        // SAFETY: loading runs the library's initializers. The path is the
        // verified ANGLE bundle shipped with oxgl, whose initializers have no
        // preconditions. An absolute path means no search path is consulted.
        let library = unsafe { Library::new(&path) }.map_err(|e| LoadError {
            kind: LoadErrorKind::LoadFailed,
            detail: format!("{}: {e}", path.display()),
        })?;
        // SAFETY: `eglGetProcAddress` has this signature in every EGL
        // implementation, ANGLE's included.
        let get_proc = unsafe {
            library.get::<Inner<PFNEGLGETPROCADDRESSPROC>>(c"eglGetProcAddress".to_bytes_with_nul())
        }
        .map(|symbol| *symbol)
        .map_err(|e| LoadError {
            kind: LoadErrorKind::MissingSymbol,
            detail: format!("eglGetProcAddress: {e}"),
        })?;
        let fns = Fns::load(get_proc)?;
        Ok(Self(Arc::new(Loaded {
            fns,
            _library: library,
        })))
    }

    pub(crate) fn fns(&self) -> &Fns {
        &self.0.fns
    }
}

/// Checks the bindgen pointer types used in this crate have the expected shape.
const _: () = {
    assert!(size_of::<EGLDisplay>() == size_of::<*mut c_void>());
    assert!(size_of::<EGLContext>() == size_of::<*mut c_void>());
    assert!(size_of::<EGLSurface>() == size_of::<*mut c_void>());
    assert!(size_of::<EGLint>() == 4);
    assert!(size_of::<EGLBoolean>() == 4);
    assert!(size_of::<GLenum>() == 4);
};
