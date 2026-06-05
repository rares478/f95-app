use super::state::AppState;
use crate::error::AppError;
use serde::Serialize;
use tauri::State;

/// Set the user-supplied GoFile API credentials. Pass `token = None` (or an
/// empty string) to clear them and fall back to minting guest tokens. The
/// frontend persists both fields in `app_settings` and pushes them here at
/// startup + on change.
#[tauri::command]
pub async fn set_gofile_credentials(
    state: State<'_, AppState>,
    token: Option<String>,
    account_id: Option<String>,
) -> Result<(), AppError> {
    state.downloader.set_gofile_creds(token, account_id).await;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct GoFileVerifyResult {
    pub valid: bool,
    pub tier: Option<String>,
    pub email: Option<String>,
    /// Human-readable status - surfaced to the user in the Settings UI.
    pub message: String,
}

/// Validate the cached GoFile credentials by calling `/accounts/{id}` with
/// the token. Returns the account tier (guest/standard/premium) so the user
/// knows whether Premium downloads will work.
#[tauri::command]
pub async fn verify_gofile_credentials(
    state: State<'_, AppState>,
) -> Result<GoFileVerifyResult, AppError> {
    let creds = match state.downloader.gofile_creds().await {
        Some(c) => c,
        None => {
            return Ok(GoFileVerifyResult {
                valid: false,
                tier: None,
                email: None,
                message: "Nenhuma credencial salva.".into(),
            });
        }
    };
    let Some(account_id) = creds.account_id.as_deref() else {
        // Without the account id we can't hit /accounts/{id}. We still
        // consider the token "set" but can't confirm it works without a
        // real download attempt.
        return Ok(GoFileVerifyResult {
            valid: false,
            tier: None,
            email: None,
            message: "Token salvo, mas sem Account ID não dá pra verificar o tier. \
                      Cole o Account ID também (na mesma página do GoFile)."
                .into(),
        });
    };
    let url = format!("https://api.gofile.io/accounts/{}", account_id);
    let resp = state
        .downloader
        .http()
        .get(&url)
        .bearer_auth(&creds.token)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("gofile verify http: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("gofile verify json: {e}")))?;
    if body.get("status").and_then(|v| v.as_str()) != Some("ok") {
        let api_status = body
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("error-unknown");
        let message = match api_status {
            "error-notFound" => {
                "Account ID inválido - confira se copiou certo da página do GoFile.".into()
            }
            _ if status.as_u16() == 401 => {
                "Token inválido ou expirado. Faça login no gofile.io e copie o token novo.".into()
            }
            _ => format!("Resposta do GoFile: {api_status} (HTTP {status})"),
        };
        return Ok(GoFileVerifyResult {
            valid: false,
            tier: None,
            email: None,
            message,
        });
    }
    let data = body.get("data");
    let tier = data
        .and_then(|d| d.get("tier"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let email = data
        .and_then(|d| d.get("email"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let message = match tier.as_deref() {
        Some("premium") => "Premium - todos os downloads funcionam.".into(),
        Some("standard") => "Standard - alguns arquivos exigem Premium.".into(),
        Some("guest") => {
            "Guest - você colou um token de visitante. Logue no GoFile e use o token da conta."
                .into()
        }
        Some(other) => format!("Tier: {other}"),
        None => "Credenciais válidas (tier desconhecido).".into(),
    };
    Ok(GoFileVerifyResult {
        valid: true,
        tier,
        email,
        message,
    })
}

#[tauri::command]
pub async fn set_mega_session(
    state: State<'_, AppState>,
    session: Option<String>,
) -> Result<(), AppError> {
    state.downloader.set_mega_session(session).await;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct MegaLoginResult {
    pub session: String,
    pub email: String,
    pub message: String,
}

/// Authenticate with MEGA using email/password and cache the serialized session.
#[tauri::command]
pub async fn login_mega(
    state: State<'_, AppState>,
    email: String,
    password: String,
    mfa: Option<String>,
) -> Result<MegaLoginResult, AppError> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err(AppError::InvalidCredentials(
            "E-mail e senha são obrigatórios.".into(),
        ));
    }
    let mfa = mfa.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let (session, user_email) = crate::mega::login(email, &password, mfa).await?;
    state
        .downloader
        .set_mega_session(Some(session.clone()))
        .await;
    Ok(MegaLoginResult {
        session,
        email: user_email.clone(),
        message: format!("Conectado como {user_email}."),
    })
}

#[derive(Debug, Serialize)]
pub struct MegaVerifyResult {
    pub valid: bool,
    pub email: Option<String>,
    #[serde(rename = "usedBytes")]
    pub used_bytes: Option<u64>,
    #[serde(rename = "totalBytes")]
    pub total_bytes: Option<u64>,
    pub message: String,
}

/// Validate the cached MEGA session by resuming it and querying user info.
#[tauri::command]
pub async fn verify_mega_session(state: State<'_, AppState>) -> Result<MegaVerifyResult, AppError> {
    let session = match state.downloader.mega_session().await {
        Some(s) => s,
        None => {
            return Ok(MegaVerifyResult {
                valid: false,
                email: None,
                used_bytes: None,
                total_bytes: None,
                message: "Nenhuma sessão salva.".into(),
            });
        }
    };

    let client = crate::mega::build_client(Some(&session)).await?;
    let user = match client.get_current_user_info().await {
        Ok(u) => u,
        Err(e) => {
            return Ok(MegaVerifyResult {
                valid: false,
                email: None,
                used_bytes: None,
                total_bytes: None,
                message: format!("Sessão inválida ou expirada: {e}"),
            });
        }
    };
    let quotas = client
        .get_storage_quotas()
        .await
        .map_err(|e| AppError::Other(format!("mega quotas: {e}")))?;

    Ok(MegaVerifyResult {
        valid: true,
        email: Some(user.email),
        used_bytes: Some(quotas.memory_used),
        total_bytes: Some(quotas.memory_total),
        message: format!(
            "Sessão válida - {} / {} bytes usados.",
            quotas.memory_used, quotas.memory_total
        ),
    })
}

#[tauri::command]
pub async fn set_uploadhaven_session(
    state: State<'_, AppState>,
    cookie_header: Option<String>,
    email: Option<String>,
    is_pro: Option<bool>,
) -> Result<(), AppError> {
    let session = cookie_header
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .map(|cookie_header| crate::uploadhaven::UploadHavenSession {
            cookie_header,
            email: email.unwrap_or_default(),
            is_pro: is_pro.unwrap_or(false),
        });
    state.downloader.set_uploadhaven_session(session).await;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct UploadHavenLoginResult {
    #[serde(rename = "cookieHeader")]
    pub cookie_header: String,
    pub email: String,
    #[serde(rename = "isPro")]
    pub is_pro: bool,
    pub message: String,
}

#[tauri::command]
pub async fn login_uploadhaven(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<UploadHavenLoginResult, AppError> {
    let session = crate::uploadhaven::login(state.downloader.http(), &email, &password).await?;
    state
        .downloader
        .set_uploadhaven_session(Some(session.clone()))
        .await;
    let message = if session.is_pro {
        format!("Conectado como {} (Pro).", session.email)
    } else {
        format!("Conectado como {}, mas sem plano Pro ativo.", session.email)
    };
    Ok(UploadHavenLoginResult {
        cookie_header: session.cookie_header,
        email: session.email.clone(),
        is_pro: session.is_pro,
        message,
    })
}

#[derive(Debug, Serialize)]
pub struct UploadHavenVerifyResult {
    pub valid: bool,
    pub email: Option<String>,
    #[serde(rename = "isPro")]
    pub is_pro: bool,
    pub message: String,
    #[serde(rename = "cookieHeader")]
    pub cookie_header: Option<String>,
}

#[tauri::command]
pub async fn verify_uploadhaven_session(
    state: State<'_, AppState>,
) -> Result<UploadHavenVerifyResult, AppError> {
    let session = match state.downloader.uploadhaven_session().await {
        Some(s) => s,
        None => {
            return Ok(UploadHavenVerifyResult {
                valid: false,
                email: None,
                is_pro: false,
                message: "Nenhuma sessão salva.".into(),
                cookie_header: None,
            });
        }
    };
    let mut session = session;
    let _ = crate::uploadhaven::refresh_pro_flag(&mut session).await;
    let info = crate::uploadhaven::verify(state.downloader.http(), &session).await?;
    if info.valid {
        state
            .downloader
            .set_uploadhaven_session(Some(crate::uploadhaven::UploadHavenSession {
                is_pro: info.is_pro,
                cookie_header: session.cookie_header.clone(),
                email: session.email.clone(),
            }))
            .await;
    }
    Ok(UploadHavenVerifyResult {
        valid: info.valid,
        email: info.email,
        is_pro: info.is_pro,
        message: info.message,
        cookie_header: if info.valid {
            Some(session.cookie_header)
        } else {
            None
        },
    })
}

/// Cache the BuzzHeavier Account ID (Bearer token). Pass `None` or empty to
/// clear - guest downloads still work without it.
#[tauri::command]
pub async fn set_buzzheavier_account(
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<(), AppError> {
    state.downloader.set_buzzheavier_account(account_id).await;
    Ok(())
}

/// Validate the cached BuzzHeavier Account ID via `/api/account`.
#[tauri::command]
pub async fn verify_buzzheavier_account(
    state: State<'_, AppState>,
) -> Result<crate::buzzheavier::VerifyInfo, AppError> {
    let account_id = match state.downloader.buzzheavier_account().await {
        Some(id) => id,
        None => {
            return Ok(crate::buzzheavier::VerifyInfo {
                valid: false,
                email: None,
                storage_used: None,
                storage_limit: None,
                message: "Nenhum Account ID salvo.".into(),
            });
        }
    };
    crate::buzzheavier::verify_account(state.downloader.http(), &account_id).await
}

/// Cache the DataNodes personal API key. Pass `None` or empty to clear it -
/// datanodes links then fall back to opening in the browser. The frontend
/// persists the key in `app_settings` and pushes it here at startup + on change.
#[tauri::command]
pub async fn set_datanodes_key(
    state: State<'_, AppState>,
    key: Option<String>,
) -> Result<(), AppError> {
    state.downloader.set_datanodes_key(key).await;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct DataNodesVerifyResult {
    pub valid: bool,
    pub email: Option<String>,
    /// "inf" or a byte count, straight from the API.
    pub storage_left: Option<String>,
    pub premium_expire: Option<String>,
    /// Human-readable status surfaced in the Settings UI.
    pub message: String,
}

/// Validate the cached DataNodes API key via `/api/account/info`. Returns the
/// account email + premium expiry so the user knows the key is live.
#[tauri::command]
pub async fn verify_datanodes_key(
    state: State<'_, AppState>,
) -> Result<DataNodesVerifyResult, AppError> {
    let key = match state.downloader.datanodes_key().await {
        Some(k) => k,
        None => {
            return Ok(DataNodesVerifyResult {
                valid: false,
                email: None,
                storage_left: None,
                premium_expire: None,
                message: "Nenhuma API key salva.".into(),
            });
        }
    };
    let url = format!("https://datanodes.to/api/account/info?key={}", key);
    let resp = state
        .downloader
        .http()
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("datanodes verify http: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("datanodes verify json (HTTP {status}): {e}")))?;
    let api_status = body.get("status").and_then(|v| v.as_i64()).unwrap_or(0);
    if api_status != 200 {
        let msg = body.get("msg").and_then(|v| v.as_str()).unwrap_or("error");
        let message = if status.as_u16() == 401 || status.as_u16() == 403 {
            "API key inválida ou expirada. Gere uma nova na página da conta DataNodes.".into()
        } else {
            format!("DataNodes respondeu: {msg} (HTTP {status})")
        };
        return Ok(DataNodesVerifyResult {
            valid: false,
            email: None,
            storage_left: None,
            premium_expire: None,
            message,
        });
    }
    let result = body.get("result");
    let email = result
        .and_then(|r| r.get("email"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let storage_left = result
        .and_then(|r| r.get("storage_left"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let premium_expire = result
        .and_then(|r| r.get("premium_expire"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let message = match (email.as_deref(), premium_expire.as_deref()) {
        (Some(e), Some(exp)) => format!("Conectado como {e} (Premium até {exp})."),
        (Some(e), None) => format!("Conectado como {e}."),
        _ => "API key válida.".into(),
    };
    Ok(DataNodesVerifyResult {
        valid: true,
        email,
        storage_left,
        premium_expire,
        message,
    })
}

#[tauri::command]
pub async fn set_mixdrop_credentials(
    state: State<'_, AppState>,
    email: Option<String>,
    api_key: Option<String>,
) -> Result<(), AppError> {
    state.downloader.set_mixdrop_creds(email, api_key).await;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct MixdropVerifyResult {
    pub valid: bool,
    pub message: String,
}

/// Validate MixDrop API credentials via folderlist (mixdrop.ag/api).
#[tauri::command]
pub async fn verify_mixdrop_credentials(
    state: State<'_, AppState>,
) -> Result<MixdropVerifyResult, AppError> {
    let creds = match state.downloader.mixdrop_creds().await {
        Some(c) => c,
        None => {
            return Ok(MixdropVerifyResult {
                valid: false,
                message: "Nenhuma credencial MixDrop salva.".into(),
            });
        }
    };
    let url = reqwest::Url::parse_with_params(
        "https://api.mixdrop.ag/folderlist",
        &[
            ("email", creds.email.as_str()),
            ("key", creds.api_key.as_str()),
            ("page", "1"),
        ],
    )
    .map_err(|e| AppError::Other(format!("mixdrop verify url: {e}")))?;
    let resp = state
        .downloader
        .http()
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("mixdrop verify http: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("mixdrop verify json (HTTP {status}): {e}")))?;
    let success = body
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if success {
        Ok(MixdropVerifyResult {
            valid: true,
            message: format!("API MixDrop conectada ({})", creds.email),
        })
    } else {
        let msg = body
            .get("result")
            .and_then(|r| r.get("msg"))
            .and_then(|v| v.as_str())
            .unwrap_or("credenciais inválidas");
        Ok(MixdropVerifyResult {
            valid: false,
            message: format!("MixDrop: {msg}"),
        })
    }
}
