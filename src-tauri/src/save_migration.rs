//! Move save files from an old install directory to a new one, and clean up
//! the old directory afterwards.
//!
//! F95Zone hosts a grab-bag of engines (Ren'Py, RPGMaker MV/MZ, Unity, KiriKiri,
//! WolfRPG, raw HTML…). Most engines either keep saves inside the install
//! directory (so re-installing wipes them) or in a user-profile path that
//! survives reinstalls. We only worry about the first kind.
//!
//! Strategy: walk the old install root with a shallow recursion (capped depth)
//! and copy any directory whose name matches a list of known save folder
//! names. Anything outside that list is left alone — we don't try to be
//! clever about identifying arbitrary "user data" because guessing wrong
//! costs the player progress.
//!
//! After a successful migration the caller can call `delete_dir` on the old
//! install path to free disk space. To avoid catastrophic mistakes we refuse
//! to delete anything outside the app's own downloads root.

use crate::error::AppError;
use serde::Serialize;
use serde_json::json;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SAVE_DIR_NAMES: &[&str] = &[
    "saves",     // Ren'Py
    "save",      // KiriKiri, generic
    "Saves",     // some games on Windows
    "Save",      // VN engines
    "savedata",  // various
    "save_data", // various
    "www/save",  // RPGMaker MV (we look inside www/)
];

// Look up to this many directory levels deep when scanning for save folders.
// Most engines stash saves at root or one level deep (Ren'Py: `game/saves/`,
// RPGMaker: `www/save/`). Three covers the common cases without iterating
// the entire tree of a 5GB unpacked game.
const MAX_SCAN_DEPTH: usize = 4;

#[derive(Debug, Serialize)]
pub struct MigrationResult {
    /// How many save directories were copied. Zero is a normal outcome — many
    /// games don't have local saves yet (fresh install) or use user-profile
    /// paths.
    pub copied: usize,
    /// Total bytes copied. For UI feedback.
    pub bytes_copied: u64,
    /// Where each copied directory landed in the new install, for logging.
    pub destinations: Vec<String>,
}

/// Copy every recognized save directory from `old_root` into `new_root`,
/// preserving the relative path. Files inside an existing destination are
/// merged (existing files overwritten) so a partial new-install layout
/// doesn't lose the user's progress.
pub fn migrate(old_root: &Path, new_root: &Path) -> Result<MigrationResult, AppError> {
    if !old_root.exists() {
        return Err(AppError::keyed_vars(
            "error.save.sourceMissing",
            json!({ "path": old_root.display().to_string() }),
        ));
    }
    if !new_root.exists() {
        return Err(AppError::keyed_vars(
            "error.save.destMissing",
            json!({ "path": new_root.display().to_string() }),
        ));
    }

    let mut result = MigrationResult {
        copied: 0,
        bytes_copied: 0,
        destinations: Vec::new(),
    };

    for entry in WalkDir::new(old_root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if path == old_root {
            continue;
        }
        if !is_save_dir(path) {
            continue;
        }
        let rel = match path.strip_prefix(old_root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let dest = new_root.join(rel);
        let copied_bytes = copy_dir_merge(path, &dest)?;
        result.copied += 1;
        result.bytes_copied += copied_bytes;
        result
            .destinations
            .push(dest.to_string_lossy().into_owned());
    }

    Ok(result)
}

fn is_save_dir(path: &Path) -> bool {
    let name = match path.file_name().and_then(OsStr::to_str) {
        Some(n) => n,
        None => return false,
    };
    // case-insensitive match on the basename. The "www/save" entry in
    // SAVE_DIR_NAMES is matched by its basename "save" — the parent context
    // is enforced by the walk itself.
    for candidate in SAVE_DIR_NAMES {
        let cand_base = candidate.rsplit('/').next().unwrap_or(candidate);
        if name.eq_ignore_ascii_case(cand_base) {
            return true;
        }
    }
    false
}

fn copy_dir_merge(src: &Path, dst: &Path) -> Result<u64, AppError> {
    fs::create_dir_all(dst)?;
    let mut bytes: u64 = 0;
    for entry in WalkDir::new(src) {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                return Err(AppError::keyed_vars(
                    "error.save.walkFailed",
                    json!({ "detail": e.to_string() }),
                ))
            }
        };
        let src_path = entry.path();
        let rel = match src_path.strip_prefix(src) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dst_path = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dst_path)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let n = fs::copy(src_path, &dst_path)?;
            bytes += n;
        }
        // symlinks are skipped intentionally — saves shouldn't depend on them.
    }
    Ok(bytes)
}

/// Recursively delete `path`. Refuses anything that isn't under at least one
/// of the `safe_roots`. Returns Ok(false) when the target was outside every
/// safe area (the caller typically just leaves the folder alone).
///
/// We accept a list (not a single root) because the user can register N
/// install libraries — any of them is a legitimate place for an install.
pub fn delete_under(path: &Path, safe_roots: &[PathBuf]) -> Result<bool, AppError> {
    if !path.exists() {
        return Ok(true);
    }
    let canon_target = canonicalize_lenient(path);
    let in_sandbox = safe_roots
        .iter()
        .map(|r| canonicalize_lenient(r))
        .any(|r| canon_target.starts_with(&r));
    if !in_sandbox {
        // Outside every sandbox — refuse. Lets the user point exe_path at a
        // file living somewhere else (e.g. an existing manual install) without
        // worrying that an "update" wipes their unrelated folder.
        return Ok(false);
    }
    if path.is_file() {
        fs::remove_file(path)?;
    } else if path.is_dir() {
        fs::remove_dir_all(path)?;
    }
    Ok(true)
}

/// Same as `std::fs::canonicalize` but falls back to the lexical path when the
/// target doesn't exist (which can happen if the user is deleting a path that
/// vanished between UI and us, or if Windows refuses `\\?\` prefixes).
fn canonicalize_lenient(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}
