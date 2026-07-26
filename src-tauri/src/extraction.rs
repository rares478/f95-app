//! Archive extraction + main-executable heuristic.
//!
//! Prefers the native 7-Zip CLI when available (same engine users get from
//! right-click → Extract) because the pure-Rust backends are much slower on
//! large game archives. Falls back to in-process `.zip` / `.7z` / `.rar`
//! extractors when 7-Zip is not installed.
//! After extracting, walk the destination tree and pick the most likely game
//! executable using a small scoring function (filename match, depth, block
//! patterns for installers/redistributables).

use crate::error::AppError;
use serde_json::json;
use std::fs;
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const COPY_BUF: usize = 1024 * 1024;

pub type ExtractProgressFn = Arc<dyn Fn(u8, Option<u64>) + Send + Sync>;

/// Extract `archive` into `dest`. The dest directory is created if missing.
/// Existing files inside it are overwritten. Returns the dest path on success.
pub fn extract(
    archive: &Path,
    dest: &Path,
    bundled_7z: Option<&Path>,
    progress: Option<ExtractProgressFn>,
) -> Result<(), AppError> {
    let start = Instant::now();
    if let Some(ref cb) = progress {
        cb(0, None);
    }
    let result = if let Some(seven_zip) = find_7z_executable(bundled_7z) {
        extract_with_7z(&seven_zip, archive, dest, progress.clone(), start)
    } else {
        extract_in_process(archive, dest, progress.clone(), start)
    };
    if result.is_ok() {
        if let Some(ref cb) = progress {
            cb(100, Some(0));
        }
    }
    result
}

fn extract_in_process(
    archive: &Path,
    dest: &Path,
    progress: Option<ExtractProgressFn>,
    start: Instant,
) -> Result<(), AppError> {
    let ext = archive
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "zip" => extract_zip(archive, dest, progress, start),
        "7z" => extract_7z(archive, dest),
        "rar" => extract_rar(archive, dest),
        other => Err(AppError::keyed_vars(
            "error.extract.unsupported",
            json!({ "ext": other }),
        )),
    }
}

/// Run `7z x` with multithreading enabled. 7-Zip exit code 1 is a warning
/// (e.g. locked temp files) and is treated as success.
fn extract_with_7z(
    exe: &Path,
    archive: &Path,
    dest: &Path,
    progress: Option<ExtractProgressFn>,
    start: Instant,
) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    // `-o` must be glued to the path with no space between them.
    let out_arg = format!("-o{}", dest.display());
    let mut child = Command::new(exe)
        .arg("x")
        .arg("-y")
        .arg("-mmt=on")
        .arg("-bsp1")
        .arg("-bso0")
        .arg("-bse2")
        .arg(&out_arg)
        .arg(archive)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("7z spawn ({}): {e}", exe.display()) }),
            )
        })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": "7z stdout unavailable" }),
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": "7z stderr unavailable" }),
        )
    })?;

    let progress_stdout = progress.clone();
    let stdout_handle = thread::spawn(move || {
        read_7z_progress(stdout, progress_stdout, start);
    });
    let stderr_handle = thread::spawn(move || drain_stream(stderr));

    let status = child.wait().map_err(|e| {
        AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": format!("7z wait: {e}") }),
        )
    })?;
    stdout_handle.join().ok();
    stderr_handle.join().ok();

    let code = status.code().unwrap_or(2);
    if code >= 2 {
        return Err(AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": format!("7z exit {code}") }),
        ));
    }
    Ok(())
}

fn read_7z_progress<R: Read + Send + 'static>(
    mut reader: R,
    progress: Option<ExtractProgressFn>,
    start: Instant,
) {
    let Some(cb) = progress else {
        drain_stream(reader);
        return;
    };

    let mut buf = [0u8; 256];
    let mut acc = String::new();
    let mut last_pct = 0u8;
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                if acc.len() > 8192 {
                    acc = acc.split_off(acc.len().saturating_sub(4096));
                }
                let Some(pct) = last_percent_in(&acc) else {
                    continue;
                };
                if pct == last_pct {
                    continue;
                }
                if pct < 100 && last_emit.elapsed() < Duration::from_millis(250) {
                    continue;
                }
                last_pct = pct;
                last_emit = Instant::now();
                cb(pct, compute_eta(start.elapsed(), pct));
            }
            Err(_) => break,
        }
    }
}

fn drain_stream<R: Read + Send + 'static>(mut reader: R) {
    let mut buf = [0u8; 4096];
    while reader.read(&mut buf).unwrap_or(0) > 0 {}
}

fn last_percent_in(text: &str) -> Option<u8> {
    let bytes = text.as_bytes();
    let mut i = bytes.len();
    while i > 0 {
        if bytes[i - 1] == b'%' {
            let mut j = i - 1;
            while j > 0 && bytes[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i - 1 {
                if let Ok(text) = std::str::from_utf8(&bytes[j..i - 1]) {
                    if let Ok(n) = text.parse::<u16>() {
                        return Some(n.min(100) as u8);
                    }
                }
            }
        }
        i -= 1;
    }
    None
}

fn compute_eta(elapsed: Duration, pct: u8) -> Option<u64> {
    if pct == 0 || pct >= 100 {
        return None;
    }
    let secs = elapsed.as_secs_f64();
    Some(((secs * (100.0 - pct as f64)) / pct as f64).round() as u64)
}

fn emit_entry_progress(
    progress: &Option<ExtractProgressFn>,
    start: Instant,
    index: usize,
    total: usize,
) {
    if let Some(ref cb) = progress {
        let pct = (((index + 1) * 100) / total.max(1)).min(100) as u8;
        cb(pct, compute_eta(start.elapsed(), pct));
    }
}

fn find_7z_executable(bundled_7z: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = bundled_7z {
        if path.is_file() {
            return Some(path.to_path_buf());
        }
    }
    #[cfg(windows)]
    {
        for candidate in [
            PathBuf::from(r"C:\Program Files\7-Zip\7z.exe"),
            PathBuf::from(r"C:\Program Files\7-Zip\7za.exe"),
            PathBuf::from(r"C:\Program Files (x86)\7-Zip\7z.exe"),
            PathBuf::from(r"C:\Program Files (x86)\7-Zip\7za.exe"),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        return find_on_path(&["7z.exe", "7z", "7za.exe", "7za"]);
    }
    #[cfg(not(windows))]
    {
        find_on_path(&["7z", "7za", "7zr"])
    }
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let lookup = if cfg!(windows) { "where" } else { "which" };
    for name in names {
        let output = Command::new(lookup).arg(name).output().ok()?;
        if !output.status.success() {
            continue;
        }
        let line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()?
            .trim()
            .to_string();
        if line.is_empty() {
            continue;
        }
        let path = PathBuf::from(line);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn extract_zip(
    archive: &Path,
    dest: &Path,
    progress: Option<ExtractProgressFn>,
    start: Instant,
) -> Result<(), AppError> {
    let f = fs::File::open(archive).map_err(io_err)?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| {
        AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": format!("zip open: {e}") }),
        )
    })?;
    fs::create_dir_all(dest).map_err(io_err)?;
    let total = z.len().max(1);
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("zip entry {i}: {e}") }),
            )
        })?;
        // enclosed_name strips absolute paths and "../" segments - defense
        // against zip-slip.
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(io_err)?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            let file = fs::File::create(&out).map_err(io_err)?;
            let mut writer = BufWriter::with_capacity(COPY_BUF, file);
            io::copy(&mut entry, &mut writer).map_err(io_err)?;
            writer.flush().map_err(io_err)?;
        }
        emit_entry_progress(&progress, start, i, total);
    }
    Ok(())
}

fn extract_7z(archive: &Path, dest: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    sevenz_rust2::decompress_file(archive, dest).map_err(|e| {
        AppError::keyed_vars(
            "error.extract.failed",
            json!({ "detail": format!("7z: {e}") }),
        )
    })?;
    Ok(())
}

/// Extracts a `.rar` archive (single or multi-volume - point at the first
/// volume for multi-part sets). Uses the `unrar` crate which statically links
/// the official UnRAR C++ engine; no DLL needed on Windows. Encrypted archives
/// surface a "missing password" error since we don't prompt - the user can
/// extract those manually with 7-Zip.
fn extract_rar(archive: &Path, dest: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dest).map_err(io_err)?;
    let mut open = unrar::Archive::new(archive)
        .open_for_processing()
        .map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("rar open ({}): {e}", archive.display()) }),
            )
        })?;
    loop {
        let next = open.read_header().map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("rar read header: {e}") }),
            )
        })?;
        let Some(header) = next else { break };
        let is_file = header.entry().is_file();
        open = if is_file {
            header.extract_with_base(dest).map_err(|e| {
                AppError::keyed_vars(
                    "error.extract.failed",
                    json!({ "detail": format!("rar extract: {e}") }),
                )
            })?
        } else {
            header.skip().map_err(|e| {
                AppError::keyed_vars(
                    "error.extract.failed",
                    json!({ "detail": format!("rar skip: {e}") }),
                )
            })?
        };
    }
    Ok(())
}

fn io_err(e: io::Error) -> AppError {
    AppError::keyed_vars("error.extract.failed", json!({ "detail": e.to_string() }))
}

// -- main exe heuristic -------------------------------------------------------

const BLOCK_KEYWORDS: &[&str] = &[
    "unins",
    "uninst",
    "uninstall",
    "setup",
    "install",
    "redist",
    "_commonredist",
    "directx",
    "vc_redist",
    "vcredist",
    "dotnet",
    "ffmpeg",
    "crashpad",
    "crashreport",
    "updater",
    "python.exe",
    "node.exe",
    "pythonw.exe",
    "remove.exe",
    "regsvr",
];

/// Walk `root` recursively and return the most likely game executable.
/// Returns `None` if no candidates exist or all of them look like
/// installers/redists.
pub fn find_main_exe(root: &Path, game_title: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    walk(root, &mut candidates, 0);
    if candidates.is_empty() {
        return None;
    }
    let title_key = first_word_lowercase(game_title);
    candidates.sort_by_key(|p| score_path(p, root, &title_key));
    // Pull the best (lowest score). If everything is blocked, return None so
    // the user can pick manually.
    let best = candidates.into_iter().next()?;
    let best_score = score_path(&best, root, &title_key);
    if best_score >= 10_000 {
        None
    } else {
        Some(best)
    }
}

fn first_word_lowercase(title: &str) -> String {
    title
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase()
        // Strip surrounding punctuation that often clings to the first word.
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string()
}

fn score_path(path: &Path, root: &Path, title_key: &str) -> i64 {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel_str = rel.to_string_lossy().to_lowercase();

    // Block list - block hits dominate any positive signals.
    for kw in BLOCK_KEYWORDS {
        if rel_str.contains(kw) {
            return 10_000;
        }
    }

    let mut score: i64 = 0;

    // Strong positive (lower score) for matching the game title prefix.
    if !title_key.is_empty() && name.contains(title_key) {
        score -= 1000;
    }
    // Common launcher filenames.
    match name.as_str() {
        "game.exe" | "start.exe" | "play.exe" | "launch.exe" | "launcher.exe" => score -= 500,
        _ => {}
    }
    if name.starts_with("game-") || name.starts_with("game_") {
        score -= 200;
    }

    // Penalize depth so a top-level exe wins ties.
    let depth = rel.components().count() as i64;
    score += depth * 10;
    // Mild preference for shorter filenames (cleaner ones tend to be shorter).
    score += name.len() as i64;

    score
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return; // safety net for pathological archives
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.file_type() else {
            continue;
        };
        if meta.is_dir() {
            walk(&path, out, depth + 1);
        } else if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_percent_from_7z_stream() {
        assert_eq!(last_percent_in("  0%\r"), Some(0));
        assert_eq!(last_percent_in("Extracting\r 42%\r"), Some(42));
        assert_eq!(last_percent_in("no progress"), None);
    }

    #[test]
    fn computes_eta_from_elapsed_and_percent() {
        let elapsed = Duration::from_secs(30);
        assert_eq!(compute_eta(elapsed, 50), Some(30));
        assert_eq!(compute_eta(elapsed, 0), None);
        assert_eq!(compute_eta(elapsed, 100), None);
    }
}
