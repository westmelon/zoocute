use serde::{Deserialize, Serialize};

use crate::zk_core::interpreter::DataKind;
use crate::zk_core::types::AuthMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkLogEntry {
    /// Unix timestamp in milliseconds.
    pub timestamp: i64,
    /// "DEBUG" or "ERROR"
    pub level: String,
    pub connection_id: Option<String>,
    pub operation: String,
    pub path: Option<String>,
    pub success: bool,
    /// Elapsed time for the ZooKeeper call in milliseconds.
    pub duration_ms: u64,
    /// Short human-readable summary for debugging.
    pub message: String,
    pub error: Option<String>,
    /// Optional structured extras (e.g. children_count, data_length).
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequestDto {
    pub connection_string: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl ConnectRequestDto {
    pub fn auth_mode(&self) -> AuthMode {
        match (&self.username, &self.password) {
            (Some(username), Some(password)) if !username.is_empty() && !password.is_empty() => {
                AuthMode::Digest
            }
            _ => AuthMode::Anonymous,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatusDto {
    pub connected: bool,
    pub auth_mode: AuthMode,
    pub auth_succeeded: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEventDto {
    pub connection_id: String,
    pub event_type: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEventDto {
    pub connection_id: String,
    pub event_type: String,
    pub parent_path: Option<String>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTreeNodeDto {
    pub path: String,
    pub name: String,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTreeNodeDto {
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSnapshotDto {
    pub status: String,
    pub nodes: Vec<CachedTreeNodeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDetailsDto {
    pub path: String,
    pub value: String,
    pub format_hint: Option<String>,
    pub data_kind: DataKind,
    pub display_mode_label: String,
    pub editable: bool,
    pub raw_preview: String,
    pub decoded_preview: String,
    pub version: i32,
    pub children_count: usize,
    pub updated_at: String,
    pub c_version: i32,
    pub acl_version: i32,
    pub c_zxid: Option<String>,
    pub m_zxid: Option<String>,
    pub c_time: i64,
    pub m_time: i64,
    pub data_length: i32,
    pub ephemeral: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParserPluginRunResultDto {
    pub plugin_id: String,
    pub plugin_name: String,
    pub content: String,
    pub generated_at: i64,
}
