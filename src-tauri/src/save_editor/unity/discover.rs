//! Unity install layout and LocalLow Company/Product discovery.

use crate::save_editor::types::{UnityMeta, UnityProbeResult};
use std::fs;
use std::path::{Path, PathBuf};

/// True when the install looks like a Unity game (`*_Data` and/or `UnityPlayer*.dll`).
pub fn is_unity_layout(install: &Path) -> bool {
    find_data_dir(install).is_some() || has_unity_player_dll(install)
}

/// Read Company / Product from a two-line `app.info` under a `*_Data` directory.
pub fn read_app_info(data_dir: &Path) -> Option<(String, String)> {
    let text = fs::read_to_string(data_dir.join("app.info")).ok()?;
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let company = lines.next()?.to_string();
    let product = lines.next()?.to_string();
    if company.is_empty() || product.is_empty() {
        return None;
    }
    Some((company, product))
}

/// First `*_Data` directory directly under the install root.
pub fn find_data_dir(install: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(install).ok()?;
    let mut found: Option<PathBuf> = None;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.ends_with("_Data") && name.len() > "_Data".len() {
            // Prefer a single match; if several, keep the first in directory order.
            if found.is_none() {
                found = Some(path);
            }
        }
    }
    found
}

/// `%USERPROFILE%\AppData\LocalLow` on Windows.
pub fn local_low_root() -> PathBuf {
    let profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    profile.join("AppData").join("LocalLow")
}

/// Resolve LocalLow `{Company}/{Product}` under `local_low_base` (injectable for tests).
pub fn resolve_local_low_dir(
    install: &Path,
    meta: &UnityMeta,
    local_low_base: &Path,
) -> Option<PathBuf> {
    if !local_low_base.is_dir() {
        return None;
    }

    let data_dir = find_data_dir(install);
    let app_info = data_dir.as_ref().and_then(|d| read_app_info(d));

    let mut companies: Vec<String> = Vec::new();
    let mut products: Vec<String> = Vec::new();

    if let Some((company, product)) = app_info {
        push_unique(&mut companies, company);
        push_unique(&mut products, product);
    }
    if let Some(dev) = meta.developer.as_ref() {
        push_unique(&mut companies, dev.clone());
    }
    if let Some(data) = data_dir.as_ref() {
        if let Some(stem) = data_dir_stem(data) {
            push_unique(&mut products, stem);
        }
    }
    if let Some(title) = meta.title.as_ref() {
        push_unique(&mut products, title.clone());
    }

    if companies.is_empty() || products.is_empty() {
        return None;
    }

    for company in &companies {
        for product in &products {
            let exact = local_low_base.join(company).join(product);
            if exact.is_dir() {
                return Some(exact);
            }
            if let Some(fuzzy) = fuzzy_company_product(local_low_base, company, product) {
                return Some(fuzzy);
            }
        }
    }
    None
}

/// Probe Unity layout and resolve LocalLow using the real LocalLow root.
pub fn probe_unity_install(install: &Path, meta: &UnityMeta) -> UnityProbeResult {
    let is_unity = is_unity_layout(install);
    let data_dir = find_data_dir(install);
    let app_info = data_dir.as_ref().and_then(|d| read_app_info(d));

    let local_low = resolve_local_low_dir(install, meta, &local_low_root());

    let (company, product) = match (&app_info, &local_low) {
        (Some((c, p)), _) => (Some(c.clone()), Some(p.clone())),
        (None, Some(path)) => {
            let product = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_string);
            let company = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .map(str::to_string);
            (company, product)
        }
        (None, None) => {
            let company = meta.developer.clone();
            let product = data_dir
                .as_ref()
                .and_then(|d| data_dir_stem(d))
                .or_else(|| meta.title.clone());
            (company, product)
        }
    };

    UnityProbeResult {
        is_unity_layout: is_unity,
        local_low_dir: local_low.map(|p| p.to_string_lossy().into_owned()),
        company,
        product,
    }
}

fn has_unity_player_dll(install: &Path) -> bool {
    let Ok(entries) = fs::read_dir(install) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|entry| {
        let path = entry.path();
        if !path.is_file() {
            return false;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return false;
        };
        let lower = name.to_ascii_lowercase();
        lower.starts_with("unityplayer") && lower.ends_with(".dll")
    })
}

fn data_dir_stem(data_dir: &Path) -> Option<String> {
    let name = data_dir.file_name()?.to_str()?;
    name.strip_suffix("_Data").filter(|s| !s.is_empty()).map(str::to_string)
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if value.is_empty() {
        return;
    }
    if !list.iter().any(|existing| existing == &value) {
        list.push(value);
    }
}

fn normalize_folder_key(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn fuzzy_company_product(local_low_base: &Path, company: &str, product: &str) -> Option<PathBuf> {
    let company_key = normalize_folder_key(company);
    let product_key = normalize_folder_key(product);
    if company_key.is_empty() || product_key.is_empty() {
        return None;
    }

    let company_dir = find_fuzzy_child(local_low_base, &company_key)?;
    find_fuzzy_child(&company_dir, &product_key)
}

fn find_fuzzy_child(parent: &Path, key: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(parent).ok()?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if normalize_folder_key(name) == key {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::save_editor::types::UnityMeta;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tempfile_root(label: &str) -> PathBuf {
        let unique = format!(
            "f95-unity-discover-{}-{}-{}",
            label,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn parses_app_info_two_lines() {
        let root = tempfile_root("app-info");
        let data_dir = root.join("Game_Data");
        fs::create_dir_all(&data_dir).unwrap();
        fs::write(data_dir.join("app.info"), "Acme\nWidget\n").unwrap();

        assert_eq!(
            read_app_info(&data_dir),
            Some(("Acme".to_string(), "Widget".to_string()))
        );
    }

    #[test]
    fn resolves_local_low_with_developer_fallback() {
        let root = tempfile_root("ll-dev");
        let install = root.join("install");
        let data_dir = install.join("Widget_Data");
        fs::create_dir_all(&data_dir).unwrap();

        let local_low_base = root.join("LocalLow");
        let expected = local_low_base.join("AcmeDev").join("Widget");
        fs::create_dir_all(&expected).unwrap();
        fs::write(expected.join("save.json"), b"{}").unwrap();

        let meta = UnityMeta {
            developer: Some("AcmeDev".to_string()),
            title: None,
        };

        assert_eq!(
            resolve_local_low_dir(&install, &meta, &local_low_base),
            Some(expected)
        );
    }

    #[test]
    fn probe_sets_is_unity_layout() {
        let root = tempfile_root("probe-layout");
        let install = root.join("install");
        fs::create_dir_all(install.join("Widget_Data")).unwrap();

        let meta = UnityMeta {
            developer: None,
            title: None,
        };
        let result = probe_unity_install(&install, &meta);
        assert!(result.is_unity_layout);
    }
}
