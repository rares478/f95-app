//! Convert Ren'Py `log` pickle bytes into a variable tree and apply primitive patches.

use crate::error::AppError;
use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
use crate::save_editor::zip_save::{read_log_bytes, write_log_bytes};
use serde_json::json;
use serde_pickle::{value_from_slice, value_to_vec, DeOptions, HashableValue, SerOptions, Value};
use std::path::Path;

fn de_options() -> DeOptions {
    // Real Ren'Py saves reference custom classes (store.* game objects). Replace those
    // with None/opaque stand-ins. RevertableList/Set are handled inside our patched
    // serde-pickle (NEWOBJ → list/set so APPEND works).
    DeOptions::new()
        .replace_unresolved_globals()
        .replace_recursive_structures()
}

/// Parse `log` pickle bytes into a `RenpyVarNode` tree rooted at the save's roots dict.
pub fn log_to_tree(log: &[u8]) -> Result<RenpyVarNode, AppError> {
    let value = value_from_slice(log, de_options())
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    let roots = roots_ref(&value);
    Ok(value_to_node(roots, "", "roots"))
}

/// Apply primitive patches to `log` pickle bytes. No cross-type coercion.
///
/// Validates types against a decoded tree, then surgically splices new encodings
/// into the original pickle so Ren'Py class instances and protocol stay intact.
pub fn apply_patches(log: &[u8], patches: &[RenpySavePatch]) -> Result<Vec<u8>, AppError> {
    let mut value = value_from_slice(log, de_options())
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;

    let mut pending: Vec<(String, serde_json::Value)> = Vec::with_capacity(patches.len());
    for patch in patches {
        let roots = roots_mut(&mut value);
        let leaf = navigate_mut(roots, &patch.path)?;
        set_primitive(leaf, &patch.value)?;
        pending.push((patch.path.clone(), patch.value.clone()));
    }

    crate::save_editor::pickle_splice::splice_primitives(log, &pending)
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
                    let key_name = hashable_key_name(key);
                    let child_path = join_path(path, &key_name);
                    // Ren'Py often stores flat keys like "store.money" — keep the full key
                    // in `path` for patching, but show a shorter label in the tree.
                    let display = display_var_name(&key_name);
                    value_to_node(child, &child_path, &display)
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

fn display_var_name(key: &str) -> String {
    key.strip_prefix("store.")
        .unwrap_or(key)
        .to_string()
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
pub(crate) struct PathSegment {
    pub key: String,
    pub indices: Vec<usize>,
}

pub(crate) fn parse_path_segments(path: &str) -> Result<Vec<PathSegment>, AppError> {
    parse_path(path)
}

fn parse_path(path: &str) -> Result<Vec<PathSegment>, AppError> {
    if path.is_empty() {
        return Err(AppError::keyed("error.saveEditor.patchMissing"));
    }

    // Split on `.` but treat `\.` as a literal dot inside a key (flat Ren'Py store keys).
    let mut raw_parts: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut chars = path.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(next) => buf.push(next),
                None => return Err(AppError::keyed("error.saveEditor.patchMissing")),
            }
        } else if c == '.' {
            raw_parts.push(std::mem::take(&mut buf));
        } else {
            buf.push(c);
        }
    }
    raw_parts.push(buf);

    let mut segments = Vec::new();
    for part in raw_parts {
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

    // Ren'Py / pickle often store attribute names as UNICODE → Bytes, while flat
    // store keys may be String. Tree paths always use the display string form.
    let string_key = HashableValue::String(key.to_string());
    if map.contains_key(&string_key) {
        return map
            .get_mut(&string_key)
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"));
    }

    let bytes_key = HashableValue::Bytes(key.as_bytes().to_vec());
    if map.contains_key(&bytes_key) {
        return map
            .get_mut(&bytes_key)
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"));
    }

    // Numeric / bool / other keys: match the same display name the tree uses.
    let matched = map
        .keys()
        .find(|k| hashable_key_name(k) == key)
        .cloned();
    if let Some(k) = matched {
        return map
            .get_mut(&k)
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"));
    }

    Err(AppError::keyed("error.saveEditor.patchMissing"))
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
        Value::I64(_) => {
            let Some(i) = json_as_i64(patch) else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            *leaf = Value::I64(i);
            Ok(())
        }
        Value::Int(bi) => {
            // Match tree policy: Int is editable only when it fits i64.
            if bi.to_string().parse::<i64>().is_err() {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
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
        Value::Bytes(b) => {
            // Match tree policy: Bytes are editable only when valid UTF-8.
            if std::str::from_utf8(b).is_err() {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
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

    /// Build a `Value::Int` larger than i64 via pickle LONG1 round-trip (no num-bigint dep).
    fn opaque_big_int() -> Value {
        // PROTO 2 + LONG1(9 bytes) encoding 2^64 + STOP
        let mut pickle = vec![0x80, 0x02, 0x8a, 0x09];
        pickle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 1]);
        pickle.push(0x2e);
        let v = value_from_slice(&pickle, DeOptions::new()).unwrap();
        assert!(
            matches!(&v, Value::Int(bi) if bi.to_string().parse::<i64>().is_err()),
            "expected opaque BigInt, got {v:?}"
        );
        v
    }

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
        store.insert(HashableValue::String("huge".into()), opaque_big_int());
        store.insert(
            HashableValue::String("raw".into()),
            Value::Bytes(vec![0xff, 0xfe, 0xfd]),
        );
        store.insert(
            HashableValue::String("utf8bytes".into()),
            Value::Bytes(b"ok".to_vec()),
        );

        let mut roots = BTreeMap::new();
        roots.insert(HashableValue::String("store".into()), Value::Dict(store));

        let roots_tuple = Value::Tuple(vec![Value::Dict(roots), Value::None]);
        value_to_vec(&roots_tuple, SerOptions::new().proto_v2()).unwrap()
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
    fn patched_log_uses_pickle_protocol_v2() {
        let patched = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.money".into(),
                value: json!(999),
            }],
        )
        .unwrap();
        // PROTO opcode + protocol 2 — required by Ren'Py 7 / Python 2 cPickle.
        assert!(patched.len() >= 2);
        assert_eq!(patched[0], 0x80);
        assert_eq!(patched[1], 0x02);
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

    #[test]
    fn opaque_int_and_bytes_not_editable_in_tree() {
        let tree = log_to_tree(&sample_log()).unwrap();
        let huge = find_path(&tree, "store.huge").unwrap();
        assert!(!huge.editable);
        assert_eq!(huge.type_, "opaque");
        let raw = find_path(&tree, "store.raw").unwrap();
        assert!(!raw.editable);
        assert_eq!(raw.type_, "opaque");
        let utf8 = find_path(&tree, "store.utf8bytes").unwrap();
        assert!(utf8.editable);
        assert_eq!(utf8.type_, "string");
    }

    #[test]
    fn reject_patch_on_opaque_int() {
        let err = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.huge".into(),
                value: json!(1),
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.patchType"));
    }

    #[test]
    fn reject_patch_on_opaque_bytes() {
        let err = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.raw".into(),
                value: json!("nope"),
            }],
        )
        .unwrap_err();
        assert!(err.to_string().contains("error.saveEditor.patchType"));
    }

    #[test]
    fn utf8_bytes_still_patchable() {
        let patched = apply_patches(
            &sample_log(),
            &[RenpySavePatch {
                path: "store.utf8bytes".into(),
                value: json!("hi"),
            }],
        )
        .unwrap();
        let tree = log_to_tree(&patched).unwrap();
        let node = find_path(&tree, "store.utf8bytes").unwrap();
        assert_eq!(node.value, Some(json!("hi")));
    }

    /// Minimal PROTO2 pickle: dict with key "items" → RevertableList via NEWOBJ + APPEND.
    fn revertable_list_pickle() -> Vec<u8> {
        // { 'items': RevertableList([42]) }
        let mut p = Vec::new();
        p.extend_from_slice(&[0x80, 0x02]); // PROTO 2
        p.push(b'}'); // EMPTY_DICT
        p.extend_from_slice(&[b'q', 0x00]); // BINPUT 0
        p.push(b'('); // MARK
        p.push(b'X'); // BINUNICODE 'items'
        p.extend_from_slice(&5u32.to_le_bytes());
        p.extend_from_slice(b"items");
        // GLOBAL renpy.python\nRevertableList\n
        p.push(b'c');
        p.extend_from_slice(b"renpy.python\nRevertableList\n");
        p.extend_from_slice(&[b'q', 0x01]);
        p.push(b')'); // EMPTY_TUPLE
        p.push(0x81); // NEWOBJ
        p.extend_from_slice(&[b'q', 0x02]);
        p.push(b'K'); // BININT1 42
        p.push(42);
        p.push(b'a'); // APPEND
        p.push(b'u'); // SETITEMS
        p.push(b'.'); // STOP
        p
    }

    #[test]
    fn parses_renpy_revertable_list_newobj_append() {
        let tree = log_to_tree(&revertable_list_pickle()).unwrap();
        let node = find_path(&tree, "items[0]").unwrap();
        assert_eq!(node.type_, "int");
        assert_eq!(node.value, Some(json!(42)));
    }

    fn optional_fixture(name: &str) -> Option<std::path::PathBuf> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name);
        path.is_file().then_some(path)
    }

    #[test]
    fn parses_holiday_island_save_log_fixture() {
        let Some(path) = optional_fixture("holiday-log.bin") else {
            return;
        };
        let Ok(log) = std::fs::read(&path) else {
            return;
        };
        let tree = log_to_tree(&log).expect("Holiday Island log should parse");
        assert!(
            tree.children.as_ref().map(|c| !c.is_empty()).unwrap_or(false),
            "expected store variables in tree"
        );
        // Known primitive from the save header region (display strips "store." prefix)
        let sports = find_path(&tree, "store\\.talk_sports");
        assert!(sports.is_some(), "expected store.talk_sports");
        assert_eq!(sports.unwrap().name, "talk_sports");
        assert_eq!(sports.unwrap().type_, "bool");
    }

    #[test]
    fn reads_holiday_island_save_zip_if_present() {
        let Some(path) = optional_fixture("1-1-LT1.save") else {
            return;
        };
        let tree = read_save_tree(&path).expect("zip+log parse");
        assert!(find_path(&tree, "store\\.talk_sports").is_some());
    }

    #[test]
    fn parses_multiple_holiday_island_slot_logs_if_present() {
        for name in ["1-1-LT1.log.bin", "1-4-LT1.log.bin", "1-2-LT1.log.bin", "1-3-LT1.log.bin"] {
            let Some(path) = optional_fixture(name) else {
                continue;
            };
            let Ok(log) = std::fs::read(&path) else {
                continue;
            };
            let tree = log_to_tree(&log).unwrap_or_else(|e| panic!("{name}: {e}"));
            let n = tree.children.as_ref().map(|c| c.len()).unwrap_or(0);
            assert!(n > 10, "{name} expected many store vars, got {n}");
        }
    }

    #[test]
    fn flat_store_dotted_key_patches() {
        use serde_pickle::{HashableValue, Value};
        let mut map = std::collections::BTreeMap::new();
        map.insert(
            HashableValue::String("store.day".into()),
            Value::I64(5),
        );
        let log = value_to_vec(&Value::Dict(map), SerOptions::new().proto_v2()).unwrap();
        let tree = log_to_tree(&log).unwrap();
        let day = find_path(&tree, "store\\.day").unwrap();
        assert_eq!(day.name, "day");
        assert_eq!(day.value, Some(json!(5)));
        let patched = apply_patches(
            &log,
            &[RenpySavePatch {
                path: "store\\.day".into(),
                value: json!(9),
            }],
        )
        .unwrap();
        let tree = log_to_tree(&patched).unwrap();
        assert_eq!(
            find_path(&tree, "store\\.day").unwrap().value,
            Some(json!(9))
        );
    }
    #[test]
    fn bytes_dict_keys_are_patchable() {
        // Ren'Py object attrs are SHORT_BINSTRING in the pickle (read back as Bytes).
        // Build a minimal PROTO2 blob that matches that encoding (not codecs/REDUCE).
        let mut p = vec![0x80, 0x02]; // PROTO 2
        p.push(b'}'); // EMPTY_DICT roots
        p.push(b'('); // MARK
        // key store.player
        p.push(b'U');
        p.push(12);
        p.extend_from_slice(b"store.player");
        // value: empty dict + hacking/charm
        p.push(b'}');
        p.push(b'(');
        p.push(b'U');
        p.push(7);
        p.extend_from_slice(b"hacking");
        p.push(b'K');
        p.push(1); // BININT1 1
        p.push(b'U');
        p.push(5);
        p.extend_from_slice(b"charm");
        p.push(b'K');
        p.push(3);
        p.push(b'u'); // SETITEMS player
        p.push(b'u'); // SETITEMS roots
        p.push(b'.'); // STOP

        let tree = log_to_tree(&p).unwrap();
        let hack = find_path(&tree, "store\\.player.hacking").unwrap();
        assert!(hack.editable);
        assert_eq!(hack.value, Some(json!(1)));

        let patched = apply_patches(
            &p,
            &[
                RenpySavePatch {
                    path: "store\\.player.hacking".into(),
                    value: json!(99),
                },
                RenpySavePatch {
                    path: "store\\.player.charm".into(),
                    value: json!(7),
                },
            ],
        )
        .unwrap();
        let tree = log_to_tree(&patched).unwrap();
        assert_eq!(
            find_path(&tree, "store\\.player.hacking").unwrap().value,
            Some(json!(99))
        );
        assert_eq!(
            find_path(&tree, "store\\.player.charm").unwrap().value,
            Some(json!(7))
        );
    }

    #[test]
    fn avelis_money_updates_frame_size_if_present() {
        let Some(path) = optional_fixture("avelis-log.bin") else {
            return;
        };
        let Ok(log) = std::fs::read(&path) else {
            return;
        };
        assert_eq!(log[0], 0x80);
        assert_eq!(log[1], 5);
        assert_eq!(log[2], 0x95); // FRAME
        let frame_before = u64::from_le_bytes(log[3..11].try_into().unwrap());

        let patched = apply_patches(
            &log,
            &[RenpySavePatch {
                path: "store\\.money".into(),
                value: json!(999),
            }],
        )
        .expect("patch 999");
        assert_eq!(patched[0], 0x80);
        assert_eq!(patched[1], 5);
        assert_eq!(patched[2], 0x95);
        let frame_after = u64::from_le_bytes(patched[3..11].try_into().unwrap());
        let delta = patched.len() as i64 - log.len() as i64;
        assert_eq!(
            frame_after as i64 - frame_before as i64,
            delta,
            "FRAME size must track splice length change"
        );
        let tree = log_to_tree(&patched).unwrap();
        assert_eq!(
            find_path(&tree, "store\\.money").unwrap().value,
            Some(json!(999))
        );
    }

    #[test]
    fn fixture_player_hacking_patch_if_present() {
        let Some(path) = optional_fixture("1-4-LT1.log.bin") else {
            return;
        };
        let Ok(log) = std::fs::read(&path) else {
            return;
        };
        let patched = apply_patches(
            &log,
            &[RenpySavePatch {
                path: "store\\.player.hacking".into(),
                value: json!(99),
            }],
        )
        .expect("patch hacking on fixture");
        // Surgical splice: keep protocol 2 and nearly the same size (not a full rewrite).
        assert_eq!(patched[0], 0x80);
        assert_eq!(patched[1], 0x02);
        assert!(
            patched.len().abs_diff(log.len()) < 16,
            "expected near in-place splice, orig={} patched={}",
            log.len(),
            patched.len()
        );
        let tree = log_to_tree(&patched).unwrap();
        assert_eq!(
            find_path(&tree, "store\\.player.hacking").unwrap().value,
            Some(json!(99))
        );
    }
}
