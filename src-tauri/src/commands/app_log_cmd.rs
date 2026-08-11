use crate::app_log::{self, Level};
use crate::error::AppError;

#[tauri::command]
pub fn append_app_log(level: String, tag: String, message: String) -> Result<(), AppError> {
    let level = Level::parse(&level).unwrap_or(Level::Info);
    app_log::log(level, &tag, message);
    Ok(())
}
