//! Read/write the `log` member of Ren'Py save zip files.

use crate::error::AppError;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::{ZipArchive, ZipWriter};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

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
///
/// Non-`log` entries are copied **verbatim** from the original archive (same
/// local headers, compressed bytes, and DOS/Unix metadata). Only `log` is
/// recompressed. Central-directory host system is forced to MS-DOS (0), matching
/// Ren'Py's own saves — the `zip` crate otherwise rewrites everything as Unix,
/// which produced load failures in Ren'Py 7 even when `log` bytes matched a
/// working editor.
///
/// The `signatures` member (Ren'Py 8 save tokens) is **dropped**. It signs the
/// original `log`; after an edit verification always fails and load aborts.
/// Without signatures Ren'Py treats the save as unsigned and can load it
/// (user may confirm once for an unknown token).
///
/// Writes via `save_path` + `.new` then renames into place.
pub fn write_log_bytes(save_path: &Path, new_log: &[u8]) -> Result<(), AppError> {
    let original = fs::read(save_path).map_err(|e| {
        AppError::Io(format!(
            "failed to read save zip {}: {e}",
            save_path.display()
        ))
    })?;
    let rewritten = rewrite_log_member(&original, new_log)?;
    let new_path = temp_new_path(save_path);

    fs::write(&new_path, &rewritten).map_err(|e| {
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

/// After `remove_file(save_path)` succeeded but `rename(.new → save)` failed:
/// keep `.new`, try to copy it back to `save_path`, and return an error that
/// includes the recovery path. Does **not** delete `.new`.
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

#[derive(Debug, Clone)]
struct ZipMember {
    name: String,
    /// Inclusive start of local file header in the original archive.
    local_start: usize,
    /// Exclusive end of local file record (header + name + extra + data).
    local_end: usize,
    method: u16,
    time: u16,
    date: u16,
    crc32: u32,
    compressed_size: u32,
    uncompressed_size: u32,
    /// Original central-directory external attributes (preserved for non-log).
    external_attributes: u32,
    /// Original version_made_by from CD (preserved for non-log).
    version_made_by: u16,
    version_needed: u16,
    flags: u16,
}

fn rewrite_log_member(original: &[u8], new_log: &[u8]) -> Result<Vec<u8>, AppError> {
    let (members, _cd_start) = parse_zip_members(original)?;
    if !members.iter().any(|m| m.name == "log") {
        return Err(AppError::Io("save zip missing log member".into()));
    }

    let crc = crc32_ieee(new_log);

    let mut out: Vec<u8> = Vec::with_capacity(original.len());
    let mut cd_records: Vec<CdRecord> = Vec::with_capacity(members.len());

    for m in &members {
        if m.name == "signatures" {
            // Stale ECDSA over the pre-edit `log` → Ren'Py 8 refuses to load.
            continue;
        }
        if m.name == "log" {
            let local_offset = out.len() as u32;
            let (method, payload) = if m.method == 0 {
                (0u16, new_log.to_vec())
            } else {
                (8u16, deflate_raw(new_log)?)
            };
            write_local_file(
                &mut out,
                &m.name,
                m.flags,
                method,
                m.time,
                m.date,
                crc,
                payload.len() as u32,
                new_log.len() as u32,
                &payload,
            )?;
            // Ren'Py writes MS-DOS system (0) with a modest external attr.
            cd_records.push(CdRecord {
                name: m.name.clone(),
                version_made_by: 20, // system=0 (DOS), version=20
                version_needed: if method == 0 { 10 } else { 20 },
                flags: m.flags,
                method,
                time: m.time,
                date: m.date,
                crc32: crc,
                compressed_size: payload.len() as u32,
                uncompressed_size: new_log.len() as u32,
                external_attributes: 0x0180_0000,
                local_header_offset: local_offset,
            });
        } else {
            let local_offset = out.len() as u32;
            out.extend_from_slice(&original[m.local_start..m.local_end]);
            cd_records.push(CdRecord {
                name: m.name.clone(),
                // Force DOS host so a prior Unix rewrite cannot stick forever.
                version_made_by: (m.version_made_by & 0x00ff).max(10),
                version_needed: m.version_needed,
                flags: m.flags,
                method: m.method,
                time: m.time,
                date: m.date,
                crc32: m.crc32,
                compressed_size: m.compressed_size,
                uncompressed_size: m.uncompressed_size,
                external_attributes: if m.version_made_by >> 8 == 3 || m.external_attributes == 0
                {
                    0x0180_0000
                } else {
                    m.external_attributes
                },
                local_header_offset: local_offset,
            });
        }
    }

    let cd_offset = out.len() as u32;
    for rec in &cd_records {
        write_central_directory_entry(&mut out, rec)?;
    }
    let cd_size = out.len() as u32 - cd_offset;
    write_eocd(&mut out, cd_records.len() as u16, cd_size, cd_offset)?;
    Ok(out)
}

#[derive(Debug)]
struct CdRecord {
    name: String,
    version_made_by: u16,
    version_needed: u16,
    flags: u16,
    method: u16,
    time: u16,
    date: u16,
    crc32: u32,
    compressed_size: u32,
    uncompressed_size: u32,
    external_attributes: u32,
    local_header_offset: u32,
}

fn parse_zip_members(data: &[u8]) -> Result<(Vec<ZipMember>, usize), AppError> {
    let eocd = find_eocd(data)?;
    if data.len() < eocd + 22 {
        return Err(AppError::Io("zip EOCD truncated".into()));
    }
    let cd_offset = u32::from_le_bytes(data[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
    let total_entries = u16::from_le_bytes(data[eocd + 10..eocd + 12].try_into().unwrap()) as usize;

    let mut members = Vec::with_capacity(total_entries);
    let mut pos = cd_offset;
    for _ in 0..total_entries {
        if pos + 46 > data.len() || &data[pos..pos + 4] != b"PK\x01\x02" {
            return Err(AppError::Io("zip central directory corrupt".into()));
        }
        let version_made_by = u16::from_le_bytes(data[pos + 4..pos + 6].try_into().unwrap());
        let version_needed = u16::from_le_bytes(data[pos + 6..pos + 8].try_into().unwrap());
        let flags = u16::from_le_bytes(data[pos + 8..pos + 10].try_into().unwrap());
        let method = u16::from_le_bytes(data[pos + 10..pos + 12].try_into().unwrap());
        let time = u16::from_le_bytes(data[pos + 12..pos + 14].try_into().unwrap());
        let date = u16::from_le_bytes(data[pos + 14..pos + 16].try_into().unwrap());
        let crc32 = u32::from_le_bytes(data[pos + 16..pos + 20].try_into().unwrap());
        let compressed_size = u32::from_le_bytes(data[pos + 20..pos + 24].try_into().unwrap());
        let uncompressed_size = u32::from_le_bytes(data[pos + 24..pos + 28].try_into().unwrap());
        let name_len = u16::from_le_bytes(data[pos + 28..pos + 30].try_into().unwrap()) as usize;
        let extra_len = u16::from_le_bytes(data[pos + 30..pos + 32].try_into().unwrap()) as usize;
        let comment_len = u16::from_le_bytes(data[pos + 32..pos + 34].try_into().unwrap()) as usize;
        let external_attributes = u32::from_le_bytes(data[pos + 38..pos + 42].try_into().unwrap());
        let local_header_offset =
            u32::from_le_bytes(data[pos + 42..pos + 46].try_into().unwrap()) as usize;
        let name_bytes = &data[pos + 46..pos + 46 + name_len];
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        let local_start = local_header_offset;
        if local_start + 30 > data.len() || &data[local_start..local_start + 4] != b"PK\x03\x04" {
            return Err(AppError::Io(format!(
                "zip local header missing for {name}"
            )));
        }
        let local_name_len =
            u16::from_le_bytes(data[local_start + 26..local_start + 28].try_into().unwrap())
                as usize;
        let local_extra_len =
            u16::from_le_bytes(data[local_start + 28..local_start + 30].try_into().unwrap())
                as usize;
        let local_end =
            local_start + 30 + local_name_len + local_extra_len + compressed_size as usize;
        if local_end > data.len() {
            return Err(AppError::Io(format!("zip local data truncated for {name}")));
        }

        members.push(ZipMember {
            name,
            local_start,
            local_end,
            method,
            time,
            date,
            crc32,
            compressed_size,
            uncompressed_size,
            external_attributes,
            version_made_by,
            version_needed,
            flags,
        });

        pos += 46 + name_len + extra_len + comment_len;
    }

    // Emit members in original local-file order (Ren'Py: screenshot… then log).
    members.sort_by_key(|m| m.local_start);
    Ok((members, cd_offset))
}

fn find_eocd(data: &[u8]) -> Result<usize, AppError> {
    // EOCD is at the end; comment can be up to 64KiB.
    let min = data.len().saturating_sub(22 + 65535);
    for i in (min..=data.len().saturating_sub(22)).rev() {
        if &data[i..i + 4] == b"PK\x05\x06" {
            return Ok(i);
        }
    }
    Err(AppError::Io("zip EOCD not found".into()))
}

fn write_local_file(
    out: &mut Vec<u8>,
    name: &str,
    flags: u16,
    method: u16,
    time: u16,
    date: u16,
    crc: u32,
    compressed_size: u32,
    uncompressed_size: u32,
    data: &[u8],
) -> Result<(), AppError> {
    let name_bytes = name.as_bytes();
    out.extend_from_slice(b"PK\x03\x04");
    out.extend_from_slice(&20u16.to_le_bytes()); // version needed
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&time.to_le_bytes());
    out.extend_from_slice(&date.to_le_bytes());
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&compressed_size.to_le_bytes());
    out.extend_from_slice(&uncompressed_size.to_le_bytes());
    out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // extra len
    out.extend_from_slice(name_bytes);
    out.extend_from_slice(data);
    Ok(())
}

fn write_central_directory_entry(out: &mut Vec<u8>, rec: &CdRecord) -> Result<(), AppError> {
    let name_bytes = rec.name.as_bytes();
    out.extend_from_slice(b"PK\x01\x02");
    out.extend_from_slice(&rec.version_made_by.to_le_bytes());
    out.extend_from_slice(&rec.version_needed.to_le_bytes());
    out.extend_from_slice(&rec.flags.to_le_bytes());
    out.extend_from_slice(&rec.method.to_le_bytes());
    out.extend_from_slice(&rec.time.to_le_bytes());
    out.extend_from_slice(&rec.date.to_le_bytes());
    out.extend_from_slice(&rec.crc32.to_le_bytes());
    out.extend_from_slice(&rec.compressed_size.to_le_bytes());
    out.extend_from_slice(&rec.uncompressed_size.to_le_bytes());
    out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // extra
    out.extend_from_slice(&0u16.to_le_bytes()); // comment
    out.extend_from_slice(&0u16.to_le_bytes()); // disk start
    out.extend_from_slice(&0u16.to_le_bytes()); // internal attr
    out.extend_from_slice(&rec.external_attributes.to_le_bytes());
    out.extend_from_slice(&rec.local_header_offset.to_le_bytes());
    out.extend_from_slice(name_bytes);
    Ok(())
}

fn write_eocd(
    out: &mut Vec<u8>,
    entries: u16,
    cd_size: u32,
    cd_offset: u32,
) -> Result<(), AppError> {
    out.extend_from_slice(b"PK\x05\x06");
    out.extend_from_slice(&0u16.to_le_bytes()); // disk
    out.extend_from_slice(&0u16.to_le_bytes()); // cd disk
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment
    Ok(())
}

fn deflate_raw(data: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| AppError::Io(format!("deflate failed: {e}")))?;
    encoder
        .finish()
        .map_err(|e| AppError::Io(format!("deflate finish failed: {e}")))
}

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut c = crc32fast::Hasher::new();
    c.update(data);
    c.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    /// Ren'Py order: screenshot / metadata first, `log` last.
    fn write_fixture_zip_renpy_order(path: &Path, log: &[u8], screenshot: &[u8]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("screenshot.png", options).unwrap();
        zip.write_all(screenshot).unwrap();
        zip.start_file("extra_info", options).unwrap();
        zip.write_all(b"").unwrap();
        zip.start_file("json", options).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.start_file("renpy_version", options).unwrap();
        zip.write_all(b"7.4.4.1439").unwrap();
        zip.start_file("log", options).unwrap();
        zip.write_all(log).unwrap();
        zip.finish().unwrap();
    }

    fn write_fixture_zip_with_screenshot(path: &Path, log: &[u8], screenshot: &[u8]) {
        write_fixture_zip_renpy_order(path, log, screenshot);
    }

    fn member_bytes(path: &Path, name: &str) -> Vec<u8> {
        let file = File::open(path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).unwrap();
        buf
    }

    fn member_names(path: &Path) -> Vec<String> {
        let file = File::open(path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect()
    }

    fn create_systems(path: &Path) -> Vec<(String, u8)> {
        let data = fs::read(path).unwrap();
        let eocd = find_eocd(&data).unwrap();
        let cd_offset =
            u32::from_le_bytes(data[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
        let total = u16::from_le_bytes(data[eocd + 10..eocd + 12].try_into().unwrap()) as usize;
        let mut pos = cd_offset;
        let mut out = Vec::new();
        for _ in 0..total {
            let ver_made = u16::from_le_bytes(data[pos + 4..pos + 6].try_into().unwrap());
            let nlen = u16::from_le_bytes(data[pos + 28..pos + 30].try_into().unwrap()) as usize;
            let elen = u16::from_le_bytes(data[pos + 30..pos + 32].try_into().unwrap()) as usize;
            let clen = u16::from_le_bytes(data[pos + 32..pos + 34].try_into().unwrap()) as usize;
            let name = String::from_utf8_lossy(&data[pos + 46..pos + 46 + nlen]).into_owned();
            out.push((name, (ver_made >> 8) as u8));
            pos += 46 + nlen + elen + clen;
        }
        out
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
    fn write_log_preserves_member_order() {
        let p = temp_save_path();
        let shot = b"\x89PNG\r\n\x1a\nfake";
        write_fixture_zip_renpy_order(&p, b"old-log", shot);
        let before = member_names(&p);
        assert_eq!(
            before,
            vec![
                "screenshot.png",
                "extra_info",
                "json",
                "renpy_version",
                "log"
            ]
        );

        write_log_bytes(&p, b"new-log").unwrap();
        assert_eq!(member_names(&p), before);
        assert_eq!(read_log_bytes(&p).unwrap(), b"new-log");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn write_log_uses_dos_create_system() {
        let p = temp_save_path();
        write_fixture_zip_renpy_order(&p, b"old-log", b"shot");
        write_log_bytes(&p, b"new-log").unwrap();
        for (name, sys) in create_systems(&p) {
            assert_eq!(sys, 0, "{name} should be MS-DOS create_system=0");
        }
        let _ = fs::remove_file(&p);
    }

    /// Rename failure after live remove is hard to force on Windows; this tests
    /// the recovery helper that must keep `.new` and attempt copy-restore.
    #[test]
    fn recover_after_failed_rename_keeps_new_and_restores() {
        let save = temp_save_path();
        let new_path = temp_new_path(&save);
        fs::write(&new_path, b"recovery-body").unwrap();
        assert!(!save.exists());

        let err = recover_after_failed_rename(
            &new_path,
            &save,
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "simulated rename fail"),
        );

        assert!(
            new_path.exists(),
            ".new must not be deleted on rename failure"
        );
        assert_eq!(fs::read(&new_path).unwrap(), b"recovery-body");
        assert!(
            save.exists(),
            "copy restore should recreate save_path from .new"
        );
        assert_eq!(fs::read(&save).unwrap(), b"recovery-body");

        let msg = err.to_string();
        assert!(
            msg.contains(&new_path.display().to_string()),
            "error must include recovery path for manual recovery: {msg}"
        );
        assert!(
            msg.contains("restored") || msg.contains("recovery file"),
            "error should describe restore/recovery: {msg}"
        );

        let _ = fs::remove_file(&save);
        let _ = fs::remove_file(&new_path);
    }

    #[test]
    fn zip_has_screenshot_false_without_member() {
        let p = temp_save_path();
        write_fixture_zip(&p, b"x");
        assert!(!zip_has_screenshot(&p));
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn write_log_drops_signatures_member() {
        let p = temp_save_path();
        let file = File::create(&p).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("json", options).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.start_file("signatures", options).unwrap();
        zip.write_all(b"fake-ecdsa").unwrap();
        zip.start_file("log", options).unwrap();
        zip.write_all(b"old-log").unwrap();
        zip.finish().unwrap();

        assert!(member_names(&p).contains(&"signatures".to_string()));
        write_log_bytes(&p, b"new-log").unwrap();
        let names = member_names(&p);
        assert!(!names.iter().any(|n| n == "signatures"));
        assert_eq!(read_log_bytes(&p).unwrap(), b"new-log");
        assert_eq!(member_bytes(&p, "json"), b"{}");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn rewrite_matches_fixture_metadata_shape_if_present() {
        let site = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("1-1-LT1.save");
        if !site.exists() {
            return;
        }
        let log = read_log_bytes(&site).unwrap();
        // No-op rewrite of site → should stay DOS and keep order.
        let tmp = temp_save_path();
        fs::copy(&site, &tmp).unwrap();
        write_log_bytes(&tmp, &log).unwrap();
        assert_eq!(member_names(&tmp)[0], "screenshot.png");
        assert_eq!(member_names(&tmp).last().unwrap(), "log");
        for (name, sys) in create_systems(&tmp) {
            assert_eq!(sys, 0, "{name}");
        }
        assert_eq!(read_log_bytes(&tmp).unwrap(), log);
        let _ = fs::remove_file(&tmp);
    }
}
