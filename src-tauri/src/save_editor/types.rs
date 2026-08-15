use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenpyVarNode {
    pub path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
    pub editable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<RenpyVarNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenpySavePatch {
    pub path: String,
    pub value: serde_json::Value,
}
