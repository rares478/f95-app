//! Discover local Ren'Py saves under a game install path.
//!
//! Never looks at `%APPDATA%/RenPy` — only folders inside the install root.

use crate::error::AppError;
use crate::save_editor::types::{RenpyProbeResult, RenpySaveSlot};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Prefer `{install}/game/saves`, else first existing among `saves`, `save`, `Saves`.
pub fn resolve_saves_dir(install_path: &Path) -> Option<PathBuf> {
    let game_saves = install_path.join("game").join("saves");
    if game_saves.is_dir() {
        return Some(game_saves);
    }
    for name in ["saves", "save", "Saves"] {
        let candidate = install_path.join(name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

/// Heuristic Ren'Py layout probe under the install root only.
pub fn probe_renpy_install(install_path: &Path) -> RenpyProbeResult {
    let saves_dir = resolve_saves_dir(install_path);
    let saves_dir_str = saves_dir
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned());

    let is_renpy_layout = saves_dir.is_some()
        || has_rpa_in_game(install_path)
        || install_path.join("renpy").is_dir()
        || install_path.join("renpy.py").is_file();

    RenpyProbeResult {
        is_renpy_layout,
        saves_dir: saves_dir_str,
    }
}

fn has_rpa_in_game(install_path: &Path) -> bool {
    let game = install_path.join("game");
    let Ok(entries) = fs::read_dir(&game) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|entry| {
        entry
            .path()
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("rpa"))
    })
}

/// List save slot files in a resolved saves directory.
pub fn list_slots(saves_dir: &Path) -> Result<Vec<RenpySaveSlot>, AppError> {
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
        if !is_save_entry_name(name) {
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

fn is_save_entry_name(name: &str) -> bool {
    name == "persistent"
        || name == "persistent.save"
        || name.ends_with(".save")
}

fn classify_slot_kind(name: &str) -> &'static str {
    if name == "persistent" || name == "persistent.save" {
        return "persistent";
    }
    if name.starts_with("auto-") {
        return "auto";
    }
    if name.starts_with("quick-") {
        return "quick";
    }
    if is_numeric_slot(name) {
        return "slot";
    }
    "other"
}

fn is_numeric_slot(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".save") else {
        return false;
    };
    let mut parts = stem.split('-');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !a.is_empty()
        && !b.is_empty()
        && a.chars().all(|c| c.is_ascii_digit())
        && b.chars().all(|c| c.is_ascii_digit())
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

    fn tempfile_install() -> PathBuf {
        let unique = format!(
            "f95-save-editor-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn resolve_prefers_game_saves() {
        let root = tempfile_install();
        std::fs::create_dir_all(root.join("game/saves")).unwrap();
        std::fs::create_dir_all(root.join("saves")).unwrap();
        assert_eq!(
            resolve_saves_dir(&root).unwrap(),
            root.join("game/saves")
        );
    }

    #[test]
    fn list_classifies_persistent_and_auto() {
        let root = tempfile_install();
        let dir = root.join("game/saves");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("1-1.save"), b"slot").unwrap();
        std::fs::write(dir.join("auto-1.save"), b"auto").unwrap();
        std::fs::write(dir.join("persistent"), b"pers").unwrap();
        let slots = list_slots(&dir).unwrap();
        assert!(slots
            .iter()
            .any(|s| s.key == "persistent" && s.kind == "persistent"));
        assert!(slots
            .iter()
            .any(|s| s.key == "auto-1.save" && s.kind == "auto"));
    }

    #[test]
    fn probe_true_with_rpa_or_saves() {
        let root = tempfile_install();
        std::fs::create_dir_all(root.join("game")).unwrap();
        std::fs::write(root.join("game/archive.rpa"), b"x").unwrap();
        assert!(probe_renpy_install(&root).is_renpy_layout);
    }
}
