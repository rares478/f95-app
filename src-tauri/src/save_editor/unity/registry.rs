//! Unity PlayerPrefs under `HKCU\SOFTWARE\{Company}\{Product}` (Windows).

use crate::error::AppError;
use crate::save_editor::json_tree::{apply_patches_json, json_to_tree};
use crate::save_editor::types::{
    RenpySavePatch, RenpyVarNode, UnityMeta, UnitySaveReadResult, UnitySaveSlot,
};
use crate::save_editor::unity::discover::company_product_candidates;
use crate::save_editor::unity::files::slot_key;
use crate::save_editor::unity::json_save::parse_json_value;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;

const GROUP_REL_PREFIX: &str = "group/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrefCodec {
    /// UTF-8 JSON with a trailing NUL (common for large string prefs).
    Utf8Nul,
    /// UTF-16LE JSON with trailing NUL (classic Unity PlayerPrefs strings).
    Utf16LeNul,
    /// UTF-8 JSON without trailing NUL.
    Utf8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ScalarStringCodec {
    AsciiNul,
    Utf8Nul,
    Utf16LeNul,
}

/// Strip Unity's `_h{hash}` suffix for display.
pub fn display_name_from_value_name(name: &str) -> String {
    if let Some(idx) = name.rfind("_h") {
        let suffix = &name[idx + 2..];
        if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
            return name[..idx].to_string();
        }
    }
    name.to_string()
}

pub fn is_junk_pref_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("screenmanager")
        || lower.starts_with("unityselectmonitor")
        || lower.starts_with("unitygraphicsquality")
        || lower.starts_with("unity.player_session")
        || lower.starts_with("unity.cloud_userid")
        || lower.starts_with("unity.player_sessionid")
        || lower.starts_with("unity.player_session_count")
}

/// Split `suSlot01_henchwoman` → (`suSlot01`, `henchwoman`).
/// Leading-underscore Unity prefs (`_money`) → (`PlayerPrefs`, `money`).
pub fn group_and_field(display_base: &str) -> (String, String) {
    if let Some(field) = display_base.strip_prefix('_') {
        if !field.is_empty() {
            return ("PlayerPrefs".to_string(), field.to_string());
        }
    }
    match display_base.split_once('_') {
        Some((group, field)) if !group.is_empty() && !field.is_empty() => {
            (group.to_string(), field.to_string())
        }
        _ => ("_root".to_string(), display_base.to_string()),
    }
}

pub fn group_slot_rel(group: &str) -> String {
    format!("{GROUP_REL_PREFIX}{group}")
}

pub fn parse_group_rel(rel: &str) -> Option<&str> {
    rel.strip_prefix(GROUP_REL_PREFIX)
        .filter(|g| !g.is_empty() && !g.contains('/') && !g.contains('\\'))
}

/// Try decode registry bytes as JSON; returns (text, codec) on success.
pub fn decode_json_pref_bytes(bytes: &[u8]) -> Option<(String, PrefCodec)> {
    if let Some((text, codec)) = try_utf8_json(bytes) {
        return Some((text, codec));
    }
    try_utf16_json(bytes)
}

fn try_utf8_json(bytes: &[u8]) -> Option<(String, PrefCodec)> {
    let trimmed = trim_trailing_nuls(bytes);
    if trimmed.is_empty() {
        return None;
    }
    let text = std::str::from_utf8(trimmed).ok()?;
    if !is_json_object_or_array(text) {
        return None;
    }
    let codec = if trimmed.len() < bytes.len() {
        PrefCodec::Utf8Nul
    } else {
        PrefCodec::Utf8
    };
    Some((text.to_string(), codec))
}

fn try_utf16_json(bytes: &[u8]) -> Option<(String, PrefCodec)> {
    if bytes.len() < 4 || bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
    if end == 0 {
        return None;
    }
    let text = String::from_utf16(&units[..end]).ok()?;
    if !is_json_object_or_array(&text) {
        return None;
    }
    Some((text, PrefCodec::Utf16LeNul))
}

fn is_json_object_or_array(text: &str) -> bool {
    let t = text.trim_start();
    if !(t.starts_with('{') || t.starts_with('[')) {
        return false;
    }
    matches!(
        serde_json::from_str::<Value>(text),
        Ok(Value::Object(_)) | Ok(Value::Array(_))
    )
}

fn trim_trailing_nuls(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == 0 {
        end -= 1;
    }
    &bytes[..end]
}

pub fn encode_json_pref(text: &str, codec: PrefCodec) -> Vec<u8> {
    match codec {
        PrefCodec::Utf8 => text.as_bytes().to_vec(),
        PrefCodec::Utf8Nul => {
            let mut v = text.as_bytes().to_vec();
            v.push(0);
            v
        }
        PrefCodec::Utf16LeNul => {
            let mut v = Vec::with_capacity((text.len() + 1) * 2);
            for u in text.encode_utf16() {
                v.extend_from_slice(&u.to_le_bytes());
            }
            v.extend_from_slice(&0u16.to_le_bytes());
            v
        }
    }
}

fn decode_scalar_string(bytes: &[u8]) -> Option<(String, ScalarStringCodec)> {
    if decode_json_pref_bytes(bytes).is_some() {
        return None;
    }
    let trimmed = trim_trailing_nuls(bytes);
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(text) = std::str::from_utf8(trimmed) {
        if text.chars().all(|c| !c.is_control() || c == '\t' || c == '\n' || c == '\r') {
            let codec = if trimmed.len() < bytes.len() {
                if text.is_ascii() {
                    ScalarStringCodec::AsciiNul
                } else {
                    ScalarStringCodec::Utf8Nul
                }
            } else if text.is_ascii() {
                // Still treat as nul-terminated style on write if original had trailing NUL.
                if bytes.last() == Some(&0) {
                    ScalarStringCodec::AsciiNul
                } else {
                    ScalarStringCodec::Utf8Nul
                }
            } else {
                ScalarStringCodec::Utf8Nul
            };
            return Some((text.to_string(), codec));
        }
    }
    if bytes.len() >= 2 && bytes.len() % 2 == 0 {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
        if end == 0 {
            return None;
        }
        let text = String::from_utf16(&units[..end]).ok()?;
        if text.chars().all(|c| !c.is_control() || c == '\t' || c == '\n' || c == '\r') {
            return Some((text, ScalarStringCodec::Utf16LeNul));
        }
    }
    None
}

fn encode_scalar_string(text: &str, codec: ScalarStringCodec) -> Vec<u8> {
    match codec {
        ScalarStringCodec::AsciiNul | ScalarStringCodec::Utf8Nul => {
            let mut v = text.as_bytes().to_vec();
            v.push(0);
            v
        }
        ScalarStringCodec::Utf16LeNul => {
            let mut v = Vec::with_capacity((text.len() + 1) * 2);
            for u in text.encode_utf16() {
                v.extend_from_slice(&u.to_le_bytes());
            }
            v.extend_from_slice(&0u16.to_le_bytes());
            v
        }
    }
}

/// List JSON-like and grouped scalar PlayerPrefs for this install (Windows only).
pub fn list_slots(install: &Path, meta: &UnityMeta) -> Result<Vec<UnitySaveSlot>, AppError> {
    #[cfg(windows)]
    {
        list_slots_windows(install, meta)
    }
    #[cfg(not(windows))]
    {
        let _ = (install, meta);
        Ok(Vec::new())
    }
}

pub fn read_slot(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
) -> Result<UnitySaveReadResult, AppError> {
    #[cfg(windows)]
    {
        if let Some(group) = parse_group_rel(value_name) {
            let value = read_group_json(install, meta, group)?;
            return Ok(UnitySaveReadResult {
                tree: Some(json_to_tree(&value)),
                needs_password: false,
                encrypted: false,
            });
        }
        let (text, _codec) = read_pref_text(install, meta, value_name)?;
        let value = parse_json_value(&text)?;
        Ok(UnitySaveReadResult {
            tree: Some(json_to_tree(&value)),
            needs_password: false,
            encrypted: false,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (install, meta, value_name);
        Err(AppError::keyed("error.saveEditor.unity.registryUnsupported"))
    }
}

pub fn write_slot(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
    patches: &[RenpySavePatch],
) -> Result<(RenpyVarNode, Vec<u8>), AppError> {
    #[cfg(windows)]
    {
        if let Some(group) = parse_group_rel(value_name) {
            let raw_before = read_raw_bytes(install, meta, value_name)?;
            let mut value = read_group_json(install, meta, group)?;
            apply_patches_json(&mut value, patches)?;
            write_group_json(install, meta, group, &value)?;
            return Ok((json_to_tree(&value), raw_before));
        }
        let (text, codec) = read_pref_text(install, meta, value_name)?;
        let raw_before = encode_json_pref(&text, codec);
        let mut value = parse_json_value(&text)?;
        apply_patches_json(&mut value, patches)?;
        let json = if text.contains('\n') {
            serde_json::to_string_pretty(&value)
        } else {
            serde_json::to_string(&value)
        }
        .map_err(|e| AppError::Io(format!("failed to serialize registry pref: {e}")))?;
        let encoded = encode_json_pref(&json, codec);
        write_pref_bytes(install, meta, value_name, &encoded)?;
        Ok((json_to_tree(&value), raw_before))
    }
    #[cfg(not(windows))]
    {
        let _ = (install, meta, value_name, patches);
        Err(AppError::keyed("error.saveEditor.unity.registryUnsupported"))
    }
}

pub fn read_raw_bytes(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
) -> Result<Vec<u8>, AppError> {
    #[cfg(windows)]
    {
        if let Some(group) = parse_group_rel(value_name) {
            let backup = build_group_backup(install, meta, group)?;
            return serde_json::to_vec_pretty(&backup)
                .map_err(|e| AppError::Io(format!("failed to serialize prefs backup: {e}")));
        }
        let (company, product) = resolve_company_product(install, meta)?;
        read_value_bytes(&company, &product, value_name)
    }
    #[cfg(not(windows))]
    {
        let _ = (install, meta, value_name);
        Err(AppError::keyed("error.saveEditor.unity.registryUnsupported"))
    }
}

pub fn write_raw_bytes(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
    bytes: &[u8],
) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        if let Some(group) = parse_group_rel(value_name) {
            let backup: GroupBackup = serde_json::from_slice(bytes)
                .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
            if backup.group != group {
                return Err(AppError::keyed("error.saveEditor.unity.badSlotKey"));
            }
            return restore_group_backup(install, meta, &backup);
        }
        write_pref_bytes(install, meta, value_name, bytes)
    }
    #[cfg(not(windows))]
    {
        let _ = (install, meta, value_name, bytes);
        Err(AppError::keyed("error.saveEditor.unity.registryUnsupported"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupBackup {
    format: String,
    group: String,
    values: Vec<GroupBackupValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum GroupBackupValue {
    #[serde(rename = "dword")]
    Dword { name: String, dword: u32 },
    #[serde(rename = "string")]
    String {
        name: String,
        string: String,
        codec: ScalarStringCodec,
    },
}

#[cfg(windows)]
fn list_slots_windows(install: &Path, meta: &UnityMeta) -> Result<Vec<UnitySaveSlot>, AppError> {
    let Ok((company, product)) = resolve_company_product(install, meta) else {
        return Ok(Vec::new());
    };
    let entries = enum_pref_entries(&company, &product)?;
    let mut slots = Vec::new();
    let mut groups: BTreeMap<String, u64> = BTreeMap::new();

    for entry in &entries {
        if is_junk_pref_name(entry.name()) {
            continue;
        }
        match entry {
            PrefEntry::Bytes { name, data } => {
                if decode_json_pref_bytes(data).is_some() {
                    slots.push(UnitySaveSlot {
                        key: slot_key("registry", name),
                        display_name: display_name_from_value_name(name),
                        kind: "json".into(),
                        source: "registry".into(),
                        encrypted: false,
                        mtime_ms: 0,
                        size_bytes: data.len() as u64,
                    });
                    continue;
                }
                if decode_scalar_string(data).is_some() {
                    let base = display_name_from_value_name(name);
                    let (group, _) = group_and_field(&base);
                    *groups.entry(group).or_insert(0) += data.len() as u64;
                }
            }
            PrefEntry::Dword { name, .. } => {
                let base = display_name_from_value_name(name);
                let (group, _) = group_and_field(&base);
                *groups.entry(group).or_insert(0) += 4;
            }
        }
    }

    for (group, size) in groups {
        slots.push(UnitySaveSlot {
            key: slot_key("registry", &group_slot_rel(&group)),
            display_name: group,
            kind: "json".into(),
            source: "registry".into(),
            encrypted: false,
            mtime_ms: 0,
            size_bytes: size,
        });
    }

    slots.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(slots)
}

#[cfg(windows)]
fn read_pref_text(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
) -> Result<(String, PrefCodec), AppError> {
    let (company, product) = resolve_company_product(install, meta)?;
    let bytes = read_value_bytes(&company, &product, value_name)?;
    decode_json_pref_bytes(&bytes).ok_or_else(|| AppError::keyed("error.saveEditor.parse"))
}

#[cfg(windows)]
fn write_pref_bytes(
    install: &Path,
    meta: &UnityMeta,
    value_name: &str,
    bytes: &[u8],
) -> Result<(), AppError> {
    let (company, product) = resolve_company_product(install, meta)?;
    set_value_bytes(&company, &product, value_name, bytes)
}

#[cfg(windows)]
fn collect_group_fields(
    install: &Path,
    meta: &UnityMeta,
    group: &str,
) -> Result<Vec<(String, String, PrefEntry)>, AppError> {
    let (company, product) = resolve_company_product(install, meta)?;
    let entries = enum_pref_entries(&company, &product)?;
    let mut out = Vec::new();
    for entry in entries {
        if is_junk_pref_name(entry.name()) {
            continue;
        }
        let base = display_name_from_value_name(entry.name());
        let (g, field) = group_and_field(&base);
        if g != group {
            continue;
        }
        match &entry {
            PrefEntry::Bytes { data, .. } => {
                if decode_json_pref_bytes(data).is_some() {
                    continue;
                }
                if decode_scalar_string(data).is_none() {
                    continue;
                }
            }
            PrefEntry::Dword { .. } => {}
        }
        out.push((field, entry.name().to_string(), entry));
    }
    Ok(out)
}

#[cfg(windows)]
fn read_group_json(install: &Path, meta: &UnityMeta, group: &str) -> Result<Value, AppError> {
    let fields = collect_group_fields(install, meta, group)?;
    let mut map = Map::new();
    for (field, _name, entry) in fields {
        let value = match entry {
            PrefEntry::Dword { value, .. } => Value::from(value as i32),
            PrefEntry::Bytes { data, .. } => {
                let (text, _) = decode_scalar_string(&data)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                Value::String(text)
            }
        };
        map.insert(field, value);
    }
    Ok(Value::Object(map))
}

#[cfg(windows)]
fn write_group_json(
    install: &Path,
    meta: &UnityMeta,
    group: &str,
    value: &Value,
) -> Result<(), AppError> {
    let Value::Object(map) = value else {
        return Err(AppError::keyed("error.saveEditor.patchType"));
    };
    let fields = collect_group_fields(install, meta, group)?;
    let by_field: BTreeMap<&str, &PrefEntry> = fields
        .iter()
        .map(|(field, _name, entry)| (field.as_str(), entry))
        .collect();
    let (company, product) = resolve_company_product(install, meta)?;

    for (field, new_val) in map {
        let Some(entry) = by_field.get(field.as_str()) else {
            return Err(AppError::keyed("error.saveEditor.patchMissing"));
        };
        match (entry, new_val) {
            (PrefEntry::Dword { name, .. }, Value::Number(n)) => {
                let as_i = n
                    .as_i64()
                    .or_else(|| n.as_u64().map(|u| u as i64))
                    .ok_or_else(|| AppError::keyed("error.saveEditor.patchType"))?;
                if as_i < i32::MIN as i64 || as_i > u32::MAX as i64 {
                    return Err(AppError::keyed("error.saveEditor.patchType"));
                }
                set_value_dword(&company, &product, name, as_i as u32)?;
            }
            (PrefEntry::Dword { name, .. }, Value::Bool(b)) => {
                set_value_dword(&company, &product, name, u32::from(*b))?;
            }
            (PrefEntry::Bytes { name, data }, Value::String(s)) => {
                let (_, codec) = decode_scalar_string(data)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                let encoded = encode_scalar_string(s, codec);
                set_value_bytes(&company, &product, name, &encoded)?;
            }
            _ => return Err(AppError::keyed("error.saveEditor.patchType")),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn build_group_backup(
    install: &Path,
    meta: &UnityMeta,
    group: &str,
) -> Result<GroupBackup, AppError> {
    let fields = collect_group_fields(install, meta, group)?;
    let mut values = Vec::with_capacity(fields.len());
    for (_field, name, entry) in fields {
        match entry {
            PrefEntry::Dword { value, .. } => values.push(GroupBackupValue::Dword {
                name,
                dword: value,
            }),
            PrefEntry::Bytes { data, .. } => {
                let (text, codec) = decode_scalar_string(&data)
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                values.push(GroupBackupValue::String {
                    name,
                    string: text,
                    codec,
                });
            }
        }
    }
    Ok(GroupBackup {
        format: "unity-playerprefs-group-v1".into(),
        group: group.to_string(),
        values,
    })
}

#[cfg(windows)]
fn restore_group_backup(
    install: &Path,
    meta: &UnityMeta,
    backup: &GroupBackup,
) -> Result<(), AppError> {
    let (company, product) = resolve_company_product(install, meta)?;
    for value in &backup.values {
        match value {
            GroupBackupValue::Dword { name, dword } => {
                set_value_dword(&company, &product, name, *dword)?;
            }
            GroupBackupValue::String {
                name,
                string,
                codec,
            } => {
                let encoded = encode_scalar_string(string, *codec);
                set_value_bytes(&company, &product, name, &encoded)?;
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn resolve_company_product(install: &Path, meta: &UnityMeta) -> Result<(String, String), AppError> {
    let (companies, products) = company_product_candidates(install, meta);
    for company in &companies {
        for product in &products {
            if key_exists(company, product) {
                return Ok((company.clone(), product.clone()));
            }
        }
    }
    if let Some((c, p)) = fuzzy_find_key(&companies, &products) {
        return Ok((c, p));
    }
    // CompanyName often differs from F95 developer (Someguy vs Something Something Studios).
    if let Some((c, p)) = fuzzy_find_product_any_company(&products) {
        return Ok((c, p));
    }
    Err(AppError::keyed("error.saveEditor.unity.registryMissing"))
}

#[cfg(windows)]
#[derive(Debug, Clone)]
enum PrefEntry {
    Dword { name: String, value: u32 },
    Bytes { name: String, data: Vec<u8> },
}

#[cfg(windows)]
impl PrefEntry {
    fn name(&self) -> &str {
        match self {
            PrefEntry::Dword { name, .. } | PrefEntry::Bytes { name, .. } => name,
        }
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_BINARY, REG_DWORD, REG_SAM_FLAGS,
        REG_SZ, REG_VALUE_TYPE,
    };

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub(super) fn key_exists(company: &str, product: &str) -> bool {
        open_product_key(company, product, KEY_READ).is_ok()
    }

    pub(super) fn fuzzy_find_key(
        companies: &[String],
        products: &[String],
    ) -> Option<(String, String)> {
        if companies.is_empty() || products.is_empty() {
            return None;
        }
        let software = open_key(HKEY_CURRENT_USER, "SOFTWARE", KEY_READ).ok()?;
        let company_names = enum_subkeys(software).ok()?;
        unsafe {
            let _ = RegCloseKey(software);
        }
        let company_keys: Vec<String> = companies.iter().map(|c| normalize(c)).collect();
        let product_keys: Vec<String> = products.iter().map(|p| normalize(p)).collect();

        for cname in company_names {
            if !company_keys.iter().any(|k| k == &normalize(&cname)) {
                continue;
            }
            let ck = open_key(HKEY_CURRENT_USER, &format!("SOFTWARE\\{cname}"), KEY_READ).ok()?;
            let product_names = enum_subkeys(ck).ok();
            unsafe {
                let _ = RegCloseKey(ck);
            }
            let product_names = product_names?;
            for pname in product_names {
                if product_keys.iter().any(|k| k == &normalize(&pname)) {
                    return Some((cname, pname));
                }
            }
        }
        None
    }

    pub(super) fn fuzzy_find_product_any_company(
        products: &[String],
    ) -> Option<(String, String)> {
        let product_keys: Vec<String> = products
            .iter()
            .map(|p| normalize(p))
            .filter(|k| !k.is_empty())
            .collect();
        if product_keys.is_empty() {
            return None;
        }
        let software = open_key(HKEY_CURRENT_USER, "SOFTWARE", KEY_READ).ok()?;
        let company_names = enum_subkeys(software).ok()?;
        unsafe {
            let _ = RegCloseKey(software);
        }
        for cname in company_names {
            let ck = open_key(HKEY_CURRENT_USER, &format!("SOFTWARE\\{cname}"), KEY_READ).ok();
            let Some(ck) = ck else {
                continue;
            };
            let product_names = enum_subkeys(ck).ok();
            unsafe {
                let _ = RegCloseKey(ck);
            }
            let Some(product_names) = product_names else {
                continue;
            };
            for pname in product_names {
                if product_keys.iter().any(|k| k == &normalize(&pname)) {
                    return Some((cname, pname));
                }
            }
        }
        None
    }

    fn normalize(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    }

    fn open_key(root: HKEY, path: &str, access: REG_SAM_FLAGS) -> Result<HKEY, AppError> {
        let w = wide(path);
        let mut key = HKEY::default();
        let status =
            unsafe { RegOpenKeyExW(root, PCWSTR(w.as_ptr()), Some(0), access, &mut key) };
        if status != ERROR_SUCCESS {
            return Err(AppError::keyed("error.saveEditor.unity.registryMissing"));
        }
        Ok(key)
    }

    fn open_product_key(
        company: &str,
        product: &str,
        access: REG_SAM_FLAGS,
    ) -> Result<HKEY, AppError> {
        open_key(
            HKEY_CURRENT_USER,
            &format!("SOFTWARE\\{company}\\{product}"),
            access,
        )
    }

    fn enum_subkeys(key: HKEY) -> Result<Vec<String>, AppError> {
        let mut out = Vec::new();
        let mut index = 0u32;
        loop {
            let mut name_buf = vec![0u16; 256];
            let mut name_len = name_buf.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    key,
                    index,
                    Some(PWSTR(name_buf.as_mut_ptr())),
                    &mut name_len,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            if status != ERROR_SUCCESS {
                return Err(AppError::Io(format!("RegEnumKeyExW failed: {status:?}")));
            }
            name_buf.truncate(name_len as usize);
            out.push(String::from_utf16_lossy(&name_buf));
            index += 1;
        }
        Ok(out)
    }

    pub(super) fn enum_pref_entries(
        company: &str,
        product: &str,
    ) -> Result<Vec<PrefEntry>, AppError> {
        let key = open_product_key(company, product, KEY_READ)?;
        let mut out = Vec::new();
        let mut index = 0u32;
        loop {
            let mut name_buf = vec![0u16; 16384];
            let mut name_len = name_buf.len() as u32;
            let mut data_len = 0u32;
            let mut ty_u32 = 0u32;
            let status = unsafe {
                RegEnumValueW(
                    key,
                    index,
                    Some(PWSTR(name_buf.as_mut_ptr())),
                    &mut name_len,
                    None,
                    Some(&mut ty_u32 as *mut u32),
                    None,
                    Some(&mut data_len),
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
                unsafe {
                    let _ = RegCloseKey(key);
                }
                return Err(AppError::Io(format!("RegEnumValueW failed: {status:?}")));
            }
            let mut data = vec![0u8; data_len as usize];
            let mut name_len2 = name_buf.len() as u32;
            let mut data_len2 = data_len;
            let mut ty2_u32 = 0u32;
            let status2 = unsafe {
                RegEnumValueW(
                    key,
                    index,
                    Some(PWSTR(name_buf.as_mut_ptr())),
                    &mut name_len2,
                    None,
                    Some(&mut ty2_u32 as *mut u32),
                    Some(data.as_mut_ptr()),
                    Some(&mut data_len2),
                )
            };
            if status2 != ERROR_SUCCESS {
                index += 1;
                continue;
            }
            name_buf.truncate(name_len2 as usize);
            data.truncate(data_len2 as usize);
            let name = String::from_utf16_lossy(&name_buf);
            let ty2 = REG_VALUE_TYPE(ty2_u32);
            if ty2 == REG_DWORD {
                if data.len() >= 4 {
                    let value = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                    out.push(PrefEntry::Dword { name, value });
                }
            } else if ty2 == REG_BINARY || ty2 == REG_SZ {
                out.push(PrefEntry::Bytes { name, data });
            }
            index += 1;
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
        Ok(out)
    }

    pub(super) fn read_value_bytes(
        company: &str,
        product: &str,
        value_name: &str,
    ) -> Result<Vec<u8>, AppError> {
        let key = open_product_key(company, product, KEY_READ)?;
        let wname = wide(value_name);
        let mut ty = REG_VALUE_TYPE::default();
        let mut data_len = 0u32;
        let status = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR(wname.as_ptr()),
                None,
                Some(&mut ty),
                None,
                Some(&mut data_len),
            )
        };
        if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
            unsafe {
                let _ = RegCloseKey(key);
            }
            return Err(AppError::keyed("error.saveEditor.unity.registryMissing"));
        }
        let mut data = vec![0u8; data_len as usize];
        let status2 = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR(wname.as_ptr()),
                None,
                Some(&mut ty),
                Some(data.as_mut_ptr()),
                Some(&mut data_len),
            )
        };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if status2 != ERROR_SUCCESS {
            return Err(AppError::Io(format!("RegQueryValueExW failed: {status2:?}")));
        }
        data.truncate(data_len as usize);
        Ok(data)
    }

    pub(super) fn set_value_bytes(
        company: &str,
        product: &str,
        value_name: &str,
        bytes: &[u8],
    ) -> Result<(), AppError> {
        let key = open_product_key(company, product, KEY_READ | KEY_SET_VALUE)?;
        let wname = wide(value_name);
        let status = unsafe {
            RegSetValueExW(
                key,
                PCWSTR(wname.as_ptr()),
                Some(0),
                REG_BINARY,
                Some(bytes),
            )
        };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if status != ERROR_SUCCESS {
            return Err(AppError::Io(format!("RegSetValueExW failed: {status:?}")));
        }
        Ok(())
    }

    pub(super) fn set_value_dword(
        company: &str,
        product: &str,
        value_name: &str,
        value: u32,
    ) -> Result<(), AppError> {
        let key = open_product_key(company, product, KEY_READ | KEY_SET_VALUE)?;
        let wname = wide(value_name);
        let bytes = value.to_le_bytes();
        let status = unsafe {
            RegSetValueExW(
                key,
                PCWSTR(wname.as_ptr()),
                Some(0),
                REG_DWORD,
                Some(&bytes),
            )
        };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if status != ERROR_SUCCESS {
            return Err(AppError::Io(format!("RegSetValueExW DWORD failed: {status:?}")));
        }
        Ok(())
    }
}

#[cfg(windows)]
use win::{
    enum_pref_entries, fuzzy_find_key, fuzzy_find_product_any_company, key_exists, read_value_bytes,
    set_value_bytes, set_value_dword,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_hash_suffix() {
        assert_eq!(
            display_name_from_value_name("wholeGameStateversion 0.89.8c_h3398809205"),
            "wholeGameStateversion 0.89.8c"
        );
        assert_eq!(display_name_from_value_name("Settings_h649772672"), "Settings");
        assert_eq!(display_name_from_value_name("nohash"), "nohash");
    }

    #[test]
    fn junk_filter() {
        assert!(is_junk_pref_name("Screenmanager Resolution Width_h1"));
        assert!(is_junk_pref_name("unity.player_session_count_h1"));
        assert!(is_junk_pref_name("UnityGraphicsQuality_h1"));
        assert!(!is_junk_pref_name("wholeGameStateversion 0.89.8c_h1"));
    }

    #[test]
    fn groups_slot_prefix() {
        assert_eq!(
            group_and_field("suSlot01_henchwoman"),
            ("suSlot01".into(), "henchwoman".into())
        );
        assert_eq!(group_and_field("Settings"), ("_root".into(), "Settings".into()));
        assert_eq!(
            group_and_field("_money"),
            ("PlayerPrefs".into(), "money".into())
        );
        assert_eq!(
            group_and_field("_total_energ"),
            ("PlayerPrefs".into(), "total_energ".into())
        );
        assert_eq!(parse_group_rel("group/suSlot01"), Some("suSlot01"));
        assert_eq!(parse_group_rel("suSlot01"), None);
    }

    #[test]
    #[cfg(windows)]
    fn finds_the_twist_playerprefs_by_title() {
        let install = Path::new(".");
        let meta = UnityMeta {
            developer: Some("Wrong Studio".into()),
            title: Some("The Twist".into()),
        };
        let slots = list_slots(install, &meta).unwrap();
        if slots.is_empty() {
            return;
        }
        assert!(
            slots.iter().any(|s| s.key == "registry:group/PlayerPrefs"),
            "expected PlayerPrefs group, got: {:?}",
            slots.iter().map(|s| &s.key).collect::<Vec<_>>()
        );
        let read = read_slot(install, &meta, "group/PlayerPrefs").unwrap();
        let tree = read.tree.expect("tree");
        assert!(
            tree.children.as_ref().map(|c| !c.is_empty()).unwrap_or(false),
            "PlayerPrefs should expose scalar fields"
        );
    }

    #[test]
    fn utf8_nul_round_trip() {
        let json = r#"{"money":10,"name":"Gusti"}"#;
        let bytes = encode_json_pref(json, PrefCodec::Utf8Nul);
        assert_eq!(*bytes.last().unwrap(), 0);
        let (text, codec) = decode_json_pref_bytes(&bytes).unwrap();
        assert_eq!(codec, PrefCodec::Utf8Nul);
        assert_eq!(text, json);
    }

    #[test]
    fn utf16_nul_round_trip() {
        let json = r#"{"a":1}"#;
        let bytes = encode_json_pref(json, PrefCodec::Utf16LeNul);
        let (text, codec) = decode_json_pref_bytes(&bytes).unwrap();
        assert_eq!(codec, PrefCodec::Utf16LeNul);
        assert_eq!(text, json);
    }

    #[test]
    #[cfg(windows)]
    fn lists_taffy_tales_if_present() {
        let install = Path::new(".");
        let meta = UnityMeta {
            developer: Some("UberPie".into()),
            title: Some("TaffyTales".into()),
        };
        let slots = list_slots(install, &meta).unwrap();
        if slots.is_empty() {
            return;
        }
        assert!(
            slots.iter().any(|s| s.display_name.contains("wholeGameState")
                || s.display_name.contains("Settings")
                || s.key.contains("group/")),
            "unexpected slots: {:?}",
            slots.iter().map(|s| &s.display_name).collect::<Vec<_>>()
        );
        assert!(slots.iter().all(|s| s.source == "registry"));
        assert!(slots.iter().all(|s| !s.display_name.starts_with("Screenmanager")));
    }

    #[test]
    #[cfg(windows)]
    fn finds_something_unlimited_by_title_without_matching_developer() {
        let install = Path::new(".");
        let meta = UnityMeta {
            // F95-style developer that does NOT match HKCU\SOFTWARE\Someguy
            developer: Some("Something Something Studios".into()),
            title: Some("Something Unlimited".into()),
        };
        let slots = list_slots(install, &meta).unwrap();
        if slots.is_empty() {
            // Registry key absent on this machine.
            return;
        }
        assert!(
            slots.iter().any(|s| s.key == "registry:group/suSlot01"
                || s.display_name == "suSlot01"),
            "expected suSlot01 group, got: {:?}",
            slots.iter().map(|s| (&s.key, &s.display_name)).collect::<Vec<_>>()
        );
        let read = read_slot(install, &meta, "group/suSlot01").unwrap();
        let tree = read.tree.expect("tree");
        assert!(
            tree.children.as_ref().map(|c| !c.is_empty()).unwrap_or(false),
            "suSlot01 should expose scalar fields"
        );
    }
}
