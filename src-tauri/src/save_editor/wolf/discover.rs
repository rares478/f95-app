//! Discover Wolf RPG Editor `.sav` slots under a game install.

use crate::error::AppError;
use crate::save_editor::types::{RenpySaveSlot, WolfProbeResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Prefer `{install}/Save`, then `save` / `Saves`.
pub fn resolve_saves_dir(install: &Path) -> Option<PathBuf> {
    for name in ["Save", "save", "Saves"] {
        let candidate = install.join(name);
        if candidate.is_dir() && has_wolf_slot(&candidate) {
            return Some(candidate);
        }
    }
    if has_wolf_slot(install) {
        return Some(install.to_path_buf());
    }
    None
}

pub fn probe_wolf_install(install: &Path) -> WolfProbeResult {
    let saves_dir = resolve_saves_dir(install);
    WolfProbeResult {
        is_wolf_layout: is_wolf_layout(install),
        saves_dir: saves_dir
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
    }
}

fn is_wolf_layout(install: &Path) -> bool {
    if is_rpgm_install(install) {
        return false;
    }
    let data = install.join("Data");
    let has_exe = install.join("Game.exe").is_file() || install.join("GamePro.exe").is_file();
    let has_data = data.is_dir();
    let has_marker = data.join("Game.dat").is_file()
        || data.join("BasicData").join("CDataBase.project").is_file()
        || data.join("CommonEvent.dat").is_file();
    let has_saves = resolve_saves_dir(install).is_some();
    (has_data && has_exe) || (has_data && has_marker) || (has_saves && has_exe)
}

fn is_rpgm_install(install: &Path) -> bool {
    install.join("www").join("js").join("rpg_core.js").is_file()
        || install.join("js").join("rmmz_core.js").is_file()
}

pub fn list_slots(saves_dir: &Path) -> Result<Vec<RenpySaveSlot>, AppError> {
    if !saves_dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(saves_dir).map_err(|e| {
        AppError::Io(format!(
            "failed to read saves dir {}: {e}",
            saves_dir.display()
        ))
    })?;

    let mut slots = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_wolf_slot_name(name) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| {
            AppError::Io(format!("failed to read metadata for {name}: {e}"))
        })?;
        slots.push(RenpySaveSlot {
            key: name.to_string(),
            kind: classify_slot_kind(name).to_string(),
            mtime_ms: system_time_to_ms(meta.modified().ok()),
            size_bytes: meta.len(),
            has_screenshot: false,
            source: None,
            display_name: None,
        });
    }

    slots.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(slots)
}

fn has_wolf_slot(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|entry| {
        entry
            .path()
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(is_wolf_slot_name)
    })
}

fn is_wolf_slot_name(name: &str) -> bool {
    name.ends_with(".sav") && name.starts_with("SaveData")
}

fn classify_slot_kind(name: &str) -> &'static str {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if stem.eq_ignore_ascii_case("System") {
        return "system";
    }
    if stem.starts_with("SaveData") {
        return "slot";
    }
    "other"
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
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-wolf-discover-{}-{}-{}",
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
    fn detects_save_folder() {
        let root = temp_root("layout");
        fs::create_dir_all(root.join("Data")).unwrap();
        fs::write(root.join("Game.exe"), b"").unwrap();
        fs::create_dir_all(root.join("Save")).unwrap();
        fs::write(root.join("Save/SaveData01.sav"), b"x").unwrap();
        let probe = probe_wolf_install(&root);
        assert!(probe.is_wolf_layout);
        assert!(probe.saves_dir.unwrap().replace('\\', "/").ends_with("Save"));
    }

    #[test]
    fn lists_savedata_only() {
        let dir = temp_root("slots");
        fs::write(dir.join("SaveData01.sav"), b"x").unwrap();
        fs::write(dir.join("System.sav"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        let slots = list_slots(&dir).unwrap();
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].key, "SaveData01.sav");
        assert_eq!(slots[0].kind, "slot");
    }
}
