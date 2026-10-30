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
    fn copy_from(&self, buffer: &[u8]) {
        self.copy_from_at(0, buffer);
    }
    /// Copies `buffer` into the view starting at byte `offset` (fewer bytes
    /// if the view is shorter).
    fn copy_from_at(&self, offset: usize, buffer: &[u8]);
}

/// Memory a call reads from: an `ArrayBuffer` or a view of one, accessed
/// only for the duration of [`ByteSource::with_bytes`].
pub trait ByteSource {
    /// Element type of the view (`Uint8` for a bare buffer).
    fn kind(&self) -> ViewKind;
    /// Length in bytes.
    fn byte_len(&self) -> usize;
    /// Calls `f` with the bytes in `range`, clamped to the source.
    fn with_bytes(&self, range: std::ops::Range<usize>, f: &mut dyn FnMut(&[u8]));
}

impl ViewKind {
    /// Bytes per element (1 for `DataView` and unrecognized views).
    #[must_use]
    pub fn element_size(self) -> usize {
        match self {
            Self::Int16 | Self::Uint16 => 2,
            Self::Int32 | Self::Uint32 | Self::Float32 => 4,
            Self::Float64 | Self::BigInt64 | Self::BigUint64 => 8,
            Self::Int8 | Self::Uint8 | Self::Uint8Clamped | Self::DataView | Self::Other => 1,
        }
    }
}

impl ByteSource for [u8] {
    fn kind(&self) -> ViewKind {
        ViewKind::Uint8
    }

    fn byte_len(&self) -> usize {
        self.len()
    }

    fn with_bytes(&self, range: std::ops::Range<usize>, f: &mut dyn FnMut(&[u8])) {
        let end = range.end.min(self.len());
        f(self.get(range.start.min(end)..end).unwrap_or(&[]));
    }
}
