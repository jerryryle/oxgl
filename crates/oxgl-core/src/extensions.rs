//! WebGL extensions (WebGL 1.0 §5.14.14): which ones exist, which GL
//! extensions each needs ANGLE to enable, and what enabling one adds to
//! oxgl's own lists. ANGLE gates everything else (entry points, enums,
//! formats, shader features) on the GL extensions oxgl requests.

use std::collections::BTreeSet;
use std::ffi::CString;

#[allow(
    clippy::wildcard_imports,
    reason = "the table names many GL_ constants"
)]
use oxgl_sys::bindings::*;

use crate::context::{Context, current};

/// Which WebGL versions an extension exists on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Versions {
    /// WebGL 1 only.
    One,
    /// WebGL 2 only.
    Two,
    /// Both.
    Both,
}

/// One WebGL extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Extension {
    /// The WebGL name, in its canonical case.
    pub name: &'static str,
    /// The versions it exists on.
    pub versions: Versions,
    /// GL extensions ANGLE must enable, all of them.
    pub requires: &'static [&'static str],
}

macro_rules! extensions {
    ($($name:literal $versions:ident [$($gl:literal),*];)*) => {
        &[$(Extension { name: $name, versions: Versions::$versions, requires: &[$($gl),*] },)*]
    };
}

/// Every WebGL extension oxgl implements.
pub const EXTENSIONS: &[Extension] = extensions! {
    "ANGLE_instanced_arrays" One ["GL_ANGLE_instanced_arrays"];
    "EXT_blend_minmax" One ["GL_EXT_blend_minmax"];
    "EXT_clip_control" Both ["GL_EXT_clip_control"];
    "EXT_color_buffer_float" Two ["GL_EXT_color_buffer_float"];
    "EXT_color_buffer_half_float" Both ["GL_EXT_color_buffer_half_float"];
    "EXT_conservative_depth" Two ["GL_EXT_conservative_depth"];
    "EXT_depth_clamp" Both ["GL_EXT_depth_clamp"];
    "EXT_float_blend" Both ["GL_EXT_float_blend"];
    "EXT_frag_depth" One ["GL_EXT_frag_depth"];
    "EXT_polygon_offset_clamp" Both ["GL_EXT_polygon_offset_clamp"];
    "EXT_shader_texture_lod" One ["GL_EXT_shader_texture_lod"];
    "EXT_sRGB" One ["GL_EXT_sRGB"];
    "EXT_texture_compression_bptc" Both ["GL_EXT_texture_compression_bptc"];
    "EXT_texture_compression_rgtc" Both ["GL_EXT_texture_compression_rgtc"];
    "EXT_texture_filter_anisotropic" Both ["GL_EXT_texture_filter_anisotropic"];
    "EXT_texture_mirror_clamp_to_edge" Both ["GL_EXT_texture_mirror_clamp_to_edge"];
    "EXT_texture_norm16" Two ["GL_EXT_texture_norm16"];
    "KHR_parallel_shader_compile" Both [];
    "NV_shader_noperspective_interpolation" Two ["GL_NV_shader_noperspective_interpolation"];
    "OES_draw_buffers_indexed" Two ["GL_OES_draw_buffers_indexed"];
    "OES_element_index_uint" One ["GL_OES_element_index_uint"];
    "OES_fbo_render_mipmap" One ["GL_OES_fbo_render_mipmap"];
    "OES_standard_derivatives" One ["GL_OES_standard_derivatives"];
    "OES_texture_float" One ["GL_OES_texture_float"];
    "OES_texture_float_linear" Both ["GL_OES_texture_float_linear"];
    "OES_texture_half_float" One ["GL_OES_texture_half_float"];
    "OES_texture_half_float_linear" One ["GL_OES_texture_half_float_linear"];
    "OES_vertex_array_object" One ["GL_OES_vertex_array_object"];
    "WEBGL_blend_func_extended" Both ["GL_EXT_blend_func_extended"];
    "WEBGL_clip_cull_distance" Two ["GL_ANGLE_clip_cull_distance"];
    "WEBGL_color_buffer_float" One ["GL_CHROMIUM_color_buffer_float_rgba"];
    "WEBGL_compressed_texture_astc" Both ["GL_KHR_texture_compression_astc_ldr"];
    "WEBGL_compressed_texture_etc" Both ["GL_ANGLE_compressed_texture_etc"];
    "WEBGL_compressed_texture_etc1" Both ["GL_OES_compressed_ETC1_RGB8_texture"];
    "WEBGL_compressed_texture_s3tc" Both [
        "GL_EXT_texture_compression_dxt1",
        "GL_ANGLE_texture_compression_dxt3",
        "GL_ANGLE_texture_compression_dxt5"
    ];
    "WEBGL_compressed_texture_s3tc_srgb" Both ["GL_EXT_texture_compression_s3tc_srgb"];
    "WEBGL_debug_renderer_info" Both [];
    "WEBGL_debug_shaders" Both ["GL_ANGLE_translated_shader_source"];
    "WEBGL_depth_texture" One ["GL_ANGLE_depth_texture"];
    "WEBGL_draw_buffers" One ["GL_EXT_draw_buffers"];
    "WEBGL_lose_context" Both ["GL_CHROMIUM_lose_context"];
    "WEBGL_multi_draw" Both ["GL_ANGLE_multi_draw"];
    "WEBGL_polygon_mode" Both ["GL_ANGLE_polygon_mode"];
    "WEBGL_provoking_vertex" Two ["GL_ANGLE_provoking_vertex"];
    "WEBGL_render_shared_exponent" Two ["GL_QCOM_render_shared_exponent"];
    "WEBGL_stencil_texturing" Two ["GL_ANGLE_stencil_texturing"];
};

/// The table row for `name`, matched ASCII case-insensitively (WebGL 1.0
/// §5.14.14), if it exists on the version.
#[must_use]
pub fn find(name: &str, webgl2: bool) -> Option<&'static Extension> {
    EXTENSIONS.iter().find(|e| {
        e.name.eq_ignore_ascii_case(name)
            && match e.versions {
                Versions::One => !webgl2,
                Versions::Two => webgl2,
                Versions::Both => true,
            }
    })
}

/// The GL extensions ANGLE has enabled or can enable on a context, as
/// first read.
#[derive(Debug, Default, Clone)]
pub struct Available {
    enabled: BTreeSet<String>,
    requestable: BTreeSet<String>,
}

impl Available {
    fn read(current: &oxgl_sys::Current<'_>) -> Self {
        let list = |pname| {
            current
                .get_string(pname)
                .map(|list| list.split_ascii_whitespace().map(str::to_owned).collect())
                .unwrap_or_default()
        };
        Self {
            enabled: list(GL_EXTENSIONS),
            requestable: list(GL_REQUESTABLE_EXTENSIONS_ANGLE),
        }
    }

    fn has(&self, extension: &Extension) -> bool {
        extension
            .requires
            .iter()
            .all(|gl| self.enabled.contains(*gl) || self.requestable.contains(*gl))
    }
}

/// Extension state of a context.
#[derive(Debug, Default)]
pub struct ExtensionState {
    available: Option<Available>,
    enabled: BTreeSet<&'static str>,
    /// GL extensions requested so far; requesting one twice, or one that is
    /// already enabled, is `INVALID_OPERATION`.
    requested: BTreeSet<&'static str>,
}

impl ExtensionState {
    /// Whether the WebGL extension `name` (canonical case) is enabled.
    #[must_use]
    pub fn is_enabled(&self, name: &str) -> bool {
        self.enabled.contains(name)
    }
}

impl Context {
    fn available(&mut self) -> Option<&Available> {
        if self.extensions.available.is_none() {
            let current = current(&self.buffer, &mut self.errors)?;
            self.extensions.available = Some(Available::read(&current));
        }
        self.extensions.available.as_ref()
    }

    /// `getSupportedExtensions`; `None` when lost.
    pub fn supported_extensions(&mut self) -> Option<Vec<&'static str>> {
        if self.errors.is_lost() {
            return None;
        }
        let webgl2 = self.webgl2;
        let available = self.available()?.clone();
        Some(
            EXTENSIONS
                .iter()
                .filter(|e| find(e.name, webgl2).is_some() && available.has(e))
                .map(|e| e.name)
                .collect(),
        )
    }

    /// `getExtension`: enables a supported extension and returns its
    /// canonical name; `None` for an unknown or unsupported one, or when
    /// lost.
    pub fn enable_extension(&mut self, name: &str) -> Option<&'static str> {
        if self.errors.is_lost() {
            return None;
        }
        let extension = find(name, self.webgl2)?;
        let available = self.available()?.clone();
        if !available.has(extension) {
            return None;
        }
        if !self.extensions.enabled.contains(extension.name) {
            let current = current(&self.buffer, &mut self.errors)?;
            // On ES 2.0, multi-draw's instanced entry points need ANGLE's
            // instanced arrays as well.
            let extra: &[&'static str] = if extension.name == "WEBGL_multi_draw" && !self.webgl2 {
                &["GL_ANGLE_instanced_arrays"]
            } else {
                &[]
            };
            for &gl in extension.requires.iter().chain(extra) {
                if available.requestable.contains(gl)
                    && self.extensions.requested.insert(gl)
                    && let Ok(gl) = CString::new(gl)
                {
                    current.request_extension(&gl);
                }
            }
            self.extensions.enabled.insert(extension.name);
        }
        Some(extension.name)
    }

    /// Whether the WebGL extension `name` (canonical case) is enabled.
    #[must_use]
    pub fn extension_enabled(&self, name: &str) -> bool {
        self.extensions.is_enabled(name)
    }
}

/// An extension entry point that changes state with values only.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExtensionCall {
    /// `OES_draw_buffers_indexed.enableiOES`.
    Enablei(u32, u32),
    /// `disableiOES`.
    Disablei(u32, u32),
    /// `blendEquationiOES`.
    BlendEquationi(u32, u32),
    /// `blendEquationSeparateiOES`.
    BlendEquationSeparatei(u32, u32, u32),
    /// `blendFunciOES`.
    BlendFunci(u32, u32, u32),
    /// `blendFuncSeparateiOES`.
    BlendFuncSeparatei(u32, u32, u32, u32, u32),
    /// `colorMaskiOES`.
    ColorMaski(u32, [bool; 4]),
    /// `EXT_clip_control.clipControlEXT`.
    ClipControl(u32, u32),
    /// `EXT_polygon_offset_clamp.polygonOffsetClampEXT`.
    PolygonOffsetClamp(f32, f32, f32),
    /// `WEBGL_provoking_vertex.provokingVertexWEBGL`.
    ProvokingVertex(u32),
    /// `WEBGL_polygon_mode.polygonModeWEBGL`.
    PolygonMode(u32, u32),
}

impl Context {
    /// Issues an extension's value-only call; the TS layer only offers it
    /// once the extension is enabled, and ANGLE gates it as well.
    pub fn extension_call(&mut self, call: ExtensionCall) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        match call {
            ExtensionCall::Enablei(target, index) => current.enablei(target, index),
            ExtensionCall::Disablei(target, index) => current.disablei(target, index),
            ExtensionCall::BlendEquationi(buf, mode) => current.blend_equationi(buf, mode),
            ExtensionCall::BlendEquationSeparatei(buf, rgb, alpha) => {
                current.blend_equation_separatei(buf, rgb, alpha);
            }
            ExtensionCall::BlendFunci(buf, src, dst) => current.blend_funci(buf, src, dst),
            ExtensionCall::BlendFuncSeparatei(buf, a, b, c, d) => {
                current.blend_func_separatei(buf, a, b, c, d);
            }
            ExtensionCall::ColorMaski(buf, [r, g, b, a]) => {
                current.color_maski(buf, u8::from(r), u8::from(g), u8::from(b), u8::from(a));
            }
            ExtensionCall::ClipControl(origin, depth) => current.clip_control(origin, depth),
            ExtensionCall::PolygonOffsetClamp(factor, units, clamp) => {
                current.polygon_offset_clamp(factor, units, clamp);
            }
            ExtensionCall::ProvokingVertex(mode) => current.provoking_vertex(mode),
            ExtensionCall::PolygonMode(face, mode) => current.polygon_mode(face, mode),
        }
    }

    /// `WEBGL_multi_draw`: arrays (`elements` `None`) or elements (with the
    /// index type), each draw from equal-length lists.
    pub fn multi_draw(
        &mut self,
        mode: u32,
        firsts_or_offsets: &[i64],
        counts: &[i32],
        instances: &[i32],
        elements: Option<u32>,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if firsts_or_offsets.len() != counts.len()
            || (!instances.is_empty() && instances.len() != counts.len())
        {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        match elements {
            None => {
                let firsts: Option<Vec<i32>> = firsts_or_offsets
                    .iter()
                    .map(|&f| i32::try_from(f).ok())
                    .collect();
                let Some(firsts) = firsts else {
                    self.errors.synthesize(GL_INVALID_VALUE);
                    return;
                };
                current.multi_draw_arrays(mode, &firsts, counts, instances);
            }
            Some(ty) => {
                if firsts_or_offsets.iter().any(|&o| o < 0) {
                    self.errors.synthesize(GL_INVALID_VALUE);
                    return;
                }
                current.multi_draw_elements(mode, counts, ty, firsts_or_offsets, instances);
            }
        }
    }

    /// `WEBGL_debug_shaders.getTranslatedShaderSource`.
    pub fn translated_shader_source(
        &mut self,
        shader: crate::context::ObjectKey,
    ) -> Option<String> {
        let name = match self.objects.get(shader)? {
            crate::context::Object::Shader { name } => *name,
            _ => return None,
        };
        let current = current(&self.buffer, &mut self.errors)?;
        let length = current
            .shader_parameter(name, GL_TRANSLATED_SHADER_SOURCE_LENGTH_ANGLE)
            .unwrap_or(0);
        Some(current.translated_shader_source(name, usize::try_from(length).unwrap_or(0)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique_and_sorted() {
        for pair in EXTENSIONS.windows(2) {
            if let [a, b] = pair {
                assert!(
                    a.name.to_ascii_lowercase() < b.name.to_ascii_lowercase(),
                    "{} {}",
                    a.name,
                    b.name
                );
            }
        }
    }

    #[test]
    fn matching_is_case_insensitive_and_per_version() {
        assert_eq!(
            find("oes_vertex_array_object", false).map(|e| e.name),
            Some("OES_vertex_array_object")
        );
        assert!(find("OES_vertex_array_object", true).is_none());
        assert!(find("EXT_color_buffer_float", false).is_none());
        assert!(find("EXT_color_buffer_float", true).is_some());
        assert!(find("NOT_AN_EXTENSION", true).is_none());
    }
}
