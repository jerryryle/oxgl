//! Per-environment state: the contexts of one Node-API environment (main
//! thread or worker) and its deferred-deletion queue.

use std::path::PathBuf;

use slotmap::{Key, KeyData, SlotMap, new_key_type};

use crate::backend::{self, ContextRequest, RequestedBackend};
use crate::context::Context;
use crate::error::CoreError;

new_key_type! {
    /// Generational handle of a context. It crosses to JS as two `u32`s (see
    /// [`key_to_parts`]): a 64-bit key is not exact as a JS number.
    pub struct ContextKey;
}

/// Splits `key` into `[index, version]`.
#[must_use]
pub fn key_to_parts(key: ContextKey) -> [u32; 2] {
    let ffi = key.data().as_ffi();
    let [i0, i1, i2, i3, v0, v1, v2, v3] = ffi.to_le_bytes();
    [
        u32::from_le_bytes([i0, i1, i2, i3]),
        u32::from_le_bytes([v0, v1, v2, v3]),
    ]
}

/// Rebuilds a key from [`key_to_parts`]. Arbitrary parts give a key that
/// resolves to no context (or a stale one), never to an invalid one.
#[must_use]
pub fn key_from_parts([index, version]: [u32; 2]) -> ContextKey {
    KeyData::from_ffi((u64::from(version) << 32) | u64::from(index)).into()
}

/// [`key_to_parts`] for object keys.
#[must_use]
pub fn object_key_to_parts(key: crate::context::ObjectKey) -> [u32; 2] {
    let ffi = key.data().as_ffi();
    #[allow(
        clippy::cast_possible_truncation,
        reason = "splitting a u64 into halves"
    )]
    [ffi as u32, (ffi >> 32) as u32]
}

/// [`key_from_parts`] for object keys; `[0, 0]` (never a live key, as
/// occupied slots have odd versions) stands for `null`.
#[must_use]
pub fn object_key_from_parts([index, version]: [u32; 2]) -> Option<crate::context::ObjectKey> {
    (version != 0).then(|| KeyData::from_ffi((u64::from(version) << 32) | u64::from(index)).into())
}

/// Work deferred from garbage collection to a safe point on the owning thread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Deferred {
    /// Destroy a context whose JS object was collected.
    Context(ContextKey),
    /// Delete a WebGL object whose JS object was collected.
    Object(ContextKey, crate::context::ObjectKey),
}

/// The contexts of one environment. Contexts are thread-affine, so a
/// `Runtime` lives on its environment's thread.
#[derive(Debug)]
pub struct Runtime {
    lib_dir: PathBuf,
    contexts: SlotMap<ContextKey, Context>,
    deletion_queue: Vec<Deferred>,
}

impl Runtime {
    /// A runtime that loads ANGLE from `lib_dir` (an absolute path).
    #[must_use]
    pub fn new(lib_dir: PathBuf) -> Self {
        Self {
            lib_dir,
            contexts: SlotMap::with_key(),
            deletion_queue: Vec::new(),
        }
    }

    /// Creates a context.
    ///
    /// # Errors
    ///
    /// See [`backend::create_drawing_buffer`]. Nothing is allocated on error.
    pub fn create_context(
        &mut self,
        requested: RequestedBackend,
        request: &ContextRequest,
    ) -> Result<ContextKey, CoreError> {
        self.drain();
        let (_, buffer) = backend::create_drawing_buffer(&self.lib_dir, requested, request)?;
        Ok(self.contexts.insert(Context::new(buffer, request.webgl2)))
    }

    /// The live context for `key`; `None` for a destroyed or unknown key,
    /// which callers treat as lost.
    pub fn context(&mut self, key: ContextKey) -> Option<&mut Context> {
        self.drain();
        self.contexts.get_mut(key)
    }

    /// Destroys the context now, releasing its GL objects, context, and
    /// pbuffer. A stale key is a no-op.
    pub fn destroy(&mut self, key: ContextKey) {
        self.drain();
        self.contexts.remove(key);
    }

    /// Defers destruction of a garbage-collected context and drains the queue.
    pub fn release(&mut self, key: ContextKey) {
        self.deletion_queue.push(Deferred::Context(key));
        self.drain();
    }

    /// Defers deletion of a garbage-collected object and drains the queue.
    pub fn release_object(&mut self, context: ContextKey, object: crate::context::ObjectKey) {
        self.deletion_queue.push(Deferred::Object(context, object));
        self.drain();
    }

    /// Performs all deferred deletions. An object whose context is gone is
    /// skipped: destroying the context freed it.
    pub fn drain(&mut self) {
        if self.deletion_queue.is_empty() {
            return;
        }
        for deferred in std::mem::take(&mut self.deletion_queue) {
            match deferred {
                Deferred::Context(key) => {
                    self.contexts.remove(key);
                }
                Deferred::Object(context, object) => {
                    if let Some(context) = self.contexts.get_mut(context) {
                        context.delete_object(object);
                    }
                }
            }
        }
    }

    /// Destroys every context (environment teardown).
    pub fn destroy_all(&mut self) {
        self.deletion_queue.clear();
        self.contexts.clear();
    }

    /// Number of live contexts.
    #[must_use]
    pub fn live_contexts(&self) -> usize {
        self.contexts.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_through_parts() {
        let mut map: SlotMap<ContextKey, ()> = SlotMap::with_key();
        let key = map.insert(());
        assert_eq!(key_from_parts(key_to_parts(key)), key);
    }

    #[test]
    fn large_versions_round_trip() {
        // Beyond 2^21, where index and version no longer fit one JS number.
        let parts = [7, (1 << 22) + 1];
        assert_eq!(key_to_parts(key_from_parts(parts)), parts);
        let parts = [u32::MAX - 1, u32::MAX];
        assert_eq!(key_to_parts(key_from_parts(parts)), parts);
    }

    #[test]
    fn object_keys_round_trip_and_zero_is_null() {
        let mut map: SlotMap<crate::context::ObjectKey, ()> = SlotMap::with_key();
        let key = map.insert(());
        assert_eq!(object_key_from_parts(object_key_to_parts(key)), Some(key));
        assert_eq!(object_key_from_parts([0, 0]), None);
    }

    #[test]
    fn arbitrary_parts_resolve_to_nothing() {
        let map: SlotMap<ContextKey, ()> = SlotMap::with_key();
        assert!(map.get(key_from_parts([3, 2])).is_none());
    }
}
