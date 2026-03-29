# 多服务器连接 UX 重设计

## 1. 目标

重新设计应用的启动流程和多服务器管理体验：

- 无连接时只显示连接管理界面，不展示树/浏览相关 UI
- 连接成功后 Ribbon 动态扩展，内容区出现服务器 Tab
- 支持同时连接多台 ZooKeeper 服务器，通过 Tab 切换

## 2. UI 布局 & 交互流程

### 2.1 启动状态（无活跃连接）

```
[🔌 Ribbon] | [连接列表面板] | [连接配置详情]
```

- Ribbon 只显示一个图标：🔌（连接管理）
- 左侧面板：已保存连接列表
- 右侧内容区：选中连接的配置表单（名称、地址、超时、用户名/密码、测试连接、保存、删除）
- 无 Tab 栏，无节点树

### 2.2 连接成功后

```
[🔌🌲📋 Ribbon] | [节点树面板] | [本地开发 ●][生产集群 ●][+]
                |              | ← 当前 Tab 的节点内容 →
```

- Ribbon 动态追加 🌲（浏览）和 📋（日志）图标
- 内容区顶部出现横向 Tab 栏：服务器名 + 状态指示点 + × 关闭按钮
- 自动激活新连接的 Tab，切换到 browse 模式
- 左侧面板：当前 Tab 对应服务器的节点树
- 内容区主体：当前 Tab 选中节点的数据

### 2.3 切换 Ribbon 到"连接管理"模式

- Tab 栏隐藏，左侧切换为连接列表，内容区切换为连接配置表单
- 所有服务器连接保持后台运行，不断开
- 切换回 browse 模式时，Tab 栏恢复，恢复上次活跃的 Tab

### 2.4 关闭 Tab

- 点击 × 按钮：断开对应服务器连接，移除 Tab
- 若无剩余连接：Ribbon 收缩回仅 🔌，Tab 栏消失，回到启动状态

### 2.5 多服务器并行

- 每个 Tab 维护独立状态：节点树展开状态、选中路径、编辑草稿
- 切换 Tab 时，左侧节点树和内容区立即切换，不重新加载已展开的节点

## 3. 状态模型

### 3.1 前端状态

新增 `activeSessions` 替代当前的单连接模型：

```ts
type ActiveSession = {
  connection: SavedConnection;
  treeNodes: TreeNode[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  activePath: string;
  drafts: Record<string, string>;
};

// 全局状态
activeSessions: Map<string, ActiveSession>  // key = connectionId
activeTabId: string | null                  // 当前显示的 Tab
ribbonMode: "connections" | "browse" | "log"
```

**Ribbon 可见性规则：**
- `activeSessions.size === 0`：Ribbon 只渲染 connections 图标
- `activeSessions.size > 0`：Ribbon 渲染 connections + browse + log 图标

**ribbonMode 约束：**
- 若 `activeSessions.size === 0`，强制 `ribbonMode = "connections"`
- 连接第一台服务器后，自动切换到 `ribbonMode = "browse"`

### 3.2 Hook 拆分

现有 `useWorkbenchState` 职责过重，拆分为：

| Hook | 职责 |
|------|------|
| `usePersistedConnections` | 已保存连接的 CRUD + localStorage 持久化（已有） |
| `useSessionManager` | 多服务器会话生命周期：connect、disconnect、activeTabId |
| `useNodeBrowser` | 单个会话内的节点树浏览状态（treeNodes、expandedPaths、activePath、drafts） |
| `useWorkbenchState` | 组合以上三个 hook，供 App.tsx 消费 |

## 4. Rust 后端变更

### 4.1 AppState

当前：
```rust
pub struct AppState {
    pub session: Mutex<Option<LiveAdapter>>,
}
```

改为：
```rust
pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,  // key = connectionId
}
```

### 4.2 Commands 签名变更

所有需要 ZK session 的 commands 增加 `connection_id: String` 参数：

```rust
// 变更前
async fn list_children(path: String, state: State<AppState>) -> Result<...>

// 变更后
async fn list_children(connection_id: String, path: String, state: State<AppState>) -> Result<...>
```

受影响的 commands：`list_children`、`get_node`、`save_node`、`create_node`、`delete_node`

新增 commands：
- `connect_server(connection_id, connection_string, username, password)` — 建立连接，加入 Map
- `disconnect_server(connection_id)` — 从 Map 移除，关闭 ZK session

现有 `connect_zk` command 移除。

### 4.3 LiveAdapter

无需修改 `LiveAdapter` 本身，只是由单例变为多实例。

## 5. 组件变更

| 组件 | 变更 |
|------|------|
| `Ribbon` | 接受 `hasActiveConnections: boolean`，控制是否渲染 browse/log 图标 |
| `App.tsx` | 渲染 Tab 栏（新内联组件 `ServerTabs`），Tab 栏仅在 browse/log 模式下可见 |
| `BrowserPane` | props 不变，由 `useNodeBrowser` 为当前 Tab 提供数据 |
| `ConnectionPane` / `ConnectionDetail` | 无需变更 |

新增组件：
- `ServerTabs`：横向 Tab 栏，渲染 `activeSessions` 中每个服务器的 Tab，支持切换和关闭

## 6. 错误处理

- 连接失败：显示 error toast，session 不加入 Map
- 连接中途断开（ZK session expired）：Tab 状态指示点变红，显示重连提示
- 对已断开服务器执行操作：commands 返回错误，显示 toast

## 7. 测试计划

**Rust 单元测试（`src-tauri/tests/`）**
- `connect_server` 成功：session 加入 Map
- `disconnect_server`：session 从 Map 移除
- 多 connection_id 并存：互不干扰
- 无对应 session 时执行操作：返回错误

**前端单元测试（`src/`）**
- `useSessionManager`：connect 增加 session，disconnect 移除 session，最后一个移除后 ribbonMode 强制变为 connections
- `ServerTabs`：渲染 Tab 列表，点击切换 activeTabId，点击 × 调用 onDisconnect
- `Ribbon`：`hasActiveConnections=false` 时只渲染连接图标
