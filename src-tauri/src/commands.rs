use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State, Wry};

use crate::domain::{
    ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto,
    ParserPluginRunResultDto, TreeSnapshotDto, ZkLogEntry,
};
use crate::logging::ZkLogStore;
use crate::parser_plugins::{discover_plugins, run_plugin_with_bytes, to_dtos, ParserPluginDto};
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::live::LiveAdapter;
use crate::zk_core::mock::MockAdapter;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
    pub log_store: Arc<ZkLogStore>,
    pub app_handle: Option<AppHandle<Wry>>,
    plugin_root: PathBuf,
}

impl AppState {
    pub fn new(log_path: PathBuf, app_handle: AppHandle<Wry>) -> Self {
        let plugin_root = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("plugins");
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: Some(app_handle),
            plugin_root,
        }
    }

    pub fn new_for_tests(log_path: PathBuf) -> Self {
        Self::new_for_tests_with_plugin_root(log_path, PathBuf::from("target/test-plugins"))
    }

    pub fn new_for_tests_with_plugin_root(log_path: PathBuf, plugin_root: PathBuf) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: None,
            plugin_root,
        }
    }

    pub fn plugin_root(&self) -> PathBuf {
        self.plugin_root.clone()
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
pub fn disconnect_server(connection_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    if let Some(adapter) = sessions.remove(&connection_id) {
        adapter.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub fn list_children(
    connection_id: String,
    path: String,
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
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
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
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
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
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
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
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    };
    match adapter {
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

#[tauri::command]
pub fn list_parser_plugins(state: State<'_, AppState>) -> Result<Vec<ParserPluginDto>, String> {
    let definitions = discover_plugins(&state.plugin_root())?;
    Ok(to_dtos(&definitions))
}

#[tauri::command]
pub fn run_parser_plugin(
    connection_id: String,
    path: String,
    plugin_id: String,
    state: State<'_, AppState>,
) -> Result<ParserPluginRunResultDto, String> {
    let adapter = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to acquire sessions lock".to_string())?;
        sessions.get(&connection_id).cloned()
    }
    .ok_or_else(|| format!("no active session for connection {connection_id}"))?;

    let plugin = discover_plugins(&state.plugin_root())?
        .into_iter()
        .find(|definition| definition.manifest.id == plugin_id)
        .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;

    let bytes = adapter.get_node_bytes(&path)?;
    let output = run_plugin_with_bytes(&plugin, &bytes, 5_000)?;

    Ok(ParserPluginRunResultDto {
        plugin_id: plugin.manifest.id,
        plugin_name: plugin.manifest.name,
        content: output.stdout,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    })
}
