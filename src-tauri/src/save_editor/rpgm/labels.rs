//! Inventory and System.json display names from RPG Maker DB JSON.

use crate::save_editor::types::RenpyVarNode;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct InventoryNames {
    pub items: HashMap<i64, String>,
    pub weapons: HashMap<i64, String>,
    pub armors: HashMap<i64, String>,
}

#[derive(Debug, Clone, Default)]
pub struct SystemNames {
    pub switches: HashMap<i64, String>,
    pub variables: HashMap<i64, String>,
}

/// Load name maps from `Items.json` / `Weapons.json` / `Armors.json`.
/// Missing or corrupt files yield empty maps (never errors).
pub fn load_inventory_names(data_dir: &Path) -> InventoryNames {
    InventoryNames {
        items: load_name_map(data_dir, "Items.json"),
        weapons: load_name_map(data_dir, "Weapons.json"),
        armors: load_name_map(data_dir, "Armors.json"),
    }
}

/// Load switch/variable names from `System.json`.
/// Missing or corrupt files yield empty maps (never errors).
pub fn load_system_names(data_dir: &Path) -> SystemNames {
    let path = data_dir.join("System.json");
    let Ok(bytes) = fs::read(&path) else {
        return SystemNames::default();
    };
    let text = strip_utf8_bom(&bytes);
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return SystemNames::default();
    };
    let Some(obj) = value.as_object() else {
        return SystemNames::default();
    };
    SystemNames {
        switches: load_indexed_string_array(obj.get("switches")),
        variables: load_indexed_string_array(obj.get("variables")),
    }
}

/// Set display `name` on inventory leaf nodes; leave `path` (numeric id) unchanged.
pub fn decorate_inventory_names(tree: &mut RenpyVarNode, names: &InventoryNames) {
    if let Some(label) = display_name_for_path(&tree.path, names) {
        tree.name = label;
    }
    if let Some(children) = tree.children.as_mut() {
        for child in children {
            decorate_inventory_names(child, names);
        }
    }
}

/// Set display `name` on switch/variable leaf nodes; leave `path` unchanged.
pub fn decorate_system_names(tree: &mut RenpyVarNode, names: &SystemNames) {
    if let Some(label) = system_display_name_for_path(&tree.path, names) {
        tree.name = label;
    }
    if let Some(children) = tree.children.as_mut() {
        for child in children {
            decorate_system_names(child, names);
        }
    }
}

fn load_name_map(data_dir: &Path, filename: &str) -> HashMap<i64, String> {
    let path = data_dir.join(filename);
    let Ok(bytes) = fs::read(&path) else {
        return HashMap::new();
    };
    let text = strip_utf8_bom(&bytes);
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return HashMap::new();
    };
    let Value::Array(entries) = value else {
        return HashMap::new();
    };

    let mut map = HashMap::new();
    for entry in entries {
        if entry.is_null() {
            continue;
        }
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let Some(id) = obj.get("id").and_then(json_id) else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        map.insert(id, name.to_string());
    }
    map
}

fn strip_utf8_bom(bytes: &[u8]) -> &str {
    let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    std::str::from_utf8(slice).unwrap_or("")
}

fn json_id(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_u64().map(|u| u as i64)),
        _ => None,
    }
}

fn load_indexed_string_array(value: Option<&Value>) -> HashMap<i64, String> {
    let Some(Value::Array(entries)) = value else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        let Some(name) = entry.as_str() else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        map.insert(index as i64, name.to_string());
    }
    map
}

fn display_name_for_path(path: &str, names: &InventoryNames) -> Option<String> {
    let (id_str, map) = if let Some(rest) = path.strip_prefix("party._items.") {
        (rest, &names.items)
    } else if let Some(rest) = path.strip_prefix("party._weapons.") {
        (rest, &names.weapons)
    } else if let Some(rest) = path.strip_prefix("party._armors.") {
        (rest, &names.armors)
    } else {
        return None;
    };

    let id = parse_leaf_id(id_str)?;
    let db_name = map.get(&id)?;
    Some(format!("{db_name} ({id})"))
}

fn system_display_name_for_path(path: &str, names: &SystemNames) -> Option<String> {
    // JsonEx encodes arrays as { "@a": [...], "@c": n } → paths like switches._data.@a[1].
    let (id_str, map) = if let Some(rest) = path.strip_prefix("switches._data.@a[") {
        (rest.strip_suffix(']')?, &names.switches)
    } else if let Some(rest) = path.strip_prefix("variables._data.@a[") {
        (rest.strip_suffix(']')?, &names.variables)
    } else if let Some(rest) = path.strip_prefix("switches._data.") {
        (rest, &names.switches)
    } else if let Some(rest) = path.strip_prefix("variables._data.") {
        (rest, &names.variables)
    } else if let Some(rest) = path.strip_prefix("switches._data[") {
        (rest.strip_suffix(']')?, &names.switches)
    } else if let Some(rest) = path.strip_prefix("variables._data[") {
        (rest.strip_suffix(']')?, &names.variables)
    } else {
        return None;
    };

    let id = parse_leaf_id(id_str)?;
    let db_name = map.get(&id)?;
    Some(format!("{db_name} ({id})"))
}

fn parse_leaf_id(id_str: &str) -> Option<i64> {
    if id_str.is_empty() || id_str.contains('.') || id_str.contains('[') {
        return None;
    }
    id_str.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::json_tree::json_to_tree;
    use crate::save_editor::types::RenpyVarNode;
    use std::fs;
    use std::path::PathBuf;
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

    fn temp_data_dir_with(contents: &str, filename: &str) -> PathBuf {
        let unique = format!(
            "f95-rpgm-labels-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            filename
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(filename), contents).unwrap();
        dir
    }

    #[test]
    fn decorates_item_node_name() {
        let data = temp_data_dir_with(r#"[{"id":1,"name":"Potion"}]"#, "Items.json");
        let names = load_inventory_names(&data);
        let mut tree = json_to_tree(&serde_json::json!({"party":{"_items":{"1":2}}}));
        decorate_inventory_names(&mut tree, &names);
        let n = find(&tree, "party._items.1").unwrap();
        assert_eq!(n.name, "Potion (1)");
        assert_eq!(n.path, "party._items.1");
    }

    #[test]
    fn missing_db_keeps_id_name() {
        let names = load_inventory_names(Path::new("/nonexistent-rpgm-data"));
        let mut tree = json_to_tree(&serde_json::json!({"party":{"_items":{"9":1}}}));
        decorate_inventory_names(&mut tree, &names);
        assert_eq!(find(&tree, "party._items.9").unwrap().name, "9");
    }

    #[test]
    fn skips_null_entries_and_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"[null,{"id":2,"name":"Elixir"}]"#);
        let unique = format!(
            "f95-rpgm-labels-bom-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Items.json"), &bytes).unwrap();
        let names = load_inventory_names(&dir);
        assert_eq!(names.items.get(&2).map(String::as_str), Some("Elixir"));
        assert!(!names.items.contains_key(&0));
    }

    #[test]
    fn decorates_weapons_and_armors() {
        let unique = format!(
            "f95-rpgm-labels-wa-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Weapons.json"), r#"[{"id":3,"name":"Sword"}]"#).unwrap();
        fs::write(dir.join("Armors.json"), r#"[{"id":4,"name":"Shield"}]"#).unwrap();
        let names = load_inventory_names(&dir);
        let mut tree = json_to_tree(&serde_json::json!({
            "party":{"_weapons":{"3":1},"_armors":{"4":1}}
        }));
        decorate_inventory_names(&mut tree, &names);
        assert_eq!(find(&tree, "party._weapons.3").unwrap().name, "Sword (3)");
        assert_eq!(find(&tree, "party._armors.4").unwrap().name, "Shield (4)");
    }

    fn temp_data_dir() -> PathBuf {
        let unique = format!(
            "f95-rpgm-system-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decorates_switch_and_variable_names_from_system_json() {
        let dir = temp_data_dir();
        fs::write(
            dir.join("System.json"),
            r#"{"switches":["","Intro done","Boss dead"],"variables":["","Gold multiplier",""]}"#,
        )
        .unwrap();
        let mut tree = json_to_tree(&serde_json::json!({
            "switches": {"_data": {"1": true, "2": false}},
            "variables": {"_data": {"1": 5}}
        }));
        let names = load_system_names(&dir);
        decorate_system_names(&mut tree, &names);
        assert_eq!(find(&tree, "switches._data.1").unwrap().name, "Intro done (1)");
        assert_eq!(
            find(&tree, "variables._data.1").unwrap().name,
            "Gold multiplier (1)"
        );
    }

    #[test]
    fn decorates_jsonex_array_switch_paths() {
        let dir = temp_data_dir();
        fs::write(
            dir.join("System.json"),
            r#"{"switches":["","Intro done"],"variables":[""]}"#,
        )
        .unwrap();
        let mut tree = json_to_tree(&serde_json::json!({
            "switches": {"_data": {"@a": [null, true], "@c": 1}}
        }));
        let names = load_system_names(&dir);
        decorate_system_names(&mut tree, &names);
        assert_eq!(
            find(&tree, "switches._data.@a[1]").unwrap().name,
            "Intro done (1)"
        );
    }

    #[test]
    fn missing_system_json_keeps_index_names() {
        let names = load_system_names(Path::new("/nonexistent-rpgm-system"));
        let mut tree = json_to_tree(&serde_json::json!({
            "switches": {"_data": {"3": true}}
        }));
        decorate_system_names(&mut tree, &names);
        assert_eq!(find(&tree, "switches._data.3").unwrap().name, "3");
    }
}
