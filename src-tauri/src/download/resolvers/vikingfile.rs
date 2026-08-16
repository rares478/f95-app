use super::super::types::ResolveResult;
use crate::error::AppError;
use tauri::AppHandle;

/// VikingFile free downloads require Cloudflare Turnstile — unsupported in-app.
/// Open in the system browser instead.
pub(crate) async fn resolve_vikingfile(
    app: &AppHandle,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(
        Some(app),
        "vikingfile",
        format!("unsupported (Turnstile) → needs_browser {url}"),
    );
    Ok(ResolveResult::NeedsBrowser {
        url: url.to_string(),
        host: label.into(),
    })
}
