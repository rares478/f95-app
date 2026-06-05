//! Cached downscaled previews for the media viewer (optional; not on the hot path).

use crate::error::AppError;
use image::GenericImageView;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const THUMB_MAX: u32 = 120;
const DISPLAY_MAX: u32 = 1920;
const DISPLAY_SKIP_BYTES: u64 = 3 * 1024 * 1024;
const THUMB_SKIP_BYTES: u64 = 400 * 1024;

fn max_edge_for_variant(variant: &str) -> Result<u32, AppError> {
    match variant {
        "thumb" => Ok(THUMB_MAX),
        "display" => Ok(DISPLAY_MAX),
        _ => Err(AppError::Other(format!(
            "variant inválido: {variant} (use thumb ou display)"
        ))),
    }
}

/// Returns a filesystem path safe for `convertFileSrc` (cached JPEG preview or original).
pub fn resolve_preview(
    source: &Path,
    variant: &str,
    cache_root: &Path,
) -> Result<String, AppError> {
    if !source.is_file() {
        return Err(AppError::Other(format!(
            "arquivo não encontrado: {}",
            source.display()
        )));
    }

    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if variant == "display" && ext == "gif" {
        return Ok(source.to_string_lossy().into_owned());
    }

    let meta = fs::metadata(source).map_err(|e| AppError::Other(e.to_string()))?;
    let file_size = meta.len();

    if variant == "display" && file_size <= DISPLAY_SKIP_BYTES {
        return Ok(source.to_string_lossy().into_owned());
    }
    if variant == "thumb" && file_size <= THUMB_SKIP_BYTES {
        return Ok(source.to_string_lossy().into_owned());
    }

    let max_edge = max_edge_for_variant(variant)?;
    let modified = meta
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let cache_path = cache_file_path(cache_root, source, variant, file_size, modified);
    if cache_path.is_file() {
        return Ok(cache_path.to_string_lossy().into_owned());
    }

    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
    }

    let img = image::open(source).map_err(|e| AppError::Other(format!("imagem: {e}")))?;
    let (w, h) = img.dimensions();

    if w <= max_edge && h <= max_edge {
        return Ok(source.to_string_lossy().into_owned());
    }

    let preview = img.thumbnail(max_edge, max_edge);
    let rgb = preview.to_rgb8();
    let quality = if variant == "thumb" { 72 } else { 82 };
    let mut out = fs::File::create(&cache_path).map_err(|e| AppError::Other(e.to_string()))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| AppError::Other(format!("jpeg encode: {e}")))?;

    Ok(cache_path.to_string_lossy().into_owned())
}

fn cache_file_path(
    cache_root: &Path,
    source: &Path,
    variant: &str,
    size: u64,
    modified_secs: u64,
) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(source.to_string_lossy().as_bytes());
    hasher.update(variant.as_bytes());
    hasher.update(size.to_le_bytes());
    hasher.update(modified_secs.to_le_bytes());
    let hash = hex::encode(hasher.finalize());
    cache_root.join(variant).join(format!("{hash}.jpg"))
}
