//! Bounded per-slot backups under `{app_local_data}/save_backups`.
//!
//! The first edit of a slot copies the live save to `original.<ext>` (matching
//! the live file extension, e.g. `original.save` or `original.rpgsave`). Later
//! edits leave that file alone so the pre-edit original stays available. Restore
//! writes the chosen backup over the live slot without creating another backup.

use super::reject_path_component;
use crate::error::AppError;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BACKUPS_PER_SLOT: usize = 10;

/// Default first-backup name for Ren'Py `.save` lives (legacy constant).
pub const ORIGINAL_BACKUP_NAME: &str = "original.save";

/// First-backup file name derived from the live save's extension.
pub fn original_backup_name_for(live_path: &Path) -> String {
    match live_path.extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.is_empty() => format!("original.{ext}"),
        _ => ORIGINAL_BACKUP_NAME.to_string(),
    }
}

fn is_original_backup_name(name: &str) -> bool {
    name.starts_with("original.")
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenpySaveBackup {
    pub file_name: String,
    pub path: String,
    pub mtime_ms: u64,
    pub size_bytes: u64,
}

/// Copy `bytes` to `original.<ext>` if that file does not exist yet (registry / in-memory sources).
pub fn backup_bytes_before_write(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    bytes: &[u8],
    original_file_name: &str,
) -> Result<PathBuf, AppError> {
    reject_path_component(thread_id)?;
    reject_path_component(original_file_name)?;
    if !is_original_backup_name(original_file_name) {
        return Err(AppError::keyed("error.saveEditor.pathEscape"));
    }
    let dir = slot_backup_dir(backups_root, thread_id, slot_key)?;
    fs::create_dir_all(&dir).map_err(|e| {
        AppError::Io(format!(
            "failed to create backup dir {}: {e}",
            dir.display()
        ))
    })?;
    let thread_root = backups_root.join(thread_id);
    ensure_under_root(&thread_root, backups_root)?;
    ensure_under_root(&dir, backups_root)?;

    let dest = dir.join(original_file_name);
    if !dest.exists() {
        fs::write(&dest, bytes).map_err(|e| {
            AppError::Io(format!(
                "failed to backup bytes -> {}: {e}",
                dest.display()
            ))
        })?;
    }
    prune_slot_backups(&dir)?;
    Ok(dest)
}

/// Copy live save to `original.<ext>` if that file does not exist yet.
///
/// Subsequent edits keep the existing original. Still prunes leftover
/// timestamped backups from older app versions down to [`MAX_BACKUPS_PER_SLOT`].
pub fn backup_before_write(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    live_path: &Path,
) -> Result<PathBuf, AppError> {
    let dir = slot_backup_dir(backups_root, thread_id, slot_key)?;
    fs::create_dir_all(&dir).map_err(|e| {
        AppError::Io(format!(
            "failed to create backup dir {}: {e}",
            dir.display()
        ))
    })?;
    let thread_root = backups_root.join(thread_id);
    ensure_under_root(&thread_root, backups_root)?;
    ensure_under_root(&dir, backups_root)?;

    let dest = dir.join(original_backup_name_for(live_path));
    if !dest.exists() {
        fs::copy(live_path, &dest).map_err(|e| {
            AppError::Io(format!(
                "failed to backup {} -> {}: {e}",
                live_path.display(),
                dest.display()
            ))
        })?;
    }

    prune_slot_backups(&dir)?;
    Ok(dest)
}

/// List backups for a slot, newest first (`original.*` sorted ahead of the rest).
pub fn list_backups(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
) -> Result<Vec<RenpySaveBackup>, AppError> {
    let dir = slot_backup_dir(backups_root, thread_id, slot_key)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    ensure_under_root(&dir, backups_root)?;

    let mut backups = collect_backup_files(&dir)?;
    backups.sort_by(|a, b| {
        // Prefer showing original first when mtimes tie / for clarity.
        let a_orig = is_original_backup_name(&a.file_name);
        let b_orig = is_original_backup_name(&b.file_name);
        match (a_orig, b_orig) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b
                .mtime_ms
                .cmp(&a.mtime_ms)
                .then_with(|| b.file_name.cmp(&a.file_name)),
        }
    });
    Ok(backups)
}

/// Copy `backup_file` over `live_path` without creating a new backup.
///
/// `backup_file` must remain under `{backups_root}/{thread_id}/`.
pub fn restore_backup(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    backup_file: &Path,
    live_path: &Path,
    install_root: &Path,
) -> Result<(), AppError> {
    reject_path_component(thread_id)?;
    // Sanitize first so Unity `source:rel/path` keys are accepted.
    reject_path_component(&sanitize_slot_key(slot_key))?;
    ensure_under_root(live_path, install_root)?;
    let thread_root = backups_root.join(thread_id);
    ensure_under_root(&thread_root, backups_root)?;
    ensure_under_root(backup_file, &thread_root)?;
    let restore_bytes = fs::read(backup_file).map_err(|e| {
        AppError::Io(format!(
            "failed to read restore source {}: {e}",
            backup_file.display()
        ))
    })?;
    fs::write(live_path, &restore_bytes).map_err(|e| {
        AppError::Io(format!(
            "failed to restore {} -> {}: {e}",
            backup_file.display(),
            live_path.display()
        ))
    })?;
    Ok(())
}

/// Path of a single backup file under the slot backup directory.
pub fn resolve_backup_path(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
    backup_file_name: &str,
) -> Result<PathBuf, AppError> {
    Ok(slot_backup_dir(backups_root, thread_id, slot_key)?.join(backup_file_name))
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

/// True when `slot_key` is already a single safe path component (Ren'Py / RPGM).
fn is_simple_slot_key(slot_key: &str) -> bool {
    !slot_key.is_empty()
        && !slot_key.contains('/')
        && !slot_key.contains('\\')
        && !slot_key.contains(':')
        && !slot_key.contains('\0')
        && slot_key != "."
        && slot_key != ".."
        && !Path::new(slot_key).is_absolute()
}

/// Map slot keys to a single backup directory name without collisions.
///
/// Simple filenames (`1-1.save`, `file1.rpgsave`) are kept as-is. Unity keys
/// like `install:Save/a.json` embed `/` and `:`; a naive `_` substitution would
/// collide with `install:Save_a.json`. Those keys use a stable hex encoding of
/// the raw UTF-8 key (unique, single path component).
fn sanitize_slot_key(slot_key: &str) -> String {
    if is_simple_slot_key(slot_key) {
        return slot_key.to_string();
    }
    format!("k_{}", hex::encode(slot_key.as_bytes()))
}

fn slot_backup_dir(
    backups_root: &Path,
    thread_id: &str,
    slot_key: &str,
) -> Result<PathBuf, AppError> {
    reject_path_component(thread_id)?;
    let safe = sanitize_slot_key(slot_key);
    reject_path_component(&safe)?;
    Ok(backups_root.join(thread_id).join(safe))
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
        let is_save_ext = name.ends_with(".save") || name.ends_with(".rpgsave");
        if !is_save_ext && !is_original_backup_name(name) {
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
    // Never delete original.*; prune oldest timestamp leftovers first.
    backups.sort_by(|a, b| {
        let a_orig = is_original_backup_name(&a.file_name);
        let b_orig = is_original_backup_name(&b.file_name);
        match (a_orig, b_orig) {
            (true, false) => std::cmp::Ordering::Less, // original sorts as "newest"/kept
            (false, true) => std::cmp::Ordering::Greater,
            _ => b
                .mtime_ms
                .cmp(&a.mtime_ms)
                .then_with(|| b.file_name.cmp(&a.file_name)),
        }
    });
    for old in backups.into_iter().skip(MAX_BACKUPS_PER_SLOT) {
        if is_original_backup_name(&old.file_name) {
            continue;
        }
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
    fn backup_writes_original_once_and_keeps_contents() {
        let root = tempfile_root("original-once");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");
        write_file(&live, b"first");

        let dest = backup_before_write(&backups_root, "thread1", "1-1.save", &live).unwrap();
        assert_eq!(dest.file_name().and_then(|n| n.to_str()), Some(ORIGINAL_BACKUP_NAME));
        assert_eq!(fs::read(&dest).unwrap(), b"first");

        write_file(&live, b"second");
        let dest2 = backup_before_write(&backups_root, "thread1", "1-1.save", &live).unwrap();
        assert_eq!(dest2, dest);
        assert_eq!(
            fs::read(&dest).unwrap(),
            b"first",
            "original.save must not be overwritten on later edits"
        );

        let listed = list_backups(&backups_root, "thread1", "1-1.save").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, ORIGINAL_BACKUP_NAME);
    }

    #[test]
    fn backup_rpgsave_uses_original_rpgsave_name() {
        let root = tempfile_root("original-rpgsave");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("file1.rpgsave");
        write_file(&live, b"rpgsave-bytes");

        assert_eq!(original_backup_name_for(&live), "original.rpgsave");

        let dest =
            backup_before_write(&backups_root, "thread1", "file1.rpgsave", &live).unwrap();
        assert_eq!(
            dest.file_name().and_then(|n| n.to_str()),
            Some("original.rpgsave")
        );
        assert_eq!(fs::read(&dest).unwrap(), b"rpgsave-bytes");

        let listed = list_backups(&backups_root, "thread1", "file1.rpgsave").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, "original.rpgsave");
    }

    #[test]
    fn restore_replaces_live_without_extra_backup() {
        let root = tempfile_root("restore");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");
        write_file(&live, b"A");

        let backup_path =
            backup_before_write(&backups_root, "thread1", "1-1.save", &live).unwrap();
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
        assert_eq!(listed.len(), 1, "restore must not create another backup");
        assert_eq!(listed[0].file_name, ORIGINAL_BACKUP_NAME);
        assert_eq!(fs::read(Path::new(&listed[0].path)).unwrap(), b"B");
    }

    #[test]
    fn restore_original_succeeds() {
        let root = tempfile_root("restore-orig");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live = install.join("saves").join("1-1.save");
        write_file(&live, b"original-bytes");
        let backup_path =
            backup_before_write(&backups_root, "thread1", "1-1.save", &live).unwrap();
        write_file(&live, b"edited");

        restore_backup(
            &backups_root,
            "thread1",
            "1-1.save",
            &backup_path,
            &live,
            &install,
        )
        .unwrap();
        assert_eq!(fs::read(&live).unwrap(), b"original-bytes");
        assert_eq!(
            list_backups(&backups_root, "thread1", "1-1.save")
                .unwrap()
                .len(),
            1
        );
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

    #[test]
    fn backup_before_write_rejects_dotdot_thread_id() {
        let root = tempfile_root("tid-dotdot");
        let backups_root = root.join("save_backups");
        fs::create_dir_all(&backups_root).unwrap();
        let live = root.join("live.save");
        write_file(&live, b"x");

        let err = backup_before_write(&backups_root, "..", "1-1.save", &live).unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
        assert!(
            !root.join("1-1.save").exists(),
            "must not create backups outside save_backups via .."
        );
    }

    #[test]
    fn backup_before_write_rejects_absolute_thread_id() {
        let root = tempfile_root("tid-abs");
        let backups_root = root.join("save_backups");
        fs::create_dir_all(&backups_root).unwrap();
        let live = root.join("live.save");
        write_file(&live, b"x");
        let abs_thread = root.join("escaped");

        let err = backup_before_write(
            &backups_root,
            abs_thread.to_str().expect("utf-8 temp path"),
            "1-1.save",
            &live,
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }

    #[test]
    fn list_backups_rejects_dotdot_and_absolute_thread_id() {
        let root = tempfile_root("list-tid");
        let backups_root = root.join("save_backups");
        fs::create_dir_all(&backups_root).unwrap();

        let err = list_backups(&backups_root, "..", "1-1.save").unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");

        let abs = root.join("elsewhere");
        let err = list_backups(
            &backups_root,
            abs.to_str().expect("utf-8 temp path"),
            "1-1.save",
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "error.saveEditor.pathEscape");
    }

    #[test]
    fn list_backups_hashes_path_like_slot_keys_instead_of_escaping() {
        let root = tempfile_root("list-slot");
        let backups_root = root.join("save_backups");
        fs::create_dir_all(&backups_root).unwrap();

        // Raw `..` / `../x.save` must not be joined as path components.
        let listed_dotdot = list_backups(&backups_root, "thread1", "..").unwrap();
        assert!(listed_dotdot.is_empty());
        let listed_slash = list_backups(&backups_root, "thread1", "../x.save").unwrap();
        assert!(listed_slash.is_empty());

        let dir = slot_backup_dir(&backups_root, "thread1", "..").unwrap();
        assert_eq!(
            dir,
            backups_root
                .join("thread1")
                .join(sanitize_slot_key(".."))
        );
        assert!(
            !sanitize_slot_key("..").contains('.'),
            "sanitized name must not retain path-escape dots"
        );
        assert!(sanitize_slot_key("../x.save").starts_with("k_"));
    }

    #[test]
    fn unity_slot_keys_that_collide_under_underscore_get_distinct_backup_dirs() {
        // Old sanitize mapped both `/` and `:` to `_`, colliding:
        //   install:Save/a.json  -> install_Save_a.json
        //   install:Save_a.json  -> install_Save_a.json
        let key_slash = "install:Save/a.json";
        let key_underscore = "install:Save_a.json";
        let old_sanitize = |k: &str| {
            k.chars()
                .map(|c| match c {
                    '\\' | '/' | ':' => '_',
                    other => other,
                })
                .collect::<String>()
        };
        assert_eq!(
            old_sanitize(key_slash),
            old_sanitize(key_underscore),
            "precondition: keys must collide under the old sanitizer"
        );
        assert_ne!(
            sanitize_slot_key(key_slash),
            sanitize_slot_key(key_underscore),
            "sanitized names must not collide"
        );

        let root = tempfile_root("unity-slot-collision");
        let backups_root = root.join("save_backups");
        let install = root.join("game");
        let live_slash = install.join("Save").join("a.json");
        let live_underscore = install.join("Save_a.json");
        write_file(&live_slash, b"slash-bytes");
        write_file(&live_underscore, b"underscore-bytes");

        let dest_slash =
            backup_before_write(&backups_root, "thread1", key_slash, &live_slash).unwrap();
        let dest_underscore =
            backup_before_write(&backups_root, "thread1", key_underscore, &live_underscore)
                .unwrap();

        assert_ne!(
            dest_slash.parent(),
            dest_underscore.parent(),
            "distinct slot keys must use distinct backup directories"
        );
        assert_eq!(fs::read(&dest_slash).unwrap(), b"slash-bytes");
        assert_eq!(fs::read(&dest_underscore).unwrap(), b"underscore-bytes");
        assert!(dest_slash
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap()
            .starts_with("original."));
        assert!(dest_underscore
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap()
            .starts_with("original."));
        assert!(
            dest_slash.exists() && dest_underscore.exists(),
            "both slots must get their own original.* backup"
        );

        // Simple Ren'Py keys remain readable directory names.
        assert_eq!(sanitize_slot_key("1-1.save"), "1-1.save");
    }
}
