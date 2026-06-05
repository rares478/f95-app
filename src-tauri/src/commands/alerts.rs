use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn fetch_rss_feed(
    state: State<'_, AppState>,
    category: Option<String>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    let mut params = serde_json::Map::new();
    if let Some(cat) = category {
        params.insert("category".into(), Value::String(cat));
    }
    client.fetch_rss(params).await
}

#[tauri::command]
pub async fn fetch_alerts_popup(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.fetch_alerts_popup().await
}

#[tauri::command]
pub async fn fetch_alerts_list(
    state: State<'_, AppState>,
    page: Option<u32>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    let mut params = serde_json::Map::new();
    if let Some(p) = page {
        params.insert("page".into(), Value::Number(p.into()));
    }
    client.fetch_alerts_list(params).await
}
