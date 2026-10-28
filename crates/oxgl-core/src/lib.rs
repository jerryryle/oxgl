//! Safe core of oxgl: owns contexts, handles, validation and error state.
#![forbid(unsafe_code)]

/// Throwaway: deliberate clippy pedantic violation (`cast_possible_truncation`).
#[must_use]
pub fn truncate(x: u64) -> u32 {
    x as u32
}
