# ZooKeeper Rust 调试日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ZooCute 增加 Rust 侧 ZooKeeper 调试日志能力，将结构化日志落盘到本地文件，并通过 Tauri command 暴露给前端 `log` 页面查看与清空。

**Architecture:** 在 `src-tauri/src/logging.rs` 中实现独立的 `ZkLogStore`，负责 JSON Lines 的写入、读取和清空；`LiveAdapter` 在实际 ZooKeeper 操作完成时记录结构化日志；Tauri command 只暴露日志读取与清空能力；前端新增 `LogPane` 组件消费日志命令并替换当前占位 UI。

**Tech Stack:** Rust 2021、Tauri 2、serde/serde_json、React 19、Vitest、Testing Library

---

### Task 1: 搭建 Rust 日志存储模块

**Files:**
- Create: `src-tauri/src/logging.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/tests/logging_tests.rs`

- [ ] **Step 1: 写出 Rust 日志存储的失败测试**

在 `src-tauri/tests/logging_tests.rs` 新增测试文件，先定义我们期望的 API 和行为：

```rust
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use zoocute_lib::logging::{ZkLogEntry, ZkLogStore};

fn temp_log_path(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("zoocute-{name}-{unique}.jsonl"))
}

#[test]
fn appends_and_reads_latest_logs() {
    let path = temp_log_path("append-read");
    let store = ZkLogStore::new(path.clone());

    store.append(ZkLogEntry {
        timestamp: "2026-03-28T23:00:00+08:00".into(),
        level: "DEBUG".into(),
        connection_id: Some("c1".into()),
        operation: "list_children".into(),
        path: Some("/".into()),
        success: true,
        duration_ms: 9,
        message: "list_children succeeded".into(),
        error: None,
        meta: Some(json!({ "childrenCount": 3 })),
    }).unwrap();

    store.append(ZkLogEntry {
        timestamp: "2026-03-28T23:00:01+08:00".into(),
        level: "ERROR".into(),
        connection_id: Some("c1".into()),
        operation: "get_node".into(),
        path: Some("/broken".into()),
        success: false,
        duration_ms: 4,
        message: "get_node failed".into(),
        error: Some("NoNode".into()),
        meta: None,
    }).unwrap();

    let logs = store.read_latest(10).unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].operation, "get_node");
    assert_eq!(logs[1].operation, "list_children");

    fs::remove_file(path).ok();
}

#[test]
fn clear_removes_all_log_lines() {
    let path = temp_log_path("clear");
    let store = ZkLogStore::new(path.clone());
    store.append(ZkLogEntry {
        timestamp: "2026-03-28T23:00:00+08:00".into(),
        level: "DEBUG".into(),
        connection_id: Some("c1".into()),
        operation: "connect".into(),
        path: None,
        success: true,
        duration_ms: 100,
        message: "connect succeeded".into(),
        error: None,
        meta: None,
    }).unwrap();

    store.clear().unwrap();
    assert!(store.read_latest(10).unwrap().is_empty());

    fs::remove_file(path).ok();
}
```

- [ ] **Step 2: 运行 Rust 日志测试，确认当前失败**

Run: `cargo test --test logging_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，提示 `zoocute_lib::logging` 模块或 `ZkLogStore` / `ZkLogEntry` 未定义。

- [ ] **Step 3: 实现最小日志存储模块**

在 `src-tauri/src/logging.rs` 中实现结构体与 JSON Lines 读写逻辑：

```rust
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkLogEntry {
    pub timestamp: String,
    pub level: String,
    pub connection_id: Option<String>,
    pub operation: String,
    pub path: Option<String>,
    pub success: bool,
    pub duration_ms: u128,
    pub message: String,
    pub error: Option<String>,
    pub meta: Option<Value>,
}

#[derive(Debug)]
pub struct ZkLogStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl ZkLogStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            write_lock: Mutex::new(()),
        }
    }

    pub fn append(&self, entry: ZkLogEntry) -> Result<(), String> {
        let _guard = self.write_lock.lock().map_err(|_| "log lock poisoned".to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| e.to_string())?;
        let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        writeln!(file, "{line}").map_err(|e| e.to_string())
    }

    pub fn read_latest(&self, limit: usize) -> Result<Vec<ZkLogEntry>, String> {
        if !self.path.exists() {
            return Ok(vec![]);
        }

        let file = OpenOptions::new().read(true).open(&self.path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut rows = vec![];

        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<ZkLogEntry>(&line) {
                rows.push(entry);
            }
        }

        rows.reverse();
        rows.truncate(limit);
        Ok(rows)
    }

    pub fn clear(&self) -> Result<(), String> {
        let _guard = self.write_lock.lock().map_err(|_| "log lock poisoned".to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&self.path, "").map_err(|e| e.to_string())
    }
}
```

同时在 `src-tauri/src/lib.rs` 中导出模块：

```rust
pub mod logging;
```

若需要更稳定的 ISO 时间格式，在 `src-tauri/Cargo.toml` 添加依赖：

```toml
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

- [ ] **Step 4: 补全健壮性测试并让日志模块通过**

在 `src-tauri/tests/logging_tests.rs` 追加“跳过损坏行”的测试：

```rust
#[test]
fn skips_invalid_json_lines() {
    let path = temp_log_path("invalid-lines");
    fs::write(
        &path,
        "{\"timestamp\":\"2026-03-28T23:00:00+08:00\",\"level\":\"DEBUG\",\"connectionId\":\"c1\",\"operation\":\"connect\",\"path\":null,\"success\":true,\"durationMs\":12,\"message\":\"connect succeeded\",\"error\":null,\"meta\":null}\nnot-json\n",
    ).unwrap();

    let store = ZkLogStore::new(path.clone());
    let logs = store.read_latest(10).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].operation, "connect");

    fs::remove_file(path).ok();
}
```

Run: `cargo test --test logging_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src-tauri/src/logging.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/tests/logging_tests.rs
git commit -m "feat: add zk debug log store"
```

### Task 2: 暴露日志 DTO 与 Tauri 命令

**Files:**
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/zk_log_commands_tests.rs`

- [ ] **Step 1: 先写 command 层的失败测试**

在 `src-tauri/tests/zk_log_commands_tests.rs` 中定义读取和清空行为：

```rust
use std::path::PathBuf;

use tauri::State;
use zoocute_lib::commands::{clear_zk_logs, read_zk_logs, AppState};
use zoocute_lib::logging::{ZkLogEntry, ZkLogStore};

#[test]
fn read_zk_logs_returns_latest_entries() {
    let path = std::env::temp_dir().join("zoocute-read-zk-logs.jsonl");
    let state = AppState::for_tests(ZkLogStore::new(path.clone()));
    state.log_store.append(ZkLogEntry {
        timestamp: "2026-03-28T23:10:00+08:00".into(),
        level: "DEBUG".into(),
        connection_id: Some("c1".into()),
        operation: "save_node".into(),
        path: Some("/configs/app".into()),
        success: true,
        duration_ms: 5,
        message: "save_node succeeded".into(),
        error: None,
        meta: None,
    }).unwrap();

    let logs = read_zk_logs(Some(20), State::from(&state)).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].operation, "save_node");
}

#[test]
fn clear_zk_logs_truncates_file() {
    let path = std::env::temp_dir().join("zoocute-clear-zk-logs.jsonl");
    let state = AppState::for_tests(ZkLogStore::new(path.clone()));
    state.log_store.append(ZkLogEntry {
        timestamp: "2026-03-28T23:10:00+08:00".into(),
        level: "DEBUG".into(),
        connection_id: Some("c1".into()),
        operation: "connect".into(),
        path: None,
        success: true,
        duration_ms: 100,
        message: "connect succeeded".into(),
        error: None,
        meta: None,
    }).unwrap();

    clear_zk_logs(State::from(&state)).unwrap();
    assert!(read_zk_logs(Some(20), State::from(&state)).unwrap().is_empty());
}
```

- [ ] **Step 2: 运行新增 command 测试，确认失败**

Run: `cargo test --test zk_log_commands_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，提示 `read_zk_logs` / `clear_zk_logs` / `AppState::for_tests` / 日志 DTO 不存在。

- [ ] **Step 3: 实现 DTO、AppState 日志持有与 Tauri 命令**

在 `src-tauri/src/domain.rs` 增加前端消费用 DTO：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZkLogEntryDto {
    pub timestamp: String,
    pub level: String,
    pub connection_id: Option<String>,
    pub operation: String,
    pub path: Option<String>,
    pub success: bool,
    pub duration_ms: u128,
    pub message: String,
    pub error: Option<String>,
    pub meta: Option<serde_json::Value>,
}
```

在 `src-tauri/src/commands.rs` 扩展 `AppState` 与命令：

```rust
pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
    pub log_store: ZkLogStore,
}

impl AppState {
    pub fn for_tests(log_store: ZkLogStore) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
            log_store,
        }
    }
}

#[tauri::command]
pub fn read_zk_logs(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<ZkLogEntryDto>, String> {
    let limit = limit.unwrap_or(200);
    state
        .log_store
        .read_latest(limit)?
        .into_iter()
        .map(|entry| Ok(ZkLogEntryDto {
            timestamp: entry.timestamp,
            level: entry.level,
            connection_id: entry.connection_id,
            operation: entry.operation,
            path: entry.path,
            success: entry.success,
            duration_ms: entry.duration_ms,
            message: entry.message,
            error: entry.error,
            meta: entry.meta,
        }))
        .collect()
}

#[tauri::command]
pub fn clear_zk_logs(state: State<'_, AppState>) -> Result<(), String> {
    state.log_store.clear()
}
```

在 `src-tauri/src/lib.rs` 注册命令：

```rust
use commands::{clear_zk_logs, read_zk_logs};

tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
        connect_server,
        disconnect_server,
        list_children,
        get_node_details,
        save_node,
        create_node,
        delete_node,
        read_zk_logs,
        clear_zk_logs
    ])
```

- [ ] **Step 4: 让 command 测试通过，并补一个默认 limit 测试**

在 `src-tauri/tests/zk_log_commands_tests.rs` 追加：

```rust
#[test]
fn read_zk_logs_uses_default_limit_when_absent() {
    let path = std::env::temp_dir().join("zoocute-default-limit.jsonl");
    let state = AppState::for_tests(ZkLogStore::new(path));
    let logs = read_zk_logs(None, State::from(&state)).unwrap();
    assert!(logs.is_empty());
}
```

Run: `cargo test --test zk_log_commands_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src-tauri/src/domain.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/zk_log_commands_tests.rs
git commit -m "feat: expose zk debug log commands"
```

### Task 3: 在 LiveAdapter 中为真实 ZooKeeper 操作埋点

**Files:**
- Modify: `src-tauri/src/zk_core/live.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/zk_core_tests.rs`

- [ ] **Step 1: 先写埋点行为测试**

在 `src-tauri/tests/zk_core_tests.rs` 增加“日志不记录 value”和“失败日志可写入”的测试，先按新的帮助方法写断言：

```rust
use serde_json::Value;
use zoocute_lib::logging::{ZkLogEntry, ZkLogStore};

#[test]
fn log_entry_meta_never_contains_node_value() {
    let entry = ZkLogEntry {
        timestamp: "2026-03-28T23:20:00+08:00".into(),
        level: "DEBUG".into(),
        connection_id: Some("c1".into()),
        operation: "save_node".into(),
        path: Some("/configs/payment".into()),
        success: true,
        duration_ms: 8,
        message: "save_node succeeded".into(),
        error: None,
        meta: Some(serde_json::json!({ "dataLength": 128 })),
    };

    let serialized = serde_json::to_string(&entry).unwrap();
    assert!(!serialized.contains("secret-value"));
}
```

再新增一个只测格式化辅助函数的测试：

```rust
#[test]
fn build_log_entry_records_error_without_payload() {
    let entry = zoocute_lib::zk_core::live::build_log_entry(
        Some("c1"),
        "get_node",
        Some("/missing"),
        Err("NoNode".to_string()),
        12,
        None,
    );

    assert!(!entry.success);
    assert_eq!(entry.error.as_deref(), Some("NoNode"));
    assert_eq!(entry.path.as_deref(), Some("/missing"));
}
```

- [ ] **Step 2: 运行 Rust 测试，确认辅助函数尚未实现**

Run: `cargo test --test zk_core_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，提示 `build_log_entry` 不存在或 `live` 模块未导出该辅助函数。

- [ ] **Step 3: 为 LiveAdapter 增加日志上下文并实现帮助函数**

在 `src-tauri/src/zk_core/live.rs` 增加 connection/log store 上下文：

```rust
#[derive(Clone)]
pub struct LiveAdapter {
    client: Arc<ZooKeeper>,
    connection_id: String,
    log_store: Arc<ZkLogStore>,
}

pub fn build_log_entry(
    connection_id: Option<&str>,
    operation: &str,
    path: Option<&str>,
    result: Result<(), String>,
    duration_ms: u128,
    meta: Option<serde_json::Value>,
) -> ZkLogEntry {
    match result {
        Ok(()) => ZkLogEntry {
            timestamp: chrono::Local::now().to_rfc3339(),
            level: "DEBUG".into(),
            connection_id: connection_id.map(str::to_string),
            operation: operation.into(),
            path: path.map(str::to_string),
            success: true,
            duration_ms,
            message: format!("{operation} succeeded"),
            error: None,
            meta,
        },
        Err(error) => ZkLogEntry {
            timestamp: chrono::Local::now().to_rfc3339(),
            level: "ERROR".into(),
            connection_id: connection_id.map(str::to_string),
            operation: operation.into(),
            path: path.map(str::to_string),
            success: false,
            duration_ms,
            message: format!("{operation} failed"),
            error: Some(error),
            meta,
        },
    }
}
```

在各个方法里按统一模板记录日志：

```rust
pub fn save_node(&self, path: &str, value: &str) -> Result<(), String> {
    let started = std::time::Instant::now();
    let result = self
        .client
        .set_data(path, value.as_bytes().to_vec(), None)
        .map_err(map_zk_error)
        .map(|_| ());

    let duration_ms = started.elapsed().as_millis();
    let entry = build_log_entry(
        Some(&self.connection_id),
        "save_node",
        Some(path),
        result.clone(),
        duration_ms,
        Some(serde_json::json!({ "dataLength": value.len() })),
    );
    let _ = self.log_store.append(entry);

    result
}
```

`connect_live` 需要改成接收日志上下文：

```rust
pub fn connect_live(
    connection_id: &str,
    request: &ConnectRequestDto,
    log_store: Arc<ZkLogStore>,
) -> Result<(Self, ConnectionStatusDto), String>
```

`commands.rs` 中调用更新为：

```rust
let (adapter, result) = LiveAdapter::connect_live(
    &connection_id,
    &request,
    Arc::new(state.log_store.clone()),
)?;
```

如果 `ZkLogStore` 不能直接 `clone`，先让它内部包 `Arc<PathBuf>` / `Arc<Mutex<()>>` 并实现 `Clone`。

- [ ] **Step 4: 为递归删除补一个明确日志步骤测试**

在 `src-tauri/tests/zk_core_tests.rs` 追加：

```rust
#[test]
fn recursive_delete_operation_name_is_stable() {
    let entry = zoocute_lib::zk_core::live::build_log_entry(
        Some("c1"),
        "delete_recursive",
        Some("/services"),
        Ok(()),
        21,
        Some(serde_json::json!({ "recursive": true })),
    );

    assert_eq!(entry.operation, "delete_recursive");
    assert_eq!(entry.meta.unwrap()["recursive"], true);
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src-tauri/src/zk_core/live.rs src-tauri/src/commands.rs src-tauri/tests/zk_core_tests.rs
git commit -m "feat: log live zk operations to disk"
```

### Task 4: 增加前端日志类型、命令封装与日志面板

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Create: `src/components/log-pane.tsx`
- Create: `src/log-pane.test.tsx`

- [ ] **Step 1: 先写前端日志面板失败测试**

在 `src/log-pane.test.tsx` 中定义 UI 期望：

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LogPane } from "./components/log-pane";

const { readZkLogsMock, clearZkLogsMock } = vi.hoisted(() => ({
  readZkLogsMock: vi.fn(async () => [
    {
      timestamp: "2026-03-28T23:30:00+08:00",
      level: "ERROR",
      connectionId: "local",
      operation: "get_node",
      path: "/missing",
      success: false,
      durationMs: 8,
      message: "get_node failed",
      error: "NoNode",
      meta: null,
    },
    {
      timestamp: "2026-03-28T23:29:00+08:00",
      level: "DEBUG",
      connectionId: "local",
      operation: "list_children",
      path: "/",
      success: true,
      durationMs: 5,
      message: "list_children succeeded",
      error: null,
      meta: null,
    },
  ]),
  clearZkLogsMock: vi.fn(async () => {}),
}));

vi.mock("./lib/commands", () => ({
  readZkLogs: readZkLogsMock,
  clearZkLogs: clearZkLogsMock,
}));

it("renders logs and filters failed rows", async () => {
  const user = userEvent.setup();
  render(<LogPane />);

  await waitFor(() => expect(screen.getByText("get_node")).toBeInTheDocument());
  expect(screen.getByText("list_children")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "仅失败" }));
  expect(screen.getByText("get_node")).toBeInTheDocument();
  expect(screen.queryByText("list_children")).not.toBeInTheDocument();
});

it("clears logs and refreshes the list", async () => {
  const user = userEvent.setup();
  readZkLogsMock
    .mockResolvedValueOnce([{ timestamp: "2026-03-28T23:30:00+08:00", level: "DEBUG", connectionId: "local", operation: "connect", path: null, success: true, durationMs: 100, message: "connect succeeded", error: null, meta: null }])
    .mockResolvedValueOnce([]);

  render(<LogPane />);
  await waitFor(() => expect(screen.getByText("connect")).toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "清空日志" }));
  await waitFor(() => expect(screen.getByText("暂无日志")).toBeInTheDocument());
  expect(clearZkLogsMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行 Vitest，确认 `LogPane` 还不存在**

Run: `npm test -- --run src/log-pane.test.tsx`

Expected: FAIL，提示 `./components/log-pane` 或 `readZkLogs` / `clearZkLogs` 未定义。

- [ ] **Step 3: 实现日志类型、命令封装与日志面板**

在 `src/lib/types.ts` 中增加类型：

```ts
export interface ZkLogEntry {
  timestamp: string;
  level: string;
  connectionId: string | null;
  operation: string;
  path: string | null;
  success: boolean;
  durationMs: number;
  message: string;
  error: string | null;
  meta: Record<string, unknown> | null;
}
```

在 `src/lib/commands.ts` 中增加命令：

```ts
export async function readZkLogs(limit = 200): Promise<ZkLogEntry[]> {
  return invoke("read_zk_logs", { limit });
}

export async function clearZkLogs(): Promise<void> {
  await invoke("clear_zk_logs");
}
```

在 `src/components/log-pane.tsx` 中实现最小日志面板：

```tsx
import { useEffect, useMemo, useState } from "react";
import { clearZkLogs, readZkLogs } from "../lib/commands";
import type { ZkLogEntry } from "../lib/types";

type FilterMode = "all" | "failed" | "success";

export function LogPane() {
  const [logs, setLogs] = useState<ZkLogEntry[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      setLogs(await readZkLogs(200));
    } catch (err) {
      setError(err instanceof Error ? err.message : "日志读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  const visibleLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterMode === "failed" && log.success) return false;
      if (filterMode === "success" && !log.success) return false;
      if (connectionFilter && !(log.connectionId ?? "").includes(connectionFilter)) return false;
      return true;
    });
  }, [logs, filterMode, connectionFilter]);

  return (
    <section className="log-pane">
      {/* toolbar + list */}
    </section>
  );
}
```

- [ ] **Step 4: 细化空态/错误态测试并跑通**

在 `src/log-pane.test.tsx` 追加：

```tsx
it("shows empty state when there are no logs", async () => {
  readZkLogsMock.mockResolvedValueOnce([]);
  render(<LogPane />);
  await waitFor(() => expect(screen.getByText("暂无日志")).toBeInTheDocument());
});
```

Run: `npm test -- --run src/log-pane.test.tsx`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src/lib/types.ts src/lib/commands.ts src/components/log-pane.tsx src/log-pane.test.tsx
git commit -m "feat: add frontend zk debug log pane"
```

### Task 5: 在 App 中接入日志页并补回归测试

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles/app.css`
- Test: `src/App.test.tsx`

- [ ] **Step 1: 先补 App 层集成失败测试**

在 `src/App.test.tsx` 中新增从连接完成后切换到日志页的场景：

```tsx
const { readZkLogsMock, clearZkLogsMock } = vi.hoisted(() => ({
  readZkLogsMock: vi.fn(async () => [
    {
      timestamp: "2026-03-28T23:35:00+08:00",
      level: "DEBUG" as const,
      connectionId: "local",
      operation: "connect",
      path: null,
      success: true,
      durationMs: 100,
      message: "connect succeeded",
      error: null,
      meta: null,
    },
  ]),
  clearZkLogsMock: vi.fn(async () => {}),
}));

vi.mock("./lib/commands", () => ({
  connectServer: connectServerMock,
  disconnectServer: vi.fn(async () => {}),
  listChildren: listChildrenMock,
  getNodeDetails: vi.fn(async () => ({ /* existing mock */ })),
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
  readZkLogs: readZkLogsMock,
  clearZkLogs: clearZkLogsMock,
}));

it("shows zk debug logs when switching to log mode after connect", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getAllByText("本地开发")[0]);
  await user.click(screen.getByTitle("连接"));

  await waitFor(() => expect(screen.getByTitle("操作日志")).toBeInTheDocument());
  await user.click(screen.getByTitle("操作日志"));

  await waitFor(() => expect(screen.getByText("connect")).toBeInTheDocument());
  expect(screen.getByText("connect succeeded")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 App 测试，确认集成尚未完成**

Run: `npm test -- --run src/App.test.tsx`

Expected: FAIL，日志模式下仍显示“待实现”占位文案。

- [ ] **Step 3: 将 `log` 模式占位替换为真实面板**

在 `src/App.tsx` 中引入 `LogPane`：

```tsx
import { LogPane } from "./components/log-pane";
```

将两处占位替换为日志页布局：

```tsx
{ribbonMode === "log" && (
  <div className="log-sidebar">
    <div className="log-sidebar-title">ZooKeeper 调试日志</div>
    <p className="log-sidebar-copy">查看 Rust 侧 ZooKeeper 操作的最近日志。</p>
  </div>
)}
```

```tsx
{ribbonMode === "log" && (
  <LogPane />
)}
```

在 `src/styles/app.css` 中增加最小样式：

```css
.log-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  gap: 12px;
}

.log-list {
  overflow: auto;
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
}
```

- [ ] **Step 4: 跑完整前端测试并确认无回归**

Run: `npm test`

Expected: PASS，包含新增的 `src/log-pane.test.tsx` 与 `src/App.test.tsx` 集成场景。

再运行构建校验：

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: 提交本任务**

```bash
git add src/App.tsx src/App.test.tsx src/styles/app.css
git add src/components/log-pane.tsx src/log-pane.test.tsx src/lib/types.ts src/lib/commands.ts
git commit -m "feat: surface zk debug logs in app"
```

### Task 6: 全量验证与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-03-28-zk-debug-log-design.md`
- Modify: `docs/superpowers/plans/2026-03-28-zk-debug-log.md`

- [ ] **Step 1: 运行 Rust 全量测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS

- [ ] **Step 2: 运行前端全量测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: PASS

- [ ] **Step 4: 手动验证日志主路径**

Run: `npm run tauri:dev`

手动检查：

- 连接一个已保存的 ZooKeeper 连接
- 打开几个节点，触发 `list_children` 与 `get_node`
- 尝试保存或创建节点，触发写操作日志
- 切到日志页，确认能看到最新日志
- 点击“清空日志”，确认列表变空
- 重启应用后再次打开日志页，确认落盘日志可被重新读取

- [ ] **Step 5: 提交验证后的最终变更**

```bash
git add src-tauri/src/logging.rs src-tauri/src/commands.rs src-tauri/src/domain.rs src-tauri/src/zk_core/live.rs
git add src-tauri/tests/logging_tests.rs src-tauri/tests/zk_log_commands_tests.rs src-tauri/tests/zk_core_tests.rs
git add src/lib/types.ts src/lib/commands.ts src/components/log-pane.tsx src/log-pane.test.tsx src/App.tsx src/App.test.tsx src/styles/app.css
git commit -m "feat: add persistent zk debug logging"
```
