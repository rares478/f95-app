use std::path::{Path, PathBuf};

pub const JP_PROFILE_GUID: &str = "7c4e9a21-5b3d-4f8e-9c12-6d8f0a2b1e34";

const REQUIRED_FILES: &[&str] = &[
    "LEProc.exe",
    "LoaderDll.dll",
    "LocaleEmulator.dll",
    "LEConfig.xml",
];

pub fn bundle_dir(resource_root: &Path) -> PathBuf {
    resource_root.join("locale-emulator")
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

    let resource_root = app.path().resource_dir().map_err(|_| {
        crate::error::AppError::keyed("error.launch.localeEmulatorMissing")
    })?;
    let le_dir = bundle_dir(&resource_root);
    validate_bundle(&le_dir)?;

    let leproc = le_dir.join("LEProc.exe");
    let abs_exe_str = abs_exe.to_string_lossy().into_owned();

    crate::app_log::info(
        "locale_emulator",
        format!(
            "{} -runas {} {}",
            leproc.display(),
            JP_PROFILE_GUID,
            abs_exe_str
        ),
    );

    let mut cmd = tokio::process::Command::new(&leproc);
    cmd.current_dir(&le_dir)
        .arg("-runas")
        .arg(JP_PROFILE_GUID)
        .arg(&abs_exe_str)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(false);

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
