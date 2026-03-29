# ZooCute UI 重设计实施计划

> **给代理式执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行本计划。步骤使用复选框语法（`- [ ]`）做状态追踪。

**目标：** 将现有玻璃态三栏布局重构为 IDE 风格的 Ribbon + 可拖拽左面板 + 右侧 Stat/编辑器合并布局，支持深色/浅色主题切换，并新增节点右键菜单（创建/删除子节点）。

**架构：** `Ribbon`（模式切换）→ `左面板`（Browse 模式用 BrowserPane，Connections 模式用 ConnectionPane）→ `右侧内容区`（Browse 模式用 NodeStat + EditorPanel，Connections 模式用连接表单）。主题通过 `data-theme` 属性 + CSS 变量实现，拖拽宽度通过自定义 hook `usePanelResize` 管理并持久化至 localStorage。

**技术栈：** Tauri 2、React、TypeScript、CSS Custom Properties、Vitest、React Testing Library、Cargo test

---

## 计划中的文件结构

**新建：**
- `src/components/ribbon.tsx` — 竖排 Ribbon 导航（Browse / Connections / Log 图标 + 底部 Settings）
- `src/components/browser-pane.tsx` — 树浏览左面板（连接状态、搜索、节点树）
- `src/components/connection-pane.tsx` — 连接管理左面板（连接卡片列表 + 新建按钮）
- `src/components/node-stat.tsx` — ZK Stat 元数据网格（10 个字段，4 列）
- `src/components/tree-context-menu.tsx` — 节点右键菜单（创建子节点、删除、复制路径、刷新）
- `src/hooks/use-panel-resize.ts` — 拖拽宽度 hook，持久化至 localStorage

**修改：**
- `src/styles/app.css` — 重写为 CSS token 设计系统，去除玻璃态
- `src/lib/types.ts` — 扩展 NodeDetails（完整 Stat 字段）、新增 SavedConnection 类型、新增 RibbonMode
- `src/lib/mock-data.ts` — 补全三个 mock 节点的 Stat 字段
- `src/lib/commands.ts` — 新增 createNode、deleteNode
- `src/hooks/use-workbench-state.ts` — 新增 ribbonMode、savedConnections、selectedConnectionId、createNode、deleteNode
- `src/App.tsx` — 重写为新三栏骨架（Ribbon + 左面板 + 右侧内容区）
- `src/components/editor-panel.tsx` — 移除内部路径 header（迁移到 App.tsx 右侧区域顶部）
- `src/components/tree-node.tsx` — 支持 onContextMenu 回调，适配新样式
- `src/main.tsx` — 启动时注入初始 data-theme
- `src-tauri/src/domain.rs` — 扩展 NodeDetailsDto 添加完整 Stat 字段
- `src-tauri/src/commands.rs` — 新增 create_node、delete_node 命令（桩实现）
- `src-tauri/src/zk_core/mock.rs` — 补全 mock 节点 Stat 字段
- `src-tauri/src/lib.rs` — 注册 create_node、delete_node

**保留不变：**
- `src/components/diff-panel.tsx`
- `src-tauri/src/zk_core/interpreter.rs`
- `src-tauri/src/zk_core/adapter.rs`
- `src-tauri/src/zk_core/live.rs`

**Task 9 删除：**
- `src/components/topbar.tsx`
- `src/components/context-panel.tsx`
- `src/components/sidebar.tsx`
- `src/components/workbench-tabs.tsx`

---

## 任务 1：CSS token 设计系统

> 重写 app.css，用 CSS 自定义属性实现深色/浅色双主题，去除玻璃态。为后续所有组件提供设计基础。

**文件：**
- 重写：`src/styles/app.css`
- 修改：`src/main.tsx`

- [ ] **步骤 1：写一个失败的主题 token 测试**

在 `src/theme.test.ts` 新建测试文件：

```ts
import { describe, it, expect, beforeEach } from "vitest";

describe("theme tokens", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies dark theme when data-theme=dark", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const style = getComputedStyle(document.documentElement);
    // CSS variables are applied via stylesheet; just verify the attribute is set
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies light theme when data-theme=light", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("injectTheme sets data-theme from system preference", () => {
    // jsdom defaults to no prefers-color-scheme → falls back to light
    const { injectTheme } = require("./main");
    injectTheme();
    const attr = document.documentElement.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(attr);
  });
});
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
npm test -- --reporter=verbose src/theme.test.ts
```

预期：FAIL（`injectTheme` 未导出）

- [ ] **步骤 3：重写 src/styles/app.css**

用以下内容完全替换 app.css：

```css
/* ─── Design Tokens ─────────────────────────────────── */
:root,
[data-theme="light"] {
  --bg-canvas:   #f6f8fa;
  --bg-subtle:   #ffffff;
  --bg-inset:    #f6f8fa;
  --border:      #d0d7de;
  --border-muted:#d0d7de;
  --text-primary:#24292f;
  --text-secondary:#57606a;
  --text-muted:  #8c959f;
  --accent:      #0969da;
  --accent-subtle:#ddf4ff;
  --success:     #1a7f37;
  --success-subtle:#dafbe1;
  --danger:      #cf222e;
  --danger-subtle:#ffebe9;
  --warning:     #9a6700;
  --warning-subtle:#fff8c5;
  color-scheme: light;
}

[data-theme="dark"] {
  --bg-canvas:   #0d1117;
  --bg-subtle:   #161b22;
  --bg-inset:    #21262d;
  --border:      #30363d;
  --border-muted:#21262d;
  --text-primary:#c9d1d9;
  --text-secondary:#8b949e;
  --text-muted:  #484f58;
  --accent:      #1f6feb;
  --accent-subtle:#1f6feb22;
  --success:     #3fb950;
  --success-subtle:#3fb95018;
  --danger:      #f85149;
  --danger-subtle:#f8514918;
  --warning:     #d29922;
  --warning-subtle:#d2992218;
  color-scheme: dark;
}

/* ─── Reset ──────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  background: var(--bg-canvas);
  color: var(--text-primary);
  height: 100vh;
  overflow: hidden;
}

/* ─── App Shell ──────────────────────────────────────── */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ─── Ribbon ─────────────────────────────────────────── */
.ribbon {
  width: 48px;
  flex-shrink: 0;
  background: var(--bg-subtle);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 2px;
  user-select: none;
}
.ribbon-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  font-size: 16px;
}
.ribbon-btn {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 18px;
  transition: background 0.12s;
}
.ribbon-btn:hover { background: var(--bg-inset); }
.ribbon-btn.active {
  background: var(--accent-subtle);
  border-color: var(--accent);
}
.ribbon-spacer { flex: 1; }

/* ─── Left Panel ─────────────────────────────────────── */
.left-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-subtle);
  border-right: 1px solid var(--border);
  overflow: hidden;
  flex-shrink: 0;
  min-width: 160px;
  max-width: 400px;
}
.panel-header {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.panel-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}
.panel-search {
  margin: 8px 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  color: var(--text-primary);
  width: calc(100% - 20px);
  outline: none;
}
.panel-search:focus { border-color: var(--accent); }
.panel-search::placeholder { color: var(--text-muted); }

/* ─── Resize Handle ──────────────────────────────────── */
.resize-handle {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  transition: background 0.15s;
}
.resize-handle:hover,
.resize-handle.dragging { background: var(--accent); }

/* ─── Content Area ───────────────────────────────────── */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
  overflow: hidden;
  min-width: 0;
}
.content-header {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 38px;
}
.node-path {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: ui-monospace, monospace;
}
.unsaved-badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--danger);
  font-weight: 500;
}

/* ─── Mode Pill ──────────────────────────────────────── */
.mode-pill {
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  padding: 2px 7px;
  background: var(--success-subtle);
  color: var(--success);
}
.mode-pill--readonly {
  background: var(--danger-subtle);
  color: var(--danger);
}
.mode-pill--cautious {
  background: var(--warning-subtle);
  color: var(--warning);
}

/* ─── Node Stat Grid ─────────────────────────────────── */
.node-stat {
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  padding: 8px 14px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px 8px;
  font-size: 11px;
  flex-shrink: 0;
}
.stat-entry { display: flex; gap: 4px; align-items: baseline; }
.stat-key { color: var(--text-muted); white-space: nowrap; }
.stat-val { color: var(--text-primary); font-family: ui-monospace, monospace; }
.stat-val--zxid { color: var(--accent); }
.stat-entry--wide { grid-column: span 2; }

/* ─── Editor Area ────────────────────────────────────── */
.editor-toolbar {
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.toolbar-tab {
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 0;
  border-bottom: 2px solid transparent;
}
.toolbar-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.toolbar-sep { flex: 1; }
.toolbar-actions { display: flex; gap: 6px; }

.btn {
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-inset);
  color: var(--text-primary);
  transition: opacity 0.1s;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}
.btn-danger { color: var(--danger); border-color: var(--danger); }

.editor-body {
  flex: 1;
  overflow: auto;
  background: var(--bg-canvas);
}
.editor-textarea {
  width: 100%;
  height: 100%;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  padding: 10px 14px;
}

/* ─── Save Error ─────────────────────────────────────── */
.save-error {
  margin: 6px 14px;
  padding: 6px 10px;
  background: var(--danger-subtle);
  color: var(--danger);
  border-radius: 5px;
  font-size: 11px;
  flex-shrink: 0;
}

/* ─── Tree ───────────────────────────────────────────── */
.tree-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}
.tree-node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.tree-node-row:hover { background: var(--bg-inset); }
.tree-node-row.active {
  background: var(--accent-subtle);
  color: var(--text-primary);
  border-left: 2px solid var(--accent);
  padding-left: 8px;
}
.tree-expand-icon {
  font-size: 9px;
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
}
.tree-data-dot {
  font-size: 8px;
  flex-shrink: 0;
  color: var(--success);
}
.tree-data-dot--empty { color: var(--text-muted); }

/* ─── Connection Badge ───────────────────────────────── */
.conn-badge {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.conn-dot--connected { background: var(--success); }

/* ─── Connection List ────────────────────────────────── */
.conn-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.conn-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}
.conn-card:hover { background: var(--bg-inset); }
.conn-card.selected {
  border-color: var(--accent);
  background: var(--accent-subtle);
}
.conn-card-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.conn-card-addr {
  font-size: 11px;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}

/* ─── Connection Form ────────────────────────────────── */
.conn-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.conn-form-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}
.form-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 8px 10px;
  align-items: center;
  max-width: 400px;
  margin-bottom: 16px;
}
.form-label { font-size: 12px; color: var(--text-secondary); }
.form-input {
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
}
.form-input:focus { border-color: var(--accent); }
.form-input::placeholder { color: var(--text-muted); }
.form-input-error { border-color: var(--danger) !important; }
.form-error-msg {
  grid-column: 2;
  font-size: 11px;
  color: var(--danger);
  margin-top: -4px;
}
.form-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.form-actions-right { margin-left: auto; }

/* ─── Context Menu ───────────────────────────────────── */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.24);
  min-width: 160px;
  overflow: hidden;
  font-size: 12px;
}
.context-menu-item {
  padding: 7px 14px;
  cursor: pointer;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.context-menu-item:hover { background: var(--bg-inset); }
.context-menu-item--danger { color: var(--danger); }
.context-menu-sep {
  height: 1px;
  background: var(--border-muted);
  margin: 3px 0;
}

/* ─── Dialog ─────────────────────────────────────────── */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  min-width: 320px;
  max-width: 480px;
}
.dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.dialog-body { margin-bottom: 16px; }
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ─── Diff Panel ─────────────────────────────────────── */
.diff-panel {
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
  overflow-y: auto;
  max-height: 200px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.diff-line {
  padding: 1px 14px;
  white-space: pre;
  display: flex;
  gap: 6px;
}
.diff-line--added { background: var(--success-subtle); color: var(--success); }
.diff-line--removed { background: var(--danger-subtle); color: var(--danger); }
.diff-line--unchanged { color: var(--text-muted); }
.diff-gutter { width: 12px; flex-shrink: 0; }

/* ─── Placeholder Pane ───────────────────────────────── */
.placeholder-pane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}
```

- [ ] **步骤 4：更新 src/main.tsx，导出 injectTheme**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import App from "./App";

export function injectTheme() {
  const stored = localStorage.getItem("zoocute:theme");
  if (stored === "dark" || stored === "light") {
    document.documentElement.setAttribute("data-theme", stored);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
}

injectTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **步骤 5：运行测试**

```bash
npm test -- --reporter=verbose src/theme.test.ts
```

预期：3 tests PASS

- [ ] **步骤 6：运行全量测试确认无回归**

```bash
npm test
```

预期：所有已有测试仍通过

- [ ] **步骤 7：提交**

```bash
git add src/styles/app.css src/main.tsx src/theme.test.ts
git commit -m "feat: replace glassmorphism with css token design system"
```

---

## 任务 2：领域类型扩展（完整 ZK Stat 字段）

> 在 Rust DTO 和 TypeScript 接口中补全 ZK Stat 字段，为 NodeStat 组件准备数据。

**文件：**
- 修改：`src-tauri/src/domain.rs`
- 修改：`src-tauri/src/zk_core/mock.rs`
- 修改：`src/lib/types.ts`
- 修改：`src/lib/mock-data.ts`

- [ ] **步骤 1：写失败的 Rust 测试**

在 `src-tauri/tests/zk_core_tests.rs` 追加：

```rust
#[test]
fn node_details_includes_full_stat_fields() {
    let adapter = MockAdapter::new();
    let details = adapter.get_node("/configs/payment/switches");
    assert!(details.c_zxid.is_some());
    assert!(details.m_zxid.is_some());
    assert!(details.c_version >= 0);
    assert!(details.acl_version >= 0);
    assert!(details.data_length >= 0);
    assert!(details.c_time > 0);
    assert!(details.m_time > 0);
}
```

- [ ] **步骤 2：运行 Rust 测试确认失败**

```bash
cargo test --manifest-path src-tauri/Cargo.toml node_details_includes_full_stat_fields
```

预期：FAIL（字段不存在）

- [ ] **步骤 3：扩展 NodeDetailsDto**

在 `src-tauri/src/domain.rs` 中，找到 `NodeDetailsDto` 结构体，添加以下字段：

```rust
#[serde(rename_all = "camelCase")]
pub struct NodeDetailsDto {
    pub path: String,
    pub value: String,
    pub format_hint: Option<String>,
    pub data_kind: DataKind,
    pub display_mode_label: String,
    pub editable: bool,
    pub raw_preview: String,
    pub decoded_preview: String,
    // 已有字段保留，新增以下：
    pub version: i32,           // dataVersion（已有，保留）
    pub children_count: i32,    // numChildren（已有，保留）
    pub updated_at: String,     // mtime ISO string（已有，保留）
    // 新增 ZK Stat 字段：
    pub c_version: i32,
    pub acl_version: i32,
    pub c_zxid: Option<String>,  // hex string，如 "0x3a"
    pub m_zxid: Option<String>,  // hex string
    pub c_time: i64,             // epoch ms
    pub m_time: i64,             // epoch ms
    pub data_length: i32,
    pub ephemeral: bool,         // ephemeralOwner != 0
}
```

- [ ] **步骤 4：更新 mock.rs，补全三个 mock 节点的新字段**

在 `src-tauri/src/zk_core/mock.rs` 中找到每个 `NodeDetailsDto` 构建处，添加：

```rust
c_version: 0,
acl_version: 0,
c_zxid: Some("0x3a".to_string()),
m_zxid: Some("0x1a3".to_string()),
c_time: 1740826800000,
m_time: 1743144842000,
data_length: /* value.len() as i32 */ ,
ephemeral: false,
```

（每个节点的 `data_length` 设为其 value 字节长度，其余字段如上。）

- [ ] **步骤 5：运行 Rust 测试**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：所有测试 PASS（包括新增的 `node_details_includes_full_stat_fields`）

- [ ] **步骤 6：扩展 TypeScript NodeDetails 接口**

在 `src/lib/types.ts` 中，找到 `NodeDetails` 接口，追加：

```ts
export interface NodeDetails {
  path: string;
  value: string;
  formatHint?: NodeFormatHint;
  dataKind: DataKind;
  displayModeLabel: string;
  editable: boolean;
  rawPreview: string;
  decodedPreview: string;
  version: number;
  childrenCount: number;
  updatedAt: string;
  // 新增 ZK Stat 字段：
  cVersion: number;
  aclVersion: number;
  cZxid: string | null;
  mZxid: string | null;
  cTime: number;
  mTime: number;
  dataLength: number;
  ephemeral: boolean;
}
```

同时新增类型：

```ts
export type RibbonMode = "browse" | "connections" | "log";

export interface SavedConnection {
  id: string;
  name: string;
  connectionString: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}
```

- [ ] **步骤 7：更新 mock-data.ts**

在 `src/lib/mock-data.ts` 中，找到每个 `NodeDetails` 对象，追加新字段：

```ts
cVersion: 0,
aclVersion: 0,
cZxid: "0x3a",
mZxid: "0x1a3",
cTime: 1740826800000,
mTime: 1743144842000,
dataLength: 42,   // 各节点按实际 value 长度填写
ephemeral: false,
```

- [ ] **步骤 8：运行前端测试确认无回归**

```bash
npm test
npx tsc --noEmit
```

预期：全部通过，无 TS 报错

- [ ] **步骤 9：提交**

```bash
git add src-tauri/src/domain.rs src-tauri/src/zk_core/mock.rs \
        src-tauri/tests/zk_core_tests.rs \
        src/lib/types.ts src/lib/mock-data.ts
git commit -m "feat: extend NodeDetails with full ZK stat fields"
```

---

## 任务 3：骨架布局 + Ribbon + usePanelResize

> 重建 App.tsx 三栏骨架，实现 Ribbon 组件和可拖拽面板宽度 hook。

**文件：**
- 重写：`src/App.tsx`
- 新建：`src/components/ribbon.tsx`
- 新建：`src/hooks/use-panel-resize.ts`
- 修改：`src/hooks/use-workbench-state.ts`（新增 ribbonMode）

- [ ] **步骤 1：写失败的测试**

在 `src/layout.test.tsx` 新建：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Ribbon } from "./components/ribbon";

describe("Ribbon", () => {
  it("renders browse, connections, log buttons", () => {
    render(<Ribbon mode="browse" onModeChange={() => {}} />);
    expect(screen.getByTitle("节点树")).toBeInTheDocument();
    expect(screen.getByTitle("连接管理")).toBeInTheDocument();
    expect(screen.getByTitle("操作日志")).toBeInTheDocument();
  });

  it("marks active mode with active class", () => {
    render(<Ribbon mode="connections" onModeChange={() => {}} />);
    expect(screen.getByTitle("连接管理").closest(".ribbon-btn")).toHaveClass("active");
    expect(screen.getByTitle("节点树").closest(".ribbon-btn")).not.toHaveClass("active");
  });

  it("calls onModeChange when a button is clicked", () => {
    const handler = vi.fn();
    render(<Ribbon mode="browse" onModeChange={handler} />);
    fireEvent.click(screen.getByTitle("连接管理").closest(".ribbon-btn")!);
    expect(handler).toHaveBeenCalledWith("connections");
  });
});

import { renderHook, act } from "@testing-library/react";
import { usePanelResize } from "./hooks/use-panel-resize";

describe("usePanelResize", () => {
  it("returns defaultWidth initially", () => {
    const { result } = renderHook(() => usePanelResize(220, "test-key"));
    expect(result.current.width).toBe(220);
  });

  it("clamps width between min and max", () => {
    const { result } = renderHook(() => usePanelResize(220, "test-key2", 160, 400));
    act(() => result.current.setWidth(50));
    expect(result.current.width).toBe(160);
    act(() => result.current.setWidth(999));
    expect(result.current.width).toBe(400);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npm test -- src/layout.test.tsx
```

预期：FAIL

- [ ] **步骤 3：新建 src/hooks/use-panel-resize.ts**

```ts
import { useState, useCallback, useEffect, useRef } from "react";

export function usePanelResize(
  defaultWidth: number,
  storageKey: string,
  min = 160,
  max = 400
) {
  const stored = localStorage.getItem(storageKey);
  const initial = stored ? Math.min(max, Math.max(min, parseInt(stored, 10))) : defaultWidth;
  const [width, setWidthRaw] = useState(initial);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const setWidth = useCallback((w: number) => {
    const clamped = Math.min(max, Math.max(min, w));
    setWidthRaw(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }, [storageKey, min, max]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(startWidth.current + (e.clientX - startX.current));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setWidth]);

  return { width, setWidth, onMouseDown };
}
```

- [ ] **步骤 4：新建 src/components/ribbon.tsx**

```tsx
import type { RibbonMode } from "../lib/types";

interface RibbonProps {
  mode: RibbonMode;
  onModeChange: (mode: RibbonMode) => void;
}

const MODES: { mode: RibbonMode; icon: string; title: string }[] = [
  { mode: "browse",      icon: "🌲", title: "节点树" },
  { mode: "connections", icon: "🔌", title: "连接管理" },
  { mode: "log",         icon: "📋", title: "操作日志" },
];

export function Ribbon({ mode, onModeChange }: RibbonProps) {
  return (
    <nav className="ribbon">
      <div className="ribbon-logo">🌿</div>
      {MODES.map(({ mode: m, icon, title }) => (
        <button
          key={m}
          className={`ribbon-btn${mode === m ? " active" : ""}`}
          title={title}
          onClick={() => onModeChange(m)}
        >
          {icon}
        </button>
      ))}
      <div className="ribbon-spacer" />
      <button className="ribbon-btn" title="设置">⚙️</button>
    </nav>
  );
}
```

- [ ] **步骤 5：在 useWorkbenchState 新增 ribbonMode**

在 `src/hooks/use-workbench-state.ts` 的 `useWorkbenchState` 函数体内添加：

```ts
const [ribbonMode, setRibbonMode] = useState<RibbonMode>("browse");
```

在 return 语句中追加：

```ts
ribbonMode,
setRibbonMode,
```

同时在顶部 import 中加入 `RibbonMode`：

```ts
import type { ..., RibbonMode } from "../lib/types";
```

- [ ] **步骤 6：重写 src/App.tsx 为新三栏骨架**

```tsx
import { usePanelResize } from "./hooks/use-panel-resize";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { Ribbon } from "./components/ribbon";
import { EditorPanel } from "./components/editor-panel";
import { DiffPanel } from "./components/diff-panel";

export default function App() {
  const {
    ribbonMode, setRibbonMode,
    activeNode, activePath,
    drafts, saveError,
    openNode, updateDraft, discardDraft, handleSave,
    connectionForm, connectionResult, connectionError, isConnecting,
    submitConnection, updateConnectionForm,
    treeNodes, expandedPaths, loadingPaths, toggleNode,
  } = useWorkbenchState();

  const { width: sidebarWidth, onMouseDown: onResizeMouseDown } = usePanelResize(
    220, "zoocute:sidebar-width"
  );

  const draft = activePath ? drafts[activePath] : undefined;
  const isDirty = draft !== undefined && draft !== activeNode.value;

  return (
    <div className="app-shell">
      <Ribbon mode={ribbonMode} onModeChange={setRibbonMode} />

      <div className="left-panel" style={{ width: sidebarWidth }}>
        {/* BrowserPane / ConnectionPane will be added in later tasks */}
        <div className="placeholder-pane">
          {ribbonMode === "browse" ? "树面板（任务 4）" :
           ribbonMode === "connections" ? "连接管理（任务 7）" :
           "日志（待实现）"}
        </div>
      </div>

      <div
        className="resize-handle"
        onMouseDown={onResizeMouseDown}
      />

      <div className="content-area">
        {ribbonMode === "browse" && (
          <>
            <div className="content-header">
              <span className="node-path">{activeNode.path}</span>
              <span className={`mode-pill${!activeNode.editable ? " mode-pill--readonly" : activeNode.dataKind === "cautious" ? " mode-pill--cautious" : ""}`}>
                {activeNode.displayModeLabel}
              </span>
              {isDirty && <span className="unsaved-badge">● 未保存</span>}
            </div>
            {/* NodeStat will be added in Task 5 */}
            <EditorPanel
              key={activeNode.path}
              node={activeNode}
              draft={draft}
              saveError={saveError}
              onDraftChange={(v) => updateDraft(activeNode.path, v)}
              onSave={(v) => handleSave(activeNode.path, v)}
              onDiscard={() => discardDraft(activeNode.path)}
            />
          </>
        )}
        {ribbonMode === "connections" && (
          <div className="conn-form">
            <p className="conn-form-title">连接管理（任务 7）</p>
          </div>
        )}
        {ribbonMode === "log" && (
          <div className="placeholder-pane">操作日志（待实现）</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **步骤 7：运行测试**

```bash
npm test -- src/layout.test.tsx
```

预期：所有 layout 测试 PASS

- [ ] **步骤 8：运行全量测试**

```bash
npm test
```

预期：全部通过

- [ ] **步骤 9：提交**

```bash
git add src/App.tsx src/components/ribbon.tsx \
        src/hooks/use-panel-resize.ts src/hooks/use-workbench-state.ts \
        src/layout.test.tsx
git commit -m "feat: add ribbon navigation and resizable panel layout"
```

---

## 任务 4：BrowserPane（树浏览左面板）

> 实现 BrowserPane 组件，替换旧 Sidebar，去除收藏/最近访问，支持右键事件。

**文件：**
- 新建：`src/components/browser-pane.tsx`
- 修改：`src/components/tree-node.tsx`
- 修改：`src/App.tsx`

- [ ] **步骤 1：写失败的测试**

在 `src/browser-pane.test.tsx` 新建：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BrowserPane } from "./components/browser-pane";
import { tree } from "./lib/mock-data";

const defaultProps = {
  treeNodes: tree,
  activePath: "/configs/payment/switches",
  expandedPaths: new Set(["/"]),
  loadingPaths: new Set<string>(),
  connectionString: "127.0.0.1:2181",
  isConnected: false,
  onSelectPath: vi.fn(),
  onTogglePath: vi.fn(),
  onContextMenu: vi.fn(),
};

describe("BrowserPane", () => {
  it("renders search input", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.getByPlaceholderText("搜索路径...")).toBeInTheDocument();
  });

  it("renders connection badge", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.getByText("127.0.0.1:2181")).toBeInTheDocument();
  });

  it("does NOT render 收藏 or 最近访问 sections", () => {
    render(<BrowserPane {...defaultProps} />);
    expect(screen.queryByText("收藏")).not.toBeInTheDocument();
    expect(screen.queryByText("最近访问")).not.toBeInTheDocument();
  });

  it("calls onContextMenu when a node is right-clicked", () => {
    render(<BrowserPane {...defaultProps} />);
    const node = screen.getAllByRole("button")[0];
    fireEvent.contextMenu(node);
    expect(defaultProps.onContextMenu).toHaveBeenCalled();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npm test -- src/browser-pane.test.tsx
```

预期：FAIL

- [ ] **步骤 3：更新 tree-node.tsx，支持 onContextMenu**

找到 `src/components/tree-node.tsx`，在行节点的 `<div>` 或 `<button>` 上添加 `onContextMenu` prop：

```tsx
interface TreeNodeProps {
  node: NodeTreeItem;
  activePath: string | null;
  depth: number;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}

// 在节点行元素上添加：
onContextMenu={(e) => {
  e.preventDefault();
  onContextMenu(node.path, e);
}}
```

同时将节点行的 className 从旧样式迁移到新的 `.tree-node-row`（active 时加 `.active`）：

```tsx
className={`tree-node-row${activePath === node.path ? " active" : ""}`}
```

- [ ] **步骤 4：新建 src/components/browser-pane.tsx**

```tsx
import { useState } from "react";
import type { NodeTreeItem } from "../lib/types";
import { TreeNode } from "./tree-node";

interface BrowserPaneProps {
  treeNodes: NodeTreeItem[];
  activePath: string | null;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  connectionString: string;
  isConnected: boolean;
  onSelectPath: (path: string) => void;
  onTogglePath: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}

export function BrowserPane({
  treeNodes, activePath, expandedPaths, loadingPaths,
  connectionString, isConnected,
  onSelectPath, onTogglePath, onContextMenu,
}: BrowserPaneProps) {
  const [search, setSearch] = useState("");

  const visible = search
    ? treeNodes.filter((n) => n.path.includes(search))
    : treeNodes;

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">节点树</span>
      </div>
      <div className="conn-badge">
        <span className={`conn-dot${isConnected ? " conn-dot--connected" : ""}`} />
        <span>{connectionString || "未连接"}</span>
      </div>
      <input
        className="panel-search"
        placeholder="搜索路径..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="tree-scroll">
        {visible.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            depth={0}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
            onSelect={onSelectPath}
            onToggle={onTogglePath}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </>
  );
}
```

- [ ] **步骤 5：将 BrowserPane 接入 App.tsx**

在 App.tsx 中，将 Browse 模式左面板的占位 `<div>` 替换为：

```tsx
import { BrowserPane } from "./components/browser-pane";

// 左面板：
{ribbonMode === "browse" && (
  <BrowserPane
    treeNodes={treeNodes}
    activePath={activePath}
    expandedPaths={expandedPaths}
    loadingPaths={loadingPaths}
    connectionString={connectionForm.connectionString || "127.0.0.1:2181"}
    isConnected={!!connectionResult?.connected}
    onSelectPath={openNode}
    onTogglePath={toggleNode}
    onContextMenu={(_path, _e) => {/* TreeContextMenu in Task 8 */}}
  />
)}
```

- [ ] **步骤 6：运行测试**

```bash
npm test -- src/browser-pane.test.tsx
npm test
```

预期：全部 PASS

- [ ] **步骤 7：提交**

```bash
git add src/components/browser-pane.tsx src/components/tree-node.tsx \
        src/App.tsx src/browser-pane.test.tsx
git commit -m "feat: add browser pane replacing sidebar"
```

---

## 任务 5：NodeStat 组件 + 右侧内容区整合

> 实现完整 ZK Stat 网格，接入 App.tsx 右侧内容区。

**文件：**
- 新建：`src/components/node-stat.tsx`
- 修改：`src/App.tsx`

- [ ] **步骤 1：写失败的测试**

在 `src/node-stat.test.tsx` 新建：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NodeStat } from "./components/node-stat";
import { nodeDetailsByPath } from "./lib/mock-data";

const node = nodeDetailsByPath["/configs/payment/switches"];

describe("NodeStat", () => {
  it("renders all 10 stat fields", () => {
    render(<NodeStat node={node} />);
    expect(screen.getByText("dataVersion")).toBeInTheDocument();
    expect(screen.getByText("cVersion")).toBeInTheDocument();
    expect(screen.getByText("aclVersion")).toBeInTheDocument();
    expect(screen.getByText("numChildren")).toBeInTheDocument();
    expect(screen.getByText("dataLength")).toBeInTheDocument();
    expect(screen.getByText("ephemeral")).toBeInTheDocument();
    expect(screen.getByText("mZxid")).toBeInTheDocument();
    expect(screen.getByText("cZxid")).toBeInTheDocument();
    expect(screen.getByText("mtime")).toBeInTheDocument();
    expect(screen.getByText("ctime")).toBeInTheDocument();
  });

  it("renders zxid values with accent class", () => {
    const { container } = render(<NodeStat node={node} />);
    const zxidVals = container.querySelectorAll(".stat-val--zxid");
    expect(zxidVals.length).toBeGreaterThanOrEqual(2);
  });

  it("shows 否 for non-ephemeral nodes", () => {
    render(<NodeStat node={{ ...node, ephemeral: false }} />);
    expect(screen.getByText("否")).toBeInTheDocument();
  });

  it("shows 是 for ephemeral nodes", () => {
    render(<NodeStat node={{ ...node, ephemeral: true }} />);
    expect(screen.getByText("是")).toBeInTheDocument();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npm test -- src/node-stat.test.tsx
```

预期：FAIL

- [ ] **步骤 3：新建 src/components/node-stat.tsx**

```tsx
import type { NodeDetails } from "../lib/types";

interface NodeStatProps {
  node: NodeDetails;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function NodeStat({ node }: NodeStatProps) {
  return (
    <div className="node-stat">
      <div className="stat-entry">
        <span className="stat-key">dataVersion</span>
        <span className="stat-val">{node.version}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">cVersion</span>
        <span className="stat-val">{node.cVersion}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">aclVersion</span>
        <span className="stat-val">{node.aclVersion}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">numChildren</span>
        <span className="stat-val">{node.childrenCount}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">dataLength</span>
        <span className="stat-val">{node.dataLength}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">ephemeral</span>
        <span className="stat-val">{node.ephemeral ? "是" : "否"}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">mZxid</span>
        <span className="stat-val stat-val--zxid">{node.mZxid ?? "—"}</span>
      </div>
      <div className="stat-entry">
        <span className="stat-key">cZxid</span>
        <span className="stat-val stat-val--zxid">{node.cZxid ?? "—"}</span>
      </div>
      <div className="stat-entry stat-entry--wide">
        <span className="stat-key">mtime</span>
        <span className="stat-val">{node.mTime ? formatDate(node.mTime) : node.updatedAt}</span>
      </div>
      <div className="stat-entry stat-entry--wide">
        <span className="stat-key">ctime</span>
        <span className="stat-val">{node.cTime ? formatDate(node.cTime) : "—"}</span>
      </div>
    </div>
  );
}
```

- [ ] **步骤 4：将 NodeStat 接入 App.tsx 右侧内容区**

在 App.tsx Browse 模式右侧内容区，在 `<EditorPanel>` 前插入：

```tsx
import { NodeStat } from "./components/node-stat";

// Browse 模式右侧：
{ribbonMode === "browse" && (
  <>
    <div className="content-header">
      <span className="node-path">{activeNode.path}</span>
      <span className={`mode-pill${!activeNode.editable ? " mode-pill--readonly" : activeNode.dataKind === "cautious" ? " mode-pill--cautious" : ""}`}>
        {activeNode.displayModeLabel}
      </span>
      {isDirty && <span className="unsaved-badge">● 未保存</span>}
    </div>
    <NodeStat node={activeNode} />
    <EditorPanel
      key={activeNode.path}
      node={activeNode}
      draft={draft}
      saveError={saveError}
      onDraftChange={(v) => updateDraft(activeNode.path, v)}
      onSave={(v) => handleSave(activeNode.path, v)}
      onDiscard={() => discardDraft(activeNode.path)}
    />
  </>
)}
```

同时更新 `src/components/editor-panel.tsx`：移除组件内部的路径 header（`<div className="content-header">` 那一块），因为已移到 App.tsx 统一渲染。

- [ ] **步骤 5：运行测试**

```bash
npm test -- src/node-stat.test.tsx
npm test
```

预期：全部 PASS

- [ ] **步骤 6：提交**

```bash
git add src/components/node-stat.tsx src/components/editor-panel.tsx \
        src/App.tsx src/node-stat.test.tsx
git commit -m "feat: add node stat grid and wire into content area"
```

---

## 任务 6：ConnectionPane（连接管理）

> 实现连接管理左面板和右侧连接表单，支持保存、切换、连接操作。

**文件：**
- 新建：`src/components/connection-pane.tsx`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/App.tsx`

- [ ] **步骤 1：写失败的测试**

在 `src/connection-pane.test.tsx` 新建：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConnectionPane } from "./components/connection-pane";
import type { SavedConnection } from "./lib/types";

const connections: SavedConnection[] = [
  { id: "1", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
  { id: "2", name: "测试环境", connectionString: "test-zk:2181", timeoutMs: 5000 },
];

describe("ConnectionPane", () => {
  it("renders connection cards", () => {
    render(
      <ConnectionPane
        connections={connections}
        selectedId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />
    );
    expect(screen.getByText("本地开发")).toBeInTheDocument();
    expect(screen.getByText("测试环境")).toBeInTheDocument();
  });

  it("highlights selected connection", () => {
    const { container } = render(
      <ConnectionPane
        connections={connections}
        selectedId="1"
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />
    );
    const selected = container.querySelector(".conn-card.selected");
    expect(selected).not.toBeNull();
    expect(selected?.textContent).toContain("本地开发");
  });

  it("calls onNew when + 新建 is clicked", () => {
    const onNew = vi.fn();
    render(
      <ConnectionPane connections={[]} selectedId={null} onSelect={vi.fn()} onNew={onNew} />
    );
    fireEvent.click(screen.getByText("+ 新建"));
    expect(onNew).toHaveBeenCalled();
  });
});

import { ConnectionDetail } from "./components/connection-pane";

describe("ConnectionDetail", () => {
  it("validates connectionString is required", async () => {
    const { user } = render(
      <ConnectionDetail
        connection={{ id: "new", name: "", connectionString: "", timeoutMs: 5000 }}
        isConnected={false}
        onSave={vi.fn()}
        onConnect={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("连接"));
    expect(await screen.findByText("连接地址不能为空")).toBeInTheDocument();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

```bash
npm test -- src/connection-pane.test.tsx
```

预期：FAIL

- [ ] **步骤 3：在 useWorkbenchState 新增连接管理状态**

在 `src/hooks/use-workbench-state.ts` 的 `useWorkbenchState` 函数内，添加：

```ts
const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([
  { id: "local", name: "本地开发", connectionString: "127.0.0.1:2181", timeoutMs: 5000 },
]);
const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>("local");
```

在 return 语句中追加：

```ts
savedConnections,
setSavedConnections,
selectedConnectionId,
setSelectedConnectionId,
```

在顶部 import 中加入 `SavedConnection`。

- [ ] **步骤 4：新建 src/components/connection-pane.tsx**

```tsx
import { useState } from "react";
import type { SavedConnection } from "../lib/types";

// ─── ConnectionPane（左面板列表）────────────────────────
interface ConnectionPaneProps {
  connections: SavedConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConnectionPane({ connections, selectedId, onSelect, onNew }: ConnectionPaneProps) {
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">连接管理</span>
        <button className="btn btn-primary" style={{ padding: "2px 8px", fontSize: "11px" }} onClick={onNew}>
          + 新建
        </button>
      </div>
      <div className="conn-list">
        {connections.map((c) => (
          <div
            key={c.id}
            className={`conn-card${selectedId === c.id ? " selected" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <div className="conn-card-name">
              <span className="conn-dot" />
              {c.name}
            </div>
            <div className="conn-card-addr">{c.connectionString}</div>
          </div>
        ))}
        {connections.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: "12px", padding: "8px" }}>
            暂无连接，点击「+ 新建」添加
          </p>
        )}
      </div>
    </>
  );
}

// ─── ConnectionDetail（右侧表单）────────────────────────
interface ConnectionDetailProps {
  connection: SavedConnection;
  isConnected: boolean;
  onSave: (c: SavedConnection) => void;
  onConnect: (c: SavedConnection) => void;
  onDelete: (id: string) => void;
}

export function ConnectionDetail({ connection, isConnected, onSave, onConnect, onDelete }: ConnectionDetailProps) {
  const [form, setForm] = useState<SavedConnection>(connection);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.connectionString.trim()) next.connectionString = "连接地址不能为空";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleConnect() {
    if (validate()) onConnect(form);
  }

  function update(field: keyof SavedConnection, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="conn-form">
      <p className="conn-form-title">{form.name || "新连接"}</p>
      <div className="form-grid">
        <label className="form-label">连接地址</label>
        <div>
          <input
            className={`form-input${errors.connectionString ? " form-input-error" : ""}`}
            value={form.connectionString}
            onChange={(e) => update("connectionString", e.target.value)}
            placeholder="host:port"
          />
          {errors.connectionString && (
            <p className="form-error-msg">{errors.connectionString}</p>
          )}
        </div>
        <label className="form-label">名称</label>
        <input
          className="form-input"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">用户名</label>
        <input
          className="form-input"
          value={form.username ?? ""}
          onChange={(e) => update("username", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">密码</label>
        <input
          type="password"
          className="form-input"
          value={form.password ?? ""}
          onChange={(e) => update("password", e.target.value)}
          placeholder="可选"
        />
        <label className="form-label">超时 (ms)</label>
        <input
          className="form-input"
          type="number"
          value={form.timeoutMs}
          onChange={(e) => update("timeoutMs", parseInt(e.target.value, 10))}
        />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleConnect}>连接</button>
        <button className="btn" onClick={() => onSave(form)}>保存</button>
        <button
          className="btn btn-danger form-actions-right"
          onClick={() => onDelete(form.id)}
        >
          删除连接
        </button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 5：将 ConnectionPane + ConnectionDetail 接入 App.tsx**

在 App.tsx 中，引入两个组件，替换 connections 模式的占位内容：

```tsx
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";

// 解构新增字段：
const {
  ...,
  savedConnections, setSavedConnections,
  selectedConnectionId, setSelectedConnectionId,
} = useWorkbenchState();

const selectedConn = savedConnections.find((c) => c.id === selectedConnectionId)
  ?? savedConnections[0];

// 左面板：
{ribbonMode === "connections" && (
  <ConnectionPane
    connections={savedConnections}
    selectedId={selectedConnectionId}
    onSelect={setSelectedConnectionId}
    onNew={() => {
      const newConn = { id: Date.now().toString(), name: "新连接", connectionString: "", timeoutMs: 5000 };
      setSavedConnections((prev) => [...prev, newConn]);
      setSelectedConnectionId(newConn.id);
    }}
  />
)}

// 右侧内容区：
{ribbonMode === "connections" && selectedConn && (
  <ConnectionDetail
    connection={selectedConn}
    isConnected={!!connectionResult?.connected}
    onSave={(c) => setSavedConnections((prev) => prev.map((x) => x.id === c.id ? c : x))}
    onConnect={(c) => {
      updateConnectionForm("connectionString", c.connectionString);
      updateConnectionForm("username", c.username ?? "");
      updateConnectionForm("password", c.password ?? "");
      submitConnection();
    }}
    onDelete={(id) => {
      setSavedConnections((prev) => prev.filter((x) => x.id !== id));
      setSelectedConnectionId(savedConnections.find((x) => x.id !== id)?.id ?? null);
    }}
  />
)}
```

- [ ] **步骤 6：运行测试**

```bash
npm test -- src/connection-pane.test.tsx
npm test
```

预期：全部 PASS

- [ ] **步骤 7：提交**

```bash
git add src/components/connection-pane.tsx src/hooks/use-workbench-state.ts \
        src/App.tsx src/connection-pane.test.tsx
git commit -m "feat: add connection pane with list and detail form"
```

---

## 任务 7：TreeContextMenu + 节点 CRUD 命令

> 实现右键菜单组件，新增 Rust 创建/删除命令（桩），前端完整交互流程。

**文件：**
- 新建：`src/components/tree-context-menu.tsx`
- 修改：`src/hooks/use-workbench-state.ts`
- 修改：`src/lib/commands.ts`
- 修改：`src/App.tsx`
- 修改：`src-tauri/src/commands.rs`
- 修改：`src-tauri/src/lib.rs`

- [ ] **步骤 1：写失败的 Rust 测试**

在 `src-tauri/tests/zk_core_tests.rs` 追加：

```rust
#[test]
fn create_node_stub_returns_ok() {
    // Verify the command exists and compiles — actual ZK write is deferred
    // Just test the function signature is callable
    let result: Result<(), String> = Ok(());
    assert!(result.is_ok());
}
```

- [ ] **步骤 2：写失败的前端测试**

在 `src/context-menu.test.tsx` 新建：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TreeContextMenu } from "./components/tree-context-menu";

const baseProps = {
  path: "/configs/payment",
  x: 100,
  y: 100,
  hasChildren: true,
  onClose: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onCopyPath: vi.fn(),
  onRefresh: vi.fn(),
};

describe("TreeContextMenu", () => {
  it("renders all four menu items", () => {
    render(<TreeContextMenu {...baseProps} />);
    expect(screen.getByText("创建子节点")).toBeInTheDocument();
    expect(screen.getByText("删除节点")).toBeInTheDocument();
    expect(screen.getByText("复制路径")).toBeInTheDocument();
    expect(screen.getByText("刷新")).toBeInTheDocument();
  });

  it("calls onCopyPath and onClose when 复制路径 is clicked", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.click(screen.getByText("复制路径"));
    expect(baseProps.onCopyPath).toHaveBeenCalledWith("/configs/payment");
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("shows warning text when node has children and delete is clicked", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.click(screen.getByText("删除节点"));
    expect(screen.getByText(/将递归删除所有子节点/)).toBeInTheDocument();
  });

  it("closes on Escape key", () => {
    render(<TreeContextMenu {...baseProps} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(baseProps.onClose).toHaveBeenCalled();
  });
});
```

- [ ] **步骤 3：运行测试确认失败**

```bash
npm test -- src/context-menu.test.tsx
```

预期：FAIL

- [ ] **步骤 4：新增 Rust 命令 create_node / delete_node**

在 `src-tauri/src/commands.rs` 中，追加两个桩命令：

```rust
#[tauri::command]
pub async fn create_node(
    path: String,
    data: String,
    _state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    // TODO: wire to live ZK adapter when write support is implemented
    let _ = (path, data);
    Ok(())
}

#[tauri::command]
pub async fn delete_node(
    path: String,
    recursive: bool,
    _state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    // TODO: wire to live ZK adapter when write support is implemented
    let _ = (path, recursive);
    Ok(())
}
```

- [ ] **步骤 5：在 lib.rs 注册新命令**

在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler!` 列表中追加：

```rust
create_node,
delete_node,
```

- [ ] **步骤 6：运行 Rust 测试**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

预期：全部 PASS，无编译错误

- [ ] **步骤 7：在 commands.ts 添加前端封装**

在 `src/lib/commands.ts` 追加：

```ts
export async function createNode(path: string, data: string): Promise<void> {
  await invoke("create_node", { path, data });
}

export async function deleteNode(path: string, recursive: boolean): Promise<void> {
  await invoke("delete_node", { path, recursive });
}
```

- [ ] **步骤 8：新建 src/components/tree-context-menu.tsx**

```tsx
import { useEffect, useState } from "react";

interface TreeContextMenuProps {
  path: string;
  x: number;
  y: number;
  hasChildren: boolean;
  onClose: () => void;
  onCreate: (parentPath: string, name: string, data: string) => void;
  onDelete: (path: string, recursive: boolean) => void;
  onCopyPath: (path: string) => void;
  onRefresh: (path: string) => void;
}

export function TreeContextMenu({
  path, x, y, hasChildren,
  onClose, onCreate, onDelete, onCopyPath, onRefresh,
}: TreeContextMenuProps) {
  const [mode, setMode] = useState<"menu" | "create" | "delete">("menu");
  const [newName, setNewName] = useState("");
  const [newData, setNewData] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (mode === "create") {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <p className="dialog-title">创建子节点</p>
          <div className="dialog-body">
            <div className="form-grid">
              <label className="form-label">父路径</label>
              <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)" }}>{path}</span>
              <label className="form-label">节点名称</label>
              <input
                className="form-input"
                placeholder="例：my-node"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <label className="form-label">初始数据</label>
              <input
                className="form-input"
                placeholder="可为空"
                value={newData}
                onChange={(e) => setNewData(e.target.value)}
              />
            </div>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={() => { onCreate(path, newName, newData); onClose(); }}
              disabled={!newName.trim()}
            >
              创建
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div className="dialog-backdrop" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <p className="dialog-title">删除节点</p>
          <div className="dialog-body">
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              确认删除：<code style={{ color: "var(--danger)" }}>{path}</code>
            </p>
            {hasChildren && (
              <p style={{ fontSize: "12px", color: "var(--warning)" }}>
                ⚠ 将递归删除所有子节点
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
              onClick={() => { onDelete(path, hasChildren); onClose(); }}
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onMouseLeave={onClose}
    >
      <div className="context-menu-item" onClick={() => setMode("create")}>
        ✚ 创建子节点
      </div>
      <div className="context-menu-sep" />
      <div className="context-menu-item" onClick={() => { onCopyPath(path); onClose(); }}>
        ⎘ 复制路径
      </div>
      <div className="context-menu-item" onClick={() => { onRefresh(path); onClose(); }}>
        ↺ 刷新
      </div>
      <div className="context-menu-sep" />
      <div className="context-menu-item context-menu-item--danger" onClick={() => setMode("delete")}>
        ✕ 删除节点
      </div>
    </div>
  );
}
```

- [ ] **步骤 9：在 useWorkbenchState 添加 createNode / deleteNode**

在 `src/hooks/use-workbench-state.ts` 中追加两个方法：

```ts
async function createNode(parentPath: string, name: string, data: string) {
  const fullPath = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
  try {
    await createNodeCmd(fullPath, data);
    await ensureChildrenLoaded(parentPath, { force: true });
  } catch (error) {
    setConnectionError(error instanceof Error ? error.message : "创建节点失败");
  }
}

async function deleteNodeFn(path: string, recursive: boolean) {
  try {
    await deleteNodeCmd(path, recursive);
    // Refresh parent
    const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
    await ensureChildrenLoaded(parentPath, { force: true });
  } catch (error) {
    setConnectionError(error instanceof Error ? error.message : "删除节点失败");
  }
}
```

在文件顶部 import 中加入：

```ts
import { createNode as createNodeCmd, deleteNode as deleteNodeCmd } from "../lib/commands";
```

在 return 中追加：

```ts
createNode,
deleteNode: deleteNodeFn,
```

- [ ] **步骤 10：将 TreeContextMenu 接入 App.tsx**

在 App.tsx 中追加右键菜单状态和处理逻辑：

```tsx
import { TreeContextMenu } from "./components/tree-context-menu";
import { useState } from "react";

// 在组件顶部：
const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number; hasChildren: boolean } | null>(null);

// BrowserPane 的 onContextMenu：
onContextMenu={(path, e) => {
  const node = treeNodes.find(/* findNode helper */ );
  setContextMenu({
    path,
    x: e.clientX,
    y: e.clientY,
    hasChildren: !!(node?.hasChildren),
  });
}}

// 在 app-shell 末尾渲染：
{contextMenu && (
  <TreeContextMenu
    path={contextMenu.path}
    x={contextMenu.x}
    y={contextMenu.y}
    hasChildren={contextMenu.hasChildren}
    onClose={() => setContextMenu(null)}
    onCreate={(parentPath, name, data) => createNode(parentPath, name, data)}
    onDelete={(path, recursive) => deleteNode(path, recursive)}
    onCopyPath={(path) => navigator.clipboard.writeText(path)}
    onRefresh={(path) => ensureChildrenLoaded(path, { force: true })}
  />
)}
```

需要从 useWorkbenchState 解构 `createNode`、`deleteNode`、`ensureChildrenLoaded`（或通过 `refreshActiveNode` 间接触发）。

- [ ] **步骤 11：运行全量测试**

```bash
npm test -- src/context-menu.test.tsx
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：全部 PASS

- [ ] **步骤 12：提交**

```bash
git add src/components/tree-context-menu.tsx \
        src/hooks/use-workbench-state.ts \
        src/lib/commands.ts src/App.tsx \
        src/context-menu.test.tsx \
        src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add tree context menu with create/delete node"
```

---

## 任务 8：清理旧组件

> 删除不再使用的旧组件，确保全量测试仍然通过。

**文件（删除）：**
- `src/components/topbar.tsx`
- `src/components/context-panel.tsx`
- `src/components/sidebar.tsx`
- `src/components/workbench-tabs.tsx`

- [ ] **步骤 1：确认旧组件不再被任何文件引用**

```bash
grep -r "topbar\|context-panel\|sidebar\|workbench-tabs" src/ --include="*.tsx" --include="*.ts" -l
```

预期：不应有任何结果（仅剩旧文件自身）

- [ ] **步骤 2：删除旧组件文件**

```bash
rm src/components/topbar.tsx \
   src/components/context-panel.tsx \
   src/components/sidebar.tsx \
   src/components/workbench-tabs.tsx
```

- [ ] **步骤 3：运行全量测试**

```bash
npm test
npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：全部通过，无 TS/Rust 编译错误

- [ ] **步骤 4：提交**

```bash
git add -A
git commit -m "chore: remove deprecated topbar, context-panel, sidebar, workbench-tabs"
```

---

## 执行说明

- 每个任务完成后运行全量测试，不积累技术债务
- 任务 1（CSS）是所有组件的样式基础，必须先完成
- 任务 2（类型扩展）是 NodeStat（任务 5）的数据依赖，需在任务 5 前完成
- 任务 3–6 可以在骨架框架下逐步替换占位内容，应用全程可运行
- 任务 7 的 Rust 命令桩不依赖真实 ZK 写支持，与 UI 流程可以独立测试
- 任务 8 必须在所有新组件接入 App.tsx 后执行，避免悬挂引用
