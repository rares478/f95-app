//! Shared HTML parsing helpers for UploadHaven pages (login, verify, download).

pub(crate) fn html_entity_amp(s: &str) -> String {
    s.replace("&amp;", "&")
}

pub(crate) fn find_attr_value(html: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let i = html.find(&needle)?;
    let after = &html[i + needle.len()..];
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

pub(crate) fn find_meta_csrf(html: &str) -> Option<String> {
    let needle = "name=\"csrf-token\"";
    let idx = html
        .find(needle)
        .or_else(|| html.find("name='csrf-token'"))?;
    let window = &html[idx.saturating_sub(80)..(idx + 200).min(html.len())];
    find_attr_value(window, "content")
}

pub(crate) fn find_cdn_href(s: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = s[search_from..].find("href=\"") {
        let start = search_from + rel + 6;
        let end = s[start..].find('"')? + start;
        let val = html_entity_amp(s[start..end].trim());
        if super::is_cdn_url(&val) {
            return Some(val);
        }
        search_from = end + 1;
    }
    search_from = 0;
    while let Some(rel) = s[search_from..].find("href='") {
        let start = search_from + rel + 6;
        let end = s[start..].find('\'')? + start;
        let val = html_entity_amp(s[start..end].trim());
        if super::is_cdn_url(&val) {
            return Some(val);
        }
        search_from = end + 1;
    }
    None
}

/// Hidden `<input>` fields inside a form fragment (UploadHaven login / download forms).
pub(crate) fn parse_input_fields(fragment: &str) -> Vec<(String, String)> {
    parse_hidden_inputs(fragment)
}

/// All `<input>` and `<button>` fields in a form body (broader POST extraction).
pub(crate) fn parse_form_fields(fragment: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = fragment;
    while let Some(idx) = rest.find("<input") {
        let tag_end = rest[idx..].find('>').map(|i| idx + i).unwrap_or(rest.len());
        let tag = &rest[idx..=tag_end.min(rest.len() - 1)];
        if let Some(name) = find_attr_value(tag, "name") {
            let value = find_attr_value(tag, "value").unwrap_or_default();
            if !out.iter().any(|(n, _)| n == &name) {
                out.push((name, value));
            }
        }
        rest = &rest[(tag_end + 1).min(rest.len())..];
    }
    let mut rest = fragment;
    while let Some(idx) = rest.find("<button") {
        let tag_end = rest[idx..].find('>').map(|i| idx + i).unwrap_or(rest.len());
        let tag = &rest[idx..=tag_end.min(rest.len() - 1)];
        if let Some(name) = find_attr_value(tag, "name") {
            let value = find_attr_value(tag, "value").unwrap_or_default();
            if !out.iter().any(|(n, _)| n == &name) {
                out.push((name, value));
            }
        }
        rest = &rest[(tag_end + 1).min(rest.len())..];
    }
    out
}

pub(crate) fn parse_hidden_inputs(html: &str) -> Vec<(String, String)> {
    let lower = html.to_lowercase();
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("<input") {
        let start = search_from + rel;
        let end = lower[start..]
            .find('>')
            .map(|i| start + i)
            .unwrap_or(html.len());
        let tag = &html[start..=end.min(html.len().saturating_sub(1))];
        search_from = end + 1;
        let tag_lower = tag.to_lowercase();
        if !tag_lower.contains("type=\"hidden\"") && !tag_lower.contains("type='hidden'") {
            continue;
        }
        if let (Some(name), Some(value)) =
            (find_attr_value(tag, "name"), find_attr_value(tag, "value"))
        {
            if !out.iter().any(|(n, _)| n == &name) {
                out.push((name, value));
            }
        }
    }
    out
}

pub(crate) fn parse_post_form_inputs(html: &str) -> Option<Vec<(String, String)>> {
    let lower = html.to_lowercase();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("<form") {
        let form_start = search_from + rel;
        let header_end = lower[form_start..]
            .find('>')
            .map(|i| form_start + i)
            .unwrap_or(form_start);
        let header = &lower[form_start..=header_end.min(lower.len() - 1)];
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
        let body = &html[form_start..form_end];
        let fields = parse_form_fields(body);
        if !fields.is_empty() {
            return Some(fields);
        }
    }
    None
}

pub(crate) fn find_text_in_class(html: &str, class: &str) -> Option<String> {
    let needle = format!("class=\"{}\"", class);
    let i = html.find(&needle)?;
    let after = &html[i + needle.len()..];
    let gt = after.find('>')?;
    let inner = &after[gt + 1..];
    let lt = inner.find('<')?;
    let text = inner[..lt].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

pub(crate) fn find_alert_danger_text(html: &str) -> Option<String> {
    let needle = "alert alert-danger";
    let idx = html.find(needle)?;
    let end = (idx + 1200).min(html.len());
    let window = &html[idx..end];
    let gt = window.find('>')?;
    let inner = &window[gt + 1..];
    let lt = inner.find('<')?;
    let text = inner[..lt].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

pub(crate) fn parse_human_byte_size(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let value: f64 = parts[0].replace(',', ".").parse().ok()?;
    let unit = parts[1].to_uppercase();
    let mult = match unit.as_str() {
        "B" | "BYTE" | "BYTES" => 1.0,
        "KB" | "KIB" => 1024.0,
        "MB" | "MIB" => 1024.0 * 1024.0,
        "GB" | "GIB" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((value * mult) as u64)
}

pub(crate) fn percent_decode_lossy(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1])?;
            let lo = hex_val(bytes[i + 2])?;
            out.push((hi << 4) | lo);
            i += 3;
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}
