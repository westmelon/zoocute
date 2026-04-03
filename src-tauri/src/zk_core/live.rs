use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use encoding_rs::{Encoding, GBK, UTF_8, WINDOWS_1252};
use tauri::{async_runtime, AppHandle, Emitter, Wry};
use zookeeper_client::{Acls, Client, CreateMode, EventType, OneshotWatcher, WatchedEvent};

use crate::domain::{
    CacheEventDto, ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto,
    SessionEventDto, TreeSnapshotDto, WatchEventDto, ZkLogEntry,
};
use crate::logging::ZkLogStore;
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::cache::{CacheStatus, ConnectionCache, NodeRecord};
use crate::zk_core::interpreter::{hex_encode, interpret_data};
use crate::zk_core::types::AuthMode;
use zookeeper_client::SessionState;

#[derive(Clone)]
pub struct LiveAdapter {
    client: Arc<Client>,
    connection_id: String,
    log_store: Arc<ZkLogStore>,
    app_handle: AppHandle<Wry>,
    auth_mode: AuthMode,
    children_watch_paths: Arc<std::sync::Mutex<HashSet<String>>>,
    data_watch_paths: Arc<std::sync::Mutex<HashSet<String>>>,
    cache: Arc<std::sync::Mutex<ConnectionCache>>,
    shutdown: Arc<AtomicBool>,
}

#[derive(Clone)]
struct ChildrenWatcher {
    client: Weak<Client>,
    app_handle: AppHandle<Wry>,
    connection_id: String,
    path: String,
    log_store: Arc<ZkLogStore>,
    active_paths: Arc<std::sync::Mutex<HashSet<String>>>,
    cache: Arc<std::sync::Mutex<ConnectionCache>>,
    shutdown: Arc<AtomicBool>,
}

#[derive(Clone)]
struct DataWatcher {
    client: Weak<Client>,
    app_handle: AppHandle<Wry>,
    connection_id: String,
    path: String,
    log_store: Arc<ZkLogStore>,
    active_paths: Arc<std::sync::Mutex<HashSet<String>>>,
    shutdown: Arc<AtomicBool>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn emit_watch_event(
    app_handle: &AppHandle<Wry>,
    connection_id: &str,
    event_type: &str,
    path: &str,
) {
    let _ = app_handle.emit(
        "zk-watch-event",
        WatchEventDto {
            connection_id: connection_id.to_string(),
            event_type: event_type.to_string(),
            path: path.to_string(),
        },
    );
}

fn emit_session_event(app_handle: &AppHandle<Wry>, connection_id: &str, event_type: &str) {
    let _ = app_handle.emit(
        "zk-session-event",
        SessionEventDto {
            connection_id: connection_id.to_string(),
            event_type: event_type.to_string(),
        },
    );
}

fn emit_cache_event(
    app_handle: &AppHandle<Wry>,
    connection_id: &str,
    event_type: &str,
    parent_path: Option<&str>,
    paths: Vec<String>,
) {
    let Some(event_type) = map_cache_event_type(event_type) else {
        return;
    };
    let _ = app_handle.emit(
        "zk-cache-event",
        CacheEventDto {
            connection_id: connection_id.to_string(),
            event_type: event_type.to_string(),
            parent_path: parent_path.map(|path| path.to_string()),
            paths,
        },
    );
}

fn snapshot_ready_cache_event(connection_id: &str) -> CacheEventDto {
    CacheEventDto {
        connection_id: connection_id.to_string(),
        event_type: "snapshot_ready".to_string(),
        parent_path: None,
        paths: Vec::new(),
    }
}

fn append_watch_log(
    log_store: &ZkLogStore,
    connection_id: &str,
    operation: &str,
    path: &str,
    success: bool,
    message: String,
    meta: Option<serde_json::Value>,
    error: Option<String>,
) {
    log_store.append(&ZkLogEntry {
        timestamp: now_millis(),
        level: if success {
            "DEBUG".into()
        } else {
            "ERROR".into()
        },
        connection_id: Some(connection_id.to_string()),
        operation: operation.to_string(),
        path: Some(path.to_string()),
        success,
        duration_ms: 0,
        message,
        error,
        meta,
    });
}

fn classify_missing_node_race(error: &str) -> Option<(String, serde_json::Value)> {
    if error.contains("NoNode") || error.contains("no node") {
        Some((
            "target disappeared before follow-up operation".into(),
            serde_json::json!({ "benignRace": true, "reason": "NoNode" }),
        ))
    } else {
        None
    }
}

fn should_register_watch(
    active_paths: &Arc<std::sync::Mutex<HashSet<String>>>,
    path: &str,
) -> bool {
    let mut guard = active_paths.lock().unwrap_or_else(|e| e.into_inner());
    guard.insert(path.to_string())
}

fn clear_active_watch(active_paths: &Arc<std::sync::Mutex<HashSet<String>>>, path: &str) {
    let mut guard = active_paths.lock().unwrap_or_else(|e| e.into_inner());
    guard.remove(path);
}

fn is_shutdown(shutdown: &Arc<AtomicBool>) -> bool {
    shutdown.load(Ordering::SeqCst)
}

fn upgrade_client(client: &Weak<Client>) -> Result<Arc<Client>, String> {
    client
        .upgrade()
        .ok_or_else(|| "client disconnected".to_string())
}

fn spawn_children_watch_task(watcher: ChildrenWatcher, oneshot: OneshotWatcher) {
    async_runtime::spawn(async move {
        handle_children_watch_event(watcher, oneshot.changed().await);
    });
}

fn handle_children_watch_event(watcher: ChildrenWatcher, event: WatchedEvent) {
    clear_active_watch(&watcher.active_paths, &watcher.path);
    if is_shutdown(&watcher.shutdown) {
        return;
    }
    append_watch_log(
        &watcher.log_store,
        &watcher.connection_id,
        "watch_children_triggered",
        &watcher.path,
        true,
        "children watch triggered".into(),
        Some(serde_json::json!({
            "rawEventType": format!("{:?}", event.event_type),
            "sessionState": format!("{:?}", event.session_state),
        })),
        None,
    );

    let Some((event_type, should_reregister)) = map_children_watch_event(event.event_type) else {
        return;
    };

    emit_watch_event(
        &watcher.app_handle,
        &watcher.connection_id,
        event_type,
        &watcher.path,
    );
    append_watch_log(
        &watcher.log_store,
        &watcher.connection_id,
        "watch_emit",
        &watcher.path,
        true,
        format!("emitted {event_type}"),
        None,
        None,
    );

    if should_reregister {
        async_runtime::spawn_blocking(move || {
            if is_shutdown(&watcher.shutdown) {
                return;
            }
            let result = if event_type == "children_changed" {
                refresh_cached_children(&watcher)
            } else {
                register_children_watch(&watcher).map(|_| CacheChildDelta {
                    added: Vec::new(),
                    removed: Vec::new(),
                })
            };
            match result {
                Ok(delta) => {
                    if !delta.added.is_empty() {
                        emit_cache_event(
                            &watcher.app_handle,
                            &watcher.connection_id,
                            "nodes_added",
                            Some(&watcher.path),
                            delta.added,
                        );
                    }
                    if !delta.removed.is_empty() {
                        emit_cache_event(
                            &watcher.app_handle,
                            &watcher.connection_id,
                            "nodes_removed",
                            Some(&watcher.path),
                            delta.removed,
                        );
                    }
                    append_watch_log(
                        &watcher.log_store,
                        &watcher.connection_id,
                        "watch_reregister_children",
                        &watcher.path,
                        true,
                        "re-registered children watch".into(),
                        None,
                        None,
                    )
                }
                Err(error) => {
                    if let Some((message, meta)) = classify_missing_node_race(&error) {
                        append_watch_log(
                            &watcher.log_store,
                            &watcher.connection_id,
                            "watch_reregister_children",
                            &watcher.path,
                            true,
                            message,
                            Some(meta),
                            None,
                        );
                    } else {
                        append_watch_log(
                            &watcher.log_store,
                            &watcher.connection_id,
                            "watch_reregister_children",
                            &watcher.path,
                            false,
                            "failed to re-register children watch".into(),
                            None,
                            Some(error),
                        );
                    }
                }
            }
        });
    }
}

fn spawn_data_watch_task(watcher: DataWatcher, oneshot: OneshotWatcher) {
    async_runtime::spawn(async move {
        handle_data_watch_event(watcher, oneshot.changed().await);
    });
}

fn handle_data_watch_event(watcher: DataWatcher, event: WatchedEvent) {
    clear_active_watch(&watcher.active_paths, &watcher.path);
    if is_shutdown(&watcher.shutdown) {
        return;
    }
    append_watch_log(
        &watcher.log_store,
        &watcher.connection_id,
        "watch_data_triggered",
        &watcher.path,
        true,
        "data watch triggered".into(),
        Some(serde_json::json!({
            "rawEventType": format!("{:?}", event.event_type),
            "sessionState": format!("{:?}", event.session_state),
        })),
        None,
    );

    let Some((event_type, should_reregister)) = map_data_watch_event(event.event_type) else {
        return;
    };

    emit_watch_event(
        &watcher.app_handle,
        &watcher.connection_id,
        event_type,
        &watcher.path,
    );
    append_watch_log(
        &watcher.log_store,
        &watcher.connection_id,
        "watch_emit",
        &watcher.path,
        true,
        format!("emitted {event_type}"),
        None,
        None,
    );

    if should_reregister {
        async_runtime::spawn_blocking(move || {
            if is_shutdown(&watcher.shutdown) {
                return;
            }
            let result = register_data_watch(&watcher).map(|_| ());
            match result {
                Ok(_) => append_watch_log(
                    &watcher.log_store,
                    &watcher.connection_id,
                    "watch_reregister_data",
                    &watcher.path,
                    true,
                    "re-registered data watch".into(),
                    None,
                    None,
                ),
                Err(error) => append_watch_log(
                    &watcher.log_store,
                    &watcher.connection_id,
                    "watch_reregister_data",
                    &watcher.path,
                    false,
                    "failed to re-register data watch".into(),
                    None,
                    Some(error),
                ),
            }
        });
    }
}

fn register_children_watch(watcher: &ChildrenWatcher) -> Result<Vec<String>, String> {
    if is_shutdown(&watcher.shutdown) {
        return Err("client disconnected".to_string());
    }
    let client = upgrade_client(&watcher.client)?;
    if should_register_watch(&watcher.active_paths, &watcher.path) {
        match async_runtime::block_on(client.list_and_watch_children(&watcher.path))
            .map_err(map_zk_error)
        {
            Ok((children, oneshot)) => {
                spawn_children_watch_task(watcher.clone(), oneshot);
                Ok(children)
            }
            Err(error) => {
                clear_active_watch(&watcher.active_paths, &watcher.path);
                Err(error)
            }
        }
    } else {
        async_runtime::block_on(client.list_children(&watcher.path)).map_err(map_zk_error)
    }
}

fn register_data_watch(watcher: &DataWatcher) -> Result<(Vec<u8>, zookeeper_client::Stat), String> {
    if is_shutdown(&watcher.shutdown) {
        return Err("client disconnected".to_string());
    }
    let client = upgrade_client(&watcher.client)?;
    if should_register_watch(&watcher.active_paths, &watcher.path) {
        match async_runtime::block_on(client.get_and_watch_data(&watcher.path))
            .map_err(map_zk_error)
        {
            Ok((data, stat, oneshot)) => {
                spawn_data_watch_task(watcher.clone(), oneshot);
                Ok((data, stat))
            }
            Err(error) => {
                clear_active_watch(&watcher.active_paths, &watcher.path);
                Err(error)
            }
        }
    } else {
        async_runtime::block_on(client.get_data(&watcher.path)).map_err(map_zk_error)
    }
}

fn map_children_watch_event(event_type: EventType) -> Option<(&'static str, bool)> {
    match event_type {
        EventType::NodeChildrenChanged | EventType::NodeCreated => Some(("children_changed", true)),
        EventType::NodeDeleted => Some(("node_deleted", false)),
        _ => None,
    }
}

fn map_data_watch_event(event_type: EventType) -> Option<(&'static str, bool)> {
    match event_type {
        EventType::NodeDataChanged => Some(("data_changed", true)),
        EventType::NodeDeleted => Some(("node_deleted", false)),
        _ => None,
    }
}

impl LiveAdapter {
    pub fn connect_live(
        connection_id: &str,
        request: &ConnectRequestDto,
        log_store: Arc<ZkLogStore>,
        app_handle: AppHandle<Wry>,
    ) -> Result<(Self, ConnectionStatusDto), String> {
        let start = Instant::now();

        // Use an immediately-invoked closure so all early-return paths share
        // the same post-operation logging block below.
        let outcome: Result<(Client, ConnectionStatusDto), String> = (|| {
            let client = connect_client(request)?;

            let status = ConnectionStatusDto {
                connected: true,
                auth_mode: request.auth_mode(),
                auth_succeeded: true,
                message: format!("connected to {}", request.connection_string),
            };
            Ok((client, status))
        })();

        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = outcome.is_ok();
        log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(connection_id.to_string()),
            operation: "connect".into(),
            path: None,
            success: ok,
            duration_ms,
            message: if ok {
                "connect succeeded".into()
            } else {
                "connect failed".into()
            },
            error: outcome.as_ref().err().cloned(),
            meta: Some(serde_json::json!({ "authMode": request.auth_mode() })),
        });

        let (client, status) = outcome?;
        let adapter = Self {
            client: Arc::new(client),
            connection_id: connection_id.to_string(),
            log_store,
            app_handle,
            auth_mode: request.auth_mode(),
            children_watch_paths: Arc::new(std::sync::Mutex::new(HashSet::new())),
            data_watch_paths: Arc::new(std::sync::Mutex::new(HashSet::new())),
            cache: Arc::new(std::sync::Mutex::new(ConnectionCache::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
        };
        adapter.spawn_state_watch_task();
        mark_cache_resyncing(&adapter.cache);
        append_cache_resync_log(
            &adapter.log_store,
            &adapter.connection_id,
            "cache_resync_started",
            "/",
        );
        adapter.bootstrap_subtree_cache();
        Ok((adapter, status))
    }

    pub fn bootstrap_subtree_cache(&self) {
        let client = Arc::downgrade(&self.client);
        let cache = Arc::clone(&self.cache);
        let connection_id = self.connection_id.clone();
        let log_store = Arc::clone(&self.log_store);
        let app_handle = self.app_handle.clone();
        let shutdown = Arc::clone(&self.shutdown);

        async_runtime::spawn_blocking(move || {
            if is_shutdown(&shutdown) {
                return;
            }
            let Ok(client) = upgrade_client(&client) else {
                return;
            };
            append_cache_log(&log_store, &connection_id, "cache_bootstrap_started", "/");
            match collect_full_tree_records(client.as_ref()) {
                Ok(nodes) => {
                    if is_shutdown(&shutdown) {
                        return;
                    }
                    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
                    guard.replace_all(nodes);
                    guard.mark_live();
                    append_cache_resync_log(
                        &log_store,
                        &connection_id,
                        "cache_resync_completed",
                        "/",
                    );
                    append_cache_log(&log_store, &connection_id, "cache_bootstrap_completed", "/");
                    let event = snapshot_ready_cache_event(&connection_id);
                    emit_cache_event(
                        &app_handle,
                        &connection_id,
                        &event.event_type,
                        event.parent_path.as_deref(),
                        event.paths,
                    );
                }
                Err(error) => {
                    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
                    guard.set_status(CacheStatus::Stale);
                    append_cache_resync_error_log(
                        &log_store,
                        &connection_id,
                        "cache_resync_failed",
                        "/",
                        &error,
                    );
                    append_cache_error_log(
                        &log_store,
                        &connection_id,
                        "cache_bootstrap_failed",
                        "/",
                        &error,
                    );
                }
            }
        });
    }

    fn spawn_state_watch_task(&self) {
        let mut watcher = self.client.state_watcher();
        let connection_id = self.connection_id.clone();
        let log_store = Arc::clone(&self.log_store);
        let app_handle = self.app_handle.clone();
        let shutdown = Arc::clone(&self.shutdown);

        async_runtime::spawn(async move {
            loop {
                if is_shutdown(&shutdown) {
                    return;
                }

                let state = watcher.changed().await;
                if is_shutdown(&shutdown) {
                    return;
                }

                let Some(event_type) = map_session_state_event(state) else {
                    if is_terminal_session_state(state) {
                        return;
                    }
                    continue;
                };

                emit_session_event(&app_handle, &connection_id, event_type);
                append_watch_log(
                    &log_store,
                    &connection_id,
                    "session_state_changed",
                    "/",
                    true,
                    format!("session state changed to {event_type}"),
                    Some(serde_json::json!({
                        "sessionState": format!("{state:?}"),
                    })),
                    None,
                );

                if is_terminal_session_state(state) {
                    return;
                }
            }
        });
    }

    pub fn save_node(&self, path: &str, value: &str, charset: &str) -> Result<(), String> {
        let start = Instant::now();
        let encoded = encode_node_value(value, charset)?;
        let result = async_runtime::block_on(self.client.set_data(path, &encoded, None))
            .map(|_| ())
            .map_err(map_zk_error);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = result.is_ok();
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(self.connection_id.clone()),
            operation: "save_node".into(),
            path: Some(path.to_string()),
            success: ok,
            duration_ms,
            message: if ok {
                "save_node succeeded".into()
            } else {
                "save_node failed".into()
            },
            error: result.as_ref().err().cloned(),
            meta: None,
        });
        result
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.children_watch_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.data_watch_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    pub fn create_node(&self, path: &str, data: &str) -> Result<(), String> {
        let start = Instant::now();
        let acls = if self.auth_mode == AuthMode::Digest {
            Acls::creator_all()
        } else {
            Acls::anyone_all()
        };
        let result = async_runtime::block_on(self.client.create(
            path,
            data.as_bytes(),
            &CreateMode::Persistent.with_acls(acls),
        ))
        .map(|_| ())
        .map_err(map_zk_error);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = result.is_ok();
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(self.connection_id.clone()),
            operation: "create_node".into(),
            path: Some(path.to_string()),
            success: ok,
            duration_ms,
            message: if ok {
                "create_node succeeded".into()
            } else {
                "create_node failed".into()
            },
            error: result.as_ref().err().cloned(),
            meta: None,
        });
        result
    }

    pub fn delete_node(&self, path: &str, recursive: bool) -> Result<(), String> {
        if recursive {
            self.delete_recursive(path)
        } else {
            let start = Instant::now();
            let result =
                async_runtime::block_on(self.client.delete(path, None)).map_err(map_zk_error);
            let duration_ms = start.elapsed().as_millis() as u64;
            let ok = result.is_ok();
            self.log_store.append(&ZkLogEntry {
                timestamp: now_millis(),
                level: if ok { "DEBUG".into() } else { "ERROR".into() },
                connection_id: Some(self.connection_id.clone()),
                operation: "delete_node".into(),
                path: Some(path.to_string()),
                success: ok,
                duration_ms,
                message: if ok {
                    "delete_node succeeded".into()
                } else {
                    "delete_node failed".into()
                },
                error: result.as_ref().err().cloned(),
                meta: None,
            });
            result
        }
    }

    /// Recursively deletes children then the node itself.
    /// Each individual `client.delete()` call produces its own log entry so
    /// partial failures in deep trees can be traced to the exact path.
    /// Recursively fetch every node in the ZK tree and return a flat list.
    /// One `get_children` call per node — no node data is fetched.
    /// The sessions lock is NOT held during this call (caller clones the adapter first).
    pub fn load_full_tree(&self) -> Result<Vec<LoadedTreeNodeDto>, String> {
        let start = Instant::now();
        let mut nodes = Vec::new();
        let outcome = self.collect_subtree("/", &mut nodes);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = outcome.is_ok();
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(self.connection_id.clone()),
            operation: "load_full_tree".into(),
            path: Some("/".into()),
            success: ok,
            duration_ms,
            message: if ok {
                format!("load_full_tree succeeded, {} nodes", nodes.len())
            } else {
                "load_full_tree failed".into()
            },
            error: outcome.as_ref().err().cloned(),
            meta: if ok {
                Some(serde_json::json!({ "nodeCount": nodes.len() }))
            } else {
                None
            },
        });
        outcome?;
        Ok(nodes)
    }

    pub fn get_tree_snapshot(&self) -> Result<TreeSnapshotDto, String> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        Ok(cache.to_snapshot())
    }

    /// Enumerate all children of `path` and recurse into each one.
    fn collect_subtree(
        &self,
        path: &str,
        result: &mut Vec<LoadedTreeNodeDto>,
    ) -> Result<(), String> {
        let (children, _) =
            async_runtime::block_on(self.client.get_children(path)).map_err(map_zk_error)?;
        for name in children {
            let child_path = if path == "/" {
                format!("/{name}")
            } else {
                format!("{path}/{name}")
            };
            self.collect_node(&child_path, name, result)?;
        }
        Ok(())
    }

    /// Push `path` into `result` then recurse into its children.
    /// Requires exactly one `get_children` call per node.
    fn collect_node(
        &self,
        path: &str,
        name: String,
        result: &mut Vec<LoadedTreeNodeDto>,
    ) -> Result<(), String> {
        let (children, _) =
            async_runtime::block_on(self.client.get_children(path)).map_err(map_zk_error)?;
        result.push(LoadedTreeNodeDto {
            path: path.to_string(),
            name,
            has_children: !children.is_empty(),
        });
        for child_name in children {
            let child_path = format!("{path}/{child_name}");
            self.collect_node(&child_path, child_name, result)?;
        }
        Ok(())
    }

    fn delete_recursive(&self, path: &str) -> Result<(), String> {
        self.delete_recursive_inner(path, 0)
    }

    fn delete_recursive_inner(&self, path: &str, depth: usize) -> Result<(), String> {
        if depth > 500 {
            return Err(format!(
                "delete_recursive exceeded maximum depth of 500 at path: {path}"
            ));
        }
        let (children, _) =
            async_runtime::block_on(self.client.get_children(path)).map_err(map_zk_error)?;
        for child in &children {
            let child_path = if path == "/" {
                format!("/{child}")
            } else {
                format!("{path}/{child}")
            };
            self.delete_recursive_inner(&child_path, depth + 1)?;
        }
        let start = Instant::now();
        let result = async_runtime::block_on(self.client.delete(path, None)).map_err(map_zk_error);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = result.is_ok();
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(self.connection_id.clone()),
            operation: "delete_recursive".into(),
            path: Some(path.to_string()),
            success: ok,
            duration_ms,
            message: if ok {
                "delete_recursive succeeded".into()
            } else {
                "delete_recursive child delete failed".into()
            },
            error: result.as_ref().err().cloned(),
            meta: Some(serde_json::json!({ "childrenCount": children.len() })),
        });
        result
    }
}

fn charset_encoding(charset: &str) -> Option<&'static Encoding> {
    match charset {
        "UTF-8" => Some(UTF_8),
        "GBK" => Some(GBK),
        // TextDecoder("iso-8859-1") follows the WHATWG mapping to windows-1252.
        "ISO-8859-1" => Some(WINDOWS_1252),
        _ => None,
    }
}

fn encode_node_value(value: &str, charset: &str) -> Result<Vec<u8>, String> {
    let encoding =
        charset_encoding(charset).ok_or_else(|| format!("unsupported charset: {charset}"))?;
    let (encoded, _, had_errors) = encoding.encode(value);
    if had_errors {
        return Err(format!("当前内容无法使用 {charset} 编码保存"));
    }
    Ok(encoded.into_owned())
}

impl ReadOnlyZkAdapter for LiveAdapter {
    fn connect(&self, request: ConnectRequestDto) -> Result<ConnectionStatusDto, String> {
        Ok(ConnectionStatusDto {
            connected: true,
            auth_mode: request.auth_mode(),
            auth_succeeded: true,
            message: format!("connected to {}", request.connection_string),
        })
    }

    fn list_children(&self, path: &str) -> Result<Vec<LoadedTreeNodeDto>, String> {
        let start = Instant::now();
        let result = self.do_list_children(path);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = result.is_ok();
        let benign_missing = result
            .as_ref()
            .err()
            .and_then(|error| classify_missing_node_race(error));
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok || benign_missing.is_some() {
                "DEBUG".into()
            } else {
                "ERROR".into()
            },
            connection_id: Some(self.connection_id.clone()),
            operation: "list_children".into(),
            path: Some(path.to_string()),
            success: ok || benign_missing.is_some(),
            duration_ms,
            message: if ok {
                "list_children succeeded".into()
            } else if let Some((message, _)) = benign_missing.as_ref() {
                message.clone()
            } else {
                "list_children failed".into()
            },
            error: if benign_missing.is_some() {
                None
            } else {
                result.as_ref().err().cloned()
            },
            meta: if let Some((_, meta)) = benign_missing {
                Some(meta)
            } else {
                result
                    .as_ref()
                    .ok()
                    .map(|v| serde_json::json!({ "childrenCount": v.len() }))
            },
        });
        result
    }

    fn get_node(&self, path: &str) -> Result<NodeDetailsDto, String> {
        let start = Instant::now();
        let result = self.do_get_node(path);
        let duration_ms = start.elapsed().as_millis() as u64;
        let ok = result.is_ok();
        self.log_store.append(&ZkLogEntry {
            timestamp: now_millis(),
            level: if ok { "DEBUG".into() } else { "ERROR".into() },
            connection_id: Some(self.connection_id.clone()),
            operation: "get_node".into(),
            path: Some(path.to_string()),
            success: ok,
            duration_ms,
            message: if ok {
                "get_node succeeded".into()
            } else {
                "get_node failed".into()
            },
            error: result.as_ref().err().cloned(),
            meta: result
                .as_ref()
                .ok()
                .map(|d| serde_json::json!({ "dataLength": d.data_length })),
        });
        result
    }
}

impl LiveAdapter {
    pub fn get_node_bytes(&self, path: &str) -> Result<Vec<u8>, String> {
        let watcher = DataWatcher {
            client: Arc::downgrade(&self.client),
            app_handle: self.app_handle.clone(),
            connection_id: self.connection_id.clone(),
            path: path.to_string(),
            log_store: Arc::clone(&self.log_store),
            active_paths: Arc::clone(&self.data_watch_paths),
            shutdown: Arc::clone(&self.shutdown),
        };
        let (data, _) = register_data_watch(&watcher)?;
        Ok(data)
    }

    fn do_list_children(&self, path: &str) -> Result<Vec<LoadedTreeNodeDto>, String> {
        let watcher = ChildrenWatcher {
            client: Arc::downgrade(&self.client),
            app_handle: self.app_handle.clone(),
            connection_id: self.connection_id.clone(),
            path: path.to_string(),
            log_store: Arc::clone(&self.log_store),
            active_paths: Arc::clone(&self.children_watch_paths),
            cache: Arc::clone(&self.cache),
            shutdown: Arc::clone(&self.shutdown),
        };
        let children = register_children_watch(&watcher)?;
        children
            .into_iter()
            .map(|name| {
                let child_path = if path == "/" {
                    format!("/{name}")
                } else {
                    format!("{path}/{name}")
                };
                let (nested, _) = async_runtime::block_on(self.client.get_children(&child_path))
                    .map_err(map_zk_error)?;
                Ok(LoadedTreeNodeDto {
                    path: child_path,
                    name,
                    has_children: !nested.is_empty(),
                })
            })
            .collect()
    }

    fn do_get_node(&self, path: &str) -> Result<NodeDetailsDto, String> {
        let watcher = DataWatcher {
            client: Arc::downgrade(&self.client),
            app_handle: self.app_handle.clone(),
            connection_id: self.connection_id.clone(),
            path: path.to_string(),
            log_store: Arc::clone(&self.log_store),
            active_paths: Arc::clone(&self.data_watch_paths),
            shutdown: Arc::clone(&self.shutdown),
        };
        let (data, stat) = register_data_watch(&watcher)?;
        let interp = interpret_data(&data);
        let (value, format_hint) = match String::from_utf8(data) {
            Ok(text) => (text, None),
            Err(error) => (hex_encode(error.as_bytes()), Some("binary".to_string())),
        };
        Ok(NodeDetailsDto {
            path: path.to_string(),
            value,
            format_hint,
            data_kind: interp.kind,
            display_mode_label: interp.display_mode_label,
            editable: interp.editable,
            raw_preview: interp.raw_preview,
            decoded_preview: interp.decoded_preview,
            version: stat.version,
            children_count: stat.num_children.max(0) as usize,
            updated_at: stat.mtime.to_string(),
            c_version: stat.cversion,
            acl_version: stat.aversion,
            c_zxid: Some(format!("0x{:x}", stat.czxid)),
            m_zxid: Some(format!("0x{:x}", stat.mzxid)),
            c_time: stat.ctime,
            m_time: stat.mtime,
            data_length: stat.data_length,
            ephemeral: stat.ephemeral_owner != 0,
        })
    }
}

fn connect_client(request: &ConnectRequestDto) -> Result<Client, String> {
    let mut connector = Client::connector().with_session_timeout(Duration::from_millis(request.timeout_ms));
    if let (Some(username), Some(password)) = (&request.username, &request.password) {
        if !username.is_empty() && !password.is_empty() {
            let auth = format!("{username}:{password}");
            connector = connector.with_auth("digest", auth.as_bytes());
        }
    }

    async_runtime::block_on(connector.connect(&request.connection_string)).map_err(map_zk_error)
}

fn map_zk_error(error: zookeeper_client::Error) -> String {
    use zookeeper_client::Error;
    match error {
        Error::NoNode => "NoNode".to_string(),
        Error::NodeExists => "NodeExists".to_string(),
        Error::NotEmpty => "NotEmpty".to_string(),
        Error::BadVersion => "BadVersion".to_string(),
        Error::NoAuth => "NoAuth".to_string(),
        Error::AuthFailed => "AuthFailed".to_string(),
        Error::SessionExpired => "SessionExpired".to_string(),
        Error::ConnectionLoss => "ConnectionLoss".to_string(),
        Error::Timeout => "Timeout".to_string(),
        Error::ClientClosed => "ClientClosed".to_string(),
        other => format!("{other:?}"),
    }
}

fn map_session_state_event(state: SessionState) -> Option<&'static str> {
    match state {
        SessionState::SyncConnected | SessionState::ConnectedReadOnly => Some("connected"),
        SessionState::Disconnected => Some("disconnected"),
        SessionState::Expired => Some("expired"),
        SessionState::AuthFailed => Some("auth_failed"),
        SessionState::Closed => Some("closed"),
    }
}

fn is_terminal_session_state(state: SessionState) -> bool {
    matches!(state, SessionState::Expired | SessionState::AuthFailed | SessionState::Closed)
}

fn append_cache_log(log_store: &ZkLogStore, connection_id: &str, operation: &str, path: &str) {
    log_store.append_operation(
        Some(connection_id),
        operation,
        Some(path),
        true,
        operation,
        None,
        None,
    );
}

fn append_cache_error_log(
    log_store: &ZkLogStore,
    connection_id: &str,
    operation: &str,
    path: &str,
    error: &str,
) {
    log_store.append_operation(
        Some(connection_id),
        operation,
        Some(path),
        false,
        operation,
        Some(error.to_string()),
        None,
    );
}

fn append_cache_resync_log(
    log_store: &ZkLogStore,
    connection_id: &str,
    operation: &str,
    path: &str,
) {
    log_store.append_operation(
        Some(connection_id),
        operation,
        Some(path),
        true,
        operation,
        None,
        Some(serde_json::json!({
            "cacheStatus": "resyncing",
        })),
    );
}

fn append_cache_resync_error_log(
    log_store: &ZkLogStore,
    connection_id: &str,
    operation: &str,
    path: &str,
    error: &str,
) {
    log_store.append_operation(
        Some(connection_id),
        operation,
        Some(path),
        false,
        operation,
        Some(error.to_string()),
        Some(serde_json::json!({
            "cacheStatus": "stale",
        })),
    );
}

fn mark_cache_resyncing(cache: &Arc<std::sync::Mutex<ConnectionCache>>) {
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    guard.mark_resyncing();
}

fn collect_full_tree_records(client: &Client) -> Result<Vec<NodeRecord>, String> {
    let mut nodes = Vec::new();
    let (children, _) = async_runtime::block_on(client.get_children("/")).map_err(map_zk_error)?;
    for name in children {
        let child_path = format!("/{name}");
        collect_node_records(client, &child_path, name, "/", &mut nodes)?;
    }
    Ok(nodes)
}

fn collect_node_records(
    client: &Client,
    path: &str,
    name: String,
    parent_path: &str,
    result: &mut Vec<NodeRecord>,
) -> Result<(), String> {
    let (children, _) = async_runtime::block_on(client.get_children(path)).map_err(map_zk_error)?;
    result.push(NodeRecord::new(
        path,
        &name,
        Some(parent_path.to_string()),
        !children.is_empty(),
    ));
    for child_name in children {
        let child_path = format!("{path}/{child_name}");
        collect_node_records(client, &child_path, child_name, path, result)?;
    }
    Ok(())
}

fn child_path(parent_path: &str, child_name: &str) -> String {
    if parent_path == "/" {
        format!("/{child_name}")
    } else {
        format!("{parent_path}/{child_name}")
    }
}

fn load_child_records(
    client: &Client,
    parent_path: &str,
    child_names: Vec<String>,
) -> Result<Vec<NodeRecord>, String> {
    child_names
        .into_iter()
        .map(|name| {
            let path = child_path(parent_path, &name);
            let (nested_children, _) =
                async_runtime::block_on(client.get_children(&path)).map_err(map_zk_error)?;
            Ok(NodeRecord::new(
                &path,
                &name,
                Some(parent_path.to_string()),
                !nested_children.is_empty(),
            ))
        })
        .collect()
}

fn list_child_records_with_watch(watcher: &ChildrenWatcher) -> Result<Vec<NodeRecord>, String> {
    let child_names = register_children_watch(watcher)?;
    let client = upgrade_client(&watcher.client)?;
    load_child_records(client.as_ref(), &watcher.path, child_names)
}

fn seed_subtree_cache(watcher: &ChildrenWatcher, path: &str) -> Result<(), String> {
    let branch_watcher = ChildrenWatcher {
        client: watcher.client.clone(),
        app_handle: watcher.app_handle.clone(),
        connection_id: watcher.connection_id.clone(),
        path: path.to_string(),
        log_store: Arc::clone(&watcher.log_store),
        active_paths: Arc::clone(&watcher.active_paths),
        cache: Arc::clone(&watcher.cache),
        shutdown: Arc::clone(&watcher.shutdown),
    };
    let child_records = list_child_records_with_watch(&branch_watcher)?;
    {
        let mut cache = watcher.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.reconcile_children_preserving_expandability(path, child_records.clone());
    }
    for child in child_records {
        seed_subtree_cache(watcher, &child.path)?;
    }
    Ok(())
}

fn refresh_cached_children(watcher: &ChildrenWatcher) -> Result<CacheChildDelta, String> {
    let child_records = list_child_records_with_watch(watcher)?;
    let current_child_paths = child_records
        .iter()
        .map(|child| child.path.clone())
        .collect::<Vec<_>>();

    let delta = {
        let mut cache = watcher.cache.lock().unwrap_or_else(|e| e.into_inner());
        let delta = diff_cache_children(&cache, &watcher.path, &current_child_paths);
        cache.reconcile_children(&watcher.path, child_records.clone());
        delta
    };

    for child_path in &delta.added {
        if let Err(error) = seed_subtree_cache(watcher, child_path) {
            if let Some((message, meta)) = classify_missing_node_race(&error) {
                append_watch_log(
                    &watcher.log_store,
                    &watcher.connection_id,
                    "cache_seed_subtree",
                    child_path,
                    true,
                    message,
                    Some(meta),
                    None,
                );
            } else {
                append_watch_log(
                    &watcher.log_store,
                    &watcher.connection_id,
                    "cache_seed_subtree",
                    child_path,
                    false,
                    "failed to seed subtree cache".into(),
                    None,
                    Some(error),
                );
            }
        }
    }

    Ok(delta)
}

#[derive(Debug, PartialEq, Eq)]
struct CacheChildDelta {
    added: Vec<String>,
    removed: Vec<String>,
}

fn diff_cache_children(
    cache: &ConnectionCache,
    parent_path: &str,
    current_child_paths: &[String],
) -> CacheChildDelta {
    let previous_child_paths = cache
        .children_of(parent_path)
        .into_iter()
        .map(|node| node.path)
        .collect::<std::collections::HashSet<_>>();
    let current_child_paths = current_child_paths
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();

    let mut added = current_child_paths
        .difference(&previous_child_paths)
        .cloned()
        .collect::<Vec<_>>();
    let mut removed = previous_child_paths
        .difference(&current_child_paths)
        .cloned()
        .collect::<Vec<_>>();
    added.sort();
    removed.sort();

    CacheChildDelta { added, removed }
}

fn map_cache_event_type(event_type: &str) -> Option<&'static str> {
    match event_type {
        "snapshot_ready" => Some("snapshot_ready"),
        "nodes_added" => Some("nodes_added"),
        "nodes_removed" => Some("nodes_removed"),
        "nodes_updated" => Some("nodes_updated"),
        "resync_completed" => Some("resync_completed"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    use zookeeper_client::{Acls, EventType, SessionState};

    #[test]
    fn children_watch_events_map_to_expected_app_events() {
        assert_eq!(
            map_children_watch_event(EventType::NodeChildrenChanged),
            Some(("children_changed", true))
        );
        assert_eq!(
            map_children_watch_event(EventType::NodeCreated),
            Some(("children_changed", true))
        );
        assert_eq!(
            map_children_watch_event(EventType::NodeDeleted),
            Some(("node_deleted", false))
        );
        assert_eq!(map_children_watch_event(EventType::NodeDataChanged), None);
    }

    #[test]
    fn data_watch_events_map_to_expected_app_events() {
        assert_eq!(
            map_data_watch_event(EventType::NodeDataChanged),
            Some(("data_changed", true))
        );
        assert_eq!(
            map_data_watch_event(EventType::NodeDeleted),
            Some(("node_deleted", false))
        );
        assert_eq!(map_data_watch_event(EventType::NodeCreated), None);
        assert_eq!(map_data_watch_event(EventType::NodeChildrenChanged), None);
    }

    #[test]
    fn session_states_map_to_expected_frontend_events() {
        assert_eq!(map_session_state_event(SessionState::SyncConnected), Some("connected"));
        assert_eq!(
            map_session_state_event(SessionState::ConnectedReadOnly),
            Some("connected")
        );
        assert_eq!(
            map_session_state_event(SessionState::Disconnected),
            Some("disconnected")
        );
        assert_eq!(map_session_state_event(SessionState::Expired), Some("expired"));
        assert_eq!(
            map_session_state_event(SessionState::AuthFailed),
            Some("auth_failed")
        );
        assert_eq!(map_session_state_event(SessionState::Closed), Some("closed"));
    }

    #[test]
    fn terminal_session_states_are_detected() {
        assert!(!is_terminal_session_state(SessionState::SyncConnected));
        assert!(!is_terminal_session_state(SessionState::Disconnected));
        assert!(is_terminal_session_state(SessionState::Expired));
        assert!(is_terminal_session_state(SessionState::AuthFailed));
        assert!(is_terminal_session_state(SessionState::Closed));
    }

    #[test]
    fn classifies_no_node_as_benign_missing_node_race() {
        let classified = classify_missing_node_race("NoNode");
        assert!(classified.is_some());
        let (message, meta) = classified.expect("classified");
        assert_eq!(message, "target disappeared before follow-up operation");
        assert_eq!(meta["benignRace"], true);
        assert_eq!(meta["reason"], "NoNode");
    }

    #[test]
    fn leaves_non_no_node_errors_unclassified() {
        assert!(classify_missing_node_race("ConnectionLoss").is_none());
    }

    #[test]
    fn encode_node_value_uses_requested_charset() {
      assert_eq!(
          encode_node_value("中文", "GBK").expect("GBK should encode"),
          vec![0xD6, 0xD0, 0xCE, 0xC4]
      );
      assert_eq!(
          encode_node_value("é", "ISO-8859-1").expect("latin text should encode"),
          vec![0xE9]
      );
      assert_eq!(
          encode_node_value("hello", "UTF-8").expect("utf8 should encode"),
          b"hello".to_vec()
      );
    }

    #[test]
    fn encode_node_value_rejects_unrepresentable_text() {
        let error = encode_node_value("中文", "ISO-8859-1").expect_err("should fail");
        assert!(error.contains("ISO-8859-1"));
    }

    #[test]
    fn mark_cache_resyncing_sets_transitional_status() {
        let cache = Arc::new(std::sync::Mutex::new(ConnectionCache::new()));
        mark_cache_resyncing(&cache);

        let snapshot = cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .to_snapshot();
        assert_eq!(snapshot.status, "resyncing");
    }

    #[test]
    fn cache_event_types_are_exposed_for_frontend_projection() {
        assert_eq!(
            map_cache_event_type("snapshot_ready"),
            Some("snapshot_ready")
        );
        assert_eq!(map_cache_event_type("nodes_added"), Some("nodes_added"));
        assert_eq!(map_cache_event_type("nodes_removed"), Some("nodes_removed"));
    }

    #[test]
    fn cache_children_are_diffed_against_the_existing_subtree_cache() {
        let mut cache = ConnectionCache::new();
        cache.upsert_children(
            "/",
            vec![
                NodeRecord::new("/old", "old", Some("/".into()), false),
                NodeRecord::new("/stay", "stay", Some("/".into()), false),
            ],
        );

        let delta =
            diff_cache_children(&cache, "/", &vec!["/stay".to_string(), "/new".to_string()]);

        assert_eq!(delta.added, vec!["/new".to_string()]);
        assert_eq!(delta.removed, vec!["/old".to_string()]);
    }

    #[test]
    fn snapshot_ready_cache_event_uses_empty_payload() {
        let event = snapshot_ready_cache_event("conn-a");

        assert_eq!(event.connection_id, "conn-a");
        assert_eq!(event.event_type, "snapshot_ready");
        assert_eq!(event.parent_path, None);
        assert!(event.paths.is_empty());
    }

    #[test]
    fn shutdown_flag_is_observed() {
        let shutdown = Arc::new(AtomicBool::new(false));
        assert!(!is_shutdown(&shutdown));
        shutdown.store(true, Ordering::SeqCst);
        assert!(is_shutdown(&shutdown));
    }

    #[test]
    #[ignore = "requires a local ZooKeeper server with digest auth"]
    fn real_zookeeper_smoke_connects_and_lists_root() {
        let request = ConnectRequestDto {
            connection_string: std::env::var("ZOOCUTE_REAL_ZK")
                .unwrap_or_else(|_| "127.0.0.1:2181".to_string()),
            username: Some(
                std::env::var("ZOOCUTE_REAL_ZK_USER").unwrap_or_else(|_| "admin".to_string()),
            ),
            password: Some(
                std::env::var("ZOOCUTE_REAL_ZK_PASS").unwrap_or_else(|_| "admin".to_string()),
            ),
            timeout_ms: 8_000,
        };

        let client = connect_client(&request).expect("real zookeeper connection should succeed");
        let root_stat = async_runtime::block_on(client.check_stat("/"))
            .expect("root stat request should succeed");
        assert!(root_stat.is_some(), "root node should exist");

        let root_children = async_runtime::block_on(client.list_children("/"))
            .expect("root children request should succeed");
        println!("root children: {:?}", root_children);
    }

    #[test]
    #[ignore = "requires a local ZooKeeper server with digest auth"]
    fn real_zookeeper_children_watch_receives_children_changed() {
        let client = connect_client(&real_zookeeper_request())
            .expect("real zookeeper connection should succeed");
        let root = unique_test_root("children-watch");

        create_persistent_node(&client, &root, b"").expect("test root should be created");
        let (children, watcher) = async_runtime::block_on(client.list_and_watch_children(&root))
            .expect("children watch should register");
        assert!(
            children.is_empty(),
            "fresh test root should not have children"
        );

        let child = format!("{root}/node-a");
        create_persistent_node(&client, &child, b"child").expect("child should be created");

        let event = async_runtime::block_on(watcher.changed());
        assert_eq!(event.event_type, EventType::NodeChildrenChanged);
        assert_eq!(event.path, root);

        delete_recursive_for_test(&client, &root).expect("test subtree should be cleaned up");
    }

    #[test]
    #[ignore = "requires a local ZooKeeper server with digest auth"]
    fn real_zookeeper_data_watch_receives_data_changed() {
        let client = connect_client(&real_zookeeper_request())
            .expect("real zookeeper connection should succeed");
        let root = unique_test_root("data-watch");
        let node = format!("{root}/node-a");

        create_persistent_node(&client, &root, b"").expect("test root should be created");
        create_persistent_node(&client, &node, b"before").expect("watched node should be created");

        let (data, stat, watcher) = async_runtime::block_on(client.get_and_watch_data(&node))
            .expect("data watch should register");
        assert_eq!(data, b"before".to_vec());

        let updated = async_runtime::block_on(client.set_data(&node, b"after", Some(stat.version)))
            .expect("node data should update");
        assert_eq!(updated.version, stat.version + 1);

        let event = async_runtime::block_on(watcher.changed());
        assert_eq!(event.event_type, EventType::NodeDataChanged);
        assert_eq!(event.path, node);

        delete_recursive_for_test(&client, &root).expect("test subtree should be cleaned up");
    }

    #[test]
    #[ignore = "requires a local ZooKeeper server with digest auth"]
    fn real_zookeeper_data_watch_receives_node_deleted() {
        let client = connect_client(&real_zookeeper_request())
            .expect("real zookeeper connection should succeed");
        let root = unique_test_root("delete-watch");
        let node = format!("{root}/node-a");

        create_persistent_node(&client, &root, b"").expect("test root should be created");
        create_persistent_node(&client, &node, b"before").expect("watched node should be created");

        let (_data, _stat, watcher) = async_runtime::block_on(client.get_and_watch_data(&node))
            .expect("data watch should register");

        async_runtime::block_on(client.delete(&node, None)).expect("node should be deleted");

        let event = async_runtime::block_on(watcher.changed());
        assert_eq!(event.event_type, EventType::NodeDeleted);
        assert_eq!(event.path, node);

        delete_recursive_for_test(&client, &root).expect("test subtree should be cleaned up");
    }

    fn real_zookeeper_request() -> ConnectRequestDto {
        ConnectRequestDto {
            connection_string: std::env::var("ZOOCUTE_REAL_ZK")
                .unwrap_or_else(|_| "127.0.0.1:2181".to_string()),
            username: Some(
                std::env::var("ZOOCUTE_REAL_ZK_USER").unwrap_or_else(|_| "admin".to_string()),
            ),
            password: Some(
                std::env::var("ZOOCUTE_REAL_ZK_PASS").unwrap_or_else(|_| "admin".to_string()),
            ),
            timeout_ms: 8_000,
        }
    }

    fn unique_test_root(prefix: &str) -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_millis();
        format!("/zoocute-codex-{prefix}-{millis}")
    }

    fn create_persistent_node(client: &Client, path: &str, data: &[u8]) -> Result<(), String> {
        async_runtime::block_on(client.create(
            path,
            data,
            &CreateMode::Persistent.with_acls(Acls::anyone_all()),
        ))
        .map(|_| ())
        .map_err(map_zk_error)
    }

    fn delete_recursive_for_test(client: &Client, path: &str) -> Result<(), String> {
        let (children, _) =
            async_runtime::block_on(client.get_children(path)).map_err(map_zk_error)?;
        for child in children {
            delete_recursive_for_test(client, &child_path(path, &child))?;
        }
        async_runtime::block_on(client.delete(path, None))
            .map(|_| ())
            .map_err(map_zk_error)
    }
}
