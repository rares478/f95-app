pub(crate) fn is_f95_masked(url: &str) -> bool {
    url.starts_with("https://f95zone.to/masked/") || url.starts_with("http://f95zone.to/masked/")
}

/// Pull the `<host>` segment from `/masked/<host>/<thread>/...`.
pub(crate) fn masked_host(url: &str) -> Option<String> {
    let after = url.split_once("/masked/")?.1;
    let host = after.split('/').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

/// Strip hosting-site suffixes like " (520.47 MB)" before saving to disk.
pub(crate) fn clean_download_filename(name: &str) -> String {
    let mut s = name.trim().to_string();
    for _ in 0..3 {
        if let Some(next) = strip_one_trailing_size_label(&s) {
            s = next;
        } else {
            break;
        }
    }
    s
}

fn strip_one_trailing_size_label(name: &str) -> Option<String> {
    let trimmed = name.trim_end();
    if let Some(open) = trimmed.rfind(" (") {
        if open > 0 && trimmed.ends_with(')') {
            let inner = trimmed[open + 2..trimmed.len() - 1].trim();
            if is_human_size_label(inner) {
                return Some(trimmed[..open].trim_end().to_string());
            }
        }
    }
    if let Some(dash) = trimmed.rfind(" - ") {
        if dash > 0 {
            let inner = trimmed[dash + 3..].trim();
            if is_human_size_label(inner) {
                return Some(trimmed[..dash].trim_end().to_string());
            }
        }
    }
    None
}

fn is_human_size_label(text: &str) -> bool {
    let t = text.trim().to_ascii_uppercase().replace(',', "");
    for unit in ["B", "KB", "MB", "GB", "TB", "KIB", "MIB", "GIB"] {
        if let Some(num) = t.strip_suffix(unit) {
            let num = num.trim();
            if !num.is_empty() && num.chars().all(|c| c.is_ascii_digit() || c == '.') {
                return true;
            }
        }
    }
    false
}

/// Strip anything that would break a path segment on Windows or POSIX.
pub(crate) fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn host_of(url: &str) -> String {
    let rest = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = rest.split('/').next().unwrap_or(rest);
    host.split(':').next().unwrap_or(host).to_lowercase()
}

pub(crate) fn host_label(host: &str) -> String {
    if host.contains("pixeldrain") {
        return "pixeldrain".into();
    }
    if host.contains("mediafire") {
        return "mediafire".into();
    }
    if host.contains("gofile") {
        return "gofile".into();
    }
    if host.contains("uploadhaven") {
        return "uploadhaven".into();
    }
    if host.contains("mega.") || host == "mega.nz" {
        return "mega".into();
    }
    if host.contains("mixdrop") {
        return "mixdrop".into();
    }
    if host.contains("workupload") {
        return "workupload".into();
    }
    if host.contains("datanodes") {
        return "datanodes".into();
    }
    if host.contains("buzzheavier") || host.contains("bzzhr") || host.contains("fuckingfast") {
        return "buzzheavier".into();
    }
    if host.contains("drive.google.com") || host.contains("docs.google.com") {
        return "gdrive".into();
    }
    if host.contains("rapidgator") {
        return "rapidgator".into();
    }
    host.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_download_filename_strips_trailing_size() {
        assert_eq!(
            clean_download_filename("SkarpWorld_Collection.7z (520.47 MB)"),
            "SkarpWorld_Collection.7z"
        );
        assert_eq!(clean_download_filename("game.zip (1.2 GB)"), "game.zip");
        assert_eq!(clean_download_filename("plain.7z"), "plain.7z");
    }
}
