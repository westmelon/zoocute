# ZooCute 实施计划

> **给代理式执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行本计划。步骤使用复选框语法（`- [ ]`）做状态追踪。

**目标：** 构建一款轻量、跨平台的 ZooKeeper 桌面客户端 MVP，包含 Tauri 壳层、三栏 IDE 风格工作台，以及带有数据类型识别和安全读写策略的节点查看/编辑能力。

**架构：** 使用 `Tauri + React + TypeScript` 构建桌面 UI，使用 `Rust zk-core` 负责后端集成。ZooKeeper 访问统一收敛在 Rust 适配层之后，让前端只依赖稳定命令和类型化 DTO，而不是某个具体客户端实现。MVP 按纵向切片推进：先完成应用脚手架，再完成领域模型和 mock 后端契约，再完成工作台 UI，最后落数据识别与安全编辑流程。

**技术栈：** Tauri 2、Vite、React、TypeScript、Rust、Vitest、React Testing Library、Cargo test

---

## 计划中的文件结构

- `package.json`
  前端脚本与 Tauri 开发/构建命令。
- `vite.config.ts`
  React 前端的 Vite 配置。
- `tsconfig.json`
  前端 TypeScript 编译配置。
- `index.html`
  Vite 应用入口文档。
- `src/main.tsx`
  React 启动入口。
- `src/App.tsx`
  应用壳层组合。
- `src/styles/app.css`
  工作台 UI 的全局样式和布局变量。
- `src/lib/types.ts`
  前端共享类型：连接、树节点、解释结果、标签页和 stat 元数据。
- `src/lib/mock-data.ts`
  在真实 ZooKeeper 接入前用于驱动首个可运行 UI 的 mock 数据。
- `src/lib/data-interpretation.ts`
  前端安全的数据展示和可编辑性判断辅助函数。
- `src/lib/commands.ts`
  调用 Tauri 后端 API 的轻量命令客户端。
- `src/components/topbar.tsx`
  全局连接/状态栏。
- `src/components/sidebar.tsx`
  搜索、收藏路径、最近访问和节点树导航。
- `src/components/tree-node.tsx`
  递归树节点渲染组件。
- `src/components/workbench-tabs.tsx`
  节点标签页与激活切换。
- `src/components/editor-panel.tsx`
  主节点内容区域，包含模式标识、原始模式、Diff 触发和保存入口。
- `src/components/context-panel.tsx`
  stat 元数据与快捷操作。
- `src/components/diff-panel.tsx`
  可编辑内容的轻量前后差异预览。
- `src/hooks/use-workbench-state.ts`
  中央状态管理：连接、树展开、标签页、草稿、只读逻辑等。
- `src-tauri/Cargo.toml`
  Rust 后端包清单。
- `src-tauri/src/main.rs`
  Tauri 应用启动入口。
- `src-tauri/src/lib.rs`
  Tauri 命令注册。
- `src-tauri/src/domain.rs`
  返回给前端的 Rust DTO。
- `src-tauri/src/mock_backend.rs`
  第一条纵向切片使用的内存 mock 后端实现。
- `src-tauri/src/zk_core/mod.rs`
  `zk-core` 模块边界。
- `src-tauri/src/zk_core/types.rs`
  节点数据、元数据和解释结果的核心类型。
- `src-tauri/src/zk_core/interpreter.rs`
  数据分类与解释流水线。
- `src-tauri/src/zk_core/adapter.rs`
  可替换具体客户端实现的 ZooKeeper 适配器 trait。
- `src-tauri/src/commands.rs`
  面向连接、树加载、节点加载、diff/save 请求的 Tauri 命令。
- `src/tests/data-interpretation.test.ts`
  前端单测：模式标识、可编辑性与内容展示辅助逻辑。
- `src/tests/use-workbench-state.test.ts`
  前端状态单测：标签页打开、草稿脏状态与原始模式切换。
- `src-tauri/tests/interpreter_tests.rs`
  Rust 单测：数据分类与安全编辑判断。

## 任务 1：初始化 Tauri + React 工作区

> **状态：✅ 已完成** — commit `feat: bootstrap zoocute workbench shell`

**文件：**
- 新建：`package.json`
- 新建：`vite.config.ts`
- 新建：`tsconfig.json`
- 新建：`index.html`
- 新建：`src/main.tsx`
- 新建：`src/App.tsx`
- 新建：`src/styles/app.css`
- 新建：`src-tauri/Cargo.toml`
- 新建：`src-tauri/build.rs`
- 新建：`src-tauri/tauri.conf.json`
- 新建：`src-tauri/src/main.rs`
- 新建：`src-tauri/src/lib.rs`

- [x] **步骤 1：先写一个失败的启动冒烟测试**

```tsx
import { render, screen } from "@testing-library/react";
import App from "../App";

it("renders the ZooCute shell", () => {
  render(<App />);
  expect(screen.getByText("ZooCute")).toBeInTheDocument();
});
```

- [x] **步骤 2：运行测试，确认它先失败**

运行：`npm test -- --runInBand`
预期：FAIL，因为项目文件和测试环境还不存在。

- [x] **步骤 3：创建最小应用壳层和基础工具链**

```tsx
export default function App() {
  return <div>ZooCute</div>;
}
```

- [x] **步骤 4：补齐 Tauri 脚手架和前端脚本**

运行：
- `npm install`
- `cargo check --manifest-path src-tauri/Cargo.toml`

预期：
- 前端依赖安装成功
- Rust 后端 manifest 可解析

- [x] **步骤 5：再次运行冒烟测试**

运行：`npm test -- --runInBand`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add package.json vite.config.ts tsconfig.json index.html src src-tauri
git commit -m "feat: bootstrap tauri react workspace"
```

## 任务 2：定义领域类型与 Mock 后端契约

> **状态：✅ 已完成** — commit `feat: add interactive workbench state`

**文件：**
- 新建：`src/lib/types.ts`
- 新建：`src/lib/mock-data.ts`
- 新建：`src/lib/commands.ts`
- 新建：`src-tauri/src/domain.rs`
- 新建：`src-tauri/src/mock_backend.rs`
- 新建：`src-tauri/src/commands.rs`
- 修改：`src/App.tsx`
- 修改：`src-tauri/src/lib.rs`

- [x] **步骤 1：先写失败的后端/领域测试**

```rust
#[test]
fn returns_mock_connections_and_root_nodes() {
    let backend = MockBackend::default();
    assert_eq!(backend.list_connections().len(), 2);
    assert!(backend.list_children("production-zk", "/").iter().any(|n| n.name == "configs"));
}
```

- [x] **步骤 2：运行 Rust 测试，确认失败**

运行：`cargo test --manifest-path src-tauri/Cargo.toml mock_backend`
预期：FAIL，因为领域类型和 mock backend 还未实现。

- [x] **步骤 3：实现稳定 DTO 和 mock 数据源**

```rust
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub status: String,
}
```

- [x] **步骤 4：暴露返回 mock 数据的 Tauri 命令**

命令：
- `list_connections`
- `list_children`
- `get_node_details`

- [x] **步骤 5：让前端命令客户端先接到 mock 数据回退链路**

运行：`npm test -- --runInBand`
预期：PASS，且当前渲染仍由类型化 mock 数据驱动。

- [x] **步骤 6：提交**

```bash
git add src/lib src/App.tsx src-tauri/src
git commit -m "feat: add mock backend contracts"
```

## 任务 3：搭建工作台布局

> **状态：✅ 已完成** — commit `feat: add interactive workbench state`

**文件：**
- 新建：`src/components/topbar.tsx`
- 新建：`src/components/sidebar.tsx`
- 新建：`src/components/tree-node.tsx`
- 新建：`src/components/workbench-tabs.tsx`
- 新建：`src/components/context-panel.tsx`
- 修改：`src/App.tsx`
- 修改：`src/styles/app.css`

- [x] **步骤 1：先写失败的布局测试**

```tsx
it("renders topbar, sidebar, editor area, and context panel", () => {
  render(<App />);
  expect(screen.getByText("当前连接")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索路径...")).toBeInTheDocument();
  expect(screen.getByText("节点详情")).toBeInTheDocument();
});
```

- [x] **步骤 2：运行测试并确认失败**

运行：`npm test -- --runInBand --filter layout`
预期：FAIL，因为工作台组件尚未出现。

- [x] **步骤 3：实现三栏工作台与顶部连接栏**

```tsx
<div className="app-shell">
  <Topbar />
  <div className="workspace">
    <Sidebar />
    <main className="editor-column" />
    <ContextPanel />
  </div>
</div>
```

- [x] **步骤 4：补齐响应式布局样式**

规则：
- 窄屏下右侧详情栏可折叠
- 左侧栏保持以导航为主
- 中间编辑区优先获得宽度

- [x] **步骤 5：重新运行前端测试**

运行：`npm test -- --runInBand`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add src/components src/App.tsx src/styles/app.css
git commit -m "feat: add workbench layout"
```

## 任务 4：实现工作台状态与树导航

> **状态：✅ 已完成** — commit `feat: add interactive workbench state`

**文件：**
- 新建：`src/hooks/use-workbench-state.ts`
- 修改：`src/components/sidebar.tsx`
- 修改：`src/components/tree-node.tsx`
- 修改：`src/components/workbench-tabs.tsx`
- 修改：`src/App.tsx`
- 测试：`src/tests/use-workbench-state.test.ts`

- [x] **步骤 1：先写失败的状态测试**

```tsx
it("opens a node in a tab and tracks recent paths", () => {
  const state = createWorkbenchState(mockData);
  state.openNode("/configs/payment/switches");
  expect(state.openTabs).toHaveLength(1);
  expect(state.recentPaths[0]).toBe("/configs/payment/switches");
});
```

- [x] **步骤 2：运行状态测试**

运行：`npm test -- --runInBand src/tests/use-workbench-state.test.ts`
预期：FAIL，因为状态 hook 还不存在。

- [x] **步骤 3：实现中央工作台状态**

职责：
- 当前连接
- 树节点展开状态
- 打开的标签页
- 当前激活标签
- 收藏路径
- 最近访问
- 以路径为键的草稿

- [x] **步骤 4：把侧边栏点击和搜索结果接到标签页打开逻辑**

预期行为：
- 点击节点时打开或复用标签页
- 当前路径在树上高亮
- 收藏路径和最近访问由状态驱动渲染

- [x] **步骤 5：重新运行测试**

运行：`npm test -- --runInBand src/tests/use-workbench-state.test.ts`
预期：PASS

- [x] **步骤 6：提交**

```bash
git add src/hooks src/components/sidebar.tsx src/components/tree-node.tsx src/components/workbench-tabs.tsx src/App.tsx src/tests/use-workbench-state.test.ts
git commit -m "feat: add workbench state and tree navigation"
```

## 任务 5：实现数据解释与只读判断

> **状态：✅ 已完成** — commits `feat(task5): implement Rust data interpretation pipeline` / `fix: address code review issues in interpreter pipeline` / `fix: address code review issues from Task 5 interpreter pipeline` / `fix: remove "unknown" from DataKind union and remap to "binary"`

**文件：**
- 新建：`src/lib/data-interpretation.ts`
- 新建：`src-tauri/src/zk_core/mod.rs`
- 新建：`src-tauri/src/zk_core/types.rs`
- 新建：`src-tauri/src/zk_core/interpreter.rs`
- 测试：`src/tests/data-interpretation.test.ts`
- 测试：`src-tauri/tests/interpreter_tests.rs`
- 修改：`src-tauri/src/lib.rs`
- 修改：`src-tauri/src/domain.rs`

- [x] **步骤 1：先写失败的 Rust 和 TS 解释测试**
- [x] **步骤 2：运行测试并确认失败**
- [x] **步骤 3：实现数据解释规则**

规则已实现：
- 合法 JSON => `DataKind::Json`，可编辑
- UTF-8 文本 => `DataKind::Text`，可编辑
- 可识别变换格式（base64/protobuf-like）=> `DataKind::Cautious`，只读
- 二进制 / 序列化 / 未知 => `DataKind::Binary`，只读

- [x] **步骤 4：把解释后的节点信息暴露给 UI**

返回字段（已在 `NodeDetailsDto` 和 `NodeDetails` TS 类型中实现）：
- `data_kind` / `dataKind`
- `display_mode_label` / `displayModeLabel`
- `editable`
- `raw_preview` / `rawPreview`
- `decoded_preview` / `decodedPreview`

额外完成：
- `DataKind` TS 联合类型更新（移除 `"unknown"`，改用 `"binary"` 回退）
- `mock.rs` session_blob 改用真实二进制字节，正确分类为 Binary
- `hex_encode` 去重（`pub(crate)`，live.rs 复用）

- [x] **步骤 5：重新运行 Rust 与 TS 测试**（18 Rust + 13 前端，全部通过）
- [x] **步骤 6：提交**

## 任务 6：构建编辑区、Diff 与安全保存流程

> **状态：✅ 已完成** — commits `feat(task6): build editor panel, diff preview, and safe save flow` / `fix: address all critical and important code review issues in editor panel` / `fix: clear saveError on node navigation and showDiff on discard`

**文件：**
- 新建：`src/components/editor-panel.tsx`
- 新建：`src/components/diff-panel.tsx`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/App.tsx`
- 修改：`src/styles/app.css`
- 修改：`src/lib/commands.ts`
- 修改：`src-tauri/src/commands.rs`

- [x] **步骤 1：先写失败的编辑流程测试**
- [x] **步骤 2：运行测试并确认失败**
- [x] **步骤 3：实现编辑面板**

实现内容：
- 模式标识（color-coded badge 来自 `displayModeLabel`）
- 草稿脏状态指示（”未保存”）
- `forceRaw` 切换（仅对非可编辑节点显示，切换后 textarea 可编辑）
- `key={node.path}` 保证节点切换时状态重置
- 放弃修改按钮（”放弃修改”）
- 保存错误独立显示（`saveError`，与连接错误分离）

- [x] **步骤 4：实现 Diff 预览和受保护的保存命令**

实现内容：
- `diff-panel.tsx`：基于 LCS 的行级 Diff，+/- 颜色标注
- “查看 Diff” 按钮在无变更时禁用
- 保存保护：editable=true 直接保存；forceRaw 时弹出确认对话框；只读节点保存按钮禁用
- `save_node` Tauri 命令桩（返回 `Ok(())`，写操作留待后续实现）

- [x] **步骤 5：重新运行编辑相关测试**（26 前端 + 18 Rust，全部通过）
- [x] **步骤 6：提交**

## 任务 7：验证端到端原型

> **状态：❌ 未开始** — 依赖任务 6 完成后执行

**文件：**
- 修改：`README.md`
- 修改：`docs/superpowers/specs/2026-03-25-zoocute-design.md`（仅在实现决策发生变化时）

- [ ] **步骤 1：补一份轻量 README**

包含：
- 本地启动方式
- 前端测试命令
- Rust 测试命令
- Tauri 开发命令

- [ ] **步骤 2：运行完整验证套件**

运行：
- `npm test -- --runInBand`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

预期：
- 测试通过
- 应用可以在本地以 mock 工作台启动

- [ ] **步骤 3：人工走查 MVP 行为**

检查清单：
- 切换连接
- 从节点树打开节点
- 数据类型变化时模式标识随之变化
- 编辑 JSON / 文本
- 对只读内容开启原始覆盖
- Diff 正常展示变更

- [ ] **步骤 4：提交**

```bash
git add README.md docs/superpowers/specs/2026-03-25-zoocute-design.md
git commit -m "docs: add local development guide"
```

## 执行说明

- 先从 mock 驱动的纵向切片开始，确保在真实 ZooKeeper 接入前，UI 就已经可用。
- 保持 ZooKeeper 适配层边界干净，不要把某个具体客户端库泄露到前端 DTO。
- 这一阶段不要实现 watcher 编排、ACL 编辑器或插件加载。
- 如果所选 Rust ZooKeeper client 不稳定，就把 `zk_core::adapter` 作为替换点，继续使用 mock backend 推进 UI 开发。
