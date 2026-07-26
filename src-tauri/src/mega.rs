//! MEGA.nz public-link resolution and encrypted downloads via the `mega` crate.

use crate::error::AppError;
use futures::io::AsyncReadExt;
use mega::{Client, ErrorCode, Node, Nodes};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;

pub struct MegaInspect {
    pub file_count: usize,
    pub total_size: u64,
    pub primary_name: String,
}

/// Build a MEGA API client. When `session` is set, resumes the user session
/// (optional — public links work without it).
pub async fn build_client(session: Option<&str>) -> Result<Client, AppError> {
    let http = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::Other(format!("mega http client: {e}")))?;

    let mut client = Client::builder()
        .timeout(None)
        .build(http)
        .map_err(|e| AppError::Other(format!("mega client build: {e}")))?;

    if let Some(s) = session {
        client.resume_session(s).await.map_err(map_mega_err)?;
    }

    Ok(client)
}

/// Log in with email/password (+ optional MFA) and return `(session, email)`.
pub async fn login(
    email: &str,
    password: &str,
    mfa: Option<&str>,
) -> Result<(String, String), AppError> {
    let mut client = build_client(None).await?;
    client
        .login(email, password, mfa)
        .await
        .map_err(map_mega_login_err)?;
    let session = client.serialize_session().await.map_err(map_mega_err)?;
    let user = client.get_current_user_info().await.map_err(map_mega_err)?;
    Ok((session, user.email))
}

pub fn is_protected_link(url: &str) -> bool {
    url.contains("#P!") || url.contains("/#P!")
}

/// Normalize F95 / legacy MEGA URLs into `https://mega.nz/file|folder/{id}#{key}`.
pub fn normalize_mega_public_url(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("mega: empty URL".into()));
    }

    if is_protected_link(trimmed) {
        return Err(AppError::Other(
            "mega: password-protected link — open in browser".into(),
        ));
    }

    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.starts_with("mega.") || trimmed.starts_with("www.mega.") {
        format!("https://{trimmed}")
    } else if trimmed.starts_with("file/")
        || trimmed.starts_with("folder/")
        || trimmed.starts_with("#!")
        || trimmed.starts_with("#F!")
        || trimmed.starts_with("#f!")
    {
        format!("https://mega.nz/{trimmed}")
    } else {
        return Err(AppError::Other(format!(
            "mega: unrecognized URL format — expected https://mega.nz/file/... or /folder/..."
        )));
    };

    if let Some(converted) = convert_legacy_hash_url(&with_scheme) {
        return Ok(converted);
    }

    if let Some(converted) = canonicalize_modern_url(&with_scheme) {
        return Ok(converted);
    }

    Err(AppError::Other(format!(
        "mega: could not normalize URL — make sure the link includes the key (#...)"
    )))
}

/// Fetch nodes from a public MEGA link and summarize what will be downloaded.
pub async fn inspect_public_link(
    client: &mut Client,
    url: &str,
) -> Result<(Nodes, MegaInspect), AppError> {
    let url = normalize_mega_public_url(url)?;

    let nodes = client
        .fetch_public_nodes(&url)
        .await
        .map_err(map_mega_err)?;

    let files = collect_file_nodes(&nodes);
    if files.is_empty() {
        return Err(AppError::Other(
            "mega: no files found at link".into(),
        ));
    }

    let total_size: u64 = files.iter().map(|n| n.size()).sum();
    let file_count = files.len();
    let primary_name = if file_count == 1 {
        files[0].name().to_string()
    } else {
        format!("{file_count} files")
    };

    Ok((
        nodes,
        MegaInspect {
            file_count,
            total_size,
            primary_name,
        },
    ))
}

/// Download every file node from a public link into `dest_dir`.
pub async fn download_all_files(
    client: &Client,
    nodes: &Nodes,
    dest_dir: &Path,
    app: &AppHandle,
    id: i64,
    total_size: u64,
) -> Result<Vec<PathBuf>, AppError> {
    fs::create_dir_all(dest_dir).await?;

    let files = collect_file_nodes(nodes);
    let mut completed_bytes: u64 = 0;
    let mut downloaded_paths: Vec<PathBuf> = Vec::with_capacity(files.len());

    for node in files {
        let rel = node_relative_path(nodes, node);
        let dest_path = dest_dir.join(&rel);
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let file_size = node.size();
        let bytes_written = download_single_file(
            client,
            node,
            &dest_path,
            app,
            id,
            completed_bytes,
            total_size,
            file_size,
        )
        .await?;

        completed_bytes += bytes_written;
        downloaded_paths.push(dest_path);

        let _ = app.emit(
            "download:progress",
            json!({
                "id": id,
                "bytes": completed_bytes,
                "total": total_size,
                "speedBps": 0,
            }),
        );
    }

    Ok(downloaded_paths)
}

fn collect_file_nodes(nodes: &Nodes) -> Vec<&Node> {
    let mut files: Vec<_> = nodes.iter().filter(|n| n.kind().is_file()).collect();
    files.sort_by_key(|n| node_relative_path(nodes, n));
    files
}

fn node_relative_path(nodes: &Nodes, node: &Node) -> PathBuf {
    let mut parts: Vec<String> = vec![sanitize_segment(node.name())];
    let mut parent = node.parent();
    while let Some(handle) = parent {
        let Some(p) = nodes.get_node_by_handle(handle) else {
            break;
        };
        if p.kind().is_folder() {
            parts.push(sanitize_segment(p.name()));
        }
        parent = p.parent();
    }
    parts.reverse();
    parts.iter().fold(PathBuf::new(), |acc, seg| acc.join(seg))
}

async fn download_single_file(
    client: &Client,
    node: &Node,
    dest_path: &Path,
    app: &AppHandle,
    id: i64,
    base_bytes: u64,
    total_size: u64,
    file_size: u64,
) -> Result<u64, AppError> {
    let part_path = with_part_ext(dest_path);
    if part_path.exists() {
        let _ = fs::remove_file(&part_path).await;
    }
    if dest_path.exists() {
        let meta = fs::metadata(dest_path).await?;
        if meta.len() == file_size && file_size > 0 {
            return Ok(file_size);
        }
        let _ = fs::remove_file(dest_path).await;
    }

    let (reader, writer) = sluice::pipe::pipe();
    let current_file_bytes = Arc::new(AtomicU64::new(0));
    let progress_bytes = current_file_bytes.clone();
    let app_progress = app.clone();
    let dest = dest_path.to_path_buf();

    let copy_handle = tokio::spawn(async move {
        let mut reader = reader;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| AppError::Other(format!("mega open part: {e}")))?;

        let mut buf = vec![0u8; 256 * 1024];
        let mut written: u64 = 0;
        let mut last_emit = Instant::now();
        let mut last_bytes: u64 = 0;

        loop {
            let n = reader
                .read(&mut buf)
                .await
                .map_err(|e| AppError::Other(format!("mega read pipe: {e}")))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .await
                .map_err(|e| AppError::Other(format!("mega write part: {e}")))?;
            written += n as u64;
            progress_bytes.store(written, Ordering::Relaxed);

            if last_emit.elapsed() >= Duration::from_millis(250) {
                let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
                let aggregate = base_bytes + written;
                let speed = ((aggregate - last_bytes) as f64 / elapsed) as u64;
                let _ = app_progress.emit(
                    "download:progress",
                    json!({
                        "id": id,
                        "bytes": aggregate,
                        "total": total_size,
                        "speedBps": speed,
                    }),
                );
                last_emit = Instant::now();
                last_bytes = aggregate;
            }
        }

        file.flush()
            .await
            .map_err(|e| AppError::Other(format!("mega flush part: {e}")))?;
        drop(file);

        if dest.exists() {
            let _ = fs::remove_file(&dest).await;
        }
        fs::rename(&part_path, &dest)
            .await
            .map_err(|e| AppError::Other(format!("mega rename part: {e}")))?;

        Ok::<u64, AppError>(written)
    });

    client
        .download_node(node, writer)
        .await
        .map_err(map_mega_err)?;

    copy_handle
        .await
        .map_err(|e| AppError::Other(format!("mega copy task: {e}")))?
}

fn with_part_ext(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

fn map_mega_err(e: mega::Error) -> AppError {
    match e {
        mega::Error::InvalidPublicUrlFormat => AppError::Other(
            "mega: invalid URL format — link must be https://mega.nz/file/... or /folder/..."
                .into(),
        ),
        other => AppError::Other(format!("mega: {other}")),
    }
}

fn map_mega_login_err(e: mega::Error) -> AppError {
    if let mega::Error::MegaError { code } = &e {
        return match code {
            ErrorCode::EMFAREQUIRED => AppError::TwoFactorRequired,
            ErrorCode::EACCESS | ErrorCode::ENOENT => {
                AppError::InvalidCredentials("error.mega.badPassword".into())
            }
            _ => AppError::keyed_vars(
                "error.mega.generic",
                serde_json::json!({ "detail": format!("login: {e}") }),
            ),
        };
    }
    AppError::keyed_vars(
        "error.mega.generic",
        serde_json::json!({ "detail": format!("login: {e}") }),
    )
}

fn is_mega_host(host: &str) -> bool {
    matches!(
        host,
        "mega.nz" | "www.mega.nz" | "mega.co.nz" | "www.mega.co.nz" | "mega.io" | "www.mega.io"
    )
}

fn convert_legacy_hash_url(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let hash_idx = rest.find('#')?;
    let (host_and_path, hash) = rest.split_at(hash_idx);
    let host = host_and_path.split('/').next()?;
    if !is_mega_host(host) {
        return None;
    }

    let hash_body = hash.trim_start_matches('#');
    let (kind, id, key) = if let Some(body) = hash_body.strip_prefix('!') {
        let (id, key) = body.split_once('!')?;
        ("file", id, key)
    } else if let Some(body) = hash_body
        .strip_prefix("F!")
        .or_else(|| hash_body.strip_prefix("f!"))
    {
        let (id, key) = body.split_once('!')?;
        ("folder", id, key)
    } else {
        return None;
    };

    let key = key.split(['/', '?', '&']).next().unwrap_or(key);
    if id.is_empty() || key.is_empty() {
        return None;
    }

    Some(format!("https://mega.nz/{kind}/{id}#{key}"))
}

fn canonicalize_modern_url(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let hash_idx = rest.find('#')?;
    let (host_and_path, hash) = rest.split_at(hash_idx);
    let host = host_and_path.split('/').next()?;
    if !is_mega_host(host) {
        return None;
    }

    let path = host_and_path.strip_prefix(host)?.trim_start_matches('/');
    let (kind, id) = if let Some(id) = path.strip_prefix("file/") {
        ("file", id.split('/').next()?)
    } else if let Some(id) = path.strip_prefix("folder/") {
        ("folder", id.split('/').next()?)
    } else if let Some(id) = path.strip_prefix("embed/") {
        ("file", id.split('/').next()?)
    } else {
        return None;
    };

    let key = hash
        .trim_start_matches('#')
        .split(['/', '?', '&'])
        .next()
        .unwrap_or("");
    if id.is_empty() || key.is_empty() {
        return None;
    }

    Some(format!("https://mega.nz/{kind}/{id}#{key}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_file_url() {
        let url = "https://mega.nz/file/AbCdEfGh#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk";
        assert_eq!(normalize_mega_public_url(url).unwrap(), url.to_string());
    }

    #[test]
    fn legacy_file_hashbang() {
        assert_eq!(
            normalize_mega_public_url(
                "https://mega.nz/#!3fpFmApS!sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
            )
            .unwrap(),
            "https://mega.nz/file/3fpFmApS#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
        );
    }

    #[test]
    fn legacy_folder_hashbang() {
        assert_eq!(
            normalize_mega_public_url("https://mega.nz/#F!DRlFBYqD!wFO_-sZKQM3olcNgs4C6hg")
                .unwrap(),
            "https://mega.nz/folder/DRlFBYqD#wFO_-sZKQM3olcNgs4C6hg"
        );
    }

    #[test]
    fn mega_co_nz_and_www() {
        assert_eq!(
            normalize_mega_public_url(
                "https://www.mega.co.nz/file/3fpFmApS#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
            )
            .unwrap(),
            "https://mega.nz/file/3fpFmApS#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
        );
    }

    #[test]
    fn nested_folder_path_strips_subpath() {
        assert_eq!(
            normalize_mega_public_url(
                "https://mega.nz/folder/BopWWaID#BqJDMZNO6cTs9LHvmY958A/folder/0kIRkY7C"
            )
            .unwrap(),
            "https://mega.nz/folder/BopWWaID#BqJDMZNO6cTs9LHvmY958A"
        );
    }

    #[test]
    fn embed_to_file() {
        assert_eq!(
            normalize_mega_public_url(
                "https://mega.nz/embed/3fpFmApS#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
            )
            .unwrap(),
            "https://mega.nz/file/3fpFmApS#sctL8FeRfGKjBpYQPD1hPrAJz1PSvQIyINte8UKRvRk"
        );
    }
}
