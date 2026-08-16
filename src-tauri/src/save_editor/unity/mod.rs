//! Unity ES3 / JSON save discovery and editing.

pub mod discover;
pub mod es3;
pub mod files;
pub mod json_save;

use crate::error::AppError;
use crate::save_editor::json_tree::{apply_patches_json, json_to_tree};
use crate::save_editor::types::{
    RenpySavePatch, RenpyVarNode, UnityMeta, UnitySaveReadResult, UnitySaveSlot,
};
use crate::save_editor::{
    backup_before_write, ensure_under_root, reject_path_component, resolve_backup_path,
    restore_backup,
};
use json_save::{parse_json_value, write_bytes_atomic, write_json_file_atomic};
use std::fs;
use std::path::{Path, PathBuf};

pub use discover::{
    find_data_dir, is_unity_layout, local_low_root, probe_unity_install, read_app_info,
    resolve_local_low_dir,
};
pub use es3::{decrypt_es3, detect_es3, encrypt_es3, is_encrypted_es3, Es3Payload};
pub use files::{dir_has_candidates, list_slots, parse_slot_key, slot_key};

const BAD_PASSWORD: &str = "error.saveEditor.unity.badPassword";

pub fn ping() -> &'static str {
    "unity"
}

/// List ES3/JSON slots under LocalLow (if resolved) and the install tree.
pub fn list_for_install(
    install: &Path,
    meta: &UnityMeta,
) -> Result<Vec<UnitySaveSlot>, AppError> {
    files::list_slots(install, meta, &local_low_root())
}

/// Read a slot into a tree; encrypted slots need a password to unlock.
pub fn read(
    install: &Path,
    meta: &UnityMeta,
    slot_key: &str,
    password: Option<&str>,
) -> Result<UnitySaveReadResult, AppError> {
    let (live, _) = resolve_live_save(install, meta, slot_key)?;
    let bytes = fs::read(&live).map_err(|e| {
        AppError::Io(format!(
            "failed to read unity save {}: {e}",
            live.display()
        ))
    })?;

    match classify_save(&live, &bytes)? {
        SaveKind::PlainJson(text) => {
            let value = parse_json_value(&text)?;
            Ok(UnitySaveReadResult {
                tree: Some(json_to_tree(&value)),
                needs_password: false,
                encrypted: false,
            })
        }
        SaveKind::EncryptedEs3 => match password {
            None => Ok(UnitySaveReadResult {
                tree: None,
                needs_password: true,
                encrypted: true,
            }),
            Some(pw) => {
                let text =
                    decrypt_es3(&bytes, pw).map_err(|_| AppError::keyed(BAD_PASSWORD))?;
                let value = parse_json_value(&text)?;
                Ok(UnitySaveReadResult {
                    tree: Some(json_to_tree(&value)),
                    needs_password: false,
                    encrypted: true,
                })
            }
        },
    }
}

/// Backup then apply patches; re-encrypts ES3 when a password is used.
pub fn write(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    meta: &UnityMeta,
    slot_key: &str,
    patches: &[RenpySavePatch],
    password: Option<&str>,
) -> Result<RenpyVarNode, AppError> {
    reject_path_component(thread_id)?;
    let (live, _) = resolve_live_save(install, meta, slot_key)?;
    backup_before_write(backups_root, thread_id, slot_key, &live)?;

    let bytes = fs::read(&live).map_err(|e| {
        AppError::Io(format!(
            "failed to read unity save {}: {e}",
            live.display()
        ))
    })?;

    let value = match classify_save(&live, &bytes)? {
        SaveKind::PlainJson(text) => {
            let mut value = parse_json_value(&text)?;
            apply_patches_json(&mut value, patches)?;
            write_json_file_atomic(&live, &value)?;
            value
        }
        SaveKind::EncryptedEs3 => {
            let pw = password.ok_or_else(|| AppError::keyed(BAD_PASSWORD))?;
            let text = decrypt_es3(&bytes, pw).map_err(|_| AppError::keyed(BAD_PASSWORD))?;
            let mut value = parse_json_value(&text)?;
            apply_patches_json(&mut value, patches)?;
            let json = serde_json::to_string(&value).map_err(|e| {
                AppError::Io(format!(
                    "failed to serialize unity save {}: {e}",
                    live.display()
                ))
            })?;
            let enc = encrypt_es3(&json, pw)?;
            write_bytes_atomic(&live, &enc)?;
            value
        }
    };

    Ok(json_to_tree(&value))
}

/// Restore a named backup over the live slot without creating another backup.
pub fn restore(
    backups_root: &Path,
    thread_id: &str,
    install: &Path,
    meta: &UnityMeta,
    slot_key: &str,
    backup_file_name: &str,
) -> Result<(), AppError> {
    reject_path_component(thread_id)?;
    reject_path_component(backup_file_name)?;
    let (live, sandbox_root) = resolve_live_save(install, meta, slot_key)?;
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

/// Resolve live path and its sandbox root (install or LocalLow dir).
fn resolve_live_save(
    install: &Path,
    meta: &UnityMeta,
    slot_key: &str,
) -> Result<(PathBuf, PathBuf), AppError> {
    let (source, rel) = files::parse_slot_key(slot_key)?;
    validate_rel_segments(rel)?;

    match source {
        "install" => {
            let live = join_rel(install, rel);
            ensure_under_root(&live, install)?;
            Ok((live, install.to_path_buf()))
        }
        "localLow" => {
            let local_low = resolve_local_low_dir(install, meta, &local_low_root()).ok_or_else(
                || {
                    AppError::Io(format!(
                        "no LocalLow save directory for {}",
                        install.display()
                    ))
                },
            )?;
            let live = join_rel(&local_low, rel);
            ensure_under_root(&live, &local_low)?;
            Ok((live, local_low))
        }
        _ => Err(AppError::keyed("error.saveEditor.unity.badSlotKey")),
    }
}

fn validate_rel_segments(rel: &str) -> Result<(), AppError> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') {
        return Err(AppError::keyed("error.saveEditor.pathEscape"));
    }
    for seg in rel.split('/') {
        reject_path_component(seg)?;
    }
    Ok(())
}

fn join_rel(root: &Path, rel: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        out.push(seg);
    }
    out
}

enum SaveKind {
    PlainJson(String),
    EncryptedEs3,
}

fn classify_save(path: &Path, bytes: &[u8]) -> Result<SaveKind, AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "es3" {
        return Ok(match detect_es3(bytes) {
            Es3Payload::Json(text) => SaveKind::PlainJson(text),
            Es3Payload::Encrypted => SaveKind::EncryptedEs3,
        });
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
        .to_string();
    let _ = parse_json_value(&text)?;
    Ok(SaveKind::PlainJson(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::list_backups;
    use crate::save_editor::types::RenpySavePatch;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-unity-orch-{}-{}-{}",
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

    fn unity_install(root: &Path) -> PathBuf {
        let install = root.join("game");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();
        fs::create_dir_all(install.join("Save")).unwrap();
        install
    }

    fn meta() -> UnityMeta {
        UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        }
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
    fn write_patches_json_gold_and_creates_backup() {
        let root = tempfile_root("json-gold");
        let install = unity_install(&root);
        let slot = "install:Save/slot.json";
        fs::write(install.join("Save").join("slot.json"), br#"{"gold":50}"#).unwrap();

        let backups = root.join("save_backups");
        fs::create_dir_all(&backups).unwrap();

        let tree = write(
            &backups,
            "thread1",
            &install,
            &meta(),
            slot,
            &[RenpySavePatch {
                path: "gold".into(),
                value: serde_json::json!(999),
            }],
            None,
        )
        .unwrap();

        assert_eq!(
            find(&tree, "gold").unwrap().value,
            Some(serde_json::json!(999))
        );

        let listed = crate::save_editor::list_backups(&backups, "thread1", slot).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, "original.json");
        assert_eq!(
            fs::read_to_string(&listed[0].path).unwrap(),
            r#"{"gold":50}"#
        );
        // Must not land under the old colliding sanitize name.
        assert!(
            !Path::new(&listed[0].path)
                .components()
                .any(|c| c.as_os_str() == "install_Save_slot.json"),
            "Unity slot keys must not use underscore-collapsed backup dirs"
        );

        let reread = read(&install, &meta(), slot, None).unwrap();
        assert!(!reread.needs_password);
        assert!(!reread.encrypted);
        assert_eq!(
            find(reread.tree.as_ref().unwrap(), "gold")
                .unwrap()
                .value,
            Some(serde_json::json!(999))
        );
    }

    #[test]
    fn encrypted_read_needs_password_then_unlocks() {
        let root = tempfile_root("es3-unlock");
        let install = unity_install(&root);
        let slot = "install:Save/data.es3";
        let password = "f95-test-password";
        let enc = encrypt_es3(r#"{"hp":7}"#, password).unwrap();
        fs::write(install.join("Save").join("data.es3"), &enc).unwrap();

        let locked = read(&install, &meta(), slot, None).unwrap();
        assert!(locked.encrypted);
        assert!(locked.needs_password);
        assert!(locked.tree.is_none());

        let err = read(&install, &meta(), slot, Some("wrong")).unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.unity.badPassword");

        let unlocked = read(&install, &meta(), slot, Some(password)).unwrap();
        assert!(unlocked.encrypted);
        assert!(!unlocked.needs_password);
        assert_eq!(
            find(unlocked.tree.as_ref().unwrap(), "hp")
                .unwrap()
                .value,
            Some(serde_json::json!(7))
        );
    }

    #[test]
    fn write_encrypted_reencrypts_and_restore_works() {
        let root = tempfile_root("es3-write");
        let install = unity_install(&root);
        let slot = "install:Save/data.es3";
        let password = "f95-test-password";
        let enc = encrypt_es3(r#"{"hp":7}"#, password).unwrap();
        fs::write(install.join("Save").join("data.es3"), &enc).unwrap();

        let backups = root.join("save_backups");
        let tree = write(
            &backups,
            "thread1",
            &install,
            &meta(),
            slot,
            &[RenpySavePatch {
                path: "hp".into(),
                value: serde_json::json!(99),
            }],
            Some(password),
        )
        .unwrap();
        assert_eq!(
            find(&tree, "hp").unwrap().value,
            Some(serde_json::json!(99))
        );

        let on_disk = fs::read(install.join("Save").join("data.es3")).unwrap();
        assert!(is_encrypted_es3(&on_disk));
        let plain = decrypt_es3(&on_disk, password).unwrap();
        assert!(plain.contains("99"));

        restore(
            &backups,
            "thread1",
            &install,
            &meta(),
            slot,
            "original.es3",
        )
        .unwrap();
        let restored = read(&install, &meta(), slot, Some(password)).unwrap();
        assert_eq!(
            find(restored.tree.as_ref().unwrap(), "hp")
                .unwrap()
                .value,
            Some(serde_json::json!(7))
        );

        let listed = list_backups(&backups, "thread1", slot).unwrap();
        assert_eq!(listed.len(), 1, "restore must not create another backup");
    }
}
