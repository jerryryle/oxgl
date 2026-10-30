//! Exports for buffers, shaders, programs, uniforms, vertex attributes and
//! draw calls. Objects cross as two `u32`s, `[0, 0]` for `null`; numbers are
//! already converted per `WebIDL` in TS (`GLintptr`/`GLsizeiptr` as exact
//! integers in `f64`).

use napi::bindgen_prelude::{Env, Unknown};
use napi_derive::napi;
use oxgl_core::rendering::{AttribKind, LocationKind, ObjectType, Scalar, SubRange};
use oxgl_core::{Context, object_key_from_parts, object_key_to_parts};
use oxgl_sys::napi_view::{ReadSource, WriteTarget};
use oxgl_sys::{UniformMatrix, UniformVector};

use crate::{ParameterValue, key, parameter_value, runtime, with_context};

/// The object key for `[index, version]`; `None` for `null` (`[0, 0]`).
pub(crate) fn object(index: u32, version: u32) -> Option<oxgl_core::context::ObjectKey> {
    object_key_from_parts([index, version])
}

/// Runs `f` on the context and returns its result, or `default` when the
/// context is destroyed.
pub(crate) fn query<T>(
    env: Env,
    index: u32,
    version: u32,
    default: T,
    f: impl FnOnce(&mut Context) -> T,
) -> napi::Result<T> {
    Ok(runtime(env)?
        .context(key(index, version))
        .map_or(default, f))
}

/// A `GLintptr`/`GLsizeiptr` from TS: an integer already, saturating.
#[allow(
    clippy::cast_possible_truncation,
    reason = "WebIDL long long values are exact integers"
)]
pub(crate) fn long(value: f64) -> i64 {
    value as i64
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "non-negative element counts from TS"
)]
fn range(offset: f64, length: f64) -> SubRange {
    SubRange {
        offset: offset as u64,
        length: length as u64,
    }
}

fn scalar(value: Option<Scalar>) -> Option<ParameterValue> {
    value.and_then(|v| {
        parameter_value(match v {
            Scalar::Bool(b) => oxgl_core::parameters::Parameter::Boolean(b),
            Scalar::Int(i) => oxgl_core::parameters::Parameter::Number(f64::from(i)),
        })
    })
}

fn attrib_kind(kind: u32) -> AttribKind {
    match kind {
        1 => AttribKind::Int,
        2 => AttribKind::Uint,
        _ => AttribKind::Float,
    }
}

/// Four WebIDL-converted numbers as the bits of `kind`'s scalar type.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "values are exact in their WebIDL type"
)]
fn quad(kind: u32, values: [f64; 4]) -> [u32; 4] {
    values.map(|v| match kind {
        1 => (v as i32).cast_unsigned(),
        2 => v as u32,
        _ => (v as f32).to_bits(),
    })
}

/// `synthesizeError`: an error found by the TS layer's checks.
#[napi]
pub fn synthesize_error(env: Env, index: u32, version: u32, code: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| c.synthesize_error(code))
}

/// `createBuffer` (`kind` 0), `createShader` (1, with `shader_type`),
/// `createProgram` (2), `createTexture` (3), `createSampler` (4),
/// `createFramebuffer` (5) or `createRenderbuffer` (6); `null`
/// when lost or refused.
#[napi]
pub fn create_object(
    env: Env,
    index: u32,
    version: u32,
    kind: u32,
    shader_type: u32,
) -> napi::Result<Option<Vec<u32>>> {
    let ty = match kind {
        0 => ObjectType::Buffer,
        1 => ObjectType::Shader(shader_type),
        3 => ObjectType::Texture,
        4 => ObjectType::Sampler,
        5 => ObjectType::Framebuffer,
        6 => ObjectType::Renderbuffer,
        _ => ObjectType::Program,
    };
    query(env, index, version, None, |c| {
        c.create_object(ty).map(|k| object_key_to_parts(k).to_vec())
    })
}

/// `delete*`.
#[napi]
pub fn delete_object(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(key) = object(oi, ov) {
            c.delete_object(key);
        }
    })
}

/// `FinalizationRegistry` callback for a collected object.
#[napi]
pub fn release_object(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<()> {
    if let Some(object) = object(oi, ov) {
        runtime(env)?.release_object(key(index, version), object);
    }
    Ok(())
}

/// Number of live objects across this environment's contexts (for tests).
#[napi]
pub fn live_objects(env: Env) -> napi::Result<u32> {
    Ok(u32::try_from(runtime(env)?.live_objects()).unwrap_or(u32::MAX))
}

/// `is*`: whether the object is live (a buffer only once bound).
#[napi]
pub fn has_object(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        object(oi, ov).is_some_and(|key| c.has_object(key))
    })
}

/// `bindBuffer`; whether the binding changed.
#[napi]
pub fn bind_buffer(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_buffer(target, object(oi, ov))
    })
}

/// `bufferData(target, size, usage)`.
#[napi]
pub fn buffer_data_size(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    size: f64,
    usage: u32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.buffer_data_size(target, long(size), usage);
    })
}

/// `bufferData` with a source; TS has checked it is a buffer or view.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn buffer_data(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    source: Unknown<'_>,
    usage: u32,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let source = ReadSource::new(&source)?;
    with_context(env, index, version, |c| match &source {
        Some(source) => c.buffer_data(target, source, usage, range(offset, length)),
        None => c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE),
    })
}

/// `bufferSubData`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn buffer_sub_data(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    dst_offset: f64,
    source: Unknown<'_>,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let source = ReadSource::new(&source)?;
    with_context(env, index, version, |c| match &source {
        Some(source) => c.buffer_sub_data(target, long(dst_offset), source, range(offset, length)),
        None => c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE),
    })
}

/// `copyBufferSubData`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn copy_buffer_sub_data(
    env: Env,
    index: u32,
    version: u32,
    read_target: u32,
    write_target: u32,
    read_offset: f64,
    write_offset: f64,
    size: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.copy_buffer_sub_data(
            read_target,
            write_target,
            long(read_offset),
            long(write_offset),
            long(size),
        );
    })
}

/// `getBufferSubData`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn get_buffer_sub_data(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    src_offset: f64,
    destination: Unknown<'_>,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let destination = WriteTarget::new(&destination)?;
    with_context(env, index, version, |c| match &destination {
        Some(d) => c.get_buffer_sub_data(target, long(src_offset), d, range(offset, length)),
        None => c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE),
    })
}

/// `getBufferParameter`.
#[napi]
pub fn get_buffer_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    pname: u32,
) -> napi::Result<Option<i32>> {
    query(env, index, version, None, |c| {
        c.buffer_parameter(target, pname)
    })
}

/// `shaderSource`.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn shader_source(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    source: String,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(shader) = object(oi, ov) {
            c.shader_source(shader, &source);
        }
    })
}

/// `compileShader`.
#[napi]
pub fn compile_shader(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(shader) = object(oi, ov) {
            c.compile_shader(shader);
        }
    })
}

/// `getShaderParameter`.
#[napi]
pub fn get_shader_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        scalar(object(oi, ov).and_then(|s| c.shader_parameter(s, pname)))
    })
}

/// `getShaderInfoLog`.
#[napi]
pub fn get_shader_info_log(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<Option<String>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|s| c.shader_info_log(s))
    })
}

/// `attachShader` (`attach` true) or `detachShader`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "two objects")]
pub fn attach_shader(
    env: Env,
    index: u32,
    version: u32,
    pi: u32,
    pv: u32,
    si: u32,
    sv: u32,
    attach: bool,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let (Some(p), Some(s)) = (object(pi, pv), object(si, sv)) {
            c.attach_shader(p, s, attach);
        }
    })
}

/// `linkProgram`.
#[napi]
pub fn link_program(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(p) = object(oi, ov) {
            c.link_program(p);
        }
    })
}

/// `validateProgram`.
#[napi]
pub fn validate_program(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(p) = object(oi, ov) {
            c.validate_program(p);
        }
    })
}

/// `useProgram`; whether the program is now current.
#[napi]
pub fn use_program(env: Env, index: u32, version: u32, oi: u32, ov: u32) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.use_program(object(oi, ov))
    })
}

/// `getProgramParameter`.
#[napi]
pub fn get_program_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        scalar(object(oi, ov).and_then(|p| c.program_parameter(p, pname)))
    })
}

/// `getProgramInfoLog`.
#[napi]
pub fn get_program_info_log(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<Option<String>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|p| c.program_info_log(p))
    })
}

/// `bindAttribLocation`.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn bind_attrib_location(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    location: u32,
    name: String,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(p) = object(oi, ov) {
            c.bind_attrib_location(p, location, &name);
        }
    })
}

/// `getAttribLocation` (`kind` 0), `getUniformLocation` (1) or
/// `getFragDataLocation` (2); -1 when absent.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn get_location(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    name: String,
    kind: u32,
) -> napi::Result<i32> {
    let kind = match kind {
        0 => LocationKind::Attrib,
        1 => LocationKind::Uniform,
        _ => LocationKind::FragData,
    };
    query(env, index, version, -1, |c| {
        object(oi, ov).map_or(-1, |p| c.location(p, &name, kind))
    })
}

/// A `WebGLActiveInfo`'s attributes.
#[napi(object)]
pub struct ActiveInfoValue {
    /// `size`.
    pub size: i32,
    /// `type`.
    pub ty: u32,
    /// `name`.
    pub name: String,
}

/// `getActiveAttrib` (`uniform` false) or `getActiveUniform`.
#[napi]
pub fn get_active_info(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    position: u32,
    uniform: bool,
) -> napi::Result<Option<ActiveInfoValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|p| c.active_info(p, position, uniform))
            .map(|info| ActiveInfoValue {
                size: info.size,
                ty: info.ty,
                name: info.name,
            })
    })
}

fn vector(kind: u32, n: u32) -> UniformVector {
    let n = u8::try_from(n.clamp(1, 4)).unwrap_or(4);
    match kind {
        1 => UniformVector::Int(n),
        2 => UniformVector::Uint(n),
        _ => UniformVector::Float(n),
    }
}

/// `uniform[1234][f|i|ui]`: `kind` 0 float, 1 int, 2 uint.
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::many_single_char_names,
    reason = "mirrors the WebGL signature"
)]
pub fn uniform_values(
    env: Env,
    index: u32,
    version: u32,
    location: i32,
    kind: u32,
    n: u32,
    x: f64,
    y: f64,
    z: f64,
    w: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.uniform_values(location, vector(kind, n), quad(kind, [x, y, z, w]));
    })
}

/// `uniform[1234][f|i|ui]v` from a typed array.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn uniform_vector(
    env: Env,
    index: u32,
    version: u32,
    location: i32,
    kind: u32,
    n: u32,
    source: Unknown<'_>,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let source = ReadSource::new(&source)?;
    with_context(env, index, version, |c| match &source {
        Some(source) => c.uniform_vector(location, vector(kind, n), source, range(offset, length)),
        None => c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE),
    })
}

/// `uniformMatrix{cols}x{rows}fv` from a `Float32Array`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn uniform_matrix(
    env: Env,
    index: u32,
    version: u32,
    location: i32,
    columns: u32,
    rows: u32,
    transpose: bool,
    source: Unknown<'_>,
    offset: f64,
    length: f64,
) -> napi::Result<()> {
    let shape = match (columns, rows) {
        (2, 2) => UniformMatrix::Mat2,
        (3, 3) => UniformMatrix::Mat3,
        (2, 3) => UniformMatrix::Mat2x3,
        (2, 4) => UniformMatrix::Mat2x4,
        (3, 2) => UniformMatrix::Mat3x2,
        (3, 4) => UniformMatrix::Mat3x4,
        (4, 2) => UniformMatrix::Mat4x2,
        (4, 3) => UniformMatrix::Mat4x3,
        _ => UniformMatrix::Mat4,
    };
    let source = ReadSource::new(&source)?;
    with_context(env, index, version, |c| match &source {
        Some(source) => c.uniform_matrix(location, shape, transpose, source, range(offset, length)),
        None => c.synthesize_error(oxgl_sys::bindings::GL_INVALID_VALUE),
    })
}

/// `getUniform`.
#[napi]
pub fn get_uniform(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    location: i32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|p| c.get_uniform(p, location))
            .and_then(parameter_value)
    })
}

/// `enableVertexAttribArray` (`enable` true) / `disableVertexAttribArray`.
#[napi]
pub fn vertex_attrib_array(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    enable: bool,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.vertex_attrib_array(attrib, enable);
    })
}

/// `vertexAttribPointer` (`normalized` 0 or 1) or `vertexAttribIPointer`
/// (`normalized` -1); whether the attribute now uses the `ARRAY_BUFFER`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn vertex_attrib_pointer(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    size: i32,
    ty: u32,
    normalized: i32,
    stride: i32,
    offset: f64,
) -> napi::Result<bool> {
    let normalized = (normalized >= 0).then_some(normalized > 0);
    query(env, index, version, false, |c| {
        c.vertex_attrib_pointer(attrib, size, ty, normalized, stride, long(offset))
    })
}

/// `vertexAttrib*`: `kind` 0 float, 1 int, 2 uint.
#[napi]
#[allow(
    clippy::too_many_arguments,
    clippy::many_single_char_names,
    reason = "mirrors the WebGL signature"
)]
pub fn vertex_attrib(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    kind: u32,
    x: f64,
    y: f64,
    z: f64,
    w: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.vertex_attrib(attrib, attrib_kind(kind), quad(kind, [x, y, z, w]));
    })
}

/// `getVertexAttrib` for a non-object `pname`.
#[napi]
pub fn get_vertex_attrib(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    pname: u32,
    kind: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        c.get_vertex_attrib(attrib, pname, attrib_kind(kind))
            .and_then(parameter_value)
    })
}

/// `getVertexAttribOffset`.
#[napi]
#[allow(clippy::cast_precision_loss, reason = "offsets fit a JS number")]
pub fn get_vertex_attrib_offset(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    pname: u32,
) -> napi::Result<f64> {
    query(env, index, version, 0.0, |c| {
        c.vertex_attrib_offset(attrib, pname) as f64
    })
}

/// `drawArrays`.
#[napi]
pub fn draw_arrays(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    first: i32,
    count: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| c.draw_arrays(mode, first, count))
}

/// `drawElements`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn draw_elements(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    count: i32,
    ty: u32,
    offset: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.draw_elements(mode, count, ty, long(offset), None);
    })
}

/// `drawRangeElements`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn draw_range_elements(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    start: u32,
    end: u32,
    count: i32,
    ty: u32,
    offset: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.draw_elements(mode, count, ty, long(offset), Some((start, end)));
    })
}
