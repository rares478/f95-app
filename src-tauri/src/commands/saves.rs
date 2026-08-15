use crate::error::AppError;
use crate::save_editor::{
    list_backups, list_for_install, probe_renpy_install, read, restore, write, RenpyProbeResult,
    RenpySaveBackup, RenpySavePatch, RenpySaveSlot, RenpyVarNode,
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn backups_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("app_local_data_dir: {e}")))?
        .join("save_backups"))
}

#[tauri::command]
pub async fn renpy_saves_probe(install_path: String) -> Result<RenpyProbeResult, AppError> {
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || probe_renpy_install(&install))
        .await
        .map_err(|e| AppError::Other(format!("renpy_saves_probe join: {e}")))
}

#[tauri::command]
pub async fn renpy_saves_list(install_path: String) -> Result<Vec<RenpySaveSlot>, AppError> {
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || list_for_install(&install))
        .await
        .map_err(|e| AppError::Other(format!("renpy_saves_list join: {e}")))?
}

#[tauri::command]
pub async fn renpy_save_read(
    install_path: String,
    slot_key: String,
) -> Result<RenpyVarNode, AppError> {
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || read(&install, &slot_key))
        .await
        .map_err(|e| AppError::Other(format!("renpy_save_read join: {e}")))?
}

#[tauri::command]
pub async fn renpy_save_write(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    patches: Vec<RenpySavePatch>,
) -> Result<RenpyVarNode, AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || write(&backups, &thread_id, &install, &slot_key, &patches))
        .await
        .map_err(|e| AppError::Other(format!("renpy_save_write join: {e}")))?
}

#[tauri::command]
pub async fn renpy_save_backups_list(
    app: AppHandle,
    thread_id: String,
    slot_key: String,
) -> Result<Vec<RenpySaveBackup>, AppError> {
    let backups = backups_root(&app)?;
    tokio::task::spawn_blocking(move || list_backups(&backups, &thread_id, &slot_key))
        .await
        .map_err(|e| AppError::Other(format!("renpy_save_backups_list join: {e}")))?
}

#[tauri::command]
pub async fn renpy_save_backup_restore(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    backup_file_name: String,
) -> Result<(), AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || {
        restore(
            &backups,
            &thread_id,
            &install,
            &slot_key,
            &backup_file_name,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("renpy_save_backup_restore join: {e}")))?
}
