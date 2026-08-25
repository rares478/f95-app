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
use crate::extract_jobs::ExtractCancel;
use serde_json::json;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const COPY_BUF: usize = 1024 * 1024;
const DISK_SPACE_MARGIN: u64 = 256 * 1024 * 1024;

pub type ExtractProgressFn = Arc<dyn Fn(u8, Option<u64>) + Send + Sync>;

fn cancelled_err() -> AppError {
    AppError::keyed("error.extract.cancelled")
}

fn check_cancelled(cancel: Option<&ExtractCancel>) -> Result<(), AppError> {
    if cancel.is_some_and(|c| c.is_cancelled()) {
        Err(cancelled_err())
    } else {
        Ok(())
    }
}

/// Extract `archive` into `dest`. The dest directory is created if missing.
/// Existing files inside it are overwritten. Returns the dest path on success.
pub fn extract(
    archive: &Path,
    dest: &Path,
    bundled_7z: Option<&Path>,
    progress: Option<ExtractProgressFn>,
    cancel: Option<&ExtractCancel>,
) -> Result<(), AppError> {
    check_cancelled(cancel)?;
    let start = Instant::now();
    if let Some(ref cb) = progress {
        cb(0, None);
    }
    let result = if let Some(seven_zip) = find_7z_executable(bundled_7z) {
        extract_with_7z(&seven_zip, archive, dest, progress.clone(), start, cancel)
    } else {
        extract_in_process(archive, dest, progress.clone(), start, cancel)
    };
    if result.is_ok() {
        check_cancelled(cancel)?;
        if let Some(ref cb) = progress {
            cb(100, Some(0));
        }
    }
    result
}

fn preflight_disk_space(archive: &Path, dest: &Path, ext: &str) -> Result<(), AppError> {
    let needed = estimated_unpacked_size(archive, ext).unwrap_or_else(|| {
        fs::metadata(archive).map(|m| m.len().saturating_mul(2)).unwrap_or(0)
    });
    if needed == 0 {
        return Ok(());
    }
    let probe = if dest.exists() {
        dest
    } else {
        dest.parent().unwrap_or(dest)
    };
    let Ok(free) = fs4::available_space(probe) else {
        return Ok(());
    };
    let needed_total = needed.saturating_add(DISK_SPACE_MARGIN);
    if free < needed_total {
        return Err(AppError::Other(format!(
            "Espaço em disco insuficiente para extrair: o conteúdo precisa de ~{} e o destino ({}) tem só {} livres. Libere espaço ou adicione uma biblioteca de instalação em outro disco (Configurações → Armazenamento).",
            fmt_bytes(needed_total),
            probe.display(),
            fmt_bytes(free)
        )));
    }
    Ok(())
}

fn estimated_unpacked_size(archive: &Path, ext: &str) -> Option<u64> {
    match ext {
        "zip" => {
            let f = fs::File::open(archive).ok()?;
            let mut z = zip::ZipArchive::new(f).ok()?;
            let mut total = 0u64;
            for i in 0..z.len() {
                if let Ok(entry) = z.by_index_raw(i) {
                    total = total.saturating_add(entry.size());
                }
            }
            Some(total)
        }
        "rar" => {
            let open = unrar::Archive::new(archive).open_for_listing().ok()?;
            let mut total = 0u64;
            for header in open.flatten() {
                total = total.saturating_add(header.unpacked_size);
            }
            Some(total)
        }
        _ => None,
    }
}

fn fmt_bytes(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else {
        format!("{:.0} MB", b / MB)
    }
}

fn extract_in_process(
    archive: &Path,
    dest: &Path,
    progress: Option<ExtractProgressFn>,
    start: Instant,
    cancel: Option<&ExtractCancel>,
) -> Result<(), AppError> {
    let ext = archive
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    preflight_disk_space(archive, dest, &ext)?;
    check_cancelled(cancel)?;
    match ext.as_str() {
        "zip" => extract_zip(archive, dest, progress, start, cancel),
        "7z" => {
            check_cancelled(cancel)?;
            extract_7z(archive, dest)
        }
        "rar" => extract_rar(archive, dest, cancel),
        other => Err(AppError::keyed_vars(
            "error.extract.unsupported",
            json!({ "ext": other }),
        )),
    }
}

/// Run `7z x` with multithreading enabled.
///
/// Exit code 1 is a warning (non-fatal) and is treated as success.
/// Exit code 2 is normally fatal, but 7-Zip also returns 2 when it cannot
/// overwrite one or more existing files that are locked by another process —
/// even after successfully extracting everything else. Re-extracts into an
/// existing game folder hit this often; we treat lock-only failures as success
/// when the destination already has extracted files.
fn extract_with_7z(
    exe: &Path,
    archive: &Path,
    dest: &Path,
    progress: Option<ExtractProgressFn>,
    start: Instant,
    cancel: Option<&ExtractCancel>,
) -> Result<(), AppError> {
    check_cancelled(cancel)?;
    fs::create_dir_all(dest).map_err(io_err)?;
    // `-o` must be glued to the path with no space; keep raw OsStr so Unicode
    // install paths are not lossily mangled via Display.
    let mut out_arg = OsString::from("-o");
    out_arg.push(dest.as_os_str());
    let mut cmd = Command::new(exe);
    cmd.arg("x")
        .arg("-y")
        .arg("-aoa")
        .arg("-mmt=on")
        .arg("-bsp1")
        .arg("-bso0")
        .arg("-bse2")
        .arg(&out_arg)
        .arg(archive)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Avoid a flashing console window when the GUI host spawns 7za.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| {
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
    let stderr_handle = thread::spawn(move || read_stream_to_string(stderr));

    let status = if let Some(token) = cancel {
        token.wait_child(child)?
    } else {
        child.wait().map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("7z wait: {e}") }),
            )
        })?
    };
    stdout_handle.join().ok();
    let stderr_text = stderr_handle.join().unwrap_or_default();

    if cancel.is_some_and(|c| c.is_cancelled()) {
        return Err(cancelled_err());
    }

    let code = status.code().unwrap_or(2);
    if code < 2 {
        return Ok(());
    }

    // Locked overwrite during re-extract: files are on disk, 7-Zip still exits 2.
    if is_lock_only_extract_failure(&stderr_text) && dest_has_any_file(dest) {
        eprintln!(
            "[extract] 7z exit {code} with lock-only overwrite errors; treating as success. stderr:\n{stderr_text}"
        );
        return Ok(());
    }

    let detail = if stderr_text.trim().is_empty() {
        format!("7z exit {code}")
    } else {
        let trimmed = stderr_text.trim();
        let short = if trimmed.len() > 500 {
            format!("{}…", &trimmed[..500])
        } else {
            trimmed.to_string()
        };
        format!("7z exit {code}: {short}")
    };
    Err(AppError::keyed_vars(
        "error.extract.failed",
        json!({ "detail": detail }),
    ))
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

fn read_stream_to_string<R: Read + Send + 'static>(mut reader: R) -> String {
    let mut buf = Vec::new();
    let _ = reader.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// True when 7-Zip's stderr only reports output-file lock/overwrite problems
/// (files in use), not archive-level failures.
fn is_lock_only_extract_failure(stderr: &str) -> bool {
    let text = stderr.trim();
    if text.is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    if lower.contains("can not open the file as archive")
        || lower.contains("cannot open the file as archive")
        || lower.contains("is not archive")
        || lower.contains("wrong password")
        || lower.contains("unsupported method")
    {
        return false;
    }

    let mut saw_error = false;
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        let ll = l.to_ascii_lowercase();
        if !(ll.starts_with("error:") || ll.starts_with("error :") || ll.starts_with("system error:"))
        {
            continue;
        }
        saw_error = true;
        let lockish = ll.contains("cannot delete output file")
            || ll.contains("cannot open output file")
            || ll.contains("cannot create output file")
            || ll.contains("being used by another process")
            || ll.contains("access is denied")
            || ll.contains("process cannot access the file");
        if !lockish {
            return false;
        }
    }
    saw_error
}

fn dest_has_any_file(dest: &Path) -> bool {
    fn walk(dir: &Path, depth: u8) -> bool {
        if depth > 12 {
            return false;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return false;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_file() {
                return true;
            }
            if ft.is_dir() && walk(&path, depth + 1) {
                return true;
            }
        }
        false
    }
    walk(dest, 0)
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
    cancel: Option<&ExtractCancel>,
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
        check_cancelled(cancel)?;
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
fn extract_rar(
    archive: &Path,
    dest: &Path,
    cancel: Option<&ExtractCancel>,
) -> Result<(), AppError> {
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
        check_cancelled(cancel)?;
        let next = open.read_header().map_err(|e| {
            AppError::keyed_vars(
                "error.extract.failed",
                json!({ "detail": format!("rar read header: {e}") }),
            )
        })?;
        let Some(header) = next else { break };
        let is_file = header.entry().is_file();
        let entry_name = header.entry().filename.display().to_string();
        open = if is_file {
            header
                .extract_with_base(dest)
                .map_err(|e| rar_extract_error(e, &entry_name, dest))?
        } else {
            header.skip().map_err(|e| {
                AppError::keyed_vars(
                    "error.extract.failed",
                    json!({ "detail": format!("rar skip ({entry_name}): {e}") }),
                )
            })?
        };
    }
    Ok(())
}

/// "Could not create file" do UnRAR (ERAR_ECREATE) não diz o porquê; os dois
/// culpados reais são disco cheio e caminho acima do limite do Windows.
/// Anexa o diagnóstico para o usuário não ficar no escuro.
fn rar_extract_error(e: unrar::error::UnrarError, entry_name: &str, dest: &Path) -> AppError {
    let base = format!("rar extract ({entry_name}): {e}");
    let msg = e.to_string().to_lowercase();
    if msg.contains("could not create") || msg.contains("write") {
        let free = fs4::available_space(dest)
            .map(fmt_bytes)
            .unwrap_or_else(|_| "?".into());
        let full_path_len = dest.join(entry_name).as_os_str().len();
        let hint = if full_path_len > 250 {
            format!(
                "O caminho de destino tem {full_path_len} caracteres — acima do limite do Windows. Mova a biblioteca de instalação para um caminho mais curto."
            )
        } else {
            format!(
                "Provável disco cheio (livres no destino: {free}). Libere espaço ou adicione uma biblioteca de instalação em outro disco (Configurações → Armazenamento)."
            )
        };
        return AppError::Other(format!("{base}. {hint}"));
    }
    AppError::Other(base)
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
    "crashhandler",
    "bugreporter",
    "unitycrashhandler",
    "unityplayer",
    "monobleedingedge",
    "createdump",
    "updater",
    "python.exe",
    "node.exe",
    "pythonw.exe",
    "remove.exe",
    "regsvr",
];

/// When the best candidate scores above this, treat detection as uncertain
/// and return `None` so the user picks manually.
const UNCERTAIN_SCORE_THRESHOLD: i64 = 45;

/// Walk `root` recursively and return the most likely game executable.
/// Returns `None` if no candidates exist or all of them look like
/// installers/redistributables.
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
    if best_score >= 10_000 || best_score > UNCERTAIN_SCORE_THRESHOLD {
        None
    } else {
        Some(best)
    }
}

/// Pick launch file by engine hint: HTML engine → HTML entry; otherwise `.exe` only.
pub fn find_main_launch(root: &Path, game_title: &str, prefer_html: bool) -> Option<PathBuf> {
    if prefer_html {
        find_main_html(root, game_title)
    } else {
        find_main_exe(root, game_title)
    }
}

/// Walk for `index.html` / title-like HTML entry pages (browser games).
pub fn find_main_html(root: &Path, game_title: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    walk_html(root, &mut candidates, 0);
    if candidates.is_empty() {
        return None;
    }
    let title_key = first_word_lowercase(game_title);
    candidates.sort_by_key(|p| score_html_path(p, root, &title_key));
    let best = candidates.into_iter().next()?;
    let best_score = score_html_path(&best, root, &title_key);
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
    // Unity ships support binaries inside *_Data and MonoBleedingEdge trees.
    if is_blocked_support_path(&rel_str) {
        return 10_000;
    }

    let mut score: i64 = 0;

    // Strong positive (lower score) for matching the game title prefix.
    if !title_key.is_empty() && name.contains(title_key) {
        score -= 1000;
    }
    // Unity games ship Foo.exe alongside Foo_Data/.
    if has_unity_data_sibling(path) {
        score -= 800;
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

fn is_blocked_support_path(rel_str: &str) -> bool {
    rel_str.contains("_data/") || rel_str.contains("_data\\")
}

fn has_unity_data_sibling(path: &Path) -> bool {
    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) if !s.is_empty() => s,
        _ => return false,
    };
    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };
    parent.join(format!("{stem}_Data")).is_dir()
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

const HTML_BLOCK_KEYWORDS: &[&str] = &[
    "node_modules",
    "bower_components",
    "/docs/",
    "\\docs\\",
    "/test/",
    "\\test\\",
    "/tests/",
    "\\tests\\",
    "readme",
    "changelog",
    "license",
];

fn score_html_path(path: &Path, root: &Path, title_key: &str) -> i64 {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel_str = rel.to_string_lossy().to_lowercase();

    for kw in HTML_BLOCK_KEYWORDS {
        if rel_str.contains(kw) {
            return 10_000;
        }
    }

    let mut score: i64 = 0;
    if stem == "index" {
        score -= 2000;
    }
    if !title_key.is_empty() && (stem.contains(title_key) || name.contains(title_key)) {
        score -= 1000;
    }
    match stem.as_str() {
        "game" | "play" | "start" | "main" | "launch" => score -= 500,
        _ => {}
    }
    let depth = rel.components().count() as i64;
    score += depth * 10;
    score += name.len() as i64;
    score
}

fn walk_html(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 8 {
        return;
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
            let dirname = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if dirname == "node_modules" || dirname == "bower_components" {
                continue;
            }
            walk_html(&path, out, depth + 1);
        } else if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"))
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

    #[test]
    fn lock_only_stderr_is_soft_failure() {
        let stderr = "ERROR: Cannot delete output file : The process cannot access the file because it is being used by another process. : C:\\games\\Game.exe\n";
        assert!(is_lock_only_extract_failure(stderr));
    }

    #[test]
    fn archive_open_stderr_is_hard_failure() {
        let stderr = "ERROR: Can not open the file as archive\n";
        assert!(!is_lock_only_extract_failure(stderr));
    }

    #[test]
    fn mixed_lock_and_hard_error_is_hard_failure() {
        let stderr = "\
ERROR: Cannot delete output file : The process cannot access the file because it is being used by another process. : C:\\a.exe
ERROR: Can not open the file as archive
";
        assert!(!is_lock_only_extract_failure(stderr));
    }

    fn test_root(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "f95_app_test_{name}_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn find_main_exe_prefers_unity_game_over_crash_handler() {
        let root = test_root("unity_pick");
        std::fs::write(root.join("UnityCrashHandler64.exe"), b"").unwrap();
        std::fs::write(root.join("MyGame.exe"), b"").unwrap();
        std::fs::create_dir(root.join("MyGame_Data")).unwrap();

        let found = find_main_exe(&root, "My Game").expect("game exe");
        assert_eq!(found.file_name().unwrap().to_str().unwrap(), "MyGame.exe");
    }

    #[test]
    fn find_main_exe_blocks_crashreport() {
        let root = test_root("crashreport");
        std::fs::write(root.join("CrashReport.exe"), b"").unwrap();

        assert!(find_main_exe(&root, "Some Game").is_none());
    }

    #[test]
    fn find_main_exe_blocks_support_exes_inside_data_folder() {
        let root = test_root("data_plugins");
        let data = root.join("Game_Data");
        std::fs::create_dir_all(data.join("Plugins")).unwrap();
        std::fs::write(data.join("Plugins").join("helper.exe"), b"").unwrap();

        assert!(find_main_exe(&root, "Game").is_none());
    }

    #[test]
    fn find_main_exe_returns_none_when_only_uncertain_candidates() {
        let root = test_root("uncertain");
        std::fs::write(
            root.join("SomeRandomLongUtilityNameThatIsNotTheGame.exe"),
            b"",
        )
        .unwrap();

        assert!(find_main_exe(&root, "Totally Different Title").is_none());
    }

    #[test]
    fn find_main_html_prefers_index() {
        let root = test_root("html_index");
        std::fs::write(root.join("about.html"), b"").unwrap();
        std::fs::write(root.join("index.html"), b"").unwrap();

        let found = find_main_html(&root, "Masters of Raana").expect("html");
        assert_eq!(found.file_name().unwrap().to_str().unwrap(), "index.html");
    }

    #[test]
    fn find_main_html_prefers_title_match() {
        let root = test_root("html_title");
        std::fs::write(root.join("credits.html"), b"").unwrap();
        std::fs::write(root.join("MastersOfRaana.html"), b"").unwrap();

        let found = find_main_html(&root, "Masters of Raana").expect("html");
        assert_eq!(
            found.file_name().unwrap().to_str().unwrap(),
            "MastersOfRaana.html"
        );
    }

    #[test]
    fn find_main_launch_html_engine_finds_index() {
        let root = test_root("launch_html");
        std::fs::write(root.join("index.html"), b"").unwrap();

        let found = find_main_launch(&root, "MoR", true).expect("launch");
        assert_eq!(found.file_name().unwrap().to_str().unwrap(), "index.html");
    }

    #[test]
    fn find_main_launch_non_html_skips_html() {
        let root = test_root("launch_exe_only");
        std::fs::write(root.join("index.html"), b"").unwrap();

        assert!(find_main_launch(&root, "MoR", false).is_none());
    }

    #[test]
    fn find_main_launch_non_html_prefers_exe() {
        let root = test_root("launch_exe");
        std::fs::write(root.join("index.html"), b"").unwrap();
        std::fs::write(root.join("Game.exe"), b"").unwrap();

        let found = find_main_launch(&root, "Game", false).expect("launch");
        assert_eq!(found.file_name().unwrap().to_str().unwrap(), "Game.exe");
    }
}
