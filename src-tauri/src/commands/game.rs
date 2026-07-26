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
pub async fn thread_posts(
    state: State<'_, AppState>,
    thread_id: String,
    page: Option<u32>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.thread_posts(&thread_id, page.unwrap_or(1)).await
}

#[tauri::command]
pub async fn thread_reply(
    state: State<'_, AppState>,
    thread_id: String,
    message: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.thread_reply(&thread_id, &message).await
}

#[tauri::command]
pub async fn resolve_post(
    state: State<'_, AppState>,
    post_id: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.resolve_post(&post_id).await
}

#[tauri::command]
pub async fn get_following(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_following().await
}
