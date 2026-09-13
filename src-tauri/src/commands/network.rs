use crate::error::AppError;
use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

const F95_BASE: &str = "https://f95zone.to";
/// HEAD to Cloudflare's trace endpoint returns 404; use a standard captive-portal check instead.
const INTERNET_PROBE: &str = "https://connectivitycheck.gstatic.com/generate_204";
const PROBE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
    pub internet: bool,
    pub f95_reachable: bool,
}

fn probe_client() -> Result<Client, AppError> {
    Client::builder()
        // DNS / TCP connect can ignore the request timeout on some stacks;
        // cap both so login bootstrap cannot hang on "Loading session…".
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(PROBE_USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(format!("probe client: {e}")))
}

fn response_reachable(status: reqwest::StatusCode) -> bool {
    status.is_success()
        || status.is_redirection()
        || status.as_u16() == 403
        || status.as_u16() == 503
}

async fn probe_reachable(client: &Client, url: &str) -> bool {
    match client.head(url).send().await {
        Ok(res) => response_reachable(res.status()),
        Err(_) => match client.get(url).send().await {
            Ok(res) => response_reachable(res.status()),
            Err(_) => false,
        },
    }
}

/// When `probe_f95` is `Some(false)`, only the internet endpoint is checked and
/// `f95_reachable` is left as `true` (caller should preserve prior F95 state).
/// Default / `true` probes both — used for login and interactive retry.
#[tauri::command]
pub async fn check_network(probe_f95: Option<bool>) -> Result<NetworkStatus, AppError> {
    let client = probe_client()?;
    let include_f95 = probe_f95.unwrap_or(true);
    if include_f95 {
        let (internet, f95) = tokio::join!(
            probe_reachable(&client, INTERNET_PROBE),
            probe_reachable(&client, F95_BASE),
        );
        return Ok(NetworkStatus {
            internet,
            f95_reachable: f95,
        });
    }
    let internet = probe_reachable(&client, INTERNET_PROBE).await;
    Ok(NetworkStatus {
        internet,
        // Placeholder — OfflineProvider merges the previous F95 bit.
        f95_reachable: true,
    })
}
