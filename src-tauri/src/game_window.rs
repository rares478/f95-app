//! Resolve and track the game window for overlay anchoring (Windows).
//! Supports windowed, borderless, foreground capture, and exclusive-fullscreen fallbacks.

#[cfg(not(windows))]
use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayAttachMode {
    /// Normal top-level window — overlay owned by game HWND.
    OwnedWindow,
    /// Game rect covers a monitor (borderless / pseudo-fullscreen).
    TopmostOnGame,
    /// No HWND — overlay covers the monitor under the cursor (exclusive fullscreen fallback).
    MonitorFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Result of multi-strategy game window resolution.
#[derive(Debug, Clone, Copy)]
pub struct GameWindowMatch {
    pub hwnd: Option<isize>,
    pub rect: ScreenRect,
    pub attach_mode: OverlayAttachMode,
}

pub const OVERLAY_HINT_WIDTH: i32 = 400;
pub const OVERLAY_HINT_HEIGHT: i32 = 96;

#[cfg(windows)]
mod win {
    use super::{GameWindowMatch, OverlayAttachMode, ScreenRect};
    use crate::error::AppError;
    use serde_json::json;
    use std::collections::{HashSet, VecDeque};
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITOR_DEFAULTTONEAREST, MONITORINFO,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow,
        GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GA_ROOT, GWL_EXSTYLE, GWLP_HWNDPARENT, HWND_TOP,
        HWND_TOPMOST, SW_HIDE, SW_SHOWNA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        WS_EX_TOPMOST, WS_EX_TOOLWINDOW,
    };

    static LAST_KNOWN: Mutex<Option<(u32, ScreenRect)>> = Mutex::new(None);

    const MIN_HINT_GAME_WIDTH: i32 = 320;
    const MIN_HINT_GAME_HEIGHT: i32 = 240;

    fn window_area(hwnd: HWND) -> Option<(i32, i32, i32)> {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect).ok()?;
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some((rect.left, rect.top, w * h))
    }

    fn is_owned_by_pid(hwnd: HWND, pid: u32) -> bool {
        if hwnd.0.is_null() || pid == 0 {
            return false;
        }
        let mut window_pid = 0u32;
        unsafe {
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
        }
        window_pid == pid
    }

    fn is_root(hwnd: HWND) -> bool {
        unsafe { GetAncestor(hwnd, GA_ROOT) == hwnd }
    }

    fn window_class(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        if len == 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    /// Prefer known engine render surfaces (Unity child HWND, SDL, etc.).
    fn surface_score(hwnd: HWND, area: i32) -> i64 {
        let class = window_class(hwnd).to_lowercase();
        let boost = if class.contains("unity")
            || class.contains("sdl")
            || class.contains("glfw")
            || class.contains("unreal")
            || class.contains("gfx")
            || class.contains("renpy")
        {
            1.25
        } else {
            1.0
        };
        ((area as f64) * boost) as i64
    }

    struct FindSurface {
        pid: u32,
        require_visible: bool,
        best: Option<HWND>,
        best_score: i64,
    }

    fn consider_surface(hwnd: HWND, data: &mut FindSurface) {
        if !is_owned_by_pid(hwnd, data.pid) {
            return;
        }
        if data.require_visible && !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return;
        }
        if unsafe { IsIconic(hwnd).as_bool() } {
            return;
        }
        let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 };
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return;
        }
        let Some((_, _, area)) = window_area(hwnd) else {
            return;
        };
        if area < 160 * 120 {
            return;
        }
        let score = surface_score(hwnd, area);
        if score > data.best_score {
            data.best_score = score;
            data.best = Some(hwnd);
        }
    }

    unsafe extern "system" fn enum_child_surfaces(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam.0 as *mut FindSurface);
        consider_surface(hwnd, data);
        let _ = EnumChildWindows(Some(hwnd), Some(enum_child_surfaces), lparam);
        BOOL(1)
    }

    unsafe extern "system" fn enum_tops_for_surface(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam.0 as *mut FindSurface);
        if !is_root(hwnd) || !is_owned_by_pid(hwnd, data.pid) {
            return BOOL(1);
        }
        consider_surface(hwnd, data);
        let _ = EnumChildWindows(Some(hwnd), Some(enum_child_surfaces), lparam);
        BOOL(1)
    }

    /// True when the process owns at least one game-sized window surface.
    pub fn game_has_window_surface(pid: u32) -> bool {
        find_largest_surface(pid, false).is_some()
    }

    /// Largest visible HWND for the process (includes Unity/Unreal child render windows).
    fn find_largest_surface(pid: u32, require_visible: bool) -> Option<HWND> {
        let mut data = FindSurface {
            pid,
            require_visible,
            best: None,
            best_score: 0,
        };
        unsafe {
            let _ = EnumWindows(Some(enum_tops_for_surface), LPARAM(&mut data as *mut _ as isize));
        }
        data.best
    }

    fn largest_surface_under(root: HWND, pid: u32, require_visible: bool) -> Option<HWND> {
        let mut data = FindSurface {
            pid,
            require_visible,
            best: None,
            best_score: 0,
        };
        consider_surface(root, &mut data);
        unsafe {
            let _ = EnumChildWindows(
                Some(root),
                Some(enum_child_surfaces),
                LPARAM(&mut data as *mut _ as isize),
            );
        }
        data.best
    }

    pub fn foreground_surface_for_pid(pid: u32) -> Option<HWND> {
        let fg = unsafe { GetForegroundWindow() };
        if !is_owned_by_pid(fg, pid) {
            return None;
        }
        let root = unsafe { GetAncestor(fg, GA_ROOT) };
        largest_surface_under(root, pid, false).or(Some(fg))
    }

    fn match_from_hwnd(hwnd: HWND, pid: u32) -> Option<GameWindowMatch> {
        let rect = screen_rect(hwnd)?;
        if rect.width < MIN_HINT_GAME_WIDTH || rect.height < MIN_HINT_GAME_HEIGHT {
            return None;
        }
        let mode = classify_attach_mode(hwnd, rect);
        cache_match(pid, rect);
        Some(GameWindowMatch {
            hwnd: Some(hwnd.0 as isize),
            rect,
            attach_mode: mode,
        })
    }

    pub fn monitor_rect_from_point(x: i32, y: i32) -> Option<ScreenRect> {
        let pt = POINT { x, y };
        let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
        monitor_rect_from_handle(hmon)
    }

    pub fn monitor_rect_from_window(hwnd: HWND) -> Option<ScreenRect> {
        let hmon = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        monitor_rect_from_handle(hmon)
    }

    fn monitor_rect_from_handle(hmon: windows::Win32::Graphics::Gdi::HMONITOR) -> Option<ScreenRect> {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(hmon, &mut info) }.as_bool() {
            return None;
        }
        let r = info.rcMonitor;
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some(ScreenRect {
            x: r.left,
            y: r.top,
            width: w,
            height: h,
        })
    }

    pub fn cursor_monitor_rect() -> ScreenRect {
        let mut pt = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut pt);
        }
        monitor_rect_from_point(pt.x, pt.y).unwrap_or(ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        })
    }

    fn rects_match_monitor(window: ScreenRect, monitor: ScreenRect) -> bool {
        const TOL: i32 = 16;
        (window.x - monitor.x).abs() <= TOL
            && (window.y - monitor.y).abs() <= TOL
            && (window.width - monitor.width).abs() <= TOL
            && (window.height - monitor.height).abs() <= TOL
    }

    fn cache_match(pid: u32, rect: ScreenRect) {
        if let Ok(mut g) = LAST_KNOWN.lock() {
            *g = Some((pid, rect));
        }
    }

    pub fn clear_cached_match() {
        if let Ok(mut g) = LAST_KNOWN.lock() {
            *g = None;
        }
    }

    fn child_pids_of(parent: u32) -> Vec<u32> {
        let mut out = Vec::new();
        unsafe {
            let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return out,
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut entry).is_err() {
                return out;
            }
            loop {
                if entry.th32ParentProcessID == parent {
                    out.push(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        out
    }

    pub fn process_tree_pids(root: u32) -> Vec<u32> {
        if root == 0 {
            return Vec::new();
        }
        let mut seen = HashSet::from([root]);
        let mut queue = VecDeque::from([root]);
        let mut all = vec![root];
        while let Some(pid) = queue.pop_front() {
            for child in child_pids_of(pid) {
                if seen.insert(child) {
                    all.push(child);
                    queue.push_back(child);
                }
            }
        }
        all
    }

    pub fn process_tree_has_window_surface(root: u32) -> bool {
        process_tree_pids(root)
            .iter()
            .any(|&p| game_has_window_surface(p))
    }

    /// Ren'Py and other launchers often spawn a child process — follow the tree until a HWND exists.
    pub fn resolve_visible_game_pid(preferred: u32) -> u32 {
        if preferred == 0 {
            return preferred;
        }
        if game_has_window_surface(preferred) {
            return preferred;
        }
        let mut seen = HashSet::from([preferred]);
        let mut queue = VecDeque::from([preferred]);
        while let Some(pid) = queue.pop_front() {
            for child in child_pids_of(pid) {
                if !seen.insert(child) {
                    continue;
                }
                if game_has_window_surface(child) {
                    return child;
                }
                queue.push_back(child);
            }
        }
        preferred
    }

    fn normalize_dir_key(dir: &Path) -> String {
        let mut s = dir.to_string_lossy().replace('\\', "/").to_lowercase();
        while s.ends_with('/') {
            s.pop();
        }
        s.push('/');
        s
    }

    fn process_exe_path(pid: u32) -> Option<PathBuf> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 32_768];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            if !ok || size == 0 {
                return None;
            }
            Some(PathBuf::from(String::from_utf16_lossy(
                &buf[..size as usize],
            )))
        }
    }

    fn all_process_pids() -> Vec<u32> {
        let mut out = Vec::new();
        unsafe {
            let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return out,
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut entry).is_err() {
                return out;
            }
            loop {
                out.push(entry.th32ProcessID);
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        out
    }

    fn pids_with_exe_under_dir(install_dir: &Path) -> Vec<u32> {
        let install_key = normalize_dir_key(install_dir);
        all_process_pids()
            .into_iter()
            .filter(|&pid| {
                process_exe_path(pid).is_some_and(|path| {
                    path.parent()
                        .map(normalize_dir_key)
                        .is_some_and(|parent| parent == install_key || parent.starts_with(&install_key))
                })
            })
            .collect()
    }

    fn session_candidate_pids(root_pid: u32, install_dir: &Path) -> Vec<u32> {
        let mut seen = HashSet::new();
        if root_pid != 0 {
            for pid in process_tree_pids(root_pid) {
                seen.insert(pid);
            }
            let resolved = resolve_visible_game_pid(root_pid);
            if resolved != 0 {
                seen.insert(resolved);
            }
        }
        for pid in pids_with_exe_under_dir(install_dir) {
            seen.insert(pid);
        }
        seen.into_iter().collect()
    }

    fn session_has_game_window(root_pid: u32, install_dir: &Path) -> bool {
        session_candidate_pids(root_pid, install_dir)
            .iter()
            .any(|&pid| game_has_window_surface(pid))
    }

    /// After a launcher stub exits, keep measuring until no game window remains.
    /// Ren'Py and similar engines often reparent the real game out of the stub tree.
    pub async fn wait_for_game_window_session_end(root_pid: u32, install_dir: PathBuf) {
        use tokio::time::{sleep, Duration};

        const POLL: Duration = Duration::from_millis(800);
        const STARTUP_POLLS: u32 = 20;
        const EXIT_POLLS: u32 = 3;

        let mut saw_window = false;

        for _ in 0..STARTUP_POLLS {
            if session_has_game_window(root_pid, &install_dir) {
                saw_window = true;
                break;
            }
            sleep(POLL).await;
        }

        if !saw_window {
            // Direct-run games may already have exited; a few polls avoids instant zero-duration.
            for _ in 0..5 {
                if session_has_game_window(root_pid, &install_dir) {
                    saw_window = true;
                    break;
                }
                sleep(POLL).await;
            }
        }

        if !saw_window {
            return;
        }

        let mut empty_streak = 0u32;
        loop {
            if session_has_game_window(root_pid, &install_dir) {
                empty_streak = 0;
            } else {
                empty_streak += 1;
                if empty_streak >= EXIT_POLLS {
                    break;
                }
            }
            sleep(POLL).await;
        }
    }

    pub fn win32_show_no_activate(hwnd: HWND) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNA);
        }
    }

    pub fn win32_hide(hwnd: HWND) {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }

    fn cached_monitor_for_pid(pid: u32) -> Option<ScreenRect> {
        LAST_KNOWN
            .lock()
            .ok()
            .and_then(|g| g.as_ref().filter(|(p, _)| *p == pid).map(|(_, r)| *r))
    }

    pub fn find_game_window_for_overlay(pid: u32) -> Option<GameWindowMatch> {
        if pid == 0 {
            return None;
        }

        if let Some(hwnd) = foreground_surface_for_pid(pid) {
            if let Some(m) = match_from_hwnd(hwnd, pid) {
                return Some(m);
            }
        }

        if let Some(hwnd) = find_largest_surface(pid, true) {
            if let Some(m) = match_from_hwnd(hwnd, pid) {
                return Some(m);
            }
        }

        if let Some(hwnd) = find_largest_surface(pid, false) {
            if let Some(m) = match_from_hwnd(hwnd, pid) {
                return Some(m);
            }
        }

        let rect = cached_monitor_for_pid(pid).unwrap_or_else(cursor_monitor_rect);
        cache_match(pid, rect);
        Some(GameWindowMatch {
            hwnd: None,
            rect,
            attach_mode: OverlayAttachMode::MonitorFallback,
        })
    }

    /// Same strategies as [`find_game_window_for_overlay`] but **without** monitor fallback.
    pub fn find_game_window_with_hwnd(pid: u32) -> Option<GameWindowMatch> {
        if pid == 0 {
            return None;
        }

        if let Some(hwnd) = foreground_surface_for_pid(pid) {
            if let Some(m) = match_from_hwnd(hwnd, pid) {
                return Some(m);
            }
        }

        if let Some(hwnd) = find_largest_surface(pid, true) {
            if let Some(m) = match_from_hwnd(hwnd, pid) {
                return Some(m);
            }
        }

        find_largest_surface(pid, false).and_then(|hwnd| match_from_hwnd(hwnd, pid))
    }

    fn classify_attach_mode(surface: HWND, rect: ScreenRect) -> OverlayAttachMode {
        let root = unsafe { GetAncestor(surface, GA_ROOT) };
        if let Some(mon) = monitor_rect_from_window(root) {
            if rects_match_monitor(rect, mon) {
                return OverlayAttachMode::TopmostOnGame;
            }
        }
        OverlayAttachMode::OwnedWindow
    }

    pub fn find_main_window_for_pid(pid: u32) -> Option<HWND> {
        find_game_window_for_overlay(pid).and_then(|m| m.hwnd.map(|h| HWND(h as _)))
    }

    pub fn screen_rect(hwnd: HWND) -> Option<ScreenRect> {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect).ok()?;
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w <= 0 || h <= 0 {
            return None;
        }
        Some(ScreenRect {
            x: rect.left,
            y: rect.top,
            width: w,
            height: h,
        })
    }

    pub fn is_minimized(hwnd: HWND) -> bool {
        unsafe { IsIconic(hwnd).as_bool() }
    }

    pub fn clear_owner(child: HWND) {
        unsafe {
            SetWindowLongPtrW(child, GWLP_HWNDPARENT, 0);
        }
    }

    pub fn set_owner(child: HWND, owner: HWND) {
        unsafe {
            SetWindowLongPtrW(child, GWLP_HWNDPARENT, owner.0 as isize);
        }
    }

    pub fn place_overlay(
        overlay: HWND,
        game_match: &GameWindowMatch,
        display_mode: &str,
        compact_geom: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), String> {
        let layout = PlaceLayout {
            display_mode,
            compact_geom,
        };
        let hwnd = game_match.hwnd.map(|h| HWND(h as _));

        // Always use a top-level topmost overlay. Parenting to the game HWND hides the
        // webview behind many engine render surfaces (Ren'Py/SDL/Unity child windows).
        let _ = hwnd;
        clear_owner(overlay);
        place_on_rect(
            overlay,
            Some(HWND_TOPMOST),
            game_match.rect,
            layout,
        )?;
        raise_overlay(overlay);
        Ok(())
    }

    pub fn raise_overlay(overlay: HWND) {
        unsafe {
            let _ = SetWindowPos(
                overlay,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }

    struct PlaceLayout<'a> {
        display_mode: &'a str,
        compact_geom: Option<(f64, f64, f64, f64)>,
    }

    pub fn compact_screen_rect(base: ScreenRect, geom: (f64, f64, f64, f64)) -> ScreenRect {
        let (x, y, w, h) = geom;
        let max_w = base.width.saturating_sub(32);
        let max_h = base.height.saturating_sub(32);
        let cw = w.round() as i32;
        let ch = h.round() as i32;
        let cw = cw.clamp(400, max_w.max(400));
        let ch = ch.clamp(280, max_h.max(280));
        let cx = base.x + x.round() as i32;
        let cy = base.y + y.round() as i32;
        let cx = cx.clamp(base.x, base.x + (base.width - cw).max(0));
        let cy = cy.clamp(base.y, base.y + (base.height - ch).max(0));
        ScreenRect {
            x: cx,
            y: cy,
            width: cw,
            height: ch,
        }
    }

    fn place_on_rect(
        overlay: HWND,
        z: Option<HWND>,
        base: ScreenRect,
        layout: PlaceLayout<'_>,
    ) -> Result<(), String> {
        if layout.display_mode == "compact" {
            let (x, y, w, h) = layout.compact_geom.ok_or_else(|| {
                AppError::keyed("error.overlay.compactGeomMissing").to_string()
            })?;
            let rect = compact_screen_rect(base, (x, y, w, h));
            unsafe {
                SetWindowPos(
                    overlay,
                    z,
                    rect.x,
                    rect.y,
                    rect.width,
                    rect.height,
                    SWP_SHOWWINDOW | SWP_NOACTIVATE,
                )
                .map_err(|e| {
                    AppError::keyed_vars(
                        "error.overlay.setWindowPos",
                        json!({ "detail": e.to_string() }),
                    )
                    .to_string()
                })?;
            }
        } else {
            unsafe {
                SetWindowPos(
                    overlay,
                    z,
                    base.x,
                    base.y,
                    base.width,
                    base.height,
                    SWP_SHOWWINDOW | SWP_NOACTIVATE,
                )
                .map_err(|e| {
                    AppError::keyed_vars(
                        "error.overlay.setWindowPos",
                        json!({ "detail": e.to_string() }),
                    )
                    .to_string()
                })?;
            }
        }
        Ok(())
    }

    const HINT_MARGIN: i32 = 24;

    pub fn surface_rects_changed(a: ScreenRect, b: ScreenRect) -> bool {
        const T: i32 = 4;
        (a.x - b.x).abs() > T
            || (a.y - b.y).abs() > T
            || (a.width - b.width).abs() > T
            || (a.height - b.height).abs() > T
    }

    pub fn hint_rect_on_game(base: ScreenRect) -> ScreenRect {
        let w = super::OVERLAY_HINT_WIDTH.min(base.width.saturating_sub(16));
        let h = super::OVERLAY_HINT_HEIGHT.min(base.height.saturating_sub(16));
        ScreenRect {
            x: base.x + base.width - w - HINT_MARGIN,
            y: base.y + base.height - h - HINT_MARGIN,
            width: w,
            height: h,
        }
    }

    fn ensure_topmost(hwnd: HWND) {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            if ex & WS_EX_TOPMOST.0 == 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_TOPMOST.0) as isize);
            }
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    pub fn hint_rects_close(a: ScreenRect, b: ScreenRect) -> bool {
        const T: i32 = 2;
        (a.x - b.x).abs() <= T
            && (a.y - b.y).abs() <= T
            && (a.width - b.width).abs() <= T
            && (a.height - b.height).abs() <= T
    }

    fn lerp_i32(from: i32, to: i32, t: f32) -> i32 {
        (from as f32 + (to - from) as f32 * t).round() as i32
    }

    /// Exponential ease toward target (higher `factor` = snappier, lower = silkier).
    pub fn smooth_hint_rect_toward(
        current: ScreenRect,
        target: ScreenRect,
        factor: f32,
    ) -> ScreenRect {
        let t = factor.clamp(0.12, 1.0);
        ScreenRect {
            x: lerp_i32(current.x, target.x, t),
            y: lerp_i32(current.y, target.y, t),
            width: lerp_i32(current.width, target.width, t),
            height: lerp_i32(current.height, target.height, t),
        }
    }

    fn step_axis(current: i32, target: i32, max_step: i32) -> i32 {
        let delta = target - current;
        if delta.abs() <= max_step {
            target
        } else if delta > 0 {
            current + max_step
        } else {
            current - max_step
        }
    }

    /// Move hint rect toward `target` by at most `max_step` pixels per edge (smooth follow).
    pub fn step_hint_rect_toward(
        current: ScreenRect,
        target: ScreenRect,
        max_step: i32,
    ) -> ScreenRect {
        ScreenRect {
            x: step_axis(current.x, target.x, max_step),
            y: step_axis(current.y, target.y, max_step),
            width: step_axis(current.width, target.width, max_step),
            height: step_axis(current.height, target.height, max_step),
        }
    }

    /// Place the hint at an explicit screen rect.
    pub fn place_hint_at_rect(overlay: HWND, screen_rect: ScreenRect, show: bool) -> Result<(), String> {
        if show {
            clear_owner(overlay);
            ensure_topmost(overlay);
        }
        let flags = if show {
            SWP_SHOWWINDOW | SWP_NOACTIVATE
        } else {
            SWP_NOACTIVATE
        };
        unsafe {
            SetWindowPos(
                overlay,
                Some(HWND_TOPMOST),
                screen_rect.x,
                screen_rect.y,
                screen_rect.width,
                screen_rect.height,
                flags,
            )
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.overlay.setWindowPos",
                    json!({ "detail": e.to_string() }),
                )
                .to_string()
            })?;
        }
        Ok(())
    }

    /// Place the hint (topmost, screen coords). `show` = first paint; updates move without SHOWWINDOW.
    pub fn place_hint(
        overlay: HWND,
        game_match: &GameWindowMatch,
        show: bool,
    ) -> Result<ScreenRect, String> {
        let screen_rect = hint_rect_on_game(game_match.rect);
        place_hint_at_rect(overlay, screen_rect, show)?;
        Ok(screen_rect)
    }

    /// Best-effort hint rect: game surface if known, else the monitor tied to the PID.
    pub fn hint_rect_for_pid(pid: u32) -> ScreenRect {
        if let Some(gm) = find_game_window_with_hwnd(pid) {
            return hint_rect_on_game(gm.rect);
        }
        let mon = cached_monitor_for_pid(pid).unwrap_or_else(cursor_monitor_rect);
        hint_rect_on_game(mon)
    }

    pub fn place_hint_for_pid(overlay: HWND, pid: u32, show: bool) -> Result<ScreenRect, String> {
        let screen_rect = hint_rect_for_pid(pid);
        place_hint_at_rect(overlay, screen_rect, show)?;
        Ok(screen_rect)
    }

    /// Foreground HWND at call time (call synchronously inside the hotkey handler).
    pub fn capture_foreground_hwnd() -> Option<isize> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            None
        } else {
            Some(hwnd.0 as isize)
        }
    }

    /// Keyboard-focus HWND (helps exclusive fullscreen when GetForegroundWindow is empty).
    pub fn capture_focus_hwnd() -> Option<isize> {
        use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GUITHREADINFO};
        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetGUIThreadInfo(0, &mut info) }.is_ok() && !info.hwndFocus.0.is_null() {
            Some(info.hwndFocus.0 as isize)
        } else {
            None
        }
    }

    /// Best HWND for hotkey gating: foreground first, then keyboard focus.
    pub fn capture_hotkey_target_hwnd() -> Option<isize> {
        capture_foreground_hwnd().or_else(capture_focus_hwnd)
    }

    fn hwnd_from_isize(raw: isize) -> HWND {
        HWND(raw as _)
    }

    /// True when `fg` belongs to one of the running game processes (PID or window tree).
    pub fn foreground_hwnd_matches_running_game(fg_raw: isize, game_pids: &[u32]) -> bool {
        if fg_raw == 0 || game_pids.is_empty() {
            return false;
        }
        let fg = hwnd_from_isize(fg_raw);
        if fg.0.is_null() {
            return false;
        }

        let mut fg_pid = 0u32;
        unsafe {
            let _ = GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        }
        if game_pids.iter().any(|&pid| pid > 0 && pid == fg_pid) {
            return true;
        }

        let fg_root = unsafe { GetAncestor(fg, GA_ROOT) };
        let mut root_pid = 0u32;
        unsafe {
            let _ = GetWindowThreadProcessId(fg_root, Some(&mut root_pid));
        }
        if game_pids.iter().any(|&pid| pid > 0 && pid == root_pid) {
            return true;
        }

        for &pid in game_pids {
            if pid == 0 {
                continue;
            }
            if is_owned_by_pid(fg, pid) || is_owned_by_pid(fg_root, pid) {
                return true;
            }
            for require_visible in [true, false] {
                if let Some(surface) = find_largest_surface(pid, require_visible) {
                    let surface_root = unsafe { GetAncestor(surface, GA_ROOT) };
                    if fg_root == surface_root {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// True when the foreground HWND belongs to one of the given game PIDs.
    pub fn foreground_matches_running_game(game_pids: &[u32]) -> bool {
        let Some(fg) = capture_foreground_hwnd() else {
            return false;
        };
        foreground_hwnd_matches_running_game(fg, game_pids)
    }

    pub fn is_shell_desktop_hwnd_raw(hwnd_raw: isize) -> bool {
        if hwnd_raw == 0 {
            return false;
        }
        is_shell_desktop_hwnd(hwnd_from_isize(hwnd_raw))
    }

    fn is_shell_desktop_hwnd(hwnd: HWND) -> bool {
        if hwnd.0.is_null() {
            return false;
        }
        let class = window_class(hwnd).to_lowercase();
        matches!(
            class.as_str(),
            "progman" | "workerw" | "shell_traywnd" | "shell_secondarytraywnd"
        )
    }

    fn hwnd_matches_running_game(hwnd_raw: isize, game_pids: &[u32]) -> bool {
        if hwnd_raw == 0 {
            return false;
        }
        let mut pid = 0u32;
        unsafe {
            let _ = GetWindowThreadProcessId(hwnd_from_isize(hwnd_raw), Some(&mut pid));
        }
        if game_pids.iter().any(|&p| p > 0 && p == pid) {
            return true;
        }
        foreground_hwnd_matches_running_game(hwnd_raw, game_pids)
    }

    /// Global overlay hotkey: allow game focus (incl. exclusive fullscreen), block F95 app + desktop shell.
    pub fn overlay_hotkey_should_toggle(
        fg_raw: Option<isize>,
        focus_raw: Option<isize>,
        game_pids: &[u32],
        our_pid: u32,
        overlay_visible: bool,
    ) -> bool {
        if game_pids.is_empty() {
            return false;
        }

        let fg = fg_raw.unwrap_or(0);
        let focus = focus_raw.unwrap_or(0);
        let probe = if fg != 0 { fg } else { focus };

        let mut probe_pid = 0u32;
        if probe != 0 {
            unsafe {
                let _ = GetWindowThreadProcessId(hwnd_from_isize(probe), Some(&mut probe_pid));
            }
        }

        if overlay_visible && probe_pid == our_pid {
            return true;
        }

        if probe != 0 {
            let probe_root = unsafe { GetAncestor(hwnd_from_isize(probe), GA_ROOT) };
            if is_shell_desktop_hwnd(hwnd_from_isize(probe))
                || is_shell_desktop_hwnd(probe_root)
            {
                return false;
            }
        }

        if probe_pid == our_pid {
            return false;
        }

        for hwnd in [fg, focus] {
            if hwnd_matches_running_game(hwnd, game_pids) {
                return true;
            }
        }

        for &pid in game_pids {
            if pid == 0 {
                continue;
            }
            if let Some(gm) = find_game_window_for_overlay(pid) {
                if gm.attach_mode == OverlayAttachMode::MonitorFallback {
                    if fg == 0 && focus == 0 {
                        return game_pids.len() == 1;
                    }
                    if game_pids.contains(&probe_pid) {
                        return true;
                    }
                }
            }
        }

        false
    }
}

#[cfg(windows)]
pub use win::{
    compact_screen_rect, find_game_window_with_hwnd, hint_rect_for_pid, hint_rect_on_game,
    hint_rects_close, place_hint, place_hint_at_rect, place_hint_for_pid, smooth_hint_rect_toward,
    step_hint_rect_toward, surface_rects_changed, *,
};

#[cfg(not(windows))]
pub fn game_has_window_surface(_pid: u32) -> bool {
    false
}

#[cfg(not(windows))]
pub fn resolve_visible_game_pid(preferred: u32) -> u32 {
    preferred
}

#[cfg(not(windows))]
pub fn process_tree_has_window_surface(_root: u32) -> bool {
    false
}

#[cfg(not(windows))]
pub async fn wait_for_game_window_session_end(_root_pid: u32, _install_dir: std::path::PathBuf) {}

#[cfg(not(windows))]
pub fn clear_cached_match() {}

#[cfg(not(windows))]
pub fn win32_show_no_activate(_hwnd: u64) {}

#[cfg(not(windows))]
pub fn win32_hide(_hwnd: u64) {}

#[cfg(not(windows))]
pub fn find_game_window_for_overlay(_pid: u32) -> Option<GameWindowMatch> {
    None
}

#[cfg(not(windows))]
pub fn find_game_window_with_hwnd(_pid: u32) -> Option<GameWindowMatch> {
    None
}

#[cfg(not(windows))]
pub fn find_main_window_for_pid(_pid: u32) -> Option<u64> {
    None
}

#[cfg(not(windows))]
pub fn screen_rect(_hwnd: u64) -> Option<ScreenRect> {
    None
}

#[cfg(not(windows))]
pub fn is_minimized(_hwnd: u64) -> bool {
    false
}

#[cfg(not(windows))]
pub fn capture_foreground_hwnd() -> Option<isize> {
    None
}

#[cfg(not(windows))]
pub fn foreground_hwnd_matches_running_game(_fg: isize, _game_pids: &[u32]) -> bool {
    false
}

#[cfg(not(windows))]
pub fn foreground_matches_running_game(_game_pids: &[u32]) -> bool {
    false
}

#[cfg(not(windows))]
pub fn capture_focus_hwnd() -> Option<isize> {
    None
}

#[cfg(not(windows))]
pub fn capture_hotkey_target_hwnd() -> Option<isize> {
    None
}

#[cfg(not(windows))]
pub fn is_shell_desktop_hwnd_raw(_hwnd_raw: isize) -> bool {
    false
}

#[cfg(not(windows))]
pub fn overlay_hotkey_should_toggle(
    _fg_raw: Option<isize>,
    _focus_raw: Option<isize>,
    _game_pids: &[u32],
    _our_pid: u32,
    _overlay_visible: bool,
) -> bool {
    false
}

#[cfg(not(windows))]
pub fn place_overlay(
    _overlay: u64,
    _game_match: &GameWindowMatch,
    _display_mode: &str,
    _compact_geom: Option<(f64, f64, f64, f64)>,
) -> Result<(), String> {
    Err(AppError::keyed("error.overlay.windowsOnly").to_string())
}

#[cfg(not(windows))]
pub fn hint_rect_on_game(base: ScreenRect) -> ScreenRect {
    base
}

#[cfg(not(windows))]
pub fn compact_screen_rect(
    base: ScreenRect,
    geom: (f64, f64, f64, f64),
) -> ScreenRect {
    let (x, y, w, h) = geom;
    ScreenRect {
        x: base.x + x.round() as i32,
        y: base.y + y.round() as i32,
        width: w.round() as i32,
        height: h.round() as i32,
    }
}

#[cfg(not(windows))]
pub fn surface_rects_changed(a: ScreenRect, b: ScreenRect) -> bool {
    a != b
}

#[cfg(not(windows))]
pub fn place_hint(
    _overlay: u64,
    game_match: &GameWindowMatch,
    _show: bool,
) -> Result<ScreenRect, String> {
    Ok(hint_rect_on_game(game_match.rect))
}
