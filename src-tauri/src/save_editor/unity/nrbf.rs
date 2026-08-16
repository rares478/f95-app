//! Minimal MS-NRBF (BinaryFormatter) support for flat Unity `PlayerData`-style saves.

use crate::error::AppError;
use serde_json::Value;
use std::collections::BTreeMap;

const RECORD_SERIALIZED_STREAM_HEADER: u8 = 0;
const RECORD_CLASS_WITH_MEMBERS_AND_TYPES: u8 = 5;
const RECORD_BINARY_OBJECT_STRING: u8 = 6;
const RECORD_OBJECT_NULL: u8 = 10;
const RECORD_MESSAGE_END: u8 = 11;
const RECORD_BINARY_LIBRARY: u8 = 12;

const BINARY_TYPE_PRIMITIVE: u8 = 0;
const BINARY_TYPE_STRING: u8 = 1;

const PRIM_BOOLEAN: u8 = 1;
const PRIM_INT32: u8 = 8;
const PRIM_SINGLE: u8 = 11;

/// True when bytes look like an MS-NRBF SerializationHeaderRecord.
pub fn looks_like_nrbf(bytes: &[u8]) -> bool {
    if bytes.len() < 17 {
        return false;
    }
    bytes[0] == RECORD_SERIALIZED_STREAM_HEADER
        && bytes[5..9] == [0xFF, 0xFF, 0xFF, 0xFF]
        && bytes[9..13] == [1, 0, 0, 0]
}

#[derive(Debug, Clone)]
enum MemberKind {
    Bool,
    Int32,
    Single,
    String,
}

#[derive(Debug, Clone)]
struct MemberMeta {
    name: String,
    kind: MemberKind,
}

#[derive(Debug, Clone)]
pub struct NrbfDocument {
    /// Bytes through LibraryId (exclusive of member values).
    prefix: Vec<u8>,
    members: Vec<MemberMeta>,
    values: BTreeMap<String, Value>,
}

impl NrbfDocument {
    pub fn to_json(&self) -> Value {
        Value::Object(self.values.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    pub fn write_bytes(&self) -> Result<Vec<u8>, AppError> {
        let mut out = self.prefix.clone();
        let mut next_string_id = 100i32;
        for meta in &self.members {
            let val = self
                .values
                .get(&meta.name)
                .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
            match meta.kind {
                MemberKind::Bool => {
                    let b = match val {
                        Value::Bool(v) => *v,
                        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    out.push(u8::from(b));
                }
                MemberKind::Int32 => {
                    let n = match val {
                        Value::Number(num) => num
                            .as_i64()
                            .or_else(|| num.as_u64().map(|u| u as i64))
                            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?,
                        Value::Bool(b) => i64::from(*b),
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    if n < i32::MIN as i64 || n > i32::MAX as i64 {
                        return Err(AppError::keyed("error.saveEditor.patchType"));
                    }
                    out.extend_from_slice(&(n as i32).to_le_bytes());
                }
                MemberKind::Single => {
                    let f = match val {
                        Value::Number(num) => num
                            .as_f64()
                            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?
                            as f32,
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    out.extend_from_slice(&f.to_le_bytes());
                }
                MemberKind::String => match val {
                    Value::Null => out.push(RECORD_OBJECT_NULL),
                    Value::String(s) => {
                        out.push(RECORD_BINARY_OBJECT_STRING);
                        out.extend_from_slice(&next_string_id.to_le_bytes());
                        next_string_id += 1;
                        write_lps(&mut out, s);
                    }
                    _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                },
            }
        }
        out.push(RECORD_MESSAGE_END);
        Ok(out)
    }
}

fn coerce_value(kind: &MemberKind, val: &Value) -> Result<Value, AppError> {
    match kind {
        MemberKind::Bool => match val {
            Value::Bool(_) => Ok(val.clone()),
            Value::Number(n) => Ok(Value::Bool(n.as_i64().unwrap_or(0) != 0)),
            _ => Err(AppError::keyed("error.saveEditor.patchType")),
        },
        MemberKind::Int32 => match val {
            Value::Number(n) => {
                let i = n
                    .as_i64()
                    .or_else(|| n.as_u64().map(|u| u as i64))
                    .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
                Ok(Value::from(i as i32))
            }
            Value::Bool(b) => Ok(Value::from(i32::from(*b))),
            _ => Err(AppError::keyed("error.saveEditor.patchType")),
        },
        MemberKind::Single => match val {
            Value::Number(n) => Ok(Value::from(n.as_f64().unwrap_or(0.0) as f32 as f64)),
            _ => Err(AppError::keyed("error.saveEditor.patchType")),
        },
        MemberKind::String => match val {
            Value::String(_) | Value::Null => Ok(val.clone()),
            _ => Err(AppError::keyed("error.saveEditor.patchType")),
        },
    }
}

pub fn parse_nrbf(bytes: &[u8]) -> Result<NrbfDocument, AppError> {
    if !looks_like_nrbf(bytes) {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let mut pos = 0usize;
    let header_ty = read_u8(bytes, &mut pos)?;
    if header_ty != RECORD_SERIALIZED_STREAM_HEADER {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    pos += 16; // rootId, headerId, major, minor

    // Optional BinaryLibrary then ClassWithMembersAndTypes.
    let mut saw_class = false;
    let mut members = Vec::new();
    let mut prefix_end = 0usize;

    while pos < bytes.len() {
        let ty = read_u8(bytes, &mut pos)?;
        match ty {
            RECORD_BINARY_LIBRARY => {
                let _id = read_i32(bytes, &mut pos)?;
                let _name = read_lps(bytes, &mut pos)?;
            }
            RECORD_CLASS_WITH_MEMBERS_AND_TYPES => {
                let _object_id = read_i32(bytes, &mut pos)?;
                let _class_name = read_lps(bytes, &mut pos)?;
                let member_count = read_i32(bytes, &mut pos)?;
                if member_count < 0 || member_count > 10_000 {
                    return Err(AppError::keyed("error.saveEditor.parse"));
                }
                let member_count = member_count as usize;
                let mut names = Vec::with_capacity(member_count);
                for _ in 0..member_count {
                    names.push(read_lps(bytes, &mut pos)?);
                }
                let mut bin_types = Vec::with_capacity(member_count);
                for _ in 0..member_count {
                    bin_types.push(read_u8(bytes, &mut pos)?);
                }
                let mut prim_types = vec![0u8; member_count];
                for (i, bt) in bin_types.iter().enumerate() {
                    if *bt == BINARY_TYPE_PRIMITIVE {
                        prim_types[i] = read_u8(bytes, &mut pos)?;
                    } else if *bt != BINARY_TYPE_STRING {
                        return Err(AppError::keyed("error.saveEditor.parse"));
                    }
                }
                let _library_id = read_i32(bytes, &mut pos)?;
                prefix_end = pos;
                for i in 0..member_count {
                    let kind = match bin_types[i] {
                        BINARY_TYPE_STRING => MemberKind::String,
                        BINARY_TYPE_PRIMITIVE => match prim_types[i] {
                            PRIM_BOOLEAN => MemberKind::Bool,
                            PRIM_INT32 => MemberKind::Int32,
                            PRIM_SINGLE => MemberKind::Single,
                            _ => return Err(AppError::keyed("error.saveEditor.parse")),
                        },
                        _ => return Err(AppError::keyed("error.saveEditor.parse")),
                    };
                    members.push(MemberMeta {
                        name: names[i].clone(),
                        kind,
                    });
                }
                saw_class = true;
                break;
            }
            _ => return Err(AppError::keyed("error.saveEditor.parse")),
        }
    }
    if !saw_class {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }

    let mut values = BTreeMap::new();
    for meta in &members {
        let value = match meta.kind {
            MemberKind::Bool => {
                let b = read_u8(bytes, &mut pos)?;
                Value::Bool(b != 0)
            }
            MemberKind::Int32 => Value::from(read_i32(bytes, &mut pos)?),
            MemberKind::Single => {
                let f = read_f32(bytes, &mut pos)?;
                Value::from(f as f64)
            }
            MemberKind::String => {
                let rt = read_u8(bytes, &mut pos)?;
                match rt {
                    RECORD_OBJECT_NULL => Value::Null,
                    RECORD_BINARY_OBJECT_STRING => {
                        let _id = read_i32(bytes, &mut pos)?;
                        Value::String(read_lps(bytes, &mut pos)?)
                    }
                    _ => return Err(AppError::keyed("error.saveEditor.parse")),
                }
            }
        };
        values.insert(meta.name.clone(), value);
    }

    if pos < bytes.len() {
        let end = read_u8(bytes, &mut pos)?;
        if end != RECORD_MESSAGE_END {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
    }

    Ok(NrbfDocument {
        prefix: bytes[..prefix_end].to_vec(),
        members,
        values,
    })
}

pub fn parse_nrbf_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    Ok(parse_nrbf(bytes)?.to_json())
}

pub fn write_nrbf_with_json(original: &[u8], value: &Value) -> Result<Vec<u8>, AppError> {
    let mut doc = parse_nrbf(original)?;
    // Replace all values from object (full document write after patches applied upstream).
    if let Value::Object(map) = value {
        let mut next = BTreeMap::new();
        for meta in &doc.members {
            let v = map
                .get(&meta.name)
                .cloned()
                .or_else(|| doc.values.get(&meta.name).cloned())
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
            next.insert(meta.name.clone(), coerce_value(&meta.kind, &v)?);
        }
        // Reject unknown keys? allow extras ignored
        doc.values = next;
    } else {
        return Err(AppError::keyed("error.saveEditor.patchType"));
    }
    doc.write_bytes()
}

fn read_u8(bytes: &[u8], pos: &mut usize) -> Result<u8, AppError> {
    let b = *bytes
        .get(*pos)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    *pos += 1;
    Ok(b)
}

fn read_i32(bytes: &[u8], pos: &mut usize) -> Result<i32, AppError> {
    if *pos + 4 > bytes.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let v = i32::from_le_bytes(bytes[*pos..*pos + 4].try_into().unwrap());
    *pos += 4;
    Ok(v)
}

fn read_f32(bytes: &[u8], pos: &mut usize) -> Result<f32, AppError> {
    if *pos + 4 > bytes.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let v = f32::from_le_bytes(bytes[*pos..*pos + 4].try_into().unwrap());
    *pos += 4;
    Ok(v)
}

fn read_lps(bytes: &[u8], pos: &mut usize) -> Result<String, AppError> {
    let mut len = 0usize;
    let mut shift = 0u32;
    loop {
        let b = read_u8(bytes, pos)?;
        len |= ((b & 0x7F) as usize) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift > 28 {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
    }
    if *pos + len > bytes.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let s = std::str::from_utf8(&bytes[*pos..*pos + len])
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
        .to_string();
    *pos += len;
    Ok(s)
}

fn write_lps(out: &mut Vec<u8>, s: &str) {
    let mut len = s.len();
    loop {
        let mut b = (len & 0x7F) as u8;
        len >>= 7;
        if len > 0 {
            b |= 0x80;
        }
        out.push(b);
        if len == 0 {
            break;
        }
    }
    out.extend_from_slice(s.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn sample_path() -> Option<PathBuf> {
        let profile = std::env::var_os("USERPROFILE")?;
        let p = PathBuf::from(profile)
            .join("AppData")
            .join("LocalLow")
            .join("KsTgames")
            .join("The Twist")
            .join("playerInfo.dat");
        if p.is_file() {
            Some(p)
        } else {
            None
        }
    }

    #[test]
    fn rejects_non_nrbf() {
        assert!(!looks_like_nrbf(b"{}"));
        assert!(parse_nrbf(b"not nrbf").is_err());
    }

    #[test]
    fn parses_the_twist_player_info_if_present() {
        let Some(path) = sample_path() else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        assert!(looks_like_nrbf(&bytes));
        let doc = parse_nrbf(&bytes).unwrap();
        let json = doc.to_json();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("money"));
        assert!(obj.contains_key("dayname"));
        assert_eq!(obj.get("dayname").and_then(|v| v.as_str()), Some("Monday"));
    }

    #[test]
    fn round_trips_money_patch_if_present() {
        let Some(path) = sample_path() else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        let mut doc = parse_nrbf(&bytes).unwrap();
        let original_money = doc.values.get("money").cloned().unwrap();
        doc.values.insert("money".into(), Value::from(12345));
        let written = doc.write_bytes().unwrap();
        let again = parse_nrbf(&written).unwrap();
        assert_eq!(again.values.get("money"), Some(&Value::from(12345)));
        // restore shape: dayname still present
        assert_eq!(
            again.values.get("dayname").and_then(|v| v.as_str()),
            Some("Monday")
        );
        // ensure we can write original money back
        let mut restore = again;
        restore.values.insert("money".into(), original_money);
        let _ = restore.write_bytes().unwrap();
    }
}
