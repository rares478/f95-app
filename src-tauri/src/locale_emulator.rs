use std::path::{Path, PathBuf};

const REQUIRED_FILES: &[&str] = &[
    "LEProc.exe",
    "LECommonLibrary.dll",
    "LoaderDll.dll",
    "LocaleEmulator.dll",
    "LEConfig.xml",
];

pub fn bundle_dir(resource_root: &Path) -> PathBuf {
    resource_root.join("locale-emulator")
}

pub fn resolve_bundle_dir(resource_root: Option<&Path>) -> Result<PathBuf, crate::error::AppError> {
    if let Some(root) = resource_root {
        let bundled = bundle_dir(root);
        if validate_bundle(&bundled).is_ok() {
            return Ok(bundled);
        }
    }

    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/locale-emulator");
        if validate_bundle(&dev).is_ok() {
            return Ok(dev);
        }
    }

    Err(crate::error::AppError::keyed(
        "error.launch.localeEmulatorMissing",
    ))
}

pub fn validate_bundle(dir: &Path) -> Result<(), crate::error::AppError> {
    for name in REQUIRED_FILES {
        if !dir.join(name).is_file() {
            return Err(crate::error::AppError::keyed(
                "error.launch.localeEmulatorMissing",
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
pub async fn spawn_leproc(
    app: &tauri::AppHandle,
    abs_exe: &Path,
) -> Result<tokio::process::Child, crate::error::AppError> {
    use tauri::Manager;

    let resource_root = app.path().resource_dir().ok();
    let le_dir = resolve_bundle_dir(resource_root.as_deref())?;

    let leproc = le_dir.join("LEProc.exe");
    let abs_exe_str = abs_exe.to_string_lossy().into_owned();

    // Match drag-and-drop onto LEProc: use the first global profile in LEConfig.xml.
    crate::app_log::info(
        "locale_emulator",
        format!("{} \"{}\"", leproc.display(), abs_exe_str),
    );

    let mut cmd = tokio::process::Command::new(&leproc);
    cmd.current_dir(&le_dir)
        .arg(&abs_exe_str)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(false);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| {
        crate::error::AppError::keyed_vars(
            "error.launch.spawnFailed",
            serde_json::json!({ "detail": e.to_string() }),
        )
    })
}

#[cfg(not(windows))]
pub async fn spawn_leproc(
    _app: &tauri::AppHandle,
    _abs_exe: &Path,
) -> Result<tokio::process::Child, crate::error::AppError> {
    Err(crate::error::AppError::keyed("error.launch.localeEmulatorMissing"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn bundle_dir_appends_locale_emulator_segment() {
        let root = PathBuf::from(r"C:\app\resources");
        assert_eq!(
            bundle_dir(&root),
            PathBuf::from(r"C:\app\resources\locale-emulator")
        );
    }

    #[test]
    fn validate_bundle_requires_all_runtime_files() {
        let root = std::env::temp_dir().join(format!(
            "f95app_le_validate_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("LEProc.exe"), b"x").unwrap();

        assert!(validate_bundle(&root).is_err());

        for name in REQUIRED_FILES {
            if !root.join(name).exists() {
                fs::write(root.join(name), b"x").unwrap();
            }
        }
        assert!(validate_bundle(&root).is_ok());

        let _ = fs::remove_dir_all(&root);
    }
}
