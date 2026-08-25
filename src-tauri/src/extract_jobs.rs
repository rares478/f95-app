//! In-flight archive extracts keyed by download id, for cancel support.

use crate::error::AppError;
use std::collections::HashMap;
use std::process::{Child, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Cooperative + process-kill cancel token for one extract.
pub struct ExtractCancel {
    flag: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl ExtractCancel {
    pub fn new() -> Self {
        Self {
            flag: AtomicBool::new(false),
            child: Mutex::new(None),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub fn request(&self) {
        self.flag.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Park `child` so [`Self::request`] can kill it, then wait until exit or cancel.
    pub fn wait_child(&self, child: Child) -> Result<ExitStatus, AppError> {
        if self.is_cancelled() {
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::keyed("error.extract.cancelled"));
        }
        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }
        loop {
            if self.is_cancelled() {
                self.request();
                return Err(AppError::keyed("error.extract.cancelled"));
            }
            let mut guard = self.child.lock().map_err(|_| {
                AppError::keyed_vars(
                    "error.extract.failed",
                    serde_json::json!({ "detail": "extract cancel lock poisoned" }),
                )
            })?;
            let Some(child) = guard.as_mut() else {
                // Cleared by request() — treat as cancel.
                return Err(AppError::keyed("error.extract.cancelled"));
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    return Ok(status);
                }
                Ok(None) => {}
                Err(e) => {
                    return Err(AppError::keyed_vars(
                        "error.extract.failed",
                        serde_json::json!({ "detail": format!("7z wait: {e}") }),
                    ));
                }
            }
            drop(guard);
            thread::sleep(Duration::from_millis(50));
        }
    }
}

#[derive(Default)]
pub struct ExtractCancelRegistry {
    inner: Mutex<HashMap<i64, Arc<ExtractCancel>>>,
}

impl ExtractCancelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin(&self, id: i64) -> Arc<ExtractCancel> {
        let token = Arc::new(ExtractCancel::new());
        if let Ok(mut map) = self.inner.lock() {
            if let Some(prev) = map.insert(id, token.clone()) {
                prev.request();
            }
        }
        token
    }

    pub fn cancel(&self, id: i64) {
        if let Ok(map) = self.inner.lock() {
            if let Some(token) = map.get(&id) {
                token.request();
            }
        }
    }

    pub fn finish(&self, id: i64) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_sets_cancelled_flag() {
        let token = ExtractCancel::new();
        assert!(!token.is_cancelled());
        token.request();
        assert!(token.is_cancelled());
    }

    #[test]
    fn registry_begin_finish_and_cancel() {
        let reg = ExtractCancelRegistry::new();
        let token = reg.begin(7);
        assert!(!token.is_cancelled());
        reg.cancel(7);
        assert!(token.is_cancelled());
        reg.finish(7);
        reg.cancel(7);
    }
}
