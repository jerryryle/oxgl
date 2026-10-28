//! Destinations for pixel data: the interface `readPixels` writes through,
//! implemented for JS typed arrays by [`crate::napi_view`] (feature `node`)
//! and by tests for plain memory.

/// Element type of an `ArrayBufferView`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewKind {
    /// `Int8Array`.
    Int8,
    /// `Uint8Array`.
    Uint8,
    /// `Uint8ClampedArray`.
    Uint8Clamped,
    /// `Int16Array`.
    Int16,
    /// `Uint16Array`.
    Uint16,
    /// `Int32Array`.
    Int32,
    /// `Uint32Array`.
    Uint32,
    /// `Float32Array`.
    Float32,
    /// `Float64Array`.
    Float64,
    /// `BigInt64Array`.
    BigInt64,
    /// `BigUint64Array`.
    BigUint64,
    /// `DataView`.
    DataView,
    /// A typed array this build does not recognize (for example
    /// `Float16Array`); it matches no pixel type.
    Other,
}

/// Memory a read writes into, accessed only through copies so that no
/// reference to it is ever formed (it may be shared with other threads).
pub trait PixelDestination {
    /// Element type of the view.
    fn kind(&self) -> ViewKind;
    /// Length of the view in bytes.
    fn byte_len(&self) -> usize;
    /// Copies the first `buffer.len()` bytes of the view into `buffer`
    /// (fewer if the view is shorter).
    fn copy_to(&self, buffer: &mut [u8]);
    /// Copies `buffer` over the first `buffer.len()` bytes of the view
    /// (fewer if the view is shorter).
    fn copy_from(&self, buffer: &[u8]);
}
