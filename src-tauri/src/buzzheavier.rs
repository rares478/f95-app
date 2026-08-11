//! BuzzHeavier — account verify via `/api/account` (no Cloudflare).
//! Public download resolve runs in the sidecar via `BrowserClient` (CF + HTMX).

use crate::error::AppError;
use reqwest::Client;
use serde::Serialize;
use serde_json::json;

const API_ACCOUNT: &str = "https://buzzheavier.com/api/account";

#[derive(Debug, Serialize)]
pub struct VerifyInfo {
    pub valid: bool,
    pub email: Option<String>,
    #[serde(rename = "storageUsed")]
    pub storage_used: Option<String>,
    #[serde(rename = "storageLimit")]
    pub storage_limit: Option<String>,
    pub message: String,
}

fn keyed_msg(key: &str) -> String {
    key.to_string()
}

fn keyed_msg_vars(key: &str, vars: impl Serialize) -> String {
    match serde_json::to_string(&vars) {
        Ok(payload) => format!("{key}|{payload}"),
        Err(_) => key.to_string(),
    }
}

pub async fn verify_account(http: &Client, account_id: &str) -> Result<VerifyInfo, AppError> {
    let account_id = account_id.trim();
    if account_id.is_empty() {
        return Ok(VerifyInfo {
            valid: false,
            email: None,
            storage_used: None,
            storage_limit: None,
            message: keyed_msg("error.host.buzzheavierEmptyId"),
        });
    }

    let resp = http
        .get(API_ACCOUNT)
        .header("Accept", "application/json")
        .bearer_auth(account_id)
        .send()
        .await
        .map_err(|e| {
            AppError::keyed_vars(
                "error.buzzheavier.generic",
                json!({ "detail": format!("verify http: {e}") }),
            )
        })?;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.map_err(|e| {
        AppError::keyed_vars(
            "error.buzzheavier.generic",
            json!({ "detail": format!("verify json: {e}") }),
        )
    })?;

    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    if status.as_u16() == 401 || code == 401 {
        return Ok(VerifyInfo {
            valid: false,
            email: None,
            storage_used: None,
            storage_limit: None,
            message: keyed_msg("error.host.buzzheavierBadId"),
        });
    }

    if !status.is_success() || code != 200 {
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Ok(VerifyInfo {
            valid: false,
            email: None,
            storage_used: None,
            storage_limit: None,
            message: keyed_msg_vars("error.buzzheavier.generic", json!({ "detail": err })),
        });
    }

    let data = body.get("data").unwrap_or(&body);
    let email = data
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let storage_used = json_string_field(data, "storageUsed");
    let storage_limit = json_string_field(data, "storageLimit");

    let message = if let Some(ref e) = email {
        keyed_msg_vars("error.host.buzzheavierConnected", json!({ "email": e }))
    } else {
        keyed_msg("error.host.buzzheavierOk")
    };

    Ok(VerifyInfo {
        valid: true,
        email,
        storage_used,
        storage_limit,
        message,
    })
}

fn json_string_field(obj: &serde_json::Value, key: &str) -> Option<String> {
    obj.get(key).map(|v| {
        if let Some(s) = v.as_str() {
            s.to_string()
        } else {
            v.to_string()
        }
    })
}
