//! Surgical primitive patches inside Ren'Py `log` pickle bytes.
//!
//! Full re-serialization (serde-pickle `value_to_vec`) drops class `GLOBAL` /
//! `NEWOBJ` / `BUILD` structure and may bump the pickle protocol — both break
//! Ren'Py 7 loads. Instead we locate each leaf's byte span in the original
//! stream and splice a same-type encoding in place.

use crate::error::AppError;
use crate::save_editor::pickle_tree::{parse_path_segments, PathSegment};
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;

// Pickle opcodes we need (serde-pickle `consts` is private).
const MARK: u8 = b'(';
const STOP: u8 = b'.';
const BINFLOAT: u8 = b'G';
const BININT: u8 = b'J';
const BININT1: u8 = b'K';
const BININT2: u8 = b'M';
const NONE: u8 = b'N';
const SHORT_BINSTRING: u8 = b'U';
const BINSTRING: u8 = b'T';
const BINUNICODE: u8 = b'X';
const APPEND: u8 = b'a';
const EMPTY_DICT: u8 = b'}';
const APPENDS: u8 = b'e';
const EMPTY_LIST: u8 = b']';
const SETITEM: u8 = b's';
const EMPTY_TUPLE: u8 = b')';
const SETITEMS: u8 = b'u';
const BINPUT: u8 = b'q';
const LONG_BINPUT: u8 = b'r';
const BINGET: u8 = b'h';
const LONG_BINGET: u8 = b'j';
const GLOBAL: u8 = b'c';
const REDUCE: u8 = b'R';
const PROTO: u8 = 0x80;
const TUPLE1: u8 = 0x85;
const TUPLE2: u8 = 0x86;
const TUPLE3: u8 = 0x87;
const NEWTRUE: u8 = 0x88;
const NEWFALSE: u8 = 0x89;
const LONG1: u8 = 0x8a;
const LONG4: u8 = 0x8b;
const SHORT_BINUNICODE: u8 = 0x8c;
const NEWOBJ: u8 = 0x81;
const BUILD: u8 = b'b';
const EMPTY_SET: u8 = 0x8f;
const ADDITEMS: u8 = 0x90;
const FROZENSET: u8 = 0x91;
const NEWOBJ_EX: u8 = 0x92;
const STACK_GLOBAL: u8 = 0x93;
const MEMOIZE: u8 = 0x94;
const FRAME: u8 = 0x95;
const BINBYTES: u8 = b'B';
const SHORT_BINBYTES: u8 = b'C';
const TUPLE: u8 = b't';
const LIST: u8 = b'l';
const DICT: u8 = b'd';
const DUP: u8 = b'2';
const POP: u8 = b'0';
const POP_MARK: u8 = b'1';
const FLOAT: u8 = b'F';
const INT: u8 = b'I';
const LONG: u8 = b'L';
const STRING: u8 = b'S';
const UNICODE: u8 = b'V';
const PUT: u8 = b'p';
const GET: u8 = b'g';
const INST: u8 = b'i';
const OBJ: u8 = b'o';

#[derive(Clone, Debug)]
struct Spanned {
    /// Inclusive start / exclusive end of this value's encoding in the pickle.
    start: usize,
    end: usize,
    kind: Kind,
}

#[derive(Clone, Debug)]
enum Kind {
    /// Dict keyed by display names (String / UTF-8 Bytes / int / bool text).
    Dict(BTreeMap<String, Spanned>),
    List(Vec<Spanned>),
    Tuple(Vec<Spanned>),
    /// Leaf primitive (or opaque). `label` set for string/bytes keys.
    Atom { label: Option<String> },
}

/// Offset of a PROTO 4+ `FRAME` size field (8-byte LE after the opcode).
struct FrameInfo {
    size_offset: usize,
}

/// Apply validated primitive encodings by splicing into `log`.
///
/// `patches` are `(path, json_value)` after type checks in `apply_patches`.
pub fn splice_primitives(log: &[u8], patches: &[(String, JsonValue)]) -> Result<Vec<u8>, AppError> {
    if patches.is_empty() {
        return Ok(log.to_vec());
    }

    let (root, mut frames) = index_pickle(log)?;
    let mut spans: Vec<(usize, usize, Vec<u8>)> = Vec::with_capacity(patches.len());

    for (path, value) in patches {
        let segments = parse_path_segments(path)?;
        let leaf = navigate_spanned(&root, &segments)?;
        let old = &log[leaf.start..leaf.end];
        let encoded = encode_primitive(old, value)?;
        spans.push((leaf.start, leaf.end, encoded));
    }

    // Apply from the end so earlier offsets stay valid.
    spans.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = log.to_vec();
    for (start, end, encoded) in spans {
        let delta = encoded.len() as i64 - (end - start) as i64;
        out.splice(start..end, encoded);
        if delta == 0 {
            continue;
        }
        // PROTO 5 FRAME sizes must match payload length or Unpickler aborts.
        for frame in &mut frames {
            if start < frame.size_offset {
                frame.size_offset = (frame.size_offset as i64 + delta) as usize;
                continue;
            }
            let size = read_u64_le(&out, frame.size_offset)?;
            let payload_start = frame.size_offset + 8;
            let payload_end = payload_start
                .checked_add(size as usize)
                .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
            if start >= payload_start && start < payload_end {
                let new_size = (size as i64 + delta) as u64;
                write_u64_le(&mut out, frame.size_offset, new_size)?;
            }
        }
    }
    Ok(out)
}

fn navigate_spanned<'a>(root: &'a Spanned, segments: &[PathSegment]) -> Result<&'a Spanned, AppError> {
    let mut cur = root;
    for seg in segments {
        if !seg.key.is_empty() {
            let Kind::Dict(map) = &cur.kind else {
                return Err(AppError::keyed("error.saveEditor.patchMissing"));
            };
            cur = map
                .get(&seg.key)
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
        }
        for &idx in &seg.indices {
            let Kind::List(items) = &cur.kind else {
                return Err(AppError::keyed("error.saveEditor.patchMissing"));
            };
            cur = items
                .get(idx)
                .ok_or_else(|| AppError::keyed("error.saveEditor.patchMissing"))?;
        }
    }
    Ok(cur)
}

fn index_pickle(data: &[u8]) -> Result<(Spanned, Vec<FrameInfo>), AppError> {
    let mut pos = 0usize;
    let mut stack: Vec<Spanned> = Vec::new();
    let mut marks: Vec<usize> = Vec::new();
    let mut memo: BTreeMap<u32, Spanned> = BTreeMap::new();
    let mut frames: Vec<FrameInfo> = Vec::new();

    while pos < data.len() {
        let op_start = pos;
        let op = data[pos];
        pos += 1;

        match op {
            PROTO => {
                pos = pos.saturating_add(1);
            }
            STOP => {
                break;
            }
            MARK => {
                marks.push(stack.len());
            }
            NONE => {
                stack.push(atom(op_start, pos, None));
            }
            NEWTRUE | NEWFALSE => {
                stack.push(atom(op_start, pos, None));
            }
            BININT1 => {
                pos = need(data, pos, 1)?;
                stack.push(atom(op_start, pos, None));
            }
            BININT2 => {
                pos = need(data, pos, 2)?;
                stack.push(atom(op_start, pos, None));
            }
            BININT => {
                pos = need(data, pos, 4)?;
                stack.push(atom(op_start, pos, None));
            }
            BINFLOAT => {
                pos = need(data, pos, 8)?;
                stack.push(atom(op_start, pos, None));
            }
            LONG1 => {
                let n = *data
                    .get(pos)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))? as usize;
                pos += 1;
                pos = need(data, pos, n)?;
                stack.push(atom(op_start, pos, None));
            }
            LONG4 => {
                let n = read_u32(data, pos)? as usize;
                pos += 4;
                pos = need(data, pos, n)?;
                stack.push(atom(op_start, pos, None));
            }
            SHORT_BINSTRING | SHORT_BINBYTES | SHORT_BINUNICODE => {
                let n = *data
                    .get(pos)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))? as usize;
                pos += 1;
                let start_s = pos;
                pos = need(data, pos, n)?;
                let label = string_label(&data[start_s..pos]);
                stack.push(atom(op_start, pos, label));
            }
            BINSTRING | BINUNICODE | BINBYTES => {
                let n = read_u32(data, pos)? as usize;
                pos += 4;
                let start_s = pos;
                pos = need(data, pos, n)?;
                let label = string_label(&data[start_s..pos]);
                stack.push(atom(op_start, pos, label));
            }
            EMPTY_DICT => {
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::Dict(BTreeMap::new()),
                });
            }
            EMPTY_LIST => {
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::List(Vec::new()),
                });
            }
            EMPTY_TUPLE => {
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::Tuple(Vec::new()),
                });
            }
            EMPTY_SET => {
                stack.push(atom(op_start, pos, None));
            }
            BINPUT => {
                let id = *data
                    .get(pos)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))? as u32;
                pos += 1;
                if let Some(top) = stack.last() {
                    memo.insert(id, top.clone());
                }
            }
            LONG_BINPUT => {
                let id = read_u32(data, pos)?;
                pos += 4;
                if let Some(top) = stack.last() {
                    memo.insert(id, top.clone());
                }
            }
            MEMOIZE => {
                let id = memo.len() as u32;
                if let Some(top) = stack.last() {
                    memo.insert(id, top.clone());
                }
            }
            BINGET => {
                let id = *data
                    .get(pos)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))? as u32;
                pos += 1;
                let item = memo
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| atom(op_start, pos, None));
                stack.push(item);
            }
            LONG_BINGET => {
                let id = read_u32(data, pos)?;
                pos += 4;
                let item = memo
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| atom(op_start, pos, None));
                stack.push(item);
            }
            GET => {
                let (idx, next) = read_line_usize(data, pos)?;
                pos = next;
                let item = memo
                    .get(&(idx as u32))
                    .cloned()
                    .unwrap_or_else(|| atom(op_start, pos, None));
                stack.push(item);
            }
            PUT => {
                let (idx, next) = read_line_usize(data, pos)?;
                pos = next;
                if let Some(top) = stack.last() {
                    memo.insert(idx as u32, top.clone());
                }
            }
            SETITEM => {
                let value = pop(&mut stack)?;
                let key = pop(&mut stack)?;
                let dict = stack
                    .last_mut()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                dict_insert(dict, &key, value)?;
                dict.end = pos;
            }
            SETITEMS => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let mut items = stack.split_off(mark);
                if items.len() % 2 != 0 {
                    return Err(AppError::keyed("error.saveEditor.parse"));
                }
                let dict = stack
                    .last_mut()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                while !items.is_empty() {
                    let value = items.pop().unwrap();
                    let key = items.pop().unwrap();
                    dict_insert(dict, &key, value)?;
                }
                dict.end = pos;
            }
            APPEND => {
                let value = pop(&mut stack)?;
                let list = stack
                    .last_mut()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                if let Kind::List(items) = &mut list.kind {
                    items.push(value);
                    list.end = pos;
                } else {
                    // APPEND onto recovered object stand-in — treat as opaque.
                    list.kind = Kind::Atom { label: None };
                    list.end = pos;
                }
            }
            APPENDS => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let items = stack.split_off(mark);
                let list = stack
                    .last_mut()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                if let Kind::List(dst) = &mut list.kind {
                    dst.extend(items);
                    list.end = pos;
                } else {
                    list.kind = Kind::Atom { label: None };
                    list.end = pos;
                }
            }
            ADDITEMS => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let _items = stack.split_off(mark);
                if let Some(top) = stack.last_mut() {
                    top.end = pos;
                    top.kind = Kind::Atom { label: None };
                }
            }
            TUPLE1 => {
                let a = pop(&mut stack)?;
                stack.push(Spanned {
                    start: a.start,
                    end: pos,
                    kind: Kind::Tuple(vec![a]),
                });
            }
            TUPLE2 => {
                let b = pop(&mut stack)?;
                let a = pop(&mut stack)?;
                stack.push(Spanned {
                    start: a.start,
                    end: pos,
                    kind: Kind::Tuple(vec![a, b]),
                });
            }
            TUPLE3 => {
                let c = pop(&mut stack)?;
                let b = pop(&mut stack)?;
                let a = pop(&mut stack)?;
                stack.push(Spanned {
                    start: a.start,
                    end: pos,
                    kind: Kind::Tuple(vec![a, b, c]),
                });
            }
            TUPLE => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let items = stack.split_off(mark);
                let start = items.first().map(|i| i.start).unwrap_or(op_start);
                stack.push(Spanned {
                    start,
                    end: pos,
                    kind: Kind::Tuple(items),
                });
            }
            LIST => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let items = stack.split_off(mark);
                let start = items.first().map(|i| i.start).unwrap_or(op_start);
                stack.push(Spanned {
                    start,
                    end: pos,
                    kind: Kind::List(items),
                });
            }
            DICT => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let mut items = stack.split_off(mark);
                let start = items.first().map(|i| i.start).unwrap_or(op_start);
                let mut map = BTreeMap::new();
                if items.len() % 2 != 0 {
                    return Err(AppError::keyed("error.saveEditor.parse"));
                }
                while !items.is_empty() {
                    let value = items.pop().unwrap();
                    let key = items.pop().unwrap();
                    if let Some(name) = key_name(&key) {
                        map.insert(name, value);
                    }
                }
                stack.push(Spanned {
                    start,
                    end: pos,
                    kind: Kind::Dict(map),
                });
            }
            FROZENSET => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let _ = stack.split_off(mark);
                stack.push(atom(op_start, pos, None));
            }
            GLOBAL => {
                let (modname, p1) = read_line_bytes(data, pos)?;
                let (globname, p2) = read_line_bytes(data, p1)?;
                pos = p2;
                // Match serde-pickle Ren'Py patches: list/set globals must stay
                // list/set so NEWOBJ + APPEND / ADDITEMS work.
                let kind = match (modname, globname) {
                    (b"__builtin__", b"list")
                    | (b"builtins", b"list")
                    | (b"renpy.python", b"RevertableList")
                    | (b"renpy.revertable", b"RevertableList") => Kind::List(Vec::new()),
                    (b"__builtin__", b"set")
                    | (b"builtins", b"set")
                    | (b"renpy.python", b"RevertableSet")
                    | (b"renpy.revertable", b"RevertableSet")
                    | (b"__builtin__", b"frozenset")
                    | (b"builtins", b"frozenset") => Kind::Atom { label: None },
                    _ => Kind::Dict(BTreeMap::new()),
                };
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind,
                });
            }
            STACK_GLOBAL => {
                let _name = pop(&mut stack)?;
                let _module = pop(&mut stack)?;
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::Dict(BTreeMap::new()),
                });
            }
            NEWOBJ => {
                let _args = pop(&mut stack)?;
                let class = pop(&mut stack)?;
                // Preserve empty dict/list stand-ins so APPEND / BUILD work.
                let kind = match class.kind {
                    Kind::List(_) => Kind::List(Vec::new()),
                    Kind::Dict(_) => Kind::Dict(BTreeMap::new()),
                    _ => Kind::Dict(BTreeMap::new()),
                };
                stack.push(Spanned {
                    start: class.start,
                    end: pos,
                    kind,
                });
            }
            NEWOBJ_EX => {
                let _kwargs = pop(&mut stack)?;
                let _args = pop(&mut stack)?;
                let class = pop(&mut stack)?;
                stack.push(Spanned {
                    start: class.start,
                    end: pos,
                    kind: Kind::Dict(BTreeMap::new()),
                });
            }
            BUILD => {
                // Replace instance stand-in with its state (usually a dict).
                let state = pop(&mut stack)?;
                let _obj = pop(&mut stack)?;
                stack.push(state);
            }
            REDUCE => {
                let args = pop(&mut stack)?;
                let callable = pop(&mut stack)?;
                // Span covers callable + args + REDUCE so we can replace the whole form.
                let start = callable.start.min(args.start);
                stack.push(atom(start, pos, None));
            }
            INST => {
                let (_, p1) = read_line_bytes(data, pos)?;
                let (_, p2) = read_line_bytes(data, p1)?;
                pos = p2;
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let _ = stack.split_off(mark);
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::Dict(BTreeMap::new()),
                });
            }
            OBJ => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let _ = stack.split_off(mark);
                let _class = pop(&mut stack)?;
                stack.push(Spanned {
                    start: op_start,
                    end: pos,
                    kind: Kind::Dict(BTreeMap::new()),
                });
            }
            FRAME => {
                let size_offset = pos;
                pos = need(data, pos, 8)?;
                frames.push(FrameInfo { size_offset });
            }
            DUP => {
                let top = stack
                    .last()
                    .cloned()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                stack.push(top);
            }
            POP => {
                let _ = pop(&mut stack)?;
            }
            POP_MARK => {
                let mark = marks
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                stack.truncate(mark);
            }
            FLOAT | INT | LONG | STRING | UNICODE => {
                let (_, next) = read_line_bytes(data, pos)?;
                pos = next;
                stack.push(atom(op_start, pos, None));
            }
            // Unused / rare — keep parse going as opaque atoms when possible.
            other => {
                return Err(AppError::Io(format!(
                    "save editor: unsupported pickle opcode 0x{other:02x} at {op_start}"
                )));
            }
        }
    }

    let top = stack
        .pop()
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;

    // Ren'Py `log` is often (roots_dict, ...).
    let root = match top.kind {
        Kind::Tuple(mut items) if !items.is_empty() => items.remove(0),
        _ => top,
    };
    Ok((root, frames))
}

fn read_u64_le(data: &[u8], pos: usize) -> Result<u64, AppError> {
    if pos + 8 > data.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok(u64::from_le_bytes([
        data[pos],
        data[pos + 1],
        data[pos + 2],
        data[pos + 3],
        data[pos + 4],
        data[pos + 5],
        data[pos + 6],
        data[pos + 7],
    ]))
}

fn write_u64_le(data: &mut [u8], pos: usize, value: u64) -> Result<(), AppError> {
    if pos + 8 > data.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    data[pos..pos + 8].copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn atom(start: usize, end: usize, label: Option<String>) -> Spanned {
    Spanned {
        start,
        end,
        kind: Kind::Atom { label },
    }
}

fn pop(stack: &mut Vec<Spanned>) -> Result<Spanned, AppError> {
    stack
        .pop()
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))
}

fn dict_insert(dict: &mut Spanned, key: &Spanned, value: Spanned) -> Result<(), AppError> {
    let Kind::Dict(map) = &mut dict.kind else {
        // Building into non-dict (shouldn't happen for Ren'Py store); ignore.
        return Ok(());
    };
    if let Some(name) = key_name(key) {
        map.insert(name, value);
    }
    Ok(())
}

fn key_name(key: &Spanned) -> Option<String> {
    match &key.kind {
        Kind::Atom { label } => label.clone(),
        _ => None,
    }
}

fn string_label(bytes: &[u8]) -> Option<String> {
    std::str::from_utf8(bytes).ok().map(|s| s.to_string())
}

fn need(data: &[u8], pos: usize, n: usize) -> Result<usize, AppError> {
    let end = pos.checked_add(n).ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
    if end > data.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok(end)
}

fn read_u32(data: &[u8], pos: usize) -> Result<u32, AppError> {
    if pos + 4 > data.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok(u32::from_le_bytes([
        data[pos],
        data[pos + 1],
        data[pos + 2],
        data[pos + 3],
    ]))
}

fn read_line_bytes(data: &[u8], pos: usize) -> Result<(&[u8], usize), AppError> {
    let mut i = pos;
    while i < data.len() && data[i] != b'\n' {
        i += 1;
    }
    if i >= data.len() {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    Ok((&data[pos..i], i + 1))
}

fn read_line_usize(data: &[u8], pos: usize) -> Result<(usize, usize), AppError> {
    let (line, next) = read_line_bytes(data, pos)?;
    let s = std::str::from_utf8(line).map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    let n: usize = s
        .parse()
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    Ok((n, next))
}

/// Encode `value` preferring the same opcode family as `old_bytes`.
fn encode_primitive(old_bytes: &[u8], value: &JsonValue) -> Result<Vec<u8>, AppError> {
    let op = *old_bytes
        .first()
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;

    match op {
        NEWTRUE | NEWFALSE => {
            let Some(b) = value.as_bool() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(vec![if b { NEWTRUE } else { NEWFALSE }])
        }
        BININT1 | BININT2 | BININT | LONG1 | LONG4 => {
            let Some(i) = json_as_i64(value) else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(encode_int_like(op, i))
        }
        BINFLOAT => {
            let Some(f) = value.as_f64() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            let mut out = vec![BINFLOAT];
            out.extend_from_slice(&f.to_be_bytes());
            Ok(out)
        }
        SHORT_BINSTRING | BINSTRING => {
            let Some(s) = value.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(encode_binstring(s.as_bytes()))
        }
        BINUNICODE | SHORT_BINUNICODE => {
            let Some(s) = value.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(encode_binunicode(s.as_bytes()))
        }
        SHORT_BINBYTES | BINBYTES => {
            let Some(s) = value.as_str() else {
                return Err(AppError::keyed("error.saveEditor.patchType"));
            };
            Ok(encode_binbytes(s.as_bytes()))
        }
        // Proto-2 byte strings are often `_codecs.encode` + REDUCE. Replace the
        // whole form with a plain unicode string (Ren'Py accepts either).
        GLOBAL | REDUCE => match value {
            JsonValue::String(s) => Ok(encode_binunicode(s.as_bytes())),
            JsonValue::Bool(b) => Ok(vec![if *b { NEWTRUE } else { NEWFALSE }]),
            JsonValue::Number(_) => {
                let Some(i) = json_as_i64(value) else {
                    return Err(AppError::keyed("error.saveEditor.patchType"));
                };
                Ok(encode_int_like(BININT1, i))
            }
            _ => Err(AppError::keyed("error.saveEditor.patchType")),
        },
        _ => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

fn encode_binstring(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() < 256 {
        let mut out = vec![SHORT_BINSTRING, bytes.len() as u8];
        out.extend_from_slice(bytes);
        out
    } else {
        let mut out = vec![BINSTRING];
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(bytes);
        out
    }
}

fn encode_binunicode(bytes: &[u8]) -> Vec<u8> {
    // BINUNICODE is valid in protocol 2+ (Ren'Py 7). Avoid SHORT_BINUNICODE (proto 4+).
    let mut out = vec![BINUNICODE];
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    out
}

fn encode_binbytes(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() < 256 {
        let mut out = vec![SHORT_BINBYTES, bytes.len() as u8];
        out.extend_from_slice(bytes);
        out
    } else {
        let mut out = vec![BINBYTES];
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(bytes);
        out
    }
}

fn encode_int_like(old_op: u8, i: i64) -> Vec<u8> {
    // Prefer same-width encoding when the new value still fits.
    match old_op {
        BININT1 if (0..=255).contains(&i) => vec![BININT1, i as u8],
        BININT2 if (0..=65535).contains(&i) => {
            let mut out = vec![BININT2];
            out.extend_from_slice(&(i as u16).to_le_bytes());
            out
        }
        BININT if i >= i32::MIN as i64 && i <= i32::MAX as i64 => {
            let mut out = vec![BININT];
            out.extend_from_slice(&(i as i32).to_le_bytes());
            out
        }
        _ => {
            // Generic fallback — pick the smallest fitting binary int.
            if (0..=255).contains(&i) {
                vec![BININT1, i as u8]
            } else if (0..=65535).contains(&i) {
                let mut out = vec![BININT2];
                out.extend_from_slice(&(i as u16).to_le_bytes());
                out
            } else if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                let mut out = vec![BININT];
                out.extend_from_slice(&(i as i32).to_le_bytes());
                out
            } else {
                let mut out = vec![LONG1, 8];
                out.extend_from_slice(&i.to_le_bytes());
                out
            }
        }
    }
}

fn json_as_i64(v: &JsonValue) -> Option<i64> {
    match v {
        JsonValue::Number(n) => n
            .as_i64()
            .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok())),
        _ => None,
    }
}
