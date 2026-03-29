# ZooCute ZooKeeper Rust 调试日志设计

**日期：** 2026-03-28
**状态：** 草案

---

## 目标

为 ZooCute 增加一套可落盘、可回看、可在前端日志页面消费的 ZooKeeper Rust 调试日志能力，用于排查连接、读取、写入与删除过程中的问题。

本次设计的目标是：

- 在 Rust 侧真实记录 ZooKeeper 操作结果，而不是仅记录前端点击行为
- 将日志持久化到本地文件，应用重启后仍可查看
- 通过 Tauri command 暴露日志读取与清空能力给前端
- 在前端 `log` 模式中展示结构化日志列表，支持基础筛选
- 默认避免记录节点 value，降低敏感数据落盘风险

---

## 范围

### 本次包含

- Rust 新增独立日志模块
- `LiveAdapter` 中的 ZooKeeper 调用统一埋点
- 日志 JSON Lines 落盘
- Tauri command：读取最近日志、清空日志
- 前端日志页真实渲染
- Rust / 前端测试补齐

### 本次不包含

- 引入完整 `tracing` / `tracing-subscriber` 全局日志体系
- 实时日志流推送或前端订阅
- 日志文件滚动切分与压缩归档
- 节点 value、节点原始字节内容落盘
- 高级检索能力（全文搜索、多字段组合查询）

---

## 现状

当前项目已有 `log` Ribbon 模式入口，但仍是占位 UI。

Rust 侧 ZooKeeper 真实操作集中在 [`src-tauri/src/zk_core/live.rs`](../../../src-tauri/src/zk_core/live.rs)：

- `connect_live`
- `list_children`
- `get_node`
- `save_node`
- `create_node`
- `delete_node`
- `delete_recursive`

Tauri command 层位于 [`src-tauri/src/commands.rs`](../../../src-tauri/src/commands.rs)，目前只暴露业务操作命令，没有日志读取接口。

这意味着如果要实现“Rust 操作 ZooKeeper 的调试日志”，最佳落点不是前端 hook，而是 `LiveAdapter` 附近。

---

## 一、设计原则

### 1. 日志必须贴近真实 ZooKeeper 调用

日志应记录 Rust 侧实际调用 ZooKeeper client 的结果，而不是只记录某个 command 被触发。这样才能在递归删除、鉴权失败、连接握手失败等场景中保留真实排查线索。

### 2. 默认结构化，而不是拼接纯文本

日志采用结构化记录，便于：

- 前端列表稳定展示
- 后续筛选或排序
- Rust 测试校验字段
- 未来迁移到更完整的日志框架

### 3. 调试优先，但要避免明显敏感信息落盘

本次是调试日志，不是用户审计日志，因此要保留路径、操作名、错误文本、耗时等排障信息；但默认不记录节点 value，不记录节点原始 bytes，不记录密码。

### 4. 第一版保持实现简单

优先采用单文件追加写入与“读取最近 N 条”模式，不在第一版引入流式订阅、日志分片、复杂索引。

---

## 二、方案对比与结论

评估过三种路径：

### 方案 A：在 `commands.rs` 手写日志

优点：

- 改动少
- 容易快速上线

缺点：

- 覆盖不到 `delete_recursive` 等内部步骤
- 命令层和实际 ZooKeeper 操作之间存在信息损耗
- 随着命令变多，埋点容易分散和遗漏

### 方案 B：在 `LiveAdapter` 统一记录日志，由 command 层暴露读取接口

优点：

- 最贴近真实 ZK 调用
- 覆盖面完整
- 日志职责清晰
- 与当前代码结构最匹配

缺点：

- 需要新增日志模块和 DTO
- 前后端都要补一条日志读取链路

### 方案 C：一次性引入 `tracing`

优点：

- 长期可扩展性最好

缺点：

- 本仓库当前并未建立 tracing 基础设施
- 第一次落地范围偏大
- 前端日志页仍需额外适配

### 结论

采用方案 B：

- 在 Rust 新增独立日志模块
- `LiveAdapter` 调用日志模块写入结构化事件
- Tauri command 仅负责读取与清空
- 前端 `log` 页面消费读取结果

---

## 三、Rust 模块设计

### 3.1 新增模块

建议新增文件：

- `src-tauri/src/logging.rs`

职责：

- 定义日志记录结构
- 解析日志文件路径
- 追加写入日志
- 读取最近 N 条日志
- 清空日志文件

### 3.2 日志记录结构

建议定义 `ZkLogEntry`：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub meta: Option<serde_json::Value>,
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `timestamp` | ISO 8601 时间字符串 |
| `level` | 第一版固定为 `DEBUG` 或 `ERROR` |
| `connection_id` | 当前连接 ID；连接前失败场景也尽量保留 |
| `operation` | 操作名，如 `connect` / `get_node` / `delete_recursive` |
| `path` | 节点路径；连接场景可为空 |
| `success` | 是否成功 |
| `duration_ms` | 操作耗时 |
| `message` | 面向排障的人类可读摘要 |
| `error` | 错误文本 |
| `meta` | 可选附加信息，例如 `recursive`、`children_count`、`auth_mode` |

### 3.3 文件格式

日志文件采用 `JSON Lines`：

- 每行一个 JSON 对象
- 便于追加写入
- 便于按行解析
- 适合前端读取最近 N 条

示例：

```json
{"timestamp":"2026-03-28T18:20:15.123+08:00","level":"DEBUG","connection_id":"local","operation":"get_node","path":"/configs/app","success":true,"duration_ms":7,"message":"get_node succeeded","error":null,"meta":{"data_length":128}}
```

### 3.4 日志文件路径

日志应写入 Tauri app data 目录下的固定文件，例如：

```text
<app_data_dir>/logs/zookeeper-debug.jsonl
```

要求：

- 若目录不存在，自动创建
- 若文件不存在，首次写入时自动创建
- 清空日志时保留文件本身，只截断内容

### 3.5 AppState 承载方式

当前 `AppState` 已管理 ZooKeeper sessions。为了让 command 和 adapter 都能访问日志能力，建议在 `AppState` 中增加轻量日志服务或日志路径信息，例如：

```rust
pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
    pub log_store: ZkLogStore,
}
```

`ZkLogStore` 应为线程安全、可共享的轻量对象；内部可持有日志文件路径和文件写锁。

---

## 四、ZooKeeper 埋点设计

### 4.1 埋点位置

日志记录放在 `LiveAdapter` 内部，而不是散落在 command 层。这样可以准确覆盖真实的 ZooKeeper client 调用。

### 4.2 覆盖操作

第一版覆盖：

- `connect_live`
- `list_children`
- `get_node`
- `save_node`
- `create_node`
- `delete_node`
- `delete_recursive`

### 4.3 记录策略

每个对外操作记录一条“完成态”日志：

- 成功：记录成功结果、耗时和必要 meta
- 失败：记录失败结果、耗时和错误文本

这样能避免同一次操作产生过多“开始/结束”双份日志，先把日志密度控制住。

### 4.4 递归删除策略

`delete_recursive` 需要保留足够细节来帮助排障，因此：

- 顶层 `delete_node(recursive=true)` 记录一条日志
- 每个递归删除的子节点步骤也分别记录日志

这样当某个子节点删除失败时，前端日志列表能定位到具体路径。

### 4.5 脱敏规则

默认不记录以下内容：

- 节点 `value`
- 原始字节数据
- digest 密码
- 完整认证串

可记录的内容包括：

- 路径
- 操作名
- 是否递归
- 子节点数量
- 节点 stat 派生出的非敏感元数据
- 错误字符串

### 4.6 建议消息格式

统一保持短摘要，例如：

- `connect succeeded`
- `connect failed`
- `list_children succeeded`
- `get_node failed`
- `delete_recursive child delete failed`

message 保持稳定，前端不依赖 message 做逻辑判断。

---

## 五、Tauri Command 设计

### 5.1 新增读取命令

建议新增：

```rust
#[tauri::command]
pub fn read_zk_logs(limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<ZkLogEntryDto>, String>
```

行为：

- `limit` 缺省时给默认值，例如 200
- 返回最近 N 条日志，按时间倒序或文件顺序需保持一致并在前后端统一

建议返回“最新在前”，减少前端额外翻转逻辑。

### 5.2 新增清空命令

建议新增：

```rust
#[tauri::command]
pub fn clear_zk_logs(state: State<'_, AppState>) -> Result<(), String>
```

行为：

- 清空日志文件内容
- 不影响已连接 ZooKeeper session

### 5.3 DTO 设计

为了隔离内部结构与前端消费结构，建议在 `domain.rs` 新增日志 DTO，例如：

- `ZkLogEntryDto`

字段命名与前端 TypeScript 尽量保持一致，减少映射负担。

---

## 六、前端设计

### 6.1 类型与命令封装

前端新增：

- `src/lib/types.ts`：`ZkLogEntry`
- `src/lib/commands.ts`：`readZkLogs(limit)`、`clearZkLogs()`

### 6.2 日志页组件

建议新增独立组件，例如：

- `src/components/log-pane.tsx`

职责：

- 拉取日志列表
- 渲染滚动列表
- 提供刷新与清空入口
- 提供基础筛选

### 6.3 日志页第一版交互

第一版包含：

- 日志列表
- 手动刷新按钮
- 清空日志按钮
- 成功 / 失败筛选
- 按 `connection_id` 文本筛选

第一版不包含：

- 实时推送
- 分页
- 高亮搜索
- 多维组合检索

### 6.4 展示字段

每条日志在前端至少展示：

- 时间
- 操作名
- 连接 ID
- 路径
- 成功 / 失败状态
- 耗时
- message
- error（失败时）

### 6.5 App 集成

当前 `App.tsx` 中 `ribbonMode === "log"` 仍是占位内容：

- 左侧面板占位：`日志（待实现）`
- 右侧内容区占位：`操作日志（待实现）`

建议第一版直接将其中至少一个占位替换成真实日志面板，保持布局与当前应用结构一致。为避免双栏重复，推荐：

- 左侧：日志筛选 / 概览区
- 右侧：日志明细列表

若实现成本希望更小，也可以先在右侧完整渲染日志列表，左侧仅放说明或简单筛选控件。

---

## 七、错误处理

### 7.1 日志写入失败

日志系统不能阻塞主业务操作：

- ZooKeeper 操作成功，但日志写入失败时，不应让业务失败
- 日志写入错误可降级打印到 stderr 或内部忽略

核心原则：日志是调试辅助，不是业务强依赖。

### 7.2 日志读取失败

`read_zk_logs` 失败时：

- Tauri command 返回明确错误字符串
- 前端日志页显示错误占位与重试按钮

### 7.3 损坏行处理

若日志文件中存在单行 JSON 损坏：

- 读取时跳过损坏行
- 不因单行损坏导致整份日志不可读

---

## 八、测试策略

### 8.1 Rust 单元测试

新增测试覆盖：

- 日志条目可正确序列化为 JSON Lines
- 可追加写入多条日志
- 可读取最近 N 条日志
- 清空日志后返回空列表
- 损坏行会被跳过
- 日志中不出现节点 value / 密码

### 8.2 Rust 集成测试

结合现有 `src-tauri/tests/`：

- 调用日志读取 command 返回结构化数据
- 调用清空 command 后文件为空
- 若触发一次失败的 ZooKeeper 操作，日志中含 `success=false`

### 8.3 前端测试

新增测试覆盖：

- `log` 模式可拉取并渲染日志
- 点击刷新会重新拉取
- 点击清空后列表更新为空
- 成功 / 失败筛选生效
- `connection_id` 筛选生效

---

## 九、实施顺序建议

建议按以下顺序实现：

1. Rust 日志模块与 DTO
2. `AppState` 挂载日志服务
3. `LiveAdapter` 埋点
4. Tauri 日志读取 / 清空 command
5. 前端命令封装与类型
6. 前端 `log` 页面替换占位 UI
7. Rust / 前端测试补齐

这样可以保证每一步都可验证，且前后端边界清晰。

---

## 十、最终结论

本次采用“`LiveAdapter` 统一埋点 + JSON Lines 落盘 + Tauri 读取接口 + 前端日志页消费”的方案。

这个方案与当前仓库结构最匹配，能以中等复杂度换取足够完整的 Rust 侧调试日志能力，并为未来接入更完整的 tracing 体系保留演进空间。
