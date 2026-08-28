//! Game launcher.
//!
//! Spawns a child process for an installed game and tracks its lifetime so the
//! frontend can show "playing now" indicators and accumulate playtime. The
//! durable session row lives in `play_sessions` (owned by the JS layer); this
//! module just runs the OS process and emits `game:started` / `game:exited`
//! events with the duration measured in Rust.
//!
//! Child processes are NOT killed when our app exits — that's intentional, the
//! user can keep playing after closing us. Their session row stays open and is
//! cleaned up by `sessions.closeOrphans()` at the next app start.

use crate::error::AppError;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

struct RunningGame {
    pid: u32,
    started: Instant,
    kill_tx: Option<oneshot::Sender<()>>,
    _waiter: JoinHandle<()>,
    _pid_refresh: JoinHandle<()>,
}

pub struct LauncherManager {
    inner: Arc<Mutex<HashMap<String, RunningGame>>>,
}

impl LauncherManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn the game executable and start watching its lifetime. Returns the
    /// child PID immediately; observe `game:exited` for the result. `session_id`
    /// is the row id in `play_sessions` so JS can close the right session row
    /// when we report exit.
    pub async fn launch(
        &self,
        app: AppHandle,
        thread_id: String,
        title: String,
        exe_path: String,
        session_id: i64,
        locale_emulator: bool,
    ) -> Result<u32, AppError> {
        // Guard against double-launch.
        if self.inner.lock().await.contains_key(&thread_id) {
            return Err(AppError::keyed_vars(
                "error.launch.alreadyRunning",
                json!({ "threadId": thread_id }),
            ));
        }

        let exe = PathBuf::from(&exe_path);
        if !exe.exists() {
            return Err(AppError::keyed_vars(
                "error.launch.exeMissing",
                json!({ "path": exe_path }),
            ));
        }

        // Browser games: open with the OS default app and skip process tracking.
        if is_browser_launch_path(&exe) {
            open_with_default_app(&exe)?;
            let _ = app.emit(
                "game:started",
                json!({
                    "threadId": thread_id,
                    "sessionId": session_id,
                    "pid": 0,
                    "exePath": exe_path,
                }),
            );
            let _ = app.emit(
                "game:exited",
                json!({
                    "threadId": thread_id,
                    "sessionId": session_id,
                    "durationSeconds": 0,
                    "exitCode": 0,
                    "error": null,
                }),
            );
            return Ok(0);
        }

        // Most games look for resources relative to their own folder.
        let cwd = exe
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let mut child = if locale_emulator {
            #[cfg(windows)]
            {
                crate::locale_emulator::spawn_leproc(&app, &exe).await?
            }
            #[cfg(not(windows))]
            {
                let _ = locale_emulator;
                return Err(AppError::keyed("error.launch.localeEmulatorMissing"));
            }
        } else {
            let mut cmd = Command::new(&exe);
            cmd.current_dir(&cwd)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                // We intentionally do NOT set kill_on_drop — the user keeps playing
                // even if our app crashes or is closed.
                .kill_on_drop(false);
            cmd.spawn().map_err(|e| {
                AppError::keyed_vars(
                    "error.launch.spawnFailed",
                    json!({ "detail": e.to_string() }),
                )
            })?
        };
        let pid = child.id().unwrap_or(0);
        let started = Instant::now();
        let install_dir = cwd.clone();

        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let inner_clone = self.inner.clone();
        let app_for_task = app.clone();
        let tid_for_task = thread_id.clone();

        let waiter = tokio::spawn(async move {
            let root_pid = pid;
            let exit_status = tokio::select! {
                status = async {
                    let status = child.wait().await;
                    // Ren'Py-style stubs exit almost immediately after spawning the
                    // real game. Only then do we keep the session open until the
                    // successor process ends. If the waited process ran for a while,
                    // it *was* the game — do not burn ~16s looking for a window.
                    #[cfg(windows)]
                    {
                        const STUB_MAX: std::time::Duration = std::time::Duration::from_secs(3);
                        if started.elapsed() < STUB_MAX {
                            crate::game_window::wait_for_game_window_session_end(
                                root_pid,
                                install_dir.clone(),
                            )
                            .await;
                        }
                    }
                    status
                } => status,
                _ = kill_rx => {
                    let _ = child.kill().await;
                    child.wait().await
                }
            };
            let duration = started.elapsed().as_secs();
            let exit_code = exit_status
                .as_ref()
                .ok()
                .and_then(|s| s.code())
                .unwrap_or(-1);
            let error = exit_status.as_ref().err().map(|e| e.to_string());

            let _ = app_for_task.emit(
                "game:exited",
                json!({
                    "threadId": tid_for_task,
                    "sessionId": session_id,
                    "durationSeconds": duration,
                    "exitCode": exit_code,
                    "error": error,
                }),
            );

            inner_clone.lock().await.remove(&tid_for_task);
        });

        let pid_refresh = tokio::spawn({
            let inner = self.inner.clone();
            let tid = thread_id.clone();
            async move {
                for _ in 0..48 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let current = inner.lock().await.get(&tid).map(|r| r.pid);
                    let Some(current_pid) = current else {
                        return;
                    };
                    #[cfg(windows)]
                    {
                        let resolved = crate::game_window::resolve_visible_game_pid(current_pid);
                        if resolved != current_pid {
                            if let Some(rg) = inner.lock().await.get_mut(&tid) {
                                rg.pid = resolved;
                            }
                        }
                        if crate::game_window::game_has_window_surface(resolved) {
                            break;
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = current_pid;
                        break;
                    }
                }
            }
        });

        self.inner.lock().await.insert(
            thread_id.clone(),
            RunningGame {
                pid,
                started,
                kill_tx: Some(kill_tx),
                _waiter: waiter,
                _pid_refresh: pid_refresh,
            },
        );

        // Register running state before emit so overlay hint / anchor can resolve PID immediately.
        let _ = app.emit(
            "game:started",
            json!({
                "threadId": thread_id,
                "sessionId": session_id,
                "pid": pid,
                "exePath": exe_path,
            }),
        );

        #[cfg(windows)]
        crate::commands::overlay::schedule_launch_hint(
            app.clone(),
            thread_id.clone(),
            title.clone(),
            pid,
        );

        Ok(pid)
    }

    pub async fn stop(&self, thread_id: &str) -> Result<(), AppError> {
        let mut map = self.inner.lock().await;
        let Some(rg) = map.get_mut(thread_id) else {
            return Err(AppError::keyed_vars(
                "error.launch.notRunning",
                json!({ "threadId": thread_id }),
            ));
        };
        // Sender is single-use; on a second Stop click it'll be None and we
        // just no-op (the waiter is already shutting down).
        if let Some(tx) = rg.kill_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    }

    pub async fn running(&self) -> Vec<RunningInfo> {
        let map = self.inner.lock().await;
        map.iter()
            .map(|(tid, rg)| RunningInfo {
                thread_id: tid.clone(),
                pid: rg.pid,
                elapsed_seconds: rg.started.elapsed().as_secs(),
            })
            .collect()
    }
}

#[derive(Debug, serde::Serialize)]
pub struct RunningInfo {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    pub pid: u32,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: u64,
}

fn is_browser_launch_path(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"))
        .unwrap_or(false)
}

fn open_with_default_app(path: &PathBuf) -> Result<(), AppError> {
    let path_str = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.launch.spawnFailed",
                    json!({ "detail": e.to_string() }),
                )
            })?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.launch.spawnFailed",
                    json!({ "detail": e.to_string() }),
                )
            })?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| {
                AppError::keyed_vars(
                    "error.launch.spawnFailed",
                    json!({ "detail": e.to_string() }),
                )
            })?;
        return Ok(());
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = path_str;
        Err(AppError::keyed_vars(
            "error.launch.spawnFailed",
            json!({ "detail": "opening HTML games is not supported on this platform" }),
        ))
    }
}
