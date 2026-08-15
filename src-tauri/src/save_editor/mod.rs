mod backup;
mod discover;
mod pickle_tree;
mod types;
mod zip_save;

pub use backup::{
    backup_before_write, ensure_under_root, list_backups, resolve_backup_path, restore_backup,
    RenpySaveBackup, MAX_BACKUPS_PER_SLOT,
};
pub use discover::{list_slots, probe_renpy_install, resolve_saves_dir};
pub use pickle_tree::{apply_patches, log_to_tree, read_save_tree, write_save_patches};
pub use types::{RenpyProbeResult, RenpySavePatch, RenpySaveSlot, RenpyVarNode};
pub use zip_save::{read_log_bytes, write_log_bytes, zip_has_screenshot};

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// List slots under an install, filling `has_screenshot` best-effort via zip peek.
pub fn list_for_install(install_path: &Path) -> Result<Vec<RenpySaveSlot>, AppError> {
    let Some(saves_dir) = resolve_saves_dir(install_path) else {
        return Ok(Vec::new());
    };
    let mut slots = list_slots(&saves_dir)?;
    for slot in &mut slots {
        let path = saves_dir.join(&slot.key);
        slot.has_screenshot = zip_has_screenshot(&path);
    }
    Ok(slots)
}

/// Read the variable tree for one slot under the install.
pub fn read(install_path: &Path, slot_key: &str) -> Result<RenpyVarNode, AppError> {
    let live = resolve_live_save(install_path, slot_key)?;
    read_save_tree(&live)
}

/// Backup then apply patches; returns the updated tree.
pub fn write(
    backups_root: &Path,
    thread_id: &str,
    install_path: &Path,
    slot_key: &str,
    patches: &[RenpySavePatch],
) -> Result<RenpyVarNode, AppError> {
    let live = resolve_live_save(install_path, slot_key)?;
    backup_before_write(backups_root, thread_id, slot_key, &live)?;
    write_save_patches(&live, patches)
}

/// Restore a named backup over the live slot (after sandbox checks).
pub fn restore(
    backups_root: &Path,
    thread_id: &str,
    install_path: &Path,
    slot_key: &str,
    backup_file_name: &str,
) -> Result<(), AppError> {
    reject_path_component(slot_key)?;
    reject_path_component(backup_file_name)?;
    let live = resolve_live_save(install_path, slot_key)?;
    let backup = resolve_backup_path(backups_root, thread_id, slot_key, backup_file_name);
    let thread_root = backups_root.join(thread_id);
    ensure_under_root(&backup, &thread_root)?;
    restore_backup(
        backups_root,
        thread_id,
        slot_key,
        &backup,
        &live,
        install_path,
    )
}

fn resolve_live_save(install_path: &Path, slot_key: &str) -> Result<PathBuf, AppError> {
    reject_path_component(slot_key)?;
    let saves_dir = resolve_saves_dir(install_path).ok_or_else(|| {
        AppError::Io(format!(
            "no saves directory under {}",
            install_path.display()
        ))
    })?;
    let live = saves_dir.join(slot_key);
    ensure_under_root(&live, install_path)?;
    Ok(live)
}

fn reject_path_component(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name == "."
        || name == ".."
    {
        return Err(AppError::keyed("error.saveEditor.pathEscape"));
    }
    Ok(())
}
