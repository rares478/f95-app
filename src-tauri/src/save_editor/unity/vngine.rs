//! Motkeyz VNGINE saves (`%LocalAppData%/VNGINE/.../Saves/*.save`).
//!
//! Wire format: Base64( XOR_0x53( pipe-delimited key=value segments joined by `@` ) ).

use crate::error::AppError;
use crate::save_editor::json_tree::apply_patches_json;
use crate::save_editor::types::RenpySavePatch;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{Map, Number, Value};

const XOR_KEY: u8 = 0x53; // 'S'

/// True when bytes decode as VNGINE Base64+XOR pipe text.
pub fn looks_like_vngine_save(bytes: &[u8]) -> bool {
    decode_plaintext(bytes)
        .map(|t| t.contains("saveVersion=") || looks_like_pipe_kv(&t))
        .unwrap_or(false)
}

pub fn parse_vngine_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    let text = decode_plaintext(bytes).ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    Ok(plaintext_to_json(&text))
}

pub fn apply_vngine_patches(
    bytes: &[u8],
    patches: &[RenpySavePatch],
) -> Result<(Vec<u8>, Value), AppError> {
    let mut value = parse_vngine_to_json(bytes)?;
    apply_patches_json(&mut value, patches)?;
    let encoded = encode_from_json(&value)?;
    Ok((encoded, value))
}

fn decode_plaintext(bytes: &[u8]) -> Option<String> {
    let trimmed = std::str::from_utf8(bytes).ok()?.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Reject obvious non-base64 early.
    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'\r' | b'\n'))
    {
        return None;
    }
    let decoded = B64.decode(trimmed.as_bytes()).ok()?;
    if decoded.is_empty() {
        return None;
    }
    let xored: Vec<u8> = decoded.iter().map(|b| b ^ XOR_KEY).collect();
    let text = String::from_utf8(xored).ok()?;
    if !text.is_ascii() {
        return None;
    }
    Some(text)
}

fn looks_like_pipe_kv(text: &str) -> bool {
    let first = text.split('@').next().unwrap_or(text);
    let pairs: Vec<_> = first.split('|').filter(|p| !p.is_empty()).collect();
    pairs.len() >= 2 && pairs.iter().filter(|p| p.contains('=')).count() >= 2
}

fn plaintext_to_json(text: &str) -> Value {
    let states: Vec<Value> = text
        .split('@')
        .filter(|s| !s.is_empty())
        .map(segment_to_object)
        .collect();
    Value::Object(Map::from_iter([("states".into(), Value::Array(states))]))
}

fn segment_to_object(segment: &str) -> Value {
    let mut map = Map::new();
    for pair in segment.split('|') {
        if pair.is_empty() {
            continue;
        }
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        if key.is_empty() {
            continue;
        }
        map.insert(key.to_string(), coerce_value(value));
    }
    Value::Object(map)
}

fn coerce_value(raw: &str) -> Value {
    match raw {
        "True" => Value::Bool(true),
        "False" => Value::Bool(false),
        _ => {
            // Integers only — keep `1.2` version strings and dotted ids as text.
            if let Ok(n) = raw.parse::<i64>() {
                Value::Number(Number::from(n))
            } else {
                Value::String(raw.to_string())
            }
        }
    }
}

fn encode_from_json(value: &Value) -> Result<Vec<u8>, AppError> {
    let text = json_to_plaintext(value)?;
    let xored: Vec<u8> = text.bytes().map(|b| b ^ XOR_KEY).collect();
    Ok(B64.encode(xored).into_bytes())
}

fn json_to_plaintext(value: &Value) -> Result<String, AppError> {
    let states = value
        .get("states")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    let mut segments = Vec::with_capacity(states.len());
    for state in states {
        let obj = state
            .as_object()
            .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
        let mut pairs = Vec::with_capacity(obj.len());
        for (k, v) in obj {
            pairs.push(format!("{k}={}", value_to_pipe_string(v)?));
        }
        segments.push(pairs.join("|"));
    }
    Ok(segments.join("@"))
}

fn value_to_pipe_string(value: &Value) -> Result<String, AppError> {
    match value {
        Value::Bool(true) => Ok("True".into()),
        Value::Bool(false) => Ok("False".into()),
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => {
            if s.contains('|') || s.contains('@') || s.contains('=') {
                return Err(AppError::keyed("error.saveEditor.parse"));
            }
            Ok(s.clone())
        }
        Value::Null => Ok(String::new()),
        _ => Err(AppError::keyed("error.saveEditor.parse")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::RenpySavePatch;

    fn sample_plain() -> &'static str {
        "saveVersion=1.2|chapter=2|money=30|dialogueactive=True|userName=Gusti"
    }

    fn encode_plain(plain: &str) -> Vec<u8> {
        let xored: Vec<u8> = plain.bytes().map(|b| b ^ XOR_KEY).collect();
        B64.encode(xored).into_bytes()
    }

    #[test]
    fn detects_and_parses_single_state() {
        let bytes = encode_plain(sample_plain());
        assert!(looks_like_vngine_save(&bytes));
        let json = parse_vngine_to_json(&bytes).unwrap();
        let state = &json["states"][0];
        assert_eq!(state["saveVersion"], "1.2");
        assert_eq!(state["money"], 30);
        assert_eq!(state["dialogueactive"], true);
        assert_eq!(state["userName"], "Gusti");
    }

    #[test]
    fn round_trips_patches() {
        let bytes = encode_plain(sample_plain());
        let (out, value) = apply_vngine_patches(
            &bytes,
            &[RenpySavePatch {
                path: "states[0].money".into(),
                value: serde_json::json!(999),
            }],
        )
        .unwrap();
        assert_eq!(value["states"][0]["money"], 999);
        let again = parse_vngine_to_json(&out).unwrap();
        assert_eq!(again["states"][0]["money"], 999);
        assert_eq!(again["states"][0]["userName"], "Gusti");
    }

    #[test]
    fn parses_multi_state_at_separator() {
        let plain = format!("{}@{}", sample_plain(), "saveVersion=1.2|money=0|userName=Bob");
        let json = parse_vngine_to_json(&encode_plain(&plain)).unwrap();
        assert_eq!(json["states"].as_array().unwrap().len(), 2);
        assert_eq!(json["states"][1]["userName"], "Bob");
    }

    #[test]
    fn rejects_random_base64() {
        let junk = B64.encode(b"hello world not a save");
        assert!(!looks_like_vngine_save(junk.as_bytes()));
    }

    #[test]
    fn opens_live_timestamps_save_when_present() {
        let path = std::path::Path::new(
            r"C:\Users\Administrator\AppData\Local\VNGINE\Timestamps Unconditional Love\Saves\Save1.save",
        );
        if !path.is_file() {
            return;
        }
        let bytes = std::fs::read(path).unwrap();
        assert!(looks_like_vngine_save(&bytes));
        let json = parse_vngine_to_json(&bytes).unwrap();
        let states = json["states"].as_array().unwrap();
        assert!(!states.is_empty());
        assert!(states[0].get("saveVersion").is_some());
        assert!(states[0].get("money").is_some());
    }
}
