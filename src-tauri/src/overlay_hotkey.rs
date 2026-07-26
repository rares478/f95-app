//! Global overlay hotkey — registered in Rust so it works while a game has focus.

use crate::commands::overlay::{
    overlay_toggle_cached, report_overlay_failure, OverlaySyncHotkeyResult, OVERLAY_HINT_WINDOW_LABEL,
    OVERLAY_WINDOW_LABEL,
};
use crate::error::AppError;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const FALLBACK_HOTKEYS: &[&str] = &["Ctrl+Shift+O", "Ctrl+Shift+@", "F10"];

#[cfg(windows)]
fn launcher_window_focused(app: &AppHandle) -> bool {
    for label in ["main", "login"] {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_focused().unwrap_or(false) {
                return true;
            }
        }
    }
    false
}

#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE};

#[cfg(windows)]
pub fn steam_client_running() -> bool {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return false,
        };
        let _guard = SnapGuard(snap);

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snap, &mut entry).is_err() {
            return false;
        }

        loop {
            let name = exe_name(&entry.szExeFile);
            if name == "steam.exe" {
                return true;
            }
            if Process32NextW(snap, &mut entry).is_err() {
                break;
            }
        }
    }

    false
}

#[cfg(windows)]
struct SnapGuard(HANDLE);

#[cfg(windows)]
impl Drop for SnapGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
fn exe_name(buf: &[u16; 260]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len]).to_lowercase()
}

#[cfg(not(windows))]
pub fn steam_client_running() -> bool {
    false
}

fn normalize_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

fn is_shift_tab(hotkey: &str) -> bool {
    let n = normalize_hotkey(hotkey);
    n == "shift+tab" || n == "tab+shift"
}

fn hotkey_candidates(requested: &str, steam_running: bool) -> Vec<String> {
    let mut out = Vec::new();
    let push_unique = |out: &mut Vec<String>, value: &str| {
        if !out.iter().any(|h| h.eq_ignore_ascii_case(value)) {
            out.push(value.to_string());
        }
    };

    if steam_running && is_shift_tab(requested) {
        for fb in FALLBACK_HOTKEYS {
            push_unique(&mut out, fb);
        }
        return out;
    }

    push_unique(&mut out, requested.trim());
    if !is_shift_tab(requested) {
        return out;
    }

    for fb in FALLBACK_HOTKEYS {
        push_unique(&mut out, fb);
    }
    out
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn should_handle_overlay_hotkey(
    app: &AppHandle,
    #[cfg(windows)] fg_raw: Option<isize>,
    #[cfg(windows)] focus_raw: Option<isize>,
) -> (bool, &'static str) {
    let state = app.state::<crate::commands::AppState>();
    let enabled = state
        .overlay_user_enabled
        .lock()
        .map(|g| *g)
        .unwrap_or(false);
    if !enabled {
        return (false, "overlay disabled in settings");
    }

    let running = state.launcher.running().await;
    if running.is_empty() {
        return (false, "no game running");
    }

    let overlay_open =
        crate::commands::overlay::overlay_effective_visible(app, state.inner());

    if overlay_open {
        return (true, "overlay open — allow close");
    }

    #[cfg(windows)]
    {
        if launcher_window_focused(app) {
            let hotkey = state
                .overlay_registered_hotkey
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();
            if is_shift_tab(&hotkey) {
                return (false, "Shift+Tab with launcher focused");
            }
        }

        for label in [OVERLAY_WINDOW_LABEL, OVERLAY_HINT_WINDOW_LABEL] {
            if let Some(win) = app.get_webview_window(label) {
                if win.is_focused().unwrap_or(false) {
                    return (true, "overlay window focused");
                }
            }
        }

        let game_pids: Vec<u32> = running
            .iter()
            .map(|r| crate::game_window::resolve_visible_game_pid(r.pid))
            .filter(|&p| p > 0)
            .collect();

        if crate::game_window::overlay_hotkey_should_toggle(
            fg_raw,
            focus_raw,
            &game_pids,
            std::process::id(),
            overlay_open,
        ) {
            return (true, "game focused");
        }

        return (false, "another window focused — game not active");
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        (true, "platform without extra focus filter")
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_hotkey_handler(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    let gs = app.global_shortcut();
    let app_handle = app.clone();
    gs.on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let app = app_handle.clone();
        #[cfg(windows)]
        let fg_raw = crate::game_window::capture_foreground_hwnd();
        #[cfg(windows)]
        let focus_raw = crate::game_window::capture_focus_hwnd();
        tauri::async_runtime::spawn(async move {
            #[cfg(windows)]
            let (should, reason) =
                should_handle_overlay_hotkey(&app, fg_raw, focus_raw).await;
            #[cfg(not(windows))]
            let (should, reason) = should_handle_overlay_hotkey(&app).await;
            if !should {
                eprintln!("[overlay] hotkey ignorado: {reason}");
                return;
            }
            eprintln!("[overlay] hotkey acionado ({reason})");
            let state = app.state::<crate::commands::AppState>();
            let app_toggle = app.clone();
            match overlay_toggle_cached(app_toggle.clone(), state.inner()).await {
                Ok(open) => eprintln!("[overlay] toggle via hotkey: open={open}"),
                Err(e) => {
                    let msg = e.to_string();
                    eprintln!("[overlay] toggle via hotkey falhou: {msg}");
                    report_overlay_failure(&app_toggle, state.inner(), msg).await;
                }
            }
        });
    })
    .map_err(|e| format!("{e}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn sync_overlay_hotkey(app: &AppHandle, enabled: bool, hotkey: &str) -> OverlaySyncHotkeyResult {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if let Some(state) = app.try_state::<crate::commands::AppState>() {
        if let Ok(mut g) = state.overlay_user_enabled.lock() {
            *g = enabled;
        }
        if let Ok(mut g) = state.overlay_registered_hotkey.lock() {
            *g = String::new();
        }
    }

    if !enabled {
        eprintln!("[overlay] hotkey sync: overlay desativado");
        return OverlaySyncHotkeyResult {
            registered: true,
            hotkey: hotkey.to_string(),
            message: None,
        };
    }

    let trimmed = hotkey.trim();
    if trimmed.is_empty() {
        return OverlaySyncHotkeyResult {
            registered: false,
            hotkey: String::new(),
            message: Some(AppError::keyed("error.hotkey.empty").to_string()),
        };
    }

    let steam_running = steam_client_running();
    let requested = trimmed.to_string();
    let candidates = hotkey_candidates(trimmed, steam_running);

    for candidate in &candidates {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(e) => {
                return OverlaySyncHotkeyResult {
                    registered: false,
                    hotkey: requested.clone(),
                    message: Some(
                        AppError::keyed_vars(
                            "error.hotkey.invalid",
                            json!({ "detail": e.to_string() }),
                        )
                        .to_string(),
                    ),
                };
            }
        };

        let _ = gs.unregister_all();
        if register_hotkey_handler(app, shortcut).is_err() {
            continue;
        }

        if !gs.is_registered(shortcut) {
            continue;
        }

        let message = if candidate != &requested {
            if steam_running && is_shift_tab(&requested) {
                Some(
                    AppError::keyed_vars(
                        "error.hotkey.steamFallback",
                        json!({ "candidate": candidate }),
                    )
                    .to_string(),
                )
            } else {
                Some(
                    AppError::keyed_vars(
                        "error.hotkey.fallback",
                        json!({ "requested": requested, "candidate": candidate }),
                    )
                    .to_string(),
                )
            }
        } else {
            None
        };

        if let Some(state) = app.try_state::<crate::commands::AppState>() {
            if let Ok(mut g) = state.overlay_registered_hotkey.lock() {
                *g = candidate.clone();
            }
        }

        eprintln!("[overlay] hotkey registrado: {candidate}");
        return OverlaySyncHotkeyResult {
            registered: true,
            hotkey: candidate.clone(),
            message,
        };
    }

    eprintln!("[overlay] hotkey NÃO registrado para \"{trimmed}\"");
    OverlaySyncHotkeyResult {
        registered: false,
        hotkey: requested,
        message: Some(if steam_running && is_shift_tab(trimmed) {
            AppError::keyed("error.hotkey.steamReserved").to_string()
        } else {
            AppError::keyed_vars(
                "error.hotkey.registerFailed",
                json!({ "hotkey": trimmed }),
            )
            .to_string()
        }),
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn sync_overlay_hotkey(_app: &AppHandle, _enabled: bool, hotkey: &str) -> OverlaySyncHotkeyResult {
    OverlaySyncHotkeyResult {
        registered: false,
        hotkey: hotkey.to_string(),
        message: Some(AppError::keyed("error.hotkey.unavailable").to_string()),
    }
}
