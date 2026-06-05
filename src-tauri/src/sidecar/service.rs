use crate::bridge::Sidecar;
use crate::error::AppError;
use crate::sidecar::rpc::SidecarClient;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

pub async fn ensure(
    slot: &Mutex<Option<Arc<SidecarClient>>>,
    session_dir: &Path,
    sidecar_path: PathBuf,
) -> Result<Arc<SidecarClient>, AppError> {
    let mut guard = slot.lock().await;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    let raw = Sidecar::spawn(sidecar_path).await?;
    let session_dir_str = session_dir
        .to_str()
        .ok_or_else(|| AppError::Other("session dir not utf-8".into()))?
        .to_string();
    let client = Arc::new(SidecarClient::new(Arc::new(raw)));
    client.init(&session_dir_str, "default").await?;
    *guard = Some(client.clone());
    Ok(client)
}

pub async fn kill(slot: &Mutex<Option<Arc<SidecarClient>>>) {
    let mut guard = slot.lock().await;
    if let Some(client) = guard.take() {
        client.kill_now();
    }
}
