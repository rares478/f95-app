//! Unity ES3 / JSON save discovery and editing.

pub mod discover;
pub mod es3;
pub mod es3_defaults;
pub mod files;
pub mod json_save;
pub mod xor_json;

use crate::error::AppError;
use crate::save_editor::json_tree::{apply_patches_json, json_to_tree};
use crate::save_editor::types::{
    RenpySavePatch, RenpyVarNode, UnityMeta, UnitySaveReadResult, UnitySaveSlot,
};
use crate::save_editor::{
    backup_before_write, ensure_under_root, reject_path_component, resolve_backup_path,
    restore_backup,
};
use crate::save_editor::unity::es3_defaults::extract_es3_password_from_install;
use json_save::{parse_json_value, write_bytes_atomic, write_json_file_atomic};
use xor_json::{
    collect_xor_key_candidates, decrypt_xor_json_with_keys, xor_encrypt_json,
};
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

    match classify_save(install, &live, &bytes, password)? {
        SaveKind::PlainJson(text) => {
            let value = parse_json_value(&text)?;
            Ok(UnitySaveReadResult {
                tree: Some(json_to_tree(&value)),
                needs_password: false,
                encrypted: false,
            })
        }
        SaveKind::Es3Json { text, password: _, was_encrypted } => {
            let value = parse_json_value(&text)?;
            Ok(UnitySaveReadResult {
                tree: Some(json_to_tree(&value)),
                needs_password: false,
                encrypted: was_encrypted,
            })
        }
        SaveKind::EncryptedEs3NeedsPassword => Ok(UnitySaveReadResult {
            tree: None,
            needs_password: true,
            encrypted: true,
        }),
        SaveKind::XorJson { text, .. } => {
            let value = parse_json_value(&text)?;
            Ok(UnitySaveReadResult {
                tree: Some(json_to_tree(&value)),
                needs_password: false,
                encrypted: true,
            })
        }
        SaveKind::XorNeedsPassword => Ok(UnitySaveReadResult {
            tree: None,
            needs_password: true,
            encrypted: true,
        }),
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

    let value = match classify_save(install, &live, &bytes, password)? {
        SaveKind::PlainJson(text) => {
            let mut value = parse_json_value(&text)?;
            apply_patches_json(&mut value, patches)?;
            write_json_file_atomic(&live, &value)?;
            value
        }
        SaveKind::Es3Json {
            text,
            password: pw,
            was_encrypted,
        } => {
            let mut value = parse_json_value(&text)?;
            apply_patches_json(&mut value, patches)?;
            let json = if text.contains('\n') {
                serde_json::to_string_pretty(&value)
            } else {
                serde_json::to_string(&value)
            }
            .map_err(|e| {
                AppError::Io(format!(
                    "failed to serialize unity save {}: {e}",
                    live.display()
                ))
            })?;
            if was_encrypted {
                let enc = encrypt_es3(&json, &pw)?;
                write_bytes_atomic(&live, &enc)?;
            } else {
                write_bytes_atomic(&live, json.as_bytes())?;
            }
            value
        }
        SaveKind::EncryptedEs3NeedsPassword => {
            return Err(AppError::keyed(BAD_PASSWORD));
        }
        SaveKind::XorJson { text, key } => {
            let mut value = parse_json_value(&text)?;
            apply_patches_json(&mut value, patches)?;
            let json = if text.contains('\n') {
                serde_json::to_string_pretty(&value)
            } else {
                serde_json::to_string(&value)
            }
            .map_err(|e| {
                AppError::Io(format!(
                    "failed to serialize unity save {}: {e}",
                    live.display()
                ))
            })?;
            let enc = xor_encrypt_json(&json, &key)?;
            write_bytes_atomic(&live, &enc)?;
            value
        }
        SaveKind::XorNeedsPassword => {
            return Err(AppError::keyed(BAD_PASSWORD));
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
    /// ES3 JSON (plaintext or decrypted). `password` is used to re-encrypt when `was_encrypted`.
    Es3Json {
        text: String,
        password: String,
        was_encrypted: bool,
    },
    EncryptedEs3NeedsPassword,
    /// XOR-cycled JSON; `key` is the key that successfully decrypted.
    XorJson { text: String, key: Vec<u8> },
    XorNeedsPassword,
}

fn classify_save(
    install: &Path,
    path: &Path,
    bytes: &[u8],
    password: Option<&str>,
) -> Result<SaveKind, AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Plain UTF-8 JSON?
    if let Ok(text) = std::str::from_utf8(bytes) {
        if parse_json_value(text).is_ok() {
            if ext == "es3" {
                return Ok(SaveKind::Es3Json {
                    text: text.to_string(),
                    password: String::new(),
                    was_encrypted: false,
                });
            }
            return Ok(SaveKind::PlainJson(text.to_string()));
        }
    }

    // Easy Save 3 AES (extension .es3 or AES-sized blob).
    let es3_candidate = ext == "es3" || looks_like_es3_blob(bytes);
    if es3_candidate {
        match try_decrypt_es3_with_candidates(install, bytes, password) {
            Ok((text, pw)) => {
                return Ok(SaveKind::Es3Json {
                    text,
                    password: pw,
                    was_encrypted: true,
                });
            }
            Err(Es3UnlockErr::BadPassword) => {
                return Err(AppError::keyed(BAD_PASSWORD));
            }
            Err(Es3UnlockErr::NeedsPassword) => {
                // Fall through to XOR before giving up — some games share shapes.
            }
        }
    }

    // Custom repeating-XOR JSON (e.g. Lyla / hard-coded SecretKey in Assembly-CSharp).
    let key_bufs = collect_xor_key_candidates(install, password);
    let key_refs: Vec<&[u8]> = key_bufs.iter().map(|k| k.as_slice()).collect();
    if let Some((text, key)) = decrypt_xor_json_with_keys(bytes, key_refs) {
        return Ok(SaveKind::XorJson { text, key });
    }

    if es3_candidate {
        if password.is_some() {
            return Err(AppError::keyed(BAD_PASSWORD));
        }
        return Ok(SaveKind::EncryptedEs3NeedsPassword);
    }

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if files::name_suggests_save(name) || password.is_some() {
        if password.is_some() {
            return Err(AppError::keyed(BAD_PASSWORD));
        }
        return Ok(SaveKind::XorNeedsPassword);
    }

    Err(AppError::keyed("error.saveEditor.parse"))
}

fn looks_like_es3_blob(bytes: &[u8]) -> bool {
    bytes.len() >= 32 && bytes.len() % 16 == 0
}

enum Es3UnlockErr {
    NeedsPassword,
    BadPassword,
}

fn try_decrypt_es3_with_candidates(
    install: &Path,
    bytes: &[u8],
    password: Option<&str>,
) -> Result<(String, String), Es3UnlockErr> {
    let mut tried_user = false;
    if let Some(pw) = password {
        tried_user = true;
        if let Ok(text) = decrypt_es3(bytes, pw) {
            if parse_json_value(&text).is_ok() {
                return Ok((text, pw.to_string()));
            }
        }
    }
    if let Some(pw) = extract_es3_password_from_install(install) {
        if let Ok(text) = decrypt_es3(bytes, &pw) {
            if parse_json_value(&text).is_ok() {
                return Ok((text, pw));
            }
        }
    }
    // Empty password is a common ES3 default.
    if let Ok(text) = decrypt_es3(bytes, "") {
        if parse_json_value(&text).is_ok() {
            return Ok((text, String::new()));
        }
    }
    if tried_user {
        Err(Es3UnlockErr::BadPassword)
    } else {
        Err(Es3UnlockErr::NeedsPassword)
    }
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

    #[test]
    fn xor_json_auto_unlocks_via_assembly_secret_key() {
        use crate::save_editor::unity::xor_json::xor_encrypt_json;

        let root = tempfile_root("xor-auto");
        let install = unity_install(&root);
        let managed = install.join("Widget_Data").join("Managed");
        fs::create_dir_all(&managed).unwrap();

        // Minimal UTF-16LE blob containing the secret (as in Assembly-CSharp.dll).
        let mut dll = vec![0u8; 8];
        for c in b"LylaSecretKey2025" {
            dll.push(*c);
            dll.push(0);
        }
        dll.extend_from_slice(&[0, 0, 0, 0]);
        fs::write(managed.join("Assembly-CSharp.dll"), &dll).unwrap();

        let json = "{\n    \"gold\": 50\n}";
        let enc = xor_encrypt_json(json, b"LylaSecretKey2025").unwrap();
        fs::write(install.join("Save").join("save_1.json"), &enc).unwrap();

        let slot = "install:Save/save_1.json";
        let unlocked = read(&install, &meta(), slot, None).unwrap();
        assert!(unlocked.encrypted);
        assert!(!unlocked.needs_password);
        assert_eq!(
            find(unlocked.tree.as_ref().unwrap(), "gold")
                .unwrap()
                .value,
            Some(serde_json::json!(50))
        );

        let backups = root.join("save_backups");
        let tree = write(
            &backups,
            "thread1",
            &install,
            &meta(),
            slot,
            &[RenpySavePatch {
                path: "gold".into(),
                value: serde_json::json!(123),
            }],
            None,
        )
        .unwrap();
        assert_eq!(
            find(&tree, "gold").unwrap().value,
            Some(serde_json::json!(123))
        );

        let on_disk = fs::read(install.join("Save").join("save_1.json")).unwrap();
        assert!(!on_disk.starts_with(b"{"));
        let again = read(&install, &meta(), slot, None).unwrap();
        assert_eq!(
            find(again.tree.as_ref().unwrap(), "gold")
                .unwrap()
                .value,
            Some(serde_json::json!(123))
        );
    }

    #[test]
    fn es3_auto_unlocks_via_defaults_password_in_resources() {
        let root = tempfile_root("es3-defaults");
        let install = unity_install(&root);
        let data = install.join("Widget_Data");
        let mut assets = Vec::new();
        assets.extend_from_slice(b"pad");
        assets.extend_from_slice(b"ES3Defaults");
        assets.push(0);
        assets.extend_from_slice(b"SaveFile.es3");
        assets.push(0);
        assets.extend_from_slice(b"Fj13952099464");
        assets.push(0);
        assets.extend_from_slice(b"DOTweenPro.Scripts");
        fs::write(data.join("resources.assets"), &assets).unwrap();

        let password = "Fj13952099464";
        let enc = encrypt_es3(r#"{"save_data":{"gold":7}}"#, password).unwrap();
        fs::write(install.join("Save").join("Save0"), &enc).unwrap();

        let slot = "install:Save/Save0";
        let unlocked = read(&install, &meta(), slot, None).unwrap();
        assert!(unlocked.encrypted);
        assert!(!unlocked.needs_password);
        let gold = find(unlocked.tree.as_ref().unwrap(), "save_data.gold")
            .or_else(|| find(unlocked.tree.as_ref().unwrap(), "gold"));
        assert_eq!(gold.and_then(|n| n.value.clone()), Some(serde_json::json!(7)));
    }
}
