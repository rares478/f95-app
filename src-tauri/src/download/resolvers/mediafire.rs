use super::super::types::ResolveResult;
use super::super::util::{
    base64_decode, find_attr_value, find_mediafire_button_href, find_text_in_class,
    percent_decode_lossy,
};
use crate::error::AppError;

/// MediaFire serves a landing page that contains a direct CDN URL inside an
/// `<a id="downloadButton">` (href may appear before or after `id` on that tag).
/// The href is sometimes scrambled (base64-encoded); `scrambled_url_duplicate`
/// or `data-scrambled-url` is the same value, useful if the page layout shifts.
pub(crate) async fn resolve_mediafire(
    http: &reqwest::Client,
    url: &str,
    label: &str,
) -> Result<ResolveResult, AppError> {
    let html = http
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("mediafire page http: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("mediafire page status: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::Other(format!("mediafire page body: {e}")))?;

    // Try the plain href first.
    let mut direct = find_mediafire_button_href(&html);
    // Fall back to scrambled (base64) URL - newer pages obfuscate the href to
    // discourage scrapers. The value is plain base64 of the final URL.
    if direct.is_none() {
        if let Some(scrambled) = find_attr_value(&html, "data-scrambled-url")
            .or_else(|| find_attr_value(&html, "scrambled_url_duplicate"))
        {
            if let Ok(decoded) = base64_decode(&scrambled) {
                if let Ok(s) = String::from_utf8(decoded) {
                    if s.starts_with("http") {
                        direct = Some(s);
                    }
                }
            }
        }
    }

    let Some(direct_url) = direct else {
        return Ok(ResolveResult::NeedsBrowser {
            url: url.to_string(),
            host: label.into(),
        });
    };

    // File name lives at the end of the direct URL path. Fall back to the
    // <div class="filename"> on the page.
    let file_name = direct_url
        .rsplit('/')
        .next()
        .map(|s| {
            // URL-decode common percent-escapes that show up in filenames.
            percent_decode_lossy(s).unwrap_or_else(|| s.to_string())
        })
        .filter(|s| !s.is_empty())
        .or_else(|| find_text_in_class(&html, "filename"))
        .unwrap_or_else(|| "mediafire-download.bin".into());

    Ok(ResolveResult::Direct {
        url: direct_url,
        file_name,
        file_size: None,
        expected_sha256: None,
        extra_headers: Vec::new(),
    })
}
