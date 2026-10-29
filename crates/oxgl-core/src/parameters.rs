//! The `getParameter` table (WebGL 1.0 §5.14.3, WebGL 2.0 §3.7.2): which
//! parameters each WebGL version has, and the JS type each one returns.

#[allow(
    clippy::wildcard_imports,
    reason = "the table names most GL_ constants"
)]
use oxgl_sys::bindings::*;
use oxgl_sys::{ValueType, Values};

use crate::state::{
    UNPACK_COLORSPACE_CONVERSION_WEBGL, UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL,
};

/// `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` (WebGL 2.0 §3.7).
pub const MAX_CLIENT_WAIT_TIMEOUT_WEBGL: u32 = 0x9247;

/// How a parameter is read and which JS type it returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `GLboolean`.
    Bool,
    /// `sequence<GLboolean>` of this length.
    Bools(usize),
    /// `GLint` or `GLenum`.
    Int,
    /// `GLuint` (a mask that the GL reports as a signed integer).
    UInt,
    /// `GLint64`.
    Int64,
    /// `GLfloat`.
    Float,
    /// `Float32Array` of this length.
    Floats(usize),
    /// `Int32Array` of this length.
    Ints(usize),
    /// `Uint32Array` of the enabled compressed formats; no extension is
    /// supported yet, so it is empty.
    CompressedFormats,
    /// `DOMString`, built by oxgl.
    String,
    /// A WebGL object; no object type exists yet, so the binding is `null`.
    Object,
    /// Kept by oxgl (WebGL-only unpack parameters).
    Shadow,
    /// `MAX_CLIENT_WAIT_TIMEOUT_WEBGL`: oxgl's `clientWaitSync` will not wait.
    ClientWaitTimeout,
}

/// One row of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    /// The IDL constant's name.
    pub name: &'static str,
    /// Its value.
    pub pname: u32,
    /// How it is read.
    pub kind: Kind,
    /// Only on WebGL 2 contexts.
    pub webgl2_only: bool,
}

macro_rules! table {
    ($($webgl:literal $name:ident $kind:expr;)*) => {
        &[$(Entry {
            name: stringify!($name),
            pname: $name,
            kind: $kind,
            webgl2_only: $webgl == 2,
        },)*]
    };
}

use Kind::{
    Bool, Bools, ClientWaitTimeout, CompressedFormats, Float, Floats, Int, Int64, Ints, Object,
    Shadow, String, UInt,
};

/// Every non-extension parameter of both WebGL versions.
pub const TABLE: &[Entry] = table! {
    1 GL_ACTIVE_TEXTURE Int;
    1 GL_ALIASED_LINE_WIDTH_RANGE Floats(2);
    1 GL_ALIASED_POINT_SIZE_RANGE Floats(2);
    1 GL_ALPHA_BITS Int;
    1 GL_ARRAY_BUFFER_BINDING Object;
    1 GL_BLEND Bool;
    1 GL_BLEND_COLOR Floats(4);
    1 GL_BLEND_DST_ALPHA Int;
    1 GL_BLEND_DST_RGB Int;
    1 GL_BLEND_EQUATION_ALPHA Int;
    1 GL_BLEND_EQUATION_RGB Int;
    1 GL_BLEND_SRC_ALPHA Int;
    1 GL_BLEND_SRC_RGB Int;
    1 GL_BLUE_BITS Int;
    1 GL_COLOR_CLEAR_VALUE Floats(4);
    1 GL_COLOR_WRITEMASK Bools(4);
    1 GL_COMPRESSED_TEXTURE_FORMATS CompressedFormats;
    1 GL_CULL_FACE Bool;
    1 GL_CULL_FACE_MODE Int;
    1 GL_CURRENT_PROGRAM Object;
    1 GL_DEPTH_BITS Int;
    1 GL_DEPTH_CLEAR_VALUE Float;
    1 GL_DEPTH_FUNC Int;
    1 GL_DEPTH_RANGE Floats(2);
    1 GL_DEPTH_TEST Bool;
    1 GL_DEPTH_WRITEMASK Bool;
    1 GL_DITHER Bool;
    1 GL_ELEMENT_ARRAY_BUFFER_BINDING Object;
    // Also WebGL 2's DRAW_FRAMEBUFFER_BINDING, which has the same value.
    1 GL_FRAMEBUFFER_BINDING Object;
    1 GL_FRONT_FACE Int;
    1 GL_GENERATE_MIPMAP_HINT Int;
    1 GL_GREEN_BITS Int;
    1 GL_IMPLEMENTATION_COLOR_READ_FORMAT Int;
    1 GL_IMPLEMENTATION_COLOR_READ_TYPE Int;
    1 GL_LINE_WIDTH Float;
    1 GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS Int;
    1 GL_MAX_CUBE_MAP_TEXTURE_SIZE Int;
    1 GL_MAX_FRAGMENT_UNIFORM_VECTORS Int;
    1 GL_MAX_RENDERBUFFER_SIZE Int;
    1 GL_MAX_TEXTURE_IMAGE_UNITS Int;
    1 GL_MAX_TEXTURE_SIZE Int;
    1 GL_MAX_VARYING_VECTORS Int;
    1 GL_MAX_VERTEX_ATTRIBS Int;
    1 GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS Int;
    1 GL_MAX_VERTEX_UNIFORM_VECTORS Int;
    1 GL_MAX_VIEWPORT_DIMS Ints(2);
    1 GL_PACK_ALIGNMENT Int;
    1 GL_POLYGON_OFFSET_FACTOR Float;
    1 GL_POLYGON_OFFSET_FILL Bool;
    1 GL_POLYGON_OFFSET_UNITS Float;
    1 GL_RED_BITS Int;
    1 GL_RENDERBUFFER_BINDING Object;
    1 GL_RENDERER String;
    1 GL_SAMPLE_ALPHA_TO_COVERAGE Bool;
    1 GL_SAMPLE_BUFFERS Int;
    1 GL_SAMPLE_COVERAGE Bool;
    1 GL_SAMPLE_COVERAGE_INVERT Bool;
    1 GL_SAMPLE_COVERAGE_VALUE Float;
    1 GL_SAMPLES Int;
    1 GL_SCISSOR_BOX Ints(4);
    1 GL_SCISSOR_TEST Bool;
    1 GL_SHADING_LANGUAGE_VERSION String;
    1 GL_STENCIL_BACK_FAIL Int;
    1 GL_STENCIL_BACK_FUNC Int;
    1 GL_STENCIL_BACK_PASS_DEPTH_FAIL Int;
    1 GL_STENCIL_BACK_PASS_DEPTH_PASS Int;
    1 GL_STENCIL_BACK_REF Int;
    1 GL_STENCIL_BACK_VALUE_MASK UInt;
    1 GL_STENCIL_BACK_WRITEMASK UInt;
    1 GL_STENCIL_BITS Int;
    1 GL_STENCIL_CLEAR_VALUE Int;
    1 GL_STENCIL_FAIL Int;
    1 GL_STENCIL_FUNC Int;
    1 GL_STENCIL_PASS_DEPTH_FAIL Int;
    1 GL_STENCIL_PASS_DEPTH_PASS Int;
    1 GL_STENCIL_REF Int;
    1 GL_STENCIL_TEST Bool;
    1 GL_STENCIL_VALUE_MASK UInt;
    1 GL_STENCIL_WRITEMASK UInt;
    1 GL_SUBPIXEL_BITS Int;
    1 GL_TEXTURE_BINDING_2D Object;
    1 GL_TEXTURE_BINDING_CUBE_MAP Object;
    1 GL_UNPACK_ALIGNMENT Int;
    1 UNPACK_COLORSPACE_CONVERSION_WEBGL Shadow;
    1 UNPACK_FLIP_Y_WEBGL Shadow;
    1 UNPACK_PREMULTIPLY_ALPHA_WEBGL Shadow;
    1 GL_VENDOR String;
    1 GL_VERSION String;
    1 GL_VIEWPORT Ints(4);
    2 GL_COPY_READ_BUFFER_BINDING Object;
    2 GL_COPY_WRITE_BUFFER_BINDING Object;
    2 GL_DRAW_BUFFER0 Int;
    2 GL_DRAW_BUFFER1 Int;
    2 GL_DRAW_BUFFER2 Int;
    2 GL_DRAW_BUFFER3 Int;
    2 GL_DRAW_BUFFER4 Int;
    2 GL_DRAW_BUFFER5 Int;
    2 GL_DRAW_BUFFER6 Int;
    2 GL_DRAW_BUFFER7 Int;
    2 GL_DRAW_BUFFER8 Int;
    2 GL_DRAW_BUFFER9 Int;
    2 GL_DRAW_BUFFER10 Int;
    2 GL_DRAW_BUFFER11 Int;
    2 GL_DRAW_BUFFER12 Int;
    2 GL_DRAW_BUFFER13 Int;
    2 GL_DRAW_BUFFER14 Int;
    2 GL_DRAW_BUFFER15 Int;
    2 GL_FRAGMENT_SHADER_DERIVATIVE_HINT Int;
    2 GL_MAX_3D_TEXTURE_SIZE Int;
    2 GL_MAX_ARRAY_TEXTURE_LAYERS Int;
    2 MAX_CLIENT_WAIT_TIMEOUT_WEBGL ClientWaitTimeout;
    2 GL_MAX_COLOR_ATTACHMENTS Int;
    2 GL_MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS Int64;
    2 GL_MAX_COMBINED_UNIFORM_BLOCKS Int;
    2 GL_MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS Int64;
    2 GL_MAX_DRAW_BUFFERS Int;
    2 GL_MAX_ELEMENT_INDEX Int64;
    2 GL_MAX_ELEMENTS_INDICES Int;
    2 GL_MAX_ELEMENTS_VERTICES Int;
    2 GL_MAX_FRAGMENT_INPUT_COMPONENTS Int;
    2 GL_MAX_FRAGMENT_UNIFORM_BLOCKS Int;
    2 GL_MAX_FRAGMENT_UNIFORM_COMPONENTS Int;
    2 GL_MAX_PROGRAM_TEXEL_OFFSET Int;
    2 GL_MAX_SAMPLES Int;
    2 GL_MAX_SERVER_WAIT_TIMEOUT Int64;
    2 GL_MAX_TEXTURE_LOD_BIAS Float;
    2 GL_MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS Int;
    2 GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS Int;
    2 GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS Int;
    2 GL_MAX_UNIFORM_BLOCK_SIZE Int64;
    2 GL_MAX_UNIFORM_BUFFER_BINDINGS Int;
    2 GL_MAX_VARYING_COMPONENTS Int;
    2 GL_MAX_VERTEX_OUTPUT_COMPONENTS Int;
    2 GL_MAX_VERTEX_UNIFORM_BLOCKS Int;
    2 GL_MAX_VERTEX_UNIFORM_COMPONENTS Int;
    2 GL_MIN_PROGRAM_TEXEL_OFFSET Int;
    2 GL_PACK_ROW_LENGTH Int;
    2 GL_PACK_SKIP_PIXELS Int;
    2 GL_PACK_SKIP_ROWS Int;
    2 GL_PIXEL_PACK_BUFFER_BINDING Object;
    2 GL_PIXEL_UNPACK_BUFFER_BINDING Object;
    2 GL_RASTERIZER_DISCARD Bool;
    2 GL_READ_BUFFER Int;
    2 GL_READ_FRAMEBUFFER_BINDING Object;
    2 GL_SAMPLER_BINDING Object;
    2 GL_TEXTURE_BINDING_2D_ARRAY Object;
    2 GL_TEXTURE_BINDING_3D Object;
    2 GL_TRANSFORM_FEEDBACK_ACTIVE Bool;
    2 GL_TRANSFORM_FEEDBACK_BINDING Object;
    2 GL_TRANSFORM_FEEDBACK_BUFFER_BINDING Object;
    2 GL_TRANSFORM_FEEDBACK_PAUSED Bool;
    2 GL_UNIFORM_BUFFER_BINDING Object;
    2 GL_UNIFORM_BUFFER_OFFSET_ALIGNMENT Int;
    2 GL_UNPACK_IMAGE_HEIGHT Int;
    2 GL_UNPACK_ROW_LENGTH Int;
    2 GL_UNPACK_SKIP_IMAGES Int;
    2 GL_UNPACK_SKIP_PIXELS Int;
    2 GL_UNPACK_SKIP_ROWS Int;
    2 GL_VERTEX_ARRAY_BINDING Object;
};

/// The entry for `pname` on a context of the given version, if it has one.
#[must_use]
pub fn lookup(pname: u32, webgl2: bool) -> Option<&'static Entry> {
    TABLE
        .iter()
        .find(|entry| entry.pname == pname && (webgl2 || !entry.webgl2_only))
}

/// A `getParameter` result, before conversion to a JS value.
#[derive(Debug, Clone, PartialEq)]
pub enum Parameter {
    /// `null`.
    Null,
    /// A number.
    Number(f64),
    /// A boolean.
    Boolean(bool),
    /// An array of booleans.
    Booleans(Vec<bool>),
    /// A string.
    String(std::string::String),
    /// A `Float32Array`.
    Float32(Vec<f32>),
    /// An `Int32Array`.
    Int32(Vec<i32>),
    /// A `Uint32Array`.
    Uint32(Vec<u32>),
}

/// The robust query that reads `kind`, if it is one ANGLE answers.
#[must_use]
pub fn value_type(kind: Kind) -> Option<ValueType> {
    match kind {
        Bool | Bools(_) => Some(ValueType::Boolean),
        Int | UInt | Ints(_) => Some(ValueType::Integer),
        Int64 => Some(ValueType::Integer64),
        Float | Floats(_) => Some(ValueType::Float),
        CompressedFormats | String | Object | Shadow | ClientWaitTimeout => None,
    }
}

/// Converts values ANGLE returned for `kind` into the JS-facing result.
#[must_use]
pub fn from_values(kind: Kind, values: Values) -> Parameter {
    match (kind, values) {
        (Bool, Values::Booleans(v)) => Parameter::Boolean(v[0]),
        (Bools(n), Values::Booleans(v)) => Parameter::Booleans(v.iter().take(n).copied().collect()),
        (Int, Values::Integers(v)) => Parameter::Number(f64::from(v[0])),
        (UInt, Values::Integers(v)) => Parameter::Number(f64::from(v[0].cast_unsigned())),
        (Ints(n), Values::Integers(v)) => Parameter::Int32(v.iter().take(n).copied().collect()),
        // Every GLint64 parameter in the tables fits in 2^53.
        #[allow(clippy::cast_precision_loss, reason = "values are below 2^53")]
        (Int64, Values::Integer64s(v)) => Parameter::Number(v[0] as f64),
        (Float, Values::Floats(v)) => Parameter::Number(f64::from(v[0])),
        (Floats(n), Values::Floats(v)) => Parameter::Float32(v.iter().take(n).copied().collect()),
        _ => Parameter::Null,
    }
}

/// `VERSION` and `SHADING_LANGUAGE_VERSION` (WebGL 1.0 §5.14.3, WebGL 2.0
/// §3.7.2): the WebGL prefix, then ANGLE's own string in parentheses.
#[must_use]
pub fn version_string(pname: u32, webgl2: bool, gl_string: Option<&str>) -> std::string::String {
    let prefix = match (pname, webgl2) {
        (GL_SHADING_LANGUAGE_VERSION, false) => "WebGL GLSL ES 1.0",
        (GL_SHADING_LANGUAGE_VERSION, true) => "WebGL GLSL ES 3.00",
        (_, false) => "WebGL 1.0",
        (_, true) => "WebGL 2.0",
    };
    match gl_string {
        Some(detail) => format!("{prefix} ({detail})"),
        None => prefix.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pnames_are_unique_per_version() {
        for (i, a) in TABLE.iter().enumerate() {
            for b in &TABLE[i + 1..] {
                assert_ne!(a.pname, b.pname, "{} and {}", a.name, b.name);
            }
        }
    }

    #[test]
    fn version_gating() {
        assert!(lookup(GL_MAX_3D_TEXTURE_SIZE, false).is_none());
        assert!(lookup(GL_MAX_3D_TEXTURE_SIZE, true).is_some());
        assert!(lookup(GL_VIEWPORT, false).is_some());
        assert!(lookup(0x1234, true).is_none());
        // MAX_TEXTURE_MAX_ANISOTROPY_EXT: extension parameters are absent.
        assert!(lookup(0x84FF, true).is_none());
    }

    #[test]
    fn conversions_per_kind() {
        let ints = Values::Integers([-1, 2, 3, 4]);
        assert_eq!(from_values(Int, ints), Parameter::Number(-1.0));
        assert_eq!(from_values(UInt, ints), Parameter::Number(4_294_967_295.0));
        assert_eq!(from_values(Ints(2), ints), Parameter::Int32(vec![-1, 2]));
        let floats = Values::Floats([0.25, 1.0, 0.0, 0.5]);
        assert_eq!(from_values(Float, floats), Parameter::Number(0.25));
        assert_eq!(
            from_values(Floats(4), floats),
            Parameter::Float32(vec![0.25, 1.0, 0.0, 0.5])
        );
        let bools = Values::Booleans([true, false, true, false]);
        assert_eq!(from_values(Bool, bools), Parameter::Boolean(true));
        assert_eq!(
            from_values(Bools(4), bools),
            Parameter::Booleans(vec![true, false, true, false])
        );
        let longs = Values::Integer64s([4_294_967_295, 0, 0, 0]);
        assert_eq!(
            from_values(Int64, longs),
            Parameter::Number(4_294_967_295.0)
        );
    }

    #[test]
    fn version_strings() {
        assert_eq!(
            version_string(GL_VERSION, false, Some("OpenGL ES 2.0.0")),
            "WebGL 1.0 (OpenGL ES 2.0.0)"
        );
        assert!(version_string(GL_VERSION, true, None).starts_with("WebGL 2.0"));
        assert!(
            version_string(GL_SHADING_LANGUAGE_VERSION, false, None)
                .starts_with("WebGL GLSL ES 1.0")
        );
        assert!(
            version_string(GL_SHADING_LANGUAGE_VERSION, true, None)
                .starts_with("WebGL GLSL ES 3.00")
        );
    }

    /// Every table entry is a constant of the generated IDL tables, with the
    /// same value, on the interface of the entry's version.
    #[test]
    fn entries_match_the_idl_constants() {
        let source = include_str!("../../../src/generated/webgl-constants.ts");
        let section = |marker: &str| {
            let start = source.find(marker).unwrap_or(0);
            let end = source[start..]
                .find("} as const")
                .map_or(source.len(), |i| start + i);
            &source[start..end]
        };
        let webgl1 = section("export const WEBGL1_CONSTANTS");
        let webgl2_only = section("export const WEBGL2_ONLY_CONSTANTS");
        let value_in = |table: &str, name: &str| {
            table.lines().find_map(|line| {
                let (key, value) = line.trim().trim_end_matches(',').split_once(": ")?;
                (key == name).then(|| {
                    let value = value.trim();
                    value.strip_prefix("0x").map_or_else(
                        || value.parse::<i64>().ok(),
                        |hex| i64::from_str_radix(hex, 16).ok(),
                    )
                })?
            })
        };
        for entry in TABLE {
            let name = entry.name.strip_prefix("GL_").unwrap_or(entry.name);
            let found = if entry.webgl2_only {
                value_in(webgl2_only, name)
            } else {
                value_in(webgl1, name)
            };
            assert_eq!(found, Some(i64::from(entry.pname)), "{name}");
        }
    }
}
