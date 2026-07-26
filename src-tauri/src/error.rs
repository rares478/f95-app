use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid credentials: {0}")]
    InvalidCredentials(String),

    #[error("two-factor authentication required")]
    TwoFactorRequired,

    #[error("Cloudflare challenge: {0}")]
    Cloudflare(String),

    #[error("sidecar not initialized")]
    NotInitialized,

    #[error("sidecar timeout after {0}s")]
    SidecarTimeout(u64),

    #[error("sidecar process exited unexpectedly")]
    SidecarCrash,

    #[error("sidecar protocol error: {0}")]
    Protocol(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn keyed(key: &str) -> Self {
        AppError::Other(key.to_string())
    }

    pub fn keyed_vars(key: &str, vars: impl Serialize) -> Self {
        match serde_json::to_string(&vars) {
            Ok(json) => AppError::Other(format!("{key}|{json}")),
            Err(_) => AppError::Other(key.to_string()),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::InvalidCredentials(_) => "invalid_credentials",
            AppError::TwoFactorRequired => "two_factor_required",
            AppError::Cloudflare(_) => "cloudflare",
            AppError::NotInitialized => "not_initialized",
            AppError::SidecarTimeout(_) => "sidecar_timeout",
            AppError::SidecarCrash => "sidecar_crash",
            AppError::Protocol(_) => "protocol",
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Protocol(e.to_string())
    }
}
