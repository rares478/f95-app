//! Plain JSON save file read/write (atomic replace).

use crate::error::AppError;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// Read and parse a JSON object/array from disk.
pub fn read_json_file(path: &Path) -> Result<Value, AppError> {
    let text = fs::read_to_string(path).map_err(|e| {
        AppError::Io(format!(
            "failed to read json save {}: {e}",
            path.display()
        ))
    })?;
    parse_json_value(&text)
}

/// Parse JSON text into a Value (object or array).
pub fn parse_json_value(text: &str) -> Result<Value, AppError> {
    let value: Value = serde_json::from_str(text)
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    match &value {
        Value::Object(_) | Value::Array(_) => Ok(value),
        _ => Err(AppError::keyed("error.saveEditor.parse")),
    }
}

/// Atomically write JSON via `path` + `.new` then rename.
pub fn write_json_file_atomic(path: &Path, value: &Value) -> Result<(), AppError> {
    let text = serde_json::to_string(value).map_err(|e| {
        AppError::Io(format!(
            "failed to serialize json save {}: {e}",
            path.display()
        ))
    })?;
    write_bytes_atomic(path, text.as_bytes())
}

/// Atomically write raw bytes via `path` + `.new` then rename.
pub fn write_bytes_atomic(save_path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let new_path = temp_new_path(save_path);
    fs::write(&new_path, bytes).map_err(|e| {
        AppError::Io(format!(
            "failed to create temp save {}: {e}",
            new_path.display()
        ))
    })?;
    if save_path.exists() {
        fs::remove_file(save_path).map_err(|e| {
            AppError::Io(format!(
                "failed to replace save {}: {e}",
                save_path.display()
            ))
        })?;
    }
    fs::rename(&new_path, save_path).map_err(|e| {
        recover_after_failed_rename(&new_path, save_path, e)
    })?;
    Ok(())
}

fn temp_new_path(save_path: &Path) -> PathBuf {
    let mut os = save_path.as_os_str().to_owned();
    os.push(".new");
    PathBuf::from(os)
}

fn recover_after_failed_rename(
    new_path: &Path,
    save_path: &Path,
    rename_err: std::io::Error,
) -> AppError {
    match fs::copy(new_path, save_path) {
        Ok(_) => AppError::Io(format!(
            "failed to rename {} -> {}: {rename_err}; restored {} by copying from recovery file {}",
            new_path.display(),
            save_path.display(),
            save_path.display(),
            new_path.display()
        )),
        Err(copy_err) => AppError::Io(format!(
            "failed to rename {} -> {}: {rename_err}; recovery file kept at {} (copy restore failed: {copy_err})",
            new_path.display(),
            save_path.display(),
            new_path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-unity-json-{}-{}-{}",
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
    fn atomic_write_round_trip() {
        let root = tempfile_root("round");
        let path = root.join("slot.json");
        fs::write(&path, br#"{"a":1}"#).unwrap();
        let mut v = read_json_file(&path).unwrap();
        v["a"] = serde_json::json!(2);
        write_json_file_atomic(&path, &v).unwrap();
        assert_eq!(read_json_file(&path).unwrap()["a"], 2);
        assert!(!root.join("slot.json.new").exists());
    }
}
