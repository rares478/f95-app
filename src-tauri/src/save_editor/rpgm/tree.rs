//! RPG Maker JSON ↔ `RenpyVarNode` tree and primitive path patches.

use crate::error::AppError;
use crate::save_editor::pickle_tree::parse_path_segments;
use crate::save_editor::rpgm::codec::{compress_rpgsave, decompress_rpgsave};
use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Convert a JSON value into a `RenpyVarNode` tree (root path empty, name `"root"`).
pub fn json_to_tree(value: &Value) -> RenpyVarNode {
    value_to_node(value, "", "root")
}

/// Apply primitive patches in-place. No key add/delete; same type family only.
pub fn apply_patches_json(root: &mut Value, patches: &[RenpySavePatch]) -> Result<(), AppError> {
    for patch in patches {
        let leaf = navigate_mut(root, &patch.path)?;
        set_primitive(leaf, &patch.value)?;
    }
    Ok(())
}

/// Read a `.rpgsave` file (LZ-String base64) into a variable tree.
pub fn read_rpgsave_file(path: &Path) -> Result<RenpyVarNode, AppError> {
    let raw = fs::read_to_string(path).map_err(|e| {
        AppError::Io(format!(
            "failed to read rpgsave {}: {e}",
            path.display()
        ))
    })?;
    let json_text = decompress_rpgsave(&raw)?;
    let value: Value = serde_json::from_str(&json_text)
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    Ok(json_to_tree(&value))
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

fn value_to_node(value: &Value, path: &str, name: &str) -> RenpyVarNode {
    match value {
        Value::Object(map) => {
            let mut children: Vec<RenpyVarNode> = map
                .iter()
                .map(|(key, child)| {
                    let child_path = join_path(path, key);
                    value_to_node(child, &child_path, key)
                })
                .collect();
            children.sort_by(|a, b| a.name.cmp(&b.name));
            RenpyVarNode {
                path: path.to_string(),
                name: name.to_string(),
                type_: "dict".into(),
                value: None,
                editable: false,
                children: Some(children),
            }
        }
        Value::Array(items) => {
            let children: Vec<RenpyVarNode> = items
                .iter()
                .enumerate()
                .map(|(i, child)| {
                    let child_path = format!("{path}[{i}]");
                    value_to_node(child, &child_path, &i.to_string())
                })
                .collect();
            RenpyVarNode {
                path: path.to_string(),
                name: name.to_string(),
                type_: "list".into(),
                value: None,
                editable: false,
                children: Some(children),
            }
        }
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                leaf(path, name, "int", Some(value.clone()), true)
            } else {
                leaf(path, name, "float", Some(value.clone()), true)
            }
        }
        Value::Bool(b) => leaf(path, name, "bool", Some(Value::Bool(*b)), true),
        Value::String(s) => leaf(path, name, "string", Some(Value::String(s.clone())), true),
        Value::Null => leaf(path, name, "null", Some(Value::Null), false),
    }
}

fn leaf(
    path: &str,
    name: &str,
    type_: &str,
    value: Option<Value>,
    editable: bool,
) -> RenpyVarNode {
    RenpyVarNode {
        path: path.to_string(),
        name: name.to_string(),
        type_: type_.into(),
        value,
        editable,
        children: None,
    }
}

fn escape_path_segment(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            '\\' | '.' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

fn join_path(parent: &str, name: &str) -> String {
    let seg = escape_path_segment(name);
    if parent.is_empty() {
        seg
    } else {
        format!("{parent}.{seg}")
    }
}

fn navigate_mut<'a>(root: &'a mut Value, path: &str) -> Result<&'a mut Value, AppError> {
    let segments = parse_path_segments(path)?;
    let mut cur = root;

    for seg in segments {
        if !seg.key.is_empty() {
            cur = object_get_mut(cur, &seg.key)?;
        }
        for idx in seg.indices {
            cur = array_get_mut(cur, idx)?;
        }
    }
    Ok(cur)
}

fn object_get_mut<'a>(value: &'a mut Value, key: &str) -> Result<&'a mut Value, AppError> {
    let Value::Object(map) = value else {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    };
    map.get_mut(key)
        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))
}

fn array_get_mut<'a>(value: &'a mut Value, idx: usize) -> Result<&'a mut Value, AppError> {
    let Value::Array(items) = value else {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    };
    items
        .get_mut(idx)
        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))
}

/// Same type family only: int (no fractional part), float, bool, string, null.
fn set_primitive(leaf: &mut Value, patch: &Value) -> Result<(), AppError> {
    match leaf {
        Value::Number(existing) => {
            if existing.is_i64() || existing.is_u64() {
                let Some(n) = json_as_integer(patch) else {
                    return Err(AppError::keyed("error.saveEditor.patchType"));
                };
                *leaf = Value::Number(n);
                Ok(())
            } else {
                let Some(f) = patch.as_f64() else {
                    return Err(AppError::keyed("error.saveEditor.patchType"));
                };
                *leaf = Value::Number(
                    serde_json::Number::from_f64(f)
                        .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?,
                );
                Ok(())
            }
        }
        Value::Bool(_) => {
            let Some(b) = patch.as_bool() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::Bool(b);
            Ok(())
        }
        Value::String(_) => {
            let Some(s) = patch.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::String(s.to_string());
            Ok(())
        }
        Value::Null => {
            if !patch.is_null() {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            *leaf = Value::Null;
            Ok(())
        }
        Value::Object(_) | Value::Array(_) => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

fn json_as_integer(v: &Value) -> Option<serde_json::Number> {
    match v {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                return Some(i.into());
            }
            if let Some(u) = n.as_u64() {
                return Some(u.into());
            }
            // Prefer integers: reject fractional floats for int leaves.
            let f = n.as_f64()?;
            if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
                return Some((f as i64).into());
            }
            None
        }
        _ => None,
    }
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
        let tree = read_rpgsave_file(&path).unwrap();
        assert_eq!(
            find(&tree, "party._gold").unwrap().value,
            Some(serde_json::json!(999))
        );
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn reject_type_change() {
        let mut v = serde_json::json!({"party":{"_gold":50}});
        let err = apply_patches_json(
            &mut v,
            &[RenpySavePatch {
                path: "party._gold".into(),
                value: serde_json::json!(true),
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.patchType"));
    }
}
