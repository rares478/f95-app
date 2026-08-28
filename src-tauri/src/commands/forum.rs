use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn forum_search(
    state: State<'_, AppState>,
    query: String,
    title_only: Option<bool>,
    container_only: Option<bool>,
    search_in: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
    thread_id: Option<String>,
    posted_by: Option<String>,
    date_newer_than: Option<String>,
    date_older_than: Option<String>,
    tags: Option<String>,
    without_tags: Option<String>,
    min_reply_count: Option<u32>,
    prefix_ids: Option<Vec<u32>>,
    forum_node_ids: Option<Vec<u32>>,
    search_subforums: Option<bool>,
) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client
        .forum_search(json!({
            "query": query,
            "titleOnly": title_only,
            "containerOnly": container_only,
            "searchIn": search_in,
            "sort": sort,
            "page": page,
            "threadId": thread_id,
            "postedBy": posted_by,
            "dateNewerThan": date_newer_than,
            "dateOlderThan": date_older_than,
            "tags": tags,
            "withoutTags": without_tags,
            "minReplyCount": min_reply_count,
            "prefixIds": prefix_ids,
            "forumNodeIds": forum_node_ids,
            "searchSubforums": search_subforums,
        }))
        .await
}

#[tauri::command]
pub async fn forum_search_form_options(state: State<'_, AppState>) -> Result<Value, AppError> {
    let client = ensure_sidecar(&state).await?;
    client.forum_search_form_options().await
}
