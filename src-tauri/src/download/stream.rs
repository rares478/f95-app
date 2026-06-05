use crate::error::AppError;
use reqwest::header::HeaderValue;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

/// `foo.zip` → `foo.zip.part`. Preserves the original extension so the user
/// can tell what kind of archive is half-downloaded.
pub(crate) fn with_part_ext(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

/// Parse the `/total` suffix from `Content-Range: bytes 0-99/100`.
pub(crate) fn parse_content_range_total(value: Option<&HeaderValue>) -> Option<u64> {
    let s = value.and_then(|v| v.to_str().ok())?;
    let total_str = s.rsplit('/').next()?.trim();
    if total_str == "*" {
        return None;
    }
    total_str.parse().ok()
}

/// SHA-256 the file at `path`. Used to verify a completed `.part` against the
/// expected hash from the host.
pub(crate) async fn hash_file(path: &Path) -> Result<String, AppError> {
    let mut h = Sha256::new();
    hash_existing(path, &mut h).await?;
    Ok(hex::encode(h.finalize()))
}

/// Feed the bytes already on disk into `hasher` so that subsequent updates
/// from the live stream produce the full-file digest.
pub(crate) async fn hash_existing(path: &Path, hasher: &mut Sha256) -> Result<(), AppError> {
    let mut f = File::open(path).await?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(())
}
