# Node View/Edit Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement P0+P1 features from the node view/edit enhancement spec — edit mode toggle, right-panel layout restructure, content area visual enhancement, and view mode + charset selection.

**Architecture:** Add `editingPaths: Set<string>` to session state to track per-path edit mode. Decompose the monolithic `EditorPanel` into three focused components (`NodeHeader`, `EditorToolbar`, `NodeContentPanel`) coordinated by a refactored `EditorPanel`. App.tsx passes edit mode callbacks down; EditorPanel manages local view mode + charset state.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react, pure CSS design tokens (no UI library)

**Spec:** `docs/superpowers/specs/2026-03-28-node-view-edit-enhancement.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/types.ts` | Add `ViewMode`, `Charset` types; add `editingPaths` to `ActiveSession` |
| Modify | `src/hooks/use-session-manager.ts` | Add `enterEditMode` / `exitEditMode` |
| Modify | `src/hooks/use-workbench-state.ts` | Expose edit mode API; update `handleSave`; add `fetchServerValue` |
| Create | `src/components/node-header.tsx` | Header row: path + mode pill + edit toggle + unsaved badge |
| Create | `src/components/editor-toolbar.tsx` | Toolbar: view mode tabs + charset selector + action buttons |
| Create | `src/components/node-content-panel.tsx` | Content: raw textarea / JSON view / XML view / parse error |
| Modify | `src/components/editor-panel.tsx` | Compose new components; manage viewMode + charset; discard confirm dialog |
| Modify | `src/App.tsx` | Remove inline content-header; wire new EditorPanel props |
| Modify | `src/styles/app.css` | New classes for layout layers, content card, edit toggle, toolbar |

---

## Task 1: Extend types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add new types to types.ts**

Replace the `ActiveSession` interface and add the two new types:

```typescript
export type ViewMode = "raw" | "json" | "xml";
export type Charset = "UTF-8" | "GBK" | "ISO-8859-1";
```

Add `editingPaths` field to `ActiveSession`:

```typescript
export interface ActiveSession {
  connection: SavedConnection;
  treeNodes: NodeTreeItem[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  activePath: string | null;
  activeNode: NodeDetails | null;
  drafts: Record<string, string>;
  editingPaths: Set<string>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/neolin/Playground/zoocute && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors about `editingPaths` missing in `addSession` (we'll fix in Task 2). If there are other unrelated errors, note them but don't fix them now.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add ViewMode, Charset types and editingPaths to ActiveSession"
```

---

## Task 2: Session manager edit mode

**Files:**
- Modify: `src/hooks/use-session-manager.ts`

- [ ] **Step 1: Add editingPaths to addSession and expose edit methods**

```typescript
import { useState } from "react";
import type { ActiveSession, NodeTreeItem, SavedConnection } from "../lib/types";

export function useSessionManager() {
  const [sessions, setSessions] = useState<Map<string, ActiveSession>>(
    () => new Map()
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  function addSession(connection: SavedConnection, rootNodes: NodeTreeItem[]) {
    const session: ActiveSession = {
      connection,
      treeNodes: rootNodes,
      expandedPaths: new Set(),
      loadingPaths: new Set(),
      activePath: null,
      activeNode: null,
      drafts: {},
      editingPaths: new Set(),
    };
    setSessions((prev) => new Map(prev).set(connection.id, session));
    setActiveTabId(connection.id);
  }

  function removeSession(connectionId: string) {
    setSessions((prev) => {
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
    setActiveTabId((prev) => {
      if (prev !== connectionId) return prev;
      const remaining = [...sessions.keys()].filter((k) => k !== connectionId);
      return remaining[0] ?? null;
    });
  }

  function updateSession(
    connectionId: string,
    updater: (s: ActiveSession) => ActiveSession
  ) {
    setSessions((prev) => {
      const session = prev.get(connectionId);
      if (!session) return prev;
      const next = new Map(prev);
      next.set(connectionId, updater(session));
      return next;
    });
  }

  function enterEditMode(connectionId: string, path: string) {
    updateSession(connectionId, (s) => ({
      ...s,
      editingPaths: new Set(s.editingPaths).add(path),
    }));
  }

  function exitEditMode(connectionId: string, path: string) {
    updateSession(connectionId, (s) => {
      const next = new Set(s.editingPaths);
      next.delete(path);
      return { ...s, editingPaths: next };
    });
  }

  const activeSession = activeTabId ? (sessions.get(activeTabId) ?? null) : null;
  const hasActiveSessions = sessions.size > 0;

  return {
    sessions,
    activeTabId,
    setActiveTabId,
    activeSession,
    hasActiveSessions,
    addSession,
    removeSession,
    updateSession,
    enterEditMode,
    exitEditMode,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/neolin/Playground/zoocute && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Run existing tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test 2>&1
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-session-manager.ts
git commit -m "feat: add enterEditMode/exitEditMode to session manager"
```

---

## Task 3: useWorkbenchState — edit mode API + updated save

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`

- [ ] **Step 1: Wire edit mode into useWorkbenchState**

Add imports and destructure new methods from `useSessionManager`:

```typescript
const {
  sessions, activeTabId, setActiveTabId,
  activeSession, hasActiveSessions,
  addSession, removeSession, updateSession,
  enterEditMode: enterEditModeSession,
  exitEditMode: exitEditModeSession,
} = useSessionManager();
```

Add wrapper functions after `discardDraft`:

```typescript
function enterEditMode(path: string) {
  if (!activeTabId) return;
  enterEditModeSession(activeTabId, path);
}

function exitEditMode(path: string) {
  if (!activeTabId) return;
  exitEditModeSession(activeTabId, path);
}
```

- [ ] **Step 2: Update handleSave to exit edit mode and refresh on success**

Replace the existing `handleSave`:

```typescript
async function handleSave(path: string, value: string) {
  if (!activeTabId) return;
  setSaveError(null);
  try {
    await saveNode(activeTabId, path, value);
    discardDraft(path);
    exitEditModeSession(activeTabId, path);
    const nodeDetails = await getNodeDetails(activeTabId, path);
    updateSession(activeTabId, (s) => ({ ...s, activeNode: nodeDetails }));
  } catch (error) {
    setSaveError(error instanceof Error ? error.message : "保存失败");
  }
}
```

- [ ] **Step 3: Add fetchServerValue for Diff**

Add after `handleSave`:

```typescript
async function fetchServerValue(path: string): Promise<string | null> {
  if (!activeTabId) return null;
  try {
    const nodeDetails = await getNodeDetails(activeTabId, path);
    return nodeDetails.value;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Expose new values in return object**

Add to the derived state block:

```typescript
const editingPaths = activeSession?.editingPaths ?? new Set<string>();
const isEditing = activePath ? editingPaths.has(activePath) : false;
```

Add to the return object:

```typescript
isEditing,
enterEditMode,
exitEditMode,
fetchServerValue,
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test 2>&1
```

Expected: existing tests pass. The `saveNode` mock already resolves, so `handleSave` succeeds and triggers `getNodeDetails` mock — the mock already handles this.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-workbench-state.ts
git commit -m "feat: expose enterEditMode/exitEditMode/fetchServerValue from useWorkbenchState; save exits edit mode on success"
```

---

## Task 4: NodeHeader component

**Files:**
- Create: `src/components/node-header.tsx`
- Create: `src/components/node-header.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/node-header.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NodeHeader } from "./node-header";
import type { NodeDetails } from "../lib/types";

function makeNode(overrides: Partial<NodeDetails> = {}): NodeDetails {
  return {
    path: "/foo/bar",
    value: "hello",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 1,
    childrenCount: 0,
    updatedAt: "",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    dataLength: 5,
    ephemeral: false,
    ...overrides,
  };
}

it("shows path and mode pill", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByText("/foo/bar")).toBeInTheDocument();
  expect(screen.getByText("文本 · 可编辑")).toBeInTheDocument();
});

it("shows edit toggle for editable nodes", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: "开启编辑" })).toBeInTheDocument();
});

it("does not show edit toggle for binary nodes", () => {
  render(
    <NodeHeader
      node={makeNode({ dataKind: "binary", editable: false, displayModeLabel: "二进制 · 只读" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.queryByRole("button", { name: "开启编辑" })).not.toBeInTheDocument();
});

it("calls onEnterEdit when toggle clicked in view mode", async () => {
  const user = userEvent.setup();
  const onEnterEdit = vi.fn();
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={false}
      isDirty={false}
      onEnterEdit={onEnterEdit}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(onEnterEdit).toHaveBeenCalledOnce();
});

it("shows unsaved badge when isDirty", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={true}
      isDirty={true}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.getByText("未保存")).toBeInTheDocument();
});

it("does not show unsaved badge when not dirty", () => {
  render(
    <NodeHeader
      node={makeNode()}
      isEditing={true}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  expect(screen.queryByText("未保存")).not.toBeInTheDocument();
});

it("shows warning text when cautious node enters edit mode", async () => {
  const user = userEvent.setup();
  render(
    <NodeHeader
      node={makeNode({ dataKind: "cautious", displayModeLabel: "谨慎 · 可编辑" })}
      isEditing={false}
      isDirty={false}
      onEnterEdit={vi.fn()}
      onExitEdit={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "开启编辑" }));
  expect(screen.getByText(/可能改变原始格式/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/node-header.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `node-header.tsx` not found.

- [ ] **Step 3: Implement NodeHeader**

```typescript
// src/components/node-header.tsx
import { useState } from "react";
import type { NodeDetails } from "../lib/types";

interface NodeHeaderProps {
  node: NodeDetails;
  isEditing: boolean;
  isDirty: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
}

export function NodeHeader({ node, isEditing, isDirty, onEnterEdit, onExitEdit }: NodeHeaderProps) {
  const [showCautiousWarning, setShowCautiousWarning] = useState(false);

  const canToggleEdit = node.editable || node.dataKind === "cautious";

  function handleToggle() {
    if (isEditing) {
      onExitEdit();
      return;
    }
    if (node.dataKind === "cautious") {
      setShowCautiousWarning(true);
      return;
    }
    onEnterEdit();
  }

  function confirmCautious() {
    setShowCautiousWarning(false);
    onEnterEdit();
  }

  const pillClass =
    node.dataKind === "binary"
      ? "mode-pill mode-pill--readonly"
      : node.dataKind === "cautious"
        ? "mode-pill mode-pill--cautious"
        : "mode-pill";

  return (
    <div className="content-header">
      <span className="node-path">{node.path}</span>
      <span className={pillClass}>{node.displayModeLabel}</span>

      {canToggleEdit && (
        <button
          type="button"
          className={`edit-toggle${isEditing ? " edit-toggle--active" : ""}`}
          onClick={handleToggle}
          aria-label={isEditing ? "退出编辑" : "开启编辑"}
          aria-pressed={isEditing}
        >
          {isEditing ? "编辑中" : "开启编辑"}
        </button>
      )}

      {isDirty && <span className="unsaved-badge">未保存</span>}

      {showCautiousWarning && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <p className="dialog-title">注意</p>
            <div className="dialog-body">
              <p>此节点内容可能改变原始格式，继续编辑后保存将以所见内容为准。</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setShowCautiousWarning(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={confirmCautious}>继续编辑</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/node-header.test.tsx 2>&1 | tail -20
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/node-header.tsx src/components/node-header.test.tsx
git commit -m "feat: NodeHeader component with edit toggle, mode pill, unsaved badge"
```

---

## Task 5: EditorToolbar component

**Files:**
- Create: `src/components/editor-toolbar.tsx`
- Create: `src/components/editor-toolbar.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/editor-toolbar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EditorToolbar } from "./editor-toolbar";
import type { ViewMode, Charset } from "../lib/types";

const defaultProps = {
  isEditing: false,
  isDirty: false,
  viewMode: "raw" as ViewMode,
  onViewModeChange: vi.fn(),
  charset: "UTF-8" as Charset,
  onCharsetChange: vi.fn(),
  isTextNode: true,
  onDiff: vi.fn(),
  onDiscard: vi.fn(),
  onSave: vi.fn(),
};

it("shows view mode tabs always", () => {
  render(<EditorToolbar {...defaultProps} />);
  expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "XML" })).toBeInTheDocument();
});

it("hides action buttons in view mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={false} />);
  expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看 Diff" })).not.toBeInTheDocument();
});

it("shows action buttons in edit mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "放弃修改" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 Diff" })).toBeInTheDocument();
});

it("disables save and diff when no draft in edit mode", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看 Diff" })).toBeDisabled();
});

it("enables save and diff when has draft", () => {
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={true} />);
  expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "查看 Diff" })).not.toBeDisabled();
});

it("shows charset selector for text nodes", () => {
  render(<EditorToolbar {...defaultProps} isTextNode={true} />);
  expect(screen.getByLabelText("字符编码")).toBeInTheDocument();
});

it("hides charset selector for binary nodes", () => {
  render(<EditorToolbar {...defaultProps} isTextNode={false} />);
  expect(screen.queryByLabelText("字符编码")).not.toBeInTheDocument();
});

it("calls onViewModeChange when tab clicked", async () => {
  const user = userEvent.setup();
  const onViewModeChange = vi.fn();
  render(<EditorToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);
  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(onViewModeChange).toHaveBeenCalledWith("json");
});

it("calls onSave when save button clicked", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={true} onSave={onSave} />);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(onSave).toHaveBeenCalledOnce();
});

it("calls onDiscard when discard button clicked", async () => {
  const user = userEvent.setup();
  const onDiscard = vi.fn();
  render(<EditorToolbar {...defaultProps} isEditing={true} isDirty={false} onDiscard={onDiscard} />);
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onDiscard).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/editor-toolbar.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `editor-toolbar.tsx` not found.

- [ ] **Step 3: Implement EditorToolbar**

```typescript
// src/components/editor-toolbar.tsx
import type { Charset, ViewMode } from "../lib/types";

interface EditorToolbarProps {
  isEditing: boolean;
  isDirty: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  charset: Charset;
  onCharsetChange: (charset: Charset) => void;
  isTextNode: boolean;
  onDiff: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "raw", label: "Raw" },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML" },
];

const CHARSETS: Charset[] = ["UTF-8", "GBK", "ISO-8859-1"];

export function EditorToolbar({
  isEditing,
  isDirty,
  viewMode,
  onViewModeChange,
  charset,
  onCharsetChange,
  isTextNode,
  onDiff,
  onDiscard,
  onSave,
}: EditorToolbarProps) {
  return (
    <div className="editor-toolbar">
      <div className="toolbar-view-tabs">
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`toolbar-tab${viewMode === m.value ? " active" : ""}`}
            onClick={() => onViewModeChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {isTextNode && (
        <label className="toolbar-charset-label">
          <span className="sr-only">字符编码</span>
          <select
            aria-label="字符编码"
            className="toolbar-charset-select"
            value={charset}
            onChange={(e) => onCharsetChange(e.target.value as Charset)}
          >
            {CHARSETS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      )}

      <div className="toolbar-sep" />

      {isEditing && (
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn"
            onClick={onDiff}
            disabled={!isDirty}
          >
            查看 Diff
          </button>
          <button
            type="button"
            className="btn"
            onClick={onDiscard}
          >
            放弃修改
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={!isDirty}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/editor-toolbar.test.tsx 2>&1 | tail -10
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor-toolbar.tsx src/components/editor-toolbar.test.tsx
git commit -m "feat: EditorToolbar with view mode tabs, charset selector, and state-aware action buttons"
```

---

## Task 6: NodeContentPanel component

**Files:**
- Create: `src/components/node-content-panel.tsx`
- Create: `src/components/node-content-panel.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/components/node-content-panel.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NodeContentPanel } from "./node-content-panel";

it("shows raw textarea in raw mode", () => {
  render(
    <NodeContentPanel
      value="hello world"
      viewMode="raw"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveValue("hello world");
});

it("textarea is readonly when not editing", () => {
  render(
    <NodeContentPanel
      value="hello"
      viewMode="raw"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
});

it("textarea is editable when editing", () => {
  render(
    <NodeContentPanel
      value="hello"
      viewMode="raw"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
});

it("calls onChange when user types in raw edit mode", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <NodeContentPanel
      value=""
      viewMode="raw"
      isEditing={true}
      onChange={onChange}
      onFallbackToRaw={vi.fn()}
    />
  );
  await user.type(screen.getByRole("textbox"), "x");
  expect(onChange).toHaveBeenCalledWith("x");
});

it("shows formatted JSON in json mode when content is valid", () => {
  render(
    <NodeContentPanel
      value='{"a":1}'
      viewMode="json"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  const textarea = screen.getByRole("textbox");
  expect(textarea.textContent ?? (textarea as HTMLTextAreaElement).value).toContain('"a": 1');
});

it("shows parse error when JSON is invalid in json mode", () => {
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByText(/转换失败/)).toBeInTheDocument();
  expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
});

it("shows fallback button on parse error in edit mode", () => {
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: "切换到 Raw" })).toBeInTheDocument();
});

it("calls onFallbackToRaw when fallback button clicked", async () => {
  const user = userEvent.setup();
  const onFallbackToRaw = vi.fn();
  render(
    <NodeContentPanel
      value="not json"
      viewMode="json"
      isEditing={true}
      onChange={vi.fn()}
      onFallbackToRaw={onFallbackToRaw}
    />
  );
  await user.click(screen.getByRole("button", { name: "切换到 Raw" }));
  expect(onFallbackToRaw).toHaveBeenCalledOnce();
});

it("shows parse error when XML is invalid in xml mode", () => {
  render(
    <NodeContentPanel
      value="not xml <unclosed"
      viewMode="xml"
      isEditing={false}
      onChange={vi.fn()}
      onFallbackToRaw={vi.fn()}
    />
  );
  expect(screen.getByText(/转换失败/)).toBeInTheDocument();
  expect(screen.getByText(/不是合法 XML/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/node-content-panel.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `node-content-panel.tsx` not found.

- [ ] **Step 3: Implement NodeContentPanel**

```typescript
// src/components/node-content-panel.tsx
import type { ViewMode } from "../lib/types";

interface NodeContentPanelProps {
  value: string;
  viewMode: ViewMode;
  isEditing: boolean;
  onChange: (value: string) => void;
  onFallbackToRaw: () => void;
}

function formatJson(value: string): { ok: true; formatted: string } | { ok: false } {
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(value), null, 2) };
  } catch {
    return { ok: false };
  }
}

function formatXml(raw: string): string {
  const INDENT = "  ";
  let level = 0;
  let result = "";
  raw
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .forEach((node) => {
      const trimmed = node.trim();
      if (!trimmed) return;
      if (trimmed.match(/^<\/\w/)) level = Math.max(0, level - 1);
      result += INDENT.repeat(level) + trimmed + "\n";
      if (trimmed.match(/^<\w[^>]*[^/]>.*$/) && !trimmed.match(/<.*>.*<\/.*>/)) level++;
    });
  return result.trim();
}

function parseXml(value: string): { ok: true; formatted: string } | { ok: false } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(value, "application/xml");
  if (doc.querySelector("parsererror")) return { ok: false };
  return { ok: true, formatted: formatXml(value) };
}

export function NodeContentPanel({
  value,
  viewMode,
  isEditing,
  onChange,
  onFallbackToRaw,
}: NodeContentPanelProps) {
  if (viewMode === "json") {
    const result = formatJson(value);
    if (!result.ok) {
      return (
        <div className="editor-body">
          <div className="content-parse-error">
            <p>转换失败：当前内容不是合法 JSON</p>
            <p className="content-parse-error__meta">视图模式：JSON</p>
            {isEditing && (
              <button type="button" className="btn" onClick={onFallbackToRaw}>
                切换到 Raw
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="editor-body">
        <textarea
          className="editor-textarea"
          value={result.formatted}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!isEditing}
          aria-label="节点内容"
          spellCheck={false}
        />
      </div>
    );
  }

  if (viewMode === "xml") {
    const result = parseXml(value);
    if (!result.ok) {
      return (
        <div className="editor-body">
          <div className="content-parse-error">
            <p>转换失败：当前内容不是合法 XML</p>
            <p className="content-parse-error__meta">视图模式：XML</p>
            {isEditing && (
              <button type="button" className="btn" onClick={onFallbackToRaw}>
                切换到 Raw
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="editor-body">
        <textarea
          className="editor-textarea"
          value={result.formatted}
          onChange={(e) => onChange(e.target.value)}
          readOnly={!isEditing}
          aria-label="节点内容"
          spellCheck={false}
        />
      </div>
    );
  }

  // Raw mode
  return (
    <div className="editor-body">
      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!isEditing}
        aria-label="节点内容"
        spellCheck={false}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test src/components/node-content-panel.test.tsx 2>&1 | tail -15
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/node-content-panel.tsx src/components/node-content-panel.test.tsx
git commit -m "feat: NodeContentPanel with raw/JSON/XML views and parse error handling"
```

---

## Task 7: Refactor EditorPanel

**Files:**
- Modify: `src/components/editor-panel.tsx`

Replace the entire file content:

- [ ] **Step 1: Rewrite editor-panel.tsx**

```typescript
// src/components/editor-panel.tsx
import { useState } from "react";
import type { Charset, NodeDetails, ViewMode } from "../lib/types";
import { NodeHeader } from "./node-header";
import { EditorToolbar } from "./editor-toolbar";
import { NodeContentPanel } from "./node-content-panel";
import { DiffPanel } from "./diff-panel";
import { NodeStat } from "./node-stat";

interface EditorPanelProps {
  node: NodeDetails;
  draft: string | undefined;
  saveError: string | null;
  isEditing: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: (value: string) => void;
  onDiscard: () => void;
  onFetchServerValue: () => Promise<string | null>;
}

export function EditorPanel({
  node,
  draft,
  saveError,
  isEditing,
  onEnterEdit,
  onExitEdit,
  onDraftChange,
  onSave,
  onDiscard,
  onFetchServerValue,
}: EditorPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("raw");
  const [charset, setCharset] = useState<Charset>("UTF-8");
  const [showDiff, setShowDiff] = useState(false);
  const [serverValue, setServerValue] = useState<string | null>(null);
  const [diffError, setDiffError] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const currentValue = draft ?? node.value;
  const isDirty = draft !== undefined && draft !== node.value;
  const isTextNode = node.dataKind !== "binary";

  async function handleDiff() {
    setDiffError(false);
    const value = await onFetchServerValue();
    if (value === null) {
      setDiffError(true);
      return;
    }
    setServerValue(value);
    setShowDiff(true);
  }

  function handleDiscard() {
    if (!isDirty) {
      onExitEdit();
      return;
    }
    setShowDiscardConfirm(true);
  }

  function confirmDiscard() {
    setShowDiscardConfirm(false);
    setShowDiff(false);
    setServerValue(null);
    onDiscard();
    onExitEdit();
  }

  function handleSave() {
    onSave(currentValue);
    setShowDiff(false);
    setServerValue(null);
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    setShowDiff(false);
  }

  return (
    <>
      <NodeHeader
        node={node}
        isEditing={isEditing}
        isDirty={isDirty}
        onEnterEdit={onEnterEdit}
        onExitEdit={handleDiscard}
      />
      <NodeStat node={node} />
      <EditorToolbar
        isEditing={isEditing}
        isDirty={isDirty}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        charset={charset}
        onCharsetChange={setCharset}
        isTextNode={isTextNode}
        onDiff={handleDiff}
        onDiscard={handleDiscard}
        onSave={handleSave}
      />
      <NodeContentPanel
        value={currentValue}
        viewMode={viewMode}
        isEditing={isEditing}
        onChange={onDraftChange}
        onFallbackToRaw={() => setViewMode("raw")}
      />

      {showDiff && serverValue !== null && (
        <DiffPanel original={serverValue} draft={currentValue} />
      )}

      {diffError && (
        <div className="save-error">无法获取服务端当前值</div>
      )}

      {saveError && (
        <div className="save-error">{saveError}</div>
      )}

      {showDiscardConfirm && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <p className="dialog-title">放弃修改</p>
            <div className="dialog-body">
              <p>有未保存的修改，确定要放弃吗？</p>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setShowDiscardConfirm(false)}>
                继续编辑
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDiscard}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test 2>&1
```

Expected: all tests pass. The App.tsx will have TypeScript errors because EditorPanel's props changed — we'll fix in Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor-panel.tsx
git commit -m "refactor: EditorPanel composes NodeHeader, EditorToolbar, NodeContentPanel; server-value Diff; discard confirm"
```

---

## Task 8: Update App.tsx + CSS

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Update App.tsx**

In the browse panel section, replace the old `content-header` + `NodeStat` + `EditorPanel` block:

Find this block in App.tsx (lines 123-149):
```tsx
{ribbonMode === "browse" && activeSession && activeNode && (
  <>
    <div className="content-header">
      <span className="node-path">{activePath}</span>
      <span
        className={`mode-pill${
          !activeNode.editable
            ? " mode-pill--readonly"
            : activeNode.dataKind === "cautious"
            ? " mode-pill--cautious"
            : ""
        }`}
      >
        {activeNode.displayModeLabel}
      </span>
    </div>
    <NodeStat node={activeNode} />
    <EditorPanel
      key={activePath ?? ""}
      node={activeNode}
      draft={draft}
      saveError={saveError}
      onDraftChange={(v) => activePath && updateDraft(activePath, v)}
      onSave={(v) => activePath && handleSave(activePath, v)}
      onDiscard={() => activePath && discardDraft(activePath)}
    />
  </>
)}
```

Replace with:
```tsx
{ribbonMode === "browse" && activeSession && activeNode && (
  <EditorPanel
    key={activePath ?? ""}
    node={activeNode}
    draft={draft}
    saveError={saveError}
    isEditing={isEditing}
    onEnterEdit={() => activePath && enterEditMode(activePath)}
    onExitEdit={() => activePath && exitEditMode(activePath)}
    onDraftChange={(v) => activePath && updateDraft(activePath, v)}
    onSave={(v) => activePath && handleSave(activePath, v)}
    onDiscard={() => activePath && discardDraft(activePath)}
    onFetchServerValue={() => activePath ? fetchServerValue(activePath) : Promise.resolve(null)}
  />
)}
```

Also add the new destructured values from `useWorkbenchState`:
```typescript
const {
  // ...existing...
  isEditing,
  enterEditMode,
  exitEditMode,
  fetchServerValue,
  // ...
} = useWorkbenchState();
```

Remove the `NodeStat` import since EditorPanel now renders it internally.

- [ ] **Step 2: Add new CSS to app.css**

Append to `src/styles/app.css`:

```css
/* ─── Edit Toggle ────────────────────────────────────── */
.edit-toggle {
  margin-left: 8px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-inset);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.edit-toggle:hover {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: var(--accent);
}
.edit-toggle--active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: var(--accent);
}

/* ─── Toolbar Charset ────────────────────────────────── */
.toolbar-charset-select {
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  outline: none;
}
.toolbar-charset-select:focus { border-color: var(--accent); }

/* ─── Toolbar View Tabs ──────────────────────────────── */
.toolbar-view-tabs {
  display: flex;
  gap: 2px;
}

/* ─── Content Parse Error ────────────────────────────── */
.content-parse-error {
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.content-parse-error p {
  font-size: 12px;
  color: var(--danger);
}
.content-parse-error__meta {
  color: var(--text-muted) !important;
  font-size: 11px !important;
}

/* ─── Screen reader only ─────────────────────────────── */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/neolin/Playground/zoocute && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/neolin/Playground/zoocute && npm test 2>&1
```

Expected: all tests pass including the existing App.test.tsx integration tests.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles/app.css
git commit -m "feat: wire edit mode into App.tsx; add CSS for edit toggle, charset selector, parse error panel"
```

---

## Self-Review Checklist

After writing, verify against spec:

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| 默认查看态，不可修改 | Task 4 (NodeHeader shows edit toggle, no edit by default) |
| 显式开启编辑 | Task 4 (toggle calls onEnterEdit) |
| 保存后退回查看态 | Task 3 (handleSave exits edit mode) |
| 保存失败停留编辑态 | Task 3 (saveError set, no exitEditMode on failure) |
| 放弃修改兼做退出 | Task 7 (handleDiscard exits if no draft) |
| 有草稿时放弃需确认 | Task 7 (showDiscardConfirm dialog) |
| 谨慎节点编辑警告 | Task 4 (NodeHeader cautious confirm dialog) |
| 只读节点不显示编辑 | Task 4 (canToggleEdit check) |
| Diff = 草稿 vs 服务端 | Task 7 (onFetchServerValue) |
| Diff 拉取失败提示 | Task 7 (diffError state) |
| Raw/JSON/XML 视图 | Task 5 + 6 (EditorToolbar tabs, NodeContentPanel) |
| JSON/XML 解析失败提示 | Task 6 (parse error with 切换到 Raw) |
| JSON/XML 编辑态降级 | Task 6 (onFallbackToRaw) |
| 所见即所得保存 | Task 6 (onChange with formatted value) |
| Charset 选择器 | Task 5 (EditorToolbar) |
| Charset 仅文本节点 | Task 5 (isTextNode prop) |
| 工具栏控件状态表 | Task 5 (action buttons hidden in view mode, disabled when no draft) |
| 右侧四段式布局 | Task 7 (NodeHeader + NodeStat + EditorToolbar + NodeContentPanel) |

**Not in this plan (deferred P2):** 树动画, 二进制预览, Charset 持久化, Kryo 解码.
