pub(crate) fn find_mediafire_button_href(html: &str) -> Option<String> {
    let needle = "id=\"downloadButton\"";
    let idx = html.find(needle)?;
    let window_start = idx.saturating_sub(800);
    let window_end = (idx + needle.len() + 800).min(html.len());
    let window = &html[window_start..window_end];
    let href_idx = window.find("href=\"")?;
    let after = &window[href_idx + 6..];
    let end = after.find('"')?;
    let val = &after[..end];
    if val.starts_with("http") {
        Some(val.to_string())
    } else {
        None
    }
}

pub(crate) fn base64_decode(s: &str) -> Result<Vec<u8>, &'static str> {
    const TABLE: [i8; 256] = build_b64_table();
    let cleaned: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits = 0;
    for &b in &cleaned {
        if b == b'=' {
            break;
        }
        let v = TABLE[b as usize];
        if v < 0 {
            return Err("invalid base64");
        }
        buf = (buf << 6) | (v as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

const fn build_b64_table() -> [i8; 256] {
    let mut t = [-1i8; 256];
    let alpha = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut i = 0;
    while i < alpha.len() {
        t[alpha[i] as usize] = i as i8;
        i += 1;
    }
    t
}

pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub(crate) use crate::uploadhaven::html::{
    find_attr_value, find_text_in_class, percent_decode_lossy,
};

#[cfg(test)]
mod tests {
    use super::find_mediafire_button_href;

    #[test]
    fn mediafire_href_before_id_ignores_sibling_hash() {
        let html = r##"
            <a class="starting" href="#"><span>Preparing Download</span></a>
            <a class="input popsok"
               aria-label="Download file"
               href="https://download1347.mediafire.com/abc/rxjv8v6h0a6lo0e/GameOfBoobsV02.zip"
               id="downloadButton"
               rel="nofollow">
                Download (530.88MB)
            </a>
        "##;
        assert_eq!(
            find_mediafire_button_href(html).as_deref(),
            Some("https://download1347.mediafire.com/abc/rxjv8v6h0a6lo0e/GameOfBoobsV02.zip")
        );
    }

    #[test]
    fn mediafire_href_after_id_still_works() {
        let html = r#"
            <a id="downloadButton" href="https://download.mediafire.com/x/file.zip">Download</a>
        "#;
        assert_eq!(
            find_mediafire_button_href(html).as_deref(),
            Some("https://download.mediafire.com/x/file.zip")
        );
    }

    #[test]
    fn mediafire_hash_only_button_returns_none() {
        let html = r##"
            <a href="#" id="downloadButton">Download</a>
        "##;
        assert_eq!(find_mediafire_button_href(html), None);
    }
}
