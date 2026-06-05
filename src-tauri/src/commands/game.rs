use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn game_detail(state: State<'_, AppState>, thread_id: String) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.game_detail(&thread_id).await
}

#[tauri::command]
pub async fn get_following(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_following().await
}
