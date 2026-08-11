//! Keeps the overlay webview aligned with the game window (position, size, Z-order).

use crate::commands::{default_overlay_layout, AppState, OverlayLayout, OVERLAY_WINDOW_LABEL};
use crate::game_window::{self, GameWindowMatch, OverlayAttachMode, ScreenRect};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tokio::sync::oneshot;

fn layout_to_place(layout: &OverlayLayout) -> (&str, Option<(f64, f64, f64, f64)>) {
    let geom = layout.geom.as_ref().map(|g| (g.x, g.y, g.w, g.h));
    (layout.display_mode.as_str(), geom)
}

fn rects_changed(a: ScreenRect, b: ScreenRect) -> bool {
    const T: i32 = 3;
    (a.x - b.x).abs() > T
        || (a.y - b.y).abs() > T
        || (a.width - b.width).abs() > T
        || (a.height - b.height).abs() > T
}

#[cfg(windows)]
pub fn overlay_native_hwnd(window: &tauri::WebviewWindow) -> Result<windows::Win32::Foundation::HWND, String> {
    if let Ok(hwnd) = window.hwnd() {
        if !hwnd.0.is_null() {
            return Ok(hwnd);
        }
    }
    window
        .show()
        .map_err(|e| format!("overlay show (hwnd): {e}"))?;
    window.hwnd().map_err(|e| format!("overlay hwnd: {e}"))
}

#[cfg(windows)]
pub fn apply_tauri_layout_fallback(
    window: &tauri::WebviewWindow,
    pid: u32,
    layout: &OverlayLayout,
) -> Option<ScreenRect> {
    let game_match = game_window::find_game_window_for_overlay(pid)?;
    let placed = overlay_placed_rect(&game_match, layout);
    sync_webview_bounds(window, placed);
    Some(game_match.rect)
}

#[cfg(windows)]
fn sync_webview_bounds(window: &tauri::WebviewWindow, rect: ScreenRect) {
    let _ = window.set_size(PhysicalSize::new(
        rect.width.max(1) as u32,
        rect.height.max(1) as u32,
    ));
    let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
}

fn attach_mode_label(mode: OverlayAttachMode) -> &'static str {
    match mode {
        OverlayAttachMode::OwnedWindow => "owned_window",
        OverlayAttachMode::TopmostOnGame => "topmost_on_game",
        OverlayAttachMode::MonitorFallback => "monitor_fallback",
    }
}

pub fn stop_follow(app: &AppHandle) {
    let cancel = app.try_state::<AppState>().and_then(|state| {
        state
            .overlay_follow_cancel
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    });
    if let Some(tx) = cancel {
        let _ = tx.send(());
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pid) = state.overlay_target_pid.lock() {
            *pid = None;
        }
    }
}

fn overlay_follow_is_paused(state: &AppState) -> bool {
    state
        .overlay_follow_paused_until
        .lock()
        .ok()
        .and_then(|g| *g)
        .map(|until| std::time::Instant::now() < until)
        .unwrap_or(false)
}

fn cached_layout(state: &AppState) -> OverlayLayout {
    state
        .overlay_cached_layout
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| default_overlay_layout())
}

pub fn start_follow(app: AppHandle, pid: u32, layout: OverlayLayout) {
    stop_follow(&app);
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_cached_layout.lock() {
            *g = layout;
        }
    }

    let (tx, mut rx) = oneshot::channel::<()>();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_follow_cancel.lock() {
            *g = Some(tx);
        }
        if let Ok(mut p) = state.overlay_target_pid.lock() {
            *p = Some(pid);
        }
    }

    let app_loop = app.clone();
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        let mut last_attach: Option<OverlayAttachMode> = None;
        #[cfg(windows)]
        let mut last_game_rect: Option<ScreenRect> = None;
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {
                    let Some(win) = app_loop.get_webview_window(OVERLAY_WINDOW_LABEL) else {
                        continue;
                    };
                    if !win.is_visible().unwrap_or(false) {
                        continue;
                    }
                    let Some(state) = app_loop.try_state::<AppState>() else {
                        continue;
                    };
                    if overlay_follow_is_paused(&state) {
                        continue;
                    }
                    let layout = cached_layout(&state);
                    #[cfg(windows)]
                    {
                        let Some(game_match) = game_window::find_game_window_for_overlay(pid) else {
                            continue;
                        };
                        let game_moved = last_game_rect
                            .map(|r| rects_changed(r, game_match.rect))
                            .unwrap_or(true);
                        if game_moved {
                            if apply_layout_to_game(&win, pid, &layout).is_ok() {
                                last_game_rect = Some(game_match.rect);
                            }
                        }
                        if last_attach != Some(game_match.attach_mode) {
                            last_attach = Some(game_match.attach_mode);
                            let _ = app_loop.emit(
                                "overlay:anchored",
                                serde_json::json!({
                                    "pid": pid,
                                    "rect": game_match.rect,
                                    "attachMode": attach_mode_label(game_match.attach_mode),
                                }),
                            );
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = apply_layout_to_game(&win, pid, &layout);
                    }
                }
            }
        }
        if let Some(state) = app_loop.try_state::<AppState>() {
            if let Ok(mut p) = state.overlay_target_pid.lock() {
                *p = None;
            }
        }
    });
}

#[cfg(windows)]
pub fn apply_layout_to_game(
    window: &tauri::WebviewWindow,
    pid: u32,
    layout: &OverlayLayout,
) -> Result<ScreenRect, String> {
    let game_match = game_window::find_game_window_for_overlay(pid).ok_or_else(|| {
        "error.overlay.locateGame".to_string()
    })?;

    if let Some(hwnd) = game_match.hwnd.map(|h| windows::Win32::Foundation::HWND(h as _)) {
        if game_window::is_minimized(hwnd) {
            let _ = window.hide();
            return Err("error.overlay.minimized".into());
        }
    }

    let overlay_hwnd = overlay_native_hwnd(window)?;
    let (mode, geom) = layout_to_place(layout);
    if game_window::place_overlay(overlay_hwnd, &game_match, mode, geom).is_err() {
        apply_tauri_layout_fallback(window, pid, layout);
    }

    Ok(game_match.rect)
}

#[cfg(windows)]
fn overlay_placed_rect(game_match: &GameWindowMatch, layout: &OverlayLayout) -> ScreenRect {
    if layout.display_mode == "compact" {
        if let Some(g) = layout.geom.as_ref() {
            return game_window::compact_screen_rect(
                game_match.rect,
                (g.x, g.y, g.w, g.h),
            );
        }
    }
    game_match.rect
}

#[cfg(windows)]
pub fn apply_layout_to_game_with_emit(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    pid: u32,
    layout: &OverlayLayout,
) -> Result<(ScreenRect, GameWindowMatch), String> {
    let game_match = game_window::find_game_window_for_overlay(pid).ok_or_else(|| {
        "error.overlay.locateGame".to_string()
    })?;

    if let Some(hwnd) = game_match.hwnd.map(|h| windows::Win32::Foundation::HWND(h as _)) {
        if game_window::is_minimized(hwnd) {
            let _ = window.hide();
            return Err("error.overlay.minimized".into());
        }
    }

    let overlay_hwnd = overlay_native_hwnd(window)?;
    let (mode, geom) = layout_to_place(layout);
    if game_window::place_overlay(overlay_hwnd, &game_match, mode, geom).is_err() {
        apply_tauri_layout_fallback(window, pid, layout);
    } else {
        game_window::raise_overlay(overlay_hwnd);
    }

    let _ = app.emit(
        "overlay:anchored",
        serde_json::json!({
            "pid": pid,
            "rect": game_match.rect,
            "attachMode": attach_mode_label(game_match.attach_mode),
        }),
    );

    Ok((game_match.rect, game_match))
}

#[cfg(not(windows))]
pub fn apply_layout_to_game(
    window: &tauri::WebviewWindow,
    _pid: u32,
    layout: &OverlayLayout,
) -> Result<ScreenRect, String> {
    if layout.display_mode == "compact" {
        let geom = layout.geom.as_ref().ok_or_else(|| "geometria compacta ausente".to_string())?;
        window
            .set_size(tauri::LogicalSize::new(geom.w, geom.h))
            .map_err(|e| format!("set_size: {e}"))?;
        window
            .set_position(tauri::LogicalPosition::new(geom.x, geom.y))
            .map_err(|e| format!("set_position: {e}"))?;
        return Ok(ScreenRect {
            x: geom.x.round() as i32,
            y: geom.y.round() as i32,
            width: geom.w.round() as i32,
            height: geom.h.round() as i32,
        });
    }
    Err("error.overlay.windowsOnly".into())
}
