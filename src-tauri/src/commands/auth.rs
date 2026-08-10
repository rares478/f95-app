use super::state::{ensure_sidecar, AppState, ProfileDto};
use crate::error::AppError;
use crate::sidecar;
use tauri::State;

fn auth_fail_label(err: &AppError) -> &'static str {
    match err {
        AppError::InvalidCredentials(_) => "invalid_credentials",
        AppError::TwoFactorRequired => "two_factor",
        AppError::Cloudflare(_) => "cloudflare",
        AppError::NotInitialized
        | AppError::SidecarTimeout(_)
        | AppError::SidecarCrash
        | AppError::Protocol(_) => "sidecar",
        _ => "other",
    }
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    match client.login(&username, &password).await {
        Ok(()) => {
            crate::app_log::info("auth", "login ok");
            Ok(())
        }
        Err(e) => {
            crate::app_log::warn("auth", format!("login failed: {}", auth_fail_label(&e)));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn get_profile(state: State<'_, AppState>) -> Result<ProfileDto, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_profile().await
}

/// No-op RPC used by the frontend to pre-spawn + init the sidecar without
/// firing any network call. Combined with the sidecar's strictly-serial
/// queue, this is the only way to "warm up" the process without letting a
/// slow real RPC (which would call out to F95Zone) sit in front of the
/// user's next action.
#[tauri::command]
pub async fn ping_sidecar(state: State<'_, AppState>) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    client.ping().await
}

#[tauri::command]
pub async fn is_logged_in(state: State<'_, AppState>) -> Result<bool, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.is_logged_in().await
}

/// True when persisted F95 session cookies exist on disk (no network call).
#[tauri::command]
pub fn has_local_session(state: State<'_, AppState>) -> bool {
    state.session_dir.join("default.json").is_file()
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    crate::app_log::info("auth", "logout");
    // Fast path: the user wants the app to react NOW, not wait for a
    // round-trip to F95Zone. We do the local teardown synchronously
    // (kill sidecar + delete session file) and fire the F95 POST in the
    // background. If the network call fails, the local state is already
    // clean - F95 will eventually time out the session server-side too.
    //
    // Returns in ~50ms instead of waiting up to 5s for the POST.
    // Kill the sidecar - local teardown is enough for UX. The F95Zone
    // server-side session will time out on its own; we don't block on
    // POST /logout/. If the user really needs a server-side logout
    // (shared computer, etc.) they can do it via the browser.
    sidecar::kill(&state.sidecar).await;

    // Wipe the local session file directly - don't trust the sidecar's
    // cleanup, since we just killed it mid-flight. Best-effort: ENOENT
    // is fine, the user just hadn't logged in.
    let session_file = state.session_dir.join("default.json");
    let _ = std::fs::remove_file(&session_file);

    Ok(())
}
