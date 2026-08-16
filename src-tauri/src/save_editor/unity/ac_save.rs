//! Adventure Creator save files: `Binary` + Base64 NRBF chunks joined by `||`.
//!
//! Global variables live in a pipe-delimited ObjectString (`id:value|…`). We surface those
//! maps in the shared JSON tree and splice ObjectString records on write.

use crate::error::AppError;
use crate::save_editor::types::RenpySavePatch;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;

const PREFIX: &[u8] = b"Binary";
const PART_SEP: &[u8] = b"||";
const OBJECT_STRING: u8 = 0x06;
const BF_HEADER: [u8; 5] = [0x00, 0x01, 0x00, 0x00, 0x00];

#[derive(Debug, Clone)]
struct ObjectStringSite {
    part: usize,
    /// Absolute offset of the ObjectString record (0x06) within the padded part bytes.
    record_offset: usize,
    object_id: i32,
    /// Path in the JSON tree (e.g. `runtimeVariables` or `runtimeVariables.30`).
    map_path: String,
}

#[derive(Debug, Clone)]
enum EntryKind {
    Int,
    Float,
    Bool,
    /// Trailing type/marker after the string value (usually `-1`).
    String { trailer: String },
    Raw,
}

#[derive(Debug, Clone)]
struct MapEntry {
    id: String,
    kind: EntryKind,
}

/// True when bytes are an AC `Binary` + Base64 save.
pub fn looks_like_ac_binary_save(bytes: &[u8]) -> bool {
    if bytes.len() < PREFIX.len() + 16 || !bytes.starts_with(PREFIX) {
        return false;
    }
    let Ok(parts) = decode_parts(bytes) else {
        return false;
    };
    parts
        .first()
        .map(|p| {
            p.content.starts_with(&BF_HEADER)
                && (find_bytes(&p.content, b"AC.SaveData").is_some()
                    || find_bytes(&p.content, b"AC.MainData").is_some()
                    || find_bytes(&p.content, b"AC, Version=").is_some())
        })
        .unwrap_or(false)
}

fn find_bytes(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn parse_ac_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    let (value, _) = parse_ac(bytes)?;
    Ok(value)
}

pub fn apply_ac_patches(
    bytes: &[u8],
    patches: &[RenpySavePatch],
) -> Result<(Vec<u8>, Value), AppError> {
    let (mut value, sites) = parse_ac(bytes)?;
    crate::save_editor::json_tree::apply_patches_json(&mut value, patches)?;

    let mut parts = decode_parts(bytes)?;
    // Rebuild each edited pipe-map ObjectString from the updated JSON.
    let map_sites: Vec<&ObjectStringSite> = sites
        .iter()
        .filter(|s| !s.map_path.contains('.'))
        .collect();

    // Apply map rewrites from the end within each part so offsets stay valid.
    let mut by_part: HashMap<usize, Vec<&ObjectStringSite>> = HashMap::new();
    for site in map_sites {
        by_part.entry(site.part).or_default().push(site);
    }
    for (part_idx, mut list) in by_part {
        list.sort_by_key(|s| std::cmp::Reverse(s.record_offset));
        for site in list {
            let Some(map_val) = value.get(&site.map_path) else {
                continue;
            };
            let Some(obj) = map_val.as_object() else {
                continue;
            };
            // Recover entry kinds from the current ObjectString text before replace.
            let old = read_object_string_at(&parts[part_idx].content, site.record_offset)?;
            let kinds = parse_map_entries(&old);
            let new_text = serialize_map(obj, &kinds)?;
            splice_object_string(&mut parts[part_idx].content, site, &new_text)?;
        }
    }

    Ok((encode_parts(&parts)?, value))
}

struct Part {
    /// Full padded NRBF buffer (as stored after Base64 decode).
    content: Vec<u8>,
    /// Original decoded length (includes zero padding).
    orig_len: usize,
}

fn decode_parts(bytes: &[u8]) -> Result<Vec<Part>, AppError> {
    if !bytes.starts_with(PREFIX) {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let body = &bytes[PREFIX.len()..];
    let mut parts = Vec::new();
    for chunk in split_sep(body, PART_SEP) {
        if chunk.is_empty() {
            continue;
        }
        let content = B64.decode(chunk).map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
        if content.len() < 8 || !content.starts_with(&BF_HEADER) {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let orig_len = content.len();
        parts.push(Part { content, orig_len });
    }
    if parts.is_empty() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok(parts)
}

fn encode_parts(parts: &[Part]) -> Result<Vec<u8>, AppError> {
    let mut out = Vec::with_capacity(PREFIX.len() + parts.len() * 64);
    out.extend_from_slice(PREFIX);
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(PART_SEP);
        }
        let mut buf = part.content.clone();
        // Trim trailing zeros for sizing, then re-pad to original or next pow2.
        let content_end = buf.iter().rposition(|&b| b != 0).map(|i| i + 1).unwrap_or(0);
        buf.truncate(content_end.max(1));
        let target = if buf.len() <= part.orig_len {
            part.orig_len
        } else {
            buf.len().next_power_of_two().max(part.orig_len)
        };
        buf.resize(target, 0);
        out.extend_from_slice(B64.encode(&buf).as_bytes());
    }
    Ok(out)
}

fn split_sep<'a>(data: &'a [u8], sep: &[u8]) -> Vec<&'a [u8]> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i + sep.len() <= data.len() {
        if &data[i..i + sep.len()] == sep {
            out.push(&data[start..i]);
            i += sep.len();
            start = i;
        } else {
            i += 1;
        }
    }
    out.push(&data[start..]);
    out
}

fn parse_ac(bytes: &[u8]) -> Result<(Value, Vec<ObjectStringSite>), AppError> {
    let parts = decode_parts(bytes)?;
    let mut root = Map::new();
    let mut sites = Vec::new();
    let mut used_names: HashMap<String, usize> = HashMap::new();

    for (part_idx, part) in parts.iter().enumerate() {
        let strings = extract_object_strings(&part.content)?;
        for (record_offset, object_id, text) in strings {
            if looks_like_pipe_map(&text) {
                let base_name = classify_map_name(&text);
                let name = unique_name(&mut used_names, base_name);
                let (map, kinds) = pipe_map_to_json(&text);
                let _ = kinds; // kinds re-parsed on write from old text
                root.insert(name.clone(), Value::Object(map));
                sites.push(ObjectStringSite {
                    part: part_idx,
                    record_offset,
                    object_id,
                    map_path: name,
                });
            } else if !text.is_empty() && text.len() <= 128 && !text.contains('|') {
                // Short labels (scene names, etc.) — expose under misc.
                let misc = root
                    .entry("labels".to_string())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(arr) = misc {
                    arr.push(Value::String(text));
                }
            }
        }
    }

    if root.is_empty() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok((Value::Object(root), sites))
}

fn unique_name(used: &mut HashMap<String, usize>, base: &str) -> String {
    let n = used.entry(base.to_string()).or_insert(0);
    *n += 1;
    if *n == 1 {
        base.to_string()
    } else {
        format!("{base}_{}", *n)
    }
}

fn classify_map_name(text: &str) -> &'static str {
    let entries: Vec<&str> = text.split('|').filter(|e| !e.is_empty()).collect();
    let mut bools = 0usize;
    let mut strings = 0usize;
    let mut ints = 0usize;
    let mut complex = 0usize;
    for e in &entries {
        let parts: Vec<&str> = e.split(':').collect();
        match parts.len() {
            2 => {
                if parts[1] == "True" || parts[1] == "False" {
                    bools += 1;
                } else if parts[1].parse::<i64>().is_ok() {
                    ints += 1;
                } else if parts[1].contains('=') {
                    complex += 1;
                } else {
                    complex += 1;
                }
            }
            n if n >= 3 => strings += 1,
            _ => {}
        }
    }
    if complex > 0 && bools == 0 && strings == 0 {
        return "menuElements";
    }
    if bools > 0 && strings == 0 && ints == 0 {
        return "menuFlags";
    }
    if strings > 0 || ints > 0 {
        return "runtimeVariables";
    }
    "dataMap"
}

fn looks_like_pipe_map(text: &str) -> bool {
    // At least one `id:value|id:value` pair.
    if text.matches('|').count() < 1 {
        return false;
    }
    text.bytes().next().is_some_and(|b| b.is_ascii_digit()) && text.contains(':')
}

fn pipe_map_to_json(text: &str) -> (Map<String, Value>, Vec<MapEntry>) {
    let mut map = Map::new();
    let mut kinds = Vec::new();
    for entry in text.split('|').filter(|e| !e.is_empty()) {
        let (id, value, kind) = parse_entry(entry);
        kinds.push(MapEntry {
            id: id.clone(),
            kind: kind.clone(),
        });
        map.insert(id, value);
    }
    (map, kinds)
}

fn parse_map_entries(text: &str) -> Vec<MapEntry> {
    text.split('|')
        .filter(|e| !e.is_empty())
        .map(|e| {
            let (id, _, kind) = parse_entry(e);
            MapEntry { id, kind }
        })
        .collect()
}

fn parse_entry(entry: &str) -> (String, Value, EntryKind) {
    let parts: Vec<&str> = entry.split(':').collect();
    if parts.is_empty() {
        return (String::new(), Value::Null, EntryKind::Raw);
    }
    let id = parts[0].to_string();
    if parts.len() == 1 {
        return (id, Value::Null, EntryKind::Raw);
    }
    if parts.len() == 2 {
        let v = parts[1];
        if v == "True" {
            return (id, Value::Bool(true), EntryKind::Bool);
        }
        if v == "False" {
            return (id, Value::Bool(false), EntryKind::Bool);
        }
        if let Ok(i) = v.parse::<i64>() {
            return (id, Value::Number(i.into()), EntryKind::Int);
        }
        if let Ok(f) = v.parse::<f64>() {
            if let Some(n) = Number::from_f64(f) {
                return (id, Value::Number(n), EntryKind::Float);
            }
        }
        return (id, Value::String(v.to_string()), EntryKind::Raw);
    }
    // id : string (may contain ':') : trailer
    let trailer = parts[parts.len() - 1].to_string();
    let mid = parts[1..parts.len() - 1].join(":");
    let value = mid.replace("*COLON*", ":");
    (
        id,
        Value::String(value),
        EntryKind::String { trailer },
    )
}

fn serialize_map(obj: &Map<String, Value>, kinds: &[MapEntry]) -> Result<String, AppError> {
    let mut kind_by_id: HashMap<&str, &EntryKind> = HashMap::new();
    for e in kinds {
        kind_by_id.insert(e.id.as_str(), &e.kind);
    }
    let mut out = String::new();
    // Preserve original key order from kinds; append any new keys at the end.
    let mut seen = std::collections::HashSet::new();
    for e in kinds {
        seen.insert(e.id.as_str());
        let Some(val) = obj.get(&e.id) else {
            continue;
        };
        if !out.is_empty() {
            out.push('|');
        }
        out.push_str(&format_entry(&e.id, val, &e.kind)?);
    }
    for (k, val) in obj {
        if seen.contains(k.as_str()) {
            continue;
        }
        if !out.is_empty() {
            out.push('|');
        }
        let kind = infer_kind(val);
        out.push_str(&format_entry(k, val, &kind)?);
    }
    Ok(out)
}

fn infer_kind(val: &Value) -> EntryKind {
    match val {
        Value::Bool(_) => EntryKind::Bool,
        Value::Number(n) if n.is_i64() || n.is_u64() => EntryKind::Int,
        Value::Number(_) => EntryKind::Float,
        Value::String(_) => EntryKind::String {
            trailer: "-1".into(),
        },
        _ => EntryKind::Raw,
    }
}

fn format_entry(id: &str, val: &Value, kind: &EntryKind) -> Result<String, AppError> {
    match kind {
        EntryKind::Bool => {
            let Some(b) = val.as_bool() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(format!("{id}:{}", if b { "True" } else { "False" }))
        }
        EntryKind::Int => {
            let n = val
                .as_i64()
                .or_else(|| val.as_u64().and_then(|u| i64::try_from(u).ok()))
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
            Ok(format!("{id}:{n}"))
        }
        EntryKind::Float => {
            let Some(f) = val.as_f64() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(format!("{id}:{f}"))
        }
        EntryKind::String { trailer } => {
            let Some(s) = val.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            let esc = s.replace(':', "*COLON*");
            Ok(format!("{id}:{esc}:{trailer}"))
        }
        EntryKind::Raw => {
            let s = match val {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            Ok(format!("{id}:{s}"))
        }
    }
}

fn extract_object_strings(data: &[u8]) -> Result<Vec<(usize, i32, String)>, AppError> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 5 < data.len() {
        if data[i] != OBJECT_STRING {
            i += 1;
            continue;
        }
        match try_read_object_string(data, i) {
            Some((next, oid, text)) => {
                out.push((i, oid, text));
                i = next;
            }
            None => {
                i += 1;
            }
        }
    }
    Ok(out)
}

fn try_read_object_string(data: &[u8], offset: usize) -> Option<(usize, i32, String)> {
    if offset >= data.len() || data[offset] != OBJECT_STRING {
        return None;
    }
    let mut j = offset + 1;
    if j + 4 > data.len() {
        return None;
    }
    let oid = i32::from_le_bytes(data[j..j + 4].try_into().ok()?);
    j += 4;
    if !(0..=1_000_000).contains(&oid) {
        return None;
    }
    let (n, j2) = read_7bit_len(data, j)?;
    if n == 0 || n > 200_000 || j2 + n > data.len() {
        return None;
    }
    let text = std::str::from_utf8(&data[j2..j2 + n]).ok()?.to_string();
    Some((j2 + n, oid, text))
}

fn read_object_string_at(data: &[u8], offset: usize) -> Result<String, AppError> {
    try_read_object_string(data, offset)
        .map(|(_, _, t)| t)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))
}

fn splice_object_string(
    data: &mut Vec<u8>,
    site: &ObjectStringSite,
    new_text: &str,
) -> Result<(), AppError> {
    let (old_end, oid, _old) = try_read_object_string(data, site.record_offset)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    if oid != site.object_id {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    let mut record = Vec::with_capacity(5 + new_text.len() + 5);
    record.push(OBJECT_STRING);
    record.extend_from_slice(&site.object_id.to_le_bytes());
    write_7bit_len(&mut record, new_text.len());
    record.extend_from_slice(new_text.as_bytes());
    data.splice(site.record_offset..old_end, record);
    Ok(())
}

fn read_7bit_len(data: &[u8], mut i: usize) -> Option<(usize, usize)> {
    let mut result: usize = 0;
    let mut shift = 0;
    loop {
        if i >= data.len() || shift > 35 {
            return None;
        }
        let b = data[i];
        i += 1;
        result |= ((b & 0x7f) as usize) << shift;
        if b & 0x80 == 0 {
            return Some((result, i));
        }
        shift += 7;
    }
}

fn write_7bit_len(out: &mut Vec<u8>, mut value: usize) {
    loop {
        let mut b = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            b |= 0x80;
        }
        out.push(b);
        if value == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::RenpySavePatch;

    fn sample_ac_file(variables: &str) -> Vec<u8> {
        // Minimal NRBF-ish buffer: header + one ObjectString with variables.
        let mut bf = Vec::new();
        bf.extend_from_slice(&BF_HEADER);
        bf.extend_from_slice(&[0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]);
        bf.extend_from_slice(b"AC.SaveData");
        bf.push(OBJECT_STRING);
        bf.extend_from_slice(&5i32.to_le_bytes());
        write_7bit_len(&mut bf, variables.len());
        bf.extend_from_slice(variables.as_bytes());
        // MessageEnd-ish + pad
        bf.push(0x0b);
        let orig = bf.len().next_power_of_two().max(256);
        bf.resize(orig, 0);

        let mut out = PREFIX.to_vec();
        out.extend_from_slice(B64.encode(&bf).as_bytes());
        out
    }

    #[test]
    fn detects_and_parses_runtime_variables() {
        let file = sample_ac_file("30:50|1:New save:-1|2:Gusti:-1");
        assert!(looks_like_ac_binary_save(&file));
        let value = parse_ac_to_json(&file).unwrap();
        let vars = value.get("runtimeVariables").unwrap();
        assert_eq!(vars["30"], Value::Number(50.into()));
        assert_eq!(vars["1"], Value::String("New save".into()));
        assert_eq!(vars["2"], Value::String("Gusti".into()));
    }

    #[test]
    fn splice_variable_round_trip() {
        let file = sample_ac_file("30:50|1:New save:-1");
        let (out, value) = apply_ac_patches(
            &file,
            &[RenpySavePatch {
                path: "runtimeVariables.30".into(),
                value: Value::Number(999.into()),
            }],
        )
        .unwrap();
        assert_eq!(value["runtimeVariables"]["30"], Value::Number(999.into()));
        let again = parse_ac_to_json(&out).unwrap();
        assert_eq!(again["runtimeVariables"]["30"], Value::Number(999.into()));
        assert_eq!(
            again["runtimeVariables"]["1"],
            Value::String("New save".into())
        );
        assert!(looks_like_ac_binary_save(&out));
    }

    #[test]
    fn parses_ofs_save_if_present() {
        let path = r"C:\Users\Administrator\AppData\LocalLow\Sin Bin Interactive\Our Fathers Sins\OurFathersSins_0.save";
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        assert!(looks_like_ac_binary_save(&bytes));
        let value = parse_ac_to_json(&bytes).expect("parse OFS save");
        let vars = value
            .get("runtimeVariables")
            .expect("runtimeVariables map");
        assert!(vars.get("30").is_some() || vars.as_object().map(|m| !m.is_empty()).unwrap_or(false));
    }
}
