use super::super::types::ResolveResult;
use super::super::util::{percent_decode_lossy, urlencode};
use crate::error::AppError;
use serde_json::json;
use tauri::AppHandle;

/// DataNodes — API key only. Free tier is Cloudflare Turnstile and is not automated.
pub(crate) async fn resolve_datanodes(
    http: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    label: &str,
    api_key: Option<&str>,
) -> Result<ResolveResult, AppError> {
    let Some(code) = datanodes_file_code(url) else {
        crate::dev_debug::log(Some(app), "datanodes", format!("no file_code in {url}"));
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };

    let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) else {
        crate::dev_debug::log(
            Some(app),
            "datanodes",
            format!("no API key for {code} → needs_browser"),
        );
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };

    resolve_datanodes_api(http, app, url, &code, key, label).await
}

async fn resolve_datanodes_api(
    http: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    code: &str,
    key: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    let dl_url = format!(
        "https://datanodes.to/api/file/direct_link?file_code={}&key={}",
        urlencode(code),
        urlencode(key)
    );
    let raw = http.get(&dl_url).send().await.map_err(|e| {
        AppError::keyed_vars(
            "error.datanodes.generic",
            json!({ "detail": format!("direct_link http: {e}") }),
        )
    })?;
    let http_status = raw.status();
    let resp: serde_json::Value = raw.json().await.map_err(|e| {
        AppError::keyed_vars(
            "error.datanodes.generic",
            json!({ "detail": format!("direct_link json (HTTP {http_status}): {e}") }),
        )
    })?;

    let api_status = resp.get("status").and_then(|v| v.as_i64()).unwrap_or(0);
    let api_msg = resp
        .get("msg")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if api_status != 200 {
        crate::dev_debug::log(
            Some(app),
            "datanodes",
            format!("direct_link status={api_status} msg={api_msg} (HTTP {http_status})"),
        );
        let key_problem = http_status.as_u16() == 401
            || http_status.as_u16() == 403
            || api_msg.to_ascii_lowercase().contains("key")
            || api_msg.to_ascii_lowercase().contains("auth")
            || api_msg.to_ascii_lowercase().contains("not allowed");
        if key_problem {
            return Err(AppError::keyed_vars(
                "error.datanodes.badKey",
                json!({ "detail": format!("status {api_status} {api_msg}") }),
            ));
        }
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    }

    let result = resp.get("result");
    let Some(direct_url) = result
        .and_then(|r| r.get("url"))
        .and_then(|v| v.as_str())
        .filter(|s| s.starts_with("http"))
    else {
        crate::dev_debug::log(
            Some(app),
            "datanodes",
            format!("direct_link 200 but no result.url (msg={api_msg})"),
        );
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };
    let file_size = result.and_then(|r| r.get("size")).and_then(|v| v.as_u64());

    let file_name = datanodes_file_name(http, code, key)
        .await
        .or_else(|| datanodes_file_name_from_url(url))
        .or_else(|| {
            direct_url
                .split('?')
                .next()
                .unwrap_or(direct_url)
                .rsplit('/')
                .next()
                .and_then(percent_decode_lossy)
                .filter(|s| !s.is_empty() && s.contains('.'))
        })
        .unwrap_or_else(|| "datanodes-download.bin".into());

    crate::dev_debug::log(
        Some(app),
        "datanodes",
        format!("ok (API) → {file_name} ({direct_url})"),
    );
    Ok(ResolveResult::Direct {
        url: direct_url.to_string(),
        file_name,
        file_size,
        expected_sha256: None,
        extra_headers: Vec::new(),
    })
}

async fn datanodes_file_name(http: &reqwest::Client, code: &str, key: &str) -> Option<String> {
    let info_url = format!(
        "https://datanodes.to/api/file/info?file_code={}&key={}",
        urlencode(code),
        urlencode(key)
    );
    let resp: serde_json::Value = http.get(&info_url).send().await.ok()?.json().await.ok()?;
    if resp.get("status").and_then(|v| v.as_i64()) != Some(200) {
        return None;
    }
    resp.get("result")?
        .as_array()?
        .first()?
        .get("name")?
        .as_str()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn datanodes_file_name_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let name = path.rsplit('/').next()?;
    if name.is_empty() || !name.contains('.') {
        return None;
    }
    percent_decode_lossy(name).filter(|s| !s.is_empty())
}

fn datanodes_file_code(url: &str) -> Option<String> {
    let path = url
        .splitn(4, '/')
        .nth(3)
        .unwrap_or("")
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let is_code = |s: &str| {
        s.len() >= 10
            && s.len() <= 20
            && s.chars().all(|c| c.is_ascii_alphanumeric())
            && s.chars().any(|c| c.is_ascii_digit())
    };
    segs.iter()
        .filter(|s| !matches!(**s, "d" | "download" | "f" | "file" | "embed"))
        .find(|s| is_code(s))
        .or_else(|| segs.iter().find(|s| is_code(s)))
        .map(|s| s.to_string())
}
