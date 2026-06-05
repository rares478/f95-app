use super::state::AppState;
use crate::error::AppError;
use crate::launcher::RunningInfo;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    title: String,
    exe_path: String,
    session_id: i64,
) -> Result<u32, AppError> {
    state
        .launcher
        .launch(app, thread_id, title, exe_path, session_id)
        .await
}

#[tauri::command]
pub async fn stop_game(state: State<'_, AppState>, thread_id: String) -> Result<(), AppError> {
    state.launcher.stop(&thread_id).await
}

#[tauri::command]
pub async fn running_games(state: State<'_, AppState>) -> Result<Vec<RunningInfo>, AppError> {
    Ok(state.launcher.running().await)
}

#[derive(Debug, Serialize)]
pub struct CreateShortcutsResult {
    pub desktop: bool,
    #[serde(rename = "startMenu")]
    pub start_menu: bool,
    pub message: String,
}

/// Create Desktop + Start Menu shortcuts pointing at the game executable.
#[tauri::command]
pub async fn create_game_shortcuts(
    exe_path: String,
    title: String,
) -> Result<CreateShortcutsResult, AppError> {
    let exe = PathBuf::from(exe_path);
    let result =
        tokio::task::spawn_blocking(move || crate::shortcuts::create_game_shortcuts(&exe, &title))
            .await
            .map_err(|e| AppError::Other(format!("create_game_shortcuts join: {e}")))??;
    Ok(CreateShortcutsResult {
        desktop: result.desktop,
        start_menu: result.start_menu,
        message: result.message,
    })
}
