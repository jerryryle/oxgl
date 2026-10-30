//! Buffers, shaders, programs, uniforms, vertex attributes and draw calls
//! (WebGL 1.0 §5.14.5, §5.14.9–§5.14.11; WebGL 2.0 §3.7.3, §3.7.8). oxgl
//! checks what ANGLE cannot see (object handles, typed-array ranges, WebGL's
//! buffer target rule and name rules) and forwards the rest.

#[allow(
    clippy::wildcard_imports,
    reason = "this module names many GL_ constants"
)]
use oxgl_sys::bindings::*;
use oxgl_sys::{
    AttribQuery, ByteSource, PixelDestination, Quad, UniformData, UniformMatrix, UniformOut,
    UniformVector, ViewKind,
};

use crate::context::{Context, Object, ObjectKey, check_reset, current};
use crate::parameters::Parameter;

/// Which class of target a buffer was first bound to (WebGL 1.0 §6.1,
/// WebGL 2.0 §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferKind {
    /// Never bound.
    Unbound,
    /// `ELEMENT_ARRAY_BUFFER`.
    Element,
    /// Any other target.
    Other,
}

/// Which object a `create*` call makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectType {
    /// `createBuffer`.
    Buffer,
    /// `createShader`, with its type.
    Shader(u32),
    /// `createProgram`.
    Program,
}

/// A `getShaderParameter`/`getProgramParameter`/`getVertexAttrib` scalar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scalar {
    /// `GLboolean`.
    Bool(bool),
    /// `GLint` or `GLenum`.
    Int(i32),
}

/// The JS type of a `getVertexAttrib(CURRENT_VERTEX_ATTRIB)` result, which
/// follows the last setter used (WebGL 2.0 §3.7.8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttribKind {
    /// `Float32Array`.
    Float,
    /// `Int32Array`.
    Int,
    /// `Uint32Array`.
    Uint,
}

/// A WebGL 2 `srcOffset`/`length` pair in elements, or the whole view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SubRange {
    /// First element.
    pub offset: u64,
    /// Number of elements; 0 means "to the end".
    pub length: u64,
}

/// The byte range of `range` within a view of `byte_len` bytes and
/// `element` bytes per element, or `None` (`INVALID_VALUE`) when it does not
/// fit (WebGL 2.0 §3.7.3 `bufferData`).
#[must_use]
pub fn byte_range(
    byte_len: usize,
    element: usize,
    range: SubRange,
) -> Option<std::ops::Range<usize>> {
    let element = u64::try_from(element.max(1)).ok()?;
    let len = u64::try_from(byte_len).ok()? / element;
    if range.offset > len {
        return None;
    }
    let count = if range.length == 0 {
        len - range.offset
    } else {
        range.length
    };
    let end = range.offset.checked_add(count)?;
    if end > len {
        return None;
    }
    let start = usize::try_from(range.offset.checked_mul(element)?).ok()?;
    let end = usize::try_from(end.checked_mul(element)?).ok()?;
    Some(start..end)
}

/// The WebGL buffer targets of a context version.
fn is_buffer_target(target: u32, webgl2: bool) -> bool {
    match target {
        GL_ARRAY_BUFFER | GL_ELEMENT_ARRAY_BUFFER => true,
        GL_COPY_READ_BUFFER
        | GL_COPY_WRITE_BUFFER
        | GL_PIXEL_PACK_BUFFER
        | GL_PIXEL_UNPACK_BUFFER
        | GL_TRANSFORM_FEEDBACK_BUFFER
        | GL_UNIFORM_BUFFER => webgl2,
        _ => false,
    }
}

/// Whether a buffer of `kind` may be bound to `target`, as Chromium applies
/// WebGL 1.0 §6.1 and WebGL 2.0 §5.1: element buffers only to element and
/// copy targets, other buffers never to the element target.
#[must_use]
pub fn target_allowed(kind: BufferKind, target: u32) -> bool {
    match kind {
        BufferKind::Unbound => true,
        BufferKind::Element => matches!(
            target,
            GL_ELEMENT_ARRAY_BUFFER | GL_COPY_READ_BUFFER | GL_COPY_WRITE_BUFFER
        ),
        BufferKind::Other => target != GL_ELEMENT_ARRAY_BUFFER,
    }
}

/// Why a name is unusable with the GL (WebGL 1.0 §6.20, §6.22; WebGL 2.0
/// §5.18), or `None` when it is fine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameError {
    /// Too long, or not in the GLSL ES character set: `INVALID_VALUE`.
    Invalid,
    /// Starts with a reserved `webgl_` or `_webgl_` prefix.
    Reserved,
}

/// Checks a name passed to a location function.
#[must_use]
pub fn check_name(name: &str, webgl2: bool) -> Option<NameError> {
    let limit = if webgl2 { 1024 } else { 256 };
    let valid_char =
        |c: char| c.is_ascii_graphic() || matches!(c, ' ' | '\t' | '\n' | '\x0b' | '\x0c' | '\r');
    if name.len() > limit
        || !name
            .chars()
            .all(|c| valid_char(c) && !matches!(c, '"' | '$' | '\'' | '@' | '\\' | '`'))
    {
        return Some(NameError::Invalid);
    }
    (name.starts_with("webgl_") || name.starts_with("_webgl_")).then_some(NameError::Reserved)
}

/// The `getUniform` reading of a GLSL type: the query, the number of values
/// and how they become a JS value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UniformRead {
    Float(usize),
    Int(usize),
    Bool(usize),
    Uint(usize),
}

#[allow(non_upper_case_globals, reason = "GL names such as GL_FLOAT_MAT2x3")]
fn uniform_read(ty: u32) -> Option<UniformRead> {
    use UniformRead::{Bool, Float, Int, Uint};
    Some(match ty {
        GL_FLOAT => Float(1),
        GL_FLOAT_VEC2 => Float(2),
        GL_FLOAT_VEC3 => Float(3),
        GL_FLOAT_VEC4 | GL_FLOAT_MAT2 => Float(4),
        GL_FLOAT_MAT3 => Float(9),
        GL_FLOAT_MAT4 => Float(16),
        GL_FLOAT_MAT2x3 | GL_FLOAT_MAT3x2 => Float(6),
        GL_FLOAT_MAT2x4 | GL_FLOAT_MAT4x2 => Float(8),
        GL_FLOAT_MAT3x4 | GL_FLOAT_MAT4x3 => Float(12),
        GL_INT
        | GL_SAMPLER_2D
        | GL_SAMPLER_CUBE
        | GL_SAMPLER_3D
        | GL_SAMPLER_2D_SHADOW
        | GL_SAMPLER_2D_ARRAY
        | GL_SAMPLER_2D_ARRAY_SHADOW
        | GL_SAMPLER_CUBE_SHADOW
        | GL_INT_SAMPLER_2D
        | GL_INT_SAMPLER_3D
        | GL_INT_SAMPLER_CUBE
        | GL_INT_SAMPLER_2D_ARRAY
        | GL_UNSIGNED_INT_SAMPLER_2D
        | GL_UNSIGNED_INT_SAMPLER_3D
        | GL_UNSIGNED_INT_SAMPLER_CUBE
        | GL_UNSIGNED_INT_SAMPLER_2D_ARRAY
        | GL_SAMPLER_EXTERNAL_OES => Int(1),
        GL_INT_VEC2 => Int(2),
        GL_INT_VEC3 => Int(3),
        GL_INT_VEC4 => Int(4),
        GL_BOOL => Bool(1),
        GL_BOOL_VEC2 => Bool(2),
        GL_BOOL_VEC3 => Bool(3),
        GL_BOOL_VEC4 => Bool(4),
        GL_UNSIGNED_INT => Uint(1),
        GL_UNSIGNED_INT_VEC2 => Uint(2),
        GL_UNSIGNED_INT_VEC3 => Uint(3),
        GL_UNSIGNED_INT_VEC4 => Uint(4),
        _ => return None,
    })
}

/// Reads `bytes` as native-endian 4-byte values.
fn words<T>(bytes: &[u8], from: fn([u8; 4]) -> T) -> Vec<T> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&chunk| from(chunk))
        .collect()
}

impl Context {
    /// The GL name of an object of the expected variant, or `None`.
    fn name(&self, key: ObjectKey, matches: fn(&Object) -> Option<u32>) -> Option<u32> {
        self.objects.get(key).and_then(matches)
    }

    fn program_name(&self, key: ObjectKey) -> Option<u32> {
        self.name(key, |o| match o {
            Object::Program { name } => Some(*name),
            _ => None,
        })
    }

    fn shader_name(&self, key: ObjectKey) -> Option<u32> {
        self.name(key, |o| match o {
            Object::Shader { name } => Some(*name),
            _ => None,
        })
    }

    /// The program's GL name; `INVALID_VALUE` when the key is stale (a
    /// deleted object, which TS normally catches first).
    fn program_or_error(&mut self, key: ObjectKey) -> Option<u32> {
        let name = self.program_name(key);
        if name.is_none() {
            self.errors.synthesize(GL_INVALID_VALUE);
        }
        name
    }

    fn shader_or_error(&mut self, key: ObjectKey) -> Option<u32> {
        let name = self.shader_name(key);
        if name.is_none() {
            self.errors.synthesize(GL_INVALID_VALUE);
        }
        name
    }

    /// Synthesizes `code` (oxgl's own validation, or the TS layer's
    /// ownership and deletion checks).
    pub fn synthesize_error(&mut self, code: u32) {
        if !self.errors.is_lost() {
            self.errors.synthesize(code);
        }
    }

    /// `createBuffer`, `createShader` or `createProgram`; `None` when lost or
    /// when the GL refused (an invalid shader type generates `INVALID_ENUM`).
    pub fn create_object(&mut self, ty: ObjectType) -> Option<ObjectKey> {
        let current = current(&self.buffer, &mut self.errors)?;
        let object = match ty {
            ObjectType::Buffer => Object::Buffer {
                name: current.gen_buffer(),
                kind: BufferKind::Unbound,
            },
            ObjectType::Shader(kind) => {
                if !matches!(kind, GL_VERTEX_SHADER | GL_FRAGMENT_SHADER) {
                    self.errors.synthesize(GL_INVALID_ENUM);
                    return None;
                }
                Object::Shader {
                    name: current.create_shader(kind),
                }
            }
            ObjectType::Program => Object::Program {
                name: current.create_program(),
            },
        };
        let (Object::Buffer { name, .. } | Object::Shader { name } | Object::Program { name }) =
            object;
        (name != 0).then(|| self.objects.insert(object))
    }

    /// Deletes an object now (`delete*`, or a collected object). A stale key
    /// does nothing. On a lost context only the handle is dropped.
    pub fn delete_object(&mut self, key: ObjectKey) {
        let Some(object) = self.objects.remove(key) else {
            return;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        match object {
            Object::Buffer { name, .. } => current.delete_buffer(name),
            Object::Shader { name } => current.delete_shader(name),
            Object::Program { name } => current.delete_program(name),
        }
    }

    /// Whether the key names a live object (`is*` after the TS type check).
    #[must_use]
    pub fn has_object(&self, key: ObjectKey) -> bool {
        // A buffer becomes a buffer object when first bound (OpenGL ES 2.0
        // §2.9), so `isBuffer` is false before that.
        !self.errors.is_lost()
            && self.objects.get(key).is_some_and(|o| {
                !matches!(
                    o,
                    Object::Buffer {
                        kind: BufferKind::Unbound,
                        ..
                    }
                )
            })
    }

    /// `bindBuffer` (WebGL 1.0 §5.14.5). Returns whether the binding changed
    /// to `buffer`.
    pub fn bind_buffer(&mut self, target: u32, buffer: Option<ObjectKey>) -> bool {
        if current(&self.buffer, &mut self.errors).is_none() {
            return false;
        }
        if !is_buffer_target(target, self.webgl2) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return false;
        }
        let name = match buffer {
            None => 0,
            Some(key) => {
                let Some(Object::Buffer { name, kind }) = self.objects.get_mut(key) else {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return false;
                };
                if !target_allowed(*kind, target) {
                    self.errors.synthesize(GL_INVALID_OPERATION);
                    return false;
                }
                if *kind == BufferKind::Unbound {
                    *kind = if target == GL_ELEMENT_ARRAY_BUFFER {
                        BufferKind::Element
                    } else {
                        BufferKind::Other
                    };
                }
                *name
            }
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.bind_buffer(target, name);
        }
        true
    }

    /// `bufferData(target, size, usage)`: zero-filled storage.
    pub fn buffer_data_size(&mut self, target: u32, size: i64, usage: u32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if size < 0 {
                self.errors.synthesize(GL_INVALID_VALUE);
                return;
            }
            current.buffer_data_size(target, size, usage);
        }
    }

    /// `bufferData` from a buffer or view, with WebGL 2's element range.
    pub fn buffer_data(
        &mut self,
        target: u32,
        source: &dyn ByteSource,
        usage: u32,
        range: SubRange,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let Some(bytes) = byte_range(source.byte_len(), source.kind().element_size(), range) else {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        };
        source.with_bytes(bytes, &mut |data| current.buffer_data(target, data, usage));
    }

    /// `bufferSubData`, with WebGL 2's element range.
    pub fn buffer_sub_data(
        &mut self,
        target: u32,
        offset: i64,
        source: &dyn ByteSource,
        range: SubRange,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let bytes = byte_range(source.byte_len(), source.kind().element_size(), range);
        let Some(bytes) = bytes.filter(|_| offset >= 0) else {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        };
        if offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        source.with_bytes(bytes, &mut |data| {
            current.buffer_sub_data(target, offset, data);
        });
    }

    /// `copyBufferSubData` (WebGL 2.0 §3.7.3).
    pub fn copy_buffer_sub_data(
        &mut self,
        read_target: u32,
        write_target: u32,
        read_offset: i64,
        write_offset: i64,
        size: i64,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        current.copy_buffer_sub_data(read_target, write_target, read_offset, write_offset, size);
    }

    /// `getBufferSubData` (WebGL 2.0 §3.7.3): reads `length` elements (0: to
    /// the end) into `destination` from element `offset`.
    pub fn get_buffer_sub_data(
        &mut self,
        target: u32,
        source_offset: i64,
        destination: &dyn PixelDestination,
        range: SubRange,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let element = match destination.kind() {
            ViewKind::DataView => 1,
            kind => kind.element_size(),
        };
        let Some(bytes) = byte_range(destination.byte_len(), element, range) else {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        };
        if !is_buffer_target(target, true) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return;
        }
        if source_offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        let mut staging = vec![0u8; bytes.len()];
        if current.get_buffer_sub_data(target, source_offset, &mut staging) {
            destination.copy_from_at(bytes.start, &staging);
        }
    }

    /// `getBufferParameter` (WebGL 1.0 §5.14.5): `BUFFER_SIZE` or
    /// `BUFFER_USAGE`; `None` (JS `null`) for anything else or an error.
    pub fn buffer_parameter(&mut self, target: u32, pname: u32) -> Option<i32> {
        let current = current(&self.buffer, &mut self.errors)?;
        if !matches!(pname, GL_BUFFER_SIZE | GL_BUFFER_USAGE) {
            self.errors.synthesize(GL_INVALID_ENUM);
            return None;
        }
        current.buffer_parameter(target, pname)
    }

    /// `shaderSource`.
    pub fn shader_source(&mut self, shader: ObjectKey, source: &str) {
        let Some(name) = self.shader_or_error(shader) else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.shader_source(name, source);
        }
    }

    /// `compileShader`.
    pub fn compile_shader(&mut self, shader: ObjectKey) {
        let Some(name) = self.shader_or_error(shader) else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.compile_shader(name);
        }
    }

    /// `getShaderParameter` (WebGL 1.0 §5.14.9).
    pub fn shader_parameter(&mut self, shader: ObjectKey, pname: u32) -> Option<Scalar> {
        let name = self.shader_or_error(shader)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let value = match pname {
            GL_SHADER_TYPE => current.shader_parameter(name, pname).map(Scalar::Int),
            GL_DELETE_STATUS | GL_COMPILE_STATUS => current
                .shader_parameter(name, pname)
                .map(|v| Scalar::Bool(v != 0)),
            _ => {
                self.errors.synthesize(GL_INVALID_ENUM);
                None
            }
        };
        check_reset(&current, &mut self.errors);
        value
    }

    /// `getShaderInfoLog`.
    pub fn shader_info_log(&mut self, shader: ObjectKey) -> Option<String> {
        let name = self.shader_or_error(shader)?;
        current(&self.buffer, &mut self.errors)?.shader_info_log(name)
    }

    /// `attachShader` or `detachShader`; TS has checked the attachment rules.
    pub fn attach_shader(&mut self, program: ObjectKey, shader: ObjectKey, attach: bool) {
        let (Some(program), Some(shader)) =
            (self.program_or_error(program), self.shader_or_error(shader))
        else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if attach {
                current.attach_shader(program, shader);
            } else {
                current.detach_shader(program, shader);
            }
        }
    }

    /// `linkProgram`.
    pub fn link_program(&mut self, program: ObjectKey) {
        let Some(name) = self.program_or_error(program) else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.link_program(name);
        }
    }

    /// `validateProgram`.
    pub fn validate_program(&mut self, program: ObjectKey) {
        let Some(name) = self.program_or_error(program) else {
            return;
        };
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.validate_program(name);
        }
    }

    /// `useProgram`; returns whether the program is now current.
    pub fn use_program(&mut self, program: Option<ObjectKey>) -> bool {
        let name = match program {
            None => 0,
            Some(key) => match self.program_or_error(key) {
                Some(name) => name,
                None => return false,
            },
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        current.use_program(name);
        crate::drawing_buffer::integers(&current, GL_CURRENT_PROGRAM)
            .is_some_and(|[now, _]| now.cast_unsigned() == name)
    }

    /// `getProgramParameter` (WebGL 1.0 §5.14.9, WebGL 2.0 §3.7.7).
    pub fn program_parameter(&mut self, program: ObjectKey, pname: u32) -> Option<Scalar> {
        let name = self.program_or_error(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let webgl2 = self.webgl2;
        match pname {
            GL_DELETE_STATUS | GL_LINK_STATUS | GL_VALIDATE_STATUS => current
                .program_parameter(name, pname)
                .map(|v| Scalar::Bool(v != 0)),
            GL_ATTACHED_SHADERS | GL_ACTIVE_ATTRIBUTES | GL_ACTIVE_UNIFORMS => {
                current.program_parameter(name, pname).map(Scalar::Int)
            }
            GL_TRANSFORM_FEEDBACK_BUFFER_MODE
            | GL_TRANSFORM_FEEDBACK_VARYINGS
            | GL_ACTIVE_UNIFORM_BLOCKS
                if webgl2 =>
            {
                current.program_parameter(name, pname).map(Scalar::Int)
            }
            _ => {
                self.errors.synthesize(GL_INVALID_ENUM);
                None
            }
        }
    }

    /// `getProgramInfoLog`.
    pub fn program_info_log(&mut self, program: ObjectKey) -> Option<String> {
        let name = self.program_or_error(program)?;
        current(&self.buffer, &mut self.errors)?.program_info_log(name)
    }

    /// Checks a name for a location call and converts it to a C string;
    /// `Err(true)` for a reserved prefix, which some calls treat as "not
    /// found" rather than an error.
    fn location_name(&mut self, name: &str) -> Result<std::ffi::CString, bool> {
        match check_name(name, self.webgl2) {
            Some(NameError::Invalid) => {
                self.errors.synthesize(GL_INVALID_VALUE);
                Err(false)
            }
            Some(NameError::Reserved) => Err(true),
            None => std::ffi::CString::new(name).map_err(|_| {
                self.errors.synthesize(GL_INVALID_VALUE);
                false
            }),
        }
    }

    /// `bindAttribLocation`; a reserved name generates `INVALID_OPERATION`.
    pub fn bind_attrib_location(&mut self, program: ObjectKey, index: u32, name: &str) {
        let Some(program) = self.program_or_error(program) else {
            return;
        };
        match self.location_name(name) {
            Ok(name) => {
                if let Some(current) = current(&self.buffer, &mut self.errors) {
                    current.bind_attrib_location(program, index, &name);
                }
            }
            Err(true) => self.errors.synthesize(GL_INVALID_OPERATION),
            Err(false) => {}
        }
    }

    /// `getAttribLocation`, `getUniformLocation` (`None` for -1) or WebGL 2's
    /// `getFragDataLocation`.
    pub fn location(&mut self, program: ObjectKey, name: &str, kind: LocationKind) -> i32 {
        let Some(program) = self.program_or_error(program) else {
            return -1;
        };
        let Ok(name) = self.location_name(name) else {
            return -1;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return -1;
        };
        match kind {
            LocationKind::Attrib => current.attrib_location(program, &name),
            LocationKind::Uniform => current.uniform_location(program, &name),
            LocationKind::FragData => current.frag_data_location(program, &name),
        }
    }

    /// `getActiveAttrib` (`uniform` false) or `getActiveUniform`; `None` with
    /// `INVALID_VALUE` for an index out of range.
    pub fn active_info(
        &mut self,
        program: ObjectKey,
        index: u32,
        uniform: bool,
    ) -> Option<oxgl_sys::ActiveInfo> {
        let name = self.program_or_error(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let (count, max_length) = if uniform {
            (GL_ACTIVE_UNIFORMS, GL_ACTIVE_UNIFORM_MAX_LENGTH)
        } else {
            (GL_ACTIVE_ATTRIBUTES, GL_ACTIVE_ATTRIBUTE_MAX_LENGTH)
        };
        let count = current.program_parameter(name, count).unwrap_or(0);
        if i64::from(index) >= i64::from(count) {
            self.errors.synthesize(GL_INVALID_VALUE);
            return None;
        }
        let max_length = current.program_parameter(name, max_length).unwrap_or(0);
        Some(current.active_variable(
            name,
            index,
            usize::try_from(max_length).unwrap_or(0),
            uniform,
        ))
    }

    /// `uniform[1234][f|i|ui]` with values.
    #[allow(clippy::many_single_char_names, reason = "vector components")]
    pub fn uniform_values(&mut self, location: i32, shape: UniformVector, values: [u32; 4]) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let [a, b, c, d] = values;
        let f = f32::from_bits;
        let i = u32::cast_signed;
        match shape {
            UniformVector::Float(1) => current.uniform_1f(location, f(a)),
            UniformVector::Float(2) => current.uniform_2f(location, f(a), f(b)),
            UniformVector::Float(3) => current.uniform_3f(location, f(a), f(b), f(c)),
            UniformVector::Float(_) => current.uniform_4f(location, f(a), f(b), f(c), f(d)),
            UniformVector::Int(1) => current.uniform_1i(location, i(a)),
            UniformVector::Int(2) => current.uniform_2i(location, i(a), i(b)),
            UniformVector::Int(3) => current.uniform_3i(location, i(a), i(b), i(c)),
            UniformVector::Int(_) => current.uniform_4i(location, i(a), i(b), i(c), i(d)),
            UniformVector::Uint(1) => current.uniform_1ui(location, a),
            UniformVector::Uint(2) => current.uniform_2ui(location, a, b),
            UniformVector::Uint(3) => current.uniform_3ui(location, a, b, c),
            UniformVector::Uint(_) => current.uniform_4ui(location, a, b, c, d),
        }
    }

    /// The elements of `source` in `range`, checked against `components`:
    /// `INVALID_VALUE` when empty or not a multiple (WebGL 1.0 §5.14.10).
    fn uniform_bytes(
        &mut self,
        source: &dyn ByteSource,
        range: SubRange,
        components: usize,
    ) -> Option<std::ops::Range<usize>> {
        let bytes = byte_range(source.byte_len(), 4, range);
        let valid = bytes
            .as_ref()
            .is_some_and(|b| !b.is_empty() && (b.len() / 4) % components == 0);
        if !valid {
            self.errors.synthesize(GL_INVALID_VALUE);
            return None;
        }
        bytes
    }

    /// `uniform[1234][f|i|ui]v` from a 4-byte typed array.
    pub fn uniform_vector(
        &mut self,
        location: i32,
        shape: UniformVector,
        source: &dyn ByteSource,
        range: SubRange,
    ) {
        if current(&self.buffer, &mut self.errors).is_none() {
            return;
        }
        let (UniformVector::Float(n) | UniformVector::Int(n) | UniformVector::Uint(n)) = shape;
        let Some(bytes) = self.uniform_bytes(source, range, usize::from(n)) else {
            return;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        source.with_bytes(bytes, &mut |data| match shape {
            UniformVector::Float(_) => {
                let values = words(data, f32::from_ne_bytes);
                current.uniform_vector(location, shape, UniformData::Float(&values));
            }
            UniformVector::Int(_) => {
                let values = words(data, i32::from_ne_bytes);
                current.uniform_vector(location, shape, UniformData::Int(&values));
            }
            UniformVector::Uint(_) => {
                let values = words(data, u32::from_ne_bytes);
                current.uniform_vector(location, shape, UniformData::Uint(&values));
            }
        });
    }

    /// `uniformMatrix*fv` from a `Float32Array`.
    pub fn uniform_matrix(
        &mut self,
        location: i32,
        shape: UniformMatrix,
        transpose: bool,
        source: &dyn ByteSource,
        range: SubRange,
    ) {
        if current(&self.buffer, &mut self.errors).is_none() {
            return;
        }
        let Some(bytes) = self.uniform_bytes(source, range, shape.components()) else {
            return;
        };
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        source.with_bytes(bytes, &mut |data| {
            current.uniform_matrix(location, shape, transpose, &words(data, f32::from_ne_bytes));
        });
    }

    /// `getUniform` (WebGL 1.0 §5.14.10): finds the uniform's type by its
    /// location, then reads it with the matching robust getter.
    pub fn get_uniform(&mut self, program: ObjectKey, location: i32) -> Option<Parameter> {
        let name = self.program_or_error(program)?;
        let current = current(&self.buffer, &mut self.errors)?;
        let count = current
            .program_parameter(name, GL_ACTIVE_UNIFORMS)
            .unwrap_or(0);
        let max_length = current
            .program_parameter(name, GL_ACTIVE_UNIFORM_MAX_LENGTH)
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(0);
        let ty = (0..count.cast_unsigned()).find_map(|index| {
            let info = current.active_variable(name, index, max_length, true);
            let base = info.name.strip_suffix("[0]").unwrap_or(&info.name);
            let matches = |candidate: String| {
                std::ffi::CString::new(candidate)
                    .is_ok_and(|c| current.uniform_location(name, &c) == location)
            };
            let found = if info.name.ends_with("[0]") {
                (0..info.size).any(|element| matches(format!("{base}[{element}]")))
            } else {
                matches(info.name.clone())
            };
            found.then_some(info.ty)
        });
        let Some(read) = ty.and_then(uniform_read) else {
            self.errors.synthesize(GL_INVALID_OPERATION);
            return None;
        };
        Some(match read {
            UniformRead::Float(n) => {
                let mut values = [0f32; 16];
                let len = current.get_uniform(name, location, UniformOut::Float(&mut values));
                let values = values.get(..len.min(n))?.to_vec();
                if n == 1 {
                    Parameter::Number(f64::from(*values.first()?))
                } else {
                    Parameter::Float32(values)
                }
            }
            UniformRead::Int(n) => {
                let mut values = [0i32; 4];
                let len = current.get_uniform(name, location, UniformOut::Int(&mut values));
                let values = values.get(..len.min(n))?.to_vec();
                if n == 1 {
                    Parameter::Number(f64::from(*values.first()?))
                } else {
                    Parameter::Int32(values)
                }
            }
            UniformRead::Bool(n) => {
                let mut values = [0i32; 4];
                let len = current.get_uniform(name, location, UniformOut::Int(&mut values));
                let values: Vec<bool> = values.get(..len.min(n))?.iter().map(|&v| v != 0).collect();
                if n == 1 {
                    Parameter::Boolean(*values.first()?)
                } else {
                    Parameter::Booleans(values)
                }
            }
            UniformRead::Uint(n) => {
                let mut values = [0u32; 4];
                let len = current.get_uniform(name, location, UniformOut::Uint(&mut values));
                let values = values.get(..len.min(n))?.to_vec();
                if n == 1 {
                    Parameter::Number(f64::from(*values.first()?))
                } else {
                    Parameter::Uint32(values)
                }
            }
        })
    }

    /// `enableVertexAttribArray` / `disableVertexAttribArray`.
    pub fn vertex_attrib_array(&mut self, index: u32, enable: bool) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            if enable {
                current.enable_vertex_attrib_array(index);
            } else {
                current.disable_vertex_attrib_array(index);
            }
        }
    }

    /// `vertexAttribPointer` or WebGL 2's `vertexAttribIPointer`
    /// (`normalized` `None`). Returns whether the attribute's buffer binding
    /// now equals the `ARRAY_BUFFER` binding, so the TS layer can mirror it.
    #[allow(clippy::too_many_arguments, reason = "mirrors the WebGL signature")]
    pub fn vertex_attrib_pointer(
        &mut self,
        index: u32,
        size: i32,
        ty: u32,
        normalized: Option<bool>,
        stride: i32,
        offset: i64,
    ) -> bool {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return false;
        };
        if offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return false;
        }
        match normalized {
            Some(normalized) => {
                current.vertex_attrib_pointer(index, size, ty, normalized, stride, offset);
            }
            None => current.vertex_attrib_i_pointer(index, size, ty, stride, offset),
        }
        let array = crate::drawing_buffer::integers(&current, GL_ARRAY_BUFFER_BINDING);
        let attrib = current.vertex_attrib(
            index,
            GL_VERTEX_ATTRIB_ARRAY_BUFFER_BINDING,
            AttribQuery::Int,
        );
        attrib.len > 0 && array.is_some_and(|[name, _]| name.cast_unsigned() == attrib.bits[0])
    }

    /// `vertexAttrib*` setters, as four values of `kind`.
    pub fn vertex_attrib(&mut self, index: u32, kind: AttribKind, values: [u32; 4]) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        let [a, b, c, d] = values;
        match kind {
            AttribKind::Float => current.vertex_attrib_4f(
                index,
                f32::from_bits(a),
                f32::from_bits(b),
                f32::from_bits(c),
                f32::from_bits(d),
            ),
            AttribKind::Int => current.vertex_attrib_i4i(
                index,
                a.cast_signed(),
                b.cast_signed(),
                c.cast_signed(),
                d.cast_signed(),
            ),
            AttribKind::Uint => current.vertex_attrib_i4ui(index, a, b, c, d),
        }
    }

    /// `getVertexAttrib` for a non-object `pname` (WebGL 1.0 §5.14.10).
    /// `current_kind` is the type of the last setter for
    /// `CURRENT_VERTEX_ATTRIB`.
    pub fn get_vertex_attrib(
        &mut self,
        index: u32,
        pname: u32,
        current_kind: AttribKind,
    ) -> Option<Parameter> {
        let current = current(&self.buffer, &mut self.errors)?;
        let webgl2 = self.webgl2;
        let read = |query| -> Option<Quad> {
            let quad = current.vertex_attrib(index, pname, query);
            (quad.len > 0).then_some(quad)
        };
        match pname {
            GL_CURRENT_VERTEX_ATTRIB => Some(match current_kind {
                AttribKind::Float => {
                    Parameter::Float32(read(AttribQuery::Float)?.bits.map(f32::from_bits).to_vec())
                }
                AttribKind::Int => Parameter::Int32(
                    read(AttribQuery::IntegerInt)?
                        .bits
                        .map(u32::cast_signed)
                        .to_vec(),
                ),
                AttribKind::Uint => {
                    Parameter::Uint32(read(AttribQuery::IntegerUint)?.bits.to_vec())
                }
            }),
            GL_VERTEX_ATTRIB_ARRAY_ENABLED | GL_VERTEX_ATTRIB_ARRAY_NORMALIZED => {
                Some(Parameter::Boolean(read(AttribQuery::Int)?.bits[0] != 0))
            }
            GL_VERTEX_ATTRIB_ARRAY_INTEGER if webgl2 => {
                Some(Parameter::Boolean(read(AttribQuery::Int)?.bits[0] != 0))
            }
            GL_VERTEX_ATTRIB_ARRAY_SIZE
            | GL_VERTEX_ATTRIB_ARRAY_STRIDE
            | GL_VERTEX_ATTRIB_ARRAY_TYPE => Some(Parameter::Number(f64::from(
                read(AttribQuery::Int)?.bits[0].cast_signed(),
            ))),
            GL_VERTEX_ATTRIB_ARRAY_DIVISOR if webgl2 => Some(Parameter::Number(f64::from(
                read(AttribQuery::Int)?.bits[0].cast_signed(),
            ))),
            _ => {
                self.errors.synthesize(GL_INVALID_ENUM);
                None
            }
        }
    }

    /// `getVertexAttribOffset`; 0 on error.
    pub fn vertex_attrib_offset(&mut self, index: u32, pname: u32) -> i64 {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return 0;
        };
        if pname != GL_VERTEX_ATTRIB_ARRAY_POINTER {
            self.errors.synthesize(GL_INVALID_ENUM);
            return 0;
        }
        current.vertex_attrib_offset(index, pname).unwrap_or(0)
    }

    /// `drawArrays`.
    pub fn draw_arrays(&mut self, mode: u32, first: i32, count: i32) {
        if let Some(current) = current(&self.buffer, &mut self.errors) {
            current.draw_arrays(mode, first, count);
        }
    }

    /// `drawElements`, or WebGL 2's `drawRangeElements` with `range`.
    pub fn draw_elements(
        &mut self,
        mode: u32,
        count: i32,
        ty: u32,
        offset: i64,
        range: Option<(u32, u32)>,
    ) {
        let Some(current) = current(&self.buffer, &mut self.errors) else {
            return;
        };
        if offset < 0 {
            self.errors.synthesize(GL_INVALID_VALUE);
            return;
        }
        match range {
            None => current.draw_elements(mode, count, ty, offset),
            Some((start, end)) => current.draw_range_elements(mode, start, end, count, ty, offset),
        }
    }
}

/// Which location a [`Context::location`] call asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocationKind {
    /// `getAttribLocation`.
    Attrib,
    /// `getUniformLocation`.
    Uniform,
    /// `getFragDataLocation`.
    FragData,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests")]

    use super::*;

    #[test]
    fn whole_view() {
        assert_eq!(byte_range(16, 4, SubRange::default()), Some(0..16));
        assert_eq!(byte_range(0, 4, SubRange::default()), Some(0..0));
    }

    #[test]
    fn element_offsets_and_lengths() {
        let range = SubRange {
            offset: 1,
            length: 2,
        };
        assert_eq!(byte_range(16, 4, range), Some(4..12));
        let to_end = SubRange {
            offset: 3,
            length: 0,
        };
        assert_eq!(byte_range(16, 4, to_end), Some(12..16));
        let at_end = SubRange {
            offset: 4,
            length: 0,
        };
        assert_eq!(byte_range(16, 4, at_end), Some(16..16));
    }

    #[test]
    fn ranges_beyond_the_view_are_rejected() {
        let past = SubRange {
            offset: 5,
            length: 0,
        };
        assert_eq!(byte_range(4, 1, past), None);
        let long = SubRange {
            offset: 2,
            length: 3,
        };
        assert_eq!(byte_range(16, 4, long), None);
        let overflow = SubRange {
            offset: u64::MAX,
            length: u64::MAX,
        };
        assert_eq!(byte_range(16, 1, overflow), None);
    }

    #[test]
    fn buffer_target_compatibility() {
        assert!(target_allowed(BufferKind::Unbound, GL_ELEMENT_ARRAY_BUFFER));
        assert!(!target_allowed(BufferKind::Element, GL_ARRAY_BUFFER));
        assert!(target_allowed(BufferKind::Element, GL_COPY_READ_BUFFER));
        assert!(!target_allowed(BufferKind::Other, GL_ELEMENT_ARRAY_BUFFER));
        assert!(target_allowed(BufferKind::Other, GL_UNIFORM_BUFFER));
    }

    #[test]
    fn name_rules() {
        assert_eq!(check_name("a_position", false), None);
        assert_eq!(check_name("webgl_x", false), Some(NameError::Reserved));
        assert_eq!(check_name("_webgl_x", true), Some(NameError::Reserved));
        assert_eq!(
            check_name(&"a".repeat(257), false),
            Some(NameError::Invalid)
        );
        assert_eq!(check_name(&"a".repeat(257), true), None);
        assert_eq!(check_name("a$b", false), Some(NameError::Invalid));
        assert_eq!(check_name("caf\u{e9}", false), Some(NameError::Invalid));
    }

    #[test]
    fn uniform_types() {
        assert_eq!(uniform_read(GL_FLOAT_MAT3), Some(UniformRead::Float(9)));
        assert_eq!(uniform_read(GL_BOOL_VEC2), Some(UniformRead::Bool(2)));
        assert_eq!(uniform_read(GL_SAMPLER_2D), Some(UniformRead::Int(1)));
        assert_eq!(uniform_read(0x1234), None);
    }

    #[test]
    fn words_are_native_endian() {
        let bytes = 1.5f32.to_ne_bytes();
        assert_eq!(words(&bytes, f32::from_ne_bytes), vec![1.5]);
        assert_eq!(words(&[1, 2, 3], u32::from_ne_bytes), Vec::<u32>::new());
    }
}
