# Zoocute 架构与实现细节

最后更新：2026-06-08

本文档记录 Zoocute 当前核心架构，以及本次“超大树搜索流式索引”改动后的真实实现。它是长期维护文档，不依赖 `docs/superpowers/` 里的阶段性计划或设计稿。

## 目标

Zoocute 是一个基于 Tauri、Rust、React 和 TypeScript 的 ZooKeeper 桌面客户端。核心目标是：

- 保持桌面 UI 响应，不让大型 ZooKeeper 树遍历阻塞前端。
- 浏览节点树时按需加载，搜索索引在后台逐步建立。
- 后端维护连接级缓存，前端维护会话级搜索索引。
- 搜索只覆盖 znode 的路径和名称，不读取或搜索节点 data。

## 总体分层

```text
React UI
  App / BrowserPane / EditorPane
  hooks/use-workbench-state
  hooks/use-node-search
  lib/path-search-index
        |
        | Tauri commands + window events
        v
Rust Tauri backend
  src-tauri/src/commands.rs
  src-tauri/src/zk_core/live.rs
  src-tauri/src/zk_core/cache.rs
        |
        | zookeeper-client
        v
ZooKeeper cluster
```

前端负责界面状态、搜索输入、搜索结果渲染、用户操作入口。后端负责 ZooKeeper 连接、watch 注册、缓存扫描、节点读写和事件推送。

## 关键数据结构

### 后端 DTO

后端 DTO 位于 `src-tauri/src/domain.rs`，使用 `serde(rename_all = "camelCase")` 暴露给前端。

搜索流式索引新增 `IndexEventDto`：

```rust
pub struct IndexEventDto {
    pub connection_id: String,
    pub run_id: String,
    pub event_type: String,
    pub indexed_count: usize,
    pub nodes: Vec<CachedTreeNodeDto>,
    pub error: Option<String>,
}
```

其中 `CachedTreeNodeDto` 只包含树结构索引需要的信息：

```rust
pub struct CachedTreeNodeDto {
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub has_children: bool,
}
```

不包含节点 data、stat 详情或 ACL。

### 前端类型

前端类型位于 `src/lib/types.ts`。`IndexEvent` 与 Rust DTO 对应，字段为 camelCase：

```ts
export interface IndexEvent {
  connectionId: string;
  runId: string;
  eventType: "started" | "batch" | "completed" | "failed" | "cancelled";
  indexedCount: number;
  nodes: CachedTreeNode[];
  error: string | null;
}
```

## 连接与缓存启动流程

用户连接 ZooKeeper 后，流程分为两条并行但关联的链路：

1. 前端调用 `connectServer` 建立后端连接。
2. 后端 `LiveAdapter::connect_live()` 创建客户端、标记缓存 `resyncing`，然后启动后台缓存扫描。
3. 前端继续调用 `listChildren("/")` 获取首屏根节点，用于立即展示树。
4. 后端后台扫描在遍历过程中持续 emit `zk-index-event`，前端边接收边更新搜索索引。
5. 后端扫描完成后写入 `ConnectionCache`，标记 `live`，再 emit 既有 `snapshot_ready` cache event。

也就是说，搜索索引不再由前端连接后额外调用 `load_full_tree` 触发。`load_full_tree` command 仍保留兼容，但不参与自动搜索索引。

## 流式搜索索引事件

事件名：`zk-index-event`

后端发送的事件类型如下：

| 类型 | 触发时机 | payload 要点 |
| --- | --- | --- |
| `started` | 新一轮后台扫描开始 | `connectionId`、`runId`，`indexedCount=0`，`nodes=[]` |
| `batch` | 每累计 500 个节点 | `nodes` 包含本批节点，`indexedCount` 是截至本批的总数 |
| `completed` | 全树扫描成功完成 | `indexedCount` 是最终节点数，`nodes=[]` |
| `failed` | ZooKeeper 读取出错 | `error` 包含错误，`indexedCount` 是失败前已索引数量 |
| `cancelled` | 连接断开或旧任务停止 | `indexedCount` 是停止前已索引数量 |

`runId` 由后端生成，格式类似 `<connectionId>-<counter>`。前端只接受当前连接最新 `runId` 的事件，用来忽略重连或旧扫描任务产生的过期事件。

## 后端实现

主要实现位于 `src-tauri/src/zk_core/live.rs`。

### 启动位置

`LiveAdapter::connect_live()` 成功创建 ZooKeeper client 后：

- 调用 `mark_cache_resyncing()` 将 `ConnectionCache` 标记为重建中。
- 写入 `cache_resync_started` 日志。
- 调用 `bootstrap_subtree_cache()` 启动后台任务。

### 后台扫描

`bootstrap_subtree_cache()` 使用 `tauri::async_runtime::spawn_blocking` 启动阻塞型扫描，避免 ZooKeeper 遍历占用 async runtime 的轻量任务线程，也避免阻塞前端调用链。

扫描入口是 `collect_full_tree_records_streaming()`：

- 从根节点 `/` 获取 children。
- 使用显式 `Vec` stack 做迭代式 DFS。
- 每访问一个节点，读取它的 children 来判断 `hasChildren`，但不读取节点 data。
- 将节点写入本地 `records`，供扫描完成后一次性 `replace_all()` 到后端 `ConnectionCache`。
- 同时将节点转换成 `CachedTreeNodeDto` 放入 batch。
- batch 达到 `INDEX_BATCH_SIZE = 500` 时 emit `batch` 事件。
- 扫描结束后，如果最后一批不足 500 个节点，也会 emit 最后一批。

使用迭代 DFS 的原因是避免超深 ZooKeeper 树导致递归栈风险。

### 完成、失败与取消

扫描成功后：

- 检查 `shutdown`，如果连接已关闭则发送 `cancelled` 并停止。
- 将完整 `records` 写入 `ConnectionCache`。
- 标记缓存为 `live`。
- 发送 `completed`。
- 发送既有的 `snapshot_ready` cache event。

扫描失败后：

- 将缓存状态设置为 `stale`。
- 发送 `failed`，包含错误和已索引数量。
- 写入 cache resync 失败日志。

连接断开或旧任务停止时：

- `shutdown: Arc<AtomicBool>` 会被设置。
- 扫描循环在节点之间检查 shutdown。
- 发现 shutdown 后返回 `Cancelled`，外层发送 `cancelled`。

## 前端实现

主要实现位于 `src/hooks/use-workbench-state.ts`、`src/hooks/use-node-search.ts` 和 `src/lib/path-search-index.ts`。

### 连接流程

`submitConnection()` 在调用 `connectServer()` 前先注册 `zk-index-event` listener。这样可以避免后端很快发出 `started` 或首个 `batch` 时前端还没有监听导致漏事件。

连接成功后：

- 前端调用 `listChildren("/")` 获取首屏树。
- 用首屏根节点先调用 `nodeSearch.indexNodes(connectionId, "/", rootNodes)`，保证最基础搜索可用。
- 后续全树节点由 `zk-index-event` 批量补充。

### 事件处理

`handleIndexEvent()` 处理流式事件：

- `started`
  - 记录当前 `runId`。
  - 清空该连接旧搜索索引。
  - 将已索引数量设为 0。
  - 设置该连接 `isIndexing=true`。
- `batch`
  - 只有 `runId` 匹配时才处理。
  - 调用 `nodeSearch.upsertCachedNodes()` 追加或更新节点。
  - 更新 `indexedNodeCount`。
- `completed`
  - 清除 indexing 状态。
  - 删除当前 `runId`。
- `failed` / `cancelled`
  - 清除 indexing 状态。
  - 如果流式索引尚未收到任何 batch，会用当前会话已加载树重新 seed 搜索索引，避免 `started` 清空索引后首屏节点也无法搜索。

### 搜索索引结构

`PathSearchIndex` 维护两份索引：

```ts
private byPath = new Map<string, CachedNode>();
private childrenByParent = new Map<string, Set<string>>();
```

`byPath` 用于按路径保存节点并执行本地搜索。`childrenByParent` 用于快速找到某个 parent 的直接 children，避免每次刷新某个父节点时都全量扫描索引。

核心操作：

- `insert()`：写入或更新节点，同时维护父子索引。
- `upsertCachedNodes()`：接收后端 `CachedTreeNode` batch 并批量插入。
- `removeChildren(parentPath)`：刷新某个父节点 children 前，删除旧的直接子树。
- `removeSubtree(path)`：递归删除 path 及 descendants。
- `search(keyword)`：只做本地 `name.toLowerCase().includes(keyword)`。

排序规则沿用当前实现：

1. 完全匹配名称优先。
2. 名称前缀匹配优先。
3. 路径短的优先。
4. 路径字典序。

### React 重渲染

索引数据存在 `useRef<Map<string, PathSearchIndex>>` 中，避免每次写入都替换大对象。为了让流式 batch 到达后搜索结果立即刷新，`useNodeSearch` 维护了 `indexVersion` state。每次索引变更后递增版本号，触发 hook 重新计算 `searchResults`。

## UI 行为

浏览器左侧树搜索框保持不变。

当后台索引正在构建时，`BrowserPane` 显示：

```text
正在建立搜索索引，已索引 X 个节点…
```

如果用户搜索但暂无结果：

- 索引构建中：提示“索引仍在构建，结果可能不完整”。
- 索引完成后：恢复“未找到匹配的已缓存节点”。

因此大型树连接后，搜索结果会逐批变多，而不是等完整索引结束后一次性可用。

## 与 PrettyZoo 搜索思路的关系

当前实现借鉴了 PrettyZoo 风格的本地路径索引思想：搜索时不向 ZooKeeper 发请求，而是在客户端已有的树结构缓存中搜索节点名称。

差异是：

- PrettyZoo 风格重点是本地索引搜索体验。
- Zoocute 这次优化重点是把索引来源从“前端再次全量拉树”改成“后端缓存扫描过程中顺手推送”，消除重复遍历。
- Zoocute 仍只索引 path/name/parentPath/hasChildren，不做 data 内容搜索。

## 性能特征

这次改动解决的是“重复全树遍历”和“索引完成前不可搜索”的问题。

已经改善：

- 连接后不再由前端自动调用 `load_full_tree` 重扫 ZooKeeper。
- 后端缓存扫描时每 500 个节点推送一次索引 batch。
- 前端收到 batch 后立即可搜索，无需等完整树扫描结束。
- 后端扫描使用迭代 DFS，避免深树递归栈风险。
- 前端刷新某个父节点 children 时，使用 `childrenByParent` 避免全索引扫描找直接 children。

仍然存在：

- 后端仍需要对 ZooKeeper 做一次完整树结构遍历。
- 后端扫描期间仍保留完整 `records`，完成后一次性写入 `ConnectionCache`；这会占用与节点数线性相关的内存。
- `removeSubtree(path)` 仍通过 path 前缀扫描删除 descendants；它主要发生在删除节点或刷新旧子树时，不是流式 batch 的热路径。
- 搜索只匹配节点名称，不匹配完整 path，也不搜索 data。

## 失败与一致性策略

### stale run 事件

前端以 `indexRunRefs` 保存每个连接当前有效 `runId`。除 `started` 外，其它事件如果 `runId` 不匹配会被忽略。这样可以处理重连、新连接覆盖旧连接、后台旧任务延迟发送事件等情况。

### listener 注册失败

索引 listener 注册是 best effort。注册失败不会阻断连接和树浏览，只会影响流式搜索索引。

### 早期失败 fallback

如果后端发送 `started` 后还没来得及发送任何 `batch` 就 `failed` 或 `cancelled`，前端会发现当前索引 size 为 0，并用当前会话已加载的树节点重新建立搜索索引。这样首屏已经加载的节点仍可搜索。

## 现有 watch 与 cache 关系

流式索引不替代已有 watch/cache 机制。

- `zk-watch-event` 用于节点 children/data/session 变化通知。
- `zk-cache-event` 用于后端缓存 snapshot ready、nodes added/removed 等事件。
- `zk-index-event` 只负责搜索索引批量交付。

当 watch 发现 children 变化时，前端仍通过 `ensureChildrenLoaded(..., { force: true })` 刷新对应父节点，并用 `nodeSearch.indexNodes()` 更新该父节点下的搜索索引。

## 验证覆盖

### Rust

`src-tauri/src/zk_core/live.rs` 中覆盖了：

- index event type 映射。
- `IndexEventDto` 序列化字段为 camelCase。
- batch 切分超过 500 节点时产生多 batch。
- shutdown/cancel 时停止并返回 cancelled。

推荐验证命令：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### Frontend

前端测试覆盖了：

- 连接成功后不再自动调用 `loadFullTree`。
- 收到 `started` 后设置 indexing 状态并清空旧索引。
- 收到 `batch` 后无需展开节点即可搜到 batch 里的节点。
- 多个 batch 到达时搜索结果持续增加并重渲染。
- stale `runId` 事件会被忽略。
- `completed` / `failed` / `cancelled` 后结束 indexing 状态。
- `failed` / `cancelled` 早于任何 batch 时恢复已加载节点搜索。
- `PathSearchIndex` 的父子索引、批量 upsert、移动 parent 和刷新删除逻辑。

推荐验证命令：

```bash
npm test
npm run build
```

## 后续可优化点

这些不是当前实现的一部分，但如果后续大型树仍有压力，可以考虑：

- 将 batch size 从 500 调小到 200，降低单次前端 upsert 和渲染压力。
- 后端 `ConnectionCache` 支持增量写入，减少扫描期间同时持有 batch 和完整 records 的内存峰值。
- 搜索从 name-only 扩展到 path 匹配，但需要重新确认排序和 UI 展示策略。
- 为 `removeSubtree` 增加 descendants 索引，进一步减少删除大子树时的前缀扫描成本。
- 增加索引进度日志或调试面板，便于现场定位大型集群连接性能问题。
