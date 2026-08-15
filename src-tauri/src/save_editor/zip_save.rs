//! Read/write the `log` member of Ren'Py save zip files.

use crate::error::AppError;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Open a Ren'Py save zip and return the raw bytes of the `log` member.
pub fn read_log_bytes(save_path: &Path) -> Result<Vec<u8>, AppError> {
    let file = File::open(save_path).map_err(|e| {
        AppError::Io(format!(
            "failed to open save zip {}: {e}",
            save_path.display()
        ))
    })?;
    let mut archive = ZipArchive::new(file).map_err(|e| {
        AppError::Io(format!(
            "failed to read save zip {}: {e}",
            save_path.display()
        ))
    })?;
    let mut entry = archive.by_name("log").map_err(|e| {
        AppError::Io(format!(
            "save zip {} missing log member: {e}",
            save_path.display()
        ))
    })?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| {
        AppError::Io(format!(
            "failed to read log from {}: {e}",
            save_path.display()
        ))
    })?;
    Ok(buf)
}

/// Rewrite the save zip with an updated `log` member, preserving other members.
/// Writes via `save_path` + `.new` then renames into place.
pub fn write_log_bytes(save_path: &Path, new_log: &[u8]) -> Result<(), AppError> {
    let others = read_non_log_members(save_path)?;
    let new_path = temp_new_path(save_path);

    {
        let out = File::create(&new_path).map_err(|e| {
            AppError::Io(format!(
                "failed to create temp save {}: {e}",
                new_path.display()
            ))
        })?;
        let mut zip = ZipWriter::new(out);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file("log", options).map_err(|e| {
            AppError::Io(format!("failed to write log member: {e}"))
        })?;
        zip.write_all(new_log).map_err(|e| {
            AppError::Io(format!("failed to write log bytes: {e}"))
        })?;

        for (name, data) in &others {
            zip.start_file(name.as_str(), options).map_err(|e| {
                AppError::Io(format!("failed to write zip member {name}: {e}"))
            })?;
            zip.write_all(data).map_err(|e| {
                AppError::Io(format!("failed to write zip member {name} bytes: {e}"))
            })?;
        }

        zip.finish().map_err(|e| {
            AppError::Io(format!(
                "failed to finish temp save {}: {e}",
                new_path.display()
            ))
        })?;
    }

    // Same-dir rename; on Windows the destination must not exist.
    if save_path.exists() {
        fs::remove_file(save_path).map_err(|e| {
            AppError::Io(format!(
                "failed to replace save {}: {e}",
                save_path.display()
            ))
        })?;
    }
    fs::rename(&new_path, save_path).map_err(|e| {
        let _ = fs::remove_file(&new_path);
        AppError::Io(format!(
            "failed to rename {} -> {}: {e}",
            new_path.display(),
            save_path.display()
        ))
    })?;
    Ok(())
}

/// True if the save zip contains a `screenshot.png` member.
pub fn zip_has_screenshot(save_path: &Path) -> bool {
    let Ok(file) = File::open(save_path) else {
        return false;
    };
    let Ok(mut archive) = ZipArchive::new(file) else {
        return false;
    };
    let has = archive.by_name("screenshot.png").is_ok();
    has
}

fn temp_new_path(save_path: &Path) -> PathBuf {
    let mut os = save_path.as_os_str().to_owned();
    os.push(".new");
    PathBuf::from(os)
}

fn read_non_log_members(save_path: &Path) -> Result<Vec<(String, Vec<u8>)>, AppError> {
    let file = File::open(save_path).map_err(|e| {
        AppError::Io(format!(
            "failed to open save zip {}: {e}",
            save_path.display()
        ))
    })?;
    let mut archive = ZipArchive::new(file).map_err(|e| {
        AppError::Io(format!(
            "failed to read save zip {}: {e}",
            save_path.display()
        ))
    })?;

    let mut members = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            AppError::Io(format!(
                "failed to read zip entry {} in {}: {e}",
                i,
                save_path.display()
            ))
        })?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if name == "log" {
            continue;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| {
            AppError::Io(format!(
                "failed to read zip member {name} from {}: {e}",
                save_path.display()
            ))
        })?;
        members.push((name, data));
    }
    Ok(members)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipArchive, ZipWriter};

    fn temp_save_path() -> PathBuf {
        let unique = format!(
            "f95-zip-save-{}-{}.save",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(unique);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        path
    }

    fn write_fixture_zip(path: &Path, log: &[u8]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("log", options).unwrap();
        zip.write_all(log).unwrap();
        zip.start_file("json", options).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
    }

    fn write_fixture_zip_with_screenshot(path: &Path, log: &[u8], screenshot: &[u8]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("log", options).unwrap();
        zip.write_all(log).unwrap();
        zip.start_file("json", options).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.start_file("screenshot.png", options).unwrap();
        zip.write_all(screenshot).unwrap();
        zip.finish().unwrap();
    }

    fn member_bytes(path: &Path, name: &str) -> Vec<u8> {
        let file = File::open(path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();
        buf
    }

    #[test]
    fn read_log_round_trips() {
        let p = temp_save_path();
        write_fixture_zip(&p, b"not-real-pickle");
        assert_eq!(read_log_bytes(&p).unwrap(), b"not-real-pickle");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn write_log_preserves_other_members() {
        let p = temp_save_path();
        let shot = b"\x89PNG\r\n\x1a\nfake";
        write_fixture_zip_with_screenshot(&p, b"old-log", shot);

        write_log_bytes(&p, b"new-log").unwrap();

        assert_eq!(read_log_bytes(&p).unwrap(), b"new-log");
        assert_eq!(member_bytes(&p, "screenshot.png"), shot.as_slice());
        assert_eq!(member_bytes(&p, "json"), b"{}");
        assert!(zip_has_screenshot(&p));
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn zip_has_screenshot_false_without_member() {
        let p = temp_save_path();
        write_fixture_zip(&p, b"x");
        assert!(!zip_has_screenshot(&p));
        let _ = fs::remove_file(&p);
    }
}
