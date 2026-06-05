use crate::error::AppError;
use std::path::PathBuf;

pub fn resolve_sidecar_path() -> Result<PathBuf, AppError> {
    if cfg!(debug_assertions) {
        let cwd = std::env::current_dir()?;
        let candidates = [
            cwd.join("src-tauri")
                .join("sidecar")
                .join("dist")
                .join("index.js"),
            cwd.join("sidecar").join("dist").join("index.js"),
        ];
        for c in &candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
        Err(AppError::Other(format!(
            "sidecar dist/index.js not found in {:?}",
            candidates
        )))
    } else {
        let exe = std::env::current_exe()?;
        let dir = exe
            .parent()
            .ok_or_else(|| AppError::Other("could not resolve executable directory".into()))?;
        let candidates = [
            dir.join("resources").join("sidecar").join("bundle.cjs"),
            dir.join("sidecar").join("bundle.cjs"),
            dir.join("bundle.cjs"),
        ];
        for c in &candidates {
            if c.exists() {
                return Ok(c.clone());
            }
        }
        Err(AppError::Other(format!(
            "sidecar bundle.cjs not found near exe - tried {:?}. \
             Make sure tauri bundle resources include sidecar/bundle.cjs \
             AND sidecar/node.exe.",
            candidates
        )))
    }
}
