//! Wolf RPG `.sav` decrypt/parse, JSON tree, and patch write-back.
//!
//! VariableDatabase parsing adapted from [Prismatic](https://github.com/Patrick-Batenburg/prismatic)
//! (GPL-3.0), originally based on [WolfSave](https://github.com/Sinflower/WolfSave) (MIT).

use crate::error::AppError;
use crate::save_editor::json_tree::{apply_patches_json, json_to_tree};
use crate::save_editor::types::{RenpySavePatch, RenpyVarNode};
use crate::save_editor::wolf::crypto;
use crate::save_editor::wolf::reader::{
    skip_save_part_1, skip_save_part_2, skip_save_part_3, skip_save_part_4, skip_save_part_5,
    FileWalker,
};
use crate::save_editor::wolf::vardb::{VarField, VariableDatabase};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub const HEADER_SIZE: usize = 0x14;
pub const SAVE_MARKER: u8 = 0x19;

struct ParsedRegions {
    file_version: u16,
    vardb: VariableDatabase,
    vardb_start: usize,
    vardb_end: usize,
}

pub fn read_wolf_sav(path: &Path) -> Result<RenpyVarNode, AppError> {
    let mut buf = fs::read(path).map_err(|e| {
        AppError::Io(format!("failed to read wolf save {}: {e}", path.display()))
    })?;
    crypto::decrypt(&mut buf);
    let parsed = parse_vardb_region(&buf)?;
    Ok(json_to_tree(&vardb_to_json(
        parsed.file_version,
        &parsed.vardb,
    )))
}

pub fn write_wolf_patches(path: &Path, patches: &[RenpySavePatch]) -> Result<RenpyVarNode, AppError> {
    let mut buf = fs::read(path).map_err(|e| {
        AppError::Io(format!("failed to read wolf save {}: {e}", path.display()))
    })?;
    crypto::decrypt(&mut buf);

    let mut parsed = parse_vardb_region(&buf)?;
    let mut value = vardb_to_json(parsed.file_version, &parsed.vardb);
    apply_patches_json(&mut value, patches)?;
    apply_json_to_vardb(
        value
            .get("variableDatabase")
            .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?,
        &mut parsed.vardb,
    )?;

    let new_vardb = parsed.vardb.to_bytes();
    let tail = buf[parsed.vardb_end..].to_vec();
    buf.truncate(parsed.vardb_start);
    buf.extend_from_slice(&new_vardb);
    buf.extend_from_slice(&tail);

    buf[0x02] = crypto::checksum(&buf);
    crypto::encrypt(&mut buf);
    write_atomic(path, &buf)?;
    Ok(json_to_tree(&value))
}

fn parse_vardb_region(buf: &[u8]) -> Result<ParsedRegions, AppError> {
    let mut walker = FileWalker::new(buf);
    walker.skip(HEADER_SIZE).map_err(parse_err)?;
    let marker = walker.read_u8().map_err(parse_err)?;
    if marker != SAVE_MARKER {
        return Err(AppError::keyed("error.saveEditor.parse"));
    }
    walker.skip_memdata_u16().map_err(parse_err)?;
    let file_version = walker.read_u16_le().map_err(parse_err)?;
    walker.set_file_version(file_version);

    skip_save_part_1(&mut walker).map_err(parse_err)?;
    skip_save_part_2(&mut walker).map_err(parse_err)?;
    skip_save_part_3(&mut walker).map_err(parse_err)?;
    skip_save_part_4(&mut walker).map_err(parse_err)?;
    skip_save_part_5(&mut walker).map_err(parse_err)?;

    let vardb_start = walker.pos();
    let vardb = VariableDatabase::parse(&mut walker).map_err(parse_err)?;
    let vardb_end = walker.pos();

    Ok(ParsedRegions {
        file_version,
        vardb,
        vardb_start,
        vardb_end,
    })
}

fn vardb_to_json(file_version: u16, vardb: &VariableDatabase) -> Value {
    let types: Vec<Value> = vardb
        .types
        .iter()
        .enumerate()
        .map(|(ti, vtype)| {
            json!({
                "label": format!("Type {ti}"),
                "entries": vtype.entries.iter().enumerate().map(|(ei, entry)| {
                    json!({
                        "label": format!("Entry {ei}"),
                        "fields": entry.fields.iter().map(|field| match field {
                            VarField::Int(n) => json!(*n),
                            VarField::Str(bytes) => {
                                let s = String::from_utf8_lossy(
                                    bytes.strip_suffix(&[0]).unwrap_or(bytes),
                                );
                                json!(s)
                            }
                        }).collect::<Vec<_>>(),
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "header": {
            "fileVersion": file_version,
        },
        "variableDatabase": {
            "types": types,
        }
    })
}

fn apply_json_to_vardb(value: &Value, vardb: &mut VariableDatabase) -> Result<(), AppError> {
    let types = value
        .get("types")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;

    for (ti, type_value) in types.iter().enumerate() {
        let Some(vtype) = vardb.types.get_mut(ti) else {
            continue;
        };
        let Some(entries) = type_value.get("entries").and_then(Value::as_array) else {
            continue;
        };
        for (ei, entry_value) in entries.iter().enumerate() {
            let Some(entry) = vtype.entries.get_mut(ei) else {
                continue;
            };
            let Some(fields) = entry_value.get("fields").and_then(Value::as_array) else {
                continue;
            };
            for (fi, field_value) in fields.iter().enumerate() {
                let Some(field) = entry.fields.get_mut(fi) else {
                    continue;
                };
                match field {
                    VarField::Int(n) => {
                        *n = field_value
                            .as_i64()
                            .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?
                            as i32;
                    }
                    VarField::Str(bytes) => {
                        let s = field_value
                            .as_str()
                            .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                        let mut out = s.as_bytes().to_vec();
                        out.push(0);
                        *bytes = out;
                    }
                }
            }
        }
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".new");
    let tmp_path = Path::new(&tmp);
    fs::write(tmp_path, bytes).map_err(|e| {
        AppError::Io(format!(
            "failed to write temp wolf save {}: {e}",
            tmp_path.display()
        ))
    })?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| {
            AppError::Io(format!(
                "failed to replace wolf save {}: {e}",
                path.display()
            ))
        })?;
    }
    fs::rename(tmp_path, path).map_err(|e| {
        AppError::Io(format!(
            "failed to rename wolf save {}: {e}",
            path.display()
        ))
    })?;
    Ok(())
}

fn parse_err(err: String) -> AppError {
    AppError::Other(format!("wolf save parse: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_live_wolf_save_if_present() {
        let path = std::path::PathBuf::from(
            r"E:\Downloads\New Folder\Other\wolf-test\Save\SaveData01.sav",
        );
        if !path.is_file() {
            return;
        }
        let tree = read_wolf_sav(&path).expect("wolf save parse");
        assert!(tree.children.as_ref().is_some_and(|c| !c.is_empty()));
    }
}
