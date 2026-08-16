//! Sirenix Odin Serializer binary (`.mss` / unnamed reference-node header).
//!
//! Read → JSON-shaped tree for the shared editor; write via in-place primitive splices
//! (same-size for numbers/bools; strings may grow/shrink with a byte shift).

use crate::error::AppError;
use crate::save_editor::types::RenpySavePatch;
use serde_json::{Map, Number, Value};
use std::collections::HashMap;

/// BinaryEntryType (OdinSerializer).
const NAMED_START_REF: u8 = 0x01;
const UNNAMED_START_REF: u8 = 0x02;
const NAMED_START_STRUCT: u8 = 0x03;
const UNNAMED_START_STRUCT: u8 = 0x04;
const END_OF_NODE: u8 = 0x05;
const START_OF_ARRAY: u8 = 0x06;
const END_OF_ARRAY: u8 = 0x07;
const PRIMITIVE_ARRAY: u8 = 0x08;
const NAMED_INTERNAL_REF: u8 = 0x09;
const UNNAMED_INTERNAL_REF: u8 = 0x0A;
const NAMED_SBYTE: u8 = 0x0F;
const UNNAMED_SBYTE: u8 = 0x10;
const NAMED_BYTE: u8 = 0x11;
const UNNAMED_BYTE: u8 = 0x12;
const NAMED_SHORT: u8 = 0x13;
const UNNAMED_SHORT: u8 = 0x14;
const NAMED_USHORT: u8 = 0x15;
const UNNAMED_USHORT: u8 = 0x16;
const NAMED_INT: u8 = 0x17;
const UNNAMED_INT: u8 = 0x18;
const NAMED_UINT: u8 = 0x19;
const UNNAMED_UINT: u8 = 0x1A;
const NAMED_LONG: u8 = 0x1B;
const UNNAMED_LONG: u8 = 0x1C;
const NAMED_ULONG: u8 = 0x1D;
const UNNAMED_ULONG: u8 = 0x1E;
const NAMED_FLOAT: u8 = 0x1F;
const UNNAMED_FLOAT: u8 = 0x20;
const NAMED_DOUBLE: u8 = 0x21;
const UNNAMED_DOUBLE: u8 = 0x22;
const NAMED_DECIMAL: u8 = 0x23;
const UNNAMED_DECIMAL: u8 = 0x24;
const NAMED_CHAR: u8 = 0x25;
const UNNAMED_CHAR: u8 = 0x26;
const NAMED_STRING: u8 = 0x27;
const UNNAMED_STRING: u8 = 0x28;
const NAMED_GUID: u8 = 0x29;
const UNNAMED_GUID: u8 = 0x2A;
const NAMED_BOOL: u8 = 0x2B;
const UNNAMED_BOOL: u8 = 0x2C;
const NAMED_NULL: u8 = 0x2D;
const UNNAMED_NULL: u8 = 0x2E;
const TYPE_NAME: u8 = 0x2F;
const TYPE_ID: u8 = 0x30;
const END_OF_STREAM: u8 = 0x31;
const NAMED_EXT_REF_STR: u8 = 0x32;
const UNNAMED_EXT_REF_STR: u8 = 0x33;
// External by index / guid (named/unnamed): 0x0B..=0x0E
const NAMED_EXT_REF_IDX: u8 = 0x0B;
const UNNAMED_EXT_REF_IDX: u8 = 0x0C;
const NAMED_EXT_REF_GUID: u8 = 0x0D;
const UNNAMED_EXT_REF_GUID: u8 = 0x0E;

#[derive(Debug, Clone, Copy)]
enum LeafKind {
    I8,
    U8,
    Bool,
    I16,
    U16,
    Char,
    I32,
    U32,
    F32,
    I64,
    U64,
    F64,
    /// `flag` 0 = Latin-1 bytes, 1 = UTF-16LE chars; `char_len` is the stored length field.
    String { flag: u8, char_len: u32 },
}

#[derive(Debug, Clone)]
struct LeafSite {
    path: String,
    /// Absolute offset of the value payload (after entry type + optional name).
    offset: usize,
    kind: LeafKind,
}

/// True when bytes look like an Odin binary stream (not AES/JSON).
pub fn looks_like_odin_binary(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    let head = bytes[0];
    if !matches!(
        head,
        NAMED_START_REF | UNNAMED_START_REF | NAMED_START_STRUCT | UNNAMED_START_STRUCT
    ) {
        return false;
    }
    // After optional name, type entry is TypeName / TypeID / UnnamedNull.
    let type_at = if matches!(head, NAMED_START_REF | NAMED_START_STRUCT) {
        match skip_odin_string(bytes, 1) {
            Some(p) => p,
            None => return false,
        }
    } else {
        1
    };
    matches!(
        bytes.get(type_at).copied(),
        Some(TYPE_NAME | TYPE_ID | UNNAMED_NULL)
    )
}

pub fn parse_odin_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    let (value, _) = parse_odin(bytes)?;
    Ok(value)
}

/// Apply primitive patches by splicing the binary; returns new bytes + updated JSON tree value.
pub fn apply_odin_patches(
    bytes: &[u8],
    patches: &[RenpySavePatch],
) -> Result<(Vec<u8>, Value), AppError> {
    let (value, sites) = parse_odin(bytes)?;
    let mut by_path: HashMap<String, &LeafSite> = HashMap::new();
    for site in &sites {
        by_path.insert(site.path.clone(), site);
    }

    // Validate against JSON view first (path + type family).
    let mut preview = value.clone();
    crate::save_editor::json_tree::apply_patches_json(&mut preview, patches)?;

    let mut out = bytes.to_vec();
    // Apply from the end so earlier offsets stay valid when strings resize.
    let mut ordered: Vec<(&RenpySavePatch, &LeafSite)> = Vec::new();
    for patch in patches {
        let site = by_path
            .get(&patch.path)
            .copied()
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
        ordered.push((patch, site));
    }
    ordered.sort_by_key(|(_, s)| std::cmp::Reverse(s.offset));

    for (patch, site) in ordered {
        splice_leaf(&mut out, site, &patch.value)?;
    }

    let (reparsed, _) = parse_odin(&out)?;
    Ok((out, reparsed))
}

fn parse_odin(bytes: &[u8]) -> Result<(Value, Vec<LeafSite>), AppError> {
    let mut r = Reader {
        data: bytes,
        pos: 0,
        types: HashMap::new(),
        leaves: Vec::new(),
    };
    let value = r.read_value("")?;
    if r.pos < bytes.len() && bytes[r.pos] == END_OF_STREAM {
        r.pos += 1;
    }
    if r.pos != bytes.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok((value, r.leaves))
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    types: HashMap<i32, String>,
    leaves: Vec<LeafSite>,
}

impl<'a> Reader<'a> {
    fn read_value(&mut self, path: &str) -> Result<Value, AppError> {
        let et = self.read_u8()?;
        if is_named(et) {
            let name = self.read_string()?;
            let child = join_path(path, &name);
            return self.read_entry_value_only(et, &child);
        }
        self.read_entry_value_only(et, path)
    }

    fn read_object_body(
        &mut self,
        path: &str,
        typ: Option<String>,
        id: Option<i32>,
    ) -> Result<Value, AppError> {
        let mut map = Map::new();
        if let Some(t) = typ {
            map.insert("$type".into(), Value::String(t));
        }
        if let Some(id) = id {
            map.insert("$id".into(), Value::Number(id.into()));
        }
        loop {
            if self.pos >= self.data.len() {
                return Err(AppError::keyed("error.saveEditor.parse"));
            }
            let et = self.data[self.pos];
            if et == END_OF_NODE {
                self.pos += 1;
                break;
            }
            if et == END_OF_STREAM {
                break;
            }
            self.pos += 1;
            let name = if is_named(et) {
                Some(self.read_string()?)
            } else {
                None
            };

            let (store_key, value_path) = if let Some(n) = name {
                (Some(n.clone()), join_path(path, &n))
            } else {
                let idx = match map.get("$items") {
                    Some(Value::Array(a)) => a.len(),
                    _ => 0,
                };
                let items_path = join_path(path, "$items");
                (None, format!("{items_path}[{idx}]"))
            };

            let value = self.read_entry_value_only(et, &value_path)?;
            if let Some(key) = store_key {
                map.insert(key, value);
            } else {
                let arr = map
                    .entry("$items".to_string())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(a) = arr {
                    a.push(value);
                }
            }
        }
        Ok(Value::Object(map))
    }

    /// After entry type (+ name) already consumed, read the payload for that entry.
    fn read_entry_value_only(&mut self, et: u8, path: &str) -> Result<Value, AppError> {
        match et {
            NAMED_START_REF | UNNAMED_START_REF => {
                let typ = self.read_type_entry()?;
                let id = self.read_i32()?;
                self.read_object_body(path, typ, Some(id))
            }
            NAMED_START_STRUCT | UNNAMED_START_STRUCT => {
                let typ = self.read_type_entry()?;
                self.read_object_body(path, typ, None)
            }
            START_OF_ARRAY => {
                let _len = self.read_i64()?;
                self.read_array_body(path)
            }
            PRIMITIVE_ARRAY => self.read_primitive_array(path),
            NAMED_INTERNAL_REF | UNNAMED_INTERNAL_REF => {
                let id = self.read_i32()?;
                Ok(json_obj_one("$ref", Value::Number(id.into())))
            }
            NAMED_EXT_REF_IDX | UNNAMED_EXT_REF_IDX => {
                let id = self.read_i32()?;
                Ok(json_obj_one("$extRef", Value::Number(id.into())))
            }
            NAMED_EXT_REF_GUID | UNNAMED_EXT_REF_GUID => {
                Ok(json_obj_one("$extGuid", Value::String(self.read_guid_string()?)))
            }
            NAMED_EXT_REF_STR | UNNAMED_EXT_REF_STR => {
                Ok(json_obj_one("$ext", Value::String(self.read_string()?)))
            }
            NAMED_SBYTE | UNNAMED_SBYTE => {
                let off = self.pos;
                let v = self.read_i8()?;
                self.push_leaf(path, off, LeafKind::I8);
                Ok(Value::Number(v.into()))
            }
            NAMED_BYTE | UNNAMED_BYTE => {
                let off = self.pos;
                let v = self.read_u8()?;
                self.push_leaf(path, off, LeafKind::U8);
                Ok(Value::Number(v.into()))
            }
            NAMED_SHORT | UNNAMED_SHORT => {
                let off = self.pos;
                let v = self.read_i16()?;
                self.push_leaf(path, off, LeafKind::I16);
                Ok(Value::Number(v.into()))
            }
            NAMED_USHORT | UNNAMED_USHORT => {
                let off = self.pos;
                let v = self.read_u16()?;
                self.push_leaf(path, off, LeafKind::U16);
                Ok(Value::Number(v.into()))
            }
            NAMED_CHAR | UNNAMED_CHAR => {
                let off = self.pos;
                let v = self.read_u16()?;
                self.push_leaf(path, off, LeafKind::Char);
                Ok(Value::String(
                    char::from_u32(v as u32).unwrap_or('\u{FFFD}').to_string(),
                ))
            }
            NAMED_INT | UNNAMED_INT => {
                let off = self.pos;
                let v = self.read_i32()?;
                self.push_leaf(path, off, LeafKind::I32);
                Ok(Value::Number(v.into()))
            }
            NAMED_UINT | UNNAMED_UINT => {
                let off = self.pos;
                let v = self.read_u32()?;
                self.push_leaf(path, off, LeafKind::U32);
                Ok(Value::Number(v.into()))
            }
            NAMED_LONG | UNNAMED_LONG => {
                let off = self.pos;
                let v = self.read_i64()?;
                self.push_leaf(path, off, LeafKind::I64);
                Ok(Value::Number(v.into()))
            }
            NAMED_ULONG | UNNAMED_ULONG => {
                let off = self.pos;
                let v = self.read_u64()?;
                self.push_leaf(path, off, LeafKind::U64);
                number_from_u64(v)
            }
            NAMED_FLOAT | UNNAMED_FLOAT => {
                let off = self.pos;
                let v = self.read_f32()?;
                self.push_leaf(path, off, LeafKind::F32);
                number_from_f64(v as f64)
            }
            NAMED_DOUBLE | UNNAMED_DOUBLE => {
                let off = self.pos;
                let v = self.read_f64()?;
                self.push_leaf(path, off, LeafKind::F64);
                number_from_f64(v)
            }
            NAMED_DECIMAL | UNNAMED_DECIMAL => {
                let raw = self.read_bytes(16)?;
                Ok(Value::String(format!("decimal:{}", hex::encode(raw))))
            }
            NAMED_STRING | UNNAMED_STRING => {
                let off = self.pos;
                let (flag, char_len, s) = self.read_string_detailed()?;
                self.push_leaf(path, off, LeafKind::String { flag, char_len });
                Ok(Value::String(s))
            }
            NAMED_GUID | UNNAMED_GUID => Ok(Value::String(self.read_guid_string()?)),
            NAMED_BOOL | UNNAMED_BOOL => {
                let off = self.pos;
                let v = self.read_u8()? != 0;
                self.push_leaf(path, off, LeafKind::Bool);
                Ok(Value::Bool(v))
            }
            NAMED_NULL | UNNAMED_NULL => Ok(Value::Null),
            _ => Err(AppError::keyed("error.saveEditor.parse")),
        }
    }

    fn read_array_body(&mut self, path: &str) -> Result<Value, AppError> {
        let mut items = Vec::new();
        loop {
            if self.pos >= self.data.len() {
                return Err(AppError::keyed("error.saveEditor.parse"));
            }
            let et = self.data[self.pos];
            if et == END_OF_ARRAY {
                self.pos += 1;
                break;
            }
            if et == END_OF_STREAM {
                break;
            }
            let idx = items.len();
            let child_path = format!("{path}[{idx}]");
            self.pos += 1;
            // Array elements are unnamed; if named, still bind to index path for editing.
            if is_named(et) {
                let _name = self.read_string()?;
            }
            let v = self.read_entry_value_only(et, &child_path)?;
            // PrimitiveArray expands to many values — flatten.
            if et == PRIMITIVE_ARRAY {
                match v {
                    Value::Array(arr) => items.extend(arr),
                    other => items.push(other),
                }
            } else {
                items.push(v);
            }
        }
        Ok(Value::Array(items))
    }

    fn read_primitive_array(&mut self, path: &str) -> Result<Value, AppError> {
        let elements = self.read_i32()? as usize;
        let bytes_per = self.read_i32()? as usize;
        if bytes_per == 0 || elements > 10_000_000 {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let total = elements
            .checked_mul(bytes_per)
            .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
        let start = self.pos;
        let raw = self.read_bytes(total)?;

        let mut out = Vec::with_capacity(elements);
        match bytes_per {
            1 => {
                for (i, &b) in raw.iter().enumerate() {
                    let off = start + i;
                    let p = format!("{path}[{i}]");
                    self.push_leaf(&p, off, LeafKind::U8);
                    out.push(Value::Number(b.into()));
                }
            }
            2 => {
                for i in 0..elements {
                    let off = start + i * 2;
                    let v = i16::from_le_bytes([raw[i * 2], raw[i * 2 + 1]]);
                    let p = format!("{path}[{i}]");
                    self.push_leaf(&p, off, LeafKind::I16);
                    out.push(Value::Number(v.into()));
                }
            }
            4 => {
                // Heuristic: ints (most common in dict value arrays). Floats still editable as int bits if mis-detected —
                // Odin stores typed arrays; int is the common case for game saves.
                for i in 0..elements {
                    let off = start + i * 4;
                    let v = i32::from_le_bytes(raw[i * 4..i * 4 + 4].try_into().unwrap());
                    let p = format!("{path}[{i}]");
                    self.push_leaf(&p, off, LeafKind::I32);
                    out.push(Value::Number(v.into()));
                }
            }
            8 => {
                for i in 0..elements {
                    let off = start + i * 8;
                    let v = i64::from_le_bytes(raw[i * 8..i * 8 + 8].try_into().unwrap());
                    let p = format!("{path}[{i}]");
                    self.push_leaf(&p, off, LeafKind::I64);
                    out.push(Value::Number(v.into()));
                }
            }
            _ => {
                return Ok(Value::String(format!(
                    "primitiveArray:{elements}x{bytes_per}"
                )));
            }
        }
        Ok(Value::Array(out))
    }

    fn read_type_entry(&mut self) -> Result<Option<String>, AppError> {
        let et = self.read_u8()?;
        match et {
            TYPE_NAME => {
                let id = self.read_i32()?;
                let name = self.read_string()?;
                self.types.insert(id, name.clone());
                Ok(Some(name))
            }
            TYPE_ID => {
                let id = self.read_i32()?;
                Ok(self.types.get(&id).cloned())
            }
            UNNAMED_NULL => Ok(None),
            _ => Err(AppError::keyed("error.saveEditor.parse")),
        }
    }

    fn push_leaf(&mut self, path: &str, offset: usize, kind: LeafKind) {
        if path.is_empty() {
            return;
        }
        self.leaves.push(LeafSite {
            path: path.to_string(),
            offset,
            kind,
        });
    }

    fn read_string(&mut self) -> Result<String, AppError> {
        let (_, _, s) = self.read_string_detailed()?;
        Ok(s)
    }

    fn read_string_detailed(&mut self) -> Result<(u8, u32, String), AppError> {
        let flag = self.read_u8()?;
        let char_len = self.read_u32()?;
        if char_len > 10_000_000 {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let s = if flag != 0 {
            let nbytes = char_len as usize * 2;
            let raw = self.read_bytes(nbytes)?;
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        } else {
            let raw = self.read_bytes(char_len as usize)?;
            raw.iter().map(|&b| b as char).collect()
        };
        Ok((flag, char_len, s))
    }

    fn read_guid_string(&mut self) -> Result<String, AppError> {
        let raw = self.read_bytes(16)?;
        Ok(format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            raw[3], raw[2], raw[1], raw[0], raw[5], raw[4], raw[7], raw[6], raw[8], raw[9],
            raw[10], raw[11], raw[12], raw[13], raw[14], raw[15]
        ))
    }

    fn read_u8(&mut self) -> Result<u8, AppError> {
        if self.pos >= self.data.len() {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn read_i8(&mut self) -> Result<i8, AppError> {
        Ok(self.read_u8()? as i8)
    }

    fn read_i16(&mut self) -> Result<i16, AppError> {
        let b = self.read_bytes(2)?;
        Ok(i16::from_le_bytes([b[0], b[1]]))
    }

    fn read_u16(&mut self) -> Result<u16, AppError> {
        let b = self.read_bytes(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    fn read_i32(&mut self) -> Result<i32, AppError> {
        let b = self.read_bytes(4)?;
        Ok(i32::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_u32(&mut self) -> Result<u32, AppError> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_i64(&mut self) -> Result<i64, AppError> {
        let b = self.read_bytes(8)?;
        Ok(i64::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_u64(&mut self) -> Result<u64, AppError> {
        let b = self.read_bytes(8)?;
        Ok(u64::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_f32(&mut self) -> Result<f32, AppError> {
        let b = self.read_bytes(4)?;
        Ok(f32::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_f64(&mut self) -> Result<f64, AppError> {
        let b = self.read_bytes(8)?;
        Ok(f64::from_le_bytes(b.try_into().unwrap()))
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], AppError> {
        if self.pos + n > self.data.len() {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let s = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
}

fn is_named(et: u8) -> bool {
    matches!(
        et,
        NAMED_START_REF
            | NAMED_START_STRUCT
            | NAMED_INTERNAL_REF
            | NAMED_EXT_REF_IDX
            | NAMED_EXT_REF_GUID
            | NAMED_EXT_REF_STR
            | NAMED_SBYTE
            | NAMED_BYTE
            | NAMED_SHORT
            | NAMED_USHORT
            | NAMED_INT
            | NAMED_UINT
            | NAMED_LONG
            | NAMED_ULONG
            | NAMED_FLOAT
            | NAMED_DOUBLE
            | NAMED_DECIMAL
            | NAMED_CHAR
            | NAMED_STRING
            | NAMED_GUID
            | NAMED_BOOL
            | NAMED_NULL
    )
}

fn escape_path_segment(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            '\\' | '.' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

fn join_path(parent: &str, name: &str) -> String {
    let seg = escape_path_segment(name);
    if parent.is_empty() {
        seg
    } else {
        format!("{parent}.{seg}")
    }
}

fn json_obj_one(k: &str, v: Value) -> Value {
    Value::Object(Map::from_iter([(k.to_string(), v)]))
}

fn number_from_f64(v: f64) -> Result<Value, AppError> {
    Number::from_f64(v)
        .map(Value::Number)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))
}

fn number_from_u64(v: u64) -> Result<Value, AppError> {
    Ok(Value::Number(v.into()))
}

fn skip_odin_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    if i >= bytes.len() {
        return None;
    }
    let flag = bytes[i];
    i += 1;
    if i + 4 > bytes.len() {
        return None;
    }
    let n = u32::from_le_bytes(bytes[i..i + 4].try_into().ok()?) as usize;
    i += 4;
    let nbytes = if flag != 0 { n.checked_mul(2)? } else { n };
    if i + nbytes > bytes.len() {
        return None;
    }
    Some(i + nbytes)
}

fn splice_leaf(out: &mut Vec<u8>, site: &LeafSite, value: &Value) -> Result<(), AppError> {
    match site.kind {
        LeafKind::I8 => {
            let n = json_as_i64(value)?;
            if !(-128..=127).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset] = n as u8;
        }
        LeafKind::U8 => {
            let n = json_as_i64(value)?;
            if !(0..=255).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset] = n as u8;
        }
        LeafKind::Bool => {
            let Some(b) = value.as_bool() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            out[site.offset] = if b { 1 } else { 0 };
        }
        LeafKind::I16 => {
            let n = json_as_i64(value)?;
            if !((i16::MIN as i64)..=(i16::MAX as i64)).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset..site.offset + 2].copy_from_slice(&(n as i16).to_le_bytes());
        }
        LeafKind::U16 | LeafKind::Char => {
            let n = if let Some(s) = value.as_str() {
                s.chars().next().map(|c| c as u64).unwrap_or(0)
            } else {
                json_as_i64(value)? as u64
            };
            if n > u16::MAX as u64 {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset..site.offset + 2].copy_from_slice(&(n as u16).to_le_bytes());
        }
        LeafKind::I32 => {
            let n = json_as_i64(value)?;
            if !((i32::MIN as i64)..=(i32::MAX as i64)).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset..site.offset + 4].copy_from_slice(&(n as i32).to_le_bytes());
        }
        LeafKind::U32 => {
            let n = json_as_u64(value)?;
            if n > u32::MAX as u64 {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            out[site.offset..site.offset + 4].copy_from_slice(&(n as u32).to_le_bytes());
        }
        LeafKind::F32 => {
            let Some(f) = value.as_f64() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            out[site.offset..site.offset + 4].copy_from_slice(&(f as f32).to_le_bytes());
        }
        LeafKind::I64 => {
            let n = json_as_i64(value)?;
            out[site.offset..site.offset + 8].copy_from_slice(&n.to_le_bytes());
        }
        LeafKind::U64 => {
            let n = json_as_u64(value)?;
            out[site.offset..site.offset + 8].copy_from_slice(&n.to_le_bytes());
        }
        LeafKind::F64 => {
            let Some(f) = value.as_f64() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            out[site.offset..site.offset + 8].copy_from_slice(&f.to_le_bytes());
        }
        LeafKind::String { flag, char_len } => {
            let Some(s) = value.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            let old_nbytes = if flag != 0 {
                char_len as usize * 2
            } else {
                char_len as usize
            };
            let old_total = 1 + 4 + old_nbytes; // flag + len + payload

            let (new_flag, payload) = encode_odin_string(s, flag);
            let new_char_len = if new_flag != 0 {
                s.encode_utf16().count() as u32
            } else {
                // 8-bit path: one byte per char (lossy if >255 — reject).
                if s.chars().any(|c| c as u32 > 255) {
                    return Err(AppError::keyed("error.saveEditor.patchType"));
                }
                s.chars().count() as u32
            };
            let mut encoded = Vec::with_capacity(1 + 4 + payload.len());
            encoded.push(new_flag);
            encoded.extend_from_slice(&new_char_len.to_le_bytes());
            encoded.extend_from_slice(&payload);

            let start = site.offset;
            let end = start + old_total;
            if end > out.len() {
                return Err(AppError::keyed("error.saveEditor.parse"));
            }
            out.splice(start..end, encoded);
        }
    }
    Ok(())
}

fn encode_odin_string(s: &str, prefer_flag: u8) -> (u8, Vec<u8>) {
    // Keep 16-bit if original was 16-bit, or if any char > 255.
    let needs16 = prefer_flag != 0 || s.chars().any(|c| c as u32 > 255);
    if needs16 {
        let units: Vec<u16> = s.encode_utf16().collect();
        let mut payload = Vec::with_capacity(units.len() * 2);
        for u in units {
            payload.extend_from_slice(&u.to_le_bytes());
        }
        (1, payload)
    } else {
        (0, s.chars().map(|c| c as u8).collect())
    }
}

fn json_as_i64(value: &Value) -> Result<i64, AppError> {
    match value {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok()))
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType")),
        _ => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

fn json_as_u64(value: &Value) -> Result<u64, AppError> {
    match value {
        Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_i64().and_then(|i| u64::try_from(i).ok()))
            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType")),
        _ => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::RenpySavePatch;

    fn write_odin_string(out: &mut Vec<u8>, s: &str) {
        out.push(1); // UTF-16
        let units: Vec<u16> = s.encode_utf16().collect();
        out.extend_from_slice(&(units.len() as u32).to_le_bytes());
        for u in units {
            out.extend_from_slice(&u.to_le_bytes());
        }
    }

    /// Minimal Odin blob: unnamed ref node, type name "T", id 0, named int "gold"=50, end.
    fn sample_gold_blob() -> Vec<u8> {
        let mut v = Vec::new();
        v.push(UNNAMED_START_REF);
        v.push(TYPE_NAME);
        v.extend_from_slice(&0i32.to_le_bytes());
        write_odin_string(&mut v, "T");
        v.extend_from_slice(&0i32.to_le_bytes()); // node id
        v.push(NAMED_INT);
        write_odin_string(&mut v, "gold");
        v.extend_from_slice(&50i32.to_le_bytes());
        v.push(END_OF_NODE);
        v
    }

    #[test]
    fn detects_and_parses_named_int() {
        let blob = sample_gold_blob();
        assert!(looks_like_odin_binary(&blob));
        let value = parse_odin_to_json(&blob).unwrap();
        assert_eq!(value["gold"], Value::Number(50.into()));
        assert_eq!(value["$type"], Value::String("T".into()));
    }

    #[test]
    fn splice_int_round_trip() {
        let blob = sample_gold_blob();
        let (out, value) = apply_odin_patches(
            &blob,
            &[RenpySavePatch {
                path: "gold".into(),
                value: Value::Number(999.into()),
            }],
        )
        .unwrap();
        assert_eq!(value["gold"], Value::Number(999.into()));
        let again = parse_odin_to_json(&out).unwrap();
        assert_eq!(again["gold"], Value::Number(999.into()));
    }

    #[test]
    fn parses_milf_plaza_save_mss_if_present() {
        let path = r"C:\Users\Administrator\AppData\LocalLow\Texic\Milf Plaza\GameData\Save\GameSave_1_1\save.mss";
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        assert!(looks_like_odin_binary(&bytes));
        let value = parse_odin_to_json(&bytes).expect("parse milf plaza save.mss");
        assert!(value.get("$type").is_some(), "root should expose $type");
        assert!(
            value.get("_gameTime").is_some() || value.get("_tags").is_some(),
            "expected known GameSave fields, got keys: {:?}",
            value.as_object().map(|m| m.keys().collect::<Vec<_>>())
        );
    }
}
