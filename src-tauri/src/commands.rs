use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, State, Wry};

use crate::domain::{
    ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto, TreeSnapshotDto,
    ZkLogEntry,
};
use crate::logging::ZkLogStore;
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::live::LiveAdapter;
use crate::zk_core::mock::MockAdapter;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
    pub log_store: Arc<ZkLogStore>,
    pub app_handle: Option<AppHandle<Wry>>,
}

impl AppState {
    pub fn new(log_path: PathBuf, app_handle: AppHandle<Wry>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: Some(app_handle),
        }
    }

    pub fn new_for_tests(log_path: PathBuf) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: None,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new_for_tests(PathBuf::from("target/test-zookeeper-debug.jsonl"))
    }
}

#[tauri::command]
pub fn connect_server(
    connection_id: String,
    request: ConnectRequestDto,
    state: State<'_, AppState>,
) -> Result<ConnectionStatusDto, String> {
    let log_store = Arc::clone(&state.log_store);
    let app_handle = state
        .app_handle
        .as_ref()
        .cloned()
        .ok_or_else(|| "app handle unavailable".to_string())?;
    let (adapter, result) =
        LiveAdapter::connect_live(&connection_id, &request, log_store, app_handle)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    sessions.insert(connection_id, adapter);
    Ok(result)
}

#[tauri::command]
pub fn disconnect_server(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    sessions.remove(&connection_id);
    Ok(())
}

#[tauri::command]
pub fn list_children(
    connection_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<LoadedTreeNodeDto>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.list_children(&path),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn get_node_details(
    connection_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<NodeDetailsDto, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.get_node(&path),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn get_tree_snapshot(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<TreeSnapshotDto, String> {
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
        Some(adapter) => adapter.get_tree_snapshot(),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn save_node(
    connection_id: String,
    path: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.save_node(&path, &value),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn create_node(
    connection_id: String,
    path: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.create_node(&path, &data),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn delete_node(
    connection_id: String,
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.delete_node(&path, recursive),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

/// Recursively fetch every node path in the ZK tree.
/// The sessions lock is released before the traversal begins so other
/// commands are not blocked during what could be a long operation.
#[tauri::command]
pub fn load_full_tree(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<LoadedTreeNodeDto>, String> {
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
        Some(a) => a.load_full_tree(),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn read_zk_logs(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<ZkLogEntry>, String> {
    state.log_store.read_recent(limit.unwrap_or(200))
}

#[tauri::command]
pub fn clear_zk_logs(state: State<'_, AppState>) -> Result<(), String> {
    state.log_store.clear()
}
