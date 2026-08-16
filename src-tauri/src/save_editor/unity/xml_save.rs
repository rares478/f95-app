//! Unity XML saves (e.g. Man of the House `savegames/*.sav` → `PlayerData`).

use crate::error::AppError;
use crate::save_editor::json_tree::apply_patches_json;
use crate::save_editor::types::RenpySavePatch;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use serde_json::{Map, Number, Value};

const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// True when bytes look like a UTF-8 (optionally BOM) XML save document.
pub fn looks_like_xml_save(bytes: &[u8]) -> bool {
    let text = strip_bom_str(bytes);
    let t = text.trim_start();
    if !(t.starts_with("<?xml") || t.starts_with('<')) {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    // Prefer known Unity / XmlSerializer save roots; still allow generic <?xml saves.
    lower.contains("<playerdata")
        || lower.contains("<savedata")
        || lower.contains("<gamedata")
        || t.starts_with("<?xml")
}

pub fn parse_xml_to_json(bytes: &[u8]) -> Result<Value, AppError> {
    let text = strip_bom_str(bytes);
    let root = parse_root_element(text)?;
    Ok(element_to_value(&root))
}

pub fn apply_xml_patches(
    bytes: &[u8],
    patches: &[RenpySavePatch],
) -> Result<(Vec<u8>, Value), AppError> {
    let had_bom = bytes.starts_with(BOM);
    let text = strip_bom_str(bytes);
    let crlf = text.contains("\r\n");
    let root = parse_root_element(text)?;
    let mut value = element_to_value(&root);
    apply_patches_json(&mut value, patches)?;

    // Rebuild from the patched JSON using original root name + attrs.
    let mut out = Vec::new();
    if had_bom {
        out.extend_from_slice(BOM);
    }
    let decl = if crlf {
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n"
    } else {
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
    };
    out.extend_from_slice(decl.as_bytes());
    write_element(&mut out, &root.name, &root.attrs, &value, 0, crlf)?;
    Ok((out, value))
}

#[derive(Debug, Clone)]
struct Element {
    name: String,
    attrs: Vec<(String, String)>,
    /// Ordered children: same name may repeat (arrays).
    children: Vec<Element>,
    /// Text when there are no element children.
    text: String,
}

fn strip_bom_str(bytes: &[u8]) -> &str {
    let bytes = if bytes.starts_with(BOM) {
        &bytes[BOM.len()..]
    } else {
        bytes
    };
    std::str::from_utf8(bytes).unwrap_or("")
}

fn parse_root_element(text: &str) -> Result<Element, AppError> {
    let mut reader = Reader::from_str(text);
    // Do not trim each Text event — entity refs (`&amp;`) split text and would
    // drop surrounding spaces if trim_text(true) were enabled.
    reader.config_mut().trim_text(false);
    let mut stack: Vec<Element> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = qname_str(&e)?;
                let attrs = attrs_of(&e)?;
                stack.push(Element {
                    name,
                    attrs,
                    children: Vec::new(),
                    text: String::new(),
                });
            }
            Ok(Event::Empty(e)) => {
                let name = qname_str(&e)?;
                let attrs = attrs_of(&e)?;
                let el = Element {
                    name,
                    attrs,
                    children: Vec::new(),
                    text: String::new(),
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(el);
                } else {
                    return Ok(el);
                }
            }
            Ok(Event::Text(t)) => {
                let s = t
                    .decode()
                    .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
                    .into_owned();
                append_text(&mut stack, &s);
            }
            Ok(Event::GeneralRef(r)) => {
                if let Some(s) = resolve_general_ref(&r)? {
                    append_text(&mut stack, &s);
                }
            }
            Ok(Event::CData(t)) => {
                let s = std::str::from_utf8(t.as_ref())
                    .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
                    .to_string();
                append_text(&mut stack, &s);
            }
            Ok(Event::End(_)) => {
                let mut finished = stack
                    .pop()
                    .ok_or_else(|| AppError::keyed("error.saveEditor.parse"))?;
                if finished.children.is_empty() {
                    finished.text = finished.text.trim().to_string();
                }
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(finished);
                } else {
                    return Ok(finished);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(AppError::keyed("error.saveEditor.parse")),
        }
        buf.clear();
    }
    Err(AppError::keyed("error.saveEditor.parse"))
}

fn qname_str(e: &BytesStart<'_>) -> Result<String, AppError> {
    let n = e.name();
    let local = n.local_name();
    std::str::from_utf8(local.as_ref())
        .map(|s| s.to_string())
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))
}

fn attrs_of(e: &BytesStart<'_>) -> Result<Vec<(String, String)>, AppError> {
    let mut out = Vec::new();
    for a in e.attributes().flatten() {
        let key = std::str::from_utf8(a.key.local_name().as_ref())
            .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
            .to_string();
        // Keep prefixed xmlns attrs with full key when present.
        let key = if a.key.as_ref().starts_with(b"xmlns") {
            std::str::from_utf8(a.key.as_ref())
                .unwrap_or(key.as_str())
                .to_string()
        } else {
            key
        };
        let val = a
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
            .into_owned();
        out.push((key, val));
    }
    Ok(out)
}

fn append_text(stack: &mut [Element], s: &str) {
    if let Some(parent) = stack.last_mut() {
        if parent.children.is_empty() {
            parent.text.push_str(s);
        }
    }
}

fn resolve_general_ref(r: &quick_xml::events::BytesRef<'_>) -> Result<Option<String>, AppError> {
    if let Some(ch) = r
        .resolve_char_ref()
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?
    {
        return Ok(Some(ch.to_string()));
    }
    let name = r
        .decode()
        .map_err(|_| AppError::keyed("error.saveEditor.parse"))?;
    Ok(resolve_predefined_entity(&name).map(str::to_string))
}

fn element_to_value(el: &Element) -> Value {
    if el.children.is_empty() {
        return scalar_from_text(&el.text);
    }
    // Group consecutive/duplicate child names into arrays.
    let mut map = Map::new();
    let mut i = 0;
    while i < el.children.len() {
        let name = el.children[i].name.clone();
        let mut group = vec![&el.children[i]];
        let mut j = i + 1;
        while j < el.children.len() && el.children[j].name == name {
            group.push(&el.children[j]);
            j += 1;
        }
        if group.len() == 1 {
            map.insert(name, element_to_value(group[0]));
        } else {
            let arr: Vec<Value> = group.iter().map(|c| element_to_value(c)).collect();
            map.insert(name, Value::Array(arr));
        }
        i = j;
    }
    Value::Object(map)
}

fn scalar_from_text(text: &str) -> Value {
    if text.is_empty() {
        return Value::String(String::new());
    }
    if text.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if text.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Ok(i) = text.parse::<i64>() {
        return Value::Number(i.into());
    }
    if let Ok(u) = text.parse::<u64>() {
        return Value::Number(u.into());
    }
    if let Ok(f) = text.parse::<f64>() {
        if let Some(n) = Number::from_f64(f) {
            // Prefer ints when whole.
            if f.fract() == 0.0 && f.abs() < (i64::MAX as f64) {
                return Value::Number((f as i64).into());
            }
            return Value::Number(n);
        }
    }
    Value::String(text.to_string())
}

fn write_element(
    out: &mut Vec<u8>,
    name: &str,
    attrs: &[(String, String)],
    value: &Value,
    depth: usize,
    crlf: bool,
) -> Result<(), AppError> {
    let nl = if crlf { "\r\n" } else { "\n" };
    let indent = "  ".repeat(depth);

    match value {
        Value::Object(map) => {
            write_open(out, name, attrs, &indent, false)?;
            out.extend_from_slice(nl.as_bytes());
            for (k, v) in map {
                match v {
                    Value::Array(items) => {
                        for item in items {
                            write_element(out, k, &[], item, depth + 1, crlf)?;
                        }
                    }
                    other => write_element(out, k, &[], other, depth + 1, crlf)?,
                }
            }
            out.extend_from_slice(indent.as_bytes());
            write_close(out, name)?;
            out.extend_from_slice(nl.as_bytes());
        }
        Value::Array(_) => {
            // Arrays only appear as repeated children under an object key.
            return Err(AppError::keyed("error.saveEditor.parse"));
        }
        Value::Null => {
            write_open(out, name, attrs, &indent, true)?;
            out.extend_from_slice(nl.as_bytes());
        }
        leaf => {
            let text = leaf_to_text(leaf)?;
            if text.is_empty() {
                write_open(out, name, attrs, &indent, true)?;
                out.extend_from_slice(nl.as_bytes());
            } else {
                write_open(out, name, attrs, &indent, false)?;
                write_text_escaped(out, &text)?;
                write_close(out, name)?;
                out.extend_from_slice(nl.as_bytes());
            }
        }
    }
    Ok(())
}

fn write_open(
    out: &mut Vec<u8>,
    name: &str,
    attrs: &[(String, String)],
    indent: &str,
    empty: bool,
) -> Result<(), AppError> {
    out.extend_from_slice(indent.as_bytes());
    out.push(b'<');
    out.extend_from_slice(name.as_bytes());
    for (k, v) in attrs {
        out.push(b' ');
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(b"=\"");
        write_text_escaped(out, v)?;
        out.push(b'"');
    }
    if empty {
        out.extend_from_slice(b" />");
    } else {
        out.push(b'>');
    }
    Ok(())
}

fn write_close(out: &mut Vec<u8>, name: &str) -> Result<(), AppError> {
    out.extend_from_slice(b"</");
    out.extend_from_slice(name.as_bytes());
    out.push(b'>');
    Ok(())
}

fn write_text_escaped(out: &mut Vec<u8>, text: &str) -> Result<(), AppError> {
    for c in text.chars() {
        match c {
            '&' => out.extend_from_slice(b"&amp;"),
            '<' => out.extend_from_slice(b"&lt;"),
            '>' => out.extend_from_slice(b"&gt;"),
            '"' => out.extend_from_slice(b"&quot;"),
            '\'' => out.extend_from_slice(b"&apos;"),
            other => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    Ok(())
}

fn leaf_to_text(value: &Value) -> Result<String, AppError> {
    match value {
        Value::Bool(b) => Ok(if *b {
            "true".into()
        } else {
            "false".into()
        }),
        Value::Number(n) => Ok(n.to_string()),
        Value::String(s) => Ok(s.clone()),
        Value::Null => Ok(String::new()),
        _ => Err(AppError::keyed("error.saveEditor.patchType")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::RenpySavePatch;

    fn sample_xml() -> Vec<u8> {
        let mut v = BOM.to_vec();
        v.extend_from_slice(
            br#"<?xml version="1.0" encoding="utf-8"?>
<PlayerData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Name>Gusti</Name>
  <Money>0</Money>
  <Cheat>false</Cheat>
  <NPCs>
    <NPC>
      <ID>1</ID>
      <Name>Player</Name>
      <DisplayedName />
      <Stats>
        <Stat>
          <Name>Body</Name>
          <Value>0</Value>
        </Stat>
        <Stat>
          <Name>Mind</Name>
          <Value>3</Value>
        </Stat>
      </Stats>
    </NPC>
  </NPCs>
</PlayerData>
"#,
        );
        v
    }

    #[test]
    fn detects_and_parses_money() {
        let bytes = sample_xml();
        assert!(looks_like_xml_save(&bytes));
        let value = parse_xml_to_json(&bytes).unwrap();
        assert_eq!(value["Money"], Value::Number(0.into()));
        assert_eq!(value["Name"], Value::String("Gusti".into()));
        assert_eq!(value["NPCs"]["NPC"]["Stats"]["Stat"][1]["Value"], Value::Number(3.into()));
    }

    #[test]
    fn patch_money_round_trip() {
        let bytes = sample_xml();
        let (out, value) = apply_xml_patches(
            &bytes,
            &[RenpySavePatch {
                path: "Money".into(),
                value: Value::Number(999.into()),
            }],
        )
        .unwrap();
        assert_eq!(value["Money"], Value::Number(999.into()));
        let again = parse_xml_to_json(&out).unwrap();
        assert_eq!(again["Money"], Value::Number(999.into()));
        assert!(out.starts_with(BOM));
        assert!(looks_like_xml_save(&out));
    }

    #[test]
    fn parses_text_with_entities() {
        let bytes = br#"<?xml version="1.0" encoding="utf-8"?>
<PlayerData>
  <Name>Tom &amp; Jerry</Name>
  <Note>a &lt; b</Note>
</PlayerData>
"#;
        let value = parse_xml_to_json(bytes).unwrap();
        assert_eq!(value["Name"], Value::String("Tom & Jerry".into()));
        assert_eq!(value["Note"], Value::String("a < b".into()));
    }

    #[test]
    fn parses_moth_save_if_present() {
        let path = r"E:\Downloads\New Folder\Other\3691\Current · Win · Full-Man_of_the_House_v102c_extra\Man of the House v1.0.2c (extra)\savegames\Gusti (1 - 16.30).sav";
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        assert!(looks_like_xml_save(&bytes));
        let value = parse_xml_to_json(&bytes).expect("parse MotH sav");
        assert!(value.get("Money").is_some());
        assert!(value.get("Name").is_some());
        assert!(value.get("NPCs").is_some());
    }
}
