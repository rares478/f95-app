pub mod codec;
pub mod discover;
pub mod labels;
pub mod tree;

use crate::error::AppError;
use crate::save_editor::{
    backup_before_write, ensure_under_root, reject_path_component, resolve_backup_path,
    restore_backup, RenpySavePatch, RenpySaveSlot, RenpyVarNode,
};
use discover::{list_slots, resolve_data_dir, resolve_saves_dir};
use labels::{
    decorate_inventory_names, decorate_system_names, load_inventory_names, load_system_names,
};
use std::path::{Path, PathBuf};
use tree::{read_rpgsave_file, write_rpgsave_patches};

pub use discover::probe_rpgm_install;

/// List `.rpgsave` slots under an install (empty if no RPGM saves dir).
pub fn list_for_install(install: &Path) -> Result<Vec<RenpySaveSlot>, AppError> {
    let Some((saves_dir, _)) = resolve_saves_dir(install) else {
        return Ok(Vec::new());
    };
    list_slots(&saves_dir)
}

/// Read the variable tree for one slot; decorate inventory names when data dir exists.
pub fn read(install: &Path, slot_key: &str) -> Result<RenpyVarNode, AppError> {
    let (live, variant) = resolve_live_save(install, slot_key)?;
    let data_dir = resolve_data_dir(install, variant);
    read_rpgsave_file(&live, data_dir.as_deref())
}

/// Backup then apply patches; returns the updated tree with inventory labels.
pub fn write(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    slot_key: &str,
    patches: &[RenpySavePatch],
) -> Result<RenpyVarNode, AppError> {
    reject_path_component(thread_id)?;
    let (live, variant) = resolve_live_save(install, slot_key)?;
    backup_before_write(backups_root, thread_id, slot_key, &live)?;
    let mut tree = write_rpgsave_patches(&live, patches)?;
    if let Some(data_dir) = resolve_data_dir(install, variant) {
        let names = load_inventory_names(&data_dir);
        decorate_inventory_names(&mut tree, &names);
        let system = load_system_names(&data_dir);
        decorate_system_names(&mut tree, &system);
    }
    Ok(tree)
}

/// Restore a named backup over the live `.rpgsave` without creating another backup.
pub fn restore(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    slot_key: &str,
    backup_file_name: &str,
) -> Result<(), AppError> {
    reject_path_component(thread_id)?;
    reject_path_component(slot_key)?;
    reject_path_component(backup_file_name)?;
    let (live, _) = resolve_live_save(install, slot_key)?;
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
        install,
    )
}

fn resolve_live_save(install: &Path, slot_key: &str) -> Result<(PathBuf, &'static str), AppError> {
    reject_path_component(slot_key)?;
    let (saves_dir, variant) = resolve_saves_dir(install).ok_or_else(|| {
        AppError::Io(format!(
            "no RPG Maker saves directory under {}",
            install.display()
        ))
    })?;
    let live = saves_dir.join(slot_key);
    ensure_under_root(&live, install)?;
    Ok((live, variant))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::rpgm::codec::compress_rpgsave;
    use crate::save_editor::types::RenpySavePatch;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-rpgm-orch-{}-{}-{}",
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

    fn find<'a>(tree: &'a RenpyVarNode, path: &str) -> Option<&'a RenpyVarNode> {
        if tree.path == path {
            return Some(tree);
        }
        tree.children
            .as_ref()?
            .iter()
            .find_map(|child| find(child, path))
    }

    #[test]
    fn write_updates_file_and_creates_original_rpgsave() {
        let root = tempfile_root("write-gold");
        let install = root.join("game");
        let save_dir = install.join("www").join("save");
        let data_dir = install.join("www").join("data");
        fs::create_dir_all(&save_dir).unwrap();
        fs::create_dir_all(&data_dir).unwrap();
        fs::create_dir_all(install.join("www").join("js")).unwrap();
        fs::write(install.join("www").join("js").join("rpg_core.js"), b"").unwrap();
        fs::write(
            data_dir.join("Items.json"),
            r#"[null,{"id":1,"name":"Potion"}]"#,
        )
        .unwrap();

        let json = r#"{"party":{"_gold":50,"_items":{"1":2}}}"#;
        let compressed = compress_rpgsave(json).unwrap();
        let slot = "file1.rpgsave";
        fs::write(save_dir.join(slot), compressed.as_bytes()).unwrap();

        let backups = root.join("save_backups");
        fs::create_dir_all(&backups).unwrap();

        let tree = write(
            &backups,
            "thread1",
            &install,
            slot,
            &[RenpySavePatch {
                path: "party._gold".into(),
                value: serde_json::json!(999),
            }],
        )
        .unwrap();

        assert_eq!(
            find(&tree, "party._gold").unwrap().value,
            Some(serde_json::json!(999))
        );
        assert_eq!(
            find(&tree, "party._items.1").unwrap().name,
            "Potion (1)",
            "write return should decorate inventory labels"
        );

        let original = backups
            .join("thread1")
            .join(slot)
            .join("original.rpgsave");
        assert!(
            original.is_file(),
            "expected original.rpgsave at {}",
            original.display()
        );
        assert_eq!(
            fs::read_to_string(&original).unwrap(),
            compressed,
            "original backup must preserve pre-edit bytes"
        );

        let reread = read(&install, slot).unwrap();
        assert_eq!(
            find(&reread, "party._gold").unwrap().value,
            Some(serde_json::json!(999))
        );
    }

    #[test]
    fn read_rejects_slot_key_path_escape() {
        let root = tempfile_root("slot-escape");
        let install = root.join("game");
        let save_dir = install.join("www").join("save");
        fs::create_dir_all(&save_dir).unwrap();
        fs::create_dir_all(install.join("www").join("js")).unwrap();
        fs::write(install.join("www").join("js").join("rpg_core.js"), b"").unwrap();
        let compressed = compress_rpgsave(r#"{"party":{"_gold":1}}"#).unwrap();
        fs::write(save_dir.join("file1.rpgsave"), compressed.as_bytes()).unwrap();

        let err = read(&install, "../outside.rpgsave").unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");

        let err = read(&install, "..").unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }

    #[test]
    fn restore_does_not_create_another_backup() {
        let root = tempfile_root("restore");
        let install = root.join("game");
        let save_dir = install.join("www").join("save");
        fs::create_dir_all(&save_dir).unwrap();
        fs::create_dir_all(install.join("www").join("js")).unwrap();
        fs::write(install.join("www").join("js").join("rpg_core.js"), b"").unwrap();

        let original_json = r#"{"party":{"_gold":10}}"#;
        let original_bytes = compress_rpgsave(original_json).unwrap();
        let slot = "file1.rpgsave";
        fs::write(save_dir.join(slot), original_bytes.as_bytes()).unwrap();

        let backups = root.join("save_backups");
        write(
            &backups,
            "thread1",
            &install,
            slot,
            &[RenpySavePatch {
                path: "party._gold".into(),
                value: serde_json::json!(99),
            }],
        )
        .unwrap();

        restore(&backups, "thread1", &install, slot, "original.rpgsave").unwrap();
        assert_eq!(
            find(&read(&install, slot).unwrap(), "party._gold")
                .unwrap()
                .value,
            Some(serde_json::json!(10))
        );

        let listed = crate::save_editor::list_backups(&backups, "thread1", slot).unwrap();
        assert_eq!(listed.len(), 1, "restore must not create another backup");
        assert_eq!(listed[0].file_name, "original.rpgsave");
    }
}
