# ZooCute 只读 ZooKeeper 连接实施计划

> **给代理式执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行本计划。步骤使用复选框语法（`- [ ]`）做状态追踪。

**目标：** 增加一条最小可用的真实 ZooKeeper 接入路径，支持连接串输入、可选 digest 认证、懒加载子节点，以及只读节点数据读取。

**架构：** 保持现有的 Tauri + React 工作台结构不变，在 Rust 侧新增 `zk_core` 适配边界，先支持真实只读后端。前端从“仅依赖静态 mock 数据”切换成“混合模式”：没有活动会话时仍可使用 mock 回退；一旦连接成功，就由真实命令驱动连接、子节点加载和节点读取。

**技术栈：** Tauri 2、React、TypeScript、Rust、`zookeeper` crate、Vitest、Cargo test

---

## 计划中的文件结构

- `src/lib/types.ts`
  扩展前端类型：连接表单、认证模式、连接状态与已加载子节点。
- `src/lib/commands.ts`
  增加 connect、load children、fetch node details 的 Tauri 调用封装。
- `src/lib/mock-data.ts`
  仅在未连真实 ZooKeeper 时保留回退数据。
- `src/hooks/use-workbench-state.ts`
  管理连接表单状态、活动会话、懒加载树节点、加载/错误状态。
- `src/components/topbar.tsx`
  增加连接串、用户名、密码、连接按钮与状态/错误展示。
- `src/components/sidebar.tsx`
  从状态中渲染已加载树数据，而不是只依赖静态树。
- `src/components/tree-node.tsx`
  负责触发懒加载子节点与节点选择。
- `src/App.tsx`
  将真实连接动作与节点加载接入工作台。
- `src/connectivity.test.tsx`
  连接 UI 与真实数据状态更新的前端测试。
- `src-tauri/Cargo.toml`
  增加 ZooKeeper 客户端依赖。
- `src-tauri/src/lib.rs`
  注册新的 Tauri 命令。
- `src-tauri/src/domain.rs`
  定义连接结果、树节点与节点载荷 DTO。
- `src-tauri/src/commands.rs`
  实现 connect、load children、load node details 命令。
- `src-tauri/src/zk_core/mod.rs`
  组织后端模块。
- `src-tauri/src/zk_core/types.rs`
  认证配置、连接结果与已加载节点的核心 Rust 类型。
- `src-tauri/src/zk_core/adapter.rs`
  只读 ZooKeeper 操作的适配器 trait。
- `src-tauri/src/zk_core/live.rs`
  使用 digest 认证的真实 ZooKeeper 适配器实现。
- `src-tauri/src/zk_core/mock.rs`
  面向开发和测试的 mock 适配器回退实现。
- `src-tauri/tests/zk_core_tests.rs`
  认证配置解析与适配器边界行为测试。

## 任务 1：补齐只读后端契约

> **状态：✅ 已完成** — commit `feat: add readonly zookeeper connectivity`

**文件：**
- 新建：`src-tauri/src/domain.rs`
- 新建：`src-tauri/src/commands.rs`
- 新建：`src-tauri/src/zk_core/mod.rs`
- 新建：`src-tauri/src/zk_core/types.rs`
- 新建：`src-tauri/src/zk_core/adapter.rs`
- 新建：`src-tauri/src/zk_core/mock.rs`
- 修改：`src-tauri/src/lib.rs`
- 测试：`src-tauri/tests/zk_core_tests.rs`

- [x] **步骤 1：先写失败的 Rust 测试，覆盖连接 DTO 和适配器形状**

```rust
#[test]
fn reports_digest_auth_mode_when_credentials_exist() {
    let result = build_connection_result(true, true);
    assert_eq!(result.auth_mode, "digest");
    assert!(result.auth_succeeded);
}
```

- [x] **步骤 2：运行 Rust 测试并确认失败**

运行：`cargo test --manifest-path src-tauri/Cargo.toml zk_core_tests`
预期：FAIL，因为这些模块和 DTO 还不存在。

- [x] **步骤 3：实现后端 DTO 与适配器 trait**

包含：
- `ConnectRequest`
- `ConnectionStatusDto`
- `LoadedTreeNodeDto`
- `NodeDetailsDto`
- 适配器方法：`connect`、`list_children`、`get_node`

- [x] **步骤 4：先用 mock adapter 注册占位 Tauri 命令**

命令：
- `connect_zk`
- `list_children`
- `get_node_details`

- [x] **步骤 5：重新运行 Rust 测试**

运行：`cargo test --manifest-path src-tauri/Cargo.toml zk_core_tests`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add src-tauri/src src-tauri/tests/zk_core_tests.rs
git commit -m "feat: add zk read-only backend contracts"
```

## 任务 2：实现真实 ZooKeeper 连接与可选 Digest 认证

> **状态：✅ 已完成** — commit `feat: add readonly zookeeper connectivity`

**文件：**
- 修改：`src-tauri/Cargo.toml`
- 新建：`src-tauri/src/zk_core/live.rs`
- 修改：`src-tauri/src/zk_core/mod.rs`
- 修改：`src-tauri/src/commands.rs`
- 测试：`src-tauri/tests/zk_core_tests.rs`

- [x] **步骤 1：先写失败的 Rust 测试，覆盖认证模式解析**

```rust
#[test]
fn chooses_digest_mode_when_username_and_password_are_present() {
    let config = ConnectRequest::new("127.0.0.1:2181", Some("user"), Some("pass"));
    assert_eq!(config.auth_mode(), AuthMode::Digest);
}
```

- [x] **步骤 2：运行 Rust 测试并确认失败**

运行：`cargo test --manifest-path src-tauri/Cargo.toml zk_core_tests`
预期：FAIL，因为认证模式和 live adapter 逻辑尚未实现。

- [x] **步骤 3：增加 Rust ZooKeeper client 依赖并实现 live adapter**

行为：
- 用提供的连接串建立连接
- 如果提供了用户名和密码，在会话建立后执行 digest 认证
- 将连接/认证失败以结构化错误返回

- [x] **步骤 4：维护一个很小的活动连接内存会话**

保存：
- 连接串
- 认证模式
- 认证是否成功
- live client handle 或 mock fallback

- [x] **步骤 5：重新运行 Rust 测试和 cargo check**

运行：
- `cargo test --manifest-path src-tauri/Cargo.toml zk_core_tests`
- `cargo check --manifest-path src-tauri/Cargo.toml`

预期：PASS

- [x] **步骤 6：提交**

```bash
git add src-tauri/Cargo.toml src-tauri/src
git commit -m "feat: add live zk adapter with digest auth"
```

## 任务 3：增加连接表单与状态 UI

> **状态：✅ 已完成** — commit `feat: add readonly zookeeper connectivity`

**文件：**
- 修改：`src/lib/types.ts`
- 新建：`src/lib/commands.ts`
- 修改：`src/components/topbar.tsx`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/App.tsx`
- 测试：`src/connectivity.test.tsx`

- [x] **步骤 1：先写失败的前端测试，覆盖连接表单行为**

```tsx
it("submits a connection string and shows digest mode when credentials are entered", async () => {
  render(<App />);
  await user.type(screen.getByLabelText("Connection String"), "127.0.0.1:2181");
  await user.type(screen.getByLabelText("Username"), "demo");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(screen.getByText("digest")).toBeInTheDocument();
});
```

- [x] **步骤 2：运行前端测试并确认失败**

运行：`npm test`
预期：FAIL，因为连接表单和命令客户端还未实现。

- [x] **步骤 3：实现命令客户端与顶部表单**

字段：
- connection string
- username
- password
- connect button

状态：
- connected / failed
- auth mode
- auth succeeded
- last error

- [x] **步骤 4：通过状态层把表单接到后端命令**

预期行为：
- 凭证为空时按匿名连接
- 用户名和密码都存在时按 digest 连接
- 连接/认证错误在界面内联展示

- [x] **步骤 5：重新运行前端测试**

运行：`npm test`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add src/lib src/components/topbar.tsx src/hooks/use-workbench-state.ts src/App.tsx src/connectivity.test.tsx
git commit -m "feat: add zk connection form and status"
```

## 任务 4：用后端懒加载替换静态树读取

> **状态：✅ 已完成** — commit `feat: add readonly zookeeper connectivity`

**文件：**
- 修改：`src/lib/types.ts`
- 修改：`src/components/sidebar.tsx`
- 修改：`src/components/tree-node.tsx`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/App.tsx`
- 测试：`src/connectivity.test.tsx`

- [x] **步骤 1：先写失败的前端测试，覆盖懒加载树**

```tsx
it("loads children for the active connection and opens nodes from backend data", async () => {
  render(<App />);
  await connectDemoServer();
  await user.click(screen.getByRole("button", { name: "services" }));
  expect(await screen.findByRole("button", { name: "gateway" })).toBeInTheDocument();
});
```

- [x] **步骤 2：运行测试并确认失败**

运行：`npm test`
预期：FAIL，因为当前树仍依赖静态数据。

- [x] **步骤 3：连接成功后加载 `/`，并在展开/选择时懒加载子节点**

行为：
- 连接成功后先加载根节点 children
- 点击父节点时按需拉取 children，只加载一次
- 点击叶子节点时加载节点详情

- [x] **步骤 4：在没有 live session 时保留 mock fallback**

这能保留当前本地开发体验和已有 UI 流程。

- [x] **步骤 5：重新运行前端测试**

运行：`npm test`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add src/components/sidebar.tsx src/components/tree-node.tsx src/hooks/use-workbench-state.ts src/App.tsx src/connectivity.test.tsx
git commit -m "feat: load zk tree data lazily"
```

## 任务 5：将真实节点数据接入现有查看器

> **状态：✅ 已完成** — commit `feat: add readonly zookeeper connectivity`

**文件：**
- 修改：`src/lib/commands.ts`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/App.tsx`
- 修改：`src/components/context-panel.tsx`
- 修改：`src/lib/data-interpretation.ts`
- 测试：`src/connectivity.test.tsx`

- [x] **步骤 1：先写失败的前端测试，覆盖真实节点读取**

```tsx
it("shows read-only binary state for a backend node with binary content", async () => {
  render(<App />);
  await connectDemoServer();
  await user.click(await screen.findByRole("button", { name: "session_blob" }));
  expect(screen.getByText("二进制 · 只读")).toBeInTheDocument();
});
```

- [x] **步骤 2：运行测试并确认失败**

运行：`npm test`
预期：FAIL，因为节点详情仍然只来自本地 mock 数据。

- [x] **步骤 3：从后端读取真实节点详情，并复用现有解释器**

返回字段：
- path
- raw value
- version
- children count
- updatedAt
- 当后端知道更多信息时，可选返回 format hint

- [x] **步骤 4：在编辑区展示结构化读取错误**

至少包括：
- path not found
- read failed
- unauthenticated / unauthorized

- [x] **步骤 5：重新运行验证**

运行：
- `npm test`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

预期：PASS

- [x] **步骤 6：提交**

```bash
git add src/lib/commands.ts src/hooks/use-workbench-state.ts src/App.tsx src/components/context-panel.tsx src/lib/data-interpretation.ts src/connectivity.test.tsx
git commit -m "feat: read live zk node data"
```

## 执行说明

- 优先尝试 `zookeeper` crate，因为它是最小的同步客户端，适合当前最小只读切片。
- 所有 live ZooKeeper 状态都必须收敛在 Rust 适配层之后；React 层不应该知道底层具体使用哪个 crate。
- digest 凭证在本阶段视为可选，且不要持久化保存。
- 本计划不包括写操作、watcher 支持或 ACL 编辑。
