# 阶段二：ZK Watch 实时监听节点变化

> 日期：2026-03-29
> 前置：阶段一（全量预加载 + 搜索）已完成

---

## 目标

当 ZooKeeper 服务端上某个节点的数据或子节点列表发生变化时，客户端树视图和详情面板自动更新，无需用户手动刷新。

---

## 背景：ZK Watch 机制

`zookeeper` crate 提供三类带 watch 的方法：

| 方法 | Watch 触发时机 |
|------|--------------|
| `get_children_w(path, watcher)` | 该路径的子节点列表新增或删除 |
| `get_data_w(path, watcher)` | 该路径的节点数据被修改 |
| `exists_w(path, watcher)` | 该路径节点被创建或删除 |

**关键约束**：Watch 是一次性的——触发后自动注销，需要重新注册才能持续监听。

---

## 架构方案

### 整体数据流

```
ZK Server
  │ watch fire（后台线程）
  ▼
Rust Watcher::handle()
  │ 1. 重新注册 watch
  │ 2. AppHandle::emit("zk-watch-event", payload)
  ▼
Tauri 事件总线
  ▼
前端 listen("zk-watch-event")
  │ 按 event_type 分发
  ▼
更新 session 树 / activeNode
```

### 监听范围（按需注册，不全量）

- **`list_children` 调用时**：同时注册 `get_children_w`，监听该路径的子节点变化
- **`get_node` 调用时**：同时注册 `get_data_w`，监听该路径的数据变化
- 未展开、未访问的节点不注册 watch，避免连接服务端 watch 配额

---

## Rust 侧改动

### 1. `domain.rs` — 新增事件 DTO

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatchEventDto {
    pub connection_id: String,
    pub event_type: String,   // "children_changed" | "data_changed" | "node_deleted" | "node_created"
    pub path: String,
}
```

### 2. `live.rs` — Watcher 结构体

两个独立的 watcher 结构体，分别处理子节点变化和数据变化：

```rust
struct ChildrenWatcher {
    client: Arc<ZooKeeper>,
    app_handle: AppHandle,
    connection_id: String,
    path: String,
}

struct DataWatcher {
    client: Arc<ZooKeeper>,
    app_handle: AppHandle,
    connection_id: String,
    path: String,
}
```

**`ChildrenWatcher::handle()`** 逻辑：
1. 判断 `event_type`：
   - `NodeChildrenChanged` / `NodeCreated` → emit `children_changed`，重新注册 `get_children_w`
   - `NodeDeleted` → emit `node_deleted`，**不重新注册**
2. 用 `app_handle.emit("zk-watch-event", payload)` 推送事件

**`DataWatcher::handle()`** 逻辑：
1. `NodeDataChanged` → emit `data_changed`，重新注册 `get_data_w`
2. `NodeDeleted` → emit `node_deleted`，不重新注册

### 3. `LiveAdapter` — 修改现有方法

`LiveAdapter` 新增字段：
```rust
pub struct LiveAdapter {
    client: Arc<ZooKeeper>,
    connection_id: String,
    log_store: Arc<ZkLogStore>,
    app_handle: AppHandle,   // 新增
}
```

修改 `connect_live` 签名加入 `app_handle: AppHandle` 参数。

`do_list_children` 和 `do_get_node` 从 `get_children(false)` / `get_data(false)` 改为 `get_children_w` / `get_data_w`，传入对应 watcher。

### 4. `commands.rs` / `lib.rs`

`AppState` 存储 `AppHandle`，在 `.setup()` 回调里拿到后注入：

```rust
app.manage(AppState::new(log_path, app.handle().clone()));
```

`connect_server` 把 `app_handle` 传给 `connect_live`。

---

## 前端侧改动

### 1. `lib/types.ts` — 事件类型

```ts
export interface WatchEvent {
  connectionId: string;
  eventType: "children_changed" | "data_changed" | "node_deleted" | "node_created";
  path: string;
}
```

### 2. `lib/commands.ts` — 无需改动

Watch 事件通过 Tauri 事件总线推送，不走 invoke。

### 3. `hooks/use-workbench-state.ts` — 监听事件

连接成功后注册监听，断开时注销：

```ts
// 连接成功后
const unlisten = await listen<WatchEvent>("zk-watch-event", (e) => {
  handleWatchEvent(e.payload);
});
unlistenRefs.current.set(connectionId, unlisten);

// 断开时
unlistenRefs.current.get(connectionId)?.();
unlistenRefs.current.delete(connectionId);
```

**`handleWatchEvent` 分发逻辑**：

| eventType | 动作 |
|-----------|------|
| `children_changed` / `node_created` | `ensureChildrenLoaded(connId, path, {force: true})`；同时更新搜索索引 |
| `data_changed` | 如果 `path === activePath`，重新 `getNodeDetails` 更新详情面板 |
| `node_deleted` | 从树中移除节点；更新搜索索引；若 `path === activePath` 则清空详情面板 |

`node_deleted` 处理时需找到父路径并 force-refresh 父节点的子列表，与现有 `deleteNodeFn` 逻辑对齐。

---

## 边界情况

| 场景 | 处理方式 |
|------|---------|
| Watch 触发时会话已断开 | Watcher 持有 `Arc<ZooKeeper>`，`client.get_children_w` 会返回错误，不 emit，不重新注册 |
| 节点被删除后收到 data_changed | `NodeDeleted` 事件会先到达，`data_changed` 因节点不存在不会 emit |
| 快速连续多个 watch 事件（写入风暴） | 前端 `handleWatchEvent` 正常串行处理即可；如有性能问题后续可加 debounce |
| 用户正在编辑节点时数据被外部修改 | 收到 `data_changed` 但该路径处于编辑状态，**不覆盖 activeNode**，可弹出提示（可选） |
| 服务端断开重连 | `KeeperState::Disconnected` / `Expired` 会通过 `NoopWatcher`（全局 session watcher）传入，现阶段不处理，Phase 3 考虑 |

---

## 实现顺序

1. **`domain.rs`**：加 `WatchEventDto`（5 min）
2. **`live.rs`**：加 `ChildrenWatcher` / `DataWatcher`，修改 `LiveAdapter` + `do_list_children` / `do_get_node`（主要工作）
3. **`commands.rs` / `lib.rs`**：注入 `AppHandle`（10 min）
4. **前端 `use-workbench-state.ts`**：注册/注销监听，实现 `handleWatchEvent`（主要工作）
5. **类型 / 测试**：`WatchEvent` 类型，跑 `tsc --noEmit` + `vitest run`

---

## 不在本阶段做的事

- 全局 session watcher（断线重连通知）
- Ephemeral 节点创建监听
- Watch 事件写入 debug 日志
- 监听统计（当前活跃 watch 数）
