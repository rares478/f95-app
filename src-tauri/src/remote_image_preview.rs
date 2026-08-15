//! Download + resize remote images (F95 screenshots, etc.) for UI grids.

use crate::error::AppError;
use image::GenericImageView;
use reqwest::Client;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const PROBE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GRID_MAX_EDGE: u32 = 720;
const GRID_JPEG_QUALITY: u8 = 84;
const LIBRARY_MAX_EDGE: u32 = 720;
const LIBRARY_JPEG_QUALITY: u8 = 88;

struct VariantSpec {
    max_edge: u32,
    jpeg_quality: u8,
}

fn variant_spec(variant: &str) -> Result<VariantSpec, AppError> {
    match variant {
        "grid" => Ok(VariantSpec {
            max_edge: GRID_MAX_EDGE,
            jpeg_quality: GRID_JPEG_QUALITY,
        }),
        "library" => Ok(VariantSpec {
            max_edge: LIBRARY_MAX_EDGE,
            jpeg_quality: LIBRARY_JPEG_QUALITY,
        }),
        _ => Err(AppError::keyed_vars(
            "error.media.invalidVariant",
            json!({ "variant": variant }),
        )),
    }
}

fn is_f95_attachment(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("f95zone") || lower.contains("attachments")
}

fn io_err(e: impl ToString) -> AppError {
    AppError::keyed_vars("error.media.io", json!({ "detail": e.to_string() }))
}

fn to_full_url(url: &str) -> String {
    let mut out = if url.contains("/thumb/") {
        url.replace("/thumb/", "/")
    } else {
        url.to_string()
    };
    // SAM serves downscaled assets on preview.*; full binaries live on attachments.*.
    out = out.replace("://preview.f95zone.to/", "://attachments.f95zone.to/");
    out
}

fn to_thumb_url(full: &str) -> String {
    if full.contains("/thumb/") {
        return full.to_string();
    }
    if let Some(slash) = full.rfind('/') {
        if slash > "https://x".len() {
            return format!("{}/thumb{}", &full[..slash], &full[slash..]);
        }
    }
    full.to_string()
}

fn download_candidates(url: &str, variant: &str) -> Vec<String> {
    if variant == "library" && is_f95_attachment(url) {
        let full = to_full_url(url);
        let mut candidates = vec![full.clone()];
        let thumb = to_thumb_url(&full);
        if thumb != full {
            candidates.push(thumb);
        }
        return candidates;
    }

    let mut candidates = vec![url.to_string()];
    if variant == "grid" && is_f95_attachment(url) {
        let thumb = to_thumb_url(url);
        if thumb != url {
            candidates.insert(0, thumb);
        }
    }
    candidates
}

fn cache_path_for_url(cache_root: &Path, url: &str, variant: &str, ext: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hasher.update(variant.as_bytes());
    let hash = hex::encode(hasher.finalize());
    cache_root
        .join("remote")
        .join(variant)
        .join(format!("{hash}.{ext}"))
}

fn encode_preview_jpeg(
    img: image::DynamicImage,
    cache_path: &Path,
    max_edge: u32,
    jpeg_quality: u8,
) -> Result<(), AppError> {
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    let preview = img.thumbnail(max_edge, max_edge);
    let rgb = preview.to_rgb8();
    let mut out = std::fs::File::create(cache_path).map_err(io_err)?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, jpeg_quality);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| {
            AppError::keyed_vars("error.media.jpegEncode", json!({ "detail": e.to_string() }))
        })?;
    Ok(())
}

async fn download_image_bytes(client: &Client, url: &str) -> Result<Vec<u8>, AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| {
            AppError::keyed_vars("error.media.downloadFailed", json!({ "detail": e.to_string() }))
        })?;

    if !resp.status().is_success() {
        return Err(AppError::keyed_vars(
            "error.media.downloadHttp",
            json!({ "status": resp.status().as_u16() }),
        ));
    }

    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| {
        AppError::keyed_vars("error.media.downloadFailed", json!({ "detail": e.to_string() }))
    })
}

pub async fn resolve(url: &str, variant: &str, cache_root: &Path) -> Result<String, AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::keyed_vars(
            "error.media.invalidUrl",
            json!({ "url": url }),
        ));
    }

    let spec = variant_spec(variant)?;

    let jpg_cache = cache_path_for_url(cache_root, url, variant, "jpg");
    if jpg_cache.is_file() {
        return Ok(jpg_cache.to_string_lossy().into_owned());
    }

    let client = Client::builder()
        .user_agent(PROBE_USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(8))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| {
            AppError::keyed_vars("error.media.httpClient", json!({ "detail": e.to_string() }))
        })?;

    let candidates = download_candidates(url, variant);

    let mut bytes: Option<Vec<u8>> = None;
    let mut last_err: Option<AppError> = None;
    for candidate in &candidates {
        match download_image_bytes(&client, candidate).await {
            Ok(b) => {
                bytes = Some(b);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let bytes = bytes.ok_or_else(|| {
        last_err.unwrap_or_else(|| AppError::keyed("error.media.downloadFailedGeneric"))
    })?;

    let cache_root = cache_root.to_path_buf();
    let url = url.to_string();
    let variant = variant.to_string();
    let max_edge = spec.max_edge;
    let jpeg_quality = spec.jpeg_quality;

    tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let format = image::guess_format(&bytes).map_err(|e| {
            AppError::keyed_vars("error.media.formatFailed", json!({ "detail": e.to_string() }))
        })?;

        if format == image::ImageFormat::Gif {
            let gif_cache = cache_path_for_url(&cache_root, &url, &variant, "gif");
            if let Some(parent) = gif_cache.parent() {
                std::fs::create_dir_all(parent).map_err(io_err)?;
            }
            std::fs::write(&gif_cache, &bytes).map_err(io_err)?;
            return Ok(gif_cache.to_string_lossy().into_owned());
        }

        let img = image::load_from_memory(&bytes).map_err(|e| {
            AppError::keyed_vars("error.media.imageFailed", json!({ "detail": e.to_string() }))
        })?;
        let (w, h) = img.dimensions();
        if w <= max_edge && h <= max_edge && format == image::ImageFormat::Jpeg {
            if let Some(parent) = jpg_cache.parent() {
                std::fs::create_dir_all(parent).map_err(io_err)?;
            }
            std::fs::write(&jpg_cache, &bytes).map_err(io_err)?;
            return Ok(jpg_cache.to_string_lossy().into_owned());
        }

        encode_preview_jpeg(img, &jpg_cache, max_edge, jpeg_quality)?;
        Ok(jpg_cache.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| {
        AppError::keyed_vars("error.media.taskJoin", json!({ "detail": e.to_string() }))
    })?
}
