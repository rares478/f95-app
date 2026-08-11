//! Disk space checks before downloads (archive + extraction peak usage).

use crate::download::host::clean_download_filename;
use crate::error::AppError;
use fs4::available_space;
use serde_json::json;
use std::path::Path;

/// Estimated uncompressed size as a multiple of the archive (conservative).
const EXTRACT_FACTOR: u64 = 2;
/// Headroom for temp files / filesystem metadata.
const BUFFER_BYTES: u64 = 128 * 1024 * 1024;

pub fn is_archive_name(name: &str) -> bool {
    let base = clean_download_filename(name).to_ascii_lowercase();
    base.ends_with(".zip") || base.ends_with(".7z") || base.ends_with(".rar")
}

/// Bytes that must be free on the destination volume for this download.
///
/// For archives we reserve space for the full archive plus an estimated
/// extracted tree (peak usage while both exist).
pub fn space_needed_for_download(
    file_name: &str,
    total_bytes: u64,
    existing_bytes: u64,
) -> u64 {
    let remaining = total_bytes.saturating_sub(existing_bytes);
    let mut needed = remaining.saturating_add(BUFFER_BYTES);
    if is_archive_name(file_name) {
        needed = needed.saturating_add(total_bytes.saturating_mul(EXTRACT_FACTOR));
    }
    needed
}

pub fn check_disk_space(path: &Path, needed: u64) -> Result<(), AppError> {
    if needed == 0 {
        return Ok(());
    }
    let free = available_space(path).map_err(|e| AppError::Io(e.to_string()))?;
    if free < needed {
        return Err(AppError::keyed_vars(
            "error.download.insufficientSpace",
            json!({
                "required": format_bytes(needed),
                "available": format_bytes(free),
            }),
        ));
    }
    Ok(())
}

pub fn format_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if n == 0 {
        return "0 B".to_string();
    }
    let mut value = n as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{n} B")
    } else if value >= 100.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else if value >= 10.0 {
        format!("{value:.1} {}", UNITS[unit])
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_needs_download_plus_extract_estimate() {
        let total = 1_000_000_000u64;
        assert_eq!(
            space_needed_for_download("game.zip", total, 0),
            total + BUFFER_BYTES + total * EXTRACT_FACTOR
        );
        assert_eq!(
            space_needed_for_download("game.zip", total, 500_000_000),
            500_000_000 + BUFFER_BYTES + total * EXTRACT_FACTOR
        );
    }

    #[test]
    fn non_archive_only_needs_download_bytes() {
        let total = 500_000_000u64;
        assert_eq!(
            space_needed_for_download("game.exe", total, 0),
            total + BUFFER_BYTES
        );
    }
}
