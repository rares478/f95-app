use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn fetch_conversations_list(
    state: State<'_, AppState>,
    page: Option<u32>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    let mut params = serde_json::Map::new();
    if let Some(p) = page {
        params.insert("page".into(), Value::Number(p.into()));
    }
    client.fetch_conversations_list(params).await
}

#[tauri::command]
pub async fn fetch_conversation(
    state: State<'_, AppState>,
    conversation_path: String,
    page: Option<u32>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    let mut params = serde_json::Map::new();
    params.insert("conversationPath".into(), Value::String(conversation_path));
    if let Some(p) = page {
        params.insert("page".into(), Value::Number(p.into()));
    }
    client.fetch_conversation(params).await
}

#[tauri::command]
pub async fn conversation_reply(
    state: State<'_, AppState>,
    conversation_path: String,
    message: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client
        .conversation_reply(json!({
            "conversationPath": conversation_path,
            "message": message,
        }))
        .await
}

#[tauri::command]
pub async fn conversation_bbcode_preview(
    state: State<'_, AppState>,
    conversation_path: String,
    bb_code: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client
        .conversation_bbcode_preview(&conversation_path, &bb_code)
        .await
}
