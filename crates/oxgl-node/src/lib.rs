//! Node-API binding for oxgl.
//
// `deny` rather than `forbid`: the `#[napi]` macro expands to FFI glue carrying
// its own `#[allow(unsafe_code)]`, which `forbid` rejects. The allowance is
// therefore scoped to macro-generated items only; any hand-written `unsafe`
// in this crate still fails the build. Unsafe code belongs in `oxgl-sys`.
#![deny(unsafe_code)]

/// Version of the JS ↔ native interface. The JS loader checks it to confirm the
/// addon it loaded matches the package.
#[napi_derive::napi]
#[must_use]
pub fn native_abi_version() -> u32 {
    1
}
