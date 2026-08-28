use super::state::{ensure_sidecar, AppState};
use crate::download::stream::with_part_ext;
use crate::error::AppError;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tokio::fs;

/// `platform_group` is the F95 section label (e.g. "Win/Linux") — used to
/// auto-pick the PC build when a GoFile folder has several files.
#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    source_url: String,
    thread_id: String,
    library_path: Option<String>,
    platform_group: Option<String>,
) -> Result<(), AppError> {
    let client = ensure_sidecar(&state).await?;
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let platform_group = platform_group
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    state
        .downloader
        .start(
            app,
            client,
            id,
            source_url,
            thread_id,
            dest_root,
            platform_group,
        )
        .await
}

#[tauri::command]
pub async fn download_continue_choice(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    choice_id: String,
    thread_id: String,
    library_path: Option<String>,
) -> Result<(), AppError> {
    let dest_root = library_path
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    state
        .downloader
        .continue_with_file_choice(app, id, choice_id, thread_id, dest_root)
        .await
}

#[tauri::command]
pub async fn download_pause(state: State<'_, AppState>, id: i64) -> Result<(), AppError> {
    state.downloader.cancel(id).await;
    state.extract_cancels.cancel(id);
    Ok(())
}

#[tauri::command]
pub async fn download_cancel(
    state: State<'_, AppState>,
    id: i64,
    dest_path: Option<String>,
) -> Result<(), AppError> {
    state.downloader.cancel(id).await;
    state.extract_cancels.cancel(id);

    if let Some(dest) = dest_path.filter(|s| !s.trim().is_empty()) {
        let part = with_part_ext(Path::new(&dest));
        let _ = fs::remove_file(part).await;
    }

    Ok(())
}
