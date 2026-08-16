//! Discover RPG Maker MV/MZ saves under a game install path (install-root only).

use crate::error::AppError;
use crate::save_editor::types::{RpgmProbeResult, RenpySaveSlot};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Prefer MV `www/save` or MZ `save` under the install root; returns dir + variant.
pub fn resolve_saves_dir(install: &Path) -> Option<(PathBuf, &'static str)> {
    let mv_save = install.join("www").join("save");
    let mz_save = install.join("save");
    let mv_core = install.join("www").join("js").join("rpg_core.js").is_file();
    let mz_marker = install.join("js").join("rmmz_core.js").is_file()
        || install.join("Game.rmmzproject").is_file();

    let mv_dir = mv_save.is_dir() || mv_core;
    let mz_from_saves = has_rpgsave(&mz_save) && !mv_core;
    let mz_dir = mz_marker || mz_from_saves;

    let mv_has = has_rpgsave(&mv_save);
    let mz_has = has_rpgsave(&mz_save);

    if mv_dir && mz_dir {
        // Precedence when both: directory with *.rpgsave wins; else MV if rpg_core.js, else MZ.
        if mv_has && !mz_has {
            return Some((mv_save, "mv"));
        }
        if mz_has && !mv_has {
            return Some((mz_save, "mz"));
        }
        if mv_core {
            return Some((mv_save, "mv"));
        }
        return Some((mz_save, "mz"));
    }

    if mv_dir {
        return Some((mv_save, "mv"));
    }
    if mz_dir {
        return Some((mz_save, "mz"));
    }
    None
}

/// Heuristic RPG Maker MV/MZ layout probe under the install root only.
pub fn probe_rpgm_install(install: &Path) -> RpgmProbeResult {
    match resolve_saves_dir(install) {
        Some((dir, variant)) => RpgmProbeResult {
            is_rpgm_layout: true,
            saves_dir: Some(dir.to_string_lossy().into_owned()),
            variant: Some(variant.to_string()),
        },
        None => RpgmProbeResult {
            is_rpgm_layout: false,
            saves_dir: None,
            variant: None,
        },
    }
}

/// List `.rpgsave` files in a resolved saves directory.
/// Missing or non-directory path → empty list (spec: Missing saves dir → Empty slot list).
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
        if !is_rpgsave_name(name) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| {
            AppError::Io(format!("failed to read metadata for {name}: {e}"))
        })?;
        slots.push(RenpySaveSlot {
            key: name.to_string(),
            kind: classify_rpgsave_kind(name).to_string(),
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

/// MV → `www/data`, MZ → `data`.
pub fn resolve_data_dir(install: &Path, variant: &str) -> Option<PathBuf> {
    match variant {
        "mv" => Some(install.join("www").join("data")),
        "mz" => Some(install.join("data")),
        _ => None,
    }
}

fn has_rpgsave(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|entry| {
        let path = entry.path();
        path.is_file()
            && path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(is_rpgsave_name)
    })
}

fn is_rpgsave_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("rpgsave"))
}

fn classify_rpgsave_kind(name: &str) -> &'static str {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let lower = stem.to_ascii_lowercase();
    if lower == "global" {
        return "global";
    }
    if lower == "config" {
        return "config";
    }
    if lower.starts_with("file") {
        let rest = &lower["file".len()..];
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            return "file";
        }
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

    fn tempfile_or_std_temp(label: &str) -> PathBuf {
        let unique = format!(
            "f95-rpgm-discover-{}-{}-{}",
            label,
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

    fn write_file(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn detects_mv_www_save() {
        let root = tempfile_or_std_temp("rpgm-mv");
        std::fs::create_dir_all(root.join("www/save")).unwrap();
        write_file(&root.join("www/js/rpg_core.js"), b"");
        write_file(&root.join("www/save/file1.rpgsave"), b"x");
        let p = probe_rpgm_install(&root);
        assert!(p.is_rpgm_layout);
        assert_eq!(p.variant.as_deref(), Some("mv"));
        assert!(p.saves_dir.unwrap().replace('\\', "/").ends_with("www/save"));
    }

    #[test]
    fn detects_mz_save() {
        let root = tempfile_or_std_temp("rpgm-mz");
        std::fs::create_dir_all(root.join("save")).unwrap();
        write_file(&root.join("js/rmmz_core.js"), b"");
        write_file(&root.join("save/file1.rpgsave"), b"x");
        let p = probe_rpgm_install(&root);
        assert!(p.is_rpgm_layout);
        assert_eq!(p.variant.as_deref(), Some("mz"));
    }

    #[test]
    fn lists_rpgsave_kinds() {
        let dir = tempfile_or_std_temp("slots");
        for name in ["file1.rpgsave", "global.rpgsave", "config.rpgsave", "readme.txt"] {
            write_file(&dir.join(name), b"x");
        }
        let slots = list_slots(&dir).unwrap();
        let keys: Vec<_> = slots.iter().map(|s| s.key.as_str()).collect();
        assert!(keys.contains(&"file1.rpgsave"));
        assert!(keys.contains(&"global.rpgsave"));
        assert!(!keys.iter().any(|k| *k == "readme.txt"));
        assert_eq!(slots.iter().find(|s| s.key == "file1.rpgsave").unwrap().kind, "file");
        assert_eq!(slots.iter().find(|s| s.key == "global.rpgsave").unwrap().kind, "global");
    }

    #[test]
    fn list_slots_missing_dir_returns_empty() {
        let dir = tempfile_or_std_temp("missing-slots").join("no-such-save-dir");
        let slots = list_slots(&dir).unwrap();
        assert!(slots.is_empty());
    }

    #[test]
    fn list_for_install_missing_save_dir_returns_empty() {
        let root = tempfile_or_std_temp("orch-missing-save");
        // MV layout marker without www/save directory yet.
        write_file(&root.join("www/js/rpg_core.js"), b"");
        let slots = super::super::list_for_install(&root).unwrap();
        assert!(slots.is_empty());
    }
}
