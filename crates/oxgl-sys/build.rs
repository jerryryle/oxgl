//! Resolves the pinned ANGLE bundle (see `angle/README.md`).
//!
//! Order: `OXGL_ANGLE_DIR` (an extracted bundle, for offline builds or a
//! locally built ANGLE), then the cache, then a download from the URL in
//! `angle/pin.toml`. A download is verified against the pinned sha256 before
//! anything is extracted; there is no unverified fallback.
//!
//! The resolved bundle directory is written to `<target>/<profile>/oxgl-angle-dir`
//! so the npm build can stage its libraries next to the addon.

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
            libs: &["libEGL.so", "libGLESv2.so", "libvk_swiftshader.so"],
        },
    ),
    (
        "x86_64-pc-windows-msvc",
        Platform {
            key: "windows-x64",
            libs: &["libEGL.dll", "libGLESv2.dll", "vk_swiftshader.dll"],
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
    let manifest_dir = PathBuf::from(var("CARGO_MANIFEST_DIR")?);
    let pin_path = manifest_dir.join("../../angle/pin.toml");
    println!("cargo::rerun-if-changed={}", pin_path.display());

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
        let (url, sha256) = pinned_bundle(&pin_path, platform.key)?;
        cached_or_downloaded(&url, &sha256)?
    };
    check_layout(&bundle, platform)?;

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

fn var(name: &str) -> Result<String> {
    env::var(name).map_err(|e| format!("{name}: {e}"))
}

fn pinned_bundle(pin_path: &Path, key: &str) -> Result<(String, String)> {
    let text = fs::read_to_string(pin_path)
        .map_err(|e| format!("cannot read {}: {e}", pin_path.display()))?;
    let pin: toml::Table = text
        .parse()
        .map_err(|e| format!("cannot parse {}: {e}", pin_path.display()))?;
    let entry = pin
        .get("platform")
        .and_then(|p| p.get(key))
        .ok_or_else(|| format!("angle/pin.toml has no [platform.{key}] entry"))?;
    let field = |name: &str| {
        entry
            .get(name)
            .and_then(toml::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    match (field("url"), field("sha256")) {
        (Some(url), Some(sha256)) => Ok((url, sha256.to_ascii_lowercase())),
        _ => Err(format!(
            "no published ANGLE bundle is pinned for {key}; build one with angle/build.sh \
             and set OXGL_ANGLE_DIR to the extracted bundle"
        )),
    }
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
            "include/EGL/eglext_angle.h",
            "include/GLES2/gl2.h",
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
