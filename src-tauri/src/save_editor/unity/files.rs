//! Dual-root Unity save file listing (LocalLow + install).

use crate::error::AppError;
use crate::save_editor::types::{UnityMeta, UnitySaveSlot};
use crate::save_editor::unity::discover::resolve_local_low_dir;
use crate::save_editor::unity::es3::is_encrypted_es3;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

const MAX_DEPTH: u32 = 4;
/// Per scan root (LocalLow vs install tree), not shared across roots.
/// Prevents LocalLow junk from exhausting the budget before install saves.
const MAX_FILES_SCANNED_PER_ROOT: usize = 200;

/// Install roots: `.` is files-only at install root; named dirs recurse to MAX_DEPTH.
const INSTALL_NAMED_SUBDIRS: &[&str] = &[
    "Save",
    "Saves",
    "save",
    "saves",
    "savegames",
    "SaveGames",
    "savegame",
    "SaveGame",
];

/// Opaque slot key: `localLow:rel` / `install:rel` (forward slashes).
pub fn slot_key(source: &str, rel: &str) -> String {
    format!("{source}:{}", rel.replace('\\', "/"))
}

/// Parse `source:rel` slot keys.
pub fn parse_slot_key(key: &str) -> Result<(&str, &str), AppError> {
    let (source, rel) = key
        .split_once(':')
        .ok_or_else(|| AppError::keyed("error.saveEditor.unity.badSlotKey"))?;
    if source.is_empty() || rel.is_empty() || rel.contains('\\') {
        return Err(AppError::keyed("error.saveEditor.unity.badSlotKey"));
    }
    if source != "localLow" && source != "install" && source != "registry" {
        return Err(AppError::keyed("error.saveEditor.unity.badSlotKey"));
    }
    Ok((source, rel))
}

/// True when `dir` contains at least one listable save candidate.
pub fn dir_has_candidates(dir: &Path) -> bool {
    let mut scanned = 0usize;
    let mut found = false;
    let _ = walk_collect(
        dir,
        dir,
        "localLow",
        0,
        MAX_DEPTH,
        &mut scanned,
        &mut |_| {
            found = true;
            false // stop after first candidate
        },
    );
    found
}

/// List ES3/JSON save candidates under LocalLow (if resolved) and the install tree.
pub fn list_slots(
    install: &Path,
    meta: &UnityMeta,
    local_low_base: &Path,
) -> Result<Vec<UnitySaveSlot>, AppError> {
    let mut slots = Vec::new();
    let mut seen = HashSet::new();

    let mut push = |slot: UnitySaveSlot| {
        if seen.insert(slot.key.clone()) {
            slots.push(slot);
        }
        true
    };

    // Separate file budgets so LocalLow noise cannot starve install saves.
    if let Some(local_low) = resolve_local_low_dir(install, meta, local_low_base) {
        let mut scanned = 0usize;
        walk_collect(
            &local_low,
            &local_low,
            "localLow",
            0,
            MAX_DEPTH,
            &mut scanned,
            &mut push,
        )?;
    }

    let mut scanned = 0usize;
    // Install root: shallow (files only) so named Save* dirs are not double-scanned.
    if install.is_dir() {
        walk_collect(
            install,
            install,
            "install",
            0,
            0,
            &mut scanned,
            &mut push,
        )?;
    }

    for sub in INSTALL_NAMED_SUBDIRS {
        if scanned >= MAX_FILES_SCANNED_PER_ROOT {
            break;
        }
        let root = install.join(sub);
        if !root.is_dir() {
            continue;
        }
        walk_collect(
            &root,
            install,
            "install",
            0,
            MAX_DEPTH,
            &mut scanned,
            &mut push,
        )?;
    }

    slots.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(slots)
}

/// Walk `dir` under `rel_root`. `on_slot` returns whether to continue collecting.
fn walk_collect(
    dir: &Path,
    rel_root: &Path,
    source: &str,
    depth: u32,
    max_depth: u32,
    scanned: &mut usize,
    on_slot: &mut dyn FnMut(UnitySaveSlot) -> bool,
) -> Result<(), AppError> {
    if depth > max_depth || *scanned >= MAX_FILES_SCANNED_PER_ROOT {
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    let mut dirs = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        if *scanned >= MAX_FILES_SCANNED_PER_ROOT {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
            continue;
        }
        if !path.is_file() {
            continue;
        }

        *scanned += 1;
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if is_junk_name(name) {
            continue;
        }

        let Some(slot) = classify_file(&path, name, rel_root, source)? else {
            continue;
        };
        if !on_slot(slot) {
            return Ok(());
        }
    }

    if depth >= max_depth {
        return Ok(());
    }

    for child in dirs {
        if *scanned >= MAX_FILES_SCANNED_PER_ROOT {
            break;
        }
        walk_collect(
            &child,
            rel_root,
            source,
            depth + 1,
            max_depth,
            scanned,
            on_slot,
        )?;
    }
    Ok(())
}

fn classify_file(
    path: &Path,
    name: &str,
    rel_root: &Path,
    source: &str,
) -> Result<Option<UnitySaveSlot>, AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let bytes = fs::read(path).map_err(|e| {
        AppError::Io(format!("failed to read {}: {e}", path.display()))
    })?;

    let (kind, encrypted) = if ext == "es3" {
        ("es3", is_encrypted_es3(&bytes))
    } else if is_json_object_or_array(&bytes) {
        ("json", false)
    } else if crate::save_editor::unity::nrbf::looks_like_nrbf(&bytes) {
        ("nrbf", false)
    } else if crate::save_editor::unity::odin::looks_like_odin_binary(&bytes) {
        ("odin", false)
    } else if crate::save_editor::unity::ac_save::looks_like_ac_binary_save(&bytes) {
        ("ac", false)
    } else if crate::save_editor::unity::xml_save::looks_like_xml_save(&bytes) {
        ("xml", false)
    } else if should_consider_save_file(path, name, &ext) {
        // Extensionless / custom ES3 or XOR payloads (Kendo Save0, Lyla save_1.json, …).
        if looks_like_encrypted_es3_blob(&bytes) {
            ("es3", true)
        } else {
            ("json", true)
        }
    } else {
        return Ok(None);
    };

    let rel = rel_path_forward_slashes(path, rel_root);
    let meta = fs::metadata(path).map_err(|e| {
        AppError::Io(format!("failed to read metadata for {}: {e}", path.display()))
    })?;

    Ok(Some(UnitySaveSlot {
        key: slot_key(source, &rel),
        display_name: rel,
        kind: kind.to_string(),
        source: source.to_string(),
        encrypted,
        mtime_ms: system_time_to_ms(meta.modified().ok()),
        size_bytes: meta.len(),
    }))
}

fn should_consider_save_file(path: &Path, name: &str, ext: &str) -> bool {
    if ext == "json" || ext == "txt" || ext == "sav" || ext == "save" || ext == "mss" {
        return name_suggests_save(name) || under_save_folder(path) || ext == "save" || ext == "mss";
    }
    if ext == "dat" {
        return name_suggests_save(name) || common_save_basename(name) || under_save_folder(path);
    }
    if name_suggests_save(name) || common_save_basename(name) {
        return true;
    }
    under_save_folder(path)
}

fn under_save_folder(path: &Path) -> bool {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|n| {
            let lower = n.to_ascii_lowercase();
            matches!(
                lower.as_str(),
                "save" | "saves" | "savegame" | "savegames"
            )
        })
        .unwrap_or(false)
}

fn common_save_basename(name: &str) -> bool {
    let stem = name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(name)
        .to_ascii_lowercase();
    matches!(
        stem.as_str(),
        "user"
            | "config"
            | "global"
            | "settings"
            | "system"
            | "prefs"
            | "player"
            | "playerinfo"
            | "playerdata"
            | "gamedata"
    )
}

/// AES-CBC ES3 stream: IV(16) + ciphertext, total length multiple of 16, not UTF-8 JSON.
fn looks_like_encrypted_es3_blob(bytes: &[u8]) -> bool {
    bytes.len() >= 32 && bytes.len() % 16 == 0 && !is_json_object_or_array(bytes)
}

fn is_json_object_or_array(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let trimmed = text.trim_start();
    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return false;
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) | Ok(serde_json::Value::Array(_)) => true,
        _ => false,
    }
}

pub(crate) fn name_suggests_save(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("save") || lower.contains("save") || lower.starts_with("savefile")
}

fn is_junk_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".log") {
        return true;
    }
    if lower.ends_with(".dmp") || lower.ends_with(".dump") {
        return true;
    }
    if lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
    {
        return true;
    }
    if lower.contains("crash") || lower.contains("stacktrace") {
        return true;
    }
    false
}

fn rel_path_forward_slashes(path: &Path, root: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.to_string_lossy().replace('\\', "/")
}

fn system_time_to_ms(modified: Option<SystemTime>) -> u64 {
    modified
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::UnityMeta;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-unity-files-{}-{}-{}",
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

    #[test]
    fn lists_es3_and_json_from_local_low_and_install() {
        let root = tempfile_root("dual");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();
        fs::create_dir_all(install.join("Save")).unwrap();
        fs::write(install.join("Save").join("slot.json"), br#"{"hp":1}"#).unwrap();

        let local_low_base = root.join("LocalLow");
        let ll = local_low_base.join("Acme").join("Widget");
        fs::create_dir_all(&ll).unwrap();
        fs::write(ll.join("data.es3"), br#"{"k":1}"#).unwrap();
        fs::write(ll.join("bin.es3"), &[0u8, 1, 2, 3, 4]).unwrap();

        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let keys: Vec<_> = slots.iter().map(|s| s.key.as_str()).collect();

        assert!(
            keys.contains(&"localLow:data.es3"),
            "missing localLow data.es3 in {keys:?}"
        );
        assert!(
            keys.contains(&"localLow:bin.es3"),
            "missing localLow bin.es3 in {keys:?}"
        );
        assert!(
            keys.contains(&"install:Save/slot.json"),
            "missing install Save/slot.json in {keys:?}"
        );

        let data = slots.iter().find(|s| s.key == "localLow:data.es3").unwrap();
        assert_eq!(data.kind, "es3");
        assert_eq!(data.source, "localLow");
        assert!(!data.encrypted);
        assert_eq!(data.display_name, "data.es3");

        let bin = slots.iter().find(|s| s.key == "localLow:bin.es3").unwrap();
        assert!(bin.encrypted);

        let json = slots
            .iter()
            .find(|s| s.key == "install:Save/slot.json")
            .unwrap();
        assert_eq!(json.kind, "json");
        assert_eq!(json.source, "install");
        assert!(!json.encrypted);
        assert_eq!(json.display_name, "Save/slot.json");

        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "slots should be sorted by key");
    }

    #[test]
    fn skips_player_log() {
        let root = tempfile_root("log");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();

        let local_low_base = root.join("LocalLow");
        let ll = local_low_base.join("Acme").join("Widget");
        fs::create_dir_all(&ll).unwrap();
        fs::write(ll.join("Player.log"), b"noise").unwrap();
        fs::write(ll.join("Player-prev.log"), b"noise").unwrap();
        fs::write(ll.join("keep.json"), br#"{"ok":true}"#).unwrap();

        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        assert!(slots.iter().any(|s| s.key == "localLow:keep.json"));
        assert!(slots.iter().all(|s| !s.key.contains("Player")));
        assert!(slots.iter().all(|s| !s.display_name.ends_with(".log")));
    }

    #[test]
    fn lists_nrbf_playerinfo_dat_in_local_low() {
        let root = tempfile_root("nrbf-ll");
        let install = root.join("install");
        fs::create_dir_all(install.join("TheTwist_Data")).unwrap();
        fs::write(
            install.join("TheTwist_Data").join("app.info"),
            "KsTgames\nThe Twist\n",
        )
        .unwrap();

        let local_low_base = root.join("LocalLow");
        let ll = local_low_base.join("KsTgames").join("The Twist");
        fs::create_dir_all(&ll).unwrap();

        let profile = std::env::var_os("USERPROFILE").map(PathBuf::from);
        let live = profile.map(|p| {
            p.join("AppData")
                .join("LocalLow")
                .join("KsTgames")
                .join("The Twist")
                .join("playerInfo.dat")
        });
        let Some(path) = live else {
            return;
        };
        if !path.is_file() {
            return;
        }
        let bytes = fs::read(&path).unwrap();
        fs::write(ll.join("playerInfo.dat"), &bytes).unwrap();
        fs::write(ll.join("output_log.txt"), b"noise").unwrap();

        let meta = UnityMeta {
            developer: Some("Wrong".to_string()),
            title: Some("The Twist".to_string()),
        };

        assert!(dir_has_candidates(&ll));
        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let slot = slots
            .iter()
            .find(|s| s.key == "localLow:playerInfo.dat")
            .expect("playerInfo.dat slot");
        assert_eq!(slot.kind, "nrbf");
        assert_eq!(slot.source, "localLow");
    }

    #[test]
    fn includes_encrypted_save_named_json() {
        let root = tempfile_root("xor-json");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();

        let local_low_base = root.join("LocalLow");
        let ll = local_low_base.join("Acme").join("Widget");
        fs::create_dir_all(&ll).unwrap();
        // Binary payload with save_*.json name — must still count as a LocalLow candidate.
        // Length not AES-aligned → classified as encrypted json (XOR-style).
        fs::write(ll.join("save_1.json"), &[0x37u8, 0x73, 0x4c, 0x41, 0x00, 0x01]).unwrap();
        fs::write(ll.join("random.json"), &[0x01u8, 0x02, 0x03]).unwrap();

        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let slot = slots
            .iter()
            .find(|s| s.key == "localLow:save_1.json")
            .expect("encrypted save_1.json should be listed");
        assert_eq!(slot.kind, "json");
        assert!(slot.encrypted);
        assert!(
            slots.iter().all(|s| s.key != "localLow:random.json"),
            "non-save-named binary .json must stay excluded"
        );
    }

    #[test]
    fn lists_extensionless_es3_under_save_folder() {
        let root = tempfile_root("kendo-style");
        let install = root.join("install");
        fs::create_dir_all(install.join("Kendo_Data")).unwrap();

        let local_low_base = root.join("LocalLow");
        let save_dir = local_low_base.join("Onigiri-ShiBa").join("Kendo").join("Save");
        fs::create_dir_all(&save_dir).unwrap();
        // AES-aligned encrypted blob (IV + one block).
        let mut blob = vec![0u8; 32];
        blob[0] = 0x6b;
        fs::write(save_dir.join("Save0"), &blob).unwrap();
        fs::write(save_dir.join("User"), &blob).unwrap();

        let meta = UnityMeta {
            developer: Some("Onigiri-ShiBa".to_string()),
            title: Some("Kendo".to_string()),
        };
        // app.info so product/company resolve
        fs::write(
            install.join("Kendo_Data").join("app.info"),
            "Onigiri-ShiBa\nKendo\n",
        )
        .unwrap();

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let keys: Vec<_> = slots.iter().map(|s| s.key.as_str()).collect();
        assert!(
            keys.contains(&"localLow:Save/Save0"),
            "missing Save0 in {keys:?}"
        );
        assert!(
            keys.contains(&"localLow:Save/User"),
            "missing User in {keys:?}"
        );
        let save0 = slots.iter().find(|s| s.key == "localLow:Save/Save0").unwrap();
        assert_eq!(save0.kind, "es3");
        assert!(save0.encrypted);
    }

    #[test]
    fn includes_sav_when_json() {
        let root = tempfile_root("sav");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();
        fs::write(install.join("game.sav"), br#"{"a":1}"#).unwrap();
        fs::write(install.join("game.sav.bin"), b"not-json").unwrap();

        let local_low_base = root.join("LocalLow");
        fs::create_dir_all(&local_low_base).unwrap();

        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let sav = slots
            .iter()
            .find(|s| s.key == "install:game.sav")
            .expect("game.sav should be listed");
        assert_eq!(sav.kind, "json");
        assert!(!sav.encrypted);
        assert!(slots.iter().all(|s| s.key != "install:game.sav.bin"));
    }

    #[test]
    fn lists_xml_sav_under_install_savegames() {
        let root = tempfile_root("savegames");
        let install = root.join("install");
        fs::create_dir_all(install.join("Game_Data")).unwrap();
        let sg = install.join("savegames");
        fs::create_dir_all(&sg).unwrap();
        fs::write(
            sg.join("Gusti (1).sav"),
            concat!(
                "\u{feff}",
                r#"<?xml version="1.0" encoding="utf-8"?>"#,
                "\n<PlayerData><Name>Gusti</Name><Money>10</Money></PlayerData>\n"
            )
            .as_bytes(),
        )
        .unwrap();
        fs::write(sg.join("Gusti (1).jpg"), b"\xff\xd8\xff").unwrap();

        let local_low_base = root.join("LocalLow");
        fs::create_dir_all(&local_low_base).unwrap();
        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Game".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        let keys: Vec<_> = slots.iter().map(|s| s.key.as_str()).collect();
        assert!(
            keys.iter().any(|k| k.contains("savegames/") && k.ends_with(".sav")),
            "missing savegames/*.sav in {keys:?}"
        );
        let slot = slots
            .iter()
            .find(|s| s.key.contains("savegames/") && s.key.ends_with(".sav"))
            .unwrap();
        assert_eq!(slot.kind, "xml");
        assert!(!slot.encrypted);
        assert!(
            slots.iter().all(|s| !s.key.ends_with(".jpg")),
            "screenshots under savegames must be skipped"
        );
    }

    #[test]
    fn slot_key_and_parse_round_trip() {
        let key = slot_key("localLow", "Save/a.es3");
        assert_eq!(key, "localLow:Save/a.es3");
        assert_eq!(parse_slot_key(&key).unwrap(), ("localLow", "Save/a.es3"));
        assert!(parse_slot_key("nope").is_err());
    }

    #[test]
    fn local_low_file_budget_does_not_starve_install_saves() {
        let root = tempfile_root("budget");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();
        fs::create_dir_all(install.join("Save")).unwrap();
        fs::write(install.join("Save").join("slot.json"), br#"{"hp":1}"#).unwrap();

        let local_low_base = root.join("LocalLow");
        let ll = local_low_base.join("Acme").join("Widget");
        fs::create_dir_all(&ll).unwrap();
        // More than the per-root scan cap of non-candidate files in LocalLow.
        for i in 0..(MAX_FILES_SCANNED_PER_ROOT + 50) {
            fs::write(ll.join(format!("noise-{i}.bin")), b"x").unwrap();
        }
        fs::write(ll.join("keep.es3"), br#"{"k":1}"#).unwrap();

        let meta = UnityMeta {
            developer: Some("Acme".to_string()),
            title: Some("Widget".to_string()),
        };

        let slots = list_slots(&install, &meta, &local_low_base).unwrap();
        assert!(
            slots.iter().any(|s| s.key == "install:Save/slot.json"),
            "install save must still be listed when LocalLow exceeds scan budget; got {slots:?}"
        );
    }
}
