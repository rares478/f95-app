//! Mystwood Manor encrypted XML saves (`profile/<name>/data_*.sav`).
//!
//! `XMLHandler.SerializeAndEncrypt`: XmlSerializer → AES-256-CBC (zero IV, UTF-8 key) → Base64 text file.

use crate::error::AppError;
use crate::save_editor::types::RenpySavePatch;
use crate::save_editor::unity::xml_save::{apply_xml_patches, looks_like_xml_save, parse_xml_to_json};
use aes::Aes256;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use cbc::{Decryptor, Encryptor};
use serde_json::Value;
use std::fs;
use std::path::Path;

const DEFAULT_KEY: &str = "b14ca5898a4e4133bbce2ea2315a1916";
const IV_ZERO: [u8; 16] = [0; 16];
const DECRYPT_ERR: &str = "error.saveEditor.unity.decrypt";

type Aes256CbcEnc = Encryptor<Aes256>;
type Aes256CbcDec = Decryptor<Aes256>;

/// True when bytes are Base64 wrapping AES-encrypted XML (Mystwood Manor `data_*.sav`).
pub fn looks_like_mystwood_encrypted_xml(bytes: &[u8]) -> bool {
    looks_like_mystwood_encrypted_xml_with_key(bytes, DEFAULT_KEY)
}

pub fn looks_like_mystwood_encrypted_xml_with_key(bytes: &[u8], key: &str) -> bool {
    decrypt_mystwood(bytes, key)
        .ok()
        .is_some_and(|xml| looks_like_xml_save(&xml))
}

pub fn mystwood_key_from_install(install: &Path) -> String {
    if let Some(key) = extract_key_from_assembly_csharp(install) {
        return key;
    }
    DEFAULT_KEY.to_string()
}

pub fn parse_mystwood_to_json(bytes: &[u8], key: &str) -> Result<Value, AppError> {
    let xml = decrypt_mystwood(bytes, key)?;
    parse_xml_to_json(&xml)
}

pub fn apply_mystwood_patches(
    bytes: &[u8],
    key: &str,
    patches: &[RenpySavePatch],
) -> Result<(Vec<u8>, Value), AppError> {
    let xml = decrypt_mystwood(bytes, key)?;
    let (patched_xml, value) = apply_xml_patches(&xml, patches)?;
    let out = encrypt_mystwood(&patched_xml, key)?;
    Ok((out, value))
}

pub fn decrypt_mystwood(bytes: &[u8], key: &str) -> Result<Vec<u8>, AppError> {
    let text = std::str::from_utf8(bytes).map_err(|_| AppError::keyed(DECRYPT_ERR))?;
    let cipher = B64
        .decode(text.trim())
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;
    aes_cbc_decrypt(&cipher, key.as_bytes())
}

pub fn encrypt_mystwood(xml: &[u8], key: &str) -> Result<Vec<u8>, AppError> {
    let cipher = aes_cbc_encrypt(xml, key.as_bytes())?;
    Ok(B64.encode(cipher).into_bytes())
}

fn aes_cbc_decrypt(ciphertext: &[u8], key: &[u8]) -> Result<Vec<u8>, AppError> {
    if key.len() != 32 {
        return Err(AppError::keyed(DECRYPT_ERR));
    }
    let decryptor = Aes256CbcDec::new_from_slices(key, &IV_ZERO)
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;
    let mut buf = ciphertext.to_vec();
    decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map(|plain| plain.to_vec())
        .map_err(|_| AppError::keyed(DECRYPT_ERR))
}

fn aes_cbc_encrypt(plaintext: &[u8], key: &[u8]) -> Result<Vec<u8>, AppError> {
    if key.len() != 32 {
        return Err(AppError::keyed(DECRYPT_ERR));
    }
    let encryptor = Aes256CbcEnc::new_from_slices(key, &IV_ZERO)
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;
    let mut buf = vec![0u8; plaintext.len() + 16];
    buf[..plaintext.len()].copy_from_slice(plaintext);
    encryptor
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .map(|ct| ct.to_vec())
        .map_err(|_| AppError::keyed(DECRYPT_ERR))
}

fn extract_key_from_assembly_csharp(install: &Path) -> Option<String> {
    let dll = find_managed_dir(install)?.join("Assembly-CSharp.dll");
    let bytes = fs::read(&dll).ok()?;
    if let Some(key) = find_ascii_hex_key(&bytes) {
        return Some(key);
    }
    find_utf16_hex_key(&bytes)
}

fn find_managed_dir(install: &Path) -> Option<std::path::PathBuf> {
    let entries = fs::read_dir(install).ok()?;
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with("_Data") {
            let managed = entry.path().join("Managed");
            if managed.is_dir() {
                return Some(managed);
            }
        }
    }
    None
}

fn find_ascii_hex_key(bytes: &[u8]) -> Option<String> {
    for window in bytes.windows(32) {
        if window.iter().all(|b| is_hex_digit(*b)) {
            let key = std::str::from_utf8(window).ok()?.to_string();
            if key == DEFAULT_KEY {
                return Some(key);
            }
        }
    }
    None
}

fn find_utf16_hex_key(bytes: &[u8]) -> Option<String> {
    let mut i = 0usize;
    while i + 64 <= bytes.len() {
        if bytes[i + 1..i + 64].iter().step_by(2).all(|&b| b == 0)
            && (0..32).all(|j| is_hex_digit(bytes[i + j * 2]))
        {
            let mut key = String::with_capacity(32);
            for j in 0..32 {
                key.push(bytes[i + j * 2] as char);
            }
            if key.len() == 32 {
                return Some(key);
            }
        }
        i += 2;
    }
    None
}

fn is_hex_digit(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn live_save() -> Option<PathBuf> {
        let p = PathBuf::from(r"E:\Downloads\New Folder\Other\42940\Mystwood_Manor_v1.1.2_Windows\Mystwood Manor v1.1.2 (Windows)\profile\Gusti\data_0.sav");
        p.is_file().then_some(p)
    }

    #[test]
    fn detects_and_decrypts_live_save_if_present() {
        let Some(path) = live_save() else {
            return;
        };
        let bytes = std::fs::read(&path).unwrap();
        assert!(looks_like_mystwood_encrypted_xml(&bytes));
        let json = parse_mystwood_to_json(&bytes, DEFAULT_KEY).unwrap();
        assert!(json.get("name").is_some());
        assert!(json.get("money").is_some());
    }

    #[test]
    fn round_trips_money_patch_if_present() {
        let Some(path) = live_save() else {
            return;
        };
        let bytes = std::fs::read(&path).unwrap();
        let json = parse_mystwood_to_json(&bytes, DEFAULT_KEY).unwrap();
        let before = json.get("money").and_then(|v| v.as_i64()).unwrap_or(0);
        let patch_val = before + 123;
        let patches = vec![RenpySavePatch {
            path: "money".into(),
            value: serde_json::json!(patch_val),
        }];
        let (written, again) = apply_mystwood_patches(&bytes, DEFAULT_KEY, &patches).unwrap();
        assert!(looks_like_mystwood_encrypted_xml(&written));
        assert_eq!(
            again.get("money").and_then(|v| v.as_i64()),
            Some(patch_val)
        );
        let reread = parse_mystwood_to_json(&written, DEFAULT_KEY).unwrap();
        assert_eq!(
            reread.get("money").and_then(|v| v.as_i64()),
            Some(patch_val)
        );
    }
}
