//! Exports for WebGL 2's vertex arrays, instancing, indexed bindings and
//! uniform blocks, transform feedback, queries and sync objects.

use napi::bindgen_prelude::Env;
use napi_derive::napi;
use oxgl_core::object_key_to_parts;
use oxgl_core::webgl2::TransformFeedbackOp;

use crate::rendering::{ActiveInfoValue, long, object, query};
use crate::{ParameterValue, parameter_value, with_context};

/// `bindVertexArray`.
#[napi]
pub fn bind_vertex_array(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_vertex_array(object(oi, ov))
    })
}

/// `drawArraysInstanced`.
#[napi]
pub fn draw_arrays_instanced(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    first: i32,
    count: i32,
    instances: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.draw_arrays_instanced(mode, first, count, instances);
    })
}

/// `drawElementsInstanced`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn draw_elements_instanced(
    env: Env,
    index: u32,
    version: u32,
    mode: u32,
    count: i32,
    ty: u32,
    offset: f64,
    instances: i32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.draw_elements_instanced(mode, count, ty, long(offset), instances);
    })
}

/// `vertexAttribDivisor`.
#[napi]
pub fn vertex_attrib_divisor(
    env: Env,
    index: u32,
    version: u32,
    attrib: u32,
    divisor: u32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        c.vertex_attrib_divisor(attrib, divisor);
    })
}

/// `bindBufferBase` (no `range`) or `bindBufferRange`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn bind_buffer_indexed(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    at: u32,
    oi: u32,
    ov: u32,
    range: Option<Vec<f64>>,
) -> napi::Result<bool> {
    let range = range.and_then(|r| match r.as_slice() {
        [offset, size] => Some((long(*offset), long(*size))),
        _ => None,
    });
    query(env, index, version, false, |c| {
        c.bind_buffer_indexed(target, at, object(oi, ov), range)
    })
}

/// `getIndexedParameter` for `*_START`/`*_SIZE`.
#[napi]
pub fn get_indexed_parameter(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    at: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        c.indexed_parameter(target, at).and_then(parameter_value)
    })
}

/// `getUniformBlockIndex`.
#[napi]
#[allow(
    clippy::needless_pass_by_value,
    reason = "napi-rs passes JS strings owned"
)]
pub fn get_uniform_block_index(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    name: String,
) -> napi::Result<u32> {
    query(
        env,
        index,
        version,
        oxgl_sys::bindings::GL_INVALID_INDEX,
        |c| {
            object(oi, ov).map_or(oxgl_sys::bindings::GL_INVALID_INDEX, |p| {
                c.uniform_block_index(p, &name)
            })
        },
    )
}

/// `getUniformIndices`.
#[napi]
#[allow(clippy::needless_pass_by_value, reason = "napi-rs passes arrays owned")]
pub fn get_uniform_indices(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    names: Vec<String>,
) -> napi::Result<Option<Vec<u32>>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|p| c.uniform_indices(p, &names))
    })
}

/// `getActiveUniforms`.
#[napi]
#[allow(clippy::needless_pass_by_value, reason = "napi-rs passes arrays owned")]
pub fn get_active_uniforms(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    indices: Vec<u32>,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|p| c.active_uniforms(p, &indices, pname))
            .and_then(parameter_value)
    })
}

/// `getActiveUniformBlockParameter`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn get_active_uniform_block_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    block: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|p| c.active_uniform_block_parameter(p, block, pname))
            .and_then(parameter_value)
    })
}

/// `getActiveUniformBlockName`.
#[napi]
pub fn get_active_uniform_block_name(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    block: u32,
) -> napi::Result<Option<String>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|p| c.active_uniform_block_name(p, block))
    })
}

/// `uniformBlockBinding`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn uniform_block_binding(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    block: u32,
    binding: u32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(p) = object(oi, ov) {
            c.uniform_block_binding(p, block, binding);
        }
    })
}

/// `bindTransformFeedback`.
#[napi]
pub fn bind_transform_feedback(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        c.bind_transform_feedback(target, object(oi, ov))
    })
}

/// `beginTransformFeedback` (`op` 0, `mode`), `end…` (1), `pause…` (2) or
/// `resume…` (3).
#[napi]
pub fn transform_feedback(
    env: Env,
    index: u32,
    version: u32,
    op: u32,
    mode: u32,
) -> napi::Result<()> {
    let op = match op {
        0 => TransformFeedbackOp::Begin(mode),
        2 => TransformFeedbackOp::Pause,
        3 => TransformFeedbackOp::Resume,
        _ => TransformFeedbackOp::End,
    };
    with_context(env, index, version, |c| c.transform_feedback(op))
}

/// `transformFeedbackVaryings`.
#[napi]
#[allow(clippy::needless_pass_by_value, reason = "napi-rs passes arrays owned")]
pub fn transform_feedback_varyings(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    names: Vec<String>,
    mode: u32,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(p) = object(oi, ov) {
            c.transform_feedback_varyings(p, &names, mode);
        }
    })
}

/// `getTransformFeedbackVarying`.
#[napi]
pub fn get_transform_feedback_varying(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    at: u32,
) -> napi::Result<Option<ActiveInfoValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|p| c.transform_feedback_varying(p, at))
            .map(|info| ActiveInfoValue {
                size: info.size,
                ty: info.ty,
                name: info.name,
            })
    })
}

/// `beginQuery`; whether the query is now active.
#[napi]
pub fn begin_query(
    env: Env,
    index: u32,
    version: u32,
    target: u32,
    oi: u32,
    ov: u32,
) -> napi::Result<bool> {
    query(env, index, version, false, |c| {
        object(oi, ov).is_some_and(|q| c.begin_query(target, q))
    })
}

/// `endQuery`; whether a query was ended.
#[napi]
pub fn end_query(env: Env, index: u32, version: u32, target: u32) -> napi::Result<bool> {
    query(env, index, version, false, |c| c.end_query(target))
}

/// `getQueryParameter`.
#[napi]
pub fn get_query_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
) -> napi::Result<Option<ParameterValue>> {
    query(env, index, version, None, |c| {
        object(oi, ov)
            .and_then(|q| c.query_parameter(q, pname))
            .and_then(parameter_value)
    })
}

/// `fenceSync`; the new object's key, or `null`.
#[napi]
pub fn fence_sync(
    env: Env,
    index: u32,
    version: u32,
    condition: u32,
    flags: u32,
) -> napi::Result<Option<Vec<u32>>> {
    query(env, index, version, None, |c| {
        c.fence_sync(condition, flags)
            .map(|k| object_key_to_parts(k).to_vec())
    })
}

/// `clientWaitSync`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn client_wait_sync(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    flags: u32,
    timeout: f64,
) -> napi::Result<u32> {
    query(
        env,
        index,
        version,
        oxgl_sys::bindings::GL_WAIT_FAILED,
        |c| {
            object(oi, ov).map_or(oxgl_sys::bindings::GL_WAIT_FAILED, |s| {
                c.client_wait_sync(s, flags, long(timeout))
            })
        },
    )
}

/// `waitSync`.
#[napi]
#[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
pub fn wait_sync(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    flags: u32,
    timeout: f64,
) -> napi::Result<()> {
    with_context(env, index, version, |c| {
        if let Some(s) = object(oi, ov) {
            c.wait_sync(s, flags, long(timeout));
        }
    })
}

/// `getSyncParameter`.
#[napi]
pub fn get_sync_parameter(
    env: Env,
    index: u32,
    version: u32,
    oi: u32,
    ov: u32,
    pname: u32,
) -> napi::Result<Option<f64>> {
    query(env, index, version, None, |c| {
        object(oi, ov).and_then(|s| c.sync_parameter(s, pname))
    })
}
