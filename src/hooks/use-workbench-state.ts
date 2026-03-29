import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { usePersistedConnections } from "./use-persisted-connections";
import { useSessionManager } from "./use-session-manager";
import { useNodeSearch } from "./use-node-search";
import { buildProjectedTree } from "./use-tree-projection";
import {
  connectServer,
  disconnectServer as disconnectServerCmd,
  createNode as createNodeCmd,
  deleteNode as deleteNodeCmd,
  getNodeDetails,
  getTreeSnapshot,
  listChildren,
  loadFullTree as loadFullTreeCmd,
  saveNode,
} from "../lib/commands";
import type { CacheEvent, NodeTreeItem, RibbonMode, TreeSnapshot, WatchEvent } from "../lib/types";

/** Returns the ancestor paths that must be expanded to make `path` visible in the tree.
 *  e.g. "/a/b/c" → ["/a", "/a/b"] */
function buildAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    result.push("/" + parts.slice(0, i + 1).join("/"));
  }
  return result;
}

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

/** Used by `locate` which builds a working tree snapshot directly.
 *  `ensureChildrenLoaded` uses replaceChildren + patchNodeMeta instead. */
function mergeChildren(
  nodes: NodeTreeItem[],
  targetPath: string,
  children: NodeTreeItem[]
): NodeTreeItem[] {
  if (targetPath === "/") return children;
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, hasChildren: children.length > 0, children };
    }
    if (!node.children?.length) return node;
    return { ...node, children: mergeChildren(node.children, targetPath, children) };
  });
}

function replaceChildren(
  nodes: NodeTreeItem[],
  parentPath: string,
  children: NodeTreeItem[]
): NodeTreeItem[] {
  // Like mergeChildren but does NOT modify hasChildren — that's patchNodeMeta's job
  if (parentPath === "/") return children;
  return nodes.map((node) => {
    if (node.path === parentPath) {
      return { ...node, children };
    }
    if (!node.children?.length) return node;
    return { ...node, children: replaceChildren(node.children, parentPath, children) };
  });
}

function patchNodeMeta(
  nodes: NodeTreeItem[],
  targetPath: string,
  patch: Partial<Pick<NodeTreeItem, "hasChildren">>
): NodeTreeItem[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, ...patch };
    }
    if (!node.children?.length) return node;
    return { ...node, children: patchNodeMeta(node.children, targetPath, patch) };
  });
}

function removeNode(nodes: NodeTreeItem[], targetPath: string): NodeTreeItem[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) => {
      if (!node.children?.length) return node;
      return { ...node, children: removeNode(node.children, targetPath) };
    });
}

function updateNodeHasChildren(
  nodes: NodeTreeItem[],
  targetPath: string,
  hasChildren: boolean
): NodeTreeItem[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, hasChildren };
    }
    if (!node.children?.length) return node;
    return {
      ...node,
      children: updateNodeHasChildren(node.children, targetPath, hasChildren),
    };
  });
}

function mergeProjectedTree(
  projectedNodes: NodeTreeItem[],
  fallbackNodes: NodeTreeItem[]
): NodeTreeItem[] {
  const fallbackByPath = new Map(fallbackNodes.map((node) => [node.path, node] as const));
  const projectedPaths = new Set(projectedNodes.map((node) => node.path));
  const merged = projectedNodes.map((node) => {
    const fallback = fallbackByPath.get(node.path);
    if (!fallback?.children?.length) {
      return node;
    }
    return {
      ...node,
      children: node.children
        ? mergeProjectedTree(node.children, fallback.children)
        : fallback.children,
    };
  });

  for (const fallback of fallbackNodes) {
    if (projectedPaths.has(fallback.path)) continue;
    merged.push(fallback);
  }

  return merged;
}

function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : path.substring(0, lastSlash);
}

function isNoNodeError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("NoNode") || error.message.includes("no node");
  }
  if (typeof error === "string") {
    return error.includes("NoNode") || error.includes("no node");
  }
  return false;
}

type EnsureChildrenResult = {
  children: NodeTreeItem[];
  addedPaths: string[];
};

export const RECENT_LEAF_PROBE_WINDOW_MS = 1500;
export const LEAF_REPROBE_DELAY_MS = 400;

type RecentLeafProbe = {
  firstSeenAt: number;
};

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
    enterEditMode: enterEditModeSession,
    exitEditMode: exitEditModeSession,
  } = useSessionManager();

  const nodeSearch = useNodeSearch(activeTabId);
  const unlistenRefs = useRef<Map<string, () => void>>(new Map());
  const cacheUnlistenRefs = useRef<Map<string, () => void>>(new Map());
  const pendingChildRefreshRefs = useRef<Map<string, Set<string>>>(new Map());
  // Prevents concurrent getNodeDetails for the same path (distinct from pendingChildRefreshRefs which guards listChildren)
  const pendingProbeRefs = useRef<Map<string, Set<string>>>(new Map());
  // Maps connectionId → (path → firstSeenAt) for nodes that returned childrenCount=0 on probe
  const recentLeafProbeRefs = useRef<Map<string, Map<string, RecentLeafProbe>>>(new Map());
  const scheduledLeafProbeRefs = useRef<
    Map<string, Map<string, ReturnType<typeof setTimeout>>>
  >(new Map());
  const cacheSnapshotsRef = useRef<Map<string, TreeSnapshot>>(new Map());

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null);
  const [indexingConnections, setIndexingConnections] = useState<Set<string>>(new Set());
  const [, setCacheSnapshotVersion] = useState(0);

  // Force connections mode when all sessions are closed
  useEffect(() => {
    if (!hasActiveSessions) {
      setRibbonMode("connections");
    }
  }, [hasActiveSessions]);

  useEffect(() => {
    return () => {
      for (const unlisten of unlistenRefs.current.values()) {
        unlisten();
      }
      unlistenRefs.current.clear();
      for (const unlisten of cacheUnlistenRefs.current.values()) {
        unlisten();
      }
      cacheUnlistenRefs.current.clear();
      for (const timers of scheduledLeafProbeRefs.current.values()) {
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
      }
      scheduledLeafProbeRefs.current.clear();
    };
  }, []);

  const handleWatchEvent = useEffectEvent(async (event: WatchEvent) => {
    console.debug("[zk-watch-event] received", event);
    const session = sessions.get(event.connectionId);
    if (!session) return;

    if (event.eventType === "children_changed" || event.eventType === "node_created") {
      const pending = pendingChildRefreshRefs.current.get(event.connectionId) ?? new Set<string>();
      if (pending.has(event.path)) return;
      pending.add(event.path);
      pendingChildRefreshRefs.current.set(event.connectionId, pending);
      try {
        const result = await ensureChildrenLoaded(event.connectionId, event.path, { force: true });
        if (result) {
          if (result.addedPaths.length) {
            await probeFreshNodes(event.connectionId, result.addedPaths);
          }
        }
      } finally {
        const next = pendingChildRefreshRefs.current.get(event.connectionId);
        next?.delete(event.path);
        if (next && next.size === 0) {
          pendingChildRefreshRefs.current.delete(event.connectionId);
        }
      }
      return;
    }

    if (event.eventType === "data_changed") {
      if (session.activePath !== event.path) return;
      const isEditing =
        session.editingPaths.has(event.path) && session.drafts[event.path] !== undefined;
      if (isEditing) return;

      try {
        const nodeDetails = await getNodeDetails(event.connectionId, event.path);
        updateSession(event.connectionId, (current) => {
          if (current.activePath !== event.path) return current;
          const stillEditing =
            current.editingPaths.has(event.path) &&
            current.drafts[event.path] !== undefined;
          if (stillEditing) return current;
          return { ...current, activeNode: nodeDetails };
        });
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "节点读取失败");
      }
      return;
    }

    if (event.eventType === "node_deleted") {
      nodeSearch.removeSubtree(event.connectionId, event.path);
      updateSession(event.connectionId, (current) => ({
        ...current,
        treeNodes: removeNode(current.treeNodes, event.path),
        activePath: current.activePath === event.path ? null : current.activePath,
        activeNode: current.activePath === event.path ? null : current.activeNode,
      }));
      clearRecentLeafProbe(event.connectionId, event.path);
      await ensureChildrenLoaded(event.connectionId, getParentPath(event.path), { force: true });
    }
  });

  const PROBE_CONCURRENCY = 5;

  function clearScheduledLeafProbe(connectionId: string, path: string) {
    const timers = scheduledLeafProbeRefs.current.get(connectionId);
    const timer = timers?.get(path);
    if (timer) {
      clearTimeout(timer);
      timers?.delete(path);
    }
    if (timers && timers.size === 0) {
      scheduledLeafProbeRefs.current.delete(connectionId);
    }
  }

  function clearRecentLeafProbe(connectionId: string, path: string) {
    recentLeafProbeRefs.current.get(connectionId)?.delete(path);
    if (recentLeafProbeRefs.current.get(connectionId)?.size === 0) {
      recentLeafProbeRefs.current.delete(connectionId);
    }
    clearScheduledLeafProbe(connectionId, path);
  }

  function scheduleLeafReprobe(connectionId: string, path: string) {
    const recent = recentLeafProbeRefs.current.get(connectionId)?.get(path);
    if (!recent) return;
    if (Date.now() - recent.firstSeenAt >= RECENT_LEAF_PROBE_WINDOW_MS) {
      clearRecentLeafProbe(connectionId, path);
      return;
    }

    const timers = scheduledLeafProbeRefs.current.get(connectionId) ?? new Map();
    if (timers.has(path)) return;

    const timer = setTimeout(() => {
      clearScheduledLeafProbe(connectionId, path);
      const activeProbe = recentLeafProbeRefs.current.get(connectionId)?.get(path);
      if (!activeProbe) return;
      if (Date.now() - activeProbe.firstSeenAt >= RECENT_LEAF_PROBE_WINDOW_MS) {
        clearRecentLeafProbe(connectionId, path);
        return;
      }
      void probeFreshNodes(connectionId, [path]);
    }, LEAF_REPROBE_DELAY_MS);

    timers.set(path, timer);
    scheduledLeafProbeRefs.current.set(connectionId, timers);
  }

  async function probeFreshNodes(connectionId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const pending = pendingProbeRefs.current.get(connectionId) ?? new Set<string>();
    pendingProbeRefs.current.set(connectionId, pending);

    const pathsToProbe = paths.filter((p) => !pending.has(p));
    for (const p of pathsToProbe) pending.add(p);

    try {
      for (let i = 0; i < pathsToProbe.length; i += PROBE_CONCURRENCY) {
        const batch = pathsToProbe.slice(i, i + PROBE_CONCURRENCY);
        await Promise.all(
          batch.map(async (path) => {
            try {
              const details = await getNodeDetails(connectionId, path);
              if (details.childrenCount > 0) {
                // Has children — update tree and clear from observation window
                updateSession(connectionId, (s) => ({
                  ...s,
                  treeNodes: patchNodeMeta(s.treeNodes, path, { hasChildren: true }),
                }));
                nodeSearch.patchNodeMeta(connectionId, path, { hasChildren: true });
                clearRecentLeafProbe(connectionId, path);
              } else {
                // No children yet — record timestamp for observation window
                const connLeaves =
                  recentLeafProbeRefs.current.get(connectionId) ?? new Map<string, RecentLeafProbe>();
                const existing = connLeaves.get(path);
                connLeaves.set(path, existing ?? { firstSeenAt: Date.now() });
                recentLeafProbeRefs.current.set(connectionId, connLeaves);
                scheduleLeafReprobe(connectionId, path);
              }
            } catch (error) {
              if (!isNoNodeError(error)) {
                console.warn("[probeFreshNodes] unexpected error probing", path, error);
              }
              // NoNode = race condition, silently ignored
              clearRecentLeafProbe(connectionId, path);
            } finally {
              pending.delete(path);
            }
          })
        );
      }
    } finally {
      if (pending.size === 0) {
        pendingProbeRefs.current.delete(connectionId);
      }
    }
  }

  async function ensureWatchListener(connectionId: string) {
    if (unlistenRefs.current.has(connectionId)) return;
    const handler = (event: { payload: WatchEvent }) => {
      if (event.payload.connectionId !== connectionId) return;
      void handleWatchEvent(event.payload);
    };

    const unlisten = await getCurrentWebviewWindow().listen<WatchEvent>("zk-watch-event", handler);
    unlistenRefs.current.set(connectionId, () => {
      void unlisten();
    });
  }

  async function ensureCacheListener(connectionId: string) {
    if (cacheUnlistenRefs.current.has(connectionId)) return;
    const handler = (event: { payload: CacheEvent }) => {
      if (event.payload.connectionId !== connectionId) return;
      void getTreeSnapshot(connectionId)
        .then((snapshot) => {
          cacheSnapshotsRef.current.set(connectionId, snapshot);
          setCacheSnapshotVersion((version) => version + 1);
        })
        .catch(() => {
          // snapshot failure should not block existing tree flow
        });
    };

    const unlisten = await getCurrentWebviewWindow().listen<CacheEvent>("zk-cache-event", handler);
    cacheUnlistenRefs.current.set(connectionId, () => {
      void unlisten();
    });
  }

  async function cacheTreeSnapshot(connectionId: string) {
    try {
      const snapshot = await getTreeSnapshot(connectionId);
      cacheSnapshotsRef.current.set(connectionId, snapshot);
      setCacheSnapshotVersion((version) => version + 1);
    } catch {
      // snapshot failure should not block existing tree flow
    }
  }

  async function submitConnection(params: {
    connectionString: string;
    username: string;
    password: string;
    connectionId: string;
  }) {
    setIsConnecting(true);
    setConnectionError(null);
    setConnectionNotice(null);
    try {
      await connectServer(params.connectionId, {
        connectionString: params.connectionString,
        username: params.username || undefined,
        password: params.password || undefined,
      });
      const rootNodes = await listChildren(params.connectionId, "/");
      const conn = savedConnections.find((c) => c.id === params.connectionId)!;
      addSession(conn, rootNodes);
      nodeSearch.indexNodes(params.connectionId, "/", rootNodes);
      setRibbonMode("browse");
      void cacheTreeSnapshot(params.connectionId);
      void ensureWatchListener(params.connectionId).catch((error) => {
        setConnectionError(
          error instanceof Error ? `watch listener 注册失败: ${error.message}` : "watch listener 注册失败"
        );
      });
      void ensureCacheListener(params.connectionId).catch(() => {
        // cache listener setup is best-effort and must not surface as a user-facing connection error
      });

      // Background: recursively fetch the full tree so all nodes are searchable,
      // not just the ones the user has expanded. Runs after UI is already shown.
      const connId = params.connectionId;
      setIndexingConnections((prev) => new Set([...prev, connId]));
      loadFullTreeCmd(connId)
        .then((allNodes) => nodeSearch.bulkIndex(connId, allNodes))
        .catch(() => { /* partial index is still useful — silently ignore */ })
        .finally(() => {
          setIndexingConnections((prev) => {
            const next = new Set(prev);
            next.delete(connId);
            return next;
          });
        });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接失败");
    } finally {
      setIsConnecting(false);
    }
  }

  async function testConnection(params: {
    connectionString: string;
    username: string;
    password: string;
    connectionId: string;
  }) {
    setIsConnecting(true);
    setConnectionError(null);
    setConnectionNotice(null);
    try {
      await connectServer(params.connectionId, {
        connectionString: params.connectionString,
        username: params.username || undefined,
        password: params.password || undefined,
      });
      setConnectionNotice("连接测试成功");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接测试失败");
      return;
    } finally {
      try {
        await disconnectServerCmd(params.connectionId);
      } catch {
        // best-effort cleanup for test-only connections
      }
      setIsConnecting(false);
    }
  }

  function showConnectionNotice(message: string) {
    setConnectionError(null);
    setConnectionNotice(message);
  }

  async function disconnectSession(connectionId: string) {
    unlistenRefs.current.get(connectionId)?.();
    unlistenRefs.current.delete(connectionId);
    cacheUnlistenRefs.current.get(connectionId)?.();
    cacheUnlistenRefs.current.delete(connectionId);
    cacheSnapshotsRef.current.delete(connectionId);
    pendingChildRefreshRefs.current.delete(connectionId);
    pendingProbeRefs.current.delete(connectionId);
    recentLeafProbeRefs.current.delete(connectionId);
    const timers = scheduledLeafProbeRefs.current.get(connectionId);
    if (timers) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      scheduledLeafProbeRefs.current.delete(connectionId);
    }
    try {
      await disconnectServerCmd(connectionId);
    } catch {
      // best-effort disconnect
    }
    nodeSearch.clearSession(connectionId);
    removeSession(connectionId);
  }

  async function ensureChildrenLoaded(
    connectionId: string,
    path: string,
    options?: { force?: boolean }
  ): Promise<EnsureChildrenResult | undefined> {
    const session = sessions.get(connectionId);
    if (!session) return undefined;
    if (path !== "/") {
      const targetNode = findNode(session.treeNodes, path);
      if (!targetNode) return undefined;
      if (!options?.force && !targetNode.hasChildren) return undefined;
      if (!options?.force && targetNode.children) return undefined;
    }

    // Snapshot current children BEFORE the await — used for addedPaths diff
    const prevPaths = new Set(
      path === "/"
        ? session.treeNodes.map((n) => n.path)
        : (findNode(session.treeNodes, path)?.children ?? []).map((n) => n.path)
    );

    updateSession(connectionId, (s) => ({
      ...s,
      loadingPaths: new Set(s.loadingPaths).add(path),
    }));

    try {
      const children = await listChildren(connectionId, path);
      updateSession(connectionId, (s) => {
        const newTree = replaceChildren(s.treeNodes, path, children);
        const patchedTree =
          path === "/"
            ? newTree
            : patchNodeMeta(newTree, path, { hasChildren: children.length > 0 });
        return {
          ...s,
          treeNodes: patchedTree,
          loadingPaths: (() => {
            const next = new Set(s.loadingPaths);
            next.delete(path);
            return next;
          })(),
        };
      });
      nodeSearch.indexNodes(connectionId, path, children);

      const addedPaths = children
        .filter((c) => !prevPaths.has(c.path))
        .map((c) => c.path);

      return { children, addedPaths };
    } catch (error) {
      const isDeletedDuringRefresh = options?.force && path !== "/" && isNoNodeError(error);
      updateSession(connectionId, (s) => ({
        ...s,
        treeNodes: isDeletedDuringRefresh ? removeNode(s.treeNodes, path) : s.treeNodes,
        activePath: isDeletedDuringRefresh && s.activePath === path ? null : s.activePath,
        activeNode: isDeletedDuringRefresh && s.activePath === path ? null : s.activeNode,
        loadingPaths: (() => {
          const next = new Set(s.loadingPaths);
          next.delete(path);
          return next;
        })(),
      }));
      if (isDeletedDuringRefresh) {
        nodeSearch.removeSubtree(connectionId, path);
        await ensureChildrenLoaded(connectionId, getParentPath(path), { force: true });
        return undefined;
      }
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
      return undefined;
    }
  }

  async function doOpenNode(path: string) {
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
      const hasChildren = nodeDetails.childrenCount > 0;
      updateSession(activeTabId, (s) => ({
        ...s,
        treeNodes: updateNodeHasChildren(s.treeNodes, path, hasChildren),
        expandedPaths: hasChildren
          ? new Set(s.expandedPaths).add(path)
          : s.expandedPaths,
        activePath: path,
        activeNode: nodeDetails,
      }));
      if (hasChildren) {
        await ensureChildrenLoaded(activeTabId, path, { force: true });
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "节点读取失败");
    }
  }

  async function openNode(path: string) {
    if (!activeTabId) return;
    const isDirtyEditing =
      activePath &&
      activeSession?.editingPaths.has(activePath) &&
      activeSession?.drafts[activePath] !== undefined;
    if (isDirtyEditing) {
      setPendingNavPath(path);
      return;
    }
    await doOpenNode(path);
  }

  async function confirmNavAndDiscard() {
    if (!pendingNavPath || !activePath || !activeTabId) return;
    const target = pendingNavPath;
    discardDraft(activePath);
    exitEditModeSession(activeTabId, activePath);
    setPendingNavPath(null);
    await doOpenNode(target);
  }

  function cancelPendingNav() {
    setPendingNavPath(null);
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

  function enterEditMode(path: string) {
    if (!activeTabId) return;
    enterEditModeSession(activeTabId, path);
  }

  function exitEditMode(path: string) {
    if (!activeTabId) return;
    exitEditModeSession(activeTabId, path);
  }

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

  async function fetchServerValue(path: string): Promise<string | null> {
    if (!activeTabId) return null;
    try {
      const nodeDetails = await getNodeDetails(activeTabId, path);
      return nodeDetails.value;
    } catch {
      return null;
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
      nodeSearch.removeSubtree(activeTabId, path);
      const parentPath = getParentPath(path);
      await ensureChildrenLoaded(activeTabId, parentPath, { force: true });
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "删除节点失败");
    }
  }

  /** Navigate to a node found via search: load ancestors, expand, open. */
  async function locate(path: string) {
    if (!activeTabId) return;
    const connId = activeTabId;
    const ancestors = buildAncestors(path);

    // Build a local working tree so we don't depend on React state
    // being flushed between each await — sessions is a stale closure.
    const session = sessions.get(connId);
    if (!session) return;
    let workingNodes = session.treeNodes;

    for (const ancestor of ancestors) {
      const node = findNode(workingNodes, ancestor);
      if (!node?.hasChildren || node.children) continue;
      try {
        const children = await listChildren(connId, ancestor);
        workingNodes = mergeChildren(workingNodes, ancestor, children);
        nodeSearch.indexNodes(connId, ancestor, children);
      } catch {
        // best-effort — continue even if one level fails
      }
    }

    // Apply all tree changes + expand ancestors in one batch
    updateSession(connId, (s) => ({
      ...s,
      treeNodes: workingNodes,
      expandedPaths: new Set([...s.expandedPaths, ...ancestors]),
    }));

    nodeSearch.setSearchQuery("");
    await doOpenNode(path);
  }

  // Derive current session's state for App.tsx consumption
  const cachedSnapshot = activeTabId ? cacheSnapshotsRef.current.get(activeTabId) ?? null : null;
  const projectedTree = cachedSnapshot
    ? buildProjectedTree(cachedSnapshot, activeSession?.expandedPaths ?? new Set<string>())
    : null;
  const treeNodes = projectedTree
    ? mergeProjectedTree(projectedTree, activeSession?.treeNodes ?? [])
    : activeSession?.treeNodes ?? [];
  const expandedPaths = activeSession?.expandedPaths ?? new Set<string>();
  const loadingPaths = activeSession?.loadingPaths ?? new Set<string>();
  const activePath = activeSession?.activePath ?? null;
  const activeNode = activeSession?.activeNode ?? null;
  const drafts = activeSession?.drafts ?? {};
  const draft = activePath ? drafts[activePath] : undefined;
  const editingPaths = activeSession?.editingPaths ?? new Set<string>();
  const isEditing = activePath ? editingPaths.has(activePath) : false;

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
    connectionNotice,
    saveError,
    isConnecting,
    pendingNavPath,
    openNode,
    confirmNavAndDiscard,
    cancelPendingNav,
    toggleNode,
    refreshActiveNode,
    ensureChildrenLoaded: (path: string, opts?: { force?: boolean }) =>
      activeTabId ? ensureChildrenLoaded(activeTabId, path, opts).then(() => {}) : Promise.resolve(),
    createNode,
    deleteNode: deleteNodeFn,
    updateDraft,
    discardDraft,
    handleSave,
    isEditing,
    enterEditMode,
    exitEditMode,
    fetchServerValue,
    submitConnection,
    testConnection,
    disconnectSession,
    showConnectionNotice,
    searchQuery: nodeSearch.searchQuery,
    setSearchQuery: nodeSearch.setSearchQuery,
    searchResults: nodeSearch.searchResults,
    searchMode: nodeSearch.searchMode,
    isIndexing: activeTabId ? indexingConnections.has(activeTabId) : false,
    locate,
  };
}
