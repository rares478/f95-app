//! Pull Easy Save 3 default encryption password from Unity install assets.

use std::fs;
use std::path::Path;

/// Scan `*_Data/resources.assets` (and similar) for the ES3Defaults password string.
///
/// Moodkie stores defaults as a ScriptableObject; nearby UTF-8 strings typically look like:
/// `ES3Defaults` … `SaveFile.es3` … `<password>`.
pub fn extract_es3_password_from_install(install: &Path) -> Option<String> {
    for data_dir in data_dirs(install) {
        for name in ["resources.assets", "globalgamemanagers.assets", "sharedassets0.assets"] {
            let path = data_dir.join(name);
            if let Some(pw) = extract_es3_password_from_asset_bytes(&fs::read(&path).ok()?) {
                return Some(pw);
            }
        }
    }
    None
}

fn data_dirs(install: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(install) else {
        return out;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.ends_with("_Data") {
            out.push(path);
        }
    }
    out
}

/// Best-effort parse of a Unity `.assets` blob for ES3Defaults password.
pub fn extract_es3_password_from_asset_bytes(blob: &[u8]) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = find_bytes(blob, b"ES3Defaults", search_from) {
        let start = rel;
        let end = (start + 512).min(blob.len());
        let window = &blob[start..end];
        // Collect printable ASCII runs in the window (Unity often stores raw C strings).
        let runs = ascii_runs(window);
        // Prefer the string after SaveFile.es3 (or *.es3) when present.
        if let Some(idx) = runs.iter().position(|s| s.ends_with(".es3") || s == "SaveFile.es3") {
            for s in runs.iter().skip(idx + 1).take(4) {
                if looks_like_es3_password(s) {
                    return Some(s.clone());
                }
            }
        }
        // Fallback: first password-like run after ES3Defaults itself.
        for s in runs.iter().skip(1).take(8) {
            if looks_like_es3_password(s) {
                return Some(s.clone());
            }
        }
        search_from = rel + 1;
    }
    None
}

fn find_bytes(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    hay[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| from + p)
}

fn ascii_runs(blob: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < blob.len() {
        if blob[i] >= 0x20 && blob[i] < 0x7f {
            let start = i;
            while i < blob.len() && blob[i] >= 0x20 && blob[i] < 0x7f {
                i += 1;
            }
            let s = String::from_utf8_lossy(&blob[start..i]).into_owned();
            if s.len() >= 4 {
                out.push(s);
            }
        } else {
            i += 1;
        }
    }
    out
}

fn looks_like_es3_password(s: &str) -> bool {
    if s.len() < 4 || s.len() > 64 {
        return false;
    }
    // Skip known non-password neighbors.
    let lower = s.to_ascii_lowercase();
    if lower.ends_with(".es3")
        || lower.ends_with(".dll")
        || lower.contains("assembly")
        || lower.contains("es3defaults")
        || lower.contains("dotween")
        || lower.contains("spine")
        || lower.contains("camera")
        || lower.contains("shader")
        || lower.contains("sirenix")
        || lower.contains("animation")
    {
        return false;
    }
    // Must look like a key: alnum / limited punctuation, not a sentence.
    if s.contains(' ') || s.contains('/') || s.contains('\\') {
        return false;
    }
    let alnum = s.chars().filter(|c| c.is_ascii_alphanumeric()).count();
    alnum >= 4 && alnum * 2 >= s.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_password_after_savefile_es3() {
        // Minimal synthetic blob matching resources.assets layout near ES3Defaults.
        let mut blob = Vec::new();
        blob.extend_from_slice(&[0u8; 16]);
        blob.extend_from_slice(b"ES3Defaults");
        blob.extend_from_slice(&[0, 0, 0, 0]);
        blob.extend_from_slice(b"SaveFile.es3");
        blob.extend_from_slice(&[0, 0, 0, 0]);
        blob.extend_from_slice(b"Fj13952099464");
        blob.extend_from_slice(&[0, 0, 0, 0]);
        blob.extend_from_slice(b"DOTweenPro.Scripts");
        assert_eq!(
            extract_es3_password_from_asset_bytes(&blob).as_deref(),
            Some("Fj13952099464")
        );
    }
}
