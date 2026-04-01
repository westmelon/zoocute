use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Wry};

use crate::domain::{
    ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto,
    ParserPluginRunResultDto, TreeSnapshotDto, ZkLogEntry,
};
use crate::logging::ZkLogStore;
use crate::parser_plugins::{
    discover_plugins_with_diagnostics, run_plugin_with_bytes, to_dtos, ParserPluginDefinition,
    ParserPluginDto, PluginDiscoveryWarning,
};
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::live::LiveAdapter;
use crate::zk_core::mock::MockAdapter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub theme: String,
    pub write_mode: String,
    pub plugin_directory: Option<String>,
}

impl Default for AppSettingsDto {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            write_mode: "readonly".to_string(),
            plugin_directory: None,
        }
    }
}

pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
    pub log_store: Arc<ZkLogStore>,
    pub app_handle: Option<AppHandle<Wry>>,
    settings: Mutex<AppSettingsDto>,
    settings_path: PathBuf,
    default_plugin_root: PathBuf,
}

impl AppState {
    pub fn new(log_path: PathBuf, app_handle: AppHandle<Wry>) -> Self {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let settings_path = app_data_dir.join("settings.json");
        let default_plugin_root = app_data_dir.join("plugins");
        let settings = load_settings_from_path(&settings_path);
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: Some(app_handle),
            settings: Mutex::new(settings),
            settings_path,
            default_plugin_root,
        }
    }

    pub fn new_for_tests(log_path: PathBuf) -> Self {
        Self::new_for_tests_with_paths(
            log_path,
            PathBuf::from("target/test-settings.json"),
            PathBuf::from("target/test-plugins"),
        )
    }

    pub fn new_for_tests_with_plugin_root(log_path: PathBuf, plugin_root: PathBuf) -> Self {
        Self::new_for_tests_with_paths(log_path, PathBuf::from("target/test-settings.json"), plugin_root)
    }

    pub fn new_for_tests_with_paths(
        log_path: PathBuf,
        settings_path: PathBuf,
        default_plugin_root: PathBuf,
    ) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store: Arc::new(ZkLogStore::new(log_path)),
            app_handle: None,
            settings: Mutex::new(load_settings_from_path(&settings_path)),
            settings_path,
            default_plugin_root,
        }
    }

    pub fn plugin_root(&self) -> PathBuf {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "failed to acquire settings lock".to_string())
            .ok();
        if let Some(plugin_directory) = settings.and_then(|settings| settings.plugin_directory.clone())
        {
            return PathBuf::from(plugin_directory);
        }
        self.default_plugin_root.clone()
    }

    pub fn get_settings(&self) -> AppSettingsDto {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn set_write_mode(&self, write_mode: String) -> Result<AppSettingsDto, String> {
        match write_mode.as_str() {
            "readonly" | "readwrite" => self.update_settings(|settings| {
                settings.write_mode = write_mode;
            }),
            _ => Err(format!("invalid write mode: {write_mode}")),
        }
    }

    pub fn set_theme(&self, theme: String) -> Result<AppSettingsDto, String> {
        match theme.as_str() {
            "system" | "light" | "dark" => self.update_settings(|settings| {
                settings.theme = theme;
            }),
            _ => Err(format!("invalid theme preference: {theme}")),
        }
    }

    pub fn set_plugin_directory(
        &self,
        plugin_directory: Option<String>,
    ) -> Result<AppSettingsDto, String> {
        self.update_settings(|settings| {
            settings.plugin_directory = plugin_directory.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            });
        })
    }

    pub fn ensure_write_enabled(&self) -> Result<(), String> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "failed to acquire settings lock".to_string())?;
        if settings.write_mode == "readonly" {
            return Err("当前为只读模式，禁止新增、修改、删除节点。".to_string());
        }
        Ok(())
    }

    pub fn default_plugin_root(&self) -> PathBuf {
        self.default_plugin_root.clone()
    }

    fn update_settings<F>(&self, update: F) -> Result<AppSettingsDto, String>
    where
        F: FnOnce(&mut AppSettingsDto),
    {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| "failed to acquire settings lock".to_string())?;
        update(&mut settings);
        persist_settings_to_path(&self.settings_path, &settings)?;
        Ok(settings.clone())
    }
}

fn load_settings_from_path(path: &PathBuf) -> AppSettingsDto {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppSettingsDto>(&raw).ok())
        .unwrap_or_default()
}

fn persist_settings_to_path(path: &PathBuf, settings: &AppSettingsDto) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn open_path_in_file_manager(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map_err(|error| format!("failed to open directory {}: {error}", path.display()))?;
    Ok(())
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
    state.ensure_write_enabled()?;
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
    state.ensure_write_enabled()?;
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
    state.ensure_write_enabled()?;
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
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettingsDto, String> {
    Ok(state.get_settings())
}

#[tauri::command]
pub fn set_theme_preference(
    theme: String,
    state: State<'_, AppState>,
) -> Result<AppSettingsDto, String> {
    state.set_theme(theme)
}

#[tauri::command]
pub fn set_write_mode(
    write_mode: String,
    state: State<'_, AppState>,
) -> Result<AppSettingsDto, String> {
    state.set_write_mode(write_mode)
}

#[tauri::command]
pub fn choose_plugin_directory(state: State<'_, AppState>) -> Result<Option<AppSettingsDto>, String> {
    let selected = rfd::FileDialog::new().pick_folder();
    match selected {
        Some(path) => state.set_plugin_directory(Some(path.display().to_string())).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn reset_plugin_directory(state: State<'_, AppState>) -> Result<AppSettingsDto, String> {
    state.set_plugin_directory(None)
}

#[tauri::command]
pub fn get_effective_plugin_directory(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.plugin_root().display().to_string())
}

#[tauri::command]
pub fn open_plugin_directory(state: State<'_, AppState>) -> Result<(), String> {
    let plugin_root = state.plugin_root();
    fs::create_dir_all(&plugin_root).map_err(|error| {
        format!(
            "failed to prepare plugin directory {}: {error}",
            plugin_root.display()
        )
    })?;
    open_path_in_file_manager(&plugin_root)
}

#[tauri::command]
pub fn list_parser_plugins(state: State<'_, AppState>) -> Result<Vec<ParserPluginDto>, String> {
    list_parser_plugins_impl(&state)
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

    run_parser_plugin_with_loader(&state, &connection_id, &path, &plugin_id, |node_path| {
        adapter.get_node_bytes(node_path)
    })
}

fn list_parser_plugins_impl(state: &AppState) -> Result<Vec<ParserPluginDto>, String> {
    let report = discover_plugins_with_diagnostics(&state.plugin_root())?;
    log_plugin_discovery_warnings(state, &report.warnings);
    Ok(to_dtos(&report.plugins))
}

fn run_parser_plugin_with_loader<F>(
    state: &AppState,
    _connection_id: &str,
    path: &str,
    plugin_id: &str,
    load_bytes: F,
) -> Result<ParserPluginRunResultDto, String>
where
    F: FnOnce(&str) -> Result<Vec<u8>, String>,
{
    let report = discover_plugins_with_diagnostics(&state.plugin_root())?;
    log_plugin_discovery_warnings(state, &report.warnings);
    let plugin = find_plugin(report.plugins, plugin_id)?;
    let bytes = load_bytes(path)?;
    let output = run_plugin_with_bytes(&plugin, &bytes, 5_000)?;

    Ok(ParserPluginRunResultDto {
        plugin_id: plugin.manifest.id.clone(),
        plugin_name: plugin.manifest.name.clone(),
        content: output.stdout,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    })
}

fn find_plugin(
    plugins: Vec<ParserPluginDefinition>,
    plugin_id: &str,
) -> Result<ParserPluginDefinition, String> {
    plugins
        .into_iter()
        .find(|definition| definition.manifest.id == plugin_id)
        .ok_or_else(|| format!("plugin not found: {plugin_id}"))
}

fn log_plugin_discovery_warnings(state: &AppState, warnings: &[PluginDiscoveryWarning]) {
    for warning in warnings {
        state.log_store.append_operation(
            None,
            "parser_plugin_discovery_warning",
            None,
            false,
            &warning.message,
            None,
            Some(serde_json::json!({
                "manifestPath": warning.manifest_path.display().to_string(),
            })),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{list_parser_plugins_impl, run_parser_plugin_with_loader, AppState};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zoocute-{name}-{suffix}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_manifest(dir: &PathBuf, contents: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("plugin.json"), contents).unwrap();
    }

    #[cfg(windows)]
    fn echo_command_args() -> (&'static str, Vec<&'static str>) {
        (
            "powershell",
            vec![
                "-NoProfile",
                "-Command",
                "$reader = New-Object System.IO.BinaryReader([Console]::OpenStandardInput()); $bytes = $reader.ReadBytes(4); [Console]::Out.Write([System.BitConverter]::ToString($bytes))",
            ],
        )
    }

    #[cfg(not(windows))]
    fn echo_command_args() -> (&'static str, Vec<&'static str>) {
        (
            "sh",
            vec![
                "-c",
                "python3 -c 'import sys; data=sys.stdin.buffer.read(4); sys.stdout.write(\"-\".join(f\"{b:02X}\" for b in data))'",
            ],
        )
    }

    #[test]
    fn list_parser_plugins_impl_returns_valid_plugins_and_logs_invalid_manifests() {
        let plugin_root = temp_dir("command-list-plugins");
        let log_path = plugin_root.join("command-log.jsonl");
        write_manifest(
            &plugin_root.join("valid"),
            r#"{
                "id": "valid",
                "name": "Valid Decoder",
                "enabled": true,
                "command": "java"
            }"#,
        );
        write_manifest(
            &plugin_root.join("invalid"),
            r#"{
                "name": "Broken",
                "enabled": true,
                "command": "java"
            }"#,
        );
        let state = AppState::new_for_tests_with_plugin_root(log_path, plugin_root);

        let plugins = list_parser_plugins_impl(&state).expect("plugins should load");
        let logs = state.log_store.read_recent(10).expect("logs should load");

        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "valid");
        assert!(logs.iter().any(|entry| {
            entry.operation == "parser_plugin_discovery_warning"
                && entry.message.contains("id")
        }));
    }

    #[test]
    fn run_parser_plugin_with_loader_executes_plugin_lookup_and_maps_result_dto() {
        let plugin_root = temp_dir("command-run-plugin");
        let log_path = plugin_root.join("command-log.jsonl");
        let (command, args) = echo_command_args();
        write_manifest(
            &plugin_root.join("echoer"),
            &format!(
                r#"{{
                    "id": "echoer",
                    "name": "Echoer",
                    "enabled": true,
                    "command": "{command}",
                    "args": {args}
                }}"#,
                args = serde_json::to_string(&args).unwrap(),
            ),
        );
        let state = AppState::new_for_tests_with_plugin_root(log_path, plugin_root);

        let result = run_parser_plugin_with_loader(
            &state,
            "conn-a",
            "/services/session_blob",
            "echoer",
            |_| Ok(vec![0xDE, 0xAD, 0xBE, 0xEF]),
        )
        .expect("plugin should run");

        assert_eq!(result.plugin_id, "echoer");
        assert_eq!(result.plugin_name, "Echoer");
        assert_eq!(result.content.trim(), "DE-AD-BE-EF");
        assert!(result.generated_at > 0);
    }
}
