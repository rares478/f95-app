//! RPG Maker JSON ↔ `RenpyVarNode` tree and primitive path patches.

use crate::error::AppError;
use crate::save_editor::json_tree::{apply_patches_json, json_to_tree};
use crate::save_editor::rpgm::codec::{compress_rpgsave, decompress_rpgsave};
use crate::save_editor::rpgm::labels::{
    decorate_inventory_names, decorate_system_names, load_inventory_names, load_system_names,
};
use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Read a `.rpgsave` file (LZ-String base64) into a variable tree.
/// When `data_dir` is set, decorate inventory node display names from DB JSON.
pub fn read_rpgsave_file(path: &Path, data_dir: Option<&Path>) -> Result<RenpyVarNode, AppError> {
    let raw = fs::read_to_string(path).map_err(|e| {
        AppError::Io(format!(
            "failed to read rpgsave {}: {e}",
            path.display()
        ))
    })?;
    let json_text = decompress_rpgsave(&raw)?;
    let value: Value = serde_json::from_str(&json_text)
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    let mut tree = json_to_tree(&value);
    if let Some(dir) = data_dir {
        let names = load_inventory_names(dir);
        decorate_inventory_names(&mut tree, &names);
        let system = load_system_names(dir);
        decorate_system_names(&mut tree, &system);
    }
    Ok(tree)
}

/// Patch a `.rpgsave` on disk and return the updated tree.
pub fn write_rpgsave_patches(
    path: &Path,
    patches: &[RenpySavePatch],
) -> Result<RenpyVarNode, AppError> {
    let raw = fs::read_to_string(path).map_err(|e| {
        AppError::Io(format!(
            "failed to read rpgsave {}: {e}",
            path.display()
        ))
    })?;
    let json_text = decompress_rpgsave(&raw)?;
    let mut value: Value = serde_json::from_str(&json_text)
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    apply_patches_json(&mut value, patches)?;
    let out = value.to_string();
    let compressed = compress_rpgsave(&out)?;
    write_rpgsave_atomic(path, compressed.as_bytes())?;
    Ok(json_to_tree(&value))
}

fn write_rpgsave_atomic(save_path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let new_path = temp_new_path(save_path);
    fs::write(&new_path, bytes).map_err(|e| {
        AppError::Io(format!(
            "failed to create temp save {}: {e}",
            new_path.display()
        ))
    })?;
    if save_path.exists() {
        fs::remove_file(save_path).map_err(|e| {
            AppError::Io(format!(
                "failed to replace save {}: {e}",
                save_path.display()
            ))
        })?;
    }
    fs::rename(&new_path, save_path).map_err(|e| {
        recover_after_failed_rename(&new_path, save_path, e)
    })?;
    Ok(())
}

fn recover_after_failed_rename(
    new_path: &Path,
    save_path: &Path,
    rename_err: std::io::Error,
) -> AppError {
    match fs::copy(new_path, save_path) {
        Ok(_) => AppError::Io(format!(
            "failed to rename {} -> {}: {rename_err}; restored {} by copying from recovery file {}",
            new_path.display(),
            save_path.display(),
            save_path.display(),
            new_path.display()
        )),
        Err(copy_err) => AppError::Io(format!(
            "failed to rename {} -> {}: {rename_err}; recovery file kept at {} (copy restore failed: {copy_err})",
            new_path.display(),
            save_path.display(),
            new_path.display()
        )),
    }
}

fn temp_new_path(save_path: &Path) -> PathBuf {
    let mut os = save_path.as_os_str().to_owned();
    os.push(".new");
    PathBuf::from(os)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::rpgm::codec::compress_rpgsave;
    use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn find<'a>(tree: &'a RenpyVarNode, path: &str) -> Option<&'a RenpyVarNode> {
        if tree.path == path {
            return Some(tree);
        }
        tree.children
            .as_ref()?
            .iter()
            .find_map(|child| find(child, path))
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let unique = format!(
            "f95-rpgm-tree-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            name
        );
        let path = std::env::temp_dir().join(unique);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn tree_marks_gold_editable() {
        let v: serde_json::Value = serde_json::json!({"party":{"_gold":50,"_items":{"1":3}}});
        let tree = json_to_tree(&v);
        let gold = find(&tree, "party._gold").unwrap();
        assert_eq!(gold.type_, "int");
        assert!(gold.editable);
        assert_eq!(gold.value, Some(serde_json::json!(50)));
    }

    #[test]
    fn patch_gold_round_trip_bytes() {
        let json = r#"{"party":{"_gold":50}}"#;
        let compressed = compress_rpgsave(json).unwrap();
        let path = temp_file("t.rpgsave", compressed.as_bytes());
        write_rpgsave_patches(
            &path,
            &[RenpySavePatch {
                path: "party._gold".into(),
                value: serde_json::json!(999),
            }],
        )
        .unwrap();
        let tree = read_rpgsave_file(&path, None).unwrap();
        assert_eq!(
            find(&tree, "party._gold").unwrap().value,
            Some(serde_json::json!(999))
        );
        let _ = fs::remove_file(&path);
    }

    /// Optional real-world smoke: skip when `tests/fixtures/natsuki-file1.rpgsave` is absent.
    #[test]
    fn natsuki_fixture_if_present() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("natsuki-file1.rpgsave");
        if !fixture.is_file() {
            eprintln!(
                "skip: natsuki fixture absent at {}",
                fixture.display()
            );
            return;
        }

        let raw = fs::read_to_string(&fixture).unwrap();
        let json_text = decompress_rpgsave(&raw).expect("fixture must decompress");
        let value: serde_json::Value =
            serde_json::from_str(&json_text).expect("fixture must be JSON");
        assert!(
            value.get("party").is_some(),
            "fixture JSON must contain party key"
        );
        assert!(
            value.pointer("/party/_gold").is_some(),
            "fixture must expose party._gold for patch smoke"
        );

        // Mutate a temp copy so the committed fixture stays pristine.
        let work = temp_file("natsuki-smoke.rpgsave", raw.as_bytes());
        write_rpgsave_patches(
            &work,
            &[RenpySavePatch {
                path: "party._gold".into(),
                value: serde_json::json!(424242),
            }],
        )
        .unwrap();
        let tree = read_rpgsave_file(&work, None).unwrap();
        assert_eq!(
            find(&tree, "party._gold").unwrap().value,
            Some(serde_json::json!(424242))
        );
        // JsonEx actor path must be patchable.
        write_rpgsave_patches(
            &work,
            &[RenpySavePatch {
                path: "actors._data.@a[1]._hp".into(),
                value: serde_json::json!(999),
            }],
        )
        .unwrap();
        let tree = read_rpgsave_file(&work, None).unwrap();
        assert_eq!(
            find(&tree, "actors._data.@a[1]._hp").unwrap().value,
            Some(serde_json::json!(999))
        );
        let _ = fs::remove_file(&work);
    }
}
