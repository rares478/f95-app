use super::platform::{auto_select_index, infer_platform_label};
use super::types::{ResolveResult, ResolvedFileOption};
use serde_json::Value;

pub(crate) fn files_from_gofile_data(data: &Value) -> Vec<ResolvedFileOption> {
    let mut out = Vec::new();
    if data.get("type").and_then(|t| t.as_str()) == Some("file") {
        if let Some(url) = data.get("link").and_then(|v| v.as_str()) {
            let name = data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("gofile-download.bin");
            let id = data
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(name)
                .to_string();
            push_file(
                &mut out,
                id,
                name,
                url,
                data.get("size").and_then(|v| v.as_u64()),
            );
        }
        return out;
    }
    if let Some(children) = data.get("children").and_then(|v| v.as_object()) {
        for (child_id, entry) in children {
            if entry.get("type").and_then(|t| t.as_str()) != Some("file") {
                continue;
            }
            let Some(url) = entry.get("link").and_then(|v| v.as_str()) else {
                continue;
            };
            let name = entry
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("gofile-download.bin");
            push_file(
                &mut out,
                child_id.clone(),
                name,
                url,
                entry.get("size").and_then(|v| v.as_u64()),
            );
        }
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    out
}

fn push_file(
    out: &mut Vec<ResolvedFileOption>,
    id: String,
    name: &str,
    url: &str,
    size: Option<u64>,
) {
    let file_name = name.to_string();
    out.push(ResolvedFileOption {
        id,
        file_name: file_name.clone(),
        direct_url: url.to_string(),
        file_size: size,
        platform_label: infer_platform_label(&file_name).map(str::to_string),
    });
}

pub(crate) fn finish_gofile_files(
    files: Vec<ResolvedFileOption>,
    extra_headers: Vec<(String, String)>,
    platform_group: Option<String>,
    source_url: &str,
    host: &str,
) -> ResolveResult {
    match files.len() {
        0 => ResolveResult::NeedsBrowser {
            url: source_url.to_string(),
            host: host.into(),
        },
        1 => {
            let f = &files[0];
            ResolveResult::Direct {
                url: f.direct_url.clone(),
                file_name: f.file_name.clone(),
                file_size: f.file_size,
                expected_sha256: None,
                extra_headers,
            }
        }
        _ => {
            if let Some(idx) = auto_select_index(&files, platform_group.as_deref()) {
                let f = &files[idx];
                return ResolveResult::Direct {
                    url: f.direct_url.clone(),
                    file_name: f.file_name.clone(),
                    file_size: f.file_size,
                    expected_sha256: None,
                    extra_headers,
                };
            }
            ResolveResult::ChooseFile {
                host: host.into(),
                source_url: source_url.to_string(),
                platform_group,
                files,
                extra_headers,
            }
        }
    }
}
