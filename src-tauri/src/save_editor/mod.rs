mod backup;
mod discover;
mod json_tree;
mod pickle_splice;
mod pickle_tree;
pub mod rpgm;
mod types;
pub mod unity;
mod zip_save;

pub use backup::{
    backup_before_write, ensure_under_root, list_backups, resolve_backup_path, restore_backup,
    RenpySaveBackup,
};
pub use discover::{list_slots, probe_renpy_install, resolve_saves_dir};
pub use pickle_tree::{read_save_tree, write_save_patches};
pub use types::{
    RpgmProbeResult, RenpyProbeResult, RenpySavePatch, RenpySaveSlot, RenpyVarNode, UnityMeta,
    UnityProbeResult, UnitySaveReadResult, UnitySaveSlot,
};
pub use zip_save::zip_has_screenshot;

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
    reject_path_component(thread_id)?;
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
    reject_path_component(thread_id)?;
    reject_path_component(slot_key)?;
    reject_path_component(backup_file_name)?;
    let live = resolve_live_save(install_path, slot_key)?;
    let backup = resolve_backup_path(backups_root, thread_id, slot_key, backup_file_name)?;
    let thread_root = backups_root.join(thread_id);
    ensure_under_root(&thread_root, backups_root)?;
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

/// Reject names that could escape via `Path::join` (separators, `..`, absolute).
pub(crate) fn reject_path_component(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains('\0')
        || name == "."
        || name == ".."
        || Path::new(name).is_absolute()
    {
        return Err(AppError::keyed("error.saveEditor.pathEscape"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-save-orch-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// Minimal Ren'Py-like layout so `resolve_saves_dir` finds `game/saves`.
    fn install_with_save(root: &Path, slot_key: &str, bytes: &[u8]) -> PathBuf {
        let install = root.join("game_root");
        let saves = install.join("game").join("saves");
        fs::create_dir_all(&saves).unwrap();
        fs::write(saves.join(slot_key), bytes).unwrap();
        install
    }

    #[test]
    fn write_rejects_dotdot_thread_id() {
        let root = tempfile_root("tid-dotdot");
        let install = install_with_save(&root, "1-1.save", b"x");
        let backups = root.join("save_backups");
        fs::create_dir_all(&backups).unwrap();

        let err = write(&backups, "..", &install, "1-1.save", &[]).unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }

    #[test]
    fn write_rejects_absolute_thread_id() {
        let root = tempfile_root("tid-abs");
        let install = install_with_save(&root, "1-1.save", b"x");
        let backups = root.join("save_backups");
        fs::create_dir_all(&backups).unwrap();

        let abs = root.join("escaped_thread");
        let err = write(
            &backups,
            abs.to_str().expect("utf-8 temp path"),
            &install,
            "1-1.save",
            &[],
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }

    #[test]
    fn read_rejects_slot_key_path_escape() {
        let root = tempfile_root("slot-escape");
        let install = install_with_save(&root, "1-1.save", b"x");

        let err = read(&install, "../outside.save").unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");

        let err = read(&install, "..").unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }
}

