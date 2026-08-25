use super::state::{ensure_sidecar, AppState};
use crate::error::AppError;
use crate::sidecar::DownloadAttachmentResult;
use std::path::{Component, Path, PathBuf};
use tauri::State;

/// Download a post attachment into the app Downloads folder via the sidecar.
#[tauri::command]
pub async fn download_post_attachment(
    state: State<'_, AppState>,
    url: String,
    file_name: String,
) -> Result<DownloadAttachmentResult, AppError> {
    let dest_dir = state.downloads_dir.clone();
    std::fs::create_dir_all(&dest_dir).map_err(|e| AppError::Io(e.to_string()))?;

    let client = ensure_sidecar(&state).await?;
    let result = client
        .download_post_attachment(&url, &file_name, &dest_dir.to_string_lossy())
        .await?;

    let returned = PathBuf::from(&result.path);
    if !path_under_dir(&returned, &dest_dir) {
        return Err(AppError::Other(
            "attachment path escaped downloads directory".into(),
        ));
    }

    Ok(result)
}

/// True when `path` resolves under `root` (canonicalize + prefix, with lexical fallback).
fn path_under_dir(path: &Path, root: &Path) -> bool {
    let canon_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let canon_path = std::fs::canonicalize(path).unwrap_or_else(|_| {
        // File may have just been written; try parent + filename.
        if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
            let parent_c = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
            return parent_c.join(name);
        }
        path.to_path_buf()
    });

    // Reject path components that escape (defense in depth).
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return false;
    }

    canon_path.starts_with(&canon_root)
}

#[cfg(test)]
mod tests {
    use super::path_under_dir;
    use std::path::PathBuf;

    #[test]
    fn path_under_dir_accepts_child() {
        let root = std::env::temp_dir().join("f95-att-root-ok");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let child = root.join("a.zip");
        std::fs::write(&child, b"x").unwrap();
        assert!(path_under_dir(&child, &root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn path_under_dir_rejects_outside() {
        let root = std::env::temp_dir().join("f95-att-root-out");
        let outside = std::env::temp_dir().join("f95-att-outside-file");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, b"x").unwrap();
        assert!(!path_under_dir(&outside, &root));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }

    #[test]
    fn path_under_dir_rejects_parent_components() {
        let root = PathBuf::from("/downloads");
        let sneaky = PathBuf::from("/downloads/../etc/passwd");
        assert!(!path_under_dir(&sneaky, &root));
    }
}
