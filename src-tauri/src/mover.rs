//! Move an installed game from one install-library to another.
//!
//! Strategy:
//! 1. Compute the destination path inside the new library
//!    (`<new_lib>/<thread_id>/<basename of old install>`).
//! 2. Copy the entire tree to `<dest>.moving` (NOT the final name, so a
//!    partial copy is never mistaken for a complete install).
//! 3. On success: rename `.moving` → final name, delete the old install,
//!    update the library row.
//! 4. On error or cancel: delete the `.moving` partial, leave the old install
//!    intact, emit `install_move:error` / `install_move:cancelled`.
//!
//! Cancellation is cooperative via an `AtomicBool` flag the worker checks at
//! the top of each copy iteration. Aborting the tokio task directly would
//! skip the partial-cleanup step.

use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use walkdir::WalkDir;

pub struct MoveManager {
    inflight: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MoveStartResult {
    /// Where the new install will land once the move finishes. Frontend stores
    /// this immediately so the UI can show "Moving to D:\F95\…" while the
    /// task runs.
    #[serde(rename = "destInstallPath")]
    pub dest_install_path: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
}

impl MoveManager {
    pub fn new() -> Self {
        Self {
            inflight: Mutex::new(HashMap::new()),
        }
    }

    /// Begin moving `old_install_path` into `new_library_path`. Returns the
    /// computed destination and total size so the UI can render a progress
    /// modal. Progress is reported via tauri events.
    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        thread_id: String,
        old_install_path: String,
        old_exe_path: Option<String>,
        new_library_path: String,
    ) -> Result<MoveStartResult, AppError> {
        let old = PathBuf::from(&old_install_path);
        let new_lib = PathBuf::from(&new_library_path);
        if !old.exists() {
            return Err(AppError::Other(format!(
                "install antigo não existe: {}",
                old.display()
            )));
        }
        if !new_lib.exists() {
            return Err(AppError::Other(format!(
                "biblioteca de destino não existe: {}",
                new_lib.display()
            )));
        }
        // Refuse a no-op move so the caller doesn't accidentally nuke the
        // install via the `delete old` step at the end.
        if same_root(&old, &new_lib) {
            return Err(AppError::Other("o install já está nessa biblioteca".into()));
        }

        let basename = old
            .file_name()
            .ok_or_else(|| AppError::Other("install antigo sem nome de pasta".into()))?
            .to_owned();
        let dest_dir = new_lib.join(sanitize_segment(&thread_id));
        let dest_final = dest_dir.join(&basename);
        let dest_partial = with_suffix(&dest_final, ".moving");

        if dest_final.exists() {
            return Err(AppError::Other(format!(
                "destino já existe: {}",
                dest_final.display()
            )));
        }

        // Idempotent guard: if a move for this thread is already inflight, no-op.
        {
            let g = self.inflight.lock().await;
            if g.contains_key(&thread_id) {
                return Err(AppError::Other("esse jogo já está sendo movido".into()));
            }
        }

        // Sum file sizes once up front so the UI can show a real percentage.
        // For 5GB this is a few milliseconds.
        let total_bytes = walk_total_bytes(&old)?;

        // Prepare cancellation flag and partial-cleanup state.
        let cancel = Arc::new(AtomicBool::new(false));
        self.inflight
            .lock()
            .await
            .insert(thread_id.clone(), cancel.clone());

        // Map the old exe_path under the new install path so the library row
        // can be repointed without re-running find_main_exe.
        let new_exe_path = remap_exe_path(&old, &dest_final, old_exe_path.as_deref());

        // Pre-compute everything we still need after the spawn, since the
        // blocking closure takes ownership of `dest_final`.
        let dest_install_string = dest_final.to_string_lossy().into_owned();
        let me = self.clone();
        let app2 = app.clone();
        let thread_clone = thread_id.clone();
        let dest_final_for_event = dest_final.clone();
        tokio::task::spawn_blocking(move || {
            let outcome = run_move(
                &app2,
                &thread_clone,
                &old,
                &dest_partial,
                &dest_final,
                total_bytes,
                cancel.clone(),
            );
            // Outside the move worker, finalize state on the async runtime.
            let app3 = app2.clone();
            let thread = thread_clone.clone();
            let me2 = me.clone();
            tokio::runtime::Handle::current().spawn(async move {
                me2.inflight.lock().await.remove(&thread);
                match outcome {
                    Ok(MoveOutcome::Completed) => {
                        let _ = app3.emit(
                            "install_move:done",
                            serde_json::json!({
                                "threadId": thread,
                                "newInstallPath": dest_final_for_event.to_string_lossy(),
                                "newExePath": new_exe_path,
                            }),
                        );
                    }
                    Ok(MoveOutcome::Cancelled) => {
                        let _ = app3.emit(
                            "install_move:cancelled",
                            serde_json::json!({ "threadId": thread }),
                        );
                    }
                    Err(e) => {
                        let _ = app3.emit(
                            "install_move:error",
                            serde_json::json!({
                                "threadId": thread,
                                "message": e.to_string(),
                            }),
                        );
                    }
                }
            });
        });

        Ok(MoveStartResult {
            dest_install_path: dest_install_string,
            total_bytes,
        })
    }

    pub async fn cancel(&self, thread_id: &str) {
        if let Some(flag) = self.inflight.lock().await.get(thread_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

enum MoveOutcome {
    Completed,
    Cancelled,
}

fn run_move(
    app: &AppHandle,
    thread_id: &str,
    old: &Path,
    dest_partial: &Path,
    dest_final: &Path,
    total_bytes: u64,
    cancel: Arc<AtomicBool>,
) -> Result<MoveOutcome, AppError> {
    // Clean any leftover partial from a previous run so we don't merge over it.
    if dest_partial.exists() {
        std::fs::remove_dir_all(dest_partial).ok();
    }
    if let Some(parent) = dest_partial.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::create_dir_all(dest_partial)?;

    let mut copied: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_bytes: u64 = 0;

    // Walk + copy. We do directories first (mkdir), then files.
    for entry in WalkDir::new(old) {
        if cancel.load(Ordering::Relaxed) {
            let _ = std::fs::remove_dir_all(dest_partial);
            return Ok(MoveOutcome::Cancelled);
        }
        let entry = entry.map_err(|e| AppError::Other(format!("walk: {e}")))?;
        let src = entry.path();
        let rel = match src.strip_prefix(old) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dst = dest_partial.join(rel);
        let ft = entry.file_type();
        if ft.is_dir() {
            std::fs::create_dir_all(&dst)?;
        } else if ft.is_file() {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let n = std::fs::copy(src, &dst)
                .map_err(|e| AppError::Other(format!("copy {}: {e}", src.display())))?;
            copied += n;

            if last_emit.elapsed() >= Duration::from_millis(250) {
                let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
                let speed = ((copied - last_bytes) as f64 / elapsed) as u64;
                let _ = app.emit(
                    "install_move:progress",
                    serde_json::json!({
                        "threadId": thread_id,
                        "bytesCopied": copied,
                        "totalBytes": total_bytes,
                        "speedBps": speed,
                    }),
                );
                last_emit = Instant::now();
                last_bytes = copied;
            }
        }
        // Symlinks intentionally skipped — F95 archives don't ship them and
        // they're a portability landmine.
    }

    // Final progress emit so the UI lands on 100% before "done".
    let _ = app.emit(
        "install_move:progress",
        serde_json::json!({
            "threadId": thread_id,
            "bytesCopied": copied,
            "totalBytes": total_bytes,
            "speedBps": 0u64,
        }),
    );

    // Rename .moving → final. Same-filesystem rename is atomic; cross-FS rename
    // falls back to copy+delete, but at this point we already paid for the copy
    // (since `dest_partial` is on the new library FS), so it's just a rename.
    if dest_final.exists() {
        // Race: somebody else made the dest while we were copying. Refuse so
        // we don't clobber whatever they put there.
        let _ = std::fs::remove_dir_all(dest_partial);
        return Err(AppError::Other(format!(
            "destino apareceu durante o move: {}",
            dest_final.display()
        )));
    }
    std::fs::rename(dest_partial, dest_final).map_err(|e| {
        AppError::Other(format!(
            "rename {} → {}: {e}",
            dest_partial.display(),
            dest_final.display()
        ))
    })?;

    // Old install is now obsolete — delete it. If this fails we still consider
    // the move "completed" because the new copy is intact; the orphan can be
    // cleaned by the user.
    if let Err(e) = std::fs::remove_dir_all(old) {
        eprintln!(
            "[mover] aviso: falha ao remover install antigo {}: {e}",
            old.display()
        );
    }

    Ok(MoveOutcome::Completed)
}

/// Walk `root` and sum the size of every regular file. Used to render an
/// accurate percentage during the move.
fn walk_total_bytes(root: &Path) -> Result<u64, AppError> {
    let mut total: u64 = 0;
    for entry in WalkDir::new(root) {
        let entry = entry.map_err(|e| AppError::Other(format!("walk: {e}")))?;
        if entry.file_type().is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(total)
}

/// `foo` → `foo.moving`. Keeps the .moving suffix at the very end so a future
/// glob can find/sweep abandoned partials.
fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "install".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Are `a` and `b` the same canonicalized path (after lenient fallback)?
fn same_root(a: &Path, b: &Path) -> bool {
    let ca = std::fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let cb = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    ca.starts_with(&cb) || cb.starts_with(&ca)
}

/// If `old_exe` lives inside `old_install`, return the equivalent path inside
/// `new_install`. Returns None when there's no exe to remap.
fn remap_exe_path(old_install: &Path, new_install: &Path, old_exe: Option<&str>) -> Option<String> {
    let old_exe = old_exe?;
    let exe_path = Path::new(old_exe);
    let rel = exe_path.strip_prefix(old_install).ok()?;
    Some(new_install.join(rel).to_string_lossy().into_owned())
}
