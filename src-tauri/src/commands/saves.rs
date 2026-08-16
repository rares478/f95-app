use crate::error::AppError;
use crate::save_editor::{
    list_backups, list_for_install, probe_renpy_install, read, restore, write, ExtraSaveRoot,
    RpgmProbeResult, RenpyProbeResult, RenpySaveBackup, RenpySavePatch, RenpySaveSlot, RenpyVarNode,
    UnityMeta, UnityProbeResult, UnitySaveReadResult, UnitySaveSlot,
};
use crate::save_editor::rpgm::{
    list_for_install as rpgm_list_for_install, probe_rpgm_install, read as rpgm_read,
    restore as rpgm_restore, write as rpgm_write,
};
use crate::save_editor::unity::{
    list_for_install as unity_list_for_install, probe_unity_install, read as unity_read,
    restore as unity_restore, write as unity_write,
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

fn extra_roots_or_empty(extra_roots: Option<Vec<ExtraSaveRoot>>) -> Vec<ExtraSaveRoot> {
    extra_roots.unwrap_or_default()
}

#[tauri::command]
pub async fn renpy_saves_probe(install_path: String) -> Result<RenpyProbeResult, AppError> {
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || probe_renpy_install(&install))
        .await
        .map_err(|e| AppError::Other(format!("renpy_saves_probe join: {e}")))
}

#[tauri::command]
pub async fn renpy_saves_list(
    install_path: String,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<Vec<RenpySaveSlot>, AppError> {
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || list_for_install(&install, &roots))
        .await
        .map_err(|e| AppError::Other(format!("renpy_saves_list join: {e}")))?
}

#[tauri::command]
pub async fn renpy_save_read(
    install_path: String,
    slot_key: String,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<RenpyVarNode, AppError> {
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || read(&install, &slot_key, &roots))
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
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<RenpyVarNode, AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        write(
            &backups,
            &thread_id,
            &install,
            &slot_key,
            &patches,
            &roots,
        )
    })
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
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<(), AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        restore(
            &backups,
            &thread_id,
            &install,
            &slot_key,
            &backup_file_name,
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("renpy_save_backup_restore join: {e}")))?
}

#[tauri::command]
pub async fn rpgm_saves_probe(install_path: String) -> Result<RpgmProbeResult, AppError> {
    let install = PathBuf::from(install_path);
    tokio::task::spawn_blocking(move || probe_rpgm_install(&install))
        .await
        .map_err(|e| AppError::Other(format!("rpgm_saves_probe join: {e}")))
}

#[tauri::command]
pub async fn rpgm_saves_list(
    install_path: String,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<Vec<RenpySaveSlot>, AppError> {
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || rpgm_list_for_install(&install, &roots))
        .await
        .map_err(|e| AppError::Other(format!("rpgm_saves_list join: {e}")))?
}

#[tauri::command]
pub async fn rpgm_save_read(
    install_path: String,
    slot_key: String,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<RenpyVarNode, AppError> {
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || rpgm_read(&install, &slot_key, &roots))
        .await
        .map_err(|e| AppError::Other(format!("rpgm_save_read join: {e}")))?
}

#[tauri::command]
pub async fn rpgm_save_write(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    patches: Vec<RenpySavePatch>,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<RenpyVarNode, AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        rpgm_write(
            &backups,
            &thread_id,
            &install,
            &slot_key,
            &patches,
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("rpgm_save_write join: {e}")))?
}

#[tauri::command]
pub async fn rpgm_save_backups_list(
    app: AppHandle,
    thread_id: String,
    slot_key: String,
) -> Result<Vec<RenpySaveBackup>, AppError> {
    let backups = backups_root(&app)?;
    tokio::task::spawn_blocking(move || list_backups(&backups, &thread_id, &slot_key))
        .await
        .map_err(|e| AppError::Other(format!("rpgm_save_backups_list join: {e}")))?
}

#[tauri::command]
pub async fn rpgm_save_backup_restore(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    backup_file_name: String,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<(), AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        rpgm_restore(
            &backups,
            &thread_id,
            &install,
            &slot_key,
            &backup_file_name,
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("rpgm_save_backup_restore join: {e}")))?
}

#[tauri::command]
pub async fn unity_saves_probe(
    install_path: String,
    developer: Option<String>,
    title: Option<String>,
) -> Result<UnityProbeResult, AppError> {
    let install = PathBuf::from(install_path);
    let meta = unity_meta(developer, title);
    tokio::task::spawn_blocking(move || probe_unity_install(&install, &meta))
        .await
        .map_err(|e| AppError::Other(format!("unity_saves_probe join: {e}")))
}

#[tauri::command]
pub async fn unity_saves_list(
    install_path: String,
    developer: Option<String>,
    title: Option<String>,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<Vec<UnitySaveSlot>, AppError> {
    let install = PathBuf::from(install_path);
    let meta = unity_meta(developer, title);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || unity_list_for_install(&install, &meta, &roots))
        .await
        .map_err(|e| AppError::Other(format!("unity_saves_list join: {e}")))?
}

#[tauri::command]
pub async fn unity_save_read(
    install_path: String,
    slot_key: String,
    developer: Option<String>,
    title: Option<String>,
    password: Option<String>,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<UnitySaveReadResult, AppError> {
    let install = PathBuf::from(install_path);
    let meta = unity_meta(developer, title);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        unity_read(
            &install,
            &meta,
            &slot_key,
            password.as_deref(),
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("unity_save_read join: {e}")))?
}

#[tauri::command]
pub async fn unity_save_write(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    patches: Vec<RenpySavePatch>,
    developer: Option<String>,
    title: Option<String>,
    password: Option<String>,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<RenpyVarNode, AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let meta = unity_meta(developer, title);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        unity_write(
            &backups,
            &thread_id,
            &install,
            &meta,
            &slot_key,
            &patches,
            password.as_deref(),
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("unity_save_write join: {e}")))?
}

#[tauri::command]
pub async fn unity_save_backups_list(
    app: AppHandle,
    thread_id: String,
    slot_key: String,
) -> Result<Vec<RenpySaveBackup>, AppError> {
    let backups = backups_root(&app)?;
    tokio::task::spawn_blocking(move || list_backups(&backups, &thread_id, &slot_key))
        .await
        .map_err(|e| AppError::Other(format!("unity_save_backups_list join: {e}")))?
}

#[tauri::command]
pub async fn unity_save_backup_restore(
    app: AppHandle,
    thread_id: String,
    install_path: String,
    slot_key: String,
    backup_file_name: String,
    developer: Option<String>,
    title: Option<String>,
    extra_roots: Option<Vec<ExtraSaveRoot>>,
) -> Result<(), AppError> {
    let backups = backups_root(&app)?;
    let install = PathBuf::from(install_path);
    let meta = unity_meta(developer, title);
    let roots = extra_roots_or_empty(extra_roots);
    tokio::task::spawn_blocking(move || {
        unity_restore(
            &backups,
            &thread_id,
            &install,
            &meta,
            &slot_key,
            &backup_file_name,
            &roots,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("unity_save_backup_restore join: {e}")))?
}

fn unity_meta(developer: Option<String>, title: Option<String>) -> UnityMeta {
    UnityMeta { developer, title }
}
