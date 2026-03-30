# ZooCute Rust 全量 Subtree Cache 改造评估与分阶段设计

**日期：** 2026-03-29
**状态：** 草案

---

## 目标

将 ZooCute 当前“按需加载 + 按需注册 watch”的 ZooKeeper 树同步模型，升级为更接近 PrettyZoo 的“连接级整树缓存镜像”模型。

本次设计文档的目标不是直接进入实现，而是先回答下面几个问题：

- 为什么当前模型在“启动后外部新增节点”场景下天然有盲区
- 如果坚持留在 Rust 侧做全量 subtree cache，需要改哪些层
- 这项改造的技术成本、运行成本、接口变化和主要风险分别是什么
- 这项工作如何拆成可逐步落地的阶段，而不是一次性重写

---

## 范围

### 本次包含

- 对现有 watch 模型的局限性分析
- 对齐 PrettyZoo/Curator 思路后的 Rust 侧目标模型
- 后端、前端、接口、日志与测试的改造评估
- 分阶段设计与每阶段验收标准
- 主要风险、降级策略与不做项

### 本次不包含

- 直接编写 subtree cache 实现代码
- 直接替换当前 `LiveAdapter`
- 引入 Java sidecar / Curator
- 完整的性能基准测试实现
- 完整的 reconnect 形式化一致性证明

---

## 背景与问题定义

当前 ZooCute 的树同步模型具有以下特征：

- 只有用户已经加载过的路径，才可能注册 children/data watch
- 前端树状态同时承担“渲染状态”和“事实缓存”两种职责
- 外部变更主要通过 `zk-watch-event` 驱动局部刷新
- 对“节点被删后重建”“先建父节点再建子节点”“启动后未展开分支被外部新增”等场景，需要额外补探测逻辑兜底

这个模型在中小规模交互上是成立的，但它有一个结构性限制：

> **没有被加载过的父路径，就没有 watch；没有 watch，就无法感知该分支下后续发生的外部新增。**

因此像下面这个场景会天然失效：

1. 应用启动
2. `/ssdev/services` 尚未被加载或展开
3. 外部程序创建 `/ssdev/services/bbp`
4. ZooCute 不会收到任何该路径相关变更

这不是某个局部 bug，而是当前架构的边界。

---

## PrettyZoo 风格目标模型

PrettyZoo 的用户体验更接近这样一种模型：

- 连接建立后，就维护一份连接级别的树缓存
- UI 显示的是缓存投影，而不是临时拼出的局部结果
- 外部新增/删除/更新优先通过缓存事件增量修正
- 用户展开节点更多是“显示已知结构”，而不是“触发结构发现”

对于 ZooCute，如果要对齐这个体验，Rust 侧需要演进到：

1. 每个连接维护一份 connection-scoped subtree cache
2. 该 cache 持有路径索引、父子关系、节点元信息和必要的数据摘要
3. 后端持续消费 ZooKeeper watch 事件并更新 cache
4. 前端不再把 `treeNodes` 当作唯一事实来源，而是消费 cache snapshot / delta

这意味着 subtree cache 是一个**新的核心同步层**，不是简单的 watch 小修。

---

## 现状局限

### 1. 感知范围受限

- 只有已加载路径才有 watch
- 未触达的分支无法自动发现外部新增

### 2. 状态职责混杂

- `treeNodes` 既负责展示，又承担部分结构事实
- `expandedPaths`、`loadingPaths`、`search cache`、watch 修正逻辑之间有隐式耦合

### 3. 竞态补丁越来越多

当前已经存在多种兜底逻辑：

- 新增节点后补探测 `childrenCount`
- 短时二次 probe
- `NoNode` 强刷降噪
- 同路径 watch / refresh 合并

这些都是必要修正，但本质上是在当前模型上加弹性，而不是解决“缓存范围不完整”的根问题。

### 4. 前端承担了过多结构修复责任

如果继续沿当前方向扩展，前端需要不断知道：

- 哪些路径应该被当作新增节点探测
- 哪些 `NoNode` 是良性竞态
- 哪些节点应自动转成可展开
- 哪些删除应导致父节点回刷

这会让树同步越来越难维护。

---

## 方案对比

### 方案 A：继续保留当前按需 watch，增加更多热点预热和补探测

优点：

- 改动最小
- 现有前后端结构基本可保留
- 适合局部热点目录

缺点：

- 仍然无法从架构上解决“未加载路径无感知”问题
- 补丁会持续堆积
- 行为上仍不接近 PrettyZoo

### 方案 B：Rust 侧实现全量 subtree cache

优点：

- 保持当前 Tauri + Rust 架构简单
- 最终体验最接近 PrettyZoo
- 前端可逐步变成 cache 驱动渲染
- 不引入额外运行时和跨语言桥接

缺点：

- `zookeeper` crate 没有 Curator 式现成 cache，需要自己实现
- 后端同步层复杂度显著上升
- reconnect、风暴控制、一致性收敛需要额外设计

### 方案 C：切 Java sidecar，复用 Curator subtree cache

优点：

- ZooKeeper 缓存层实现难度最低
- 能直接借鉴 Curator / PrettyZoo 的成熟能力

缺点：

- 整体系统复杂度大幅上升
- 打包、分发、日志、崩溃恢复、IPC 都会变复杂
- 与当前单后端桌面应用形态不一致

### 结论

本轮采用 **方案 B：Rust 侧实现全量 subtree cache**。

理由：

- 用户目标已经明确是“更像 PrettyZoo 的整树感知能力”
- 用户同时希望保留 Rust 侧架构，不引入 Java sidecar
- 虽然实现难，但从整体维护和分发角度，仍然是更稳的长期方案

---

## 设计原则

### 1. 后端 cache 是结构事实来源

整树结构、父子关系、节点存在性和 children/data 元信息，应以后端 subtree cache 为准。

### 2. 前端只维护视图状态

前端主要保留：

- 展开态
- 选中态
- 编辑态
- 搜索输入
- 局部 loading / error 展示

而不是继续在前端拼接结构真相。

### 3. 增量事件优先，快照兜底

正常情况下通过增量事件修正 cache；断连重连或怀疑漂移时，通过 subtree resync 纠偏。

### 4. 单连接隔离

每个 connectionId 维护独立 cache、独立同步状态、独立 resync 生命周期，避免跨连接污染。

### 5. 一致性优先于“瞬时绝对实时”

不要求每个瞬间都与服务端完全一致，但要求：

- 变更最终能稳定收敛
- reconnect 后能重新同步
- UI 不长期卡在错误结构

### 6. 风暴治理内建

批量删除 / 批量重建 / 大树初始化不是边缘场景，必须在设计里一开始就考虑去重、合并和限流。

---

## 目标架构

建议新增一层后端同步模型：

1. `LiveAdapter`
2. `SubtreeCache`
3. `CacheEventStream`
4. Frontend Projection

### 1. `LiveAdapter`

继续负责：

- ZooKeeper client 生命周期
- 原始 ZK 调用
- watch 注册和回调

但它不再直接把 watch 事件等价地转成前端 UI 刷新信号。

### 2. `SubtreeCache`

新增连接级缓存对象，负责：

- `path -> node record` 索引
- `parent -> ordered children paths` 关系
- 节点存在性
- `hasChildren` / `childrenKnown` / `dataStat` 等元信息
- 初始化加载状态
- resync 状态

### 3. `CacheEventStream`

后端内部在 cache 更新后，向前端发更高层事件，而不是裸 `children_changed`：

- `cache_snapshot_ready`
- `nodes_added`
- `nodes_removed`
- `nodes_updated`
- `subtree_resynced`

### 4. Frontend Projection

前端不再依赖“展开节点时顺便发现结构”，而是：

- 按 cache snapshot 初始化可见树
- 按增量事件更新局部分支
- 用 `expandedPaths` 决定渲染哪些层

---

## Rust 侧核心数据结构

建议新增：

```rust
struct CachedNode {
    path: String,
    name: String,
    parent_path: Option<String>,
    stat: Option<NodeStatSummary>,
    children_state: ChildrenState,
    data_state: DataState,
}

struct NodeStatSummary {
    children_count: Option<usize>,
    version: Option<i32>,
    ephemeral: Option<bool>,
    data_length: Option<i32>,
    mtime: Option<i64>,
}

enum ChildrenState {
    Unknown,
    KnownEmpty,
    Known(Vec<String>),
}

enum DataState {
    Unknown,
    KnownMeta,
    KnownValue,
}
```

再按连接维护：

```rust
struct ConnectionCache {
    nodes_by_path: HashMap<String, CachedNode>,
    root_children: Vec<String>,
    status: CacheStatus,
}

enum CacheStatus {
    Bootstrapping,
    Live,
    Resyncing,
    Stale,
}
```

---

## 初始化与同步策略

### 启动阶段

连接建立后，subtree cache 进入 `Bootstrapping`：

1. 先抓取 `/` 的子节点
2. 为根及其已发现子树逐步注册 children watch
3. 逐步向下遍历并填充整树缓存
4. 初始化完成后发 `cache_snapshot_ready`

这里建议：

- **UI 不阻塞在整树完成**
- 首屏仍可先显示已知根层
- 后台继续构建完整缓存

### Live 阶段

watch 回调不再直接驱动“前端强刷某路径”，而是：

1. 更新对应缓存节点
2. 必要时对受影响父/子路径做局部补取
3. 合并成 cache delta
4. 再发前端事件

### Resync 阶段

以下场景进入局部或全量 resync：

- ZooKeeper 会话重连
- 关键 watch 丢失
- 检测到缓存父子关系不一致
- 批量变更后怀疑局部状态漂移

---

## 接口设计草案

### 现有接口保留

- `connect_server`
- `disconnect_server`
- `get_node_details`
- `save_node`
- `create_node`
- `delete_node`

### 建议新增接口

#### 1. 读取 cache 快照

```rust
get_tree_snapshot(connection_id) -> TreeSnapshotDto
```

职责：

- 前端在连接建立后获取当前缓存快照
- 也可用于 reconnect 后强制全量纠偏

#### 2. 读取某路径的可见 children

```rust
get_cached_children(connection_id, path) -> Vec<LoadedTreeNodeDto>
```

职责：

- 前端展开节点时优先读缓存，不触发真实 ZK 查询

#### 3. 订阅 cache delta 事件

事件名建议与现有 watch 事件区分，例如：

- `zk-cache-event`

事件结构建议：

```ts
type CacheEvent =
  | { type: "snapshot_ready"; connectionId: string }
  | { type: "nodes_added"; connectionId: string; parentPath: string; paths: string[] }
  | { type: "nodes_removed"; connectionId: string; parentPath: string; paths: string[] }
  | { type: "nodes_updated"; connectionId: string; paths: string[] }
  | { type: "resync_completed"; connectionId: string; scope: "full" | "subtree"; path: string };
```

### 建议逐步废弃的前端依赖

随着 subtree cache 落地，前端对下面这些行为的依赖应逐步减少：

- `children_changed` 后强刷父路径
- 新节点 `childrenCount` 补探测
- 短观察窗口 re-probe
- “点击节点后才修正 hasChildren”

---

## 前端设计变化

### 当前前端职责

当前前端 `useWorkbenchState` 里承担了：

- 列表刷新
- 元信息修复
- 节点删除后的父路径回刷
- 新增节点的探测
- 搜索索引同步

### 目标前端职责

前端只保留：

- 当前连接的树投影
- 展开路径集合
- 当前选中路径
- 编辑草稿
- 搜索与定位

### 具体变化

#### 1. `treeNodes` 来源调整

从“前端逐步拼出来的树”改为“后端 snapshot + delta 投影”。

#### 2. `ensureChildrenLoaded` 语义变化

不再等价于“调用后端 `list_children` 并注册 watch”，而更接近：

- 确保该路径在前端投影中展开
- 必要时请求后端从 cache 提供该层 children

#### 3. 搜索缓存同步

搜索不应再依赖局部加载节点，而应基于 subtree cache：

- 可以由后端提供扁平路径列表
- 也可以继续在前端消费 snapshot / delta 后维护索引

推荐首版仍在前端维护索引，但其数据源来自 cache delta，而不是 UI 树。

---

## 日志与可观测性要求

subtree cache 不可避免会增加同步复杂度，因此日志必须升级：

### 新增建议日志类型

- `cache_bootstrap_started`
- `cache_bootstrap_completed`
- `cache_delta_added`
- `cache_delta_removed`
- `cache_delta_updated`
- `cache_resync_started`
- `cache_resync_completed`
- `cache_resync_failed`
- `cache_watch_dropped`

### 必须记录的元信息

- connectionId
- path / parentPath
- 变更节点数量
- 是否来自 reconnect
- 是否为降级 resync
- 合并前后的事件数

### 明确降噪规则

以下情况不应被记录为 `ERR`：

- 目标节点删除后的 `NoNode`
- 删除竞态中的 watch 重挂失败
- resync 期间发现节点已消失

---

## 性能成本评估

### 1. 启动成本

比当前模型明显更高。

成本来源：

- 连接建立后要逐步扫描整棵树
- 要为更多路径维护 watch
- 要构建缓存索引

### 2. 内存成本

与节点总数线性相关。

主要消耗：

- 路径字符串
- 节点元信息
- 父子索引
- 前端投影/搜索索引副本

### 3. 事件成本

大量节点变更时，缓存更新和 UI 同步会放大。

### 4. 前端渲染成本

如果直接把完整缓存无约束推给 UI，树大的时候 React 渲染会有压力。

因此必须坚持：

- 后端缓存可完整
- 前端渲染仍按展开态裁剪

---

## 主要风险

### 风险 1：缓存实现复杂度高于当前 watch 体系

这是本次最大风险。

如果后端 cache 设计边界不清，很容易出现：

- 路径存在但父子关系错乱
- cache 与前端状态双重修补
- reconnect 后长期漂移

### 风险 2：大树初始同步变慢

如果某些 ZooKeeper 树非常大，首次连接的后台构建可能持续较长时间。

### 风险 3：watch 风暴重新引入卡顿

尽管 cache 能减少前端补丁逻辑，但它会放大后端事件处理压力。

### 风险 4：调试复杂度上升

一旦出现问题，需要区分：

- ZooKeeper 原始状态
- Rust cache 状态
- 发给前端的 delta
- 前端投影状态

### 风险 5：前后端迁移期双模型并存

如果迁移期过长，旧逻辑和新逻辑混用会产生很高维护成本。

---

## 降级与保护策略

### 1. 大树保护

建议为 subtree cache 增加连接级保护阈值：

- 最大缓存节点数
- 最大 bootstrap 持续时间
- 最大单批 delta 数量

超过阈值时：

- 标记连接为 degraded
- 只维持部分缓存
- 在 UI 上提示“当前连接进入降级同步模式”

### 2. 局部 resync 优先

不要每次异常都全量重扫整树，应优先：

- 受影响父路径 resync
- 受影响子树 resync

### 3. 快照重建开关

建议保留一个内部调试开关，用于强制触发：

- `full resync`
- `drop cache and rebuild`

便于排障。

---

## 分阶段设计

### Phase 0：评估与接口冻结

目标：

- 定义后端 subtree cache 结构
- 定义前端消费的 snapshot / delta 事件形状
- 确定迁移期间哪些旧 watch 逻辑保留

产出：

- 本设计文档
- 后续 implementation plan

验收：

- 团队确认 API 与迁移边界

### Phase 1：Rust 后端引入 connection-scoped cache，但前端暂不切换主逻辑

目标：

- 后端建立 subtree cache
- 连接后后台构建整树缓存
- 增量事件和 resync 机制初步可用
- 先不替换前端主渲染来源

产出：

- `SubtreeCache` 模块
- cache bootstrap / resync / delta 日志
- `get_tree_snapshot` / `get_cached_children`

验收：

- 即使未展开 `/ssdev/services`，外部新增 `/ssdev/services/bbp` 后，后端 cache 能感知
- Rust 单测覆盖新增、删除、重建、reconnect 基本路径

### Phase 2：前端改为 cache 驱动树投影

目标：

- 前端树节点从 snapshot / delta 构建
- `ensureChildrenLoaded` 改为 cache 读取语义
- 清理大部分节点补探测逻辑

产出：

- 新的 `useWorkbenchTreeProjection`
- `zk-cache-event` listener
- tree/search 与 cache 同步机制

验收：

- 删除后重建节点无需手动点击即可恢复可展开状态
- 启动后未展开父路径下的新增节点可自动出现

### Phase 3：性能优化与日志降噪

目标：

- 控制大树初始化开销
- 控制批量变更风暴
- 完善日志语义与降噪规则

产出：

- cache delta 合并
- bootstrap 节流
- 大树降级模式
- 更完整的调试日志

验收：

- 批量删除/重建不出现明显 UI 卡死
- 日志不再出现成串误导性 `NoNode ERR`

### Phase 4：清理旧 watch 补丁逻辑

目标：

- 删除不再需要的前端 workaround
- 明确 subtree cache 成为唯一主同步路径

产出：

- 移除 probe/reprobe 等旧补丁
- 简化 `useWorkbenchState`

验收：

- 树同步主流程清晰
- watch 逻辑不再前后端双重修补

---

## 预估成本

这是一次**中型架构改造**。

按工作内容估算：

- 设计与接口收敛：中
- Rust 后端同步层实现：高
- 前端树投影迁移：中到高
- 性能与日志收口：中
- 回归测试补齐：中

总体判断：

- 复杂度显著高于前面几轮 watch 修补
- 但长期收益也显著更高
- 不建议作为“顺手修一个 bug”插空完成

---

## 本次明确不做

以下内容不建议在 subtree cache 第一版一起塞进去：

- 跨连接全局搜索
- 节点 value 全量缓存
- 全树实时全文搜索
- 日志实时推送
- ACL / stat 完整镜像
- 自动展开外部新建节点
- 虚拟滚动重写

第一版应优先解决：

- 未加载分支也能感知外部新增
- 删除/重建收敛自然
- reconnect 后最终一致

---

## 建议结论

如果目标是“在不切 Java sidecar 的前提下，把 ZooCute 的树同步体验推进到接近 PrettyZoo”，那么 Rust 全量 subtree cache 是合理方向，但它应被视为一个独立项目，而不是当前 watch 修补的自然延伸。

建议按以下顺序继续：

1. 先确认本设计文档
2. 基于本设计写 implementation plan
3. 先做 Rust 后端 cache 原型
4. 再切前端树投影

这样可以把风险拆开，而不是一次性重写当前同步层。
