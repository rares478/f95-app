//! Unity ES3 / JSON save discovery and editing.

pub mod discover;

pub use discover::{
    find_data_dir, is_unity_layout, local_low_root, probe_unity_install, read_app_info,
    resolve_local_low_dir,
};

pub fn ping() -> &'static str {
    "unity"
}
