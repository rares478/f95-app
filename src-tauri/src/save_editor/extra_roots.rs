//! User-attached extra save folder roots (`extra:<rootId>/<rel>` slot keys).

use crate::error::AppError;
use crate::save_editor::types::ExtraSaveRoot;
use crate::save_editor::{ensure_under_root, reject_path_component};
use std::path::{Path, PathBuf};

pub fn parse_extra_rel(rel: &str) -> Result<(&str, &str), AppError> {
    let (root_id, file_rel) = rel
        .split_once('/')
        .ok_or_else(|| AppError::keyed("error.saveEditor.unity.badSlotKey"))?;
    if root_id.is_empty()
        || file_rel.is_empty()
        || file_rel.contains('\\')
        || file_rel.contains('\0')
    {
        return Err(AppError::keyed("error.saveEditor.unity.badSlotKey"));
    }
    reject_path_component(root_id)?;
    for seg in file_rel.split('/') {
        reject_path_component(seg)?;
    }
    Ok((root_id, file_rel))
}

pub fn find_extra_root<'a>(
    roots: &'a [ExtraSaveRoot],
    root_id: &str,
) -> Result<&'a ExtraSaveRoot, AppError> {
    roots
        .iter()
        .find(|r| r.id == root_id)
        .ok_or_else(|| AppError::keyed("error.saveEditor.unity.badSlotKey"))
}

pub fn resolve_extra_live(
    roots: &[ExtraSaveRoot],
    rel: &str,
) -> Result<(PathBuf, PathBuf), AppError> {
    let (root_id, file_rel) = parse_extra_rel(rel)?;
    let root = find_extra_root(roots, root_id)?;
    let root_path = PathBuf::from(&root.path);
    if !root_path.is_dir() {
        return Err(AppError::Io(format!(
            "extra save root missing: {}",
            root_path.display()
        )));
    }
    let live = join_rel(&root_path, file_rel);
    ensure_under_root(&live, &root_path)?;
    Ok((live, root_path))
}

fn join_rel(root: &Path, rel: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        out.push(seg);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_extra_rel() {
        let (id, rel) = parse_extra_rel("abc-123/Save/slot.es3").unwrap();
        assert_eq!(id, "abc-123");
        assert_eq!(rel, "Save/slot.es3");
        assert!(parse_extra_rel("noslash").is_err());
        assert!(parse_extra_rel("../x/y").is_err());
    }
}
