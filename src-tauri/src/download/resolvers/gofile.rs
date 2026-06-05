use super::super::gofile_pick::{files_from_gofile_data, finish_gofile_files};
use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::sidecar::SidecarClient;
use tauri::AppHandle;

pub(crate) async fn resolve_gofile(
    http: &reqwest::Client,
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    user_token: Option<&str>,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    match resolve_gofile_api(http, url, label, user_token, platform_group.clone()).await {
        Ok(r) => Ok(r),
        Err(e) if is_not_premium_api_error(&e) => {
            crate::dev_debug::log(
                Some(app),
                "gofile",
                format!("API error-notPremium → sidecar fallback (url={url})"),
            );
            resolve_gofile_sidecar(sidecar, app, url, label, user_token, platform_group).await
        }
        Err(e) => Err(e),
    }
}

fn is_not_premium_api_error(err: &AppError) -> bool {
    match err {
        AppError::Other(msg) => msg.contains("error-notPremium"),
        _ => false,
    }
}

async fn resolve_gofile_sidecar(
    sidecar: &SidecarClient,
    app: &AppHandle,
    url: &str,
    label: &str,
    user_token: Option<&str>,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    crate::dev_debug::log(Some(app), "gofile", format!("resolve {url} (sidecar)"));
    match sidecar.resolve_gofile(url, user_token).await {
        Ok(res) => {
            crate::dev_debug::log(
                Some(app),
                "gofile",
                format!(
                    "sidecar ok → {} arquivo(s) headers={}",
                    res.files.len(),
                    res.extra_headers.len()
                ),
            );
            let extra_headers: Vec<(String, String)> = res
                .extra_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();
            let files: Vec<super::super::types::ResolvedFileOption> = res
                .files
                .into_iter()
                .map(|f| {
                    let file_name = f.file_name;
                    super::super::types::ResolvedFileOption {
                        id: f.id,
                        platform_label: super::super::platform::infer_platform_label(&file_name)
                            .map(str::to_string),
                        direct_url: f.direct_url,
                        file_size: f.file_size,
                        file_name,
                    }
                })
                .collect();
            Ok(finish_gofile_files(
                files,
                extra_headers,
                platform_group,
                url,
                label,
            ))
        }
        Err(AppError::Cloudflare(msg)) => {
            crate::dev_debug::log(
                Some(app),
                "gofile",
                format!("sidecar cloudflare: {msg} (url={url})"),
            );
            Ok(ResolveResult::NeedsBrowser {
                url: url.to_string(),
                host: label.into(),
            })
        }
        Err(e) => {
            crate::dev_debug::log_error(
                Some(app),
                "gofile",
                format!("sidecar err: {e} (url={url})"),
            );
            Err(e)
        }
    }
}

async fn resolve_gofile_api(
    http: &reqwest::Client,
    url: &str,
    label: &str,
    user_token: Option<&str>,
    platform_group: Option<String>,
) -> Result<ResolveResult, AppError> {
    let path = url
        .splitn(4, '/')
        .nth(3)
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let content_id = segs
        .iter()
        .position(|s| *s == "d" || *s == "download")
        .and_then(|i| segs.get(i + 1).copied())
        .or_else(|| segs.last().copied());
    let Some(content_id) = content_id else {
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };

    let (token, token_source) = match user_token {
        Some(t) if !t.is_empty() => (t.to_string(), "user"),
        _ => (gofile_guest_token(http).await?, "guest"),
    };
    let contents_url = format!(
        "https://api.gofile.io/contents/{}?wt=4fd6sg89d7s6&cache=true",
        content_id
    );
    let raw = http
        .get(&contents_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("gofile contents http: {e}")))?;
    let http_status = raw.status();
    let resp: serde_json::Value = raw.json().await.map_err(|e| {
        AppError::Other(format!("gofile contents json (status {http_status}): {e}"))
    })?;
    let api_status = resp
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("error-unknown");

    if api_status != "ok" {
        let msg = match api_status {
            "error-notPremium" => "este arquivo só pode ser baixado via navegador (API restrita)",
            "error-notFound" => "link inválido ou removido pelo uploader",
            "error-passwordRequired" => {
                "este link é protegido por senha. \
                 Abra no navegador, digite a senha e baixe por lá."
            }
            "error-rateLimit" => "muitas requisições - espere alguns minutos e tente de novo",
            _ if http_status.as_u16() == 401 && token_source == "guest" => {
                "uploader desabilitou acesso anônimo. \
                 Cole seu token GoFile em Configurações → Hosts."
            }
            _ if http_status.as_u16() == 401 => {
                "token GoFile não foi aceito. \
                 Confira em Configurações → Hosts → Verificar credenciais."
            }
            _ => "host respondeu com erro desconhecido",
        };
        return Err(AppError::Other(format!(
            "gofile: {api_status} (HTTP {http_status}) - {msg}"
        )));
    }
    let data = resp
        .get("data")
        .ok_or_else(|| AppError::Other("gofile contents response missing `data`".into()))?;
    let files = files_from_gofile_data(data);
    let extra_headers = vec![("Cookie".into(), format!("accountToken={token}"))];
    Ok(finish_gofile_files(
        files,
        extra_headers,
        platform_group,
        url,
        label,
    ))
}

async fn gofile_guest_token(http: &reqwest::Client) -> Result<String, AppError> {
    let resp: serde_json::Value = http
        .post("https://api.gofile.io/accounts")
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("gofile accounts http: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("gofile accounts status: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Other(format!("gofile accounts json: {e}")))?;
    resp.get("data")
        .and_then(|d| d.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("gofile guest account: token missing".into()))
}
