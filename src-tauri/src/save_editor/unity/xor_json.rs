//! Repeating-XOR JSON saves (custom game crypto, e.g. Utage/Assembly-CSharp).

use crate::error::AppError;
use crate::save_editor::unity::json_save::parse_json_value;
use std::fs;
use std::path::Path;

/// XOR each byte with a cycling key (Unity C# `EncryptDecrypt` style).
pub fn xor_cycle(data: &[u8], key: &[u8]) -> Vec<u8> {
    if key.is_empty() {
        return data.to_vec();
    }
    data.iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect()
}

/// Decrypt XOR-cycled bytes into JSON text, if valid.
pub fn try_xor_decrypt_json(bytes: &[u8], key: &[u8]) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    let plain = xor_cycle(bytes, key);
    let text = String::from_utf8(plain).ok()?;
    parse_json_value(&text).ok()?;
    Some(text)
}

/// Encrypt JSON text with repeating XOR (same as decrypt).
pub fn xor_encrypt_json(json: &str, key: &[u8]) -> Result<Vec<u8>, AppError> {
    if key.is_empty() {
        return Err(AppError::keyed("error.saveEditor.unity.decrypt"));
    }
    Ok(xor_cycle(json.as_bytes(), key))
}

/// Try each key; return `(json_text, key)` for the first that decrypts to JSON.
pub fn decrypt_xor_json_with_keys<'a>(
    bytes: &[u8],
    keys: impl IntoIterator<Item = &'a [u8]>,
) -> Option<(String, Vec<u8>)> {
    for key in keys {
        if let Some(text) = try_xor_decrypt_json(bytes, key) {
            return Some((text, key.to_vec()));
        }
    }
    None
}

/// Collect XOR key candidates: optional password, then `*SecretKey*` strings from
/// `*_Data/Managed/Assembly-CSharp.dll` (UTF-16LE .NET metadata strings).
pub fn collect_xor_key_candidates(
    install: &Path,
    password: Option<&str>,
) -> Vec<Vec<u8>> {
    let mut keys: Vec<Vec<u8>> = Vec::new();
    let mut push = |k: Vec<u8>| {
        if k.is_empty() {
            return;
        }
        if !keys.iter().any(|e| e == &k) {
            keys.push(k);
        }
    };

    if let Some(pw) = password {
        push(pw.as_bytes().to_vec());
    }

    for s in secret_key_strings_from_install(install) {
        push(s.into_bytes());
    }

    keys
}

fn secret_key_strings_from_install(install: &Path) -> Vec<String> {
    let managed = match find_managed_dir(install) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let dll = managed.join("Assembly-CSharp.dll");
    let Ok(bytes) = fs::read(&dll) else {
        return Vec::new();
    };
    extract_secret_key_strings(&bytes)
}

fn find_managed_dir(install: &Path) -> Option<std::path::PathBuf> {
    let entries = fs::read_dir(install).ok()?;
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
            let managed = path.join("Managed");
            if managed.is_dir() {
                return Some(managed);
            }
        }
    }
    None
}

/// Pull UTF-16LE strings from a .NET assembly that look like crypto secrets.
fn extract_secret_key_strings(dll: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < dll.len() {
        // ASCII char + NUL → start of UTF-16LE run
        if dll[i] >= 0x20 && dll[i] < 0x7f && dll[i + 1] == 0 {
            let start = i;
            let mut chars = Vec::new();
            while i + 1 < dll.len() && dll[i] >= 0x20 && dll[i] < 0x7f && dll[i + 1] == 0 {
                chars.push(dll[i] as char);
                i += 2;
            }
            if chars.len() >= 6 {
                let s: String = chars.into_iter().collect();
                if is_secret_key_candidate(&s) {
                    out.push(s);
                }
            }
            if i == start {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    out.sort();
    out.dedup();
    // Prefer longer / more specific keys first (e.g. LylaSecretKey2025 before short noise).
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out
}

fn is_secret_key_candidate(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    if lower.contains("secretkey") {
        return true;
    }
    // Common hard-coded password field names' values are often PascalCase with Key suffix.
    if lower.ends_with("key")
        && s.chars().any(|c| c.is_ascii_uppercase())
        && s.chars().any(|c| c.is_ascii_digit())
        && !lower.contains("keycode")
        && !lower.contains("getkey")
        && !lower.contains("haskey")
        && !lower.contains("prefkey")
        && !lower.contains("backingfield")
    {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xor_round_trip_json() {
        let json = "{\n    \"DataVersion\": 1,\n    \"gold\": 99\n}";
        let key = b"LylaSecretKey2025";
        let enc = xor_encrypt_json(json, key).unwrap();
        assert!(!enc.starts_with(b"{"));
        let (text, used) = decrypt_xor_json_with_keys(&enc, [key.as_slice()]).unwrap();
        assert_eq!(text, json);
        assert_eq!(used, key);
    }

    #[test]
    fn extract_secret_key_from_utf16_blob() {
        // Simulate .NET UTF-16LE string heap fragment.
        let mut blob = Vec::new();
        blob.extend_from_slice(&[0, 0, 0]);
        for c in "LylaSecretKey2025".chars() {
            blob.push(c as u8);
            blob.push(0);
        }
        blob.extend_from_slice(&[0, 0]);
        for c in "noise".chars() {
            blob.push(c as u8);
            blob.push(0);
        }
        let keys = extract_secret_key_strings(&blob);
        assert!(
            keys.iter().any(|k| k == "LylaSecretKey2025"),
            "keys={keys:?}"
        );
    }

    #[test]
    fn wrong_key_does_not_decrypt() {
        let json = "{\"a\":1}";
        let enc = xor_encrypt_json(json, b"right-key").unwrap();
        assert!(try_xor_decrypt_json(&enc, b"wrong-key").is_none());
    }
}
