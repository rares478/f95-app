//! Bounded per-slot backups under `{app_local_data}/save_backups`.

use crate::error::AppError;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BACKUPS_PER_SLOT: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenpySaveBackup {
    pub file_name: String,
    pub path: String,
    pub mtime_ms: u64,
    pub size_bytes: u64,
}

/// Copy live save into the slot backup dir; prune to [`MAX_BACKUPS_PER_SLOT`].
pub fn backup_before_write(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    live_path: &Path,
) -> Result<PathBuf, AppError> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    backup_at(backups_root, thread_id, slot_key, live_path, ts)
}

fn backup_at(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    live_path: &Path,
    timestamp_ms: u64,
) -> Result<PathBuf, AppError> {
    let dir = slot_backup_dir(backups_root, thread_id, slot_key);
    fs::create_dir_all(&dir).map_err(|e| {
        AppError::Io(format!(
            "failed to create backup dir {}: {e}",
            dir.display()
        ))
    })?;

    let mut ts = timestamp_ms;
    let dest = loop {
        let candidate = dir.join(format!("{ts}.save"));
        if !candidate.exists() {
            break candidate;
        }
        ts = ts.saturating_add(1);
    };
    fs::copy(live_path, &dest).map_err(|e| {
        AppError::Io(format!(
            "failed to backup {} -> {}: {e}",
            live_path.display(),
            dest.display()
        ))
    })?;

    prune_slot_backups(&dir)?;
    Ok(dest)
}

/// List backups for a slot, newest first.
pub fn list_backups(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
) -> Result<Vec<RenpySaveBackup>, AppError> {
    let dir = slot_backup_dir(backups_root, thread_id, slot_key);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut backups = collect_backup_files(&dir)?;
    backups.sort_by(|a, b| {
        b.mtime_ms
            .cmp(&a.mtime_ms)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    Ok(backups)
}

/// Backup current live, then copy `backup_file` over `live_path`.
///
/// The restore source is read into memory first so that
/// [`backup_before_write`]'s prune cannot delete the file we are restoring
/// when the slot is already at [`MAX_BACKUPS_PER_SLOT`].
pub fn restore_backup(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    backup_file: &Path,
    live_path: &Path,
    install_root: &Path,
) -> Result<(), AppError> {
    ensure_under_root(live_path, install_root)?;
    // Preserve restore source before prune can remove it.
    let restore_bytes = fs::read(backup_file).map_err(|e| {
        AppError::Io(format!(
            "failed to read restore source {}: {e}",
            backup_file.display()
        ))
    })?;
    backup_before_write(backups_root, thread_id, slot_key, live_path)?;
    fs::write(live_path, &restore_bytes).map_err(|e| {
        AppError::Io(format!(
            "failed to restore {} -> {}: {e}",
            backup_file.display(),
            live_path.display()
        ))
    })?;
    Ok(())
}

/// Refuse paths that escape `root` after normalization.
pub fn ensure_under_root(path: &Path, root: &Path) -> Result<(), AppError> {
    let canon_path = fs::canonicalize(path).map_err(|_| {
        AppError::keyed("error.saveEditor.pathEscape")
    })?;
    let canon_root = fs::canonicalize(root).map_err(|_| {
        AppError::keyed("error.saveEditor.pathEscape")
    })?;
    if canon_path.starts_with(&canon_root) {
        Ok(())
    } else {
        Err(AppError::keyed("error.saveEditor.pathEscape"))
    }
}

fn sanitize_slot_key(slot_key: &str) -> String {
    slot_key
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' => '_',
            other => other,
        })
        .collect()
}

fn slot_backup_dir(backups_root: &Path, thread_id: &str, slot_key: &str) -> PathBuf {
    backups_root
        .join(thread_id)
        .join(sanitize_slot_key(slot_key))
}

fn system_time_to_ms(modified: Option<SystemTime>) -> u64 {
    modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn collect_backup_files(dir: &Path) -> Result<Vec<RenpySaveBackup>, AppError> {
    let entries = fs::read_dir(dir).map_err(|e| {
        AppError::Io(format!("failed to read backup dir {}: {e}", dir.display()))
    })?;

    let mut backups = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".save") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| {
            AppError::Io(format!("failed to read metadata for {name}: {e}"))
        })?;
        backups.push(RenpySaveBackup {
            file_name: name.to_string(),
            path: path.to_string_lossy().into_owned(),
            mtime_ms: system_time_to_ms(meta.modified().ok()),
            size_bytes: meta.len(),
        });
    }
    Ok(backups)
}

fn prune_slot_backups(dir: &Path) -> Result<(), AppError> {
    let mut backups = collect_backup_files(dir)?;
    if backups.len() <= MAX_BACKUPS_PER_SLOT {
        return Ok(());
    }
    // Prefer filesystem mtime; break ties with timestamp embedded in the file name.
    backups.sort_by(|a, b| {
        b.mtime_ms
            .cmp(&a.mtime_ms)
            .then_with(|| b.file_name.cmp(&a.file_name))
    });
    for old in backups.into_iter().skip(MAX_BACKUPS_PER_SLOT) {
        let _ = fs::remove_file(&old.path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-save-backup-{}-{}-{}",
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

    fn write_file(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn backup_creates_timestamped_copy_and_prunes_to_10() {
        let root = tempfile_root("prune");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");
        write_file(&live, b"live");

        for i in 0..12u64 {
            backup_at(
                &backups_root,
                "thread1",
                "1-1.save",
                &live,
                1_700_000_000_000 + i,
            )
            .unwrap();
        }

        let listed = list_backups(&backups_root, "thread1", "1-1.save").unwrap();
        assert_eq!(listed.len(), 10);
        assert_eq!(MAX_BACKUPS_PER_SLOT, 10);
    }

    #[test]
    fn restore_replaces_live_and_keeps_pre_restore_backup() {
        let root = tempfile_root("restore");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");
        write_file(&live, b"A");

        let backup_path =
            backup_at(&backups_root, "thread1", "1-1.save", &live, 1_700_000_000_100).unwrap();
        // Overwrite the backup file contents to "B" while live stays "A"
        fs::write(&backup_path, b"B").unwrap();
        write_file(&live, b"A");

        restore_backup(
            &backups_root,
            "thread1",
            "1-1.save",
            &backup_path,
            &live,
            &install,
        )
        .unwrap();

        assert_eq!(fs::read(&live).unwrap(), b"B");

        let listed = list_backups(&backups_root, "thread1", "1-1.save").unwrap();
        let has_pre_restore_a = listed.iter().any(|b| {
            fs::read(Path::new(&b.path)).ok().as_deref() == Some(b"A".as_slice())
        });
        assert!(
            has_pre_restore_a,
            "expected a backup of pre-restore live content A, got {listed:?}"
        );
    }

    #[test]
    fn restore_oldest_succeeds_when_slot_at_max_backups() {
        let root = tempfile_root("restore-full");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");

        let mut oldest_path = PathBuf::new();
        for i in 0..MAX_BACKUPS_PER_SLOT {
            let content = format!("backup-{i}");
            write_file(&live, content.as_bytes());
            let path = backup_at(
                &backups_root,
                "thread1",
                "1-1.save",
                &live,
                1_700_000_000_000 + i as u64,
            )
            .unwrap();
            if i == 0 {
                oldest_path = path;
            }
        }

        assert_eq!(
            list_backups(&backups_root, "thread1", "1-1.save")
                .unwrap()
                .len(),
            MAX_BACKUPS_PER_SLOT
        );
        write_file(&live, b"current-live");
        let oldest_bytes = fs::read(&oldest_path).unwrap();
        assert_eq!(oldest_bytes, b"backup-0");

        restore_backup(
            &backups_root,
            "thread1",
            "1-1.save",
            &oldest_path,
            &live,
            &install,
        )
        .expect("restore of oldest must succeed even when prune runs at capacity");

        assert_eq!(fs::read(&live).unwrap(), b"backup-0");
    }

    #[test]
    fn refuse_live_path_outside_install() {
        let root = tempfile_root("escape");
        let install = root.join("install");
        let outside = root.join("outside");
        fs::create_dir_all(&install).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let live = outside.join("evil.save");
        write_file(&live, b"x");

        let err = ensure_under_root(&live, &install).unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }
}
