//! Throwaway (ci-pipeline task 3.3): a leak the asan job's LSan must catch.

#[test]
fn injected_leak() {
    // Leak from a joined thread so no stale stack slot keeps it reachable.
    std::thread::spawn(|| {
        let buffer = vec![0u8; 4096].into_boxed_slice();
        let _ = Box::into_raw(buffer);
    })
    .join()
    .unwrap();
}
