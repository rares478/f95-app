//! Windows desktop / Start Menu shortcuts for installed games.

use crate::error::AppError;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Serialize)]
pub struct ShortcutResult {
    pub desktop: bool,
    #[serde(rename = "startMenu")]
    pub start_menu: bool,
    pub message: String,
}

pub fn create_game_shortcuts(exe_path: &Path, title: &str) -> Result<ShortcutResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        return create_game_shortcuts_windows(exe_path, title);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (exe_path, title);
        Ok(ShortcutResult {
            desktop: false,
            start_menu: false,
            message: "error.shortcut.windowsOnly".into(),
        })
    }
}

#[cfg(target_os = "windows")]
fn create_game_shortcuts_windows(exe_path: &Path, title: &str) -> Result<ShortcutResult, AppError> {
    if !exe_path.is_file() {
        return Err(AppError::keyed_vars(
            "error.launch.exeMissing",
            json!({ "path": exe_path.display().to_string() }),
        ));
    }

    let working_dir = exe_path
        .parent()
        .ok_or_else(|| AppError::keyed("error.shortcut.noParent"))?;
    let safe_name = sanitize_shortcut_name(title);
    if safe_name.is_empty() {
        return Err(AppError::keyed("error.shortcut.invalidTitle"));
    }

    let mut desktop_ok = false;
    let mut start_menu_ok = false;

    if let Some(dir) = known_folder("Desktop") {
        let path = dir.join(format!("{safe_name}.lnk"));
        if create_lnk(&path, exe_path, working_dir).is_ok() {
            desktop_ok = true;
        }
    }

    if let Some(programs) = known_folder("Programs") {
        let folder = programs.join("F95 App");
        let _ = std::fs::create_dir_all(&folder);
        let path = folder.join(format!("{safe_name}.lnk"));
        if create_lnk(&path, exe_path, working_dir).is_ok() {
            start_menu_ok = true;
        }
    }

    if !desktop_ok && !start_menu_ok {
        return Err(AppError::keyed("error.shortcut.createFailed"));
    }

    let message = match (desktop_ok, start_menu_ok) {
        (true, true) => "error.shortcut.createdBoth".into(),
        (true, false) => "error.shortcut.createdDesktop".into(),
        (false, true) => "error.shortcut.createdStartMenu".into(),
        (false, false) => String::new(),
    };

    Ok(ShortcutResult {
        desktop: desktop_ok,
        start_menu: start_menu_ok,
        message,
    })
}

#[cfg(target_os = "windows")]
fn known_folder(name: &str) -> Option<PathBuf> {
    let user = std::env::var_os("USERPROFILE")?;
    let home = PathBuf::from(user);
    match name {
        "Desktop" => Some(home.join("Desktop")),
        "Programs" => Some(
            home.join("AppData")
                .join("Roaming")
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        ),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn create_lnk(shortcut_path: &Path, target: &Path, working_dir: &Path) -> Result<(), AppError> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::Interface;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn to_wide(value: &Path) -> Vec<u16> {
        OsStr::new(value.as_os_str())
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    if let Some(parent) = shortcut_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::keyed_vars(
                "error.shortcut.failed",
                json!({ "detail": format!("failed to create shortcut folder: {e}") }),
            )
        })?;
    }

    let shortcut_w = to_wide(shortcut_path);
    let target_w = to_wide(target);
    let working_dir_w = to_wide(working_dir);

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.shortcut.failed",
                    json!({ "detail": format!("CoCreateInstance ShellLink: {e}") }),
                )
            })?;
        link.SetPath(PCWSTR(target_w.as_ptr())).map_err(|e| {
            AppError::keyed_vars(
                "error.shortcut.failed",
                json!({ "detail": format!("SetPath: {e}") }),
            )
        })?;
        link.SetWorkingDirectory(PCWSTR(working_dir_w.as_ptr()))
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.shortcut.failed",
                    json!({ "detail": format!("SetWorkingDirectory: {e}") }),
                )
            })?;
        let _ = link.SetShowCmd(SW_SHOWNORMAL);
        let persist: IPersistFile = link.cast().map_err(|e| {
            AppError::keyed_vars(
                "error.shortcut.failed",
                json!({ "detail": format!("cast IPersistFile: {e}") }),
            )
        })?;
        persist
            .Save(PCWSTR(shortcut_w.as_ptr()), true)
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.shortcut.failed",
                    json!({
                        "detail": format!(
                            "failed to create shortcut {}: {e}",
                            shortcut_path.display()
                        )
                    }),
                )
            })?;
    }
    Ok(())
}

fn sanitize_shortcut_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "Game".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}
