//! Easy Save 3 detection and AES-128-CBC codec.
//!
//! Layout matches Moodkie ES3 / community tools (es3-editor, PhasmoDecrypt):
//! `[16-byte IV][AES-128-CBC ciphertext]`, key = PBKDF2-HMAC-SHA1(password, IV, 100, 16).
//! Optional gzip layer after decrypt (magic `1F 8B`).

use crate::error::AppError;
use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use cbc::{Decryptor, Encryptor};
use flate2::read::GzDecoder;
use pbkdf2::pbkdf2_hmac;
use sha1::Sha1;
use std::io::Read;

const IV_LEN: usize = 16;
const KEY_LEN: usize = 16;
const PBKDF2_ITERS: u32 = 100;
const DECRYPT_ERR: &str = "error.saveEditor.unity.decrypt";

type Aes128CbcEnc = Encryptor<Aes128>;
type Aes128CbcDec = Decryptor<Aes128>;

/// Detected ES3 payload shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Es3Payload {
    Json(String),
    Encrypted,
}

/// Classify bytes as UTF-8 JSON object/array or encrypted ES3.
pub fn detect_es3(bytes: &[u8]) -> Es3Payload {
    match try_parse_json_object_or_array(bytes) {
        Some(s) => Es3Payload::Json(s),
        None => Es3Payload::Encrypted,
    }
}

/// True when bytes are not a plaintext JSON ES3 payload.
pub fn is_encrypted_es3(bytes: &[u8]) -> bool {
    matches!(detect_es3(bytes), Es3Payload::Encrypted)
}

/// Decrypt an ES3 AES stream (IV prefix + ciphertext); gunzip if needed.
pub fn decrypt_es3(bytes: &[u8], password: &str) -> Result<String, AppError> {
    if bytes.len() < IV_LEN + 16 {
        return Err(AppError::keyed(DECRYPT_ERR));
    }

    let iv = &bytes[..IV_LEN];
    let ciphertext = &bytes[IV_LEN..];
    let key = derive_key(password, iv);

    let decryptor = Aes128CbcDec::new_from_slices(&key, iv)
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;
    let mut buf = ciphertext.to_vec();
    let plain = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;

    let uncompressed = maybe_gunzip(plain)?;
    String::from_utf8(uncompressed).map_err(|_| AppError::keyed(DECRYPT_ERR))
}

/// Encrypt JSON as ES3 AES stream (random IV prefix + ciphertext).
pub fn encrypt_es3(json: &str, password: &str) -> Result<Vec<u8>, AppError> {
    let mut iv = [0u8; IV_LEN];
    getrandom::getrandom(&mut iv).map_err(|e| AppError::Io(format!("es3 iv: {e}")))?;

    let key = derive_key(password, &iv);
    let encryptor = Aes128CbcEnc::new_from_slices(&key, &iv)
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;

    let plaintext = json.as_bytes();
    let mut buf = vec![0u8; plaintext.len() + 16];
    buf[..plaintext.len()].copy_from_slice(plaintext);
    let ciphertext = encryptor
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .map_err(|_| AppError::keyed(DECRYPT_ERR))?;

    let mut out = Vec::with_capacity(IV_LEN + ciphertext.len());
    out.extend_from_slice(&iv);
    out.extend_from_slice(ciphertext);
    Ok(out)
}

fn derive_key(password: &str, iv: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), iv, PBKDF2_ITERS, &mut key);
    key
}

fn maybe_gunzip(data: &[u8]) -> Result<Vec<u8>, AppError> {
    if data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b {
        let mut decoder = GzDecoder::new(data);
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|_| AppError::keyed(DECRYPT_ERR))?;
        return Ok(out);
    }
    Ok(data.to_vec())
}

fn try_parse_json_object_or_array(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    let trimmed = text.trim_start();
    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return None;
    }
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(serde_json::Value::Object(_)) | Ok(serde_json::Value::Array(_)) => {
            Some(text.to_string())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    use std::path::PathBuf;

    #[test]
    fn detect_unencrypted_json_es3() {
        let bytes = br#"{"key":{"__type":"int","value":1}}"#;
        assert!(matches!(detect_es3(bytes), Es3Payload::Json(_)));
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let json = r#"{"gold":{"__type":"int","value":42}}"#;
        let enc = encrypt_es3(json, "f95-test-password").unwrap();
        assert!(is_encrypted_es3(&enc));
        assert_eq!(decrypt_es3(&enc, "f95-test-password").unwrap(), json);
    }

    #[test]
    fn wrong_password_errors() {
        let enc = encrypt_es3("{}", "right").unwrap();
        let err = decrypt_es3(&enc, "wrong").unwrap_err();
        assert!(err.to_string().contains(DECRYPT_ERR));
    }

    #[test]
    fn decrypt_gunzips_after_aes() {
        let json = r#"{"hp":{"__type":"int","value":9}}"#;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(json.as_bytes()).unwrap();
        let gz = encoder.finish().unwrap();

        // Encrypt gzip bytes with the same ES3 stream layout.
        let mut iv = [7u8; 16];
        getrandom::getrandom(&mut iv).unwrap();
        let key = derive_key("f95-test-password", &iv);
        let encryptor = Aes128CbcEnc::new_from_slices(&key, &iv).unwrap();
        let mut buf = vec![0u8; gz.len() + 16];
        buf[..gz.len()].copy_from_slice(&gz);
        let ct = encryptor
            .encrypt_padded_mut::<Pkcs7>(&mut buf, gz.len())
            .unwrap();
        let mut enc = Vec::new();
        enc.extend_from_slice(&iv);
        enc.extend_from_slice(ct);

        assert_eq!(decrypt_es3(&enc, "f95-test-password").unwrap(), json);
    }

    #[test]
    fn fixtures_round_trip_with_documented_password() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/unity");
        let unenc = std::fs::read(dir.join("unencrypted.es3")).expect("unencrypted.es3");
        assert!(matches!(detect_es3(&unenc), Es3Payload::Json(_)));

        let enc = std::fs::read(dir.join("encrypted.es3")).expect("encrypted.es3");
        assert!(is_encrypted_es3(&enc));
        let plain = decrypt_es3(&enc, "f95-test-password").unwrap();
        assert_eq!(plain, String::from_utf8(unenc).unwrap());
    }
}
