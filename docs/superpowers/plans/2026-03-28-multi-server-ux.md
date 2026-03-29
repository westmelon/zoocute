# Multi-Server UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the app so it starts in connection-management mode with no tree UI, then supports multiple simultaneous ZooKeeper sessions via a horizontal tab bar in the content area.

**Architecture:** Replace the single `Mutex<Option<LiveAdapter>>` in Rust with `Mutex<HashMap<String, LiveAdapter>>` (keyed by connectionId), update all Tauri commands to include `connection_id`, and replace the single-connection React state with a `useSessionManager` hook that manages an `ActiveSession` per connected server. The tab bar lives at the top of the content area and is hidden when in connections mode.

**Tech Stack:** Tauri 2 (Rust), React 18, TypeScript, Vitest + React Testing Library, zookeeper crate (Rust)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/types.ts` | Modify | Add `ActiveSession` type |
| `src/lib/commands.ts` | Modify | New `connectServer`/`disconnectServer`; add `connectionId` param to all data commands |
| `src/hooks/use-session-manager.ts` | Create | Manage `Map<string, ActiveSession>` + `activeTabId` |
| `src/hooks/use-workbench-state.ts` | Modify | Use `useSessionManager`; remove single-connection state |
| `src/components/ribbon.tsx` | Modify | Accept `hasActiveSessions` prop; hide browse/log icons when false |
| `src/components/server-tabs.tsx` | Create | Horizontal tab bar for connected servers |
| `src/App.tsx` | Modify | Wire `ServerTabs`, conditional tab visibility, updated props |
| `src/styles/app.css` | Modify | Add `.server-tabs`, `.server-tab`, `.server-tab--active` styles |
| `src-tauri/src/commands.rs` | Modify | `sessions: HashMap`, new commands, updated signatures |
| `src-tauri/src/lib.rs` | Modify | Register new/renamed commands |
| `src/session-manager.test.ts` | Create | Tests for `useSessionManager` |
| `src/server-tabs.test.tsx` | Create | Tests for `ServerTabs` |
| `src/connectivity.test.tsx` | Modify | Rewrite for new hook API |
| `src/use-workbench-state.test.tsx` | Modify | Remove mock-data-only tests; add session-aware tests |
| `src-tauri/tests/zk_core_tests.rs` | Modify | Update session-related assertions |

---

## Task 1: Update Rust AppState to multi-session HashMap

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tests/zk_core_tests.rs`

- [ ] **Step 1: Write failing Rust tests for new commands**

Replace the three failing session tests at the bottom of `src-tauri/tests/zk_core_tests.rs` with:

```rust
#[test]
fn sessions_map_starts_empty() {
    let state = AppState::default();
    let sessions = state.sessions.lock().unwrap();
    assert!(sessions.is_empty());
}

#[test]
fn multiple_connection_ids_stored_independently() {
    let state = AppState::default();
    // We can't add real LiveAdapters without a ZK server, but we can verify
    // the HashMap accepts separate keys without collision.
    let sessions = state.sessions.lock().unwrap();
    // Two distinct keys that would correspond to two connections
    assert!(!sessions.contains_key("conn-a"));
    assert!(!sessions.contains_key("conn-b"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test 2>&1 | head -40
```

Expected: compile error — `sessions` field doesn't exist yet.

- [ ] **Step 3: Replace AppState and all commands in `src-tauri/src/commands.rs`**

Replace the entire file content:

```rust
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::State;

use crate::domain::{ConnectRequestDto, ConnectionStatusDto, LoadedTreeNodeDto, NodeDetailsDto};
use crate::zk_core::adapter::ReadOnlyZkAdapter;
use crate::zk_core::live::LiveAdapter;
use crate::zk_core::mock::MockAdapter;

pub struct AppState {
    pub sessions: Mutex<HashMap<String, LiveAdapter>>,
    pub mock: MockAdapter,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            mock: MockAdapter::default(),
        }
    }
}

#[tauri::command]
pub fn connect_server(
    connection_id: String,
    request: ConnectRequestDto,
    state: State<'_, AppState>,
) -> Result<ConnectionStatusDto, String> {
    let (adapter, result) = LiveAdapter::connect_live(&request)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    sessions.insert(connection_id, adapter);
    Ok(result)
}

#[tauri::command]
pub fn disconnect_server(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    sessions.remove(&connection_id);
    Ok(())
}

#[tauri::command]
pub fn list_children(
    connection_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<LoadedTreeNodeDto>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.list_children(&path),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn get_node_details(
    connection_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<NodeDetailsDto, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.get_node(&path),
        None => Err(format!("no active session for connection {connection_id}")),
    }
}

#[tauri::command]
pub fn save_node(
    connection_id: String,
    path: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.save_node(&path, &value),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn create_node(
    connection_id: String,
    path: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.create_node(&path, &data),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}

#[tauri::command]
pub fn delete_node(
    connection_id: String,
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to acquire sessions lock".to_string())?;
    match sessions.get(&connection_id) {
        Some(adapter) => adapter.delete_node(&path, recursive),
        None => Err("写操作需要连接到 ZooKeeper".to_string()),
    }
}
```

- [ ] **Step 4: Update `src-tauri/src/lib.rs` to register new commands**

Replace the entire file content:

```rust
pub mod commands;
pub mod domain;
pub mod zk_core;

use commands::{
    connect_server, disconnect_server,
    create_node, delete_node, get_node_details, list_children, save_node,
    AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect_server,
            disconnect_server,
            list_children,
            get_node_details,
            save_node,
            create_node,
            delete_node
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Update `src-tauri/tests/zk_core_tests.rs` — remove stale session tests**

Remove the three tests that reference `state.session` (the old `Option<LiveAdapter>` field):
- `save_node_returns_error_when_no_session`
- `create_node_returns_error_when_no_session`
- `delete_node_returns_error_when_no_session`

Replace them with the two new tests from Step 1 (`sessions_map_starts_empty` and `multiple_connection_ids_stored_independently`).

- [ ] **Step 6: Run Rust tests**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass, no compile errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/tests/zk_core_tests.rs
git commit -m "feat(rust): multi-session HashMap, connect_server/disconnect_server commands"
```

---

## Task 2: Update frontend types and commands

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/commands.ts`

- [ ] **Step 1: Add `ActiveSession` to `src/lib/types.ts`**

Append at the end of the file:

```typescript
export interface ActiveSession {
  connection: SavedConnection;
  treeNodes: NodeTreeItem[];
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  activePath: string | null;
  activeNode: NodeDetails | null;
  drafts: Record<string, string>;
}
```

- [ ] **Step 2: Replace `src/lib/commands.ts` with updated signatures**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionResult, NodeDetails, NodeTreeItem } from "./types";

export async function connectServer(
  connectionId: string,
  input: { connectionString: string; username?: string; password?: string }
): Promise<ConnectionResult> {
  return invoke("connect_server", {
    connectionId,
    request: {
      connectionString: input.connectionString,
      username: input.username || null,
      password: input.password || null,
    },
  });
}

export async function disconnectServer(connectionId: string): Promise<void> {
  return invoke("disconnect_server", { connectionId });
}

export async function listChildren(
  connectionId: string,
  path: string
): Promise<NodeTreeItem[]> {
  return invoke("list_children", { connectionId, path });
}

export async function getNodeDetails(
  connectionId: string,
  path: string
): Promise<NodeDetails> {
  return invoke("get_node_details", { connectionId, path });
}

export async function saveNode(
  connectionId: string,
  path: string,
  value: string
): Promise<void> {
  return invoke("save_node", { connectionId, path, value });
}

export async function createNode(
  connectionId: string,
  path: string,
  data: string
): Promise<void> {
  await invoke("create_node", { connectionId, path, data });
}

export async function deleteNode(
  connectionId: string,
  path: string,
  recursive: boolean
): Promise<void> {
  await invoke("delete_node", { connectionId, path, recursive });
}
```

- [ ] **Step 3: Run TypeScript type-check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors in `use-workbench-state.ts` about wrong call signatures (commands now require `connectionId`). That's expected — we'll fix the hook in Task 4.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/commands.ts
git commit -m "feat(ts): ActiveSession type, connectServer/disconnectServer commands with connectionId"
```

---

## Task 3: Create `useSessionManager` hook

**Files:**
- Create: `src/hooks/use-session-manager.ts`
- Create: `src/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/session-manager.test.ts`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useSessionManager } from "./hooks/use-session-manager";
import type { SavedConnection, NodeTreeItem } from "./lib/types";

const conn: SavedConnection = {
  id: "c1",
  name: "本地开发",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

const rootNodes: NodeTreeItem[] = [
  { path: "/configs", name: "configs", hasChildren: true },
];

describe("useSessionManager", () => {
  it("starts with no sessions and no active tab", () => {
    const { result } = renderHook(() => useSessionManager());
    expect(result.current.sessions.size).toBe(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.hasActiveSessions).toBe(false);
  });

  it("addSession creates a session and sets it as the active tab", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    expect(result.current.sessions.size).toBe(1);
    expect(result.current.activeTabId).toBe("c1");
    expect(result.current.hasActiveSessions).toBe(true);
    expect(result.current.sessions.get("c1")?.treeNodes).toEqual(rootNodes);
  });

  it("removeSession deletes the session and clears activeTabId when last", () => {
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
    });
    act(() => {
      result.current.removeSession("c1");
    });
    expect(result.current.sessions.size).toBe(0);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.hasActiveSessions).toBe(false);
  });

  it("removeSession switches to another tab if available", () => {
    const conn2: SavedConnection = { id: "c2", name: "生产", connectionString: "prod:2181", timeoutMs: 5000 };
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
      result.current.addSession(conn2, []);
    });
    act(() => {
      result.current.removeSession("c2");
    });
    expect(result.current.activeTabId).toBe("c1");
  });

  it("updateSession mutates only the target session", () => {
    const conn2: SavedConnection = { id: "c2", name: "生产", connectionString: "prod:2181", timeoutMs: 5000 };
    const { result } = renderHook(() => useSessionManager());
    act(() => {
      result.current.addSession(conn, rootNodes);
      result.current.addSession(conn2, []);
    });
    act(() => {
      result.current.updateSession("c1", (s) => ({ ...s, activePath: "/configs" }));
    });
    expect(result.current.sessions.get("c1")?.activePath).toBe("/configs");
    expect(result.current.sessions.get("c2")?.activePath).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/session-manager.test.ts 2>&1 | tail -20
```

Expected: FAIL — `useSessionManager` not found.

- [ ] **Step 3: Implement `src/hooks/use-session-manager.ts`**

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
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/session-manager.test.ts 2>&1 | tail -20
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-session-manager.ts src/session-manager.test.ts
git commit -m "feat: useSessionManager hook for multi-server session state"
```

---

## Task 4: Rewrite `useWorkbenchState` to use sessions

**Files:**
- Modify: `src/hooks/use-workbench-state.ts`
- Modify: `src/connectivity.test.tsx`
- Modify: `src/use-workbench-state.test.tsx`

- [ ] **Step 1: Rewrite `src/hooks/use-workbench-state.ts`**

Replace the entire file:

```typescript
import { useState, useEffect } from "react";
import { usePersistedConnections } from "./use-persisted-connections";
import { useSessionManager } from "./use-session-manager";
import {
  connectServer,
  disconnectServer as disconnectServerCmd,
  createNode as createNodeCmd,
  deleteNode as deleteNodeCmd,
  getNodeDetails,
  listChildren,
  saveNode,
} from "../lib/commands";
import type { NodeTreeItem, RibbonMode } from "../lib/types";

function findNode(nodes: NodeTreeItem[], targetPath: string): NodeTreeItem | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children?.length) {
      const child = findNode(node.children, targetPath);
      if (child) return child;
    }
  }
  return undefined;
}

function mergeChildren(
  nodes: NodeTreeItem[],
  targetPath: string,
  children: NodeTreeItem[]
): NodeTreeItem[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, hasChildren: children.length > 0, children };
    }
    if (!node.children?.length) return node;
    return { ...node, children: mergeChildren(node.children, targetPath, children) };
  });
}

export function useWorkbenchState() {
  const [ribbonMode, setRibbonMode] = useState<RibbonMode>("connections");
  const {
    savedConnections, setSavedConnections,
    selectedConnectionId, setSelectedConnectionId,
  } = usePersistedConnections();
  const {
    sessions, activeTabId, setActiveTabId,
    activeSession, hasActiveSessions,
    addSession, removeSession, updateSession,
  } = useSessionManager();

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Force connections mode when all sessions are closed
  useEffect(() => {
    if (!hasActiveSessions) {
      setRibbonMode("connections");
    }
  }, [hasActiveSessions]);

  async function submitConnection(params: {
    connectionString: string;
    username: string;
    password: string;
    connectionId: string;
  }) {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      await connectServer(params.connectionId, {
        connectionString: params.connectionString,
        username: params.username || undefined,
        password: params.password || undefined,
      });
      const rootNodes = await listChildren(params.connectionId, "/");
      const conn = savedConnections.find((c) => c.id === params.connectionId)!;
      addSession(conn, rootNodes);
      setRibbonMode("browse");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接失败");
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnectSession(connectionId: string) {
    try {
      await disconnectServerCmd(connectionId);
    } catch {
      // best-effort disconnect
    }
    removeSession(connectionId);
  }

  async function ensureChildrenLoaded(
    connectionId: string,
    path: string,
    options?: { force?: boolean }
  ) {
    const session = sessions.get(connectionId);
    if (!session) return;
    const targetNode = findNode(session.treeNodes, path);
    if (!targetNode?.hasChildren) return;
    if (!options?.force && targetNode.children) return;

    updateSession(connectionId, (s) => ({
      ...s,
      loadingPaths: new Set(s.loadingPaths).add(path),
    }));

    try {
      const children = await listChildren(connectionId, path);
      updateSession(connectionId, (s) => ({
        ...s,
        treeNodes: mergeChildren(s.treeNodes, path, children),
        loadingPaths: (() => {
          const next = new Set(s.loadingPaths);
          next.delete(path);
          return next;
        })(),
      }));
    } catch (error) {
      updateSession(connectionId, (s) => ({
        ...s,
        loadingPaths: (() => {
          const next = new Set(s.loadingPaths);
          next.delete(path);
          return next;
        })(),
      }));
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
    }
  }

  async function openNode(path: string) {
    if (!activeTabId) return;
    setSaveError(null);
    const session = sessions.get(activeTabId)!;
    const node = findNode(session.treeNodes, path);

    if (node?.hasChildren) {
      updateSession(activeTabId, (s) => ({
        ...s,
        expandedPaths: new Set(s.expandedPaths).add(path),
      }));
      await ensureChildrenLoaded(activeTabId, path);
    }

    try {
      const nodeDetails = await getNodeDetails(activeTabId, path);
      updateSession(activeTabId, (s) => ({
        ...s,
        activePath: path,
        activeNode: nodeDetails,
      }));
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
    }
  }

  async function toggleNode(path: string) {
    if (!activeTabId) return;
    const session = sessions.get(activeTabId)!;
    const isExpanded = session.expandedPaths.has(path);

    if (isExpanded) {
      updateSession(activeTabId, (s) => {
        const next = new Set(s.expandedPaths);
        next.delete(path);
        return { ...s, expandedPaths: next };
      });
      return;
    }

    updateSession(activeTabId, (s) => ({
      ...s,
      expandedPaths: new Set(s.expandedPaths).add(path),
    }));
    await ensureChildrenLoaded(activeTabId, path);
  }

  async function refreshActiveNode() {
    if (!activeTabId || !activeSession?.activePath) return;
    try {
      const nodeDetails = await getNodeDetails(activeTabId, activeSession.activePath);
      updateSession(activeTabId, (s) => ({ ...s, activeNode: nodeDetails }));
      await ensureChildrenLoaded(activeTabId, activeSession.activePath, { force: true });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
    }
  }

  function updateDraft(path: string, value: string) {
    if (!activeTabId) return;
    updateSession(activeTabId, (s) => ({
      ...s,
      drafts: { ...s.drafts, [path]: value },
    }));
  }

  function discardDraft(path: string) {
    if (!activeTabId) return;
    updateSession(activeTabId, (s) => {
      const next = { ...s.drafts };
      delete next[path];
      return { ...s, drafts: next };
    });
  }

  async function handleSave(path: string, value: string) {
    if (!activeTabId) return;
    setSaveError(null);
    try {
      await saveNode(activeTabId, path, value);
      discardDraft(path);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function createNode(parentPath: string, name: string, data: string) {
    if (!activeTabId) return;
    const fullPath = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
    try {
      await createNodeCmd(activeTabId, fullPath, data);
      await ensureChildrenLoaded(activeTabId, parentPath, { force: true });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "创建节点失败");
    }
  }

  async function deleteNodeFn(path: string, recursive: boolean) {
    if (!activeTabId) return;
    try {
      await deleteNodeCmd(activeTabId, path, recursive);
      const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
      await ensureChildrenLoaded(activeTabId, parentPath, { force: true });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "删除节点失败");
    }
  }

  // Derive current session's state for App.tsx consumption
  const treeNodes = activeSession?.treeNodes ?? [];
  const expandedPaths = activeSession?.expandedPaths ?? new Set<string>();
  const loadingPaths = activeSession?.loadingPaths ?? new Set<string>();
  const activePath = activeSession?.activePath ?? null;
  const activeNode = activeSession?.activeNode ?? null;
  const drafts = activeSession?.drafts ?? {};
  const draft = activePath ? drafts[activePath] : undefined;

  return {
    ribbonMode,
    setRibbonMode,
    hasActiveSessions,
    sessions,
    activeTabId,
    setActiveTabId,
    activeSession,
    treeNodes,
    expandedPaths,
    loadingPaths,
    activePath,
    activeNode,
    drafts,
    draft,
    savedConnections,
    setSavedConnections,
    selectedConnectionId,
    setSelectedConnectionId,
    connectionError,
    saveError,
    isConnecting,
    openNode,
    toggleNode,
    refreshActiveNode,
    ensureChildrenLoaded: (path: string, opts?: { force?: boolean }) =>
      activeTabId ? ensureChildrenLoaded(activeTabId, path, opts) : Promise.resolve(),
    createNode,
    deleteNode: deleteNodeFn,
    updateDraft,
    discardDraft,
    handleSave,
    submitConnection,
    disconnectSession,
  };
}
```

- [ ] **Step 2: Rewrite `src/connectivity.test.tsx`**

Replace the entire file:

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import type { SavedConnection } from "./lib/types";

const { connectServerMock, listChildrenMock, getNodeDetailsMock } = vi.hoisted(() => ({
  connectServerMock: vi.fn(async () => ({
    connected: true,
    authMode: "digest",
    authSucceeded: true,
    message: "connected to 127.0.0.1:2181",
  })),
  listChildrenMock: vi.fn(async (_connectionId: string, path: string) => {
    if (path === "/") {
      return [{ path: "/services", name: "services", hasChildren: true }];
    }
    if (path === "/services") {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      return [{ path: "/services/gateway", name: "gateway", hasChildren: false }];
    }
    return [];
  }),
  getNodeDetailsMock: vi.fn(async (_connectionId: string, path: string) => ({
    path,
    value: "gateway_enabled=true",
    formatHint: "text",
    dataKind: "text",
    displayModeLabel: "文本 · 可编辑",
    editable: true,
    rawPreview: "",
    decodedPreview: "",
    version: 7,
    childrenCount: 0,
    updatedAt: "2026-03-28 11:00",
    cVersion: 0,
    aclVersion: 0,
    cZxid: null,
    mZxid: null,
    cTime: 0,
    mTime: 0,
    dataLength: 20,
    ephemeral: false,
  })),
}));

vi.mock("./lib/commands", () => ({
  connectServer: connectServerMock,
  disconnectServer: vi.fn(async () => {}),
  listChildren: listChildrenMock,
  getNodeDetails: getNodeDetailsMock,
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
}));

const LOCAL_CONN: SavedConnection = {
  id: "local",
  name: "本地开发",
  connectionString: "127.0.0.1:2181",
  timeoutMs: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("zoocute:connections", JSON.stringify([LOCAL_CONN]));
});

describe("submitConnection", () => {
  it("creates a session and switches to browse mode", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    expect(result.current.hasActiveSessions).toBe(true);
    expect(result.current.activeTabId).toBe("local");
    expect(result.current.ribbonMode).toBe("browse");
    expect(result.current.treeNodes.some((n) => n.name === "services")).toBe(true);
  });

  it("sets connectionError on failure", async () => {
    connectServerMock.mockRejectedValueOnce(new Error("refused"));
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "bad:2181",
        username: "",
        password: "",
      });
    });

    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.connectionError).toBe("refused");
  });
});

describe("toggleNode / lazy loading", () => {
  it("loads children when a node is expanded", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    await act(async () => {
      await result.current.toggleNode("/services");
    });

    await waitFor(() => {
      const services = result.current.treeNodes.find((n) => n.path === "/services");
      expect(services?.children?.some((c) => c.name === "gateway")).toBe(true);
    });
  });

  it("collapses an expanded node without re-fetching", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
      await result.current.toggleNode("/services");
    });

    await waitFor(() => {
      expect(result.current.expandedPaths.has("/services")).toBe(true);
    });

    act(() => {
      result.current.toggleNode("/services");
    });

    expect(result.current.expandedPaths.has("/services")).toBe(false);
  });
});

describe("disconnectSession", () => {
  it("removes the session and reverts to connections mode", async () => {
    const { result } = renderHook(() => useWorkbenchState());

    await act(async () => {
      await result.current.submitConnection({
        connectionId: "local",
        connectionString: "127.0.0.1:2181",
        username: "",
        password: "",
      });
    });

    await act(async () => {
      await result.current.disconnectSession("local");
    });

    expect(result.current.hasActiveSessions).toBe(false);
    expect(result.current.ribbonMode).toBe("connections");
  });
});
```

- [ ] **Step 3: Rewrite `src/use-workbench-state.test.tsx`**

Replace the entire file:

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import type { SavedConnection } from "./lib/types";

const { getNodeDetailsMock } = vi.hoisted(() => ({
  getNodeDetailsMock: vi.fn(async (_connectionId: string, path: string) => ({
    path,
    value: "test",
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
    dataLength: 4,
    ephemeral: false,
  })),
}));

vi.mock("./lib/commands", () => ({
  connectServer: vi.fn(async () => ({ connected: true, authMode: "anonymous", authSucceeded: true, message: "" })),
  disconnectServer: vi.fn(async () => {}),
  listChildren: vi.fn(async (_id: string, path: string) => {
    if (path === "/") return [{ path: "/configs", name: "configs", hasChildren: false }];
    return [];
  }),
  getNodeDetails: getNodeDetailsMock,
  saveNode: vi.fn(async () => {}),
  createNode: vi.fn(async () => {}),
  deleteNode: vi.fn(async () => {}),
}));

const CONN: SavedConnection = { id: "c1", name: "本地", connectionString: "127.0.0.1:2181", timeoutMs: 5000 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("zoocute:connections", JSON.stringify([CONN]));
});

async function connectAndGet() {
  const hook = renderHook(() => useWorkbenchState());
  await act(async () => {
    await hook.result.current.submitConnection({
      connectionId: "c1",
      connectionString: "127.0.0.1:2181",
      username: "",
      password: "",
    });
  });
  return hook;
}

describe("openNode", () => {
  it("fetches node details and updates activePath", async () => {
    const { result } = await connectAndGet();

    await act(async () => {
      await result.current.openNode("/configs");
    });

    await waitFor(() => {
      expect(result.current.activePath).toBe("/configs");
      expect(result.current.activeNode?.path).toBe("/configs");
    });
  });

  it("does nothing when no session is active", async () => {
    const { result } = renderHook(() => useWorkbenchState());
    await act(async () => {
      await result.current.openNode("/configs");
    });
    expect(result.current.activePath).toBeNull();
  });
});

describe("draft management", () => {
  it("updateDraft and discardDraft modify drafts for current session", async () => {
    const { result } = await connectAndGet();

    act(() => {
      result.current.updateDraft("/configs", "edited");
    });
    expect(result.current.drafts["/configs"]).toBe("edited");

    act(() => {
      result.current.discardDraft("/configs");
    });
    expect(result.current.drafts["/configs"]).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run all frontend tests**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass (connectivity, use-workbench-state, session-manager, persisted-connections, connection-pane).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-workbench-state.ts src/connectivity.test.tsx src/use-workbench-state.test.tsx
git commit -m "feat: rewrite useWorkbenchState for multi-session with useSessionManager"
```

---

## Task 5: Create `ServerTabs` component

**Files:**
- Create: `src/components/server-tabs.tsx`
- Create: `src/server-tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/server-tabs.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ServerTabs } from "./components/server-tabs";
import type { ActiveSession, SavedConnection } from "./lib/types";

function makeSession(id: string, name: string): [string, ActiveSession] {
  const conn: SavedConnection = { id, name, connectionString: `${id}:2181`, timeoutMs: 5000 };
  return [id, {
    connection: conn,
    treeNodes: [],
    expandedPaths: new Set(),
    loadingPaths: new Set(),
    activePath: null,
    activeNode: null,
    drafts: {},
  }];
}

describe("ServerTabs", () => {
  const sessions = new Map([makeSession("c1", "本地开发"), makeSession("c2", "生产集群")]);

  it("renders a tab for each session", () => {
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={vi.fn()} />
    );
    expect(screen.getByText("本地开发")).toBeInTheDocument();
    expect(screen.getByText("生产集群")).toBeInTheDocument();
  });

  it("calls onTabSelect when a non-active tab is clicked", () => {
    const onSelect = vi.fn();
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={onSelect} onTabClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("生产集群"));
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("calls onTabClose when × is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={onClose} />
    );
    const closeButtons = screen.getAllByTitle("断开连接");
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledWith("c1");
  });

  it("applies active class to the active tab", () => {
    const { container } = render(
      <ServerTabs sessions={sessions} activeTabId="c1" onTabSelect={vi.fn()} onTabClose={vi.fn()} />
    );
    const active = container.querySelector(".server-tab--active");
    expect(active?.textContent).toContain("本地开发");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server-tabs.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `ServerTabs` not found.

- [ ] **Step 3: Implement `src/components/server-tabs.tsx`**

```typescript
import type { ActiveSession } from "../lib/types";

interface ServerTabsProps {
  sessions: Map<string, ActiveSession>;
  activeTabId: string | null;
  onTabSelect: (connectionId: string) => void;
  onTabClose: (connectionId: string) => void;
}

export function ServerTabs({
  sessions,
  activeTabId,
  onTabSelect,
  onTabClose,
}: ServerTabsProps) {
  return (
    <div className="server-tabs">
      {[...sessions.entries()].map(([id, session]) => (
        <div
          key={id}
          className={`server-tab${id === activeTabId ? " server-tab--active" : ""}`}
          onClick={() => onTabSelect(id)}
        >
          <span className="server-tab-dot" />
          <span className="server-tab-name">{session.connection.name}</span>
          <button
            className="server-tab-close"
            title="断开连接"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/server-tabs.test.tsx 2>&1 | tail -10
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/server-tabs.tsx src/server-tabs.test.tsx
git commit -m "feat: ServerTabs component for multi-server horizontal tab bar"
```

---

## Task 6: Update `Ribbon` for conditional icons

**Files:**
- Modify: `src/components/ribbon.tsx`
- Modify: `src/layout.test.tsx`

- [ ] **Step 1: Check existing `src/layout.test.tsx`**

Read the file to understand what it tests before modifying.

```bash
cat src/layout.test.tsx
```

- [ ] **Step 2: Update `src/components/ribbon.tsx`**

Replace the file content:

```typescript
import type { RibbonMode } from "../lib/types";

interface RibbonProps {
  mode: RibbonMode;
  onModeChange: (mode: RibbonMode) => void;
  hasActiveSessions: boolean;
}

const ALL_MODES: { mode: RibbonMode; icon: string; title: string }[] = [
  { mode: "browse",      icon: "🌲", title: "节点树" },
  { mode: "connections", icon: "🔌", title: "连接管理" },
  { mode: "log",         icon: "📋", title: "操作日志" },
];

export function Ribbon({ mode, onModeChange, hasActiveSessions }: RibbonProps) {
  const visibleModes = ALL_MODES.filter(
    (m) => m.mode === "connections" || hasActiveSessions
  );
  return (
    <nav className="ribbon">
      <div className="ribbon-logo">🌿</div>
      {visibleModes.map(({ mode: m, icon, title }) => (
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

- [ ] **Step 3: Update `src/layout.test.tsx` — add `hasActiveSessions` to all Ribbon renders**

In `src/layout.test.tsx`, there are three `render(<Ribbon ...)` calls. Each one needs `hasActiveSessions={true}` so that browse/log buttons are visible:

```typescript
// Line 9 — add hasActiveSessions={true}
render(<Ribbon mode="browse" onModeChange={() => {}} hasActiveSessions={true} />);

// Line 16 — add hasActiveSessions={true}
render(<Ribbon mode="connections" onModeChange={() => {}} hasActiveSessions={true} />);

// Line 23 — add hasActiveSessions={true}
render(<Ribbon mode="browse" onModeChange={handler} hasActiveSessions={true} />);
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/layout.test.tsx 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ribbon.tsx src/layout.test.tsx
git commit -m "feat: Ribbon shows browse/log icons only when hasActiveSessions=true"
```

---

## Task 7: Update `App.tsx` and add CSS styles

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Replace `src/App.tsx`**

```typescript
import "./styles/app.css";
import { useState } from "react";
import { usePanelResize } from "./hooks/use-panel-resize";
import { useWorkbenchState } from "./hooks/use-workbench-state";
import { Ribbon } from "./components/ribbon";
import { BrowserPane } from "./components/browser-pane";
import { ConnectionPane, ConnectionDetail } from "./components/connection-pane";
import { NodeStat } from "./components/node-stat";
import { EditorPanel } from "./components/editor-panel";
import { TreeContextMenu } from "./components/tree-context-menu";
import { ServerTabs } from "./components/server-tabs";

export default function App() {
  const {
    ribbonMode, setRibbonMode,
    hasActiveSessions,
    sessions, activeTabId, setActiveTabId,
    activeSession,
    activePath, activeNode,
    drafts,
    treeNodes, expandedPaths, loadingPaths,
    connectionError,
    saveError,
    openNode, toggleNode, ensureChildrenLoaded,
    updateDraft, discardDraft, handleSave,
    createNode, deleteNode,
    submitConnection, disconnectSession,
    savedConnections, setSavedConnections,
    selectedConnectionId, setSelectedConnectionId,
  } = useWorkbenchState();

  const { width: sidebarWidth, onMouseDown: onResizeMouseDown } = usePanelResize(
    220, "zoocute:sidebar-width"
  );

  const draft = activePath ? drafts[activePath] : undefined;

  const selectedConn =
    savedConnections.find((c) => c.id === selectedConnectionId) ?? savedConnections[0];

  const [contextMenu, setContextMenu] = useState<{
    path: string; x: number; y: number; hasChildren: boolean;
  } | null>(null);

  const showTabs = (ribbonMode === "browse" || ribbonMode === "log") && hasActiveSessions;

  return (
    <div className="app-shell">
      <Ribbon
        mode={ribbonMode}
        onModeChange={setRibbonMode}
        hasActiveSessions={hasActiveSessions}
      />
      {connectionError && (
        <div className="error-toast">{connectionError}</div>
      )}

      <div className="left-panel" style={{ width: sidebarWidth }}>
        {ribbonMode === "browse" && activeSession && (
          <BrowserPane
            treeNodes={treeNodes}
            activePath={activePath}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
            connectionString={activeSession.connection.connectionString}
            isConnected={true}
            onSelectPath={openNode}
            onTogglePath={toggleNode}
            onContextMenu={(path, e) => {
              const node = treeNodes
                .flatMap(function flatten(n): typeof treeNodes {
                  return [n, ...(n.children ?? []).flatMap(flatten)];
                })
                .find((n) => n.path === path);
              setContextMenu({ path, x: e.clientX, y: e.clientY, hasChildren: !!(node?.hasChildren) });
            }}
          />
        )}
        {ribbonMode === "connections" && (
          <ConnectionPane
            connections={savedConnections}
            selectedId={selectedConnectionId}
            connectedId={activeTabId}
            onSelect={setSelectedConnectionId}
            onNew={() => {
              const newConn = {
                id: Date.now().toString(),
                name: "新连接",
                connectionString: "",
                timeoutMs: 5000,
              };
              setSavedConnections((prev) => [...prev, newConn]);
              setSelectedConnectionId(newConn.id);
            }}
            onConnect={(c) =>
              submitConnection({
                connectionString: c.connectionString,
                username: c.username ?? "",
                password: c.password ?? "",
                connectionId: c.id,
              })
            }
            onDisconnect={disconnectSession}
          />
        )}
        {ribbonMode === "log" && (
          <div className="placeholder-pane">日志（待实现）</div>
        )}
      </div>

      <div className="resize-handle" onMouseDown={onResizeMouseDown} />

      <div className="content-area">
        {showTabs && (
          <ServerTabs
            sessions={sessions}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
            onTabClose={disconnectSession}
          />
        )}

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

        {ribbonMode === "browse" && activeSession && !activeNode && (
          <div className="placeholder-pane">选择左侧节点查看详情</div>
        )}

        {ribbonMode === "connections" && selectedConn && (
          <ConnectionDetail
            connection={selectedConn}
            isConnected={sessions.has(selectedConn.id)}
            onSave={(c) =>
              setSavedConnections((prev) => prev.map((x) => (x.id === c.id ? c : x)))
            }
            onTestConnect={(c) =>
              submitConnection({
                connectionString: c.connectionString,
                username: c.username ?? "",
                password: c.password ?? "",
                connectionId: c.id,
              })
            }
            onDelete={(id) => {
              setSavedConnections((prev) => prev.filter((x) => x.id !== id));
              setSelectedConnectionId(
                savedConnections.find((x) => x.id !== id)?.id ?? null
              );
            }}
          />
        )}

        {ribbonMode === "log" && (
          <div className="placeholder-pane">操作日志（待实现）</div>
        )}
      </div>

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
    </div>
  );
}
```

- [ ] **Step 2: Add server-tabs CSS to `src/styles/app.css`**

Append to the end of `src/styles/app.css`:

```css
/* Server Tabs */
.server-tabs {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
  background: var(--bg-sidebar);
  height: 34px;
  flex-shrink: 0;
  overflow-x: auto;
}

.server-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  border-right: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}

.server-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.server-tab--active {
  background: var(--bg-content);
  color: var(--text-primary);
  border-bottom: 2px solid var(--accent);
}

.server-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success, #22c55e);
  flex-shrink: 0;
}

.server-tab-name {
  flex: 1;
}

.server-tab-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.1s;
}

.server-tab:hover .server-tab-close {
  opacity: 1;
}

.server-tab-close:hover {
  color: var(--text-primary);
}
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4: Build to check for type errors**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles/app.css
git commit -m "feat: wire ServerTabs and multi-session state into App, conditional Ribbon icons"
```

---

## Task 8: Fix any remaining test breakage and verify full run

**Files:**
- Possibly: `src/App.test.tsx`, `src/browser-pane.test.tsx`, `src/layout.test.tsx`

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run 2>&1
```

Note any failures.

- [ ] **Step 2: Fix any test that passes wrong props to `Ribbon`**

For each failing test that renders `<Ribbon>` without `hasActiveSessions`, add the missing prop:

```typescript
// Before
render(<Ribbon mode="connections" onModeChange={vi.fn()} />)

// After
render(<Ribbon mode="connections" onModeChange={vi.fn()} hasActiveSessions={false} />)
```

- [ ] **Step 3: Fix any test that uses removed APIs from `useWorkbenchState`**

If any test still calls `updateConnectionForm`, `submitConnection()` with no args, or accesses `connectionResult` / `connectedConnectionId`, update it to use the new API.

- [ ] **Step 4: Run full test suite again**

```bash
npx vitest run 2>&1
```

Expected: all tests pass, zero failures.

- [ ] **Step 5: Run Rust tests**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix: update remaining tests for multi-server session API"
```
