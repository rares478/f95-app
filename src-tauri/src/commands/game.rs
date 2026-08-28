use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::{json, Value};
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
pub async fn bbcode_preview(
    state: State<'_, AppState>,
    thread_id: String,
    bb_code: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.bbcode_preview(&thread_id, &bb_code).await
}

#[tauri::command]
pub async fn resolve_post(
    state: State<'_, AppState>,
    post_id: Option<String>,
    url: Option<String>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    if let Some(u) = url.filter(|s| !s.trim().is_empty()) {
        return client.resolve_f95_url(&u).await;
    }
    let id = post_id.unwrap_or_default();
    if id.trim().is_empty() {
        return Err(AppError::Other("postId or url required".into()));
    }
    client.resolve_post(&id).await
}

#[tauri::command]
pub async fn get_following(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.get_following().await
}

#[tauri::command]
pub async fn get_watched_threads(
    state: State<'_, AppState>,
    page: Option<u32>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    let mut params = serde_json::Map::new();
    if let Some(p) = page {
        params.insert("page".into(), Value::from(p));
    }
    client.get_watched_threads(params).await
}

#[tauri::command]
pub async fn get_thread_watch_state(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client
        .get_thread_watch_state(json!({ "threadId": thread_id }))
        .await
}
