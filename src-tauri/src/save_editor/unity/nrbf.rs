//! MS-NRBF (BinaryFormatter) saves — flat PlayerData and graph `save_manager` (Ntraholic).

use crate::error::AppError;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const RECORD_SERIALIZED_STREAM_HEADER: u8 = 0;
const RECORD_CLASS_WITH_ID: u8 = 1;
const RECORD_SYSTEM_CLASS_WITH_MEMBERS_AND_TYPES: u8 = 4;
const RECORD_CLASS_WITH_MEMBERS_AND_TYPES: u8 = 5;
const RECORD_BINARY_OBJECT_STRING: u8 = 6;
const RECORD_MEMBER_REFERENCE: u8 = 9;
const RECORD_OBJECT_NULL: u8 = 10;
const RECORD_MESSAGE_END: u8 = 11;
const RECORD_BINARY_LIBRARY: u8 = 12;
const RECORD_OBJECT_NULL_MULTIPLE_256: u8 = 13;
const RECORD_ARRAY_SINGLE_PRIMITIVE: u8 = 15;
const RECORD_ARRAY_SINGLE_STRING: u8 = 17;

const BINARY_TYPE_PRIMITIVE: u8 = 0;
const BINARY_TYPE_STRING: u8 = 1;
const BINARY_TYPE_SYSTEM_CLASS: u8 = 3;
const BINARY_TYPE_OBJECT_ARRAY: u8 = 5;
const BINARY_TYPE_STRING_ARRAY: u8 = 6;
const BINARY_TYPE_PRIMITIVE_ARRAY: u8 = 7;

const PRIM_BOOLEAN: u8 = 1;
const PRIM_BYTE: u8 = 2;
const PRIM_INT16: u8 = 7;
const PRIM_INT32: u8 = 8;
const PRIM_INT64: u8 = 9;
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

#[derive(Debug, Clone, Copy)]
enum PrimKind {
    Bool,
    Byte,
    Int16,
    Int32,
    Int64,
    Single,
}

#[derive(Debug, Clone)]
enum MemberKind {
    Prim(PrimKind),
    String,
    /// SystemClass / arrays — stored as JSON value; patched via [`PatchSite`] when possible.
    Complex,
}

#[derive(Debug, Clone)]
struct MemberMeta {
    name: String,
    kind: MemberKind,
}

#[derive(Debug, Clone)]
enum PatchSite {
    Prim {
        name: String,
        offset: usize,
        kind: PrimKind,
    },
    Array {
        name: String,
        data_offset: usize,
        len: usize,
        kind: PrimKind,
    },
}

#[derive(Debug, Clone)]
pub struct NrbfDocument {
    /// Original bytes (graph writer patches in place).
    original: Vec<u8>,
    /// Flat rewrite prefix (through LibraryId); empty for graph docs.
    prefix: Vec<u8>,
    members: Vec<MemberMeta>,
    values: BTreeMap<String, Value>,
    sites: Vec<PatchSite>,
    flat: bool,
}

impl NrbfDocument {
    pub fn to_json(&self) -> Value {
        Value::Object(
            self.values
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        )
    }

    pub fn write_bytes(&self) -> Result<Vec<u8>, AppError> {
        if self.flat {
            return self.write_flat();
        }
        self.write_graph_inplace()
    }

    fn write_flat(&self) -> Result<Vec<u8>, AppError> {
        let mut out = self.prefix.clone();
        let mut next_string_id = 100i32;
        for meta in &self.members {
            let val = self
                .values
                .get(&meta.name)
                .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
            match &meta.kind {
                MemberKind::Prim(PrimKind::Bool) => {
                    let b = match val {
                        Value::Bool(v) => *v,
                        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    out.push(u8::from(b));
                }
                MemberKind::Prim(PrimKind::Int32) => {
                    let n = match val {
                        Value::Number(num) => num
                            .as_i64()
                            .or_else(|| num.as_u64().map(|u| u as i64))
                            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?,
                        Value::Bool(b) => i64::from(*b),
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    if !(i32::MIN as i64..=i32::MAX as i64).contains(&n) {
                        return Err(AppError::keyed("error.saveEditor.patchType"));
                    }
                    out.extend_from_slice(&(n as i32).to_le_bytes());
                }
                MemberKind::Prim(PrimKind::Int16) => {
                    let n = match val {
                        Value::Number(num) => num
                            .as_i64()
                            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?,
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    if !(i16::MIN as i64..=i16::MAX as i64).contains(&n) {
                        return Err(AppError::keyed("error.saveEditor.patchType"));
                    }
                    out.extend_from_slice(&(n as i16).to_le_bytes());
                }
                MemberKind::Prim(PrimKind::Single) => {
                    let f = match val {
                        Value::Number(num) => num
                            .as_f64()
                            .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?
                            as f32,
                        _ => return Err(AppError::keyed("error.saveEditor.patchType")),
                    };
                    out.extend_from_slice(&f.to_le_bytes());
                }
                MemberKind::Prim(_) => return Err(AppError::keyed("error.saveEditor.patchType")),
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
                MemberKind::Complex => return Err(AppError::keyed("error.saveEditor.patchType")),
            }
        }
        out.push(RECORD_MESSAGE_END);
        Ok(out)
    }

    fn write_graph_inplace(&self) -> Result<Vec<u8>, AppError> {
        let mut out = self.original.clone();
        for site in &self.sites {
            match site {
                PatchSite::Prim { name, offset, kind } => {
                    let val = self
                        .values
                        .get(name)
                        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
                    write_prim_at(&mut out, *offset, *kind, val)?;
                }
                PatchSite::Array {
                    name,
                    data_offset,
                    len,
                    kind,
                } => {
                    let val = self
                        .values
                        .get(name)
                        .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
                    let arr = val
                        .as_array()
                        .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
                    if arr.len() != *len {
                        return Err(AppError::keyed("error.saveEditor.patchType"));
                    }
                    let step = prim_size(*kind);
                    for (i, elem) in arr.iter().enumerate() {
                        write_prim_at(&mut out, data_offset + i * step, *kind, elem)?;
                    }
                }
            }
        }
        Ok(out)
    }
}

fn prim_size(kind: PrimKind) -> usize {
    match kind {
        PrimKind::Bool | PrimKind::Byte => 1,
        PrimKind::Int16 => 2,
        PrimKind::Int32 | PrimKind::Single => 4,
        PrimKind::Int64 => 8,
    }
}

fn write_prim_at(buf: &mut [u8], offset: usize, kind: PrimKind, val: &Value) -> Result<(), AppError> {
    let need = prim_size(kind);
    if offset + need > buf.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    match kind {
        PrimKind::Bool => {
            let b = match val {
                Value::Bool(v) => *v,
                Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
                _ => return Err(AppError::keyed("error.saveEditor.patchType")),
            };
            buf[offset] = u8::from(b);
        }
        PrimKind::Byte => {
            let n = val
                .as_u64()
                .or_else(|| val.as_i64().map(|i| i as u64))
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
            if n > 255 {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            buf[offset] = n as u8;
        }
        PrimKind::Int16 => {
            let n = val
                .as_i64()
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
            if !(i16::MIN as i64..=i16::MAX as i64).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            buf[offset..offset + 2].copy_from_slice(&(n as i16).to_le_bytes());
        }
        PrimKind::Int32 => {
            let n = val
                .as_i64()
                .or_else(|| val.as_u64().map(|u| u as i64))
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
            if !(i32::MIN as i64..=i32::MAX as i64).contains(&n) {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            }
            buf[offset..offset + 4].copy_from_slice(&(n as i32).to_le_bytes());
        }
        PrimKind::Int64 => {
            let n = val
                .as_i64()
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
            buf[offset..offset + 8].copy_from_slice(&n.to_le_bytes());
        }
        PrimKind::Single => {
            let f = val
                .as_f64()
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))? as f32;
            buf[offset..offset + 4].copy_from_slice(&f.to_le_bytes());
        }
    }
    Ok(())
}

fn prim_from_code(code: u8) -> Result<PrimKind, AppError> {
    match code {
        PRIM_BOOLEAN => Ok(PrimKind::Bool),
        PRIM_BYTE => Ok(PrimKind::Byte),
        PRIM_INT16 => Ok(PrimKind::Int16),
        PRIM_INT32 => Ok(PrimKind::Int32),
        PRIM_INT64 => Ok(PrimKind::Int64),
        PRIM_SINGLE => Ok(PrimKind::Single),
        _ => Err(AppError::keyed("error.saveEditor.parse")),
    }
}

#[derive(Clone)]
struct ClassMeta {
    names: Vec<String>,
    bin_types: Vec<u8>,
    extras: Vec<MemberExtra>,
}

#[derive(Clone)]
enum MemberExtra {
    None,
    Prim(u8),
    #[allow(dead_code)]
    SystemClass(String),
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    class_metas: BTreeMap<i32, ClassMeta>,
    objects: BTreeMap<i32, Value>,
    /// object id -> (data_offset, len, prim) for ArraySinglePrimitive
    arrays: BTreeMap<i32, (usize, usize, PrimKind)>,
    /// root field name -> array patch info (PrimitiveArray / List`1 items)
    root_array_link: BTreeMap<String, (usize, usize, PrimKind)>,
    /// root complex fields that were MemberReference — resolved after trailing graph
    pending_root_refs: BTreeMap<String, i32>,
}

impl<'a> Parser<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            pos: 0,
            class_metas: BTreeMap::new(),
            objects: BTreeMap::new(),
            arrays: BTreeMap::new(),
            root_array_link: BTreeMap::new(),
            pending_root_refs: BTreeMap::new(),
        }
    }

    fn parse(mut self) -> Result<NrbfDocument, AppError> {
        if !looks_like_nrbf(self.bytes) {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let header_ty = self.read_u8()?;
        if header_ty != RECORD_SERIALIZED_STREAM_HEADER {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        self.pos += 16;

        // BinaryLibrary (optional but present in our saves)
        let ty = self.read_u8()?;
        if ty != RECORD_BINARY_LIBRARY {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let _lib_id = self.read_i32()?;
        let _lib_name = self.read_lps()?;

        let class_ty = self.read_u8()?;
        if class_ty != RECORD_CLASS_WITH_MEMBERS_AND_TYPES {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let (root_oid, root_meta) = self.read_class_meta(false)?;
        self.class_metas.insert(root_oid, root_meta.clone());
        let prefix_end = self.pos;

        let mut members = Vec::new();
        let mut values = BTreeMap::new();
        let mut sites = Vec::new();
        let mut any_complex = false;

        for (i, name) in root_meta.names.iter().enumerate() {
            let bt = root_meta.bin_types[i];
            let extra = &root_meta.extras[i];
            match bt {
                BINARY_TYPE_PRIMITIVE => {
                    let code = match extra {
                        MemberExtra::Prim(c) => *c,
                        _ => return Err(AppError::keyed("error.saveEditor.parse")),
                    };
                    let kind = prim_from_code(code)?;
                    let offset = self.pos;
                    let val = self.read_prim_value(kind)?;
                    sites.push(PatchSite::Prim {
                        name: name.clone(),
                        offset,
                        kind,
                    });
                    members.push(MemberMeta {
                        name: name.clone(),
                        kind: MemberKind::Prim(kind),
                    });
                    values.insert(name.clone(), val);
                }
                BINARY_TYPE_STRING => {
                    let offset = self.pos;
                    let val = self.read_string_value()?;
                    // flat string write only when no complex members overall
                    members.push(MemberMeta {
                        name: name.clone(),
                        kind: MemberKind::String,
                    });
                    let _ = offset;
                    values.insert(name.clone(), val);
                }
                _ => {
                    any_complex = true;
                    let start_pos = self.pos;
                    let val = self.read_member_record()?;
                    if self.bytes.get(start_pos) == Some(&RECORD_MEMBER_REFERENCE) {
                        if let Some(id) = val
                            .as_object()
                            .and_then(|m| m.get("$ref"))
                            .and_then(|v| v.as_i64())
                        {
                            self.pending_root_refs.insert(name.clone(), id as i32);
                        }
                    } else if let Value::Array(arr) = &val {
                        // Inline ArraySinglePrimitive (rare) — match by length in arrays map
                        if let Some((&oid, &(off, len, kind))) = self
                            .arrays
                            .iter()
                            .find(|(_, &(_, len, _))| len == arr.len())
                        {
                            let _ = oid;
                            self.root_array_link.insert(name.clone(), (off, len, kind));
                        }
                    }
                    members.push(MemberMeta {
                        name: name.clone(),
                        kind: MemberKind::Complex,
                    });
                    values.insert(name.clone(), val);
                }
            }
        }

        // Trailing object graph
        while self.pos < self.bytes.len() {
            if self.bytes[self.pos] == RECORD_MESSAGE_END {
                self.pos += 1;
                break;
            }
            let (val, oid) = self.read_object_record()?;
            if let Some(id) = oid {
                self.objects.insert(id, val);
            }
        }

        for (name, id) in &self.pending_root_refs {
            // List`1 -> follow to _items array id if present
            if let Some(obj) = self.objects.get(id) {
                if let Some(items) = obj.get("_items") {
                    if let Some(aid) = items
                        .as_object()
                        .and_then(|m| m.get("$ref"))
                        .and_then(|v| v.as_i64())
                    {
                        if let Some(info) = self.arrays.get(&(aid as i32)).copied() {
                            self.root_array_link.insert(name.clone(), info);
                            continue;
                        }
                    }
                }
            }
            if let Some(info) = self.arrays.get(id).copied() {
                self.root_array_link.insert(name.clone(), info);
            }
        }

        // Resolve refs + collapse List`1
        let resolved: BTreeMap<String, Value> = values
            .into_iter()
            .map(|(k, v)| (k, resolve_value(&v, &self.objects)))
            .collect();

        // Attach array patch sites when a root field resolves to an ArraySinglePrimitive
        for (name, val) in &resolved {
            if let Some(&(data_offset, len, kind)) = self.root_array_link.get(name) {
                if val.as_array().map(|a| a.len()) == Some(len) {
                    sites.push(PatchSite::Array {
                        name: name.clone(),
                        data_offset,
                        len,
                        kind,
                    });
                } else if let Some(arr) = val.as_array() {
                    // List truncated to _size — still patch first arr.len() elements
                    if arr.len() <= len {
                        sites.push(PatchSite::Array {
                            name: name.clone(),
                            data_offset,
                            len: arr.len(),
                            kind,
                        });
                    }
                }
            }
        }

        let flat = !any_complex
            && members
                .iter()
                .all(|m| !matches!(m.kind, MemberKind::Complex));

        Ok(NrbfDocument {
            original: self.bytes.to_vec(),
            prefix: if flat {
                self.bytes[..prefix_end].to_vec()
            } else {
                Vec::new()
            },
            members,
            values: resolved,
            sites,
            flat,
        })
    }

    fn read_class_meta(&mut self, system: bool) -> Result<(i32, ClassMeta), AppError> {
        let oid = self.read_i32()?;
        let _cname = self.read_lps()?;
        let count = self.read_i32()?;
        if count < 0 || count > 10_000 {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let count = count as usize;
        let mut names = Vec::with_capacity(count);
        for _ in 0..count {
            names.push(self.read_lps()?);
        }
        let mut bin_types = Vec::with_capacity(count);
        for _ in 0..count {
            bin_types.push(self.read_u8()?);
        }
        let mut extras = Vec::with_capacity(count);
        for bt in &bin_types {
            match *bt {
                BINARY_TYPE_PRIMITIVE | BINARY_TYPE_PRIMITIVE_ARRAY => {
                    extras.push(MemberExtra::Prim(self.read_u8()?));
                }
                BINARY_TYPE_SYSTEM_CLASS => {
                    extras.push(MemberExtra::SystemClass(self.read_lps()?));
                }
                BINARY_TYPE_STRING
                | BINARY_TYPE_OBJECT_ARRAY
                | BINARY_TYPE_STRING_ARRAY => {
                    extras.push(MemberExtra::None);
                }
                _ => return Err(AppError::keyed("error.saveEditor.parse")),
            }
        }
        if !system {
            let _library_id = self.read_i32()?;
        }
        Ok((
            oid,
            ClassMeta {
                names,
                bin_types,
                extras,
            },
        ))
    }

    fn read_member_record(&mut self) -> Result<Value, AppError> {
        let (val, oid) = self.read_object_record()?;
        if let Some(id) = oid {
            self.objects.insert(id, val.clone());
        }
        Ok(val)
    }

    fn read_object_record(&mut self) -> Result<(Value, Option<i32>), AppError> {
        let rt = self.read_u8()?;
        match rt {
            RECORD_MEMBER_REFERENCE => {
                let id = self.read_i32()?;
                Ok((Value::Object(Map::from_iter([(
                    "$ref".into(),
                    Value::from(id),
                )])), None))
            }
            RECORD_OBJECT_NULL => Ok((Value::Null, None)),
            RECORD_BINARY_OBJECT_STRING => {
                let oid = self.read_i32()?;
                let s = self.read_lps()?;
                Ok((Value::String(s), Some(oid)))
            }
            RECORD_ARRAY_SINGLE_PRIMITIVE => {
                let oid = self.read_i32()?;
                let len = self.read_i32()?;
                if len < 0 || len > 1_000_000 {
                    return Err(AppError::keyed("error.saveEditor.parse"));
                }
                let len = len as usize;
                let pt = self.read_u8()?;
                let kind = prim_from_code(pt)?;
                let data_offset = self.pos;
                let mut vals = Vec::with_capacity(len);
                for _ in 0..len {
                    vals.push(self.read_prim_value(kind)?);
                }
                self.arrays.insert(oid, (data_offset, len, kind));
                Ok((Value::Array(vals), Some(oid)))
            }
            RECORD_ARRAY_SINGLE_STRING => {
                let oid = self.read_i32()?;
                let len = self.read_i32()?;
                if len < 0 || len > 1_000_000 {
                    return Err(AppError::keyed("error.saveEditor.parse"));
                }
                let mut left = len;
                let mut vals = Vec::new();
                while left > 0 {
                    let r = self.read_u8()?;
                    match r {
                        RECORD_OBJECT_NULL => {
                            vals.push(Value::Null);
                            left -= 1;
                        }
                        RECORD_BINARY_OBJECT_STRING => {
                            let sid = self.read_i32()?;
                            let s = self.read_lps()?;
                            self.objects.insert(sid, Value::String(s.clone()));
                            vals.push(Value::String(s));
                            left -= 1;
                        }
                        RECORD_OBJECT_NULL_MULTIPLE_256 => {
                            let c = self.read_u8()? as i32;
                            for _ in 0..c {
                                vals.push(Value::Null);
                            }
                            left -= c;
                        }
                        RECORD_MEMBER_REFERENCE => {
                            let id = self.read_i32()?;
                            vals.push(Value::Object(Map::from_iter([(
                                "$ref".into(),
                                Value::from(id),
                            )])));
                            left -= 1;
                        }
                        _ => return Err(AppError::keyed("error.saveEditor.parse")),
                    }
                }
                Ok((Value::Array(vals), Some(oid)))
            }
            RECORD_SYSTEM_CLASS_WITH_MEMBERS_AND_TYPES => {
                let (oid, meta) = self.read_class_meta(true)?;
                self.class_metas.insert(oid, meta.clone());
                let obj = self.read_class_members(&meta)?;
                Ok((obj, Some(oid)))
            }
            RECORD_CLASS_WITH_MEMBERS_AND_TYPES => {
                let (oid, meta) = self.read_class_meta(false)?;
                self.class_metas.insert(oid, meta.clone());
                let obj = self.read_class_members(&meta)?;
                Ok((obj, Some(oid)))
            }
            RECORD_CLASS_WITH_ID => {
                let oid = self.read_i32()?;
                let meta_id = self.read_i32()?;
                let meta = self
                    .class_metas
                    .get(&meta_id)
                    .cloned()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let obj = self.read_class_members(&meta)?;
                Ok((obj, Some(oid)))
            }
            _ => Err(AppError::keyed("error.saveEditor.parse")),
        }
    }

    fn read_class_members(&mut self, meta: &ClassMeta) -> Result<Value, AppError> {
        let mut map = Map::new();
        for (i, name) in meta.names.iter().enumerate() {
            let bt = meta.bin_types[i];
            let extra = &meta.extras[i];
            let val = match bt {
                BINARY_TYPE_PRIMITIVE => {
                    let code = match extra {
                        MemberExtra::Prim(c) => *c,
                        _ => return Err(AppError::keyed("error.saveEditor.parse")),
                    };
                    self.read_prim_value(prim_from_code(code)?)?
                }
                _ => self.read_member_record()?,
            };
            map.insert(name.clone(), val);
        }
        Ok(Value::Object(map))
    }

    fn read_prim_value(&mut self, kind: PrimKind) -> Result<Value, AppError> {
        match kind {
            PrimKind::Bool => Ok(Value::Bool(self.read_u8()? != 0)),
            PrimKind::Byte => Ok(Value::from(self.read_u8()? as i64)),
            PrimKind::Int16 => Ok(Value::from(self.read_i16()? as i64)),
            PrimKind::Int32 => Ok(Value::from(self.read_i32()? as i64)),
            PrimKind::Int64 => Ok(Value::from(self.read_i64()?)),
            PrimKind::Single => Ok(Value::from(self.read_f32()? as f64)),
        }
    }

    fn read_string_value(&mut self) -> Result<Value, AppError> {
        let rt = self.read_u8()?;
        match rt {
            RECORD_OBJECT_NULL => Ok(Value::Null),
            RECORD_BINARY_OBJECT_STRING => {
                let oid = self.read_i32()?;
                let s = self.read_lps()?;
                self.objects.insert(oid, Value::String(s.clone()));
                Ok(Value::String(s))
            }
            RECORD_MEMBER_REFERENCE => {
                let id = self.read_i32()?;
                Ok(Value::Object(Map::from_iter([(
                    "$ref".into(),
                    Value::from(id),
                )])))
            }
            _ => Err(AppError::keyed("error.saveEditor.parse")),
        }
    }

    fn read_u8(&mut self) -> Result<u8, AppError> {
        read_u8(self.bytes, &mut self.pos)
    }
    fn read_i16(&mut self) -> Result<i16, AppError> {
        if self.pos + 2 > self.bytes.len() {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let v = i16::from_le_bytes(self.bytes[self.pos..self.pos + 2].try_into().unwrap());
        self.pos += 2;
        Ok(v)
    }
    fn read_i32(&mut self) -> Result<i32, AppError> {
        read_i32(self.bytes, &mut self.pos)
    }
    fn read_i64(&mut self) -> Result<i64, AppError> {
        if self.pos + 8 > self.bytes.len() {
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        let v = i64::from_le_bytes(self.bytes[self.pos..self.pos + 8].try_into().unwrap());
        self.pos += 8;
        Ok(v)
    }
    fn read_f32(&mut self) -> Result<f32, AppError> {
        read_f32(self.bytes, &mut self.pos)
    }
    fn read_lps(&mut self) -> Result<String, AppError> {
        read_lps(self.bytes, &mut self.pos)
    }
}

fn resolve_value(val: &Value, objects: &BTreeMap<i32, Value>) -> Value {
    match val {
        Value::Object(map) if map.len() == 1 && map.contains_key("$ref") => {
            if let Some(id) = map.get("$ref").and_then(|v| v.as_i64()) {
                if let Some(target) = objects.get(&(id as i32)) {
                    return collapse_list(resolve_value(target, objects));
                }
            }
            val.clone()
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                out.insert(k.clone(), resolve_value(v, objects));
            }
            collapse_list(Value::Object(out))
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|v| resolve_value(v, objects)).collect())
        }
        other => other.clone(),
    }
}

fn collapse_list(val: Value) -> Value {
    let Value::Object(map) = &val else {
        return val;
    };
    if let (Some(items), Some(size)) = (map.get("_items"), map.get("_size")) {
        if let (Some(arr), Some(n)) = (items.as_array(), size.as_i64()) {
            let n = n.clamp(0, arr.len() as i64) as usize;
            return Value::Array(arr[..n].to_vec());
        }
    }
    val
}

pub fn parse_nrbf(bytes: &[u8]) -> Result<NrbfDocument, AppError> {
    Parser::new(bytes).parse()
}

pub fn parse_nrbf_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    Ok(parse_nrbf(bytes)?.to_json())
}

pub fn write_nrbf_with_json(original: &[u8], value: &Value) -> Result<Vec<u8>, AppError> {
    let mut doc = parse_nrbf(original)?;
    let Value::Object(map) = value else {
        return Err(AppError::keyed("error.saveEditor.patchType"));
    };
    for (k, v) in map {
        if doc.values.contains_key(k) {
            doc.values.insert(k.clone(), v.clone());
        }
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

    fn twist_path() -> Option<PathBuf> {
        let profile = std::env::var_os("USERPROFILE")?;
        let p = PathBuf::from(profile)
            .join("AppData")
            .join("LocalLow")
            .join("KsTgames")
            .join("The Twist")
            .join("playerInfo.dat");
        p.is_file().then_some(p)
    }

    fn ntr_path(name: &str) -> Option<PathBuf> {
        let profile = std::env::var_os("USERPROFILE")?;
        let p = PathBuf::from(profile)
            .join("AppData")
            .join("LocalLow")
            .join("TiramisuLovesNtr")
            .join("Ntraholic")
            .join(name);
        p.is_file().then_some(p)
    }

    #[test]
    fn rejects_non_nrbf() {
        assert!(!looks_like_nrbf(b"{}"));
        assert!(parse_nrbf(b"not nrbf").is_err());
    }

    #[test]
    fn parses_the_twist_player_info_if_present() {
        let Some(path) = twist_path() else {
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
        let Some(path) = twist_path() else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        let json = parse_nrbf_to_json(&bytes).unwrap();
        let mut patched = json.clone();
        patched
            .as_object_mut()
            .unwrap()
            .insert("money".into(), Value::from(12345));
        let written = write_nrbf_with_json(&bytes, &patched).unwrap();
        let again = parse_nrbf_to_json(&written).unwrap();
        assert_eq!(again.get("money"), Some(&Value::from(12345)));
        assert_eq!(again.get("dayname").and_then(|v| v.as_str()), Some("Monday"));
    }

    #[test]
    fn parses_ntraholic_save_manager_if_present() {
        let Some(path) = ntr_path("ntr1.dontdeletethisdata") else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        assert!(looks_like_nrbf(&bytes));
        let json = parse_nrbf_to_json(&bytes).unwrap();
        let obj = json.as_object().unwrap();
        assert_eq!(obj.get("money"), Some(&Value::from(1000)));
        assert_eq!(obj.get("stamina"), Some(&Value::from(100)));
        let items = obj.get("items").and_then(|v| v.as_array()).unwrap();
        assert_eq!(items.len(), 15);
        assert_eq!(items[0], Value::from(1));
    }

    #[test]
    fn patches_ntraholic_money_inplace_if_present() {
        let Some(path) = ntr_path("ntr1.dontdeletethisdata") else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        let json = parse_nrbf_to_json(&bytes).unwrap();
        let mut patched = json.clone();
        patched
            .as_object_mut()
            .unwrap()
            .insert("money".into(), Value::from(7777));
        let written = write_nrbf_with_json(&bytes, &patched).unwrap();
        let again = parse_nrbf_to_json(&written).unwrap();
        assert_eq!(again.get("money"), Some(&Value::from(7777)));
        assert_eq!(again.get("stamina"), Some(&Value::from(100)));
    }

    #[test]
    fn patches_ntraholic_items_inplace_if_present() {
        let Some(path) = ntr_path("ntr1.dontdeletethisdata") else {
            return;
        };
        let bytes = fs::read(&path).unwrap();
        let json = parse_nrbf_to_json(&bytes).unwrap();
        let mut patched = json.clone();
        let items = patched
            .as_object_mut()
            .unwrap()
            .get_mut("items")
            .unwrap()
            .as_array_mut()
            .unwrap();
        items[0] = Value::from(42);
        let written = write_nrbf_with_json(&bytes, &patched).unwrap();
        let again = parse_nrbf_to_json(&written).unwrap();
        let items = again.get("items").and_then(|v| v.as_array()).unwrap();
        assert_eq!(items[0], Value::from(42));
        assert_eq!(again.get("money"), Some(&Value::from(1000)));
    }
}
