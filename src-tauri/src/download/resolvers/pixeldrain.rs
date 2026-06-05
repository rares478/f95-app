use super::super::types::ResolveResult;
use crate::error::AppError;

pub(crate) async fn resolve_pixeldrain(
    http: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    // Accept /u/<id>, /api/file/<id>, /api/file/<id>/info - pull the id segment
    // immediately after either "u" or "file".
    let path = url
        .splitn(4, '/')
        .nth(3)
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let id = if let Some(i) = segs.iter().position(|s| *s == "file") {
        segs.get(i + 1).copied()
    } else if let Some(i) = segs.iter().position(|s| *s == "u") {
        segs.get(i + 1).copied()
    } else {
        segs.last().copied()
    };
    let Some(id) = id else {
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };
    let info_url = format!("https://pixeldrain.com/api/file/{}/info", id);
    let info: serde_json::Value = http
        .get(&info_url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("pixeldrain info http: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("pixeldrain info status: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Other(format!("pixeldrain info json: {e}")))?;
    let file_name = info
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("pixeldrain-download.bin")
        .to_string();
    let file_size = info.get("size").and_then(|v| v.as_u64());
    let expected_sha256 = info
        .get("hash_sha256")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let direct_url = format!("https://pixeldrain.com/api/file/{}?download", id);
    Ok(ResolveResult::Direct {
        url: direct_url,
        file_name,
        file_size,
        expected_sha256,
        extra_headers: Vec::new(),
    })
}
