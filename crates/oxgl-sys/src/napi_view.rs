//! Node-API typed-array destinations (feature `node`).
//!
//! A [`WriteTarget`] holds a JS view's data pointer only for the native call
//! it was created in (its lifetime is the call's value scope). It never forms
//! a Rust reference to the view's memory: the buffer may be a
//! `SharedArrayBuffer` written by other threads, so every access is a
//! relaxed-atomic copy, word-sized where aligned and byte-sized elsewhere, as
//! browsers do (Blink's `RelaxedAtomicWriteMemcpy`).

use std::marker::PhantomData;
use std::ptr;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};

use napi::bindgen_prelude::{JsValue, Unknown};
use napi::sys;

use crate::view::{PixelDestination, ViewKind};

/// A typed array or `DataView` destination, valid for the current call only.
#[derive(Debug)]
pub struct WriteTarget<'a> {
    data: *mut u8,
    len: usize,
    kind: ViewKind,
    scope: PhantomData<&'a ()>,
}

impl<'a> WriteTarget<'a> {
    /// Wraps `value` if it is an `ArrayBufferView`; `Ok(None)` otherwise.
    ///
    /// # Errors
    ///
    /// Returns the Node-API status if a query fails.
    pub fn new(value: &Unknown<'a>) -> napi::Result<Option<Self>> {
        let raw = value.value();
        let (env, value) = (raw.env, raw.value);
        let mut is_typedarray = false;
        // SAFETY: `env` and `value` come from a live `Unknown`, which napi-rs
        // only creates for the current call's env and handle scope; the
        // out-pointer is valid.
        check(unsafe { sys::napi_is_typedarray(env, value, &raw mut is_typedarray) })?;
        if is_typedarray {
            let mut ty: sys::napi_typedarray_type = 0;
            let mut length = 0usize;
            let mut data: *mut std::ffi::c_void = ptr::null_mut();
            // SAFETY: as above; `value` is a typed array and every out-pointer
            // is valid (the buffer and offset outputs are optional).
            check(unsafe {
                sys::napi_get_typedarray_info(
                    env,
                    value,
                    &raw mut ty,
                    &raw mut length,
                    &raw mut data,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            })?;
            let (kind, size) = typed_array_kind(ty);
            return Ok(Some(Self::from_parts(
                data.cast(),
                length.saturating_mul(size),
                kind,
            )));
        }
        let mut is_dataview = false;
        // SAFETY: as above.
        check(unsafe { sys::napi_is_dataview(env, value, &raw mut is_dataview) })?;
        if is_dataview {
            let mut length = 0usize;
            let mut data: *mut std::ffi::c_void = ptr::null_mut();
            // SAFETY: as above; `value` is a DataView.
            check(unsafe {
                sys::napi_get_dataview_info(
                    env,
                    value,
                    &raw mut length,
                    &raw mut data,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            })?;
            return Ok(Some(Self::from_parts(
                data.cast(),
                length,
                ViewKind::DataView,
            )));
        }
        Ok(None)
    }

    fn from_parts(data: *mut u8, len: usize, kind: ViewKind) -> Self {
        // A detached buffer reports a null pointer; treat it as empty.
        let len = if data.is_null() { 0 } else { len };
        Self {
            data,
            len,
            kind,
            scope: PhantomData,
        }
    }

    fn byte(&self, index: usize) -> Option<&AtomicU8> {
        if index >= self.len {
            return None;
        }
        let byte = self.data.wrapping_add(index);
        // SAFETY: `index < len`, and `data..data + len` is the view's memory,
        // which stays allocated for this call: no JS runs while the target
        // exists, so the buffer can be neither detached nor collected, and a
        // growable SharedArrayBuffer never moves. Bytes may be written by
        // other threads, so they are only accessed atomically.
        Some(unsafe { AtomicU8::from_ptr(byte) })
    }

    /// The word at `index`, if it lies inside the view and is aligned.
    fn word(&self, index: usize) -> Option<&AtomicUsize> {
        if index.checked_add(WORD)? > self.len {
            return None;
        }
        let byte = self.data.wrapping_add(index);
        if byte.align_offset(WORD) != 0 {
            return None;
        }
        #[allow(clippy::cast_ptr_alignment, reason = "alignment checked above")]
        let word = byte.cast::<usize>();
        // SAFETY: as for `byte`: `index + WORD <= len` keeps the word inside
        // the view's live memory for this call, and the pointer is aligned
        // (checked above). Accessed only atomically.
        Some(unsafe { AtomicUsize::from_ptr(word) })
    }
}

const WORD: usize = size_of::<usize>();

impl PixelDestination for WriteTarget<'_> {
    fn kind(&self) -> ViewKind {
        self.kind
    }

    fn byte_len(&self) -> usize {
        self.len
    }

    fn copy_to(&self, buffer: &mut [u8]) {
        let mut index = 0;
        while index < buffer.len() {
            if let (Some(word), Some(out)) = (self.word(index), buffer.get_mut(index..index + WORD))
            {
                out.copy_from_slice(&word.load(Ordering::Relaxed).to_ne_bytes());
                index += WORD;
            } else if let (Some(byte), Some(out)) = (self.byte(index), buffer.get_mut(index)) {
                *out = byte.load(Ordering::Relaxed);
                index += 1;
            } else {
                break;
            }
        }
    }

    fn copy_from(&self, buffer: &[u8]) {
        let mut index = 0;
        while index < buffer.len() {
            let chunk = buffer
                .get(index..index + WORD)
                .and_then(|bytes| <[u8; WORD]>::try_from(bytes).ok());
            if let (Some(word), Some(bytes)) = (self.word(index), chunk) {
                word.store(usize::from_ne_bytes(bytes), Ordering::Relaxed);
                index += WORD;
            } else if let (Some(byte), Some(&value)) = (self.byte(index), buffer.get(index)) {
                byte.store(value, Ordering::Relaxed);
                index += 1;
            } else {
                break;
            }
        }
    }
}

fn typed_array_kind(ty: sys::napi_typedarray_type) -> (ViewKind, usize) {
    match ty {
        sys::TypedarrayType::int8_array => (ViewKind::Int8, 1),
        sys::TypedarrayType::uint8_clamped_array => (ViewKind::Uint8Clamped, 1),
        sys::TypedarrayType::int16_array => (ViewKind::Int16, 2),
        sys::TypedarrayType::uint16_array => (ViewKind::Uint16, 2),
        sys::TypedarrayType::int32_array => (ViewKind::Int32, 4),
        sys::TypedarrayType::uint32_array => (ViewKind::Uint32, 4),
        sys::TypedarrayType::float32_array => (ViewKind::Float32, 4),
        sys::TypedarrayType::float64_array => (ViewKind::Float64, 8),
        sys::TypedarrayType::bigint64_array => (ViewKind::BigInt64, 8),
        sys::TypedarrayType::biguint64_array => (ViewKind::BigUint64, 8),
        sys::TypedarrayType::uint8_array => (ViewKind::Uint8, 1),
        // Never written to: `Other` matches no pixel type.
        _ => (ViewKind::Other, 1),
    }
}

fn check(status: sys::napi_status) -> napi::Result<()> {
    if status == sys::Status::napi_ok {
        Ok(())
    } else {
        Err(napi::Error::from_status(napi::Status::from(status)))
    }
}
