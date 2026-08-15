//! Convert Ren'Py `log` pickle bytes into a variable tree and apply primitive patches.

use crate::error::AppError;
use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
use crate::save_editor::zip_save::{read_log_bytes, write_log_bytes};
use serde_json::json;
use serde_pickle::{value_from_slice, value_to_vec, DeOptions, HashableValue, SerOptions, Value};
use std::path::Path;

/// Parse `log` pickle bytes into a `RenpyVarNode` tree rooted at the save's roots dict.
pub fn log_to_tree(log: &[u8]) -> Result<RenpyVarNode, AppError> {
    let value = value_from_slice(log, DeOptions::new())
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    let roots = roots_ref(&value);
    Ok(value_to_node(roots, "", "roots"))
}

/// Apply primitive patches to `log` pickle bytes. No cross-type coercion.
pub fn apply_patches(log: &[u8], patches: &[RenpySavePatch]) -> Result<Vec<u8>, AppError> {
    let mut value = value_from_slice(log, DeOptions::new())
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;

    for patch in patches {
        let roots = roots_mut(&mut value);
        let leaf = navigate_mut(roots, &patch.path)?;
        set_primitive(leaf, &patch.value)?;
    }

    value_to_vec(&value, SerOptions::new()).map_err(|_| AppError::keyed("error.saveEditor.parse"))
}

/// Read a save zip's `log` and return its variable tree.
pub fn read_save_tree(path: &Path) -> Result<RenpyVarNode, AppError> {
    log_to_tree(&read_log_bytes(path)?)
}

/// Apply patches to a save zip's `log` and return the updated tree.
pub fn write_save_patches(path: &Path, patches: &[RenpySavePatch]) -> Result<RenpyVarNode, AppError> {
    let new_log = apply_patches(&read_log_bytes(path)?, patches)?;
    write_log_bytes(path, &new_log)?;
    log_to_tree(&new_log)
}

fn roots_ref(value: &Value) -> &Value {
    match value {
        Value::Tuple(items) if !items.is_empty() => &items[0],
        other => other,
    }
}

fn roots_mut(value: &mut Value) -> &mut Value {
    let use_tuple0 = matches!(value, Value::Tuple(items) if !items.is_empty());
    if use_tuple0 {
        let Value::Tuple(items) = value else {
            unreachable!("checked nonempty tuple");
        };
        &mut items[0]
    } else {
        value
    }
}

fn value_to_node(value: &Value, path: &str, name: &str) -> RenpyVarNode {
    match value {
        Value::Dict(map) => {
            let mut children: Vec<RenpyVarNode> = map
                .iter()
                .map(|(key, child)| {
                    let child_name = hashable_key_name(key);
                    let child_path = join_path(path, &child_name);
                    value_to_node(child, &child_path, &child_name)
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
        Value::List(items) => {
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
        Value::I64(i) => leaf(path, name, "int", Some(json!(*i)), true),
        Value::Int(bi) => match bi.to_string().parse::<i64>() {
            Ok(i) => leaf(path, name, "int", Some(json!(i)), true),
            Err(_) => leaf(path, name, "opaque", None, false),
        },
        Value::F64(f) => leaf(path, name, "float", Some(json!(*f)), true),
        Value::Bool(b) => leaf(path, name, "bool", Some(json!(*b)), true),
        Value::String(s) => leaf(path, name, "string", Some(json!(s)), true),
        Value::Bytes(b) => match std::str::from_utf8(b) {
            Ok(s) => leaf(path, name, "string", Some(json!(s)), true),
            Err(_) => leaf(path, name, "opaque", None, false),
        },
        Value::None => leaf(path, name, "opaque", None, false),
        Value::Tuple(_) | Value::Set(_) | Value::FrozenSet(_) => {
            leaf(path, name, "opaque", None, false)
        }
    }
}

fn leaf(
    path: &str,
    name: &str,
    type_: &str,
    value: Option<serde_json::Value>,
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

fn join_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}.{name}")
    }
}

fn hashable_key_name(key: &HashableValue) -> String {
    match key {
        HashableValue::String(s) => s.clone(),
        HashableValue::I64(i) => i.to_string(),
        HashableValue::Bool(b) => b.to_string(),
        HashableValue::None => "None".into(),
        HashableValue::Int(bi) => bi.to_string(),
        HashableValue::F64(f) => f.to_string(),
        HashableValue::Bytes(b) => String::from_utf8_lossy(b).into_owned(),
        HashableValue::Tuple(_) | HashableValue::FrozenSet(_) => format!("{key}"),
    }
}

#[derive(Debug)]
struct PathSegment {
    key: String,
    indices: Vec<usize>,
}

fn parse_path(path: &str) -> Result<Vec<PathSegment>, AppError> {
    if path.is_empty() {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    }

    let mut segments = Vec::new();
    for part in path.split('.') {
        let mut key = String::new();
        let mut indices = Vec::new();
        let mut chars = part.chars().peekable();

        while let Some(c) = chars.next() {
            if c == '[' {
                let mut num = String::new();
                loop {
                    match chars.next() {
                        Some(']') => break,
                        Some(d) if d.is_ascii_digit() => num.push(d),
                        _ => return Err(AppError::keyed("error.saveEditor.patchMissing")),
                    }
                }
                if num.is_empty() {
                    return Err(AppError::keyed("error.saveEditor.patchMissing"));
                }
                let idx: usize = num
                    .parse()
                    .map_err(|_| AppError::keyed("error.saveEditor.patchMissing"))?;
                indices.push(idx);
            } else {
                key.push(c);
            }
        }

        if key.is_empty() && indices.is_empty() {
            return Err(AppError::keyed("error.saveEditor.patchMissing"));
        }
        segments.push(PathSegment { key, indices });
    }
    Ok(segments)
}

fn navigate_mut<'a>(roots: &'a mut Value, path: &str) -> Result<&'a mut Value, AppError> {
    let segments = parse_path(path)?;
    let mut cur = roots;

    for seg in segments {
        if !seg.key.is_empty() {
            cur = dict_get_mut(cur, &seg.key)?;
        }
        for idx in seg.indices {
            cur = list_get_mut(cur, idx)?;
        }
    }
    Ok(cur)
}

fn dict_get_mut<'a>(value: &'a mut Value, key: &str) -> Result<&'a mut Value, AppError> {
    let Value::Dict(map) = value else {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    };
    let hv = HashableValue::String(key.to_string());
    map.get_mut(&hv)
        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))
}

fn list_get_mut<'a>(value: &'a mut Value, idx: usize) -> Result<&'a mut Value, AppError> {
    let Value::List(items) = value else {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    };
    items
        .get_mut(idx)
        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))
}

fn set_primitive(leaf: &mut Value, patch: &serde_json::Value) -> Result<(), AppError> {
    match leaf {
        Value::I64(_) | Value::Int(_) => {
            let Some(i) = json_as_i64(patch) else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::I64(i);
            Ok(())
        }
        Value::F64(_) => {
            let Some(f) = patch.as_f64() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::F64(f);
            Ok(())
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
        Value::Bytes(_) => {
            let Some(s) = patch.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::Bytes(s.as_bytes().to_vec());
            Ok(())
        }
        _ => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

fn json_as_i64(v: &serde_json::Value) -> Option<i64> {
    match v {
        serde_json::Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serde_pickle::{value_to_vec, HashableValue, SerOptions, Value};
    use std::collections::BTreeMap;

    fn sample_log() -> Vec<u8> {
        let mut store = BTreeMap::new();
        store.insert(HashableValue::String("money".into()), Value::I64(100));
        store.insert(
            HashableValue::String("name".into()),
            Value::String("Ada".into()),
        );
        store.insert(HashableValue::String("on".into()), Value::Bool(true));
        store.insert(HashableValue::String("rate".into()), Value::F64(1.5));
        store.insert(
            HashableValue::String("inv".into()),
            Value::List(vec![Value::I64(7), Value::I64(8)]),
        );

        let mut roots = BTreeMap::new();
        roots.insert(HashableValue::String("store".into()), Value::Dict(store));

        let roots_tuple = Value::Tuple(vec![Value::Dict(roots), Value::None]);
        value_to_vec(&roots_tuple, SerOptions::new()).unwrap()
    }

    fn find_path<'a>(tree: &'a RenpyVarNode, path: &str) -> Option<&'a RenpyVarNode> {
        if tree.path == path {
            return Some(tree);
        }
        tree.children
            .as_ref()?
            .iter()
            .find_map(|child| find_path(child, path))
    }

    #[test]
    fn tree_marks_primitives_editable() {
        let tree = log_to_tree(&sample_log()).unwrap();
        let money = find_path(&tree, "store.money").unwrap();
        assert!(money.editable);
        assert_eq!(money.type_, "int");
    }

    #[test]
    fn string_leaf_reports_type_string() {
        let tree = log_to_tree(&sample_log()).unwrap();
        let name = find_path(&tree, "store.name").unwrap();
        assert_eq!(name.type_, "string");
        assert!(name.editable);
        assert_eq!(name.value, Some(json!("Ada")));
    }

    #[test]
    fn list_index_path_round_trips() {
        let patched = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.inv[0]".into(),
                value: json!(42),
            }],
        )
        .unwrap();
        let tree = log_to_tree(&patched).unwrap();
        let item = find_path(&tree, "store.inv[0]").unwrap();
        assert_eq!(item.type_, "int");
        assert_eq!(item.value, Some(json!(42)));
    }

    #[test]
    fn apply_int_patch_round_trips() {
        let patched = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.money".into(),
                value: json!(999),
            }],
        )
        .unwrap();
        let tree = log_to_tree(&patched).unwrap();
        assert_eq!(find_path(&tree, "store.money").unwrap().value, Some(json!(999)));
    }

    #[test]
    fn reject_type_change_int_to_bool() {
        let err = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.money".into(),
                value: json!(false),
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.patchType"));
    }

    #[test]
    fn reject_missing_path() {
        let err = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.nope".into(),
                value: json!(1),
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.patchMissing"));
    }
}
