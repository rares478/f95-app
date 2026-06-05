//! Walk an install directory and index viewable media files.

use crate::error::AppError;
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;

const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct MediaFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct InstallMediaIndex {
    pub images: Vec<MediaFile>,
    pub videos: Vec<MediaFile>,
    pub pdfs: Vec<MediaFile>,
    pub archives: Vec<MediaFile>,
    #[serde(rename = "suggestedEntry")]
    pub suggested_entry: Option<String>,
}

fn ext_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
}

fn classify(ext: &str) -> Option<&'static str> {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => Some("image"),
        "mp4" | "webm" | "mkv" | "avi" | "mov" | "m4v" => Some("video"),
        "pdf" => Some("pdf"),
        "cbz" | "cbr" | "zip" => Some("archive"),
        _ => None,
    }
}

pub fn scan_install(install_path: &Path, category: &str) -> Result<InstallMediaIndex, AppError> {
    if !install_path.is_dir() {
        return Err(AppError::Other(format!(
            "pasta não encontrada: {}",
            install_path.display()
        )));
    }

    let mut images = Vec::new();
    let mut videos = Vec::new();
    let mut pdfs = Vec::new();
    let mut archives = Vec::new();
    let mut total = 0usize;

    for entry in WalkDir::new(install_path)
        .max_depth(MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if total >= MAX_FILES {
            break;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = ext_lower(path) else {
            continue;
        };
        let Some(kind) = classify(&ext) else {
            continue;
        };
        // Skip nested archives inside zips folder noise — still allow top-level cbz
        let meta = entry
            .metadata()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let size = meta.len();
        let file = MediaFile {
            path: path.to_string_lossy().into_owned(),
            name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            size,
        };
        total += 1;
        match kind {
            "image" => images.push(file),
            "video" => videos.push(file),
            "pdf" => pdfs.push(file),
            "archive" => {
                if ext == "cbz" || ext == "cbr" || (ext == "zip" && category == "comics") {
                    archives.push(file);
                }
            }
            _ => {}
        }
    }

    images.sort_by(|a, b| natural_cmp(&a.path, &b.path));
    videos.sort_by(|a, b| natural_cmp(&a.path, &b.path));
    pdfs.sort_by(|a, b| natural_cmp(&a.path, &b.path));
    archives.sort_by(|a, b| natural_cmp(&a.path, &b.path));

    let suggested_entry = pick_suggested(category, &images, &videos, &pdfs, &archives);

    Ok(InstallMediaIndex {
        images,
        videos,
        pdfs,
        archives,
        suggested_entry,
    })
}

/// Compare paths/names in human order: `page2.png` before `page10.png`.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let ta = tokenize_natural(a);
    let tb = tokenize_natural(b);
    for i in 0..ta.len().max(tb.len()) {
        match (ta.get(i), tb.get(i)) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(NatToken::Num(na)), Some(NatToken::Num(nb))) => match na.cmp(nb) {
                std::cmp::Ordering::Equal => {}
                other => return other,
            },
            (Some(NatToken::Str(sa)), Some(NatToken::Str(sb))) => match sa.cmp(sb) {
                std::cmp::Ordering::Equal => {}
                other => return other,
            },
            (Some(NatToken::Num(_)), Some(NatToken::Str(_))) => return std::cmp::Ordering::Less,
            (Some(NatToken::Str(_)), Some(NatToken::Num(_))) => return std::cmp::Ordering::Greater,
        }
    }
    std::cmp::Ordering::Equal
}

enum NatToken {
    Num(u64),
    Str(String),
}

fn tokenize_natural(s: &str) -> Vec<NatToken> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            let mut digits = String::new();
            while chars.peek().is_some_and(|x| x.is_ascii_digit()) {
                digits.push(chars.next().unwrap());
            }
            let n = digits.parse::<u64>().unwrap_or(0);
            out.push(NatToken::Num(n));
        } else {
            let mut text = String::new();
            while chars.peek().is_some_and(|x| !x.is_ascii_digit()) {
                text.push(chars.next().unwrap().to_ascii_lowercase());
            }
            out.push(NatToken::Str(text));
        }
    }
    out
}

fn pick_suggested(
    category: &str,
    images: &[MediaFile],
    videos: &[MediaFile],
    pdfs: &[MediaFile],
    archives: &[MediaFile],
) -> Option<String> {
    match category {
        "animations" => videos.first().map(|f| f.path.clone()),
        "comics" => pdfs
            .first()
            .map(|f| f.path.clone())
            .or_else(|| archives.first().map(|f| f.path.clone()))
            .or_else(|| images.first().map(|f| f.path.clone())),
        "assets" => images
            .first()
            .map(|f| f.path.clone())
            .or_else(|| pdfs.first().map(|f| f.path.clone())),
        _ => images
            .first()
            .map(|f| f.path.clone())
            .or_else(|| videos.first().map(|f| f.path.clone()))
            .or_else(|| pdfs.first().map(|f| f.path.clone())),
    }
}

/// Extract image entries from a CBZ/CBR (treated as zip) into a temp folder.
pub fn extract_cbz_images(
    archive_path: &Path,
    dest: &Path,
    max_pages: usize,
) -> Result<Vec<String>, AppError> {
    use std::fs;
    use std::io;

    if !archive_path.is_file() {
        return Err(AppError::Other(format!(
            "arquivo não encontrado: {}",
            archive_path.display()
        )));
    }
    fs::create_dir_all(dest).map_err(|e| AppError::Other(e.to_string()))?;

    let f = fs::File::open(archive_path).map_err(|e| AppError::Other(e.to_string()))?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| AppError::Other(format!("cbz open: {e}")))?;

    let mut image_paths: Vec<(String, String)> = Vec::new();

    for i in 0..z.len() {
        let mut entry = z
            .by_index(i)
            .map_err(|e| AppError::Other(format!("cbz entry {i}: {e}")))?;
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let ext = ext_lower(&rel).unwrap_or_default();
        if !matches!(
            ext.as_str(),
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
        ) {
            continue;
        }
        let out = dest.join(&rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
        }
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| AppError::Other(e.to_string()))?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
            }
            let mut writer = fs::File::create(&out).map_err(|e| AppError::Other(e.to_string()))?;
            io::copy(&mut entry, &mut writer).map_err(|e| AppError::Other(e.to_string()))?;
            let sort_key = rel.to_string_lossy().replace('\\', "/");
            image_paths.push((sort_key, out.to_string_lossy().into_owned()));
        }
    }

    image_paths.sort_by(|a, b| natural_cmp(&a.0, &b.0));
    let paths: Vec<String> = image_paths
        .into_iter()
        .map(|(_, p)| p)
        .take(max_pages)
        .collect();
    Ok(paths)
}
