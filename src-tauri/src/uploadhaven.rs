//! UploadHaven account login (Pro) via Laravel session cookies.

pub(crate) mod html;

use crate::error::AppError;
use html::{
    find_attr_value, find_cdn_href, find_meta_csrf, html_entity_amp, parse_input_fields,
    percent_decode_lossy,
};
use reqwest::header::{HeaderMap, LOCATION, SET_COOKIE};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const LOGIN_URL: &str = "https://uploadhaven.com/account/login";
const SUBSCRIPTION_URL: &str = "https://uploadhaven.com/account/subscription";
const SETTINGS_URL: &str = "https://uploadhaven.com/account/settings";
/// Public download page used only to detect Pro (`seconds = 0` / premium form).
const PROBE_DOWNLOAD_URL: &str =
    "https://uploadhaven.com/download/4b605feaf2b41c09a314447248b19c89";

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Client that never follows redirects — required for login cookie capture and
/// UploadHaven download POST handling (302 back to the timer page on failure).
pub(crate) fn session_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("uploadhaven session client")
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UploadHavenSession {
    pub cookie_header: String,
    pub email: String,
    pub is_pro: bool,
}

#[derive(Debug, Serialize)]
pub struct VerifyInfo {
    pub valid: bool,
    pub email: Option<String>,
    pub is_pro: bool,
    pub message: String,
}

pub async fn login(
    _http: &reqwest::Client,
    email: &str,
    password: &str,
) -> Result<UploadHavenSession, AppError> {
    let email = email.trim();
    if email.is_empty() || password.is_empty() {
        return Err(AppError::InvalidCredentials(
            "E-mail e senha são obrigatórios.".into(),
        ));
    }

    let get = session_http()
        .get(LOGIN_URL)
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven login page: {e}")))?;
    let mut cookies = collect_set_cookies(get.headers());
    let html = get
        .text()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven login body: {e}")))?;
    let token = find_form_token(&html)
        .ok_or_else(|| AppError::Other("uploadhaven: CSRF token não encontrado".into()))?;

    let mut post = session_http()
        .post(LOGIN_URL)
        .header("Referer", LOGIN_URL)
        .header("Origin", "https://uploadhaven.com")
        .header("Cookie", &cookies)
        .form(&[
            ("_token", token.as_str()),
            ("email", email),
            ("password", password),
        ]);
    if let Some(xsrf) = xsrf_from_cookie_header(&cookies) {
        post = post.header("X-XSRF-TOKEN", xsrf);
    }

    let resp = post
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven login post: {e}")))?;
    // Laravel sets the authenticated session on the 302 — not on the final page
    // after redirect, which is why we must not follow redirects here.
    cookies = merge_cookie_headers(&cookies, &collect_set_cookies(resp.headers()));
    let status = resp.status();
    let location = header_value(resp.headers(), LOCATION);

    if status.as_u16() == 419 {
        return Err(AppError::Other(
            "uploadhaven: token CSRF expirado — tente novamente.".into(),
        ));
    }

    if status.is_redirection() {
        if location.contains("/account/login") {
            return Err(AppError::InvalidCredentials(
                "E-mail ou senha incorretos.".into(),
            ));
        }
    } else {
        let body = resp
            .text()
            .await
            .map_err(|e| AppError::Other(format!("uploadhaven login response: {e}")))?;
        if is_login_page_html(&body) {
            return Err(AppError::InvalidCredentials(
                "E-mail ou senha incorretos.".into(),
            ));
        }
    }

    if !cookies.contains("uploadhaven_session=") {
        return Err(AppError::InvalidCredentials(
            "Login falhou — sessão não criada.".into(),
        ));
    }

    let is_pro = check_pro_status(&cookies).await.unwrap_or(false);
    Ok(UploadHavenSession {
        cookie_header: cookies,
        email: email.to_string(),
        is_pro,
    })
}

pub async fn verify(
    _http: &reqwest::Client,
    session: &UploadHavenSession,
) -> Result<VerifyInfo, AppError> {
    if session.cookie_header.trim().is_empty() {
        return Ok(VerifyInfo {
            valid: false,
            email: None,
            is_pro: false,
            message: "Nenhuma sessão salva.".into(),
        });
    }

    let (html, logged_in) =
        fetch_authenticated_page(&session.cookie_header, SUBSCRIPTION_URL).await?;
    if !logged_in || is_login_page_html(&html) {
        return Ok(VerifyInfo {
            valid: false,
            email: Some(session.email.clone()),
            is_pro: false,
            message: "Sessão expirada — faça login novamente.".into(),
        });
    }

    let mut is_pro = detect_pro_account_html(&html);
    if !is_pro {
        if let Ok((settings_html, settings_logged_in)) =
            fetch_authenticated_page(&session.cookie_header, SETTINGS_URL).await
        {
            if settings_logged_in {
                is_pro = detect_pro_account_html(&settings_html);
            }
        }
    }
    if !is_pro {
        is_pro = check_pro_via_download_probe(&session.cookie_header)
            .await
            .unwrap_or(false);
    }

    let message = if is_pro {
        "Conta Pro ativa — downloads sem espera.".into()
    } else {
        "Conta conectada (plano gratuito).".into()
    };

    Ok(VerifyInfo {
        valid: true,
        email: Some(session.email.clone()),
        is_pro,
        message,
    })
}

async fn check_pro_status(cookies: &str) -> Result<bool, AppError> {
    for url in [SUBSCRIPTION_URL, SETTINGS_URL] {
        let (html, logged_in) = fetch_authenticated_page(cookies, url).await?;
        if logged_in && detect_pro_account_html(&html) {
            return Ok(true);
        }
    }
    check_pro_via_download_probe(cookies).await
}

/// Re-check Pro status and refresh Laravel cookies (XSRF rotates on every page load).
pub async fn refresh_pro_flag(session: &mut UploadHavenSession) -> Result<bool, AppError> {
    refresh_session_on_page(session, PROBE_DOWNLOAD_URL).await
}

pub async fn refresh_session_on_page(
    session: &mut UploadHavenSession,
    page_url: &str,
) -> Result<bool, AppError> {
    let http = session_http();
    let mut get = http
        .get(page_url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Referer", "https://uploadhaven.com/")
        .header("Cookie", &session.cookie_header);
    if let Some(xsrf) = xsrf_from_cookie_header(&session.cookie_header) {
        get = get.header("X-XSRF-TOKEN", xsrf);
    }
    let resp = get
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven session refresh: {e}")))?;
    session.cookie_header =
        merge_cookie_headers(&session.cookie_header, &collect_set_cookies(resp.headers()));
    let html = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven session refresh body: {e}")))?;

    if detect_pro_download_page(&html) {
        session.is_pro = true;
        return Ok(true);
    }

    let is_pro = probe_premium_download_post(http, &session.cookie_header, &html, page_url).await?;
    session.is_pro = is_pro;
    Ok(is_pro)
}

async fn check_pro_via_download_probe(cookies: &str) -> Result<bool, AppError> {
    let http = session_http();
    let mut get = http
        .get(PROBE_DOWNLOAD_URL)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Referer", "https://uploadhaven.com/")
        .header("Cookie", cookies);
    if let Some(xsrf) = xsrf_from_cookie_header(cookies) {
        get = get.header("X-XSRF-TOKEN", xsrf);
    }
    let resp = get
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven pro probe: {e}")))?;
    let cookie_header = merge_cookie_headers(cookies, &collect_set_cookies(resp.headers()));
    let html = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven pro probe body: {e}")))?;

    if detect_pro_download_page(&html) {
        return Ok(true);
    }

    // Definitive check: Pro accounts accept an immediate `type=premium` POST.
    probe_premium_download_post(http, &cookie_header, &html, PROBE_DOWNLOAD_URL).await
}

async fn probe_premium_download_post(
    _http: &reqwest::Client,
    cookies: &str,
    page_html: &str,
    page_url: &str,
) -> Result<bool, AppError> {
    for dtype in ["pro", "premium"] {
        let result = submit_download_post(page_url, cookies, page_html, dtype).await?;
        if result.cdn_url.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Result of a download POST — used for resolve and dev logging.
pub struct DownloadPostResult {
    pub cdn_url: Option<String>,
    pub status: u16,
    pub location: String,
    pub body_hint: String,
}

/// Submit the UploadHaven download form (same path as browser "Start Download").
pub async fn submit_download_post(
    page_url: &str,
    cookies: &str,
    page_html: &str,
    download_type: &str,
) -> Result<DownloadPostResult, AppError> {
    let Some(mut form) = parse_download_form_fields(page_html) else {
        return Ok(DownloadPostResult {
            cdn_url: None,
            status: 0,
            location: String::new(),
            body_hint: "no form fields".into(),
        });
    };
    form.retain(|(k, _)| k != "type");
    form.push(("type".into(), download_type.into()));
    if !form.iter().any(|(k, _)| k == "_token") {
        if let Some(token) = find_form_token(page_html) {
            form.push(("_token".into(), token));
        }
    }

    let csrf = find_meta_csrf(page_html);
    let http = session_http();
    let mut post = http
        .post(page_url)
        .header("Referer", page_url)
        .header("Origin", "https://uploadhaven.com")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Cookie", cookies)
        .form(&form);
    if let Some(token) = csrf.as_ref() {
        post = post.header("X-CSRF-TOKEN", token);
    }
    if let Some(xsrf) = xsrf_from_cookie_header(cookies) {
        post = post.header("X-XSRF-TOKEN", xsrf);
    }

    let resp = post
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven post http: {e}")))?;
    let status = resp.status().as_u16();
    let location = header_value(resp.headers(), LOCATION);
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven post body: {e}")))?;

    let cdn_url = extract_cdn_url_from_html(&body).or_else(|| {
        if cdn_location_from_redirect(status, &location) {
            Some(resolve_location_url(&location))
        } else {
            None
        }
    });

    let body_hint = extract_post_error_hint(&body);

    Ok(DownloadPostResult {
        cdn_url,
        status,
        location,
        body_hint: if body_hint.is_empty() {
            format!("{} bytes HTML", body.len())
        } else {
            body_hint
        },
    })
}

pub fn has_session_cookie(cookies: &str) -> bool {
    cookies.contains("uploadhaven_session=")
}

/// True when the download page clearly rejected our session cookie.
pub fn session_rejected_on_download_page(html: &str) -> bool {
    if html.is_empty() {
        return true;
    }
    if is_login_page_html(html) {
        return true;
    }
    let lower = html.to_lowercase();
    lower.contains("session expired") || lower.contains("please log in")
}

/// GET a protected page without following redirects so we can detect auth failures.
async fn fetch_authenticated_page(cookies: &str, url: &str) -> Result<(String, bool), AppError> {
    let http = session_http();
    let mut req = http
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Cookie", cookies)
        .header("Referer", "https://uploadhaven.com/");
    if let Some(xsrf) = xsrf_from_cookie_header(cookies) {
        req = req.header("X-XSRF-TOKEN", xsrf);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven page http ({url}): {e}")))?;

    if resp.status().is_redirection() {
        let location = header_value(resp.headers(), LOCATION);
        if location.contains("/account/login") {
            return Ok((String::new(), false));
        }
        // Some routes redirect once internally (e.g. subscription → settings).
        let follow_url = if location.starts_with("http://") || location.starts_with("https://") {
            location
        } else if location.starts_with('/') {
            format!("https://uploadhaven.com{location}")
        } else {
            format!("https://uploadhaven.com/{location}")
        };
        let mut follow = http
            .get(&follow_url)
            .header("Cookie", cookies)
            .header("Referer", url);
        if let Some(xsrf) = xsrf_from_cookie_header(cookies) {
            follow = follow.header("X-XSRF-TOKEN", xsrf);
        }
        let resp2 = follow
            .send()
            .await
            .map_err(|e| AppError::Other(format!("uploadhaven follow http: {e}")))?;
        let html = resp2
            .text()
            .await
            .map_err(|e| AppError::Other(format!("uploadhaven follow body: {e}")))?;
        let logged_in = page_is_authenticated(&html);
        return Ok((html, logged_in));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("uploadhaven page body ({url}): {e}")))?;
    let logged_in = page_is_authenticated(&html);
    Ok((html, logged_in))
}

fn page_is_authenticated(html: &str) -> bool {
    !html.is_empty() && !is_login_page_html(html) && is_account_page_html(html)
}

/// Protected account pages — anything that isn't the public login form.
fn is_account_page_html(html: &str) -> bool {
    html.contains("/account/logout")
        || html.contains("class=\"uh-nav-dashboard\"")
        || html.contains("class='uh-nav-dashboard'")
        || html.contains("uh-account")
        || html.contains("uh-dash")
        || html.contains("uh-sub-")
        || html.contains("Account Settings")
        || html.contains("My Subscription")
        || (html.contains("Subscription")
            && !html.contains("class=\"uh-nav-login\"")
            && !html.contains("uh-login-card"))
}

fn is_login_page_html(html: &str) -> bool {
    html.contains("uh-login-card") || html.contains("uh-login-btn")
}

fn header_value(headers: &HeaderMap, name: reqwest::header::HeaderName) -> String {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

pub fn detect_pro_account_html(html: &str) -> bool {
    if is_subscription_upsell_page(html) {
        return false;
    }

    let lower = html.to_lowercase();
    if lower.contains("no active subscription")
        || lower.contains("no subscription")
        || lower.contains("subscription expired")
        || lower.contains("your subscription has expired")
    {
        return false;
    }

    if has_active_plan_card(html, &lower) {
        return true;
    }

    lower.contains("active subscription")
        || lower.contains("subscription active")
        || lower.contains("pro subscription")
        || lower.contains("pro plan")
        || lower.contains("pro active")
        || lower.contains("uploadhaven pro")
        || lower.contains("premium active")
        || lower.contains("valid until")
        || lower.contains("renews on")
        || (lower.contains("expires on") && (lower.contains("pro") || lower.contains("pass")))
        || (lower.contains("current plan")
            && (lower.contains("pro") || lower.contains("premium") || lower.contains("pass")))
        || html.contains("uh-pro-badge")
        || html.contains("uh-sub-active")
        || html.contains("uh-pro-active")
}

fn is_subscription_upsell_page(html: &str) -> bool {
    html.contains("premiumRegistrationForm")
        || html.contains("Get Pro Now")
        || (html.contains("uh-reg-pkg") && html.contains("name=\"package\""))
}

/// Detects an active 2-day / monthly / yearly plan on the account subscription page.
fn has_active_plan_card(html: &str, lower: &str) -> bool {
    let plans = [
        "2-day pass",
        "2 day pass",
        "monthly",
        "yearly",
        "pro plan",
        "uploadhaven pro",
    ];
    let status = [
        "active",
        "expires",
        "expiry",
        "valid until",
        "renews",
        "ends on",
        "ending",
        "time remaining",
        "current plan",
        "your plan",
        "manage subscription",
    ];

    for plan in plans {
        let Some(idx) = lower.find(plan) else {
            continue;
        };
        let window = &lower[idx..(idx + 900).min(lower.len())];
        if status.iter().any(|s| window.contains(s)) {
            return true;
        }
        let html_window = &html[idx.saturating_sub(250)..(idx + 700).min(html.len())];
        if html_window.contains("uh-sub-active")
            || html_window.contains("uh-pro-badge")
            || html_window.contains("uh-pro-active")
        {
            return true;
        }
    }
    false
}

/// Pro users get instant downloads (`seconds = 0`) or a premium submit button.
pub fn detect_pro_download_page(html: &str) -> bool {
    // Guest pages always show the free timer + upgrade link — not a Pro download UI.
    if shows_free_tier_download(html)
        && html.contains("let seconds = ")
        && !html.contains("let seconds = 0")
    {
        return false;
    }
    html.contains("let seconds = 0")
        || html.contains("btn-submit-premium")
        || html.contains("btn-submit-pro")
        || html.contains("id=\"submitPremium\"")
        || html.contains("id='submitPremium'")
        || html.contains("uh-pro-badge")
        || html.contains("Start Pro Download")
        || (html.contains("uh-dl-btn-pro")
            && html.contains("type=\"submit\"")
            && !html.contains("btn-download-upgrade"))
}

/// True when the HTML shows the free-tier download UI (timer / upgrade link).
pub fn shows_free_tier_download(html: &str) -> bool {
    html.contains("id=\"submitFree\"")
        || html.contains("btn-submit-free")
        || html.contains("class=\"uh-dl-btn-pro btn-download-upgrade\"")
        || html.contains("class='uh-dl-btn-pro btn-download-upgrade'")
}

/// Seconds shown on the download timer (`let seconds = N` in page JS).
pub fn page_timer_seconds(html: &str) -> u64 {
    let needle = "let seconds = ";
    let Some(idx) = html.find(needle) else {
        return 0;
    };
    let rest = &html[idx + needle.len()..];
    rest.split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// Preferred POST `type` field for the current download page layout.
pub fn preferred_download_type(_html: &str) -> Option<&'static str> {
    // UploadHaven uses `type=free` for all tiers; Pro only sets seconds=0.
    Some("free")
}

fn probe_premium_post_succeeded(html: &str) -> bool {
    extract_cdn_url_from_html(html).is_some()
}

fn html_contains_cdn_link(html: &str) -> bool {
    extract_cdn_url_from_html(html).is_some()
}

pub(crate) fn extract_cdn_url_from_html(html: &str) -> Option<String> {
    for anchor in [
        "<div class=\"uh-suc-fallback\">",
        "class=\"uh-suc-fallback\">",
        "<div class=\"uh-suc-card\">",
        "id=\"downloadFile\"",
        "alert alert-success",
    ] {
        if let Some(idx) = html.find(anchor) {
            let end = (idx + 3500).min(html.len());
            if let Some(url) = find_cdn_href(&html[idx..end]) {
                return Some(url);
            }
            if let Some(url) = extract_cdn_from_script(&html[idx..end]) {
                return Some(url);
            }
        }
    }
    extract_cdn_from_script(html).or_else(|| find_cdn_href(html))
}

fn extract_cdn_from_script(html: &str) -> Option<String> {
    let mut search = 0;
    while let Some(rel) = html[search..].find("downloadFile") {
        let start = search + rel;
        let end = (start + 600).min(html.len());
        let window = &html[start..end];
        if let Some(url) = find_cdn_href(window) {
            return Some(url);
        }
        if let Some(rel2) = window.find("https://download") {
            let ustart = start + rel2;
            let uend = html[ustart..]
                .find('"')
                .map(|i| ustart + i)
                .unwrap_or((ustart + 400).min(html.len()));
            let url = html_entity_amp(html[ustart..uend].trim());
            if is_cdn_url(&url) {
                return Some(url);
            }
        }
        search = start + 12;
    }
    None
}

fn extract_post_error_hint(html: &str) -> String {
    if html.contains("uh-suc-card") || html.contains("uh-suc-fallback\">") {
        return String::new();
    }
    for needle in ["alert-danger", "alert alert-danger"] {
        if let Some(idx) = html.find(needle) {
            let window = &html[idx..(idx + 800).min(html.len())];
            if window.starts_with('.') || window.contains(" {") {
                continue;
            }
            let text: String = window
                .split('<')
                .nth(1)
                .and_then(|rest| rest.split('>').nth(1))
                .unwrap_or("")
                .trim()
                .chars()
                .take(160)
                .collect();
            if !text.is_empty() {
                return text;
            }
        }
    }
    let lower = html.to_lowercase();
    if lower.contains("session expired") {
        return "session expired".into();
    }
    format!("{} bytes HTML", html.len())
}

pub(crate) fn is_cdn_url(url: &str) -> bool {
    url.starts_with("http") && url.contains(".uploadhaven.com/") && url.contains("://download")
}

fn cdn_location_from_redirect(status: u16, location: &str) -> bool {
    if !(300..400).contains(&status) || location.is_empty() {
        return false;
    }
    is_cdn_url(&resolve_location_url(location))
}

pub(crate) fn resolve_location_url(location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        location.to_string()
    } else if location.starts_with('/') {
        format!("https://uploadhaven.com{location}")
    } else {
        format!("https://uploadhaven.com/{location}")
    }
}

fn parse_download_form_fields(html: &str) -> Option<Vec<(String, String)>> {
    if let Some(fields) = extract_named_form_fields(html, "form-download") {
        return Some(fields);
    }
    if let Some(fields) = extract_class_form_fields(html, "downloadForm") {
        return Some(fields);
    }
    let lower = html.to_lowercase();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("<form") {
        let form_start = search_from + rel;
        let header_end = lower[form_start..]
            .find('>')
            .map(|i| form_start + i)
            .unwrap_or(form_start);
        let header = &lower[form_start..=header_end.min(lower.len().saturating_sub(1))];
        let is_post = header.contains("method=\"post\"")
            || header.contains("method='post'")
            || header.contains("method=post");
        search_from = header_end + 1;
        if !is_post {
            continue;
        }
        let form_end = lower[form_start..]
            .find("</form>")
            .map(|i| form_start + i)
            .unwrap_or(html.len());
        let fields = parse_input_fields(&html[form_start..form_end]);
        if fields.iter().any(|(k, _)| k == "_token" || k == "key") {
            return Some(fields);
        }
    }
    None
}

fn extract_named_form_fields(html: &str, form_id: &str) -> Option<Vec<(String, String)>> {
    let needle = format!("id=\"{form_id}\"");
    let idx = html.find(&needle)?;
    let form_start = html[..idx].rfind("<form")?;
    let form_end = html[idx..]
        .find("</form>")
        .map(|i| idx + i)
        .unwrap_or(html.len());
    let fields = parse_input_fields(&html[form_start..form_end]);
    if fields.is_empty() {
        None
    } else {
        Some(fields)
    }
}

fn extract_class_form_fields(html: &str, class_name: &str) -> Option<Vec<(String, String)>> {
    let needle = format!("class=\"{class_name}");
    let idx = html.find(&needle)?;
    let form_start = html[..idx].rfind("<form")?;
    let form_end = html[idx..]
        .find("</form>")
        .map(|i| idx + i)
        .unwrap_or(html.len());
    let fields = parse_input_fields(&html[form_start..form_end]);
    if fields.is_empty() {
        None
    } else {
        Some(fields)
    }
}

pub fn download_type_for_page(
    html: &str,
    session: Option<&UploadHavenSession>,
) -> (&'static str, bool) {
    let wait = page_timer_seconds(html);
    let is_pro = session.map(|s| s.is_pro).unwrap_or(false) || detect_pro_download_page(html);
    ("free", !is_pro && wait > 0)
}

pub fn xsrf_from_cookie_header(cookie_header: &str) -> Option<String> {
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix("XSRF-TOKEN=") {
            return percent_decode_lossy(val);
        }
    }
    None
}

impl UploadHavenSession {
    pub fn xsrf_header(&self) -> Option<String> {
        xsrf_from_cookie_header(&self.cookie_header)
    }
}

pub fn collect_set_cookies(headers: &HeaderMap) -> String {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim())
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn merge_cookie_headers(existing: &str, new_parts: &str) -> String {
    use std::collections::HashMap;
    let mut map: HashMap<String, String> = HashMap::new();
    for header in [existing, new_parts] {
        for part in header.split(';') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            if let Some((k, v)) = part.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    map.into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn find_form_token(html: &str) -> Option<String> {
    find_meta_csrf(html).or_else(|| {
        let needle = "name=\"_token\"";
        let idx = html.find(needle)?;
        let window = &html[idx..(idx + 120).min(html.len())];
        find_attr_value(window, "value")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_page_detected() {
        assert!(is_login_page_html("<div class=\"uh-login-card\">"));
        assert!(!is_login_page_html("<div class=\"uh-dl-card\">"));
    }

    #[test]
    fn pro_subscription_markers() {
        assert!(detect_pro_account_html(
            "<p>Your Pro subscription is active. Renews on Jan 1.</p>"
        ));
        assert!(detect_pro_account_html(
            "<div class=\"uh-sub-active\"><div class=\"uh-reg-pkg-name\">2-Day Pass</div><p>Expires on May 30, 2026</p></div>"
        ));
        assert!(!detect_pro_account_html(
            "<p>No active subscription. <a>Upgrade to Pro</a></p>"
        ));
        assert!(!detect_pro_account_html(
            "<form class=\"premiumRegistrationForm\"><div class=\"uh-reg-pkg-name\">2-Day Pass</div></form>"
        ));
    }

    #[test]
    fn page_timer_parsed() {
        assert_eq!(page_timer_seconds("<script>let seconds = 15;</script>"), 15);
        assert_eq!(page_timer_seconds("<script>let seconds = 0;</script>"), 0);
    }

    #[test]
    fn guest_page_not_pro() {
        let guest = r#"<script>let seconds = 15;</script>
            <button id="submitFree" class="btn-submit-free"></button>
            <a class="uh-dl-btn-pro btn-download-upgrade">Get Pro</a>
            <form id="form-download"></form>"#;
        assert!(shows_free_tier_download(guest));
        assert!(!detect_pro_download_page(guest));
    }

    #[test]
    fn pro_download_page_markers() {
        assert!(detect_pro_download_page(
            "<script>let seconds = 0;</script><button type=\"submit\" class=\"uh-dl-btn-pro\">Download</button>"
        ));
        assert!(!detect_pro_download_page(
            "<script>let seconds = 15;</script><a class=\"uh-dl-btn-pro btn-download-upgrade\">Get Pro</a>"
        ));
    }
}
