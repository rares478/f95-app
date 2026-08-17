//! Wolf RPG Editor save editor orchestration.

pub mod crypto;
pub mod discover;
pub mod reader;
pub mod tree;
pub mod vardb;

use crate::error::AppError;
use crate::save_editor::{
    backup_before_write, ensure_under_root, reject_path_component, resolve_backup_path,
    restore_backup, ExtraSaveRoot, RenpySavePatch, RenpySaveSlot, RenpyVarNode,
};
use discover::{list_slots, resolve_saves_dir};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tree::{read_wolf_sav, write_wolf_patches};

pub use discover::probe_wolf_install;

pub fn list_for_install(
    install: &Path,
    extra_roots: &[ExtraSaveRoot],
) -> Result<Vec<RenpySaveSlot>, AppError> {
    let mut slots = if let Some(saves_dir) = resolve_saves_dir(install) {
        list_slots(&saves_dir)?
    } else {
        Vec::new()
    };
    let mut seen: HashSet<String> = slots.iter().map(|s| s.key.clone()).collect();
    for root in extra_roots {
        let dir = Path::new(&root.path);
        if !dir.is_dir() {
            continue;
        }
        for mut slot in list_slots(dir)? {
            let file_key = slot.key.clone();
            slot.key = format!("extra:{}/{}", root.id, file_key);
            slot.source = Some("extra".into());
            slot.display_name = Some(file_key);
            if seen.insert(slot.key.clone()) {
                slots.push(slot);
            }
        }
    }
    slots.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(slots)
}

pub fn read(
    install: &Path,
    slot_key: &str,
    extra_roots: &[ExtraSaveRoot],
) -> Result<RenpyVarNode, AppError> {
    let (live, _) = resolve_live_save(install, slot_key, extra_roots)?;
    read_wolf_sav(&live)
}

pub fn write(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    slot_key: &str,
    patches: &[RenpySavePatch],
    extra_roots: &[ExtraSaveRoot],
) -> Result<RenpyVarNode, AppError> {
    reject_path_component(thread_id)?;
    let (live, _) = resolve_live_save(install, slot_key, extra_roots)?;
    backup_before_write(backups_root, thread_id, slot_key, &live)?;
    write_wolf_patches(&live, patches)
}

pub fn restore(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    slot_key: &str,
    backup_file_name: &str,
    extra_roots: &[ExtraSaveRoot],
) -> Result<(), AppError> {
    reject_path_component(thread_id)?;
    reject_path_component(backup_file_name)?;
    let (live, sandbox_root) = resolve_live_save(install, slot_key, extra_roots)?;
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
        &sandbox_root,
    )
}

fn resolve_live_save(
    install: &Path,
    slot_key: &str,
    extra_roots: &[ExtraSaveRoot],
) -> Result<(PathBuf, PathBuf), AppError> {
    if let Some(rel) = slot_key.strip_prefix("extra:") {
        let (live, root) = crate::save_editor::resolve_extra_live(extra_roots, rel)?;
        return Ok((live, root));
    }
    reject_path_component(slot_key)?;
    let saves_dir = resolve_saves_dir(install).ok_or_else(|| {
        AppError::Io(format!(
            "no Wolf RPG saves directory under {}",
            install.display()
        ))
    })?;
    let live = saves_dir.join(slot_key);
    ensure_under_root(&live, install)?;
    Ok((live, install.to_path_buf()))
}
