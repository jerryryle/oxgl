//! Test-only access to the ANGLE bundle resolved at build time (feature
//! `test-support`). Production code passes an explicit directory to
//! [`crate::Angle::load`] and never reads this path.

use std::path::PathBuf;

/// The `lib` directory of the ANGLE bundle this crate was built against.
#[must_use]
pub fn bundle_dir() -> PathBuf {
    PathBuf::from(env!("OXGL_STAGED_ANGLE_LIB_DIR"))
}
