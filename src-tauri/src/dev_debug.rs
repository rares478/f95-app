//! Development-only logging to stderr and the frontend debug console.

use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }
}

pub fn enabled() -> bool {
    cfg!(debug_assertions)
}

fn timestamp() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

pub fn log(app: Option<&AppHandle>, tag: &str, message: impl AsRef<str>) {
    log_level(app, Level::Info, tag, message);
}

pub fn log_warn(app: Option<&AppHandle>, tag: &str, message: impl AsRef<str>) {
    log_level(app, Level::Warn, tag, message);
}

pub fn log_error(app: Option<&AppHandle>, tag: &str, message: impl AsRef<str>) {
    log_level(app, Level::Error, tag, message);
}

pub fn log_level(app: Option<&AppHandle>, level: Level, tag: &str, message: impl AsRef<str>) {
    if !enabled() {
        return;
    }
    let message = message.as_ref();
    let level_str = level.as_str();
    let line = format!("[{tag}] [{level_str}] {message}");
    eprintln!("{line}");
    if let Some(app) = app {
        let _ = app.emit(
            "dev:log",
            json!({
                "tag": tag,
                "message": message,
                "ts": timestamp(),
                "level": level_str,
            }),
        );
    }
}
