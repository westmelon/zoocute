# ZooKeeper Write Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three no-op Tauri command stubs (`save_node`, `create_node`, `delete_node`) with real ZooKeeper write operations using the `zookeeper` crate.

**Architecture:** Write methods are added directly to `LiveAdapter` (not the `ReadOnlyZkAdapter` trait, since mock never needs writes). Commands check for an active session and call the adapter; when there is no session they return a clear Chinese error message. Recursive delete is implemented manually: gather children depth-first, delete leaves first, then the parent.

**Tech Stack:** Rust, `zookeeper = "0.8.0"` crate (`set_data`, `create`, `delete`, `get_children`, `Acl::open_unsafe()`, `CreateMode::Persistent`), Cargo test

---

## File Structure

- Modify: `src-tauri/src/zk_core/live.rs` — add `save_node`, `create_node`, `delete_node` methods to `LiveAdapter`
- Modify: `src-tauri/src/commands.rs` — replace three stubs to call the new `LiveAdapter` methods
- Modify: `src-tauri/tests/zk_core_tests.rs` — add unit tests for the no-session error path

---

### Task 1: Implement write methods on LiveAdapter

**Files:**
- Modify: `src-tauri/src/zk_core/live.rs`

- [ ] **Step 1: Write failing tests for the no-session error path**

Add to `src-tauri/tests/zk_core_tests.rs`:

```rust
use zoocute_lib::commands::AppState;

#[test]
fn save_node_returns_error_when_no_session() {
    let state = AppState::default();
    let session = state.session.lock().unwrap();
    let result: Result<(), String> = match session.as_ref() {
        Some(adapter) => adapter.save_node("/foo", "bar"),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    };
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("ZooKeeper"));
}

#[test]
fn create_node_returns_error_when_no_session() {
    let state = AppState::default();
    let session = state.session.lock().unwrap();
    let result: Result<(), String> = match session.as_ref() {
        Some(adapter) => adapter.create_node("/foo", "bar"),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    };
    assert!(result.is_err());
}

#[test]
fn delete_node_returns_error_when_no_session() {
    let state = AppState::default();
    let session = state.session.lock().unwrap();
    let result: Result<(), String> = match session.as_ref() {
        Some(adapter) => adapter.delete_node("/foo", false),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    };
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test save_node_returns_error save_node_returns_error_when_no_session create_node_returns_error_when_no_session delete_node_returns_error_when_no_session 2>&1
```

Expected: compile error — `save_node`, `create_node`, `delete_node` methods don't exist on `LiveAdapter` yet.

- [ ] **Step 3: Add write methods to LiveAdapter**

Replace the contents of `src-tauri/src/zk_core/live.rs` with:

```rust
use std::sync::Arc;
use std::time::Duration;

use zookeeper::{Acl, CreateMode, Watcher, WatchedEvent, ZooKeeper};

use crate::domain::{ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto};
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::interpreter::{hex_encode, interpret_data};

#[derive(Clone)]
pub struct LiveAdapter {
    client: Arc<ZooKeeper>,
}

struct NoopWatcher;

impl Watcher for NoopWatcher {
    fn handle(&self, _event: WatchedEvent) {}
}

impl LiveAdapter {
    pub fn connect_live(request: &ConnectRequestDto) -> Result<(Self, ConnectionStatusDto), String> {
        let client = ZooKeeper::connect(
            &request.connection_string,
            Duration::from_secs(8),
            NoopWatcher,
        )
        .map_err(map_zk_error)?;

        if let (Some(username), Some(password)) = (&request.username, &request.password) {
            if !username.is_empty() && !password.is_empty() {
                client
                    .add_auth("digest", format!("{username}:{password}").into_bytes())
                    .map_err(map_zk_error)?;
            }
        }

        let status = ConnectionStatusDto {
            connected: true,
            auth_mode: request.auth_mode(),
            auth_succeeded: true,
            message: format!("connected to {}", request.connection_string),
        };

        Ok((
            Self {
                client: Arc::new(client),
            },
            status,
        ))
    }

    pub fn save_node(&self, path: &str, value: &str) -> Result<(), String> {
        self.client
            .set_data(path, value.as_bytes().to_vec(), None)
            .map_err(map_zk_error)?;
        Ok(())
    }

    pub fn create_node(&self, path: &str, data: &str) -> Result<(), String> {
        self.client
            .create(
                path,
                data.as_bytes().to_vec(),
                Acl::open_unsafe().clone(),
                CreateMode::Persistent,
            )
            .map_err(map_zk_error)?;
        Ok(())
    }

    pub fn delete_node(&self, path: &str, recursive: bool) -> Result<(), String> {
        if recursive {
            self.delete_recursive(path)
        } else {
            self.client.delete(path, None).map_err(map_zk_error)
        }
    }

    fn delete_recursive(&self, path: &str) -> Result<(), String> {
        let children = self.client.get_children(path, false).map_err(map_zk_error)?;
        for child in children {
            let child_path = if path == "/" {
                format!("/{child}")
            } else {
                format!("{path}/{child}")
            };
            self.delete_recursive(&child_path)?;
        }
        self.client.delete(path, None).map_err(map_zk_error)
    }
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
        let children = self.client.get_children(path, false).map_err(map_zk_error)?;

        children
            .into_iter()
            .map(|name| {
                let child_path = if path == "/" {
                    format!("/{name}")
                } else {
                    format!("{path}/{name}")
                };
                let nested = self.client.get_children(&child_path, false).map_err(map_zk_error)?;

                Ok(LoadedTreeNodeDto {
                    path: child_path,
                    name,
                    has_children: !nested.is_empty(),
                })
            })
            .collect()
    }

    fn get_node(&self, path: &str) -> Result<NodeDetailsDto, String> {
        let (data, stat) = self.client.get_data(path, false).map_err(map_zk_error)?;
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

fn map_zk_error(error: zookeeper::ZkError) -> String {
    format!("{error:?}")
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/zk_core/live.rs src-tauri/tests/zk_core_tests.rs
git commit -m "feat: add save_node, create_node, delete_node to LiveAdapter"
```

---

### Task 2: Wire write methods into Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Replace the three stubs in commands.rs**

Replace the three stub functions at the bottom of `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn save_node(path: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "failed to acquire session state".to_string())?;
    match session.as_ref() {
        Some(adapter) => adapter.save_node(&path, &value),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn create_node(path: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "failed to acquire session state".to_string())?;
    match session.as_ref() {
        Some(adapter) => adapter.create_node(&path, &data),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn delete_node(
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "failed to acquire session state".to_string())?;
    match session.as_ref() {
        Some(adapter) => adapter.delete_node(&path, recursive),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}
```

Note: `async` is removed from `create_node` and `delete_node` — the `zookeeper` crate is synchronous. The `lib.rs` `generate_handler!` macro already registers these by name so no change is needed there.

- [ ] **Step 2: Verify it compiles and all tests pass**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all 8 tests pass, no compile errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: wire save_node, create_node, delete_node commands to LiveAdapter"
```
