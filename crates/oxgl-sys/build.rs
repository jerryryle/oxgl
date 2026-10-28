//! Resolves the pinned ANGLE bundle (see `angle/README.md`).
//!
//! Order: `OXGL_ANGLE_DIR` (an extracted bundle, for offline builds or a
//! locally built ANGLE), then the cache, then a download from the URL in
//! `angle/bundles.toml`. A download is verified against the pinned sha256 before
//! anything is extracted; there is no unverified fallback.
//!
//! The bundle's component licenses were checked against `deny.toml` when it was
//! built; the allowlist may have narrowed since, so they are checked again here.
//!
//! The resolved bundle directory is written to `<target>/<profile>/oxgl-angle-dir`
//! so the npm build can stage its libraries next to the addon.
//!
//! EGL/GLES types and constants are generated with bindgen from the bundle's
//! headers. Functions are not bound: they are resolved at runtime.

use std::env;
use std::fmt::Write as _;
use std::fs;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};

type Result<T> = std::result::Result<T, String>;

struct Platform {
    key: &'static str,
    libs: &'static [&'static str],
}

const LINUX_LIBS: &[&str] = &["libEGL.so", "libGLESv2.so", "libvk_swiftshader.so"];
const WINDOWS_LIBS: &[&str] = &["libEGL.dll", "libGLESv2.dll", "vk_swiftshader.dll"];

const PLATFORMS: &[(&str, Platform)] = &[
    (
        "aarch64-apple-darwin",
        Platform {
            key: "macos-arm64",
            libs: &["libEGL.dylib", "libGLESv2.dylib", "libvk_swiftshader.dylib"],
        },
    ),
    (
        "x86_64-unknown-linux-gnu",
        Platform {
            key: "linux-x64",
            libs: LINUX_LIBS,
        },
    ),
    (
        "aarch64-unknown-linux-gnu",
        Platform {
            key: "linux-arm64",
            libs: LINUX_LIBS,
        },
    ),
    (
        "x86_64-pc-windows-msvc",
        Platform {
            key: "windows-x64",
            libs: WINDOWS_LIBS,
        },
    ),
    (
        "aarch64-pc-windows-msvc",
        Platform {
            key: "windows-arm64",
            libs: WINDOWS_LIBS,
        },
    ),
];

fn main() {
    if let Err(message) = run() {
        println!("cargo::error={message}");
    }
}

fn run() -> Result<()> {
    println!("cargo::rerun-if-env-changed=OXGL_ANGLE_DIR");
    println!("cargo::rerun-if-env-changed=OXGL_ANGLE_CACHE");
    println!("cargo::rerun-if-env-changed=OXGL_ANGLE_SYMBOLS");
    let manifest_dir = PathBuf::from(var("CARGO_MANIFEST_DIR")?);
    let angle_dir = manifest_dir.join("../../angle");
    let pin_path = angle_dir.join("pin.toml");
    let bundles_path = angle_dir.join("bundles.toml");
    let deny_path = manifest_dir.join("../../deny.toml");
    println!("cargo::rerun-if-changed={}", pin_path.display());
    println!("cargo::rerun-if-changed={}", bundles_path.display());
    println!("cargo::rerun-if-changed={}", deny_path.display());

    let target = var("TARGET")?;
    let platform = PLATFORMS
        .iter()
        .find(|(triple, _)| *triple == target)
        .map(|(_, platform)| platform)
        .ok_or_else(|| format!("oxgl has no ANGLE bundle for target {target}"))?;

    let bundle = if let Some(dir) = env::var_os("OXGL_ANGLE_DIR") {
        let dir = PathBuf::from(dir);
        // Cargo runs build scripts from the package directory, so a relative
        // path would not mean what the caller intended.
        if dir.is_relative() {
            return Err(format!(
                "OXGL_ANGLE_DIR must be an absolute path, got {}",
                dir.display()
            ));
        }
        println!(
            "cargo::warning=using ANGLE bundle from OXGL_ANGLE_DIR={}",
            dir.display()
        );
        dir
    } else {
        let bundles = read_toml(&bundles_path)?;
        let pin = read_toml(&pin_path)?;
        let pinned = version(&pin);
        if pinned != version(&bundles) {
            println!(
                "cargo::warning=angle/pin.toml is at {pinned} but angle/bundles.toml pins {} \
                 bundles; building against the pinned bundles",
                version(&bundles)
            );
        }
        let (url, sha256) = pinned_archive(&bundles, platform.key, "").ok_or_else(|| {
            format!(
                "no published ANGLE bundle is pinned for {}; build one with angle/build.sh \
                 and set OXGL_ANGLE_DIR to the extracted bundle",
                platform.key
            )
        })?;
        cached_or_downloaded(&url, &sha256)?
    };
    check_layout(&bundle, platform)?;
    check_licenses(&bundle, &deny_path)?;
    generate_bindings(&bundle)?;
    let lib_dir = if env::var_os("OXGL_ANGLE_SYMBOLS").is_some() {
        unstripped_lib_dir(&bundle, &read_toml(&bundles_path)?, platform.key)?
    } else {
        bundle.join("lib")
    };
    // Read only by `test_support` (feature `test-support`), so a build without
    // that feature never embeds the path.
    println!(
        "cargo::rustc-env=OXGL_STAGED_ANGLE_LIB_DIR={}",
        lib_dir.display()
    );
    // Re-run (and re-download if needed) when the bundle directory is deleted
    // or changes, so the recorded path never goes stale.
    println!("cargo::rerun-if-changed={}", bundle.display());

    let profile_dir = PathBuf::from(var("OUT_DIR")?)
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .ok_or("unexpected OUT_DIR layout")?;
    fs::write(
        profile_dir.join("oxgl-angle-dir"),
        bundle.display().to_string(),
    )
    .map_err(|e| format!("cannot record the ANGLE bundle path: {e}"))
}

/// Generates the EGL/GLES types (including `PFN…PROC` function-pointer types)
/// and constants into `$OUT_DIR/bindings.rs`.
fn generate_bindings(bundle: &Path) -> Result<()> {
    let include = bundle.join("include");
    let header = [
        "EGL/egl.h",
        "EGL/eglext.h",
        "EGL/eglext_angle.h",
        "GLES3/gl3.h",
        "GLES2/gl2ext.h",
        "GLES2/gl2ext_angle.h",
    ]
    .iter()
    .fold(String::new(), |mut text, file| {
        let _ = writeln!(text, "#include <{file}>");
        text
    });
    let bindings = bindgen::Builder::default()
        .header_contents("oxgl_angle.h", &header)
        .clang_arg(format!("-I{}", include.display()))
        // Prototypes are not needed; the PFN typedefs are always declared.
        .clang_arg("-DEGL_EGL_PROTOTYPES=0")
        .clang_arg("-DGL_GLES_PROTOTYPES=0")
        .allowlist_type("(EGL|GL|PFNEGL|PFNGL|khronos_).*")
        .allowlist_var("(EGL|GL)_.*")
        .parse_callbacks(Box::new(ConstantTypes))
        .layout_tests(false)
        .generate()
        .map_err(|e| format!("cannot generate EGL/GLES bindings: {e}"))?;
    let out = PathBuf::from(var("OUT_DIR")?).join("bindings.rs");
    bindings
        .write_to_file(&out)
        .map_err(|e| format!("cannot write {}: {e}", out.display()))
}

/// Types `GL_*` constants as `GLenum` (`u32`) and `EGL_*` constants as `EGLint`
/// (`i32`), the types the APIs take them as. Values that do not fit keep
/// bindgen's default.
#[derive(Debug)]
struct ConstantTypes;

impl bindgen::callbacks::ParseCallbacks for ConstantTypes {
    fn int_macro(&self, name: &str, value: i64) -> Option<bindgen::callbacks::IntKind> {
        use bindgen::callbacks::IntKind;
        if name.starts_with("GL_") && u32::try_from(value).is_ok() {
            Some(IntKind::U32)
        } else if name.starts_with("EGL_") && i32::try_from(value).is_ok() {
            Some(IntKind::I32)
        } else {
            None
        }
    }
}

fn var(name: &str) -> Result<String> {
    env::var(name).map_err(|e| format!("{name}: {e}"))
}

fn read_toml(path: &Path) -> Result<toml::Table> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    text.parse()
        .map_err(|e| format!("cannot parse {}: {e}", path.display()))
}

fn version(table: &toml::Table) -> &str {
    table
        .get("bundle_version")
        .and_then(toml::Value::as_str)
        .unwrap_or("no bundle_version")
}

/// The `{prefix}url` and `{prefix}sha256` of `[platform.<key>]`, if both are set.
fn pinned_archive(bundles: &toml::Table, key: &str, prefix: &str) -> Option<(String, String)> {
    let entry = bundles.get("platform").and_then(|p| p.get(key))?;
    let field = |name: &str| {
        entry
            .get(format!("{prefix}{name}"))
            .and_then(toml::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Some((field("url")?, field("sha256")?.to_ascii_lowercase()))
}

/// For sanitizer runs (`OXGL_ANGLE_SYMBOLS`): a copy of the bundle's `lib/`
/// with its libraries replaced by the unstripped ones from the platform's
/// pinned symbols archive, so `LeakSanitizer` suppressions can name
/// ANGLE-internal functions. The archive is verified like the bundle.
fn unstripped_lib_dir(bundle: &Path, bundles: &toml::Table, key: &str) -> Result<PathBuf> {
    let (url, sha256) = pinned_archive(bundles, key, "symbols_").ok_or_else(|| {
        format!(
            "OXGL_ANGLE_SYMBOLS is set but angle/bundles.toml pins no symbols archive for {key}"
        )
    })?;
    let symbols = cached_or_downloaded(&url, &sha256)?;
    let out = PathBuf::from(var("OUT_DIR")?).join("angle-lib-unstripped");
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).map_err(|e| format!("cannot create {}: {e}", out.display()))?;
    for dir in [bundle.join("lib"), symbols] {
        let entries =
            fs::read_dir(&dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        for entry in entries {
            let path = entry.map_err(|e| e.to_string())?.path();
            let Some(name) = path.file_name() else {
                continue;
            };
            if path.is_file() && name != ".complete" {
                fs::copy(&path, out.join(name))
                    .map_err(|e| format!("cannot copy {}: {e}", path.display()))?;
            }
        }
    }
    Ok(out)
}

fn cache_root() -> Result<PathBuf> {
    if let Some(dir) = env::var_os("OXGL_ANGLE_CACHE") {
        return Ok(PathBuf::from(dir));
    }
    let cargo_home = env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".cargo")))
        .ok_or("cannot locate a cache directory; set OXGL_ANGLE_CACHE")?;
    Ok(cargo_home.join("oxgl-angle"))
}

fn cached_or_downloaded(url: &str, expected: &str) -> Result<PathBuf> {
    let root = cache_root()?;
    let dir = root.join(expected);
    if dir.join(".complete").exists() {
        return Ok(dir);
    }
    fs::create_dir_all(&root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;

    // Concurrent builds (rust-analyzer next to a terminal build, say) share this
    // cache, so temporary paths are per process and only renames publish.
    let pid = std::process::id();
    let archive = root.join(format!("{expected}.tar.xz"));
    if !archive.exists() {
        let partial = root.join(format!("{expected}.tar.xz.{pid}.part"));
        let status = Command::new("curl")
            .args([
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--retry",
                "3",
                "--output",
            ])
            .arg(&partial)
            .arg(url)
            .status()
            .map_err(|e| format!("cannot run curl to download the ANGLE bundle: {e}"))?;
        if !status.success() {
            return Err(format!("downloading {url} failed ({status})"));
        }
        if let Err(e) = fs::rename(&partial, &archive) {
            let _ = fs::remove_file(&partial);
            if !archive.exists() {
                return Err(format!("cannot finish download: {e}"));
            }
        }
    }

    let bytes =
        fs::read(&archive).map_err(|e| format!("cannot read {}: {e}", archive.display()))?;
    let actual = Sha256::digest(&bytes)
        .iter()
        .fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        });
    if actual != expected {
        let _ = fs::remove_file(&archive);
        return Err(format!(
            "ANGLE bundle {url} failed verification: expected sha256 {expected}, got {actual}"
        ));
    }

    let staging = root.join(format!("{expected}.{pid}.extracting"));
    let _ = fs::remove_dir_all(&staging);
    let mut tar_bytes = Vec::new();
    lzma_rs::xz_decompress(&mut BufReader::new(Cursor::new(bytes)), &mut tar_bytes)
        .map_err(|e| format!("cannot decompress the ANGLE bundle: {e}"))?;
    tar::Archive::new(Cursor::new(tar_bytes))
        .unpack(&staging)
        .map_err(|e| format!("cannot extract the ANGLE bundle: {e}"))?;
    fs::write(staging.join(".complete"), expected)
        .map_err(|e| format!("cannot mark the ANGLE bundle complete: {e}"))?;
    if dir.join(".complete").exists() {
        // Another build finished first; its copy is identical.
        let _ = fs::remove_dir_all(&staging);
        return Ok(dir);
    }
    let _ = fs::remove_dir_all(&dir);
    if let Err(e) = fs::rename(&staging, &dir) {
        let _ = fs::remove_dir_all(&staging);
        if !dir.join(".complete").exists() {
            return Err(format!("cannot move the ANGLE bundle into the cache: {e}"));
        }
    }
    Ok(dir)
}

fn check_licenses(bundle: &Path, deny_path: &Path) -> Result<()> {
    let deny = read_toml(deny_path)?;
    let allowed: Vec<&str> = deny
        .get("licenses")
        .and_then(|l| l.get("allow"))
        .and_then(toml::Value::as_array)
        .ok_or("cannot find [licenses] allow in deny.toml")?
        .iter()
        .filter_map(toml::Value::as_str)
        .collect();
    let info_path = bundle.join("BUILD_INFO.json");
    let info: serde_json::Value = fs::read_to_string(&info_path)
        .map_err(|e| e.to_string())
        .and_then(|text| serde_json::from_str(&text).map_err(|e| e.to_string()))
        .map_err(|e| format!("cannot read {}: {e}", info_path.display()))?;
    let components = info
        .get("components")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("{} has no components list", info_path.display()))?;
    let mut disallowed = Vec::new();
    for component in components {
        let path = component.get("path").and_then(serde_json::Value::as_str);
        let license = component.get("license").and_then(serde_json::Value::as_str);
        let (Some(path), Some(license)) = (path, license) else {
            return Err(format!("{} has a malformed component", info_path.display()));
        };
        // Same split as angle/scripts/bundle.py's license_parts (commas, and AND
        // with any surrounding whitespace); whitespace runs are collapsed first
        // so `MIT  AND  BSD-3-Clause` splits as it does there.
        let normalized = license.split_whitespace().collect::<Vec<_>>().join(" ");
        let ok = normalized
            .split(',')
            .flat_map(|part| part.split(" AND "))
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .all(|part| allowed.contains(&part));
        if !ok {
            disallowed.push(format!("{path}: {license}"));
        }
    }
    if disallowed.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "ANGLE bundle components not on the deny.toml allowlist (pin a bundle built under \
             the new allowlist, or revert it): {}",
            disallowed.join("; ")
        ))
    }
}

fn check_layout(bundle: &Path, platform: &Platform) -> Result<()> {
    let mut required: Vec<PathBuf> = platform
        .libs
        .iter()
        .map(|lib| Path::new("lib").join(lib))
        .collect();
    required.extend(
        [
            "lib/vk_swiftshader_icd.json",
            "include/EGL/egl.h",
            "include/EGL/eglext.h",
            "include/EGL/eglext_angle.h",
            "include/GLES2/gl2.h",
            "include/GLES2/gl2ext.h",
            "include/GLES2/gl2ext_angle.h",
            "include/GLES3/gl3.h",
            "BUILD_INFO.json",
        ]
        .map(PathBuf::from),
    );
    let missing: Vec<String> = required
        .iter()
        .filter(|rel| !bundle.join(rel).exists())
        .map(|rel| rel.display().to_string())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "ANGLE bundle at {} is missing: {}",
            bundle.display(),
            missing.join(", ")
        ))
    }
}
