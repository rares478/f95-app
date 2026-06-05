use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use tauri::AppHandle;

/// BuzzHeavier - HTMX `/download` → `Hx-Redirect` CDN URL via sidecar (BrowserClient + CF).
pub(crate) async fn resolve_buzzheavier(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    account_id: Option<&str>,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(
        Some(app),
        "buzzheavier",
        format!("resolve {url} account={} (sidecar)", account_id.is_some()),
    );
    match sidecar.resolve_buzzheavier(url, account_id).await {
        Ok(res) => {
            let direct_url = res.direct_url;
            let file_name = res.file_name;
            let file_size = res.file_size;
            crate::dev_debug::log(
                Some(app),
                "buzzheavier",
                format!("ok → {file_name} ({direct_url})"),
            );
            Ok(ResolveResult::Direct {
                url: direct_url,
                file_name,
                file_size,
                expected_sha256: None,
                extra_headers: Vec::new(),
            })
        }
        Err(AppError::Cloudflare(msg)) => {
            crate::dev_debug::log(
                Some(app),
                "buzzheavier",
                format!("cloudflare: {msg} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(e) => {
            crate::dev_debug::log_error(Some(app), "buzzheavier", format!("err: {e} (url={url})"));
            Err(e)
        }
    }
}
