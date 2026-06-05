use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use tauri::AppHandle;

/// WorkUpload — session cookie + API via sidecar Playwright (Cloudflare).
pub(crate) async fn resolve_workupload(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(Some(app), "workupload", format!("resolve {url} (sidecar)"));
    match sidecar.resolve_workupload(url).await {
        Ok(res) => {
            let extra_headers: Vec<(String, String)> = res
                .extra_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();
            crate::dev_debug::log(
                Some(app),
                "workupload",
                format!(
                    "ok → {} ({}) headers={}",
                    res.file_name,
                    res.direct_url,
                    extra_headers.len()
                ),
            );
            Ok(ResolveResult::Direct {
                url: res.direct_url,
                file_name: res.file_name,
                file_size: res.file_size,
                expected_sha256: None,
                extra_headers,
            })
        }
        Err(AppError::Cloudflare(msg)) => {
            crate::dev_debug::log(
                Some(app),
                "workupload",
                format!("cloudflare: {msg} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(AppError::Other(ref msg))
            if msg.contains("anti-bot")
                || msg.contains("Are you a human")
                || msg.contains("<html>")
                || msg.contains("Cloudflare") =>
        {
            crate::dev_debug::log(
                Some(app),
                "workupload",
                format!("bot-check: {msg} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(e) => {
            crate::dev_debug::log_error(Some(app), "workupload", format!("err: {e} (url={url})"));
            Err(e)
        }
    }
}
