//! WebGL 2 objects: vertex arrays, instancing, indexed buffer bindings and
//! uniform blocks, transform feedback, queries and sync objects (WebGL 2.0
//! §3.7.3, §3.7.9, §3.7.12–§3.7.17). ANGLE validates the rules; oxgl
//! resolves handles and shapes results.

#[allow(
    clippy::wildcard_imports,
    reason = "this module names many GL_ constants"
)]
use oxgl_sys::bindings::*;

use crate::context::{Context, Object, ObjectKey, current};
use crate::parameters::Parameter;
use crate::rendering::{BufferKind, target_allowed};

/// `TIMEOUT_IGNORED`, the only timeout `waitSync` accepts (WebGL 2.0
/// §3.7.14).
pub const TIMEOUT_IGNORED: i64 = -1;

impl Context {
    fn named(&self, key: Option<ObjectKey>, pick: fn(&Object) -> Option<u32>) -> Result<u32, ()> {
        match key {
            None => Ok(0),
            Some(key) => self.objects.get(key).and_then(pick).ok_or(()),
        }
    }

    /// `bindVertexArray`; returns whether the binding changed.
    pub fn bind_vertex_array(&mut self, array: Option<ObjectKey>) -> bool {
        let Ok(name) = self.named(array, |o| match o {
            Object::VertexArray { name } => Some(*name),
            _ => None,
        }) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return false;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        if self.webgl2 {
            current.bind_vertex_array(name);
        } else {
            current.bind_vertex_array_oes(name);
        }
        true
    }

    /// `drawArraysInstanced`.
    pub fn draw_arrays_instanced(&mut self, mode: u32, first: i32, count: i32, instances: i32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if self.webgl2 {
                current.draw_arrays_instanced(mode, first, count, instances);
            } else {
                current.draw_arrays_instanced_angle(mode, first, count, instances);
            }
        }
    }

    /// `drawElementsInstanced`.
    pub fn draw_elements_instanced(
        &mut self,
        mode: u32,
        count: i32,
        ty: u32,
        offset: i64,
        instances: i32,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        if self.webgl2 {
            current.draw_elements_instanced(mode, count, ty, offset, instances);
        } else {
            current.draw_elements_instanced_angle(mode, count, ty, offset, instances);
        }
    }

    /// `vertexAttribDivisor`.
    pub fn vertex_attrib_divisor(&mut self, index: u32, divisor: u32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if self.webgl2 {
                current.vertex_attrib_divisor(index, divisor);
            } else {
                current.vertex_attrib_divisor_angle(index, divisor);
            }
        }
    }

    /// `bindBufferBase` (`range` `None`) or `bindBufferRange`; returns
    /// whether the indexed binding now holds the buffer.
    pub fn bind_buffer_indexed(
        &mut self,
        target: u32,
        index: u32,
        buffer: Option<ObjectKey>,
        range: Option<(i64, i64)>,
    ) -> bool {
        if current(&self.buffer, &mut self.errors).is_none() {
            return false;
        }
        let binding = match target {
            GL_TRANSFORM_FEEDBACK_BUFFER => GL_TRANSFORM_FEEDBACK_BUFFER_BINDING,
            GL_UNIFORM_BUFFER => GL_UNIFORM_BUFFER_BINDING,
            _ => {
                self.errors.synthesize(GL_INVALID_ENUM);
                return false;
            }
        };
        let name = match buffer {
            None => 0,
            Some(key) => {
                if let Some(Object::Buffer { name, kind }) = self.objects.get_mut(key) {
                    if !target_allowed(*kind, target) {
                        self.errors.synthesize(GL_INVALID_OPERATION);
                        return false;
                    }
                    if *kind == BufferKind::Unbound {
                        *kind = BufferKind::Other;
                    }
                    *name
                } else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return false;
                }
            }
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        match range {
            None => current.bind_buffer_base(target, index, name),
            Some((offset, size)) => current.bind_buffer_range(target, index, name, offset, size),
        }
        current.integer64_indexed(binding, index).first() == Some(&i64::from(name))
    }

    /// `getIndexedParameter` for the `*_START` and `*_SIZE` pnames (the
    /// bindings are answered by the TS layer).
    pub fn indexed_parameter(&mut self, target: u32, index: u32) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        let values = current.integer64_indexed(target, index);
        let first = *values.first()?;
        // OES_draw_buffers_indexed's COLOR_WRITEMASK is four booleans.
        if target == GL_COLOR_WRITEMASK {
            return Some(Parameter::Booleans(
                values.iter().map(|&v| v != 0).collect(),
            ));
        }
        #[allow(
            clippy::cast_precision_loss,
            reason = "offsets, sizes and enums fit a JS number"
        )]
        Some(Parameter::Number(first as f64))
    }

    fn program_key_name(&mut self, program: ObjectKey) -> Option<u32> {
        let name = match self.objects.get(program) {
            Some(Object::Program { name }) => Some(*name),
            _ => None,
        };
        if name.is_none() {
            self.synthesize_error(GL_INVALID_VALUE);
        }
        name
    }

    /// `getUniformBlockIndex`; `INVALID_INDEX` when absent.
    pub fn uniform_block_index(&mut self, program: ObjectKey, name: &str) -> u32 {
        let Some(program) = self.program_key_name(program) else {
            return GL_INVALID_INDEX;
        };
        let Ok(name) = std::ffi::CString::new(name) else {
            return GL_INVALID_INDEX;
        };
        current(&self.buffer, &mut self.errors)
            .map_or(GL_INVALID_INDEX, |c| c.uniform_block_index(program, &name))
    }

    /// `getUniformIndices`.
    pub fn uniform_indices(&mut self, program: ObjectKey, names: &[String]) -> Option<Vec<u32>> {
        let program = self.program_key_name(program)?;
        let names: Vec<std::ffi::CString> = names
            .iter()
            .map(|n| std::ffi::CString::new(n.as_str()).ok())
            .collect::<Option<_>>()?;
        let refs: Vec<&std::ffi::CStr> = names.iter().map(std::ffi::CString::as_c_str).collect();
        let current = current(&self.buffer, &mut self.errors)?;
        let mut out = vec![GL_INVALID_INDEX; refs.len()];
        current.uniform_indices(program, &refs, &mut out);
        Some(out)
    }

    /// `getActiveUniforms`: a sequence of numbers, or of booleans for
    /// `UNIFORM_IS_ROW_MAJOR`.
    pub fn active_uniforms(
        &mut self,
        program: ObjectKey,
        indices: &[u32],
        pname: u32,
    ) -> Option<Parameter> {
        let program = self.program_key_name(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let count = current
            .program_parameter(program, GL_ACTIVE_UNIFORMS)
            .unwrap_or(0);
        if indices.iter().any(|&i| i64::from(i) >= i64::from(count)) {
            self.errors.synthesize(GL_INVALID_VALUE);
            return None;
        }
        if !matches!(
            pname,
            GL_UNIFORM_TYPE
                | GL_UNIFORM_SIZE
                | GL_UNIFORM_BLOCK_INDEX
                | GL_UNIFORM_OFFSET
                | GL_UNIFORM_ARRAY_STRIDE
                | GL_UNIFORM_MATRIX_STRIDE
                | GL_UNIFORM_IS_ROW_MAJOR
        ) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        let mut out = vec![0; indices.len()];
        current.active_uniforms(program, indices, pname, &mut out);
        Some(if pname == GL_UNIFORM_IS_ROW_MAJOR {
            Parameter::Booleans(out.iter().map(|&v| v != 0).collect())
        } else if pname == GL_UNIFORM_TYPE {
            Parameter::Numbers(out.iter().map(|&v| f64::from(v.cast_unsigned())).collect())
        } else {
            Parameter::Numbers(out.iter().map(|&v| f64::from(v)).collect())
        })
    }

    /// `getActiveUniformBlockParameter`.
    pub fn active_uniform_block_parameter(
        &mut self,
        program: ObjectKey,
        index: u32,
        pname: u32,
    ) -> Option<Parameter> {
        let program = self.program_key_name(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        if !linked(&current, program) {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return None;
        }
        let mut one = [0];
        match pname {
            GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES => {
                current.active_uniform_block(
                    program,
                    index,
                    GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS,
                    &mut one,
                );
                let mut out = vec![0; usize::try_from(one[0]).unwrap_or(0)];
                let written = current.active_uniform_block(program, index, pname, &mut out);
                (written == out.len())
                    .then(|| Parameter::Uint32(out.iter().map(|&v| v.cast_unsigned()).collect()))
            }
            GL_UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER
            | GL_UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER => {
                (current.active_uniform_block(program, index, pname, &mut one) > 0)
                    .then(|| Parameter::Boolean(one[0] != 0))
            }
            GL_UNIFORM_BLOCK_BINDING
            | GL_UNIFORM_BLOCK_DATA_SIZE
            | GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS => {
                (current.active_uniform_block(program, index, pname, &mut one) > 0)
                    .then(|| Parameter::Number(f64::from(one[0])))
            }
            _ => {
                self.errors.synthesize(GL_INVALID_ENUM);
                None
            }
        }
    }

    /// `getActiveUniformBlockName`.
    pub fn active_uniform_block_name(&mut self, program: ObjectKey, index: u32) -> Option<String> {
        let program = self.program_key_name(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        if !linked(&current, program) {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return None;
        }
        let count = current
            .program_parameter(program, GL_ACTIVE_UNIFORM_BLOCKS)
            .unwrap_or(0);
        if i64::from(index) >= i64::from(count) {
            self.errors.synthesize(GL_INVALID_VALUE);
            return None;
        }
        let max = current
            .program_parameter(program, GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH)
            .unwrap_or(0);
        Some(current.active_uniform_block_name(program, index, usize::try_from(max).unwrap_or(0)))
    }

    /// `uniformBlockBinding`.
    pub fn uniform_block_binding(&mut self, program: ObjectKey, index: u32, binding: u32) {
        let Some(program) = self.program_key_name(program) else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if linked(&current, program) {
                current.uniform_block_binding(program, index, binding);
            } else {
                self.errors.synthesize(GL_INVALID_OPERATION);
            }
        }
    }

    /// `bindTransformFeedback`; returns whether the binding changed.
    pub fn bind_transform_feedback(&mut self, target: u32, feedback: Option<ObjectKey>) -> bool {
        let Ok(name) = self.named(feedback, |o| match o {
            Object::TransformFeedback { name } => Some(*name),
            _ => None,
        }) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return false;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        current.bind_transform_feedback(target, name);
        crate::drawing_buffer::integers(&current, GL_TRANSFORM_FEEDBACK_BINDING)
            .is_some_and(|[n, _]| n.cast_unsigned() == name)
    }

    /// `beginTransformFeedback` (`Some(mode)`), `endTransformFeedback`
    /// (`None`), `pauseTransformFeedback` or `resumeTransformFeedback`.
    pub fn transform_feedback(&mut self, op: TransformFeedbackOp) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            match op {
                TransformFeedbackOp::Begin(mode) => current.begin_transform_feedback(mode),
                TransformFeedbackOp::End => current.end_transform_feedback(),
                TransformFeedbackOp::Pause => current.pause_transform_feedback(),
                TransformFeedbackOp::Resume => current.resume_transform_feedback(),
            }
        }
    }

    /// `transformFeedbackVaryings`.
    pub fn transform_feedback_varyings(&mut self, program: ObjectKey, names: &[String], mode: u32) {
        let Some(program) = self.program_key_name(program) else {
            return;
        };
        let Some(names) = names
            .iter()
            .map(|n| std::ffi::CString::new(n.as_str()).ok())
            .collect::<Option<Vec<_>>>()
        else {
            self.synthesize_error(GL_INVALID_VALUE);
            return;
        };
        let refs: Vec<&std::ffi::CStr> = names.iter().map(std::ffi::CString::as_c_str).collect();
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.transform_feedback_varyings(program, &refs, mode);
        }
    }

    /// `getTransformFeedbackVarying`; `INVALID_VALUE` for an index out of
    /// range.
    pub fn transform_feedback_varying(
        &mut self,
        program: ObjectKey,
        index: u32,
    ) -> Option<oxgl_sys::ActiveInfo> {
        let program = self.program_key_name(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let count = current
            .program_parameter(program, GL_TRANSFORM_FEEDBACK_VARYINGS)
            .unwrap_or(0);
        if i64::from(index) >= i64::from(count) {
            self.errors.synthesize(GL_INVALID_VALUE);
            return None;
        }
        let max = current
            .program_parameter(program, GL_TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH)
            .unwrap_or(0);
        Some(current.transform_feedback_varying(program, index, usize::try_from(max).unwrap_or(0)))
    }

    fn query_name(&self, key: ObjectKey) -> Option<u32> {
        match self.objects.get(key)? {
            Object::Query { name } => Some(*name),
            _ => None,
        }
    }

    /// `beginQuery`; returns whether the query is now active.
    pub fn begin_query(&mut self, target: u32, query: ObjectKey) -> bool {
        let Some(name) = self.query_name(query) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return false;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        current.begin_query(target, name);
        current
            .query_state(target, GL_CURRENT_QUERY)
            .is_some_and(|n| n.cast_unsigned() == name)
    }

    /// `endQuery`; returns whether a query of `target` was ended.
    pub fn end_query(&mut self, target: u32) -> bool {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        let active = current
            .query_state(target, GL_CURRENT_QUERY)
            .is_some_and(|n| n != 0);
        current.end_query(target);
        active
    }

    /// `getQueryParameter` for a query whose result the TS layer has
    /// released: `QUERY_RESULT` as a number (a `GLuint`, also for boolean
    /// targets) or `QUERY_RESULT_AVAILABLE` as a boolean.
    pub fn query_parameter(&mut self, query: ObjectKey, pname: u32) -> Option<Parameter> {
        let Some(name) = self.query_name(query) else {
            self.synthesize_error(GL_INVALID_OPERATION);
            return None;
        };
        let current = current(&self.buffer, &mut self.errors)?;
        let value = current.query_object(name, pname)?;
        Some(match pname {
            GL_QUERY_RESULT_AVAILABLE => Parameter::Boolean(value != 0),
            _ => Parameter::Number(f64::from(value)),
        })
    }

    /// `fenceSync`.
    pub fn fence_sync(&mut self, condition: u32, flags: u32) -> Option<ObjectKey> {
        let current = current(&self.buffer, &mut self.errors)?;
        let handle = current.fence_sync(condition, flags)?;
        Some(self.objects.insert(Object::Sync { handle }))
    }

    fn sync_handle(&self, key: ObjectKey) -> Option<oxgl_sys::SyncHandle> {
        match self.objects.get(key)? {
            Object::Sync { handle } => Some(*handle),
            _ => None,
        }
    }

    /// `clientWaitSync` with WebGL's limits: a non-zero timeout (above
    /// `MAX_CLIENT_WAIT_TIMEOUT_WEBGL`, which is 0) is `INVALID_VALUE`, and
    /// the GL is never asked to wait.
    pub fn client_wait_sync(&mut self, sync: ObjectKey, flags: u32, timeout: i64) -> u32 {
        let Some(handle) = self.sync_handle(sync) else {
            self.synthesize_error(GL_INVALID_VALUE);
            return GL_WAIT_FAILED;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return GL_WAIT_FAILED;
        };
        // MAX_CLIENT_WAIT_TIMEOUT_WEBGL is 0 (WebGL 2.0 §3.7.14).
        if timeout != 0 {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return GL_WAIT_FAILED;
        }
        current.client_wait_sync(handle, flags, 0)
    }

    /// `waitSync`: `flags` 0 and `timeout` `TIMEOUT_IGNORED` only (WebGL
    /// 2.0 §3.7.14).
    pub fn wait_sync(&mut self, sync: ObjectKey, flags: u32, timeout: i64) {
        let Some(handle) = self.sync_handle(sync) else {
            self.synthesize_error(GL_INVALID_VALUE);
            return;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if timeout != TIMEOUT_IGNORED || flags != 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        current.wait_sync(handle, 0, u64::MAX);
    }

    /// `getSyncParameter`.
    pub fn sync_parameter(&mut self, sync: ObjectKey, pname: u32) -> Option<f64> {
        let Some(handle) = self.sync_handle(sync) else {
            self.synthesize_error(GL_INVALID_VALUE);
            return None;
        };
        let current = current(&self.buffer, &mut self.errors)?;
        if !matches!(
            pname,
            GL_OBJECT_TYPE | GL_SYNC_STATUS | GL_SYNC_CONDITION | GL_SYNC_FLAGS
        ) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        current
            .sync_parameter(handle, pname)
            .map(|v| f64::from(v.cast_unsigned()))
    }
}

/// A transform feedback state change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransformFeedbackOp {
    /// `beginTransformFeedback(mode)`.
    Begin(u32),
    /// `endTransformFeedback`.
    End,
    /// `pauseTransformFeedback`.
    Pause,
    /// `resumeTransformFeedback`.
    Resume,
}

/// Whether the program's last link succeeded: uniform block and location
/// queries need a linked program (WebGL 2.0 §3.7.16; ANGLE reports an
/// out-of-range index or -1 instead).
pub(crate) fn linked(current: &oxgl_sys::Current<'_>, program: u32) -> bool {
    current
        .program_parameter(program, GL_LINK_STATUS)
        .is_some_and(|status| status != 0)
}
