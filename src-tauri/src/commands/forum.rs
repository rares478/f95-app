use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn forum_search(
    state: State<'_, AppState>,
    query: String,
    title_only: Option<bool>,
    search_in: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
    thread_id: Option<String>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client
        .forum_search(
            &query,
            title_only.unwrap_or(false),
            search_in.as_deref().unwrap_or("posts"),
            sort.as_deref().unwrap_or("relevance"),
            page.unwrap_or(1),
            thread_id.as_deref(),
        )
        .await
}
