//! Throwaway (ci-pipeline task 3.3): a use-after-free the asan job must catch.

#[test]
fn injected_use_after_free() {
    let p = Box::into_raw(Box::new([7u8; 64]));
    // SAFETY: not safe; deliberately reads freed memory so ASan reports it.
    let byte = unsafe {
        drop(Box::from_raw(p));
        std::ptr::read_volatile(p.cast::<u8>())
    };
    assert_eq!(byte, 7);
}
