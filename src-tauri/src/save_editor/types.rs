use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenpyProbeResult {
    pub is_renpy_layout: bool,
    pub saves_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenpySaveSlot {
    pub key: String,
    /// One of: `slot` | `auto` | `quick` | `persistent` | `other`
    pub kind: String,
    pub mtime_ms: u64,
    pub size_bytes: u64,
    pub has_screenshot: bool,
}
