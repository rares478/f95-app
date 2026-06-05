use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn sam_list(state: State<'_, AppState>, filters: Value) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.sam_list(filters).await
}

#[tauri::command]
pub async fn sam_tag_search(
    state: State<'_, AppState>,
    category: String,
    search: String,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.sam_tag_search(&category, &search).await
}

#[tauri::command]
pub async fn sam_options(state: State<'_, AppState>, category: String) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.sam_options(&category).await
}
