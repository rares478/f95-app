use super::super::types::ResolveResult;
use crate::error::AppError;
use crate::uploadhaven::html::{
    find_alert_danger_text, find_cdn_href, find_meta_csrf, find_text_in_class,
    html_entity_amp, parse_hidden_inputs, parse_human_byte_size, parse_post_form_inputs,
    percent_decode_lossy,
};
use crate::uploadhaven::UploadHavenSession;
use reqwest::header::LOCATION;
use serde_json::json;
use std::time::Duration;
use tauri::AppHandle;

/// UploadHaven free downloads use a POST form with hidden fields and a ~15s
/// wait timer before the CDN link appears in a success alert.
pub(crate) async fn resolve_uploadhaven(
    http: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    label: &str,
    session: &mut Option<UploadHavenSession>,
) -> Result<ResolveResult, AppError> {
    let page_url = normalize_uploadhaven_url(url);
    let referer = "https://uploadhaven.com/";

    crate::dev_debug::log(Some(app), "uploadhaven", format!("resolve {page_url}"));

    if let Some(s) = session.as_ref() {
        crate::dev_debug::log(
            Some(app),
            "uploadhaven",
            format!(
                "session email={} is_pro={} has_cookie={}",
                s.email,
                s.is_pro,
                crate::uploadhaven::has_session_cookie(&s.cookie_header)
            ),
        );
    } else {
        crate::dev_debug::log(Some(app), "uploadhaven", "no session - guest mode");
    }

    let mut page = fetch_uploadhaven_page(http, &page_url, referer, session.as_ref(), None).await?;
    sync_uploadhaven_session_cookies(session, &page.cookies);
    uploadhaven_check_page(&page.html, page.status, &page_url)?;

    log_uploadhaven_page(app, &page_url, &page.html, page.status.as_u16());

    if let Some(s) = session.as_ref() {
        if crate::uploadhaven::has_session_cookie(&s.cookie_header)
            && crate::uploadhaven::session_rejected_on_download_page(&page.html)
        {
            return Err(AppError::keyed("error.uploadhaven.sessionExpired"));
        }
    }

    if let Some(direct_url) = find_uploadhaven_direct_link(&page.html) {
        crate::dev_debug::log(
            Some(app),
            "uploadhaven",
            format!("direct link on page: {direct_url}"),
        );
        return Ok(uploadhaven_direct_result(
            &direct_url,
            &page.html,
            &page_url,
        ));
    }

    if parse_uploadhaven_download_fields(&page.html).is_none() {
        return uploadhaven_no_form_error(&page.html, page.status, &page_url);
    }

    let is_pro_page = crate::uploadhaven::detect_pro_download_page(&page.html);
    let has_pro_session = session
        .as_ref()
        .map(|s| s.is_pro && crate::uploadhaven::has_session_cookie(&s.cookie_header))
        .unwrap_or(false);
    let has_session = session.is_some();
    let free_tier_page = crate::uploadhaven::shows_free_tier_download(&page.html);
    let timer_secs = crate::uploadhaven::page_timer_seconds(&page.html);

    // UploadHaven always POSTs `type=free` - Pro only skips the server-side wait.
    let mut strategies: Vec<(&str, u64)> = vec![("free", 0)];
    if !has_pro_session {
        let wait = if timer_secs > 0 { timer_secs } else { 15 };
        strategies.push(("free", wait));
    }

    crate::dev_debug::log(
        Some(app),
        "uploadhaven",
        format!(
            "strategies={:?} pro_page={is_pro_page} free_page={free_tier_page} pro_session={has_pro_session} timer={timer_secs}s",
            strategies
                .iter()
                .map(|(t, w)| format!("{t}:{w}s"))
                .collect::<Vec<_>>()
        ),
    );

    for (download_type, wait_secs) in strategies {
        page = fetch_uploadhaven_page(
            http,
            &page_url,
            referer,
            session.as_ref(),
            session.as_ref().map(|s| s.cookie_header.as_str()),
        )
        .await?;
        sync_uploadhaven_session_cookies(session, &page.cookies);
        uploadhaven_check_page(&page.html, page.status, &page_url)?;
        crate::dev_debug::log(
            Some(app),
            "uploadhaven",
            format!("fetched fresh page for type={download_type}"),
        );
        if let Some(form) = parse_uploadhaven_download_fields(&page.html) {
            crate::dev_debug::log(
                Some(app),
                "uploadhaven",
                format!(
                    "form fields: {}",
                    form.iter()
                        .map(|(k, _)| k.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            );
        }

        if wait_secs > 0 {
            crate::dev_debug::log(
                Some(app),
                "uploadhaven",
                format!("waiting {wait_secs}s before type={download_type}"),
            );
            tokio::time::sleep(Duration::from_secs(wait_secs)).await;
        }

        let post_cookies = page.cookies.clone();

        let result = crate::uploadhaven::submit_download_post(
            &page_url,
            &post_cookies,
            &page.html,
            download_type,
        )
        .await?;

        crate::dev_debug::log(
            Some(app),
            "uploadhaven",
            format!(
                "POST type={download_type} → HTTP {} location={} hint={} cdn={}",
                result.status,
                if result.location.is_empty() {
                    "-".into()
                } else {
                    result.location.clone()
                },
                result.body_hint,
                result.cdn_url.as_deref().unwrap_or("-")
            ),
        );

        if let Some(direct_url) = result.cdn_url {
            return Ok(uploadhaven_direct_result(
                &direct_url,
                &page.html,
                &page_url,
            ));
        }
    }

    if has_session
        && session.as_ref().map(|s| s.is_pro).unwrap_or(false)
        && free_tier_page
        && !is_pro_page
    {
        return Err(AppError::keyed("error.uploadhaven.sessionNotRecognized"));
    }

    crate::dev_debug::log_warn(
        Some(app),
        "uploadhaven",
        "all strategies failed → needs_browser",
    );
    Ok(ResolveResult::NeedsBrowser {
        url: page_url,
        host: label.into(),
    })
}

fn log_uploadhaven_page(app: &AppHandle, page_url: &str, html: &str, status: u16) {
    let pro = crate::uploadhaven::detect_pro_download_page(html);
    let free = crate::uploadhaven::shows_free_tier_download(html);
    let dashboard = html.contains("uh-nav-dashboard") && !html.contains("uh-nav-login");
    crate::dev_debug::log(
        Some(app),
        "uploadhaven",
        format!(
            "GET {page_url} → HTTP {status} pro_page={pro} free_page={free} dashboard={dashboard}"
        ),
    );
}

fn sync_uploadhaven_session_cookies(session: &mut Option<UploadHavenSession>, cookies: &str) {
    if cookies.is_empty() {
        return;
    }
    if let Some(s) = session.as_mut() {
        s.cookie_header = crate::uploadhaven::merge_cookie_headers(&s.cookie_header, cookies);
    }
}

struct UploadHavenPage {
    html: String,
    cookies: String,
    status: reqwest::StatusCode,
}

async fn fetch_uploadhaven_page(
    http: &reqwest::Client,
    page_url: &str,
    referer: &str,
    session: Option<&UploadHavenSession>,
    cookie_hint: Option<&str>,
) -> Result<UploadHavenPage, AppError> {
    let seed = cookie_hint
        .filter(|c| !c.is_empty())
        .or_else(|| session.map(|s| s.cookie_header.as_str()));
    // Logged-in flows use the no-redirect client - same as login/verify/probe.
    let client = if session.is_some() {
        crate::uploadhaven::session_http()
    } else {
        http
    };
    let mut get = client.get(page_url).header("Referer", referer).header(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    );
    if let Some(cookies) = seed {
        get = get.header("Cookie", cookies);
    }
    if let Some(cookies) = seed.filter(|c| !c.is_empty()) {
        if let Some(xsrf) = crate::uploadhaven::xsrf_from_cookie_header(cookies) {
            get = get.header("X-XSRF-TOKEN", xsrf);
        }
    }
    let resp = get
        .send()
        .await
        .map_err(|e| {
            AppError::keyed_vars(
                "error.uploadhaven.generic",
                json!({ "detail": format!("page http: {e}") }),
            )
        })?;
    let mut status = resp.status();
    let mut resp_headers = resp.headers().clone();
    let mut html = resp
        .text()
        .await
        .map_err(|e| {
            AppError::keyed_vars(
                "error.uploadhaven.generic",
                json!({ "detail": format!("page body: {e}") }),
            )
        })?;

    if status.is_redirection() {
        let location = resp_headers
            .get(LOCATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if location.contains("/account/login") {
            html = String::new();
        } else if !location.is_empty() {
            let follow_url = crate::uploadhaven::resolve_location_url(&location);
            let mut follow = client.get(&follow_url).header("Referer", page_url).header(
                "Accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            );
            if let Some(cookies) = seed.filter(|c| !c.is_empty()) {
                follow = follow.header("Cookie", cookies);
                if let Some(xsrf) = crate::uploadhaven::xsrf_from_cookie_header(cookies) {
                    follow = follow.header("X-XSRF-TOKEN", xsrf);
                }
            }
            let resp2 = follow
                .send()
                .await
                .map_err(|e| {
                    AppError::keyed_vars(
                        "error.uploadhaven.generic",
                        json!({ "detail": format!("page follow: {e}") }),
                    )
                })?;
            status = resp2.status();
            resp_headers = resp2.headers().clone();
            html = resp2
                .text()
                .await
                .map_err(|e| {
                    AppError::keyed_vars(
                        "error.uploadhaven.generic",
                        json!({ "detail": format!("page follow body: {e}") }),
                    )
                })?;
        }
    }

    let cookies = if let Some(s) = session {
        crate::uploadhaven::merge_cookie_headers(
            seed.unwrap_or(&s.cookie_header),
            &crate::uploadhaven::collect_set_cookies(&resp_headers),
        )
    } else {
        crate::uploadhaven::merge_cookie_headers(
            seed.unwrap_or(""),
            &crate::uploadhaven::collect_set_cookies(&resp_headers),
        )
    };
    Ok(UploadHavenPage {
        html,
        cookies,
        status,
    })
}

fn uploadhaven_check_page(
    html: &str,
    status: reqwest::StatusCode,
    page_url: &str,
) -> Result<(), AppError> {
    if let Some(msg) = uploadhaven_page_error(html) {
        return Err(AppError::keyed_vars(
            "error.uploadhaven.generic",
            json!({ "detail": msg }),
        ));
    }
    if status.as_u16() == 404 {
        return Err(AppError::keyed("error.uploadhaven.notFound"));
    }
    if !status.is_success() {
        return Err(AppError::keyed_vars(
            "error.uploadhaven.generic",
            json!({ "detail": format!("HTTP {} opening {page_url}", status.as_u16()) }),
        ));
    }
    Ok(())
}

fn uploadhaven_no_form_error(
    html: &str,
    status: reqwest::StatusCode,
    page_url: &str,
) -> Result<ResolveResult, AppError> {
    if let Some(msg) = uploadhaven_page_error(html) {
        return Err(AppError::keyed_vars(
            "error.uploadhaven.generic",
            json!({ "detail": msg }),
        ));
    }
    if status.as_u16() == 404 || !status.is_success() {
        return Err(AppError::keyed("error.uploadhaven.pageUnavailable"));
    }
    Ok(ResolveResult::NeedsBrowser {
        url: page_url.to_string(),
        host: "uploadhaven".into(),
    })
}

#[allow(dead_code)] // form POST fallback; primary path uses CDN/API resolve
async fn uploadhaven_submit_form(
    page_url: &str,
    page_html: &str,
    form_fields: &[(String, String)],
    cookie_header: &str,
    session: Option<&UploadHavenSession>,
    download_type: &str,
    wait_secs: u64,
) -> Result<Option<String>, AppError> {
    if wait_secs > 0 {
        tokio::time::sleep(Duration::from_secs(wait_secs)).await;
    }

    let mut form: Vec<(String, String)> = form_fields.to_vec();
    ensure_uploadhaven_form_tokens(page_html, &mut form, download_type);

    let csrf = find_meta_csrf(page_html);
    let http = crate::uploadhaven::session_http();
    let mut post = http
        .post(page_url)
        .header("Referer", page_url)
        .header("Origin", "https://uploadhaven.com")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .form(&form);
    if !cookie_header.is_empty() {
        post = post.header("Cookie", cookie_header);
    }
    if let Some(token) = csrf.as_ref() {
        post = post.header("X-CSRF-TOKEN", token);
    }
    // Must match the XSRF-TOKEN cookie actually sent - Laravel rotates it on every GET.
    if let Some(xsrf) = crate::uploadhaven::xsrf_from_cookie_header(cookie_header) {
        post = post.header("X-XSRF-TOKEN", xsrf);
    } else if let Some(s) = session {
        if let Some(xsrf) = s.xsrf_header() {
            post = post.header("X-XSRF-TOKEN", xsrf);
        }
    }

    let post_resp = post
        .send()
        .await
        .map_err(|e| {
            AppError::keyed_vars(
                "error.uploadhaven.generic",
                json!({ "detail": format!("post http: {e}") }),
            )
        })?;
    let status = post_resp.status();
    let location = post_resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let post_html = post_resp
        .text()
        .await
        .map_err(|e| {
            AppError::keyed_vars(
                "error.uploadhaven.generic",
                json!({ "detail": format!("post body: {e}") }),
            )
        })?;

    if let Some(url) = find_uploadhaven_direct_link(&post_html) {
        return Ok(Some(url));
    }
    if let Some(url) = crate::uploadhaven::extract_cdn_url_from_html(&post_html) {
        return Ok(Some(url));
    }

    if status.is_redirection() && !location.is_empty() {
        let loc = crate::uploadhaven::resolve_location_url(&location);
        if crate::uploadhaven::is_cdn_url(&loc) {
            return Ok(Some(loc));
        }
        if !loc.contains("/download/") {
            let follow = http
                .get(&loc)
                .header("Cookie", cookie_header)
                .header("Referer", page_url);
            let mut req = follow;
            if let Some(token) = csrf.as_ref() {
                req = req.header("X-CSRF-TOKEN", token);
            }
            if let Some(xsrf) = crate::uploadhaven::xsrf_from_cookie_header(cookie_header) {
                req = req.header("X-XSRF-TOKEN", xsrf);
            }
            if let Ok(resp) = req.send().await {
                if let Ok(body) = resp.text().await {
                    if let Some(url) = find_uploadhaven_direct_link(&body) {
                        return Ok(Some(url));
                    }
                }
            }
        }
    }

    if let Some(msg) = uploadhaven_page_error(&post_html) {
        if post_html.to_lowercase().contains("wait") || post_html.to_lowercase().contains("timer") {
            return Ok(None);
        }
        return Err(AppError::keyed_vars(
            "error.uploadhaven.generic",
            json!({ "detail": msg }),
        ));
    }

    // 302 back to the same download page = rejected (wrong tier / timer).
    if status.is_redirection() && (location.is_empty() || location.contains(page_url)) {
        return Ok(None);
    }

    Ok(find_uploadhaven_direct_link(&post_html))
}
fn parse_uploadhaven_download_fields(html: &str) -> Option<Vec<(String, String)>> {
    if let Some(form) = parse_post_form_inputs(html) {
        if form.iter().any(|(k, _)| k == "_token" || k == "key") {
            return Some(form);
        }
    }
    let hidden = parse_hidden_inputs(html);
    if hidden.is_empty() {
        return None;
    }
    let mut fields = hidden;
    if !fields.iter().any(|(k, _)| k == "_token") {
        if let Some(token) = find_meta_csrf(html) {
            fields.push(("_token".into(), token));
        }
    }
    if fields.iter().any(|(k, _)| k == "_token" || k == "key") {
        Some(fields)
    } else {
        None
    }
}
pub(crate) fn normalize_uploadhaven_url(url: &str) -> String {
    let trimmed = url.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.len() == 32 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("https://uploadhaven.com/download/{trimmed}")
    } else {
        format!("https://{trimmed}")
    };
    let no_frag = with_scheme
        .split('#')
        .next()
        .unwrap_or(&with_scheme)
        .to_string();
    if no_frag.contains("uploadhaven.com") {
        if let Some(fixed) = fix_uploadhaven_path(&no_frag) {
            return fixed;
        }
    }
    no_frag
}

/// Bare hash or `/file/{id}` → canonical `/download/{id}` (preserving filename suffix).
fn fix_uploadhaven_path(url: &str) -> Option<String> {
    let rest = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let path = rest.split('/').skip(1).collect::<Vec<_>>();
    if path.is_empty() {
        return None;
    }
    if path[0].eq_ignore_ascii_case("download") {
        return None;
    }
    if path.len() == 1 && path[0].len() == 32 && path[0].chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!("https://uploadhaven.com/download/{}", path[0]));
    }
    if path[0].eq_ignore_ascii_case("file") && path.len() >= 2 {
        let id = path[1];
        let tail = path[2..].join("/");
        if tail.is_empty() {
            return Some(format!("https://uploadhaven.com/download/{id}"));
        }
        return Some(format!("https://uploadhaven.com/download/{id}/{tail}"));
    }
    None
}

fn uploadhaven_page_error(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    if lower.contains("the requested download could not be found") {
        return Some("file not found or link expired".into());
    }
    if lower.contains("heading-1\">error</div>") || lower.contains("heading-1\">error<") {
        if let Some(msg) = find_alert_danger_text(html) {
            return Some(msg);
        }
        return Some("UploadHaven error page".into());
    }
    None
}

#[allow(dead_code)]
fn ensure_uploadhaven_form_tokens(
    html: &str,
    form: &mut Vec<(String, String)>,
    download_type: &str,
) {
    let has_token = form.iter().any(|(k, _)| k == "_token" || k == "csrf_token");
    if !has_token {
        if let Some(token) = find_meta_csrf(html) {
            form.push(("_token".into(), token));
        }
    }
    form.retain(|(k, _)| k != "type");
    form.push(("type".into(), download_type.into()));
}

fn uploadhaven_direct_result(direct_url: &str, html: &str, page_url: &str) -> ResolveResult {
    let file_name = direct_url
        .rsplit('/')
        .next()
        .map(|s| percent_decode_lossy(s).unwrap_or_else(|| s.to_string()))
        .filter(|s| !s.is_empty() && s.contains('.'))
        .or_else(|| find_uploadhaven_filename(html))
        .or_else(|| find_uploadhaven_title(html))
        .unwrap_or_else(|| "uploadhaven-download.bin".into());

    ResolveResult::Direct {
        url: direct_url.to_string(),
        file_name,
        file_size: parse_uploadhaven_file_size(html),
        expected_sha256: None,
        extra_headers: vec![
            ("Referer".into(), page_url.to_string()),
            ("Origin".into(), "https://uploadhaven.com".into()),
        ],
    }
}
fn find_uploadhaven_direct_link(html: &str) -> Option<String> {
    // Legacy layout (pre-v2).
    if let Some(idx) = html.find("alert alert-success") {
        let end = (idx + 2500).min(html.len());
        if let Some(href) = find_cdn_href(&html[idx..end]) {
            return Some(href);
        }
    }
    // v2 success page - CDN link lives in the manual fallback block.
    if let Some(idx) = html.find("uh-suc-fallback") {
        let end = (idx + 2500).min(html.len());
        if let Some(href) = find_cdn_href(&html[idx..end]) {
            return Some(href);
        }
    }
    find_cdn_href(html).or_else(|| find_uploadhaven_cdn_in_script(html))
}
fn find_uploadhaven_cdn_in_script(html: &str) -> Option<String> {
    let anchor = html
        .find("uh-suc-fallback")
        .or_else(|| html.find("uh-suc-card"))
        .or_else(|| html.find("downloadFile"))?;
    let window = &html[anchor..(anchor + 3500).min(html.len())];
    let mut search = 0;
    while let Some(rel) = window[search..].find("https://") {
        let start = search + rel;
        let end = window[start..]
            .find('"')
            .or_else(|| window[start..].find('\''))
            .unwrap_or(window.len() - start);
        let url = html_entity_amp(window[start..start + end].trim());
        if crate::uploadhaven::is_cdn_url(&url) {
            return Some(url);
        }
        search = start + 8;
    }
    None
}

fn find_uploadhaven_filename(html: &str) -> Option<String> {
    find_text_in_class(html, "uh-dl-fname")
        .or_else(|| find_text_in_class(html, "uh-suc-file-name"))
        .or_else(|| find_text_in_class(html, "filename"))
}

fn find_uploadhaven_title(html: &str) -> Option<String> {
    find_uploadhaven_filename(html).or_else(|| {
        let needle = "<h1";
        let idx = html.find(needle)?;
        let after = &html[idx..];
        let gt = after.find('>')?;
        let inner = &after[gt + 1..];
        let lt = inner.find('<')?;
        let text = inner[..lt].trim();
        if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        }
    })
}

fn parse_uploadhaven_file_size(html: &str) -> Option<u64> {
    let text = find_text_in_class(html, "uh-dl-fsize")
        .or_else(|| find_text_in_class(html, "uh-suc-file-size"))?;
    parse_human_byte_size(&text)
}
