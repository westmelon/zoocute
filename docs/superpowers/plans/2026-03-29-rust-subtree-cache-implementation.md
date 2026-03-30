# Rust 全量 Subtree Cache 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不切换到 Java sidecar 的前提下，为 ZooCute 建立 Rust 侧 connection-scoped subtree cache，让未展开分支也能感知外部新增/删除/重建，并逐步把前端树同步迁移到 cache 驱动模型。

**Architecture:** 先在 Rust 侧新增 `SubtreeCache` 与 cache snapshot/delta 事件流，让后端具备“整树缓存 + 增量同步 + resync”的能力；前端第一阶段先旁路消费 snapshot 验证 cache 正确性，第二阶段再把树渲染主逻辑切到 cache projection。整个过程保留现有读写命令与编辑流，避免一次性重写。

**Tech Stack:** Rust 2021, Tauri 2, `zookeeper` crate, React 19, TypeScript, Vitest, Rust unit/integration tests

---

### Task 1: 建立 Rust subtree cache 的最小数据模型

**Files:**
- Create: `src-tauri/src/zk_core/cache.rs`
- Modify: `src-tauri/src/zk_core/mod.rs`
- Modify: `src-tauri/src/domain.rs`
- Test: `src-tauri/tests/subtree_cache_tests.rs`

- [ ] **Step 1: 写 Rust 侧 subtree cache 的失败测试**

在 `src-tauri/tests/subtree_cache_tests.rs` 中新增最小 cache 行为测试：

```rust
use zoocute_lib::zk_core::cache::{ConnectionCache, NodeRecord};

#[test]
fn inserts_root_children_and_tracks_parent_relationships() {
    let mut cache = ConnectionCache::new();

    cache.upsert_children("/", vec![
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
        NodeRecord::new("/zookeeper", "zookeeper", Some("/".into()), true),
    ]);

    let root_children = cache.children_of("/");
    assert_eq!(root_children.len(), 2);
    assert_eq!(root_children[0].path, "/ssdev");
    assert_eq!(root_children[1].path, "/zookeeper");
}

#[test]
fn removing_subtree_drops_descendants_and_parent_links() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children("/", vec![
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
    ]);
    cache.upsert_children("/ssdev", vec![
        NodeRecord::new("/ssdev/services", "services", Some("/ssdev".into()), true),
    ]);

    cache.remove_subtree("/ssdev");

    assert!(cache.node("/ssdev").is_none());
    assert!(cache.node("/ssdev/services").is_none());
    assert!(cache.children_of("/").is_empty());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，提示 `zk_core::cache` 模块或 `ConnectionCache` / `NodeRecord` 未定义。

- [ ] **Step 3: 实现最小 cache 数据结构**

在 `src-tauri/src/zk_core/cache.rs` 中实现最小可用模型：

```rust
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRecord {
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub has_children: bool,
}

impl NodeRecord {
    pub fn new(path: &str, name: &str, parent_path: Option<String>, has_children: bool) -> Self {
        Self {
            path: path.to_string(),
            name: name.to_string(),
            parent_path,
            has_children,
        }
    }
}

#[derive(Debug, Default)]
pub struct ConnectionCache {
    nodes_by_path: HashMap<String, NodeRecord>,
    children_by_parent: HashMap<String, Vec<String>>,
}
```

并实现：

- `ConnectionCache::new()`
- `upsert_children(parent_path, children)`
- `children_of(parent_path) -> Vec<NodeRecord>`
- `node(path) -> Option<&NodeRecord>`
- `remove_subtree(path)`

- [ ] **Step 4: 导出模块并跑测试通过**

在 `src-tauri/src/zk_core/mod.rs` 中导出：

```rust
pub mod cache;
```

Run: `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/zk_core/cache.rs src-tauri/src/zk_core/mod.rs src-tauri/tests/subtree_cache_tests.rs
git commit -m "feat: add subtree cache core model"
```

### Task 2: 为 cache 定义 snapshot DTO 与前端消费接口

**Files:**
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`
- Test: `src-tauri/tests/subtree_cache_tests.rs`
- Test: `src/connectivity.test.tsx`

- [ ] **Step 1: 写失败测试，定义 snapshot 命令返回形状**

在 `src-tauri/tests/subtree_cache_tests.rs` 追加 DTO 形状测试：

```rust
use zoocute_lib::domain::{CachedTreeNodeDto, TreeSnapshotDto};

#[test]
fn tree_snapshot_dto_carries_nodes_and_status() {
    let snapshot = TreeSnapshotDto {
        status: "bootstrapping".into(),
        nodes: vec![
            CachedTreeNodeDto {
                path: "/ssdev".into(),
                name: "ssdev".into(),
                parent_path: Some("/".into()),
                has_children: true,
            }
        ],
    };

    assert_eq!(snapshot.status, "bootstrapping");
    assert_eq!(snapshot.nodes[0].path, "/ssdev");
}
```

在 `src/connectivity.test.tsx` 新增前端命令调用测试：

```tsx
it("requests a tree snapshot for the active connection", async () => {
  getTreeSnapshotMock.mockResolvedValue({
    status: "live",
    nodes: [{ path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true }],
  });

  const snapshot = await getTreeSnapshot("local");
  expect(snapshot.status).toBe("live");
  expect(snapshot.nodes[0].path).toBe("/ssdev");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

- `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/connectivity.test.tsx -t "requests a tree snapshot"`

Expected: FAIL，提示 snapshot DTO 或 `get_tree_snapshot` 未定义。

- [ ] **Step 3: 在 Rust 侧新增 DTO 与命令**

在 `src-tauri/src/domain.rs` 新增：

```rust
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
```

在 `src-tauri/src/commands.rs` 新增只读命令草稿：

```rust
#[tauri::command]
pub fn get_tree_snapshot(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<TreeSnapshotDto, String> {
    let sessions = state.sessions.lock().unwrap();
    let adapter = sessions
        .get(&connection_id)
        .cloned()
        .ok_or_else(|| format!("no active session for connection {connection_id}"))?;
    adapter.get_tree_snapshot()
}
```

并在 `src-tauri/src/lib.rs` 注册 command。

- [ ] **Step 4: 在前端 types 与 commands 中接上命令**

在 `src/lib/types.ts` 新增：

```ts
export interface CachedTreeNode {
  path: string;
  name: string;
  parentPath: string | null;
  hasChildren: boolean;
}

export interface TreeSnapshot {
  status: "bootstrapping" | "live" | "resyncing" | "stale";
  nodes: CachedTreeNode[];
}
```

在 `src/lib/commands.ts` 新增：

```ts
export async function getTreeSnapshot(connectionId: string): Promise<TreeSnapshot> {
  return invoke("get_tree_snapshot", { connectionId });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:

- `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/connectivity.test.tsx -t "requests a tree snapshot"`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/types.ts src/lib/commands.ts src-tauri/tests/subtree_cache_tests.rs src/connectivity.test.tsx
git commit -m "feat: add subtree cache snapshot dto and command"
```

### Task 3: 让 LiveAdapter 持有 connection-scoped subtree cache

**Files:**
- Modify: `src-tauri/src/zk_core/live.rs`
- Modify: `src-tauri/src/zk_core/cache.rs`
- Test: `src-tauri/tests/zk_core_tests.rs`

- [ ] **Step 1: 写失败测试，定义连接级 cache 生命周期**

在 `src-tauri/tests/zk_core_tests.rs` 中新增面向 `LiveAdapter` 的最小测试：

```rust
#[test]
fn sessions_start_with_empty_subtree_cache() {
    let state = AppState::default();
    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.is_empty());
}
```

并追加一个 cache 状态测试：

```rust
#[test]
fn cache_status_starts_as_bootstrapping() {
    let cache = ConnectionCache::new();
    assert_eq!(cache.status_label(), "bootstrapping");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml zk_core`

Expected: FAIL，`status_label` 或 connection cache 状态未定义。

- [ ] **Step 3: 给 cache 增加状态与 snapshot 导出**

在 `src-tauri/src/zk_core/cache.rs` 增加：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheStatus {
    Bootstrapping,
    Live,
    Resyncing,
    Stale,
}
```

以及：

- `status_label() -> &'static str`
- `set_status(CacheStatus)`
- `to_snapshot() -> TreeSnapshotDto`

- [ ] **Step 4: 在 LiveAdapter 中挂载 cache**

在 `src-tauri/src/zk_core/live.rs` 的 `LiveAdapter` 中新增字段：

```rust
cache: Arc<std::sync::Mutex<ConnectionCache>>,
```

在 `connect_live` 中初始化：

```rust
cache: Arc::new(std::sync::Mutex::new(ConnectionCache::new())),
```

并新增只读方法：

```rust
pub fn get_tree_snapshot(&self) -> Result<TreeSnapshotDto, String> {
    let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
    Ok(cache.to_snapshot())
}
```

- [ ] **Step 5: 跑 Rust 测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/zk_core/cache.rs src-tauri/src/zk_core/live.rs src-tauri/tests/zk_core_tests.rs
git commit -m "feat: attach subtree cache to live adapter"
```

### Task 4: 连接后后台 bootstrap 整树缓存

**Files:**
- Modify: `src-tauri/src/zk_core/live.rs`
- Modify: `src-tauri/src/zk_core/cache.rs`
- Test: `src-tauri/tests/subtree_cache_tests.rs`

- [ ] **Step 1: 写失败测试，定义 bootstrap 最小行为**

在 `src-tauri/tests/subtree_cache_tests.rs` 新增测试：

```rust
#[test]
fn snapshot_can_export_bootstrapped_root_nodes() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children("/", vec![
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
        NodeRecord::new("/zookeeper", "zookeeper", Some("/".into()), true),
    ]);
    cache.mark_live();

    let snapshot = cache.to_snapshot();
    assert_eq!(snapshot.status, "live");
    assert_eq!(snapshot.nodes.len(), 2);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，`mark_live` 未定义或 snapshot 不包含节点。

- [ ] **Step 3: 实现 cache bootstrap 辅助方法**

在 `src-tauri/src/zk_core/cache.rs` 新增：

- `mark_live()`
- `mark_resyncing()`
- `replace_all(nodes: Vec<NodeRecord>)`

`replace_all` 负责一次性替换整棵 cache，用于全量 bootstrap / resync。

- [ ] **Step 4: 在 LiveAdapter 中新增后台 bootstrap 入口**

在 `src-tauri/src/zk_core/live.rs` 中新增：

```rust
pub fn bootstrap_subtree_cache(&self) {
    let client = Arc::clone(&self.client);
    let cache = Arc::clone(&self.cache);
    let connection_id = self.connection_id.clone();
    let log_store = Arc::clone(&self.log_store);

    std::thread::spawn(move || {
        append_cache_log(&log_store, &connection_id, "cache_bootstrap_started", "/");
        match collect_full_tree_records(&client) {
            Ok(nodes) => {
                let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
                guard.replace_all(nodes);
                guard.mark_live();
                append_cache_log(&log_store, &connection_id, "cache_bootstrap_completed", "/");
            }
            Err(error) => {
                let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
                guard.set_status(CacheStatus::Stale);
                append_cache_error_log(&log_store, &connection_id, "cache_bootstrap_failed", "/", &error);
            }
        }
    });
}
```

- [ ] **Step 5: 在连接成功后触发 bootstrap**

在 `connect_live` 成功构造 `LiveAdapter` 后调用：

```rust
adapter.bootstrap_subtree_cache();
```

要求：

- 不阻塞 `connect_server` 的成功返回
- 首屏仍可继续使用现有根节点加载链路

- [ ] **Step 6: 跑 Rust 测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/zk_core/cache.rs src-tauri/src/zk_core/live.rs src-tauri/tests/subtree_cache_tests.rs
git commit -m "feat: bootstrap subtree cache in background"
```

### Task 5: 新增 cache delta 事件通道，先旁路验证后端同步正确性

**Files:**
- Modify: `src-tauri/src/domain.rs`
- Modify: `src-tauri/src/zk_core/live.rs`
- Modify: `src/lib/types.ts`
- Test: `src-tauri/src/zk_core/live.rs`

- [ ] **Step 1: 写失败测试，定义 cache event 映射**

在 `src-tauri/src/zk_core/live.rs` 现有 tests 下追加：

```rust
#[test]
fn cache_event_types_are_exposed_for_frontend_projection() {
    assert_eq!(map_cache_event_type("snapshot_ready"), Some("snapshot_ready"));
    assert_eq!(map_cache_event_type("nodes_added"), Some("nodes_added"));
    assert_eq!(map_cache_event_type("nodes_removed"), Some("nodes_removed"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml live`

Expected: FAIL，`map_cache_event_type` 未定义。

- [ ] **Step 3: 新增 cache 事件 DTO**

在 `src-tauri/src/domain.rs` 新增：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEventDto {
    pub connection_id: String,
    pub event_type: String,
    pub parent_path: Option<String>,
    pub paths: Vec<String>,
}
```

在 `src/lib/types.ts` 新增对应 TS 类型：

```ts
export interface CacheEvent {
  connectionId: string;
  eventType: "snapshot_ready" | "nodes_added" | "nodes_removed" | "nodes_updated" | "resync_completed";
  parentPath: string | null;
  paths: string[];
}
```

- [ ] **Step 4: 在 bootstrap 与 watch 更新路径中发 `zk-cache-event`**

在 `src-tauri/src/zk_core/live.rs` 新增：

- `emit_cache_event(...)`
- bootstrap 完成后发 `snapshot_ready`
- cache 局部增删时发 `nodes_added` / `nodes_removed`

要求：

- 第一版可以只覆盖 bootstrap 和 children 变化
- 先不删除旧 `zk-watch-event`
- cache 事件是旁路验证，不立即替换旧逻辑

- [ ] **Step 5: 跑测试通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml live`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain.rs src-tauri/src/zk_core/live.rs src/lib/types.ts
git commit -m "feat: emit subtree cache delta events"
```

### Task 6: 前端接入 snapshot / delta，但不切换主树渲染

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Modify: `src/connectivity.test.tsx`
- Modify: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，定义 snapshot 拉取与旁路监听**

在 `src/connectivity.test.tsx` 新增：

```tsx
it("loads tree snapshot after connection without switching tree rendering source", async () => {
  getTreeSnapshotMock.mockResolvedValue({
    status: "live",
    nodes: [
      { path: "/ssdev", name: "ssdev", parentPath: "/", hasChildren: true },
      { path: "/ssdev/services", name: "services", parentPath: "/ssdev", hasChildren: true },
    ],
  });

  const { result } = renderHook(() => useWorkbenchState());

  await act(async () => {
    await result.current.submitConnection({
      connectionId: "local",
      connectionString: "127.0.0.1:2181",
      username: "",
      password: "",
    });
  });

  expect(getTreeSnapshotMock).toHaveBeenCalledWith("local");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/connectivity.test.tsx -t "loads tree snapshot after connection"`

Expected: FAIL，尚未调用 `getTreeSnapshot`。

- [ ] **Step 3: 连接后后台拉取 snapshot，并保存为旁路状态**

在 `src/hooks/use-workbench-state.ts` 新增 connection-scoped snapshot state：

```ts
const cacheSnapshotsRef = useRef<Map<string, TreeSnapshot>>(new Map());
```

在 `submitConnection` 成功后追加：

```ts
void getTreeSnapshot(connId)
  .then((snapshot) => {
    cacheSnapshotsRef.current.set(connId, snapshot);
  })
  .catch(() => {
    // snapshot failure should not block existing tree flow
  });
```

并新增 `zk-cache-event` listener，但第一版只更新 `cacheSnapshotsRef`，不改 `treeNodes` 主逻辑。

- [ ] **Step 4: 跑前端测试通过**

Run:

- `npm test -- src/connectivity.test.tsx src/use-workbench-watch.test.tsx`
- `npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/connectivity.test.tsx src/use-workbench-watch.test.tsx
git commit -m "feat: consume subtree cache snapshot in parallel"
```

### Task 7: 将树渲染切到 cache projection

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Create: `src/hooks/use-tree-projection.ts`
- Modify: `src/browser-pane.test.tsx`
- Modify: `src/use-workbench-watch.test.tsx`
- Modify: `src/connectivity.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖“未展开父路径下的外部新增也能自动出现”**

在 `src/use-workbench-watch.test.tsx` 新增：

```tsx
it("shows nodes added under an unexpanded parent after cache delta arrives", async () => {
  const { result } = await connectAndGet();

  await act(async () => {
    emitCacheEvent({
      connectionId: "c1",
      eventType: "nodes_added",
      parentPath: "/ssdev/services",
      paths: ["/ssdev/services/bbp"],
    });
  });

  await waitFor(() => {
    const services = findTreeNode(result.current.treeNodes, "/ssdev/services");
    expect(services?.children?.some((n) => n.path === "/ssdev/services/bbp")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "shows nodes added under an unexpanded parent"`

Expected: FAIL，当前 `treeNodes` 仍由旧 watch / list 流控制。

- [ ] **Step 3: 抽出 projection hook**

创建 `src/hooks/use-tree-projection.ts`，实现：

```ts
export function buildProjectedTree(
  snapshot: TreeSnapshot | null,
  expandedPaths: Set<string>
): NodeTreeItem[] {
  // 将扁平 cache snapshot 投影成 UI 树
}
```

要求：

- 根层从 `parentPath === "/"` 或 `null` 推导
- 未展开节点只保留当前层 children 占位，不递归铺开
- `hasChildren` 直接来自 cache

- [ ] **Step 4: 在 `useWorkbenchState` 中切换树来源**

将 `treeNodes` 推导逐步切到：

- 优先 `cacheSnapshotsRef.current.get(activeTabId)` 投影
- snapshot 不可用时回退旧 `activeSession.treeNodes`

要求：

- 保持 `expandedPaths`、`activePath`、`loadingPaths` 现有语义
- 删除旧的“新节点 re-probe / 观察窗口”逻辑前，先保证新逻辑通过

- [ ] **Step 5: 跑测试通过**

Run:

- `npm test -- src/use-workbench-watch.test.tsx src/connectivity.test.tsx src/browser-pane.test.tsx`
- `npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-tree-projection.ts src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx src/connectivity.test.tsx src/browser-pane.test.tsx
git commit -m "feat: render browser tree from subtree cache projection"
```

### Task 8: 补 reconnect / resync / 降级与日志收口

**Files:**
- Modify: `src-tauri/src/zk_core/live.rs`
- Modify: `src-tauri/src/logging.rs`
- Modify: `src/hooks/use-workbench-state.ts`
- Test: `src-tauri/tests/subtree_cache_tests.rs`
- Test: `src/use-workbench-watch.test.tsx`

- [ ] **Step 1: 写失败测试，定义 resync 后恢复一致性**

在 `src-tauri/tests/subtree_cache_tests.rs` 新增：

```rust
#[test]
fn replace_all_can_recover_from_stale_cache_state() {
    let mut cache = ConnectionCache::new();
    cache.upsert_children("/", vec![
        NodeRecord::new("/old", "old", Some("/".into()), false),
    ]);

    cache.replace_all(vec![
        NodeRecord::new("/ssdev", "ssdev", Some("/".into()), true),
    ]);
    cache.mark_live();

    assert!(cache.node("/old").is_none());
    assert!(cache.node("/ssdev").is_some());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --test subtree_cache_tests --manifest-path src-tauri/Cargo.toml`

Expected: FAIL，如果 `replace_all` 仍未完整覆盖旧树。

- [ ] **Step 3: 增加 resync 日志和状态流**

在 `src-tauri/src/zk_core/live.rs` 中新增：

- `cache_resync_started`
- `cache_resync_completed`
- `cache_resync_failed`

并在 reconnect / 强制重建入口接入这些日志。

- [ ] **Step 4: 前端显示 cache status，但不阻塞主界面**

在 `src/hooks/use-workbench-state.ts` 中把 snapshot status 暴露为只读 UI 状态，用于未来提示：

```ts
cacheStatus: activeTabId ? cacheSnapshotsRef.current.get(activeTabId)?.status ?? "stale" : "stale"
```

- [ ] **Step 5: 跑全量相关测试**

Run:

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test -- src/use-workbench-watch.test.tsx src/connectivity.test.tsx`
- `npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/zk_core/live.rs src-tauri/src/logging.rs src/hooks/use-workbench-state.ts src-tauri/tests/subtree_cache_tests.rs src/use-workbench-watch.test.tsx
git commit -m "feat: add subtree cache resync and status reporting"
```

### Task 9: 删除旧的前端补探测逻辑，完成迁移收尾

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Modify: `src/use-workbench-watch.test.tsx`
- Modify: `src/connectivity.test.tsx`

- [ ] **Step 1: 写失败测试，验证无需旧 re-probe 仍可收敛**

在 `src/use-workbench-watch.test.tsx` 新增：

```tsx
it("does not rely on leaf reprobe timers once cache projection is active", async () => {
  const { result } = await connectAndGet();

  await act(async () => {
    emitCacheEvent({
      connectionId: "c1",
      eventType: "nodes_added",
      parentPath: "/ssdev/services",
      paths: ["/ssdev/services/bbp"],
    });
  });

  const services = findTreeNode(result.current.treeNodes, "/ssdev/services");
  expect(services?.children?.some((n) => n.path === "/ssdev/services/bbp")).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认旧逻辑仍被引用**

Run: `npm test -- src/use-workbench-watch.test.tsx -t "does not rely on leaf reprobe timers"`

Expected: FAIL，当前代码仍依赖旧 watch 补探测路径。

- [ ] **Step 3: 移除旧前端 workaround**

在 `src/hooks/use-workbench-state.ts` 中删除：

- `recentLeafProbeRefs`
- `scheduledLeafProbeRefs`
- `probeFreshNodes`
- `scheduleLeafReprobe`
- 仅为“恢复可展开状态”服务的旧 childrenCount 探测逻辑

保留：

- 真正的编辑态保护
- 正在查看节点的数据刷新
- 删除后的 activePath 清理

- [ ] **Step 4: 跑回归确认新主路径稳定**

Run:

- `npm test -- src/use-workbench-watch.test.tsx src/connectivity.test.tsx src/browser-pane.test.tsx`
- `npx tsc --noEmit`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/use-workbench-watch.test.tsx src/connectivity.test.tsx
git commit -m "refactor: remove legacy watch reprobe workarounds"
```

### Task 10: 文档、验收与手动回归

**Files:**
- Modify: `docs/superpowers/specs/2026-03-29-rust-subtree-cache-design.md`
- Modify: `docs/superpowers/plans/2026-03-29-rust-subtree-cache-implementation.md`

- [ ] **Step 1: 更新设计文档中的实现状态**

在 `docs/superpowers/specs/2026-03-29-rust-subtree-cache-design.md` 中补充：

- 已完成阶段
- 实际接口命名
- 与设计的偏差

- [ ] **Step 2: 运行最终验证**

Run:

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test`
- `npx tsc --noEmit`

Expected: 全部 PASS。

- [ ] **Step 3: 执行手动验收**

手动回归清单：

1. 启动应用后不要展开 `/ssdev/services`
2. 外部创建 `/ssdev/services/bbp`
3. 回到 ZooCute，确认 `bbp` 自动出现
4. 外部继续创建 `/ssdev/services/bbp/*`
5. 确认 `bbp` 自动变为可展开
6. 外部删除 `bbp`
7. 确认树与日志收敛，不出现误导性连续 `ERR NoNode`
8. 批量重建多个子节点，确认 UI 不明显卡死

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-29-rust-subtree-cache-design.md docs/superpowers/plans/2026-03-29-rust-subtree-cache-implementation.md
git commit -m "docs: finalize subtree cache rollout notes"
```
